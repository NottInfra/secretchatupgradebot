/**
 * OpenTelemetry export → mono otel-collector:4318
 *   traces  → Tempo (Grafana)
 *   metrics → Mimir (Prometheus remote write)
 *
 * App logs: stdout JSON → Filebeat → ELK (see docs/telemetry/logging.md).
 */
import {
  metrics,
  trace,
  SpanStatusCode,
  type Counter,
  type Meter,
  type Span,
  type Tracer
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION
} from "@opentelemetry/semantic-conventions";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name: string; version: string };

let sdk: NodeSDK | undefined;
let analyticsCounter: Counter | undefined;

function otlpEndpoint(): string | undefined {
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return undefined;
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}

function otlpUrl(path: string): string {
  const base = otlpEndpoint() ?? "";
  return `${base}${path}`;
}

export function telemetryEnabled(): boolean {
  return Boolean(otlpEndpoint());
}

export async function initTelemetry(): Promise<void> {
  const endpoint = otlpEndpoint();
  if (!endpoint) return;

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || pkg.name;
  const env = process.env.NODE_ENV?.trim() || "development";

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    "deployment.environment": env
  });

  sdk = new NodeSDK({
    resource,
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

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "telemetry_initialized",
      endpoint,
      serviceName,
      environment: env
    })
  );
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
  analyticsCounter = undefined;
}

export function getTracer(name = pkg.name): Tracer {
  return trace.getTracer(name);
}

export function getMeter(name = pkg.name): Meter {
  return metrics.getMeter(name);
}

/** Flatten props for OTEL attributes (string values only). */
function attrProps(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export function setSpanAttributes(span: Span, attrs: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      span.setAttribute(k, v);
    } else {
      span.setAttribute(k, JSON.stringify(v));
    }
  }
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs?: Record<string, unknown>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attrs) setSpanAttributes(span, attrs);
    try {
      return await fn(span);
    } catch (error) {
      if (error instanceof Error) span.recordException(error);
      else span.recordException(new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function recordAnalyticsMetric(name: string, props: Record<string, unknown>): void {
  if (!analyticsCounter) return;
  const deployment_environment = process.env.NODE_ENV?.trim() || "development";
  analyticsCounter.add(1, { event: name, deployment_environment, ...attrProps(props) });
}

export function recordAnalyticsEvent(name: string, props: Record<string, unknown>): void {
  recordAnalyticsMetric(name, props);
}
