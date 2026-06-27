import path from "node:path";
import type { Analytics } from "../../lib/analytics.js";
import type { Logger } from "../../lib/logger.js";
import type { IClientNotifications } from "../../notifications/ports/client-notifications.port.js";
import { getTracer, setSpanAttributes, withSpan } from "../../lib/telemetry.js";

const policyTracer = getTracer("policy");

export class HandlePolicyUseCase {
  constructor(
    private readonly notifications: IClientNotifications,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async execute(userId: number, command: string): Promise<void> {
    const normalized = command.toLowerCase();
    return withSpan(policyTracer, "policy.send", async (span) => {
      setSpanAttributes(span, { "telegram.user_id": userId, "policy.command": normalized });
      this.analytics.trackEvent("policy_requested", { userId, command: normalized });
    let filePath = "";
    switch (normalized) {
      case "/help":
        filePath = path.resolve("assets/policies/help.html");
        break;
      case "/terms":
        filePath = path.resolve("assets/policies/terms.html");
        break;
      case "/commitment":
        filePath = path.resolve("assets/policies/commitment.html");
        break;
      case "/sponsor":
        filePath = path.resolve("assets/policies/sponsor.html");
        break;
      default:
        return;
    }

    const sent = await this.notifications.sendHTMLFile(String(userId), filePath);
    setSpanAttributes(span, { "policy.sent": sent });
    this.analytics.trackEvent("policy_sent", { userId, command: normalized, sent });
    if (!sent) {
      this.logger.warn("policy_send_failed", { userId, command: normalized, filePath });
    }
    });
  }
}
