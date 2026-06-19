import { beforeEach, describe, expect, it, vi } from "vitest";

const poolConfigs: unknown[] = [];
const mockQuery = vi.fn(async () => ({ rows: [{ ok: true }] }));
const mockEnd = vi.fn(async () => undefined);

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor(config: unknown) {
      poolConfigs.push(config);
    }
    query = mockQuery;
    end = mockEnd;
  }
}));

const envState = {
  DATABASE_URL: "postgresql://user:pass@host.example/db?sslmode=require&channel_binding=require",
  DATABASE_SSL: true,
  DATABASE_USE_IAM: false,
  DATABASE_IAM_REGION: "",
  DATABASE_IAM_HOST: "",
  DATABASE_IAM_PORT: 5432,
  DATABASE_IAM_USER: "",
  DATABASE_IAM_DBNAME: ""
};

vi.mock("../env.js", () => ({
  get env() {
    return envState;
  }
}));

import { Database } from "./database.js";

describe("Database", () => {
  beforeEach(() => {
    poolConfigs.length = 0;
    mockQuery.mockClear();
    mockEnd.mockClear();
    envState.DATABASE_URL =
      "postgresql://user:pass@host.example/db?sslmode=require&channel_binding=require";
    envState.DATABASE_SSL = true;
    envState.DATABASE_USE_IAM = false;
  });

  it("strips channel_binding and sslmode when DATABASE_SSL is enabled", () => {
    const db = new Database();
    const config = poolConfigs[0] as { connectionString: string; ssl?: object };
    expect(config.connectionString).not.toContain("channel_binding");
    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(db.pool).toBeDefined();
  });

  it("keeps sslmode in the URL when DATABASE_SSL is disabled", () => {
    envState.DATABASE_SSL = false;
    new Database();
    const config = poolConfigs[0] as { connectionString: string; ssl?: object };
    expect(config.connectionString).toContain("sslmode=require");
    expect(config.ssl).toBeUndefined();
  });

  it("falls back to the raw connection string when the URL is invalid", () => {
    envState.DATABASE_URL = "not-a-valid-url";
    new Database();
    const config = poolConfigs[0] as { connectionString: string };
    expect(config.connectionString).toBe("not-a-valid-url");
  });

  it("queries and closes the pool", async () => {
    const db = new Database();
    const rows = await db.query("SELECT 1");
    expect(rows).toEqual([{ ok: true }]);
    await db.close();
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it("throws when DATABASE_URL is empty", () => {
    envState.DATABASE_URL = "   ";
    expect(() => new Database()).toThrow("DATABASE_URL is empty");
  });
});
