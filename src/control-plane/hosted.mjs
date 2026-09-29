import { createPostgresPool } from "./postgres/database.mjs";
import { createPostgresWebhookInboxStore } from "./postgres/webhook-inbox-store.mjs";
import { startControlPlane } from "./runtime.mjs";
import { createWebhookHttpHandler, webhookSecret } from "./webhook-http.mjs";

/** Production composition. Migrations are an explicit deployment step. */
export async function startHostedControlPlane({ env = process.env, poolFactory = createPostgresPool } = {}) {
  const secret = webhookSecret(env);
  const pool = poolFactory({ env });
  // Idle-client errors must not crash the process or log connection credentials.
  pool.on("error", () => {});
  const ready = async () => {
    // Resolve required columns, not just connectivity. Missing migrations fail closed.
    await pool.query("SELECT id, payload_bytes, state, version FROM repoops_webhook_inbox LIMIT 0");
    return true;
  };
  let runtime;
  try {
    await ready();
    runtime = await startControlPlane({
      env, readinessChecks: [ready],
      webhookHandler: createWebhookHttpHandler({ secret, store: createPostgresWebhookInboxStore({ pool }) })
    });
  } catch {
    await pool.end().catch(() => {});
    throw new Error("RepoOps hosted startup failed; check configuration, database and migrations");
  }
  let stopPromise;
  return Object.freeze({
    ...runtime,
    stop() {
      stopPromise ??= (async () => {
        try { return await runtime.stop(); }
        finally { await pool.end(); }
      })();
      return stopPromise;
    }
  });
}
