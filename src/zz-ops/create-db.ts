import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  const answer = await rl.question("Apply DB schema to which env? (development/live/test) [development]: ");
  rl.close();
  const selected = (answer.trim() || "development").toLowerCase();
  const normalized = selected === "live" ? "production" : selected;
  if (!["development", "test", "production"].includes(normalized)) {
    throw new Error("invalid environment; expected development, live, or test");
  }

  process.env.NODE_ENV = normalized;
  const { initEnv } = await import("../utils/env.js");
  const env = await initEnv();
  const { Logger } = await import("../utils/logger.js");
  const { Database } = await import("../utils/db/database.js");
  const logger = new Logger();

  const sqlPath = path.resolve("assets/db.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const db = new Database();
  await db.query(sql);
  await db.close();

  logger.info("ops_create_db_ok", { environment: normalized, databaseUrl: "***", sqlPath, nodeEnv: env.NODE_ENV });
}

try {
  await main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
