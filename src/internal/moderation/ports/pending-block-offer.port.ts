import type { IncomingMessage } from "../../lib/types/index.js";

export type PendingBlockOffer = {
  ownerUserId: string;
  senderId: string;
  chatId: string;
  incomingMessageId: number;
  businessConnectionId?: string;
  telegramMessageId?: number;
  sessionOwnerUsername?: string;
  senderUsername?: string;
  experimentId: string;
  variantId: string;
  createdAt: number;
};

export interface IPendingBlockOfferStore {
  create(
    message: IncomingMessage,
    incomingMessageId: number,
    experimentId: string,
    variantId: string
  ): string;
  consume(token: string, ownerUserId: string): PendingBlockOffer | undefined;
}
