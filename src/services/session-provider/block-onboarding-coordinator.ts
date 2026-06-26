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

  async requestSessionConnect(ownerUserId: string): Promise<void> {
    if (this.isAwaitingPhone(ownerUserId)) {
      await this.notifications.sendToClient(
        ownerUserId,
        "Still waiting for your phone number in international format (example: +447700900123)."
      );
      return;
    }

    this.pending.set(ownerUserId, { stage: "awaiting_phone", blocks: [] });
    await this.sendPhonePrompt(ownerUserId);
    this.logger.info("session_connect_phone_requested", { ownerUserId });
  }

  async requestPhoneForBlock(
    ownerUserId: string,
    block: PendingBlock,
    senderRef: string
  ): Promise<void> {
    const existing = this.pending.get(ownerUserId);
    if (existing) {
      existing.blocks.push(block);
      if (existing.stage === "awaiting_phone") {
        await this.notifications.sendToClient(
          ownerUserId,
          `Queued block for ${senderRef}. Send your phone number when ready (example: +447700900123).`
        );
      }
      return;
    }

    this.pending.set(ownerUserId, { stage: "awaiting_phone", blocks: [block] });
    await this.notifications.sendHTML(
      ownerUserId,
      `To block ${senderRef} we need your Telegram session.\n\n` +
        "Send your phone number in international format (example: +447700900123)."
    );
    this.logger.info("block_onboarding_phone_requested", { ownerUserId, senderId: block.senderId });
  }

  private async sendPhonePrompt(ownerUserId: string): Promise<void> {
    await this.notifications.sendHTML(
      ownerUserId,
      "<b>Connect your Telegram session</b>\n\n" +
        "We need your phone number once so we can block contacts on your account when moderation requires it.\n\n" +
        "Send your phone number in international format (example: +447700900123).\n\n" +
        "You will receive a login link here — complete it before sending /start again."
    );
  }

  async onPhoneSubmitted(ownerUserId: string, phone: string): Promise<void> {
    const state = this.pending.get(ownerUserId);
    if (state?.stage !== "awaiting_phone") return;

    const blocks = [...state.blocks];

    await this.notifications.sendToClient(
      ownerUserId,
      "Connecting your Telegram session…\n\nIf you receive a login link, open it and enter your code before continuing."
    );

    const client = await this.ownerSessions.getTdlibForOwner(ownerUserId, phone.trim());
    if (!client) {
      this.pending.set(ownerUserId, { stage: "awaiting_phone", blocks });
      await this.notifications.sendToClient(
        ownerUserId,
        "Could not connect your Telegram session yet.\n\n" +
          "If you received a login link above, complete it and send your phone number again.\n\n" +
          "Or send /connect to restart."
      );
      this.logger.error("block_onboarding_failed", { ownerUserId, blockCount: blocks.length });
      return;
    }

    this.pending.delete(ownerUserId);

    for (const block of blocks) {
      await this.executeModerationAction.execute(client, block);
    }

    if (blocks.length > 0) {
      this.logger.info("block_onboarding_deferred_blocks_done", {
        ownerUserId,
        count: blocks.length
      });
    } else {
      this.logger.info("session_connect_complete", { ownerUserId });
    }
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
