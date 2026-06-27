import {
  trace,
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Span,
  type Tracer
} from "@opentelemetry/api";
import { createRequire } from "node:module";
import { deploymentEnvironment } from "./config.js";
import { getAnalyticsCounter, getAnalyticsLogger } from "./init.js";
import { SeverityNumber } from "@opentelemetry/api-logs";

const require = createRequire(import.meta.url);
const pkg = require("../../../../package.json") as { name: string; version: string };

export function getTracer(name = pkg.name): Tracer {
  return trace.getTracer(name);
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

export async function withRootSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs?: Record<string, unknown>
): Promise<T> {
  return context.with(ROOT_CONTEXT, () => withSpan(tracer, name, fn, attrs));
}

function attrProps(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function recordAnalyticsMetric(name: string, props: Record<string, unknown>): void {
  const analyticsCounter = getAnalyticsCounter();
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

  const analyticsLogger = getAnalyticsLogger();
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
