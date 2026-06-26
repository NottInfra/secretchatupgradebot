import {
  createSessionProvider,
  type AccessPending,
  type OnboardingStep,
  type Service,
  type Session,
  type SessionProvider
} from "@sessionprovider/sdk";
import { messageFromOwnerNotification } from "./owner-notification.js";
import type { ClientNotificationService } from "../client-notification-service.js";
import { createTdlibClient, type TdlibClient } from "../telegram/tdlib-client.js";
import { materializeSessionFiles } from "../telegram/session-files.js";
import type { Logger } from "../../utils/logger.js";

const ONBOARDING_POLL_MS = 2000;
const ONBOARDING_TIMEOUT_MS = 15 * 60_000;

export type OwnerSessionConfig = {
  userId: string;
  apiKey: string;
  url: string;
  svcName: string;
  sessionProviderRoot?: string;
  apiId: number;
  apiHash: string;
};

function isAccessPending(value: unknown): value is AccessPending {
  return Boolean(value && typeof value === "object" && "pending" in value);
}

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return Boolean(value && typeof value === "object" && "step" in value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OwnerSessionService {
  private service?: Service;
  private readonly clients = new Map<string, TdlibClient>();
  private readonly connecting = new Map<string, Promise<TdlibClient | undefined>>();

  constructor(
    private readonly provider: SessionProvider,
    private readonly config: OwnerSessionConfig,
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  static create(
    config: OwnerSessionConfig,
    notifications: ClientNotificationService,
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

  /** Resolve TDLib client for owner — onboard via sessionprovider when missing. */
  async getTdlibForOwner(ownerTelegramId: string, phone?: string): Promise<TdlibClient | undefined> {
    const session = await this.ensureOwnerSession(ownerTelegramId, phone);
    if (!session) return undefined;

    const client = await this.connectTdlib(session);
    if (client) return client;

    const phoneTrimmed = phone?.trim();
    if (!phoneTrimmed) return undefined;

    this.logger.info("owner_session_reonboarding", { ownerTelegramId, accountId: session.accountId });
    this.clients.delete(session.accountId);

    const onboarded = await this.onboardOwner(ownerTelegramId, phoneTrimmed);
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
    const onboarded = await this.onboardOwner(ownerId, phone);
    if (onboarded?.step !== "complete") return undefined;
    return onboarded.accountId;
  }

  private async grantSession(service: Service, accountId: string, ownerTelegramId: string): Promise<Session | undefined> {
    const account = await service.getAccount(accountId);
    const result = await account.getSession(this.config.svcName);

    if (isAccessPending(result)) {
      await this.notifyAccessPending(ownerTelegramId, result);
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

  private async onboardOwner(
    ownerTelegramId: string,
    phone: string
  ): Promise<Extract<OnboardingStep, { step: "complete" }> | undefined> {
    const notifyTarget = ownerTelegramId;
    let step = await this.provider.request<OnboardingStep>("onboard.start", {
      phone,
      svcName: this.config.svcName,
      notifyTarget
    });

    if (!isOnboardingStep(step)) {
      this.logger.error("owner_onboard_invalid_step", { ownerTelegramId });
      return undefined;
    }

    if (step.step === "complete") {
      this.logger.info("owner_onboard_already_complete", {
        ownerTelegramId,
        accountId: step.accountId
      });
      return step;
    }

    const deadline = Date.now() + ONBOARDING_TIMEOUT_MS;
    let lastPhase: OnboardingStep["step"] | undefined;

    while (step.step !== "complete") {
      if (step.step !== lastPhase) {
        await this.notifyOnboardingStep(ownerTelegramId, step);
        lastPhase = step.step;
      }

      if (Date.now() >= deadline) {
        this.logger.error("owner_onboard_timeout", { ownerTelegramId, onboardingId: step.onboardingId });
        return undefined;
      }

      await sleep(ONBOARDING_POLL_MS);
      step = await this.provider.request<OnboardingStep>("onboard.status", {
        onboardingId: step.onboardingId
      });
    }

    this.logger.info("owner_onboard_complete", { ownerTelegramId, accountId: step.accountId });
    await this.notifications.sendToClient(
      ownerTelegramId,
      "Telegram session connected. We can now block contacts on your account when needed."
    );
    return step;
  }

  private async notifyOnboardingStep(ownerTelegramId: string, step: OnboardingStep): Promise<void> {
    if (step.step === "complete") return;

    if (step.ownerNotification) {
      const message = messageFromOwnerNotification(step.ownerNotification);
      await this.notifications.sendToClient(String(message.notifyTarget), message.text);
      return;
    }

    if (step.authUrl) {
      const prompt =
        step.step === "password"
          ? "Open this link to enter your Telegram 2FA password:"
          : "Open this link to enter your Telegram login code:";
      await this.notifications.sendToClient(ownerTelegramId, `${prompt}\n${step.authUrl}`);
    }
  }

  private async notifyAccessPending(ownerTelegramId: string, pending: AccessPending): Promise<void> {
    if (!pending.ownerNotification) {
      await this.notifications.sendToClient(
        ownerTelegramId,
        "Session access needs your approval in Telegram before we can block contacts."
      );
      return;
    }

    const message = messageFromOwnerNotification(pending.ownerNotification);
    const approve = message.replyMarkup?.inline_keyboard[0]?.find((b) => /approve/i.test(b.text));
    if (approve) {
      await this.notifications.sendHTMLWithInlineButton(
        ownerTelegramId,
        message.text,
        approve.text,
        approve.callback_data
      );
      return;
    }
    await this.notifications.sendToClient(ownerTelegramId, message.text);
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
    let sessionDirs: { databaseDirectory: string; filesDirectory: string } | undefined;
    if (session.files && Object.keys(session.files).length > 0) {
      sessionDirs = materializeSessionFiles(session, this.config.sessionProviderRoot);
      this.logger.info("tdlib_session_files_materialized", {
        accountId: session.accountId,
        fileCount: Object.keys(session.files).length
      });
    }

    const client = createTdlibClient({
      sessionPath: session.sessionPath,
      sessionProviderRoot: this.config.sessionProviderRoot,
      sessionDirs,
      apiId: this.config.apiId,
      apiHash: this.config.apiHash,
      logger: this.logger
    });

    const notAuthorized = () =>
      new Error(`session_not_authorized accountId=${session.accountId}`);

    try {
      await client.login({
        type: "user",
        getPhoneNumber: async () => {
          throw notAuthorized();
        },
        getAuthCode: async () => {
          throw notAuthorized();
        },
        getPassword: async () => {
          throw notAuthorized();
        }
      });
      this.clients.set(session.accountId, client);
      this.logger.info("tdlib_session_connected", {
        accountId: session.accountId,
        sessionPath: session.sessionPath
      });
      return client;
    } catch (error) {
      this.logger.error("tdlib_session_connect_failed", {
        accountId: session.accountId,
        error: String(error)
      });
      try {
        await client.close();
      } catch {
        // ignore cleanup errors
      }
      return undefined;
    }
  }

  private async requireService(): Promise<Service> {
    if (this.service) return this.service;
    const { service } = await this.provider.createService(this.config.svcName);
    this.service = service;
    return service;
  }
}
