import type { IncomingMessage, ModerationDecision } from "../../lib/types/index.js";
import type { ITelegramClient } from "./telegram-client.port.js";

export type BlockActionInput = {
  senderId: string;
  decision: ModerationDecision;
  blockMessageHtml?: string;
  moderationIncoming?: IncomingMessage;
};

export interface IExecuteModerationAction {
  execute(client: ITelegramClient, input: BlockActionInput): Promise<boolean>;
}
