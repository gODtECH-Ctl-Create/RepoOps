import { installGracefulShutdown } from "./runtime.mjs";
import { startHostedControlPlane } from "./hosted.mjs";

try {
  const runtime = await startHostedControlPlane();

  console.log(
    `RepoOps control plane listening on ${runtime.address.address}:${runtime.address.port} (${runtime.config.environment})`
  );

  installGracefulShutdown({
    runtime,
    onError(_error, signal) {
      console.error(`RepoOps control plane shutdown failed after ${signal}`);
      process.exitCode = 1;
    }
  });
} catch {
  console.error("RepoOps control plane failed to start; check configuration, database and migrations");
  process.exitCode = 1;
}
