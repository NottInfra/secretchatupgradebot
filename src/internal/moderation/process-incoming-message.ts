import type { IMessageRepository } from "./ports/message-repository.port.js";
import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { Assignment, IExperimentService } from "./experiments/experiment-service.port.js";
import type { IncomingMessage } from "../lib/types/index.js";
import { decisionForTier, moderationTierForCount } from "./moderation-tier.js";
import { Analytics } from "../lib/analytics.js";
import { Logger } from "../lib/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";
import type { Span } from "@opentelemetry/api";
import type { WarningTierHandler } from "./warning-tier-handler.js";
import type { BlockTierHandler } from "./block-tier-handler.js";
import type { ModerationSkipEvaluator } from "./moderation-skip-evaluator.js";
import type { PriorBlockSkipHandler } from "./prior-block-skip-handler.js";

const moderationTracer = getTracer("moderation");

const LEVEL1_WARNING_EXPERIMENT_ID = "level1_message_warning";
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

type ModerationContext = {
  priorBlockOtherAccount: boolean;
  messageCount: number;
  instanceCount: number;
  tier: "warning" | "block";
};

export class ProcessIncomingMessageUseCase {
  constructor(
    private readonly messages: IMessageRepository,
    private readonly skipEvaluator: ModerationSkipEvaluator,
    private readonly priorBlockSkip: PriorBlockSkipHandler,
    private readonly actions: IActionLogRepository,
    private readonly experiments: IExperimentService,
    private readonly warningTier: WarningTierHandler,
    private readonly blockTier: BlockTierHandler,
    private readonly analytics: Analytics,
    private readonly logger: Logger,
    private readonly messageInstanceCollapseSeconds: number
  ) {}

  async execute(message: IncomingMessage): Promise<void> {
    return withSpan(
      moderationTracer,
      "moderation.process_incoming",
      async (span) => this.executeModeration(message, span),
      {
        "telegram.chat_id": message.chatId,
        "telegram.sender_id": message.senderId,
        "telegram.message_id": message.telegramMessageId,
        "telegram.source": message.source ?? "unknown"
      }
    );
  }

  private async executeModeration(message: IncomingMessage, span: Span): Promise<void> {
    if ((await this.skipEvaluator.evaluate(message)).skip) return;

    const incomingMessageId = await this.messages.save(message);
    if (await this.priorBlockSkip.trySkip(message, incomingMessageId)) return;

    const context = await this.loadModerationContext(message);
    const tierAssignment = await this.assignTierWithSpan(context.tier, message.senderId);
    this.recordDecision(span, message, context, tierAssignment);
    await this.dispatchTier(message, incomingMessageId, context, tierAssignment);
  }

  private async loadModerationContext(message: IncomingMessage): Promise<ModerationContext> {
    const priorBlockOtherAccount = await this.actions.hasPriorBlockByOtherSession(
      message.senderId,
      message.sessionId
    );
    const messageCount = await withSpan(moderationTracer, "moderation.load_history", async () =>
      this.messages.countBySender(message.senderId, message.sessionId)
    );
    const instanceCount = await this.messages.countInstancesBySender(
      message.senderId,
      message.sessionId,
      this.messageInstanceCollapseSeconds
    );
    const tier = moderationTierForCount(instanceCount);

    this.logger.info("moderation_tier_selected", {
      senderId: message.senderId,
      sessionId: message.sessionId,
      messageCount,
      instanceCount,
      collapseWindowSeconds: this.messageInstanceCollapseSeconds,
      tier,
      priorBlockOtherAccount
    });

    return { priorBlockOtherAccount, messageCount, instanceCount, tier };
  }

  private async assignTierWithSpan(tier: "warning" | "block", senderId: string): Promise<Assignment> {
    return withSpan(moderationTracer, "moderation.assign_tier", async (tierSpan) => {
      setSpanAttributes(tierSpan, { "moderation.tier": tier });
      return this.assignTierExperiment(tier, senderId);
    });
  }

  private recordDecision(
    span: Span,
    message: IncomingMessage,
    context: ModerationContext,
    tierAssignment: Assignment
  ): void {
    const decision = decisionForTier(context.tier);

    setSpanAttributes(span, {
      "moderation.tier": context.tier,
      "moderation.action": decision.action,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });

    this.analytics.trackEvent("moderation_decision", {
      senderId: message.senderId,
      chatId: message.chatId,
      action: decision.action,
      confidence: decision.confidence,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      tier: context.tier,
      messageCount: context.messageCount,
      instanceCount: context.instanceCount,
      collapseWindowSeconds: this.messageInstanceCollapseSeconds
    });
  }

  private async dispatchTier(
    message: IncomingMessage,
    incomingMessageId: number,
    context: ModerationContext,
    tierAssignment: Assignment
  ): Promise<void> {
    const decision = decisionForTier(context.tier);

    if (context.tier === "warning") {
      await this.warningTier.handle(
        message,
        incomingMessageId,
        context.messageCount,
        context.instanceCount,
        decision,
        tierAssignment,
        context.priorBlockOtherAccount
      );
      return;
    }

    await this.blockTier.queue(
      message,
      incomingMessageId,
      context.messageCount,
      context.instanceCount,
      decision,
      tierAssignment
    );
  }

  private assignTierExperiment(tier: "warning" | "block", senderId: string) {
    if (tier === "warning") {
      return this.experiments.assignModerationTier(LEVEL1_WARNING_EXPERIMENT_ID, senderId);
    }
    return this.experiments.assignModerationTier(LEVEL3_BLOCK_EXPERIMENT_ID, senderId);
  }
}
