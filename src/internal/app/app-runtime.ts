import type { MgmtBotService } from "./mgmt-bot-service.js";
import type { OwnerSessionService } from "../session/owner-session-service.js";
import type { Store } from "../lib/db/root.js";
import type { Logger } from "../lib/logger.js";

export type AppRuntime = {
  store: Store;
  botService: MgmtBotService;
  ownerSessions: OwnerSessionService;
  logger: Logger;
};
