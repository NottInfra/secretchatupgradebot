import type { Context, Telegraf } from "telegraf";
import type { BotController } from "../controllers/bot-controller.js";
import type { ChatAutomationController } from "../controllers/chat-automation-controller.js";
import type { HandleUserMiddleware } from "../middleware/handle-user-middleware.js";
import type { IHandleOwnerBlockCallback } from "../../moderation/ports/handle-owner-block-callback.port.js";
import type { IHandlePolicy } from "../use-cases/ports/handle-policy.port.js";
import { getTracer, setSpanAttributes, withSpan } from "../../lib/telemetry.js";

const botTracer = getTracer("bot");

export type BotRouteDeps = {
  controller: BotController;
  chatAutomation: ChatAutomationController;
  handleOwnerBlockCallback: IHandleOwnerBlockCallback;
  handleUserMiddleware: HandleUserMiddleware;
  handlePolicyUseCase: IHandlePolicy;
};

async function dispatchCommand(
  command: string,
  userId: number,
  controller: BotController,
  handlePolicyUseCase: IHandlePolicy
): Promise<void> {
  switch (command) {
    case "/start":
      await controller.handleStart(userId);
      return;
    case "/help":
    case "/terms":
    case "/commitment":
    case "/sponsor":
      await handlePolicyUseCase.execute(userId, command);
      return;
    case "/toggle":
      await controller.handleToggleOnOff(userId);
      return;
    case "/connect":
      await controller.handleConnect(userId);
      return;
    default:
      return;
  }
}

type IncomingText = {
  userId: number;
  chatId: number;
  text: string;
  username: string;
  firstName: string;
  lastName: string;
};

function parseIncomingText(ctx: Context): IncomingText | undefined {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const text = ctx.message && "text" in ctx.message ? ctx.message.text : undefined;
  if (!userId || !text) return undefined;
  return {
    userId,
    chatId: chatId ?? userId,
    text,
    username: ctx.from?.username ?? "",
    firstName: ctx.from?.first_name ?? "",
    lastName: ctx.from?.last_name ?? ""
  };
}

export class BotRoutes {
  constructor(
    private readonly bot: Telegraf,
    private readonly deps: BotRouteDeps
  ) {}

  bind(): void {
    this.bindAutomationMiddleware();
    this.bindOwnerBlockCallback();
    this.bindTextMessages();
  }

  private bindAutomationMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      const handled = await this.deps.chatAutomation.tryHandle(ctx);
      if (handled) return;
      await next();
    });
  }

  private bindOwnerBlockCallback(): void {
    this.bot.on("callback_query", async (ctx) => {
      const userId = ctx.from?.id;
      const callback = ctx.callbackQuery;
      if (!userId || !("data" in callback) || typeof callback.data !== "string" || !callback.data.startsWith("owner_block:")) {
        return;
      }

      await withSpan(botTracer, "bot.callback", async (span) => {
        setSpanAttributes(span, {
          "telegram.user_id": userId,
          "bot.callback": "owner_block"
        });
        const token = callback.data.slice("owner_block:".length);
        const message = await this.deps.handleOwnerBlockCallback.execute(userId, token);
        if (message.length > 200) {
          await ctx.answerCbQuery(message.slice(0, 200), { show_alert: true });
        } else {
          await ctx.answerCbQuery(message);
        }
      });
    });
  }

  private bindTextMessages(): void {
    this.bot.on("text", async (ctx) => {
      await this.handleTextUpdate(ctx);
    });
  }

  private async handleTextUpdate(ctx: Context): Promise<void> {
    const incoming = parseIncomingText(ctx);
    if (!incoming) return;

    await this.deps.handleUserMiddleware.ensureUser(
      {
        telegramId: incoming.userId,
        username: incoming.username,
        firstName: incoming.firstName,
        lastName: incoming.lastName
      },
      incoming.chatId
    );

    if (incoming.text.startsWith("/")) {
      await this.dispatchSlashCommand(incoming.userId, incoming.text);
      return;
    }

    await this.deps.controller.handleText(incoming.userId, incoming.text);
  }

  private async dispatchSlashCommand(userId: number, text: string): Promise<void> {
    const command = text.split(/\s+/)[0].toLowerCase();
    await withSpan(botTracer, "bot.command", async (span) => {
      setSpanAttributes(span, { "telegram.user_id": userId, "bot.command": command });
      await dispatchCommand(command, userId, this.deps.controller, this.deps.handlePolicyUseCase);
    });
  }
}
