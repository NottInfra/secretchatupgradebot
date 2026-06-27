export function otlpEndpoint(): string | undefined {
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return undefined;
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}

export function otlpUrl(path: string): string {
  const base = otlpEndpoint() ?? "";
  return `${base}${path}`;
}

export function deploymentEnvironment(): string {
  return process.env.NODE_ENV?.trim() || "development";
}
