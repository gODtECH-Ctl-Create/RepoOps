import { parseControlPlaneConfig } from "./config.mjs";
import { createControlPlaneServer } from "./server.mjs";

function listen(server, { host, port }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function normalizeAddress(address, config) {
  if (address && typeof address === "object") {
    return Object.freeze({ address: address.address, family: address.family, port: address.port });
  }
  return Object.freeze({ address: config.host, family: null, port: config.port });
}

/**
 * Start the hosted control-plane process boundary.
 *
 * GitHub Actions continues to use src/index.mjs; this runtime is intentionally
 * separate so hosted persistence/auth/webhook work can evolve independently.
 */
export async function startControlPlane({ env = process.env, readinessChecks = [] } = {}) {
  const config = parseControlPlaneConfig(env);
  const service = createControlPlaneServer({ readinessChecks });

  service.server.requestTimeout = config.requestTimeoutMs;
  service.server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000);

  let address;
  try {
    address = await listen(service.server, config);
  } catch (error) {
    await service.close({ timeoutMs: config.shutdownTimeoutMs }).catch(() => {});
    throw error;
  }

  const runtime = {
    config,
    server: service.server,
    address: normalizeAddress(address, config),
    beginShutdown: service.beginShutdown,
    isShuttingDown: service.isShuttingDown,
    stop: () => service.close({ timeoutMs: config.shutdownTimeoutMs })
  };

  return Object.freeze(runtime);
}

/**
 * Connect SIGTERM/SIGINT to one idempotent graceful-stop request.
 *
 * signalSource is injectable so signal wiring can be tested without mutating the
 * real process object.
 */
export function installGracefulShutdown({
  runtime,
  signalSource = process,
  onError = () => {}
}) {
  if (!runtime || typeof runtime.stop !== "function") {
    throw new TypeError("Control-plane runtime must expose stop()");
  }
  if (!signalSource || typeof signalSource.once !== "function" || typeof signalSource.off !== "function") {
    throw new TypeError("Control-plane signal source must support once/off");
  }
  if (typeof onError !== "function") {
    throw new TypeError("Control-plane shutdown error handler must be a function");
  }

  let stopping = false;

  const requestStop = (signal) => {
    if (stopping) return;
    stopping = true;
    Promise.resolve(runtime.stop()).catch((error) => onError(error, signal));
  };

  const onSigterm = () => requestStop("SIGTERM");
  const onSigint = () => requestStop("SIGINT");

  signalSource.once("SIGTERM", onSigterm);
  signalSource.once("SIGINT", onSigint);

  return () => {
    signalSource.off("SIGTERM", onSigterm);
    signalSource.off("SIGINT", onSigint);
  };
}
