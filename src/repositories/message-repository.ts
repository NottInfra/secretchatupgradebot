import { IncomingMessage } from "../types.js";
import type { Store } from "../utils/db/root.js";

export class MessageRepository {
  constructor(private readonly store: Store) {}

  async save(message: IncomingMessage): Promise<number> {
    const id = await this.store.write(
      "incoming_messages.insert",
      message.senderId,
      message.sessionId,
      message.date.toISOString()
    );
    return id ?? 0;
  }

  async countBySender(senderId: string, receiverId: string, collapseWindowSeconds = 0): Promise<number> {
    return this.store.read<number>(
      "incoming_messages.count_by_sender",
      0,
      senderId,
      receiverId,
      collapseWindowSeconds
    );
  }

  /** Collapsed instance count for tiering — bursts within the window count as one instance. */
  async countInstancesBySender(
    senderId: string,
    receiverId: string,
    collapseWindowSeconds: number
  ): Promise<number> {
    return this.countBySender(senderId, receiverId, collapseWindowSeconds);
  }

  /** Messages from sender within the collapse window ending at `at` (inclusive). */
  async countInMessagingInstance(
    senderId: string,
    at: Date,
    collapseWindowSeconds: number
  ): Promise<number> {
    return this.store.read<number>(
      "incoming_messages.count_in_instance",
      0,
      senderId,
      at.toISOString(),
      collapseWindowSeconds
    );
  }
}
