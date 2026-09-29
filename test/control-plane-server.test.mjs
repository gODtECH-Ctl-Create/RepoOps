import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

import { createControlPlaneServer } from "../src/control-plane/server.mjs";

async function listen(service) {
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    service.server.once("error", onError);
    service.server.listen(0, "127.0.0.1", () => {
      service.server.off("error", onError);
      resolve();
    });
  });
  return service.server.address().port;
}

function call(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      method,
      agent: false
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("control-plane exposes deterministic health, readiness, method and 404 responses", async (t) => {
  const service = createControlPlaneServer();
  const port = await listen(service);
  t.after(() => service.close({ timeoutMs: 1_000 }));

  const health = await call(port, "/healthz");
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { status: "ok" });
  assert.equal(health.headers["cache-control"], "no-store");

  const ready = await call(port, "/readyz");
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), { status: "ready" });

  const method = await call(port, "/healthz", "POST");
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET");
  assert.deepEqual(JSON.parse(method.body), { error: "method-not-allowed" });

  const missing = await call(port, "/does-not-exist");
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(JSON.parse(missing.body), { error: "not-found" });
});

test("readiness checks fail closed without exposing dependency errors", async (t) => {
  const service = createControlPlaneServer({
    readinessChecks: [
      () => true,
      async () => {
        throw new Error("database-password-should-never-appear");
      }
    ]
  });
  const port = await listen(service);
  t.after(() => service.close({ timeoutMs: 1_000 }));

  const response = await call(port, "/readyz");
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { status: "not-ready" });
  assert.equal(response.body.includes("database-password"), false);
});

test("readiness accepts explicit ready objects for future dependency checks", async (t) => {
  const service = createControlPlaneServer({ readinessChecks: [async () => ({ ready: true })] });
  const port = await listen(service);
  t.after(() => service.close({ timeoutMs: 1_000 }));

  assert.equal((await call(port, "/readyz")).statusCode, 200);
});

test("beginShutdown removes readiness while keeping liveness until the listener closes", async () => {
  const service = createControlPlaneServer();
  const port = await listen(service);

  assert.equal(service.beginShutdown(), true);
  assert.equal(service.beginShutdown(), false);
  assert.equal(service.isShuttingDown(), true);

  const ready = await call(port, "/readyz");
  assert.equal(ready.statusCode, 503);
  const health = await call(port, "/healthz");
  assert.equal(health.statusCode, 200);

  const firstClose = service.close({ timeoutMs: 1_000 });
  const secondClose = service.close({ timeoutMs: 1_000 });
  assert.equal(firstClose, secondClose);
  assert.deepEqual(await firstClose, { forced: false });
  assert.equal(service.server.listening, false);
});

test("invalid readiness-check and shutdown configuration fails before unsafe behavior", async () => {
  assert.throws(
    () => createControlPlaneServer({ readinessChecks: ["not-a-function"] }),
    TypeError
  );

  const service = createControlPlaneServer();
  await assert.rejects(() => service.close({ timeoutMs: 0 }), TypeError);
});
