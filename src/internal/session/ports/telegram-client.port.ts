/** Minimal TDLib surface used by moderation block actions. */
export interface ITelegramClient {
  invoke(request: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
