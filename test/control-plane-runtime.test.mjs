import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer as createNetServer } from "node:net";

import { ControlPlaneConfigError } from "../src/control-plane/config.mjs";
import { installGracefulShutdown, startControlPlane } from "../src/control-plane/runtime.mjs";

async function availablePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("hosted control plane starts independently from GitHub Actions context", async () => {
  const port = await availablePort();
  const runtime = await startControlPlane({
    env: {
      REPOOPS_ENV: "test",
      REPOOPS_HOST: "127.0.0.1",
      REPOOPS_PORT: String(port),
      REPOOPS_SHUTDOWN_TIMEOUT_MS: "1000",
      REPOOPS_REQUEST_TIMEOUT_MS: "5000"
    }
  });

  try {
    assert.equal(runtime.server.listening, true);
    assert.equal(runtime.address.port, port);
    assert.equal(runtime.config.environment, "test");
    assert.equal(runtime.server.requestTimeout, 5_000);
    assert.equal(runtime.server.headersTimeout, 5_000);
  } finally {
    await runtime.stop();
  }

  assert.equal(runtime.server.listening, false);
  assert.equal(runtime.isShuttingDown(), true);
});

test("invalid runtime configuration fails before opening a listener", async () => {
  await assert.rejects(
    () => startControlPlane({ env: { REPOOPS_PORT: "not-a-port" } }),
    ControlPlaneConfigError
  );
});

test("signal wiring requests graceful stop exactly once", async () => {
  const signalSource = new EventEmitter();
  let stopCalls = 0;
  let resolveStopped;
  const stopped = new Promise((resolve) => { resolveStopped = resolve; });

  const runtime = {
    async stop() {
      stopCalls += 1;
      resolveStopped();
    }
  };

  const detach = installGracefulShutdown({ runtime, signalSource });
  signalSource.emit("SIGTERM");
  signalSource.emit("SIGINT");
  await stopped;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stopCalls, 1);
  detach();
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
});

test("signal shutdown errors are routed to the supplied safe error handler", async () => {
  const signalSource = new EventEmitter();
  let observed = null;
  let resolveObserved;
  const handled = new Promise((resolve) => { resolveObserved = resolve; });

  const detach = installGracefulShutdown({
    runtime: {
      async stop() {
        throw new Error("shutdown failed");
      }
    },
    signalSource,
    onError(error, signal) {
      observed = { message: error.message, signal };
      resolveObserved();
    }
  });

  signalSource.emit("SIGINT");
  await handled;
  assert.deepEqual(observed, { message: "shutdown failed", signal: "SIGINT" });
  detach();
});

test("signal wiring validates injected lifecycle boundaries", () => {
  assert.throws(() => installGracefulShutdown({ runtime: {} }), TypeError);
  assert.throws(
    () => installGracefulShutdown({ runtime: { stop() {} }, signalSource: {} }),
    TypeError
  );
  assert.throws(
    () => installGracefulShutdown({ runtime: { stop() {} }, onError: "not-a-function" }),
    TypeError
  );
});
