export type ModerationAction = "allow" | "ignore" | "block";

export interface ModerationDecision {
  action: ModerationAction;
  confidence: number;
  reason: string;
}

export type ModerationInboundSource = "bot_api_automation";

export interface IncomingMessage {
  sessionId: string;
  chatId: string;
  senderId: string;
  senderUsername?: string;
  /** Account owner username (no @); used for templates on the Bot API automation path. */
  sessionOwnerUsername?: string;
  senderIsBot?: boolean;
  text: string;
  date: Date;
  /** Telegram server message id within this chat; enables cross-transport dedupe when both are set */
  telegramMessageId?: number;
  source?: ModerationInboundSource;
  /** Present on Bot API business_message updates; replies should go through the management bot. */
  businessConnectionId?: string;
}

export type SessionRecord = {
  userId: string;
  active: boolean;
};
