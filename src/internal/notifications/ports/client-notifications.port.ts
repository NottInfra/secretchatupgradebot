import type { BusinessAutomationReplyInput } from "../../lib/types/index.js";

export type { BusinessAutomationReplyInput };

export interface IClientNotifications {
  sendToClient(clientUserId: string, text: string): Promise<boolean>;
  sendHTML(clientUserId: string, html: string): Promise<boolean>;
  sendHTMLWithInlineButton(
    clientUserId: string,
    html: string,
    buttonLabel: string,
    callbackData: string
  ): Promise<boolean>;
  sendHTMLFile(clientUserId: string, filePath: string): Promise<boolean>;
  sendBusinessHTMLReply(input: BusinessAutomationReplyInput): Promise<boolean>;
  sendBusinessMediaReply(input: BusinessAutomationReplyInput & { mediaPath: string }): Promise<boolean>;
}
