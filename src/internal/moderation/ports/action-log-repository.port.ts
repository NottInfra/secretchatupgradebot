import type { ModerationDecision } from "../../lib/types/index.js";

export interface IActionLogRepository {
  hasPriorBlockInSession(senderId: string, receiverId: string): Promise<boolean>;
  hasPriorBlockByOtherSession(senderId: string, receiverId: string): Promise<boolean>;
  save(input: { incomingMessageId: number; decision: ModerationDecision }): Promise<void>;
  saveDeferred(input: { incomingMessageId: number; decision: ModerationDecision }): void;
}
