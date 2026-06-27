/**
 * OpenTelemetry SDK bootstrap — export → mono otel-collector:4318
 */
import { logs, type Logger } from "@opentelemetry/api-logs";
import { metrics, type Counter } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { createRequire } from "node:module";
import { deploymentEnvironment, otlpEndpoint, otlpUrl } from "./config.js";

const require = createRequire(import.meta.url);
const pkg = require("../../../../package.json") as { name: string; version: string };

let sdk: NodeSDK | undefined;
let loggerProvider: LoggerProvider | undefined;
let analyticsCounter: Counter | undefined;
let analyticsLogger: Logger | undefined;

export function telemetryEnabled(): boolean {
  return Boolean(otlpEndpoint());
}

export async function initTelemetry(): Promise<void> {
  const endpoint = otlpEndpoint();
  if (!endpoint) return;

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || pkg.name;
  const env = deploymentEnvironment();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    "deployment.environment": env
  });

  loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(new OTLPLogExporter({ url: otlpUrl("/v1/logs") }))]
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  sdk = new NodeSDK({
    resource,
    autoDetectResources: false,
    traceExporter: new OTLPTraceExporter({ url: otlpUrl("/v1/traces") }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: otlpUrl("/v1/metrics") }),
      exportIntervalMillis: 60_000
    })
  });

  await sdk.start();

  const meter = metrics.getMeter(serviceName);
  analyticsCounter = meter.createCounter("analytics_events_total", {
    description: "Business analytics events"
  });
  analyticsLogger = logs.getLogger(`${serviceName}/analytics`, pkg.version);

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "telemetry_initialized",
      endpoint,
      serviceName,
      environment: env,
      analyticsLogs: true
    })
  );
}

export async function shutdownTelemetry(): Promise<void> {
  await loggerProvider?.shutdown();
  await sdk?.shutdown();
  loggerProvider = undefined;
  sdk = undefined;
  analyticsCounter = undefined;
  analyticsLogger = undefined;
}

export function getAnalyticsCounter(): Counter | undefined {
  return analyticsCounter;
}

export function getAnalyticsLogger(): Logger | undefined {
  return analyticsLogger;
}
