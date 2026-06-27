import process from "node:process";
import { getTracer, shutdownTelemetry, withSpan } from "../lib/telemetry.js";
import type { AppRuntime } from "./app-runtime.js";

const appTracer = getTracer("app");

function registerShutdownHandlers(runtime: AppRuntime): void {
  const shutdown = async () => {
    await withSpan(appTracer, "app.shutdown", async () => {
      runtime.logger.info("shutdown_requested");
      await runtime.botService.stop();
      await runtime.ownerSessions.stop();
      await runtime.store.close();
      await shutdownTelemetry();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startApp(runtime: AppRuntime): Promise<void> {
  await withSpan(appTracer, "app.start_mgmt_bot", async () => runtime.botService.start());
  registerShutdownHandlers(runtime);
}
