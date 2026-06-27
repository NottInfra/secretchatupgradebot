import type { IncomingMessage } from "../../lib/types/index.js";

export interface IMessageRepository {
  save(message: IncomingMessage): Promise<number>;
  countBySender(senderId: string, receiverId: string, collapseWindowSeconds?: number): Promise<number>;
  countInstancesBySender(
    senderId: string,
    receiverId: string,
    collapseWindowSeconds: number
  ): Promise<number>;
  countInMessagingInstance(
    senderId: string,
    at: Date,
    collapseWindowSeconds: number
  ): Promise<number>;
}
