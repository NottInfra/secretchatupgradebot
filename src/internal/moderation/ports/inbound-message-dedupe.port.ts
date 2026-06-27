export interface IInboundMessageDedupe {
  tryClaim(chatId: string, messageId: number): boolean;
}
