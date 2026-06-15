/** MTProto (GramJS) SOCKS — Bot API (Telegraf) uses direct egress; Telegram blocks many Tor exits. */

export function mtprotoSocksUrl(): string | undefined {
  const url = process.env.TELEGRAM_SOCKS_PROXY?.trim();
  return url || undefined;
}

/** GramJS SOCKS proxy — requires useWSS=false (see TelegramClient constructor). */
export function gramjsSocksProxyFromEnv():
  | { ip: string; port: number; socksType: 5 }
  | undefined {
  const url = mtprotoSocksUrl();
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
