import type { BlockActionInput } from "./execute-moderation-action.port.js";

export interface IBlockOnboarding {
  isAwaitingPhone(ownerUserId: string): boolean;
  requestSessionConnect(ownerUserId: string): Promise<void>;
  onPhoneSubmitted(ownerUserId: string, phone: string): Promise<void>;
  executeBlockWithSession(
    ownerUserId: string,
    block: BlockActionInput,
    senderRef: string
  ): Promise<boolean>;
}
