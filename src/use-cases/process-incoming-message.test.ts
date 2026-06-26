import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProcessIncomingMessageUseCase } from "./process-incoming-message.js";
import { ExperimentService } from "../services/experiment-service.js";
import { InboundMessageDedupe } from "../services/inbound-message-dedupe.js";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";
import { SendPriorBlockOwnerPromptUseCase } from "./send-prior-block-owner-prompt.js";
import { PendingBlockOfferStore } from "../services/pending-block-offer-store.js";
import { ActionQueueService } from "../bg-services/action-queue-service.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

const experimentDirs = [
  path.resolve("assets/messages/message-warning"),
  path.resolve("assets/messages/messages-block")
];

const COLLAPSE_SECONDS = 300;

function buildUseCase(overrides: {
  messageCount?: number;
  instanceCount?: number;
  priorBlockInSession?: boolean;
  priorBlockOther?: boolean;
  client?: object | null;
} = {}) {
  const logger = mockLogger();
  const analytics = mockAnalytics();
  const notifications = {
    sendBusinessHTMLReply: vi.fn(async () => true),
    sendBusinessMediaReply: vi.fn(async () => true),
    sendHTML: vi.fn(async () => true)
  };
  const experiments = new ExperimentService(experimentDirs, logger as never);
  const executeModerationAction = new ExecuteModerationActionUseCase(
    notifications as never,
    logger as never
  );
  const priorBlockOwnerPrompt = new SendPriorBlockOwnerPromptUseCase(
    new PendingBlockOfferStore(),
    { sendHTMLWithInlineButton: vi.fn(async () => true) } as never,
    analytics as never,
    logger as never
  );
  const countInstancesBySender = vi.fn(async () => overrides.instanceCount ?? overrides.messageCount ?? 1);

  const actions = {
    hasPriorBlockInSession: vi.fn(async () => overrides.priorBlockInSession ?? false),
    hasPriorBlockByOtherSession: vi.fn(async () => overrides.priorBlockOther ?? false),
    saveDeferred: vi.fn()
  };

  const useCase = new ProcessIncomingMessageUseCase(
    {
      save: vi.fn(async () => 1),
      countBySender: vi.fn(async () => overrides.messageCount ?? overrides.instanceCount ?? 1),
      countInstancesBySender
    } as never,
    new InboundMessageDedupe(),
    actions as never,
    executeModerationAction,
    new ActionQueueService(logger as never, 0),
    analytics as never,
    logger as never,
    notifications as never,
    experiments,
    { getTdlibForOwner: vi.fn(async () => overrides.client ?? null), executeBlockWithSession: vi.fn(async () => Boolean(overrides.client)) } as never,
    priorBlockOwnerPrompt,
    COLLAPSE_SECONDS
  );

  return { useCase, analytics, logger, notifications, countInstancesBySender, actions };
}

async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ProcessIncomingMessageUseCase", () => {
  it("skips bot senders", async () => {
    const { useCase, analytics } = buildUseCase();
    await useCase.execute(sampleMessage({ senderIsBot: true }));
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "moderation_skipped_bot_sender",
      expect.objectContaining({ senderId: "sender-1" })
    );
  });

  it("skips owner outbound automation messages", async () => {
    const { useCase, analytics } = buildUseCase();
    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        sessionId: "sender-1",
        senderId: "sender-1"
      })
    );
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "moderation_skipped_owner_outbound",
      expect.any(Object)
    );
  });

  it("skips duplicate inbound messages", async () => {
    const { useCase, analytics } = buildUseCase();
    const message = sampleMessage({ telegramMessageId: 55 });

    await useCase.execute(message);
    await useCase.execute(message);

    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "moderation_duplicate_inbound_skipped",
      expect.objectContaining({ messageId: 55 })
    );
  });

  it("sends a first warning for the first message", async () => {
    const { useCase, analytics, notifications, countInstancesBySender } = buildUseCase({
      messageCount: 1,
      instanceCount: 1
    });
    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    );

    expect(countInstancesBySender).toHaveBeenCalledWith("sender-1", "owner-1", COLLAPSE_SECONDS);
    const sentBusinessReply =
      notifications.sendBusinessHTMLReply.mock.calls.length +
      notifications.sendBusinessMediaReply.mock.calls.length;
    expect(sentBusinessReply).toBeGreaterThan(0);
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "message_warning_sent",
      expect.any(Object)
    );
  });

  it("sends the same warning on the second instance", async () => {
    const { useCase, analytics } = buildUseCase({ messageCount: 2, instanceCount: 2 });
    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    );
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "message_warning_sent",
      expect.any(Object)
    );
  });

  it("still warns when a burst message shares the same instance count", async () => {
    const { useCase, analytics } = buildUseCase({ messageCount: 2, instanceCount: 1 });
    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1",
        telegramMessageId: 99
      })
    );
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "message_warning_sent",
      expect.any(Object)
    );
    expect(analytics.trackEvent).not.toHaveBeenCalledWith("sender_block_queued", expect.any(Object));
  });

  it("sends text first then media as a follow-up when a variant has media", async () => {
    const { useCase, notifications } = buildUseCase({ messageCount: 1, instanceCount: 1 });
    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1",
        sessionOwnerUsername: "owner",
        senderUsername: "spammer"
      })
    );

    expect(notifications.sendBusinessHTMLReply).toHaveBeenCalledOnce();
    expect(notifications.sendBusinessMediaReply).toHaveBeenCalledOnce();
    expect(notifications.sendBusinessMediaReply.mock.calls[0]?.[0]).toMatchObject({
      businessConnectionId: "bc-1",
      chatId: "chat-1",
      mediaPath: expect.stringContaining("variant-006.mp4")
    });
    expect(notifications.sendBusinessMediaReply.mock.calls[0]?.[0]?.html).toBeUndefined();

    const html = notifications.sendBusinessHTMLReply.mock.calls[0]?.[0]?.html;
    expect(html).toContain("Attempt 1");
    expect(html).toContain("@spammer");
    expect(html).not.toContain("{{SENDER_USERNAME}}");
  });

  it("queues a block on the third instance", async () => {
    const client = {
      sendMessage: vi.fn(async () => ({ id: 1 })),
      getInputEntity: vi.fn(async () => ({})),
      invoke: vi.fn(async () => undefined)
    };
    const { useCase, analytics, actions } = buildUseCase({ messageCount: 3, instanceCount: 3, client });

    await useCase.execute(sampleMessage());
    await flushQueue();

    expect(analytics.trackEvent).toHaveBeenCalledWith("sender_block_queued", expect.any(Object));
    expect(analytics.trackEvent).toHaveBeenCalledWith("block_notice_sent", expect.any(Object));
    expect(actions.saveDeferred).toHaveBeenCalledWith(
      expect.objectContaining({ decision: expect.objectContaining({ action: "block" }) })
    );
  });

  it("falls back to warning when block tier cannot connect a session", async () => {
    const { useCase, analytics, notifications, actions } = buildUseCase({
      messageCount: 3,
      instanceCount: 3,
      client: null
    });

    await useCase.execute(
      sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    );
    await flushQueue();

    expect(analytics.trackEvent).toHaveBeenCalledWith("sender_block_queued", expect.any(Object));
    expect(notifications.sendBusinessHTMLReply).toHaveBeenCalled();
    expect(actions.saveDeferred).toHaveBeenCalledWith(
      expect.objectContaining({ decision: expect.objectContaining({ action: "allow" }) })
    );
    expect(analytics.trackEvent).not.toHaveBeenCalledWith("block_notice_sent", expect.any(Object));
  });

  it("skips senders with a prior block in the same session", async () => {
    const { useCase, analytics } = buildUseCase({ priorBlockInSession: true });
    await useCase.execute(sampleMessage());
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "moderation_decision",
      expect.objectContaining({ tier: "skipped_prior_block" })
    );
  });
});
