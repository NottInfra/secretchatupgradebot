import { Pool, type PoolConfig, type QueryResultRow } from "pg";
import { env } from "../env.js";

/** node-pg pool `ssl` option — channel_binding in the URL often breaks Neon connects. */
function poolConfigFromDatabaseUrl(raw: string): Pick<PoolConfig, "connectionString" | "ssl"> {
  const fallbackSsl: PoolConfig["ssl"] = env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined;
  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    const sslMode = url.searchParams.get("sslmode")?.trim().toLowerCase() ?? null;

    // Explicit disable in the URL wins over DATABASE_SSL (e.g. mono postgres on docker network).
    if (sslMode === "disable") {
      return { connectionString: url.toString(), ssl: false };
    }

    const urlRequestsSsl =
      sslMode === "require" ||
      sslMode === "verify-full" ||
      sslMode === "verify-ca" ||
      sslMode === "prefer";

    if (env.DATABASE_SSL || urlRequestsSsl) {
      if (env.DATABASE_SSL) {
        url.searchParams.delete("sslmode");
      }
      return {
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: false }
      };
    }

    return { connectionString: url.toString(), ssl: undefined };
  } catch {
    return { connectionString: raw, ssl: fallbackSsl };
  }
}

export class Database {
  readonly pool: Pool;

  constructor() {
    if (!env.DATABASE_URL.trim()) {
      throw new Error("DATABASE_URL is empty");
    }

    this.pool = new Pool(poolConfigFromDatabaseUrl(env.DATABASE_URL));
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
