import { beforeEach, describe, expect, it, vi } from "vitest";
import { messageFromOwnerNotification } from "./owner-notification.js";

type MockWsRequest = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
};

type MockWsResponse = {
  id?: string;
  type: string;
  payload?: unknown;
  error?: string;
};

const wsMock = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: never[]) => void>,
  sent: [] as string[],
  responder: undefined as ((req: MockWsRequest) => MockWsResponse | Promise<MockWsResponse>) | undefined
}));

vi.mock("ws", () => ({
  default: class MockWebSocket {
    constructor(readonly url: string) {}

    on(event: string, handler: (...args: never[]) => void): void {
      wsMock.handlers[event] = handler;
    }

    send(data: string): void {
      wsMock.sent.push(data);
      const req = JSON.parse(data) as MockWsRequest;
      void Promise.resolve(wsMock.responder?.(req)).then((response) => {
        if (!response) return;
        wsMock.handlers.message?.(Buffer.from(JSON.stringify(response)) as never);
      });
    }

    close(): void {
      wsMock.handlers.close?.();
    }
  }
}));

import {
  AccountHandle,
  createSessionProvider,
  PoolHandle,
  Service,
  SessionProvider
} from "./index.js";
import type { Account, PoolView, Session } from "./types.js";

function resetWsMock(): void {
  wsMock.handlers = {};
  wsMock.sent = [];
  wsMock.responder = undefined;
}

function openWebSocket(): void {
  wsMock.handlers.open?.();
}

function emitMessage(message: MockWsResponse): void {
  wsMock.handlers.message?.(Buffer.from(JSON.stringify(message)) as never);
}

function lastRequest(): MockWsRequest {
  const raw = wsMock.sent.at(-1);
  if (!raw) throw new Error("no websocket request sent");
  return JSON.parse(raw) as MockWsRequest;
}

const emptyAccount = (): Account => ({
  id: "",
  telegramId: null,
  phone: null,
  username: "",
  firstName: "",
  lastName: "",
  bio: "",
  managedSessionCount: 0,
  activeTelegramSessionCount: null,
  poolEnabled: false,
  sessions: []
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "s1",
  accountId: "a1",
  svcName: "svc",
  name: "worker",
  sessionPath: "data/sessions/a1",
  sessionDirs: {
    databaseDirectory: "data/sessions/a1/tdlib-db",
    filesDirectory: "data/sessions/a1/tdlib-files"
  },
  ...overrides
});

function defaultResponder(req: { id: string; type: string; payload?: Record<string, unknown> }) {
  switch (req.type) {
    case "auth":
      return { id: req.id, type: "auth.ok" };
    case "service.create":
      return {
        id: req.id,
        type: "service.ok",
        payload: {
          svcName: "svc",
          developerName: "Acme",
          existing: false,
          accounts: []
        }
      };
    case "service.get":
      return { id: req.id, type: "service", payload: { svcName: "svc", accounts: [] } };
    case "service.list":
      return { id: req.id, type: "services", payload: { services: ["svc"] } };
    case "lookup":
      return {
        id: req.id,
        type: "account",
        payload: { account: { ...emptyAccount(), id: "a1", username: "alice" } }
      };
    case "account.get":
      return {
        id: req.id,
        type: "account",
        payload: { account: { ...emptyAccount(), id: req.payload?.accountId as string } }
      };
    case "account.getSession":
      return { id: req.id, type: "session", payload: { session: session() } };
    case "session.create":
      return { id: req.id, type: "session", payload: { session: session() } };
    case "pool.get":
      return {
        id: req.id,
        type: "pool",
        payload: { name: req.payload?.name, accounts: [] } satisfies PoolView
      };
    case "pool.addAccount":
      return {
        id: req.id,
        type: "account",
        payload: { account: { ...emptyAccount(), id: "a2" } }
      };
    case "access.callback":
      return { id: req.id, type: "access.callback.ok" };
    case "onboard.start":
      return {
        id: req.id,
        type: "onboarding",
        payload: { step: "complete", accountId: "a1", sessionId: "s1" }
      };
    case "onboard.submit":
      return {
        id: req.id,
        type: "onboarding",
        payload: { step: "complete", accountId: "a1", sessionId: "s1" }
      };
    case "stats":
      return { id: req.id, type: "stats", payload: { users: 1 } };
    default:
      return { id: req.id, type: "error", error: `unexpected:${req.type}` };
  }
}

async function connectedProvider(url = "ws://test.local"): Promise<SessionProvider> {
  const provider = createSessionProvider({ userId: "u1", apiKey: "k1", url });
  wsMock.responder = defaultResponder;
  const pending = provider.connect();
  openWebSocket();
  await pending;
  return provider;
}

describe("SessionProvider", () => {
  beforeEach(() => {
    resetWsMock();
  });

  it("connect is idempotent and request sends auth payload", async () => {
    const provider = await connectedProvider();
    await provider.connect();
    await provider.listServices();
    const authReq = wsMock.sent
      .map((raw) => JSON.parse(raw) as { type: string; payload?: Record<string, unknown> })
      .find((req) => req.type === "auth");
    expect(authReq?.payload).toEqual({ userId: "u1", apiKey: "k1" });
    await provider.close();
  });

  it("createService returns a service handle", async () => {
    const provider = await connectedProvider();
    const created = await provider.createService("svc");
    expect(created.svcName).toBe("svc");
    expect(created.service).toBeInstanceOf(Service);
    expect(created.existing).toBe(false);
  });

  it("createSession requires username or accountId", async () => {
    const provider = await connectedProvider();
    await expect(provider.createSession({ svcName: "svc" })).rejects.toThrow(
      "username_or_accountId_required"
    );
  });

  it("createSession resolves session and access.pending responses", async () => {
    const provider = await connectedProvider();
    await expect(
      provider.createSession({ svcName: "svc", accountId: "a1", sessionName: "worker" })
    ).resolves.toEqual(session());

    wsMock.responder = (req) =>
      req.type === "session.create"
        ? {
            id: req.id,
            type: "access.pending",
            payload: { requestId: "ar-1" }
          }
        : defaultResponder(req);

    await expect(provider.createSession({ svcName: "svc", username: "alice" })).resolves.toEqual({
      pending: true,
      requestId: "ar-1"
    });
  });

  it("onboardAccount runs interactive onboarding", async () => {
    const provider = await connectedProvider();
    wsMock.responder = (req) => {
      if (req.type === "onboard.start") {
        return {
          id: req.id,
          type: "onboarding",
          payload: { step: "code", onboardingId: "onb-1", authUrl: "https://auth.test/code" }
        };
      }
      if (req.type === "onboard.submit") {
        return {
          id: req.id,
          type: "onboarding",
          payload: { step: "complete", accountId: "a1", sessionId: "s1" }
        };
      }
      return defaultResponder(req);
    };

    const result = await provider.onboardAccount({
      ask: vi
        .fn()
        .mockResolvedValueOnce("+441234567890")
        .mockResolvedValueOnce("12345")
    });

    expect(result).toEqual({ accountId: "a1", sessionId: "s1" });
    expect(lastRequest().payload).toEqual({ onboardingId: "onb-1", kind: "code", value: "12345" });
  });

  it("dispatches pool.updated messages to watchers", async () => {
    const provider = await connectedProvider();
    const updates: PoolView[] = [];
    const unsubscribe = provider.watchPool("svc", "p1", (view) => updates.push(view));
    emitMessage({
      type: "pool.updated",
      payload: { svcName: "svc", name: "p1", pool: { name: "p1", accounts: [] } }
    });
    expect(updates).toHaveLength(1);
    unsubscribe();
    emitMessage({
      type: "pool.updated",
      payload: { svcName: "svc", name: "p1", pool: { name: "p1", accounts: [{ ...emptyAccount(), id: "a9" }] } }
    });
    expect(updates).toHaveLength(1);
  });

  it("rejects failed websocket responses", async () => {
    const provider = await connectedProvider();
    wsMock.responder = (req) => ({ id: req.id, type: "error", error: "boom" });
    await expect(provider.stats()).rejects.toThrow("boom");
  });
});

describe("Service handles", () => {
  beforeEach(() => {
    resetWsMock();
  });

  it("lookup builds account handles for username, numeric id, and telegram id", async () => {
    const provider = await connectedProvider();
    const service = new Service(provider, "svc");

    await service.lookup("alice");
    expect(lastRequest().payload).toEqual(expect.objectContaining({ svcName: "svc", username: "alice" }));

    await service.lookup("12345");
    expect(lastRequest().payload).toEqual(expect.objectContaining({ accountId: "12345" }));

    await service.lookup(67890);
    expect(lastRequest().payload).toEqual(expect.objectContaining({ telegramId: 67890 }));
  });

  it("AccountHandle upserts sessions returned from getSession", async () => {
    const provider = await connectedProvider();
    const account = new AccountHandle(new Service(provider, "svc"), {
      ...emptyAccount(),
      id: "a1",
      sessions: []
    });

    const first = await account.getSession("worker");
    expect(first).toEqual(session());
    expect(account.listSessions()).toHaveLength(1);

    wsMock.responder = (req) =>
      req.type === "account.getSession"
        ? {
            id: req.id,
            type: "access.pending",
            payload: { requestId: "ar-1" }
          }
        : defaultResponder(req);

    const pending = await account.getSession("worker");
    expect(pending).toEqual({ pending: true, requestId: "ar-1" });
  });

  it("PoolHandle tracks live updates and addAccount", async () => {
    const provider = await connectedProvider();
    const service = new Service(provider, "svc");
    const pool = await service.getPool("p1");
    expect(pool).toBeInstanceOf(PoolHandle);
    expect(pool.accounts).toEqual([]);

    emitMessage({
      type: "pool.updated",
      payload: {
        svcName: "svc",
        name: "p1",
        pool: { name: "p1", accounts: [{ ...emptyAccount(), id: "a3" }] }
      }
    });
    expect(pool.accounts).toHaveLength(1);

    const added = await pool.addAccount();
    expect(added.id).toBe("a2");
    pool.dispose();
  });

  it("respondAccessCallback sends callback payload", async () => {
    const provider = await connectedProvider();
    const service = new Service(provider, "svc");
    await service.respondAccessCallback("access:approve:req-1");
    expect(lastRequest()).toEqual(
      expect.objectContaining({
        type: "access.callback",
        payload: { svcName: "svc", callbackData: "access:approve:req-1" }
      })
    );
  });
});

describe("messageFromOwnerNotification", () => {
  it("formats request_phone notifications", () => {
    const message = messageFromOwnerNotification({
      type: "request_phone",
      notifyTarget: "@owner",
      developerName: "Acme"
    });
    expect(message.text).toContain("Acme");
    expect(message.notifyTarget).toBe("@owner");
    expect(message.replyMarkup).toBeUndefined();
  });

  it("formats auth link notifications", () => {
    const code = messageFromOwnerNotification({
      type: "auth_code_url",
      notifyTarget: 123,
      developerName: "Acme",
      url: "https://auth.test/code"
    });
    expect(code.text).toContain("login code");
    expect(code.text).toContain("https://auth.test/code");

    const password = messageFromOwnerNotification({
      type: "auth_password_url",
      notifyTarget: 123,
      developerName: "Acme",
      url: "https://auth.test/password"
    });
    expect(password.text).toContain("2FA password");
  });

  it("formats access confirm/deny notifications with inline keyboard", () => {
    const message = messageFromOwnerNotification({
      type: "access_confirm_deny",
      notifyTarget: "@owner",
      developerName: "Acme",
      sessionName: "worker",
      approveCallback: "access:approve:1",
      denyCallback: "access:deny:1"
    });
    expect(message.text).toContain('session "worker"');
    expect(message.replyMarkup?.inline_keyboard[0]).toEqual([
      { text: "Approve", callback_data: "access:approve:1" },
      { text: "Deny", callback_data: "access:deny:1" }
    ]);
  });
});
