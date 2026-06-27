# secretchatonly-bot

Telegram Business moderation for account owners who want to filter unsolicited DMs without manually policing every chat.

The bot watches incoming private messages on a linked Business account, applies a consistent three-strike policy (warning → final warning → block), and can execute blocks through Telegram’s contact block list when the owner has completed onboarding.

## What it does

| Concern | Behaviour |
|---------|-----------|
| **Inbound DMs** | Counts distinct message *instances* per sender (bursts within a collapse window count as one). |
| **1st–2nd instance** | Sends an HTML warning reply via Business automation, with A/B-tested copy and optional media from `assets/messages/`. |
| **3rd+ instance** | Queues a block: TDLib adds the sender to the owner’s block list, then sends the block message via Business automation. |
| **Prior block** | If the sender was already blocked on another linked session, the owner gets an optional prompt to block on this account too. |
| **Owner control** | Management bot commands: `/start` (onboarding), `/toggle` (enable/disable moderation per owner), policy commands (`/help`, `/terms`, `/commitment`). |

Moderation only runs for owners who are onboarded, have an active session with the session provider, and have moderation enabled.

## How it fits together

```
Telegram Business DM
       │
       ▼
Bot API (Telegraf) ── business_message / business_connection updates
       │
       ▼
ProcessIncomingMessageUseCase ── tier + experiments + Postgres history
       │
       ├── warning ──► Business automation HTML reply (+ media)
       │
       └── block ──► Session provider ──► TDLib setMessageSenderBlockList
                              └── then Business automation block message
```

- **Bot API (Telegraf)** — management commands and Business automation replies (warnings, block copy). Direct egress; no Tor on the Bot API path.
- **Session provider + TDLib** — owner login, session lifecycle, and contact blocking on the owner’s account.
- **Postgres** — message history, action logs, per-owner moderation toggle.
- **Observability** — structured logs, analytics events, traces (see [docs/telemetry/](docs/telemetry/)).

## Repository layout

| Path | Role |
|------|------|
| `src/internal/app/` | Telegraf wiring, routes, management controllers |
| `src/internal/moderation/` | Tier logic, experiments, block/warning handlers |
| `src/internal/session/` | Owner sessions, block onboarding |
| `src/internal/notifications/` | Business automation + client notifications |
| `assets/messages/` | Warning/block HTML variants and manifests |
| `assets/db.sql` | Schema reference |
| `docs/` | Ops, interfaces, telemetry, alerts |
| `release/` | CI build, test, scan, deploy |
| `cmd/` | Vault env push, dashboard/alert apply scripts |

## Further reading

- [Operations](docs/ops.md) — deploy, environments, secrets, observability
- [Telegram interfaces](docs/interfaces/telegram-bot.md) — Bot API vs session provider, inbound paths, onboarding
- [Telemetry](docs/telemetry/README.md) — logging, analytics, tracing
- [Alerts](docs/alerts/README.md) — Kibana/Grafana rules
