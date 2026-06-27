import { describe, expect, it } from "vitest";
import { telemetryEnabled } from "./telemetry.js";

describe("telemetry barrel", () => {
  it("reports disabled telemetry without OTLP endpoint", () => {
    const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(telemetryEnabled()).toBe(false);
    if (previous) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
  });
});
