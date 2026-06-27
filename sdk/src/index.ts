import { runOnboardingInteractive, type OnboardPrompter } from "./onboard-interactive.js";
import WebSocket from "ws";
import type {
  AccessPending,
  Account,
  OnboardingStep,
  PoolView,
  ServiceView,
  Session
} from "./types.js";

export type {
  AccessPending,
  Account,
  OnboardingStep,
  PoolView,
  ServiceView,
  Session
} from "./types.js";

export type { OnboardPrompter } from "./onboard-interactive.js";

export type SessionProviderOptions = {
  /** Authenticated developer_svc.id — sent on every WebSocket request. */
  userId: string;
  /** developer_svc.api_key — sent on every WebSocket request. */
  apiKey: string;
  /** WebSocket URL. Defaults to `ws://localhost:3000`. */
  url?: string;
  /** Default pool eligibility for `onboardAccount`. Defaults to `false`. */
  pool?: boolean;
};

export type CreateSessionParams = {
  /** Service name registered under your developer (via createService). */
  svcName: string;
  /** Session label. Defaults to svcName. */
  sessionName?: string;
  /** Telegram @username (with or without @). */
  username?: string;
  /** Telegram account id (same as telegram user id). */
  accountId?: string;
};

export type OnboardAccountOptions = {
  /** Mark the account as pool-eligible. Defaults to false. */
  pool?: boolean;
};

export type StartOnboardingParams = {
  phone: string;
  svcName?: string;
  notifyTarget?: string;
  pool?: boolean;
  /** Clear stale TDLib files and run a fresh Telegram login for an existing account. */
  forceReauth?: boolean;
};

const DEFAULT_WS_URL = "ws://localhost:3000";

export type CreateServiceResult = ServiceView & {
  service: Service;
  developerName: string;
  existing: boolean;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function isAccessPending(value: unknown): value is AccessPending {
  return Boolean(value && typeof value === "object" && "pending" in value);
}

function lookupPayload(query: string | number): Record<string, unknown> {
  if (typeof query === "number") return { telegramId: query };
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) return { accountId: trimmed };
  return { username: trimmed };
}

export class AccountHandle {
  constructor(
    private readonly service: Service,
    readonly data: Account
  ) {}

  get id(): string {
    return this.data.id;
  }

  get username(): string {
    return this.data.username;
  }

  listSessions(): Session[] {
    return this.data.sessions;
  }

  async getSession(sessionName: string): Promise<Session | AccessPending> {
    const result = await this.service.request<Session | AccessPending>("account.getSession", {
      accountId: this.data.id,
      sessionName
    });
    if (isAccessPending(result)) {
      return result;
    }
    const session = result;
    this.upsertSession(session);
    return session;
  }

  private upsertSession(session: Session): void {
    const idx = this.data.sessions.findIndex((s) => s.name === session.name);
    if (idx >= 0) this.data.sessions[idx] = session;
    else this.data.sessions.push(session);
  }
}

export class PoolHandle {
  private _view: PoolView;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly service: Service,
    readonly name: string,
    view: PoolView
  ) {
    this._view = view;
    this.unsubscribe = this.service.watchPool(this.name, (pool) => {
      this._view = pool;
    });
  }

  get accounts(): AccountHandle[] {
    return this._view.accounts.map((a) => new AccountHandle(this.service, a));
  }

  async addAccount(): Promise<AccountHandle> {
    const account = await this.service.request<Account>("pool.addAccount", {
      poolName: this.name
    });
    return new AccountHandle(this.service, account);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

export class Service {
  constructor(
    private readonly provider: SessionProvider,
    readonly svcName: string
  ) {}

  async request<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    return this.provider.request<T>(type, { svcName: this.svcName, ...payload });
  }

  async lookup(query: string | number): Promise<AccountHandle> {
    const account = await this.request<Account>("lookup", lookupPayload(query));
    return new AccountHandle(this, account);
  }

  async getAccount(accountId: string): Promise<AccountHandle> {
    const account = await this.request<Account>("account.get", { accountId });
    return new AccountHandle(this, account);
  }

  async getPool(name: string): Promise<PoolHandle> {
    const view = await this.request<PoolView>("pool.get", { name });
    return new PoolHandle(this, name, view);
  }

  watchPool(poolName: string, onUpdate: (view: PoolView) => void): () => void {
    return this.provider.watchPool(this.svcName, poolName, onUpdate);
  }

  async respondAccessCallback(callbackData: string): Promise<void> {
    await this.request("access.callback", { callbackData });
  }
}

export class SessionProvider {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly poolWatchers = new Map<string, Set<(view: PoolView) => void>>();
  private connectPromise?: Promise<void>;

  constructor(private readonly options: SessionProviderOptions) {}

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url ?? DEFAULT_WS_URL);
      this.ws.on("open", () => resolve());
      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as {
          id?: string;
          type: string;
          payload?: Record<string, unknown>;
          error?: string;
        };

        if (msg.type === "pool.updated" && msg.payload) {
          this.dispatchPoolUpdate(
            msg.payload as { svcName: string; name: string; pool: PoolView }
          );
          return;
        }

        if (!msg.id) return;
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        if (msg.error || msg.type === "error") {
          pending.reject(new Error(msg.error ?? "request_failed"));
          return;
        }
        if (msg.type === "session") {
          pending.resolve((msg.payload as { session: Session }).session);
          return;
        }
        if (msg.type === "access.pending") {
          pending.resolve({
            pending: true,
            requestId: (msg.payload as { requestId: string }).requestId
          });
          return;
        }
        if (msg.type === "account") {
          pending.resolve((msg.payload as { account: Account }).account);
          return;
        }
        if (msg.type === "auth.ok" || msg.type === "service.ok" || msg.type === "service.existing") {
          pending.resolve(msg.payload ?? true);
          return;
        }
        if (msg.type === "access.callback.ok") {
          pending.resolve(msg.payload ?? true);
          return;
        }
        if (msg.type === "onboarding") {
          pending.resolve(msg.payload);
          return;
        }
        pending.resolve(msg.payload);
      });

      this.ws.on("error", (err) => reject(err));
      this.ws.on("close", () => {
        this.connectPromise = undefined;
      });
    });

    return this.connectPromise;
  }

  private async auth(): Promise<void> {
    await this.request("auth", {
      userId: this.options.userId,
      apiKey: this.options.apiKey
    });
  }

  async request<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    await this.connect();
    const id = String(this.nextId++);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, type, payload }));
    });
  }

  watchPool(svcName: string, poolName: string, onUpdate: (view: PoolView) => void): () => void {
    const key = `${svcName}:${poolName}`;
    if (!this.poolWatchers.has(key)) this.poolWatchers.set(key, new Set());
    this.poolWatchers.get(key)!.add(onUpdate);
    return () => {
      this.poolWatchers.get(key)?.delete(onUpdate);
    };
  }

  private dispatchPoolUpdate(payload: {
    svcName: string;
    name: string;
    pool: PoolView;
  }): void {
    const key = `${payload.svcName}:${payload.name}`;
    for (const onUpdate of this.poolWatchers.get(key) ?? []) {
      onUpdate(payload.pool);
    }
  }

  async createService(name: string): Promise<CreateServiceResult> {
    await this.connect();
    const payload = await this.request<{
      svcName: string;
      developerName: string;
      existing: boolean;
      accounts: Account[];
    }>("service.create", {
      name,
      userId: this.options.userId,
      apiKey: this.options.apiKey
    });
    return {
      service: new Service(this, payload.svcName),
      svcName: payload.svcName,
      developerName: payload.developerName,
      existing: payload.existing,
      accounts: payload.accounts
    };
  }

  async listServices(): Promise<string[]> {
    await this.auth();
    const payload = await this.request<{ services: string[] }>("service.list");
    return payload.services;
  }

  /**
   * Create (or retrieve) a session for an account under one of your registered service names.
   * Access control applies — see docs.
   */
  async createSession(params: CreateSessionParams): Promise<Session | AccessPending> {
    await this.auth();
    if (!params.username && !params.accountId) {
      throw new Error("username_or_accountId_required");
    }
    const result = await this.request<Session | AccessPending>("session.create", {
      svcName: params.svcName,
      sessionName: params.sessionName,
      username: params.username,
      accountId: params.accountId
    });
    return result;
  }

  async submitOnboarding(
    onboardingId: string,
    kind: "code" | "password",
    value: string
  ): Promise<OnboardingStep> {
    return this.request<OnboardingStep>("onboard.submit", { onboardingId, kind, value });
  }

  /** Start TDLib onboarding for a phone number (bot / service integration). */
  async startOnboarding(params: StartOnboardingParams): Promise<OnboardingStep> {
    await this.auth();
    return this.request<OnboardingStep>("onboard.start", params);
  }

  /**
   * Re-run Telegram login for an account whose persisted session is stale or unauthorized.
   * Clears server-side TDLib files before starting a fresh auth flow.
   */
  async restartOnboarding(
    params: Omit<StartOnboardingParams, "forceReauth">
  ): Promise<OnboardingStep> {
    return this.startOnboarding({ ...params, forceReauth: true });
  }

  /** Interactive TDLib onboarding (ops / local CLI). Pool eligibility defaults to false. */
  async onboardAccount(
    prompter: OnboardPrompter,
    options: OnboardAccountOptions = {}
  ): Promise<{ accountId: string; sessionId: string }> {
    await this.auth();
    const pool = options.pool ?? this.options.pool ?? false;
    const done = await runOnboardingInteractive(
      prompter,
      (phone) => this.startOnboarding({ phone, pool }),
      (onboardingId, kind, value) => this.submitOnboarding(onboardingId, kind, value)
    );
    return { accountId: done.accountId, sessionId: done.sessionId };
  }

  async stats(): Promise<Record<string, number>> {
    await this.auth();
    return this.request<Record<string, number>>("stats");
  }

  async close(): Promise<void> {
    this.ws?.close();
  }
}

export function createSessionProvider(options: SessionProviderOptions): SessionProvider {
  return new SessionProvider(options);
}

export { messageFromOwnerNotification } from "./owner-notification.js";
export { isOnboardingStep } from "./onboard-interactive.js";
