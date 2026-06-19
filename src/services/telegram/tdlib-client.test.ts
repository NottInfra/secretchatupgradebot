import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tdlMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  createClient: vi.fn(() => ({
    on: vi.fn()
  }))
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn()
}));

vi.mock("tdl", () => tdlMocks);
vi.mock("node:fs", () => fsMocks);
vi.mock("node:module", () => ({
  createRequire: () => () => {
    throw new Error("prebuilt-tdlib unavailable");
  }
}));

describe("createTdlibClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tdlMocks.configure.mockClear();
    tdlMocks.createClient.mockClear();
    fsMocks.existsSync.mockReset();
    fsMocks.mkdirSync.mockReset();
    fsMocks.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("configures tdlib from TDLIB_JSON_PATH and creates a client", async () => {
    vi.stubEnv("TDLIB_JSON_PATH", "/opt/tdlib/libtdjson.so");
    const { createTdlibClient } = await import("./tdlib-client.js");
    const logger = { error: vi.fn() };

    const client = createTdlibClient({
      sessionPath: "/data/session-1",
      apiId: 1,
      apiHash: "hash",
      logger: logger as never
    });

    expect(tdlMocks.configure).toHaveBeenCalledWith({ tdjson: "/opt/tdlib/libtdjson.so" });
    expect(fsMocks.mkdirSync).toHaveBeenCalledTimes(2);
    expect(tdlMocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiId: 1,
        apiHash: "hash",
        databaseDirectory: expect.stringContaining("tdlib-db"),
        filesDirectory: expect.stringContaining("tdlib-files")
      })
    );
    expect(client.on).toBeDefined();
  });

  it("resolves relative session paths against sessionProviderRoot", async () => {
    vi.stubEnv("TDLIB_JSON_PATH", "/opt/tdlib/libtdjson.so");
    fsMocks.existsSync.mockImplementation((path: string) => !path.includes("accounts/acc-1"));
    const { createTdlibClient } = await import("./tdlib-client.js");

    createTdlibClient({
      sessionPath: "accounts/acc-1",
      sessionProviderRoot: "/sessionprovider",
      apiId: 1,
      apiHash: "hash",
      logger: { error: vi.fn() } as never
    });

    expect(tdlMocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseDirectory: expect.stringContaining("/sessionprovider/accounts/acc-1/tdlib-db")
      })
    );
  });

  it("logs tdlib client errors", async () => {
    vi.stubEnv("TDLIB_JSON_PATH", "/opt/tdlib/libtdjson.so");
    const errorHandler = vi.fn();
    tdlMocks.createClient.mockReturnValueOnce({ on: errorHandler });
    const { createTdlibClient } = await import("./tdlib-client.js");
    const logger = { error: vi.fn() };

    createTdlibClient({
      sessionPath: "/data/session-1",
      apiId: 1,
      apiHash: "hash",
      logger: logger as never
    });

    const [, handler] = errorHandler.mock.calls[0] as [string, (error: Error) => void];
    handler(new Error("boom"));
    expect(logger.error).toHaveBeenCalledWith(
      "tdlib_client_error",
      expect.objectContaining({ error: "Error: boom" })
    );
  });

  it("throws when session path is empty", async () => {
    vi.stubEnv("TDLIB_JSON_PATH", "/opt/tdlib/libtdjson.so");
    const { createTdlibClient } = await import("./tdlib-client.js");
    expect(() =>
      createTdlibClient({
        sessionPath: "   ",
        apiId: 1,
        apiHash: "hash",
        logger: { error: vi.fn() } as never
      })
    ).toThrow("session_path_empty");
  });

  it("resolves bare relative session paths without sessionProviderRoot", async () => {
    vi.stubEnv("TDLIB_JSON_PATH", "/opt/tdlib/libtdjson.so");
    fsMocks.existsSync.mockReturnValue(false);
    const { createTdlibClient } = await import("./tdlib-client.js");

    createTdlibClient({
      sessionPath: "accounts/acc-1",
      apiId: 1,
      apiHash: "hash",
      logger: { error: vi.fn() } as never
    });

    expect(tdlMocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseDirectory: expect.stringMatching(/accounts\/acc-1\/tdlib-db$/)
      })
    );
  });
});
