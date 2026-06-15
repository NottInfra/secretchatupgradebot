import type { Agent } from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";

export function outboundProxyUrl(): string | undefined {
  const url =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();
  return url || undefined;
}

export function httpsAgentFromEnv(): Agent | undefined {
  const url = outboundProxyUrl();
  if (!url) return undefined;
  return new SocksProxyAgent(url);
}

/** GramJS SOCKS proxy — requires useWSS=false (see TelegramClient constructor). */
export function gramjsSocksProxyFromEnv():
  | { ip: string; port: number; socksType: 5 }
  | undefined {
  const url = outboundProxyUrl();
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
