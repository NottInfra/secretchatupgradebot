import { ModerationDecision } from "../types.js";
import type { Store } from "../utils/db/root.js";

export class ActionLogRepository {
  constructor(private readonly store: Store) {}

  /** Sender already blocked on this owner's account. */
  async hasPriorBlockInSession(senderId: string, receiverId: string): Promise<boolean> {
    return this.store.read<boolean>("action_logs.has_prior_block_in_session", 0, senderId, receiverId);
  }

  /** Sender blocked on a different owner's account (cross-account reputation). */
  async hasPriorBlockByOtherSession(senderId: string, receiverId: string): Promise<boolean> {
    return this.store.read<boolean>(
      "action_logs.has_prior_block_by_other_session",
      0,
      senderId,
      receiverId
    );
  }

  async save(input: { incomingMessageId: number; decision: ModerationDecision }): Promise<void> {
    await this.store.write(
      "action_logs.insert",
      input.incomingMessageId,
      input.decision,
      new Date().toISOString()
    );
  }

  saveDeferred(input: { incomingMessageId: number; decision: ModerationDecision }): void {
    this.store.writeDeferred(
      "action_logs.insert",
      input.incomingMessageId,
      input.decision,
      new Date().toISOString()
    );
  }
}
