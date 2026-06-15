# Telegram interfaces

The bot uses **two Telegram stacks** — different protocols, different network paths on mono.

## Stack overview

| Layer | Library | Protocol | Used for |
|-------|---------|----------|----------|
| **Management bot** | Telegraf | Bot API (`api.telegram.org`) | Commands, business automation webhooks, client notifications |
| **User sessions** | GramJS (`telegram`) | MTProto | Login/onboarding, DM moderation actions (block, reply) |

## Network on mono

| Traffic | Route | Env |
|---------|-------|-----|
| Bot API (Telegraf) | **Direct egress** | (none — no HTTP proxy) |
| MTProto (GramJS) | **Tor SOCKS** (when Tor works) | `TELEGRAM_SOCKS_PROXY=socks5h://whonix-socks-front:9050` |
| Vault, registry, Neon | Direct | `VAULT_ADDR`, `DATABASE_URL` |

Telegram **blocks many Tor exits** for Bot API. Do not set `HTTPS_PROXY` / `ALL_PROXY` on the container — that breaks `getMe` and long-polling.

GramJS disables WSS when a SOCKS proxy is configured (library requirement).

## Telegram modules

### `src/services/telegram/gramjs-client.ts`

Factory for `TelegramClient` with:

- GramJS log guards (suppress ping TIMEOUT spam)
- Optional SOCKS from `TELEGRAM_SOCKS_PROXY` (inline env parse; WSS disabled when proxy set)

Used by `mtproto-session-service.ts` and `onboarding.ts`.

### `src/services/telegram/resolve-outbound-peer.ts`

Resolves Telegram peers for outbound MTProto actions (reply, block). Used by `process-incoming-message.ts` and `execute-moderation-action.ts`.

### `src/utils/telemetry.ts`

OTEL export to mono collector (traces → Tempo, metrics → Mimir, analytics logs → Elasticsearch). App stdout → Filebeat separately. See [tracing.md](../telemetry/tracing.md).

## Inbound paths

```
Business DMs (Telegram Business)
  → Bot API (Telegraf) → ChatAutomationController → ProcessIncomingMessageUseCase

User MTProto sessions (after onboarding)
  → GramJS listeners → MtprotoController → ProcessIncomingMessageUseCase
```

Dedupe prevents double-processing when both paths see the same message.

## Auth / onboarding

1. User messages management bot → `OnboardingUseCase`
2. GramJS client connects (via Tor when proxy set) → phone/code flow
3. `AuthHttpService` serves web challenge at `AUTH_HOST_BASE` (port `AUTH_HTTP_PORT`, default 8787)
4. Session string stored in Postgres → `MtprotoSessionService` restores listeners

## Test deploy

- **URL:** `http://104.152.211.241:8788` (host port from `docs/project.yml` staging.test)
- **Bot:** `@scupgradetestbot` (test token in Vault `secret/test-secretchatonly-bot`)
