import type { IncomingMessage, ModerationDecision } from "../../types.js";
import type { ClientNotificationService } from "../client-notification-service.js";
import type { Logger } from "../../utils/logger.js";
import type { OwnerSessionService } from "./owner-session-service.js";
import type { ExecuteModerationActionUseCase } from "../../use-cases/execute-moderation-action.js";

type PendingBlock = {
  senderId: string;
  decision: ModerationDecision;
  blockMessageHtml: string;
  moderationIncoming: IncomingMessage;
};

type OwnerPending = {
  stage: "awaiting_phone";
  blocks: PendingBlock[];
};

export class BlockOnboardingCoordinator {
  private readonly pending = new Map<string, OwnerPending>();

  constructor(
    private readonly ownerSessions: OwnerSessionService,
    private readonly executeModerationAction: ExecuteModerationActionUseCase,
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  isAwaitingPhone(ownerUserId: string): boolean {
    return this.pending.get(ownerUserId)?.stage === "awaiting_phone";
  }

  async requestPhoneForBlock(
    ownerUserId: string,
    block: PendingBlock,
    senderRef: string
  ): Promise<void> {
    const existing = this.pending.get(ownerUserId);
    if (existing) {
      existing.blocks.push(block);
      return;
    }

    this.pending.set(ownerUserId, { stage: "awaiting_phone", blocks: [block] });
    await this.notifications.sendToClient(
      ownerUserId,
      `To block ${senderRef} we need your Telegram session.\n\n` +
        "Send your phone number in international format (example: +447700900123)."
    );
    this.logger.info("block_onboarding_phone_requested", { ownerUserId, senderId: block.senderId });
  }

  async onPhoneSubmitted(ownerUserId: string, phone: string): Promise<void> {
    const state = this.pending.get(ownerUserId);
    if (state?.stage !== "awaiting_phone") return;

    const blocks = [...state.blocks];
    this.pending.delete(ownerUserId);

    await this.notifications.sendToClient(ownerUserId, "Connecting your Telegram session…");

    const client = await this.ownerSessions.getTdlibForOwner(ownerUserId, phone.trim());
    if (!client) {
      await this.notifications.sendToClient(
        ownerUserId,
        "Could not connect your Telegram session. Check the auth link and try again when another block is needed."
      );
      this.logger.error("block_onboarding_failed", { ownerUserId });
      return;
    }

    for (const block of blocks) {
      await this.executeModerationAction.execute(client, block);
    }

    this.logger.info("block_onboarding_deferred_blocks_done", {
      ownerUserId,
      count: blocks.length
    });
  }

  async executeBlockWithSession(
    ownerUserId: string,
    block: PendingBlock,
    senderRef: string
  ): Promise<boolean> {
    const client = await this.ownerSessions.getTdlibForOwner(ownerUserId);
    if (client) {
      await this.executeModerationAction.execute(client, block);
      return true;
    }

    await this.requestPhoneForBlock(ownerUserId, block, senderRef);
    return false;
  }
}

export type { PendingBlock };
