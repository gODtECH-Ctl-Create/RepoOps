import { createServer } from "node:http";

function jsonBody(value) {
  return `${JSON.stringify(value)}\n`;
}

function sendJson(response, statusCode, value, headers = {}) {
  const body = jsonBody(value);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function validateReadinessChecks(checks) {
  if (!Array.isArray(checks) || checks.some((check) => typeof check !== "function")) {
    throw new TypeError("Control-plane readiness checks must be functions");
  }
  return [...checks];
}

async function checksAreReady(checks) {
  for (const check of checks) {
    try {
      const result = await check();
      if (result === true) continue;
      if (result && typeof result === "object" && result.ready === true) continue;
      return false;
    } catch {
      return false;
    }
  }
  return true;
}

function requestPath(request) {
  try {
    return new URL(request.url ?? "/", "http://repoops.local").pathname;
  } catch {
    return null;
  }
}

/**
 * Build the HTTP transport used by the hosted RepoOps control plane.
 *
 * The server owns process-level health only. Future webhook/domain behavior must
 * be injected behind dedicated handlers instead of being implemented here.
 */
export function createControlPlaneServer({ readinessChecks = [], webhookHandler = null } = {}) {
  const checks = validateReadinessChecks(readinessChecks);
  let shuttingDown = false;
  let closePromise = null;

  const server = createServer(async (request, response) => {
    const path = requestPath(request);
    if (path === null) {
      sendJson(response, 400, { error: "bad-request" });
      return;
    }

    if (path === "/webhooks/github" && webhookHandler) {
      if (shuttingDown) sendJson(response, 503, { error: "not-ready" });
      else {
        try { await webhookHandler(request, response); }
        catch { if (!response.headersSent) sendJson(response, 503, { error: "acceptance-unavailable" }); }
      }
      return;
    }

    if (path === "/healthz" || path === "/readyz") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "method-not-allowed" }, { allow: "GET" });
        return;
      }

      if (path === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      const ready = !shuttingDown && await checksAreReady(checks);
      sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not-ready" });
      return;
    }

    sendJson(response, 404, { error: "not-found" });
  });

  function beginShutdown() {
    const changed = !shuttingDown;
    shuttingDown = true;
    return changed;
  }

  function close({ timeoutMs = 10_000 } = {}) {
    if (closePromise) return closePromise;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      return Promise.reject(new TypeError("Control-plane shutdown timeout must be a positive integer"));
    }

    beginShutdown();

    closePromise = new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve({ forced: false });
        return;
      }

      let forced = false;
      const timer = setTimeout(() => {
        forced = true;
        server.closeAllConnections?.();
      }, timeoutMs);
      timer.unref?.();

      server.close((error) => {
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        resolve({ forced });
      });
      server.closeIdleConnections?.();
    });

    return closePromise;
  }

  return Object.freeze({
    server,
    beginShutdown,
    close,
    isShuttingDown: () => shuttingDown
  });
}
