/**
 * OpenTelemetry export → mono otel-collector:4318
 *   traces  → Tempo (Grafana)
 *   metrics → Mimir (Prometheus remote write)
 *   analytics logs → Elasticsearch (secretchatonly-bot-analytics data stream)
 *
 * App ops logs: stdout JSON → Filebeat → ELK (see docs/telemetry/logging.md).
 */
import { logs, SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import {
  metrics,
  trace,
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Counter,
  type Meter,
  type Span,
  type Tracer
} from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
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
let loggerProvider: LoggerProvider | undefined;
let analyticsCounter: Counter | undefined;
let analyticsLogger: Logger | undefined;

function otlpEndpoint(): string | undefined {
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return undefined;
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}

function otlpUrl(path: string): string {
  const base = otlpEndpoint() ?? "";
  return `${base}${path}`;
}

function deploymentEnvironment(): string {
  return process.env.NODE_ENV?.trim() || "development";
}

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
    processors: [
      new SimpleLogRecordProcessor(new OTLPLogExporter({ url: otlpUrl("/v1/logs") }))
    ]
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

/** Start a new trace root — use for long-poll / webhook handlers that must not inherit startup context. */
export async function withRootSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs?: Record<string, unknown>
): Promise<T> {
  return context.with(ROOT_CONTEXT, () => withSpan(tracer, name, fn, attrs));
}

export function recordAnalyticsMetric(name: string, props: Record<string, unknown>): void {
  if (!analyticsCounter) return;
  analyticsCounter.add(1, { event: name, ...attrProps(props) });
}

export function recordAnalyticsEvent(name: string, props: Record<string, unknown>): void {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();
  const traceProps =
    spanContext && trace.isSpanContextValid(spanContext)
      ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
      : {};

  const enriched = { ...props, ...traceProps };
  recordAnalyticsMetric(name, enriched);
  if (!analyticsLogger) return;

  analyticsLogger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: name,
    attributes: {
      event: name,
      "deployment.environment": deploymentEnvironment(),
      ...attrProps(enriched)
    }
  });
}
