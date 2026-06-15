import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import type { StringSession } from "telegram/sessions/index.js";
import type { Logger } from "../../utils/logger.js";

export type GramjsClientParams = {
  connectionRetries?: number;
  useWSS?: boolean;
};

const PING_TIMEOUT_LOG_INTERVAL_MS = 60_000;

/** GramJS SOCKS proxy — requires useWSS=false (see TelegramClient constructor). */
function gramjsSocksProxyFromEnv():
  | { ip: string; port: number; socksType: 5 }
  | undefined {
  const url = process.env.TELEGRAM_SOCKS_PROXY?.trim();
  if (!url) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "socks5:" && parsed.protocol !== "socks5h:") {
    return undefined;
  }
  return {
    ip: parsed.hostname,
    port: Number(parsed.port || 9050),
    socksType: 5
  };
}

export function isGramjsPingTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === "TIMEOUT";
}

/** Route GramJS internal errors through our logger and suppress ping TIMEOUT console spam. */
export function attachGramjsGuards(
  client: TelegramClient,
  options: { sessionId?: string; logger?: Logger }
): void {
  client.setLogLevel(LogLevel.NONE);

  let lastPingTimeoutLogAt = 0;

  client.onError = async (error: Error) => {
    if (isGramjsPingTimeout(error)) {
      const now = Date.now();
      if (now - lastPingTimeoutLogAt >= PING_TIMEOUT_LOG_INTERVAL_MS) {
        lastPingTimeoutLogAt = now;
        options.logger?.warn("mtproto_ping_timeout", {
          sessionId: options.sessionId,
          note: "gramjs keepalive ping timed out; reconnect is automatic"
        });
      }
      return;
    }

    options.logger?.error("mtproto_client_error", {
      sessionId: options.sessionId,
      error: String(error)
    });
  };
}

export function createTelegramClient(
  session: StringSession,
  apiId: number,
  apiHash: string,
  params: GramjsClientParams,
  options?: { sessionId?: string; logger?: Logger }
): TelegramClient {
  const proxy = gramjsSocksProxyFromEnv();
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: params.connectionRetries ?? 5,
    useWSS: proxy ? false : (params.useWSS ?? true),
    proxy
  });
  attachGramjsGuards(client, options ?? {});
  return client;
}
