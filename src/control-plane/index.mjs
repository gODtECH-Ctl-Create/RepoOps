import { installGracefulShutdown, startControlPlane } from "./runtime.mjs";

function safeMessage(error) {
  return error instanceof Error && error.message ? error.message : "unknown error";
}

try {
  const runtime = await startControlPlane();

  console.log(
    `RepoOps control plane listening on ${runtime.address.address}:${runtime.address.port} (${runtime.config.environment})`
  );

  installGracefulShutdown({
    runtime,
    onError(error, signal) {
      console.error(`RepoOps control plane shutdown failed after ${signal}: ${safeMessage(error)}`);
      process.exitCode = 1;
    }
  });
} catch (error) {
  console.error(`RepoOps control plane failed to start: ${safeMessage(error)}`);
  process.exitCode = 1;
}
