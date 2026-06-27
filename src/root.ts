import process from "node:process";
import { createApp } from "./internal/app/create-app.js";
import { startApp } from "./internal/app/start-app.js";
import { initEnv } from "./internal/lib/env.js";
import { getTracer, initTelemetry, withSpan } from "./internal/lib/telemetry.js";

const appTracer = getTracer("app");

try {
  const env = await withSpan(appTracer, "app.init_env", async () => initEnv());
  await withSpan(appTracer, "app.init_telemetry", async () => initTelemetry());

  const runtime = await withSpan(appTracer, "app.create", async () => createApp(env));
  await startApp(runtime);
} catch (error) {
  console.error("[!] startup failed:", error);
  process.exit(1);
}
