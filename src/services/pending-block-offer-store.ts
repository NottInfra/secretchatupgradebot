import type { IncomingMessage } from "../types.js";
import { randomBytes } from "node:crypto";

export type PendingBlockOffer = {
  ownerUserId: string;
  senderId: string;
  chatId: string;
  businessConnectionId?: string;
  telegramMessageId?: number;
  sessionOwnerUsername?: string;
  senderUsername?: string;
  experimentId: string;
  variantId: string;
  createdAt: number;
};

const OFFER_TTL_MS = 24 * 60 * 60 * 1000;

/** Short-lived tokens for mgmt-bot "Block now" inline buttons. */
export class PendingBlockOfferStore {
  private readonly offers = new Map<string, PendingBlockOffer>();

  create(
    message: IncomingMessage,
    experimentId: string,
    variantId: string
  ): string {
    this.pruneExpired();
    const token = randomBytes(8).toString("hex");
    this.offers.set(token, {
      ownerUserId: message.sessionId,
      senderId: message.senderId,
      chatId: message.chatId,
      businessConnectionId: message.businessConnectionId,
      telegramMessageId: message.telegramMessageId,
      sessionOwnerUsername: message.sessionOwnerUsername,
      senderUsername: message.senderUsername,
      experimentId,
      variantId,
      createdAt: Date.now()
    });
    return token;
  }

  consume(token: string, ownerUserId: string): PendingBlockOffer | undefined {
    this.pruneExpired();
    const offer = this.offers.get(token);
    if (!offer || offer.ownerUserId !== ownerUserId) return undefined;
    this.offers.delete(token);
    return offer;
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - OFFER_TTL_MS;
    for (const [token, offer] of this.offers) {
      if (offer.createdAt < cutoff) this.offers.delete(token);
    }
  }
}
