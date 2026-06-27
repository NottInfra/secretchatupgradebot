import {
  createSessionProvider,
  isAccessPending,
  type Service,
  type Session,
  type SessionProvider
} from "@sessionprovider/sdk";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { TdlibClient } from "../lib/telegram/tdlib-client.js";
import type { Logger } from "../lib/logger.js";
import { OwnerOnboardingService } from "./owner-onboarding-service.js";
import { connectOwnerTdlib } from "./owner-tdlib-connect.js";

export type OwnerSessionConfig = {
  userId: string;
  apiKey: string;
  url: string;
  svcName: string;
  sessionProviderRoot?: string;
  apiId: number;
  apiHash: string;
};

export class OwnerSessionService {
  private service?: Service;
  private readonly clients = new Map<string, TdlibClient>();
  private readonly connecting = new Map<string, Promise<TdlibClient | undefined>>();
  private readonly onboarding: OwnerOnboardingService;

  constructor(
    private readonly provider: SessionProvider,
    private readonly config: OwnerSessionConfig,
    private readonly notifications: IClientNotifications,
    private readonly logger: Logger
  ) {
    this.onboarding = new OwnerOnboardingService(
      provider,
      config.svcName,
      notifications,
      logger
    );
  }

  static create(
    config: OwnerSessionConfig,
    notifications: IClientNotifications,
    logger: Logger
  ): OwnerSessionService {
    const provider = createSessionProvider({
      userId: config.userId,
      apiKey: config.apiKey,
      url: config.url
    });
    return new OwnerSessionService(provider, config, notifications, logger);
  }

  async start(): Promise<void> {
    const { service } = await this.provider.createService(this.config.svcName);
    this.service = service;
    this.logger.info("session_provider_service_ready", { svcName: this.config.svcName });
  }

  async stop(): Promise<void> {
    for (const [accountId, client] of this.clients.entries()) {
      await client.close();
      this.logger.info("tdlib_session_stopped", { accountId });
      this.clients.delete(accountId);
    }
    await this.provider.close();
  }

  async getTdlibForOwner(ownerTelegramId: string, phone?: string): Promise<TdlibClient | undefined> {
    const session = await this.ensureOwnerSession(ownerTelegramId, phone);
    if (!session) return undefined;

    const client = await this.connectTdlib(session);
    if (client) return client;

    const phoneTrimmed = phone?.trim();
    if (!phoneTrimmed) return undefined;

    this.logger.info("owner_session_reonboarding", { ownerTelegramId, accountId: session.accountId });
    this.clients.delete(session.accountId);

    const onboarded = await this.onboarding.reonboardOwner(ownerTelegramId, phoneTrimmed);
    if (onboarded?.step !== "complete") return undefined;

    const service = await this.requireService();
    const freshSession = await this.grantSession(service, onboarded.accountId, ownerTelegramId);
    if (!freshSession) return undefined;

    return this.connectTdlib(freshSession);
  }

  async ensureOwnerSession(ownerTelegramId: string, phone?: string): Promise<Session | undefined> {
    const service = await this.requireService();
    const ownerId = ownerTelegramId.trim();
    const telegramId = Number(ownerId);
    if (!Number.isFinite(telegramId)) {
      this.logger.error("owner_session_invalid_telegram_id", { ownerTelegramId });
      return undefined;
    }

    const accountId = await this.resolveAccountId(service, ownerTelegramId, ownerId, telegramId, phone);
    if (!accountId) return undefined;

    return this.grantSession(service, accountId, ownerId);
  }

  private async resolveAccountId(
    service: Service,
    ownerTelegramId: string,
    ownerId: string,
    telegramId: number,
    phone?: string
  ): Promise<string | undefined> {
    const phoneTrimmed = phone?.trim();

    try {
      const account = await service.lookup(telegramId);
      const resolvedId = account.id?.trim();
      if (resolvedId) return resolvedId;
      return this.onboardAccountId(ownerId, phoneTrimmed, ownerTelegramId);
    } catch (error) {
      const message = String(error);
      if (message.includes("account_not_found") || message.includes("not_found")) {
        return this.onboardAccountId(ownerId, phoneTrimmed, ownerTelegramId);
      }
      this.logger.error("owner_session_lookup_failed", { ownerTelegramId, error: message });
      return undefined;
    }
  }

  private async onboardAccountId(
    ownerId: string,
    phone: string | undefined,
    ownerTelegramId: string
  ): Promise<string | undefined> {
    if (phone === undefined || phone.length === 0) {
      this.logger.info("owner_session_needs_phone", { ownerTelegramId });
      return undefined;
    }
    const onboarded = await this.onboarding.onboardOwner(ownerId, phone);
    if (onboarded?.step !== "complete") return undefined;
    return onboarded.accountId;
  }

  private async grantSession(
    service: Service,
    accountId: string,
    ownerTelegramId: string
  ): Promise<Session | undefined> {
    const account = await service.getAccount(accountId);
    const result = await account.getSession(this.config.svcName);

    if (isAccessPending(result)) {
      await this.onboarding.notifyAccessPending(ownerTelegramId, result);
      this.logger.warn("owner_session_access_pending", {
        ownerTelegramId,
        requestId: result.requestId
      });
      return undefined;
    }

    this.logger.info("owner_session_granted", {
      ownerTelegramId,
      accountId,
      sessionPath: result.sessionPath
    });
    return result;
  }

  private async connectTdlib(session: Session): Promise<TdlibClient | undefined> {
    const key = session.accountId;
    const cached = this.clients.get(key);
    if (cached) return cached;

    const inFlight = this.connecting.get(key);
    if (inFlight) return inFlight;

    const promise = this.openTdlib(session);
    this.connecting.set(key, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(key);
    }
  }

  private async openTdlib(session: Session): Promise<TdlibClient | undefined> {
    const client = await connectOwnerTdlib(session, this.config, this.logger);
    if (client) this.clients.set(session.accountId, client);
    return client;
  }

  private async requireService(): Promise<Service> {
    if (this.service) return this.service;
    const { service } = await this.provider.createService(this.config.svcName);
    this.service = service;
    return service;
  }
}
