import type { Assignment } from "../experiments/experiment-service.port.js";
import type { IncomingMessage } from "../../lib/types/index.js";

export interface IModerationReply {
  buildReplyHtml(message: IncomingMessage, assignment: Assignment, messageCount: number): string;
  sendFirstMessageReply(
    message: IncomingMessage,
    html: string,
    mediaPath: string | undefined
  ): Promise<void>;
}
