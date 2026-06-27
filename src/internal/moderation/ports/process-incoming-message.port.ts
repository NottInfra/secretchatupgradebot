import type { IncomingMessage } from "../../lib/types/index.js";

export interface IProcessIncomingMessage {
  execute(message: IncomingMessage): Promise<void>;
}
