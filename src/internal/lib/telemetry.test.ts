import { describe, expect, it } from "vitest";
import { deploymentEnvironment, otlpEndpoint, otlpUrl } from "./telemetry/config.js";
import { telemetryEnabled } from "./telemetry.js";

describe("telemetry config", () => {
  it("builds otlp urls from the configured endpoint", () => {
    const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.example/";
    expect(otlpEndpoint()).toBe("https://otel.example");
    expect(otlpUrl("/v1/traces")).toBe("https://otel.example/v1/traces");
    if (previous) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
    else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it("defaults deployment environment to development", () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    expect(deploymentEnvironment()).toBe("development");
    if (previous) process.env.NODE_ENV = previous;
  });
});

describe("telemetry barrel", () => {
  it("reports disabled telemetry without OTLP endpoint", () => {
    const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(telemetryEnabled()).toBe(false);
    if (previous) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
  });
});
