import type { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { SessionRepository } from "../repositories/session-repository.js";
import { createTelegramClient } from "../utils/gramjs-client.js";
import type { Logger } from "../utils/logger.js";

/** Lazy GramJS connections for block/onboarding auth — no always-on NewMessage listeners. */
export class MtprotoSessionService {
  private readonly clients = new Map<string, TelegramClient>();
  private readonly connecting = new Map<string, Promise<TelegramClient | undefined>>();

  constructor(
    private readonly sessions: SessionRepository,
    private readonly apiId: number,
    private readonly apiHash: string,
    private readonly useWss: boolean,
    private readonly connectTimeoutMs: number,
    private readonly logger: Logger
  ) {}

  private async connectWithTimeout(client: TelegramClient, sessionId: string): Promise<void> {
    const timeoutMs = this.connectTimeoutMs;
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`mtproto_connect_timeout sessionId=${sessionId} timeoutMs=${timeoutMs}`));
        }, timeoutMs);
      })
    ]);
  }

  /** Load session from DB and connect without binding update handlers. */
  async getClientForBlock(sessionId: string): Promise<TelegramClient | undefined> {
    const cached = this.clients.get(sessionId);
    if (cached && !cached.disconnected) return cached;

    const inFlight = this.connecting.get(sessionId);
    if (inFlight) return inFlight;

    const promise = this.connectSession(sessionId);
    this.connecting.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(sessionId);
    }
  }

  private async connectSession(sessionId: string): Promise<TelegramClient | undefined> {
    const record = await this.sessions.findByUserId(sessionId);
    if (!record?.active || !record.sessionString.trim()) {
      this.logger.warn("mtproto_session_unavailable", { sessionId });
      return undefined;
    }

    const session = new StringSession(record.sessionString);
    const client = createTelegramClient(
      session,
      this.apiId,
      this.apiHash,
      { connectionRetries: 5, useWSS: this.useWss },
      { sessionId, logger: this.logger }
    );

    try {
      await this.connectWithTimeout(client, sessionId);
      this.clients.set(sessionId, client);
      this.logger.info("mtproto_session_connected", { sessionId, mode: "lazy_block" });
      return client;
    } catch (error) {
      this.logger.error("mtproto_session_connect_failed", { sessionId, error: String(error) });
      try {
        await client.disconnect();
      } catch {
        // ignore cleanup errors
      }
      return undefined;
    }
  }

  async stop(): Promise<void> {
    for (const [sessionId, client] of this.clients.entries()) {
      await client.disconnect();
      this.logger.info("mtproto_session_stopped", { sessionId });
      this.clients.delete(sessionId);
    }
  }
}
