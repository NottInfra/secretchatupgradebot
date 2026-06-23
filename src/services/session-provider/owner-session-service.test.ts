import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerSessionService, type OwnerSessionConfig } from "./owner-session-service.js";
import { mockLogger } from "../../test/support/mocks.js";

const tdlibClient = {
  login: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  on: vi.fn()
};

vi.mock("../telegram/tdlib-client.js", () => ({
  createTdlibClient: vi.fn(() => tdlibClient)
}));

const baseConfig: OwnerSessionConfig = {
  userId: "user-1",
  apiKey: "key-1",
  url: "ws://localhost:3000",
  svcName: "secretchatupgradebot",
  sessionProviderRoot: "/sessionprovider",
  apiId: 12345,
  apiHash: "abc123"
};

function buildService(overrides: {
  lookup?: ReturnType<typeof vi.fn>;
  getSession?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
} = {}) {
  const logger = mockLogger();
  const notifications = {
    sendToClient: vi.fn(async () => undefined),
    sendHTMLWithInlineButton: vi.fn(async () => undefined)
  };
  const account = {
    getSession: overrides.getSession ?? vi.fn(async () => ({
      sessionPath: "accounts/acc-1",
      accountId: "acc-1"
    }))
  };
  const service = {
    lookup: overrides.lookup ?? vi.fn(async () => ({ id: "acc-1" })),
    getAccount: vi.fn(async () => account)
  };
  const provider = {
    createService: vi.fn(async () => ({ service })),
    request: overrides.request ?? vi.fn(),
    close: vi.fn(async () => undefined)
  };
  const ownerSessions = new OwnerSessionService(
    provider as never,
    baseConfig,
    notifications as never,
    logger as never
  );
  return { ownerSessions, provider, service, account, notifications, logger };
}

describe("OwnerSessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tdlibClient.login.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects invalid telegram ids", async () => {
    const { ownerSessions, logger } = buildService();
    const session = await ownerSessions.ensureOwnerSession("not-a-number");
    expect(session).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "owner_session_invalid_telegram_id",
      expect.any(Object)
    );
  });

  it("returns session after lookup and tdlib connect", async () => {
    const { ownerSessions } = buildService();
    const client = await ownerSessions.getTdlibForOwner("12345");
    expect(client).toBe(tdlibClient);
    expect(tdlibClient.login).toHaveBeenCalledOnce();
  });

  it("needs phone when lookup returns an empty account shell", async () => {
    const { ownerSessions, logger } = buildService({
      lookup: vi.fn(async () => ({ id: "", username: "", sessions: [] }))
    });
    const session = await ownerSessions.ensureOwnerSession("6412617720");
    expect(session).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith("owner_session_needs_phone", {
      ownerTelegramId: "6412617720"
    });
  });

  it("onboards when lookup returns empty shell and phone is provided", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "onboard.start") {
        return { step: "complete", accountId: "acc-new", sessionId: "acc-new" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ownerSessions, provider } = buildService({
      lookup: vi.fn(async () => ({ id: "", username: "", sessions: [] })),
      request
    });

    const client = await ownerSessions.getTdlibForOwner("6412617720", "+447561231794");
    expect(client).toBe(tdlibClient);
    expect(provider.request).toHaveBeenCalledWith(
      "onboard.start",
      expect.objectContaining({ phone: "+447561231794", notifyTarget: "6412617720" })
    );
  });

  it("needs phone when account is missing", async () => {
    const { ownerSessions, logger } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      })
    });
    const session = await ownerSessions.ensureOwnerSession("12345");
    expect(session).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith("owner_session_needs_phone", { ownerTelegramId: "12345" });
  });

  it("onboards owner when phone is provided", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "onboard.start") {
        return { step: "complete", accountId: "acc-new", onboardingId: "ob-1" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ownerSessions, provider } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      }),
      request
    });

    const client = await ownerSessions.getTdlibForOwner("12345", "+447700900123");
    expect(client).toBe(tdlibClient);
    expect(provider.request).toHaveBeenCalledWith(
      "onboard.start",
      expect.objectContaining({ phone: "+447700900123" })
    );
  });

  it("returns undefined when lookup fails unexpectedly", async () => {
    const { ownerSessions, logger } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("upstream_down");
      })
    });
    const session = await ownerSessions.ensureOwnerSession("12345");
    expect(session).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "owner_session_lookup_failed",
      expect.objectContaining({ ownerTelegramId: "12345" })
    );
  });

  it("notifies owner when session access is pending", async () => {
    const { ownerSessions, notifications } = buildService({
      getSession: vi.fn(async () => ({
        pending: true,
        requestId: "req-1",
        ownerNotification: {
          type: "access_confirm_deny",
          notifyTarget: "12345",
          developerName: "Acme",
          sessionName: "worker",
          approveCallback: "approve:1",
          denyCallback: "deny:1"
        }
      }))
    });

    const session = await ownerSessions.ensureOwnerSession("12345");
    expect(session).toBeUndefined();
    expect(notifications.sendHTMLWithInlineButton).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Approve or deny"),
      "Approve",
      "approve:1"
    );
  });

  it("sends generic pending message when notification is missing", async () => {
    const { ownerSessions, notifications } = buildService({
      getSession: vi.fn(async () => ({
        pending: true,
        requestId: "req-1"
      }))
    });

    await ownerSessions.ensureOwnerSession("12345");
    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Session access needs your approval")
    );
  });

  it("polls onboarding status until complete", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (method: string) => {
      if (method === "onboard.start") {
        return { step: "code", onboardingId: "ob-1", authUrl: "https://auth.test/code" };
      }
      if (method === "onboard.status") {
        return { step: "complete", accountId: "acc-2", onboardingId: "ob-1" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ownerSessions, notifications } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      }),
      request
    });

    const pending = ownerSessions.getTdlibForOwner("12345", "+447700900123");
    await vi.advanceTimersByTimeAsync(2000);
    const client = await pending;

    expect(client).toBe(tdlibClient);
    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("https://auth.test/code")
    );
    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Telegram session connected")
    );
  });

  it("reuses cached tdlib clients per account", async () => {
    const { ownerSessions } = buildService();
    const first = await ownerSessions.getTdlibForOwner("12345");
    const second = await ownerSessions.getTdlibForOwner("12345");
    expect(first).toBe(second);
    expect(tdlibClient.login).toHaveBeenCalledOnce();
  });

  it("closes tdlib clients on stop", async () => {
    const { ownerSessions, provider } = buildService();
    await ownerSessions.getTdlibForOwner("12345");
    await ownerSessions.stop();
    expect(tdlibClient.close).toHaveBeenCalledOnce();
    expect(provider.close).toHaveBeenCalledOnce();
  });

  it("returns undefined when tdlib login fails", async () => {
    tdlibClient.login.mockRejectedValueOnce(new Error("session_not_authorized"));
    const { ownerSessions, logger } = buildService();
    const client = await ownerSessions.getTdlibForOwner("12345");
    expect(client).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "tdlib_session_connect_failed",
      expect.objectContaining({ accountId: "acc-1" })
    );
  });

  it("rejects invalid onboarding responses", async () => {
    const { ownerSessions, logger } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      }),
      request: vi.fn(async () => "not-a-step")
    });
    const client = await ownerSessions.getTdlibForOwner("12345", "+447700900123");
    expect(client).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("owner_onboard_invalid_step", { ownerTelegramId: "12345" });
  });

  it("times out long-running onboarding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const request = vi.fn(async (method: string) => {
      if (method === "onboard.start") {
        return { step: "code", onboardingId: "ob-1", authUrl: "https://auth.test/code" };
      }
      return { step: "code", onboardingId: "ob-1", authUrl: "https://auth.test/code" };
    });
    const { ownerSessions, logger } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      }),
      request
    });

    const pending = ownerSessions.getTdlibForOwner("12345", "+447700900123");
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    const client = await pending;

    expect(client).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "owner_onboard_timeout",
      expect.objectContaining({ ownerTelegramId: "12345", onboardingId: "ob-1" })
    );
  });

  it("notifies via ownerNotification during onboarding", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (method: string) => {
      if (method === "onboard.start") {
        return {
          step: "password",
          onboardingId: "ob-1",
          ownerNotification: {
            type: "auth_password_url",
            notifyTarget: "12345",
            developerName: "Acme",
            url: "https://auth.test/password"
          }
        };
      }
      return { step: "complete", accountId: "acc-2", onboardingId: "ob-1" };
    });
    const { ownerSessions, notifications } = buildService({
      lookup: vi.fn(async () => {
        throw new Error("account_not_found");
      }),
      request
    });

    const pending = ownerSessions.getTdlibForOwner("12345", "+447700900123");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("2FA password")
    );
  });

  it("falls back to plain text when access approval has no approve button", async () => {
    const { ownerSessions, notifications } = buildService({
      getSession: vi.fn(async () => ({
        pending: true,
        requestId: "req-1",
        ownerNotification: {
          type: "request_phone",
          notifyTarget: "12345",
          developerName: "Acme"
        }
      }))
    });

    await ownerSessions.ensureOwnerSession("12345");
    expect(notifications.sendHTMLWithInlineButton).not.toHaveBeenCalled();
    expect(notifications.sendToClient).toHaveBeenCalledWith("12345", expect.stringContaining("phone number"));
  });

  it("deduplicates concurrent tdlib connects for the same account", async () => {
    let loginCount = 0;
    tdlibClient.login.mockImplementation(async () => {
      loginCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const { ownerSessions } = buildService();
    await Promise.all([
      ownerSessions.getTdlibForOwner("12345"),
      ownerSessions.getTdlibForOwner("12345")
    ]);
    expect(loginCount).toBe(1);
  });
});
