import type { Session } from "@sessionprovider/sdk";
import type { TdlibClient } from "../lib/telegram/tdlib-client.js";
import { createTdlibClient } from "../lib/telegram/tdlib-client.js";
import { materializeSessionFiles } from "../lib/telegram/session-files.js";
import type { Logger } from "../lib/logger.js";

export type TdlibConnectConfig = {
  sessionProviderRoot?: string;
  apiId: number;
  apiHash: string;
};

export async function connectOwnerTdlib(
  session: Session,
  config: TdlibConnectConfig,
  logger: Logger
): Promise<TdlibClient | undefined> {
  let sessionDirs: { databaseDirectory: string; filesDirectory: string } | undefined;
  if (session.files && Object.keys(session.files).length > 0) {
    sessionDirs = materializeSessionFiles(session, config.sessionProviderRoot);
    logger.info("tdlib_session_files_materialized", {
      accountId: session.accountId,
      fileCount: Object.keys(session.files).length
    });
  }

  const client = createTdlibClient({
    sessionPath: session.sessionPath,
    sessionProviderRoot: config.sessionProviderRoot,
    sessionDirs,
    apiId: config.apiId,
    apiHash: config.apiHash,
    logger
  });

  const notAuthorized = () => new Error(`session_not_authorized accountId=${session.accountId}`);

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
    logger.info("tdlib_session_connected", {
      accountId: session.accountId,
      sessionPath: session.sessionPath
    });
    return client;
  } catch (error) {
    logger.error("tdlib_session_connect_failed", {
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
