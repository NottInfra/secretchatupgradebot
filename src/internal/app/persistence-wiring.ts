import { HandleUserMiddleware } from "./middleware/handle-user-middleware.js";
import { SessionModerationToggleMiddleware } from "./middleware/session-moderation-toggle-middleware.js";
import { ActionLogRepository } from "../moderation/repositories/action-log-repository.js";
import { MessageRepository } from "../moderation/repositories/message-repository.js";
import { SessionRepository } from "../session/repositories/session-repository.js";
import type { Analytics } from "../lib/analytics.js";
import type { Store } from "../lib/db/root.js";

export type PersistenceStack = {
  messages: MessageRepository;
  actionLogs: ActionLogRepository;
  sessions: SessionRepository;
  handleUserMiddleware: HandleUserMiddleware;
  sessionModerationToggle: SessionModerationToggleMiddleware;
};

export function createPersistenceStack(store: Store, analytics: Analytics): PersistenceStack {
  const messages = new MessageRepository(store);
  const actionLogs = new ActionLogRepository(store);
  const sessions = new SessionRepository(store);

  return {
    messages,
    actionLogs,
    sessions,
    handleUserMiddleware: new HandleUserMiddleware(store, analytics),
    sessionModerationToggle: new SessionModerationToggleMiddleware(sessions)
  };
}
