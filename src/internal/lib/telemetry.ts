export { initTelemetry, shutdownTelemetry, telemetryEnabled } from "./telemetry/init.js";
export {
  getTracer,
  recordAnalyticsEvent,
  setSpanAttributes,
  withRootSpan,
  withSpan
} from "./telemetry/spans.js";
