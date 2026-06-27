/** Serialize errors for structured logs (AggregateError, nested causes). */
export function formatError(error: unknown): string {
  if (error instanceof AggregateError) {
    const nested = error.errors.map((e) => formatError(e)).join("; ");
    return nested.length > 0 ? `${error.message}: ${nested}` : error.message;
  }
  if (error instanceof Error) {
    const cause =
      error.cause === undefined ? "" : ` cause=${formatError(error.cause)}`;
    return `${error.message}${cause}`;
  }
  return String(error);
}
