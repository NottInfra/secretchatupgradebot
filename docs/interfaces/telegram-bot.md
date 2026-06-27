# Telegram interfaces

How **secretchatonly-bot** talks to Telegram. Two surfaces: **Bot API (Telegraf)** for management and Business automation replies, and **session provider + TDLib** for owner account actions (login, block list).

## Bot API (Telegraf)

**Token:** `MGMT_BOT_TOKEN`  
**Library:** Telegraf in `src/internal/app/mgmt-bot-service.ts`  
**Routes:** `src/internal/app/routes/bot.ts`

| Update type | Handler | Purpose |
|-------------|---------|---------|
| Commands (`/start`, `/toggle`, `/help`, …) | `BotController` | Owner onboarding prompts, moderation toggle, policy text |
| `business_message` | `ChatAutomationController` | Inbound DMs on linked Business accounts → moderation pipeline |
| `business_connection` | `ChatAutomationController` | Connection lifecycle (linked / unlinked) |
| Callback queries | `HandleOwnerBlockCallbackUseCase` | Owner confirms cross-account block offer |

Bot API traffic uses **direct egress**. Do not route Telegraf through Tor — Telegram blocks many Tor exits.

### Business automation replies

Warnings and block copy are sent with `sendMessage` / media via the Business connection (`business_connection_id`), not as the owner’s user client. Implementation: `BusinessAutomationNotifier` → `notifications` port.

Inbound automation messages are normalised in `src/internal/lib/telegram/automation-message.ts` (requires `business_connection_id`).

## Session provider + TDLib

**Config:** `SESSION_PROVIDER_URL`, `SESSION_PROVIDER_USER_ID`, `SESSION_PROVIDER_API_KEY`, `SESSION_PROVIDER_SVC_NAME`, optional `SESSION_PROVIDER_ROOT`  
**Client:** `@sessionprovider/sdk` via `OwnerSessionService` (`src/internal/session/`)

Used for:

1. **Owner onboarding** — `/start` triggers login flow; session provider serves auth UI and returns a TDLib session for the owner’s Telegram account.
2. **Block execution** — at block tier, `ExecuteModerationActionUseCase` calls TDLib `setMessageSenderBlockList` on the owner session, then sends the block HTML via Business automation (block before message avoids duplicate warnings if send fails).
3. **Block onboarding coordinator** — polls session readiness and wires block actions when the owner completes phone/code steps.

Session files on disk are resolved under `SESSION_PROVIDER_ROOT` when the provider returns relative paths.

Live TDLib may use `TELEGRAM_SOCKS_PROXY` (Whonix on mono). Test often runs without it.

## Inbound moderation path

```
business_message (Bot API)
    → ChatAutomationController
    → sessionModerationToggle (owner enabled?)
    → ProcessIncomingMessageUseCase
         ├─ InboundMessageDedupe (chat_id + message_id)
         ├─ instance count + MESSAGE_INSTANCE_COLLAPSE_SECONDS
         ├─ tier: warning (count 1–2) | block (count ≥ 3)
         ├─ ExperimentService → assets/messages/*/manifest.json
         └─ WarningTierHandler | BlockTierHandler
```

**Dedupe:** Same Telegram message may appear only once; duplicates emit `moderation_duplicate_inbound_skipped`.

**Prior block skip:** Senders already blocked (logged) can skip re-moderation; cross-account prior blocks can trigger an owner callback to block on the current account.

## Outbound by tier

| Tier | Telegram surface | Order |
|------|------------------|-------|
| Warning | Business automation HTML (+ optional video from manifest) | Reply only |
| Block | TDLib `setMessageSenderBlockList` | Block contact first |
| Block | Business automation HTML block message | After successful block |

If block fails, the handler may fall back to sending another warning rather than leaving the sender unblocked with block copy only.

## Management commands (owner)

| Command | Effect |
|---------|--------|
| `/start` | Begin session-provider onboarding |
| `/toggle` | Flip `svc_users.active` for this owner |
| `/help`, `/terms`, `/commitment` | Static policy assets |

Moderation applies only when the owner has a live session, onboarding complete, and toggle active.

## What is not in this repo

- **Owner auth web UI** — hosted by the session provider service, not `assets/` in this project.
- **GramJS / MTProto inbound** — removed; inbound moderation is Bot API Business automation only.
- **Tor for Bot API** — not used; proxy applies to TDLib path on live when configured in compose.

## Code map

| Area | Path |
|------|------|
| Telegraf bootstrap | `src/internal/app/mgmt-bot-service.ts` |
| Automation ingress | `src/internal/app/controllers/chat-automation-controller.ts` |
| Moderation core | `src/internal/moderation/process-incoming-message.ts` |
| Block action | `src/internal/moderation/execute-moderation-action.ts` |
| Owner sessions | `src/internal/session/owner-session-service.ts` |
| Message experiments | `assets/messages/message-warning/`, `assets/messages/messages-block/` |
