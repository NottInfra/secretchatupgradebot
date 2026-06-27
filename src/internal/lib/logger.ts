import { env } from "./env.js";

type Meta = Record<string, unknown> | undefined;
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function minLevelRank(raw: string): number {
  const level = raw.trim().toLowerCase() as Level;
  return LEVEL_RANK[level] ?? LEVEL_RANK.info;
}

export class Logger {
  private readonly minRank: number;

  constructor() {
    this.minRank = minLevelRank(env.LOG_LEVEL);
  }

  private shouldLog(level: Level): boolean {
    return LEVEL_RANK[level] >= this.minRank;
  }

  private log(level: Level, message: string, meta?: Meta): void {
    if (!this.shouldLog(level)) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  info(message: string, meta?: Meta): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Meta): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Meta): void {
    this.log("error", message, meta);
  }

  debug(message: string, meta?: Meta): void {
    this.log("debug", message, meta);
  }
}
