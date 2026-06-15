# Tracing, metrics, and observability on mono

Three signals from the app: ops logs (Filebeat), business analytics (OTEL → ES + Mimir), traces (OTEL → Tempo).

| Signal | App module | Export path | Backend | Query in |
|--------|------------|-------------|---------|----------|
| **Ops logs** | `src/utils/logger.ts` | stdout → **Filebeat** → Elasticsearch | container logs index | **Kibana** — [logging.md](logging.md) |
| **Business analytics** | `src/utils/analytics.ts` | OTLP → collector | Mimir + `secretchatonly-bot-analytics-*` | **Grafana** + **Kibana** — [analytics.md](analytics.md) |
| **Traces** | `withSpan` in `telemetry.ts` | OTLP `/v1/traces` | Tempo | **Grafana** Explore |

No OTLP log export for ops — Filebeat ships container stdout. Business analytics documents are OTLP logs routed by the collector (`analytics.export` attribute) into `secretchatonly-bot-analytics`.

## Pipeline

```
secretchatonly-bot
  │
  ├── Logger ──► stdout ──► Filebeat ──► Elasticsearch (ops logs) ──► Kibana
  │
  └── Analytics + traces ──► OTLP :4318 ──► otel-collector
                    │              ├── metrics ──► Mimir ──► Grafana
                    │              ├── analytics OTLP logs ──► Elasticsearch (`secretchatonly-bot-analytics`) ──► Kibana
                    │              └── traces ──► Tempo ──► Grafana
```

Collector config on mono: `devops/servers/mono/configs/otel-collector.yml`.

## App wiring

| Module | Role |
|--------|------|
| `src/utils/telemetry.ts` | OTEL Node SDK, `withSpan`, `getTracer`, analytics counter |
| `src/utils/logger.ts` | Structured stdout JSON only |
| `src/utils/analytics.ts` | Business events → Mimir counter + OTLP log (Elasticsearch document) |

Platform artifacts: [dashboards/](../../dashboards/), [alerts/](../../alerts/). Overview: [README.md](README.md).

Telemetry is **off** when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Set `OTEL_SDK_DISABLED=true` to force off on mono.

Startup: `initEnv()` → `initTelemetry()` → services (`src/root.ts`).

## Deploy env (compose)

```yaml
OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
OTEL_SERVICE_NAME: secretchatonly-bot
```

Resource attributes: `service.name`, `service.version`, `deployment.environment` (from `NODE_ENV`).

## Local dev (SSH tunnel)

```bash
ssh -N -L 4318:127.0.0.1:4318 root@104.152.211.241
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=secretchatonly-bot
npm run dev
```

---

## Span catalog

Naming: `workflow.step`. Tracers are scoped by domain (`app`, `moderation`, `onboarding`, etc.). Child spans nest under parents via OpenTelemetry context.

### Quick reference

| Span | Tracer | Parent | Source |
|------|--------|--------|--------|
| `app.startup` | `app` | — | `src/root.ts` |
| `app.init_env` | `app` | `app.startup` | `src/root.ts` |
| `app.init_telemetry` | `app` | `app.startup` | `src/root.ts` |
| `app.start_auth_http` | `app` | `app.startup` | `src/root.ts` |
| `app.start_mgmt_bot` | `app` | `app.startup` | `src/root.ts` |
| `app.shutdown` | `app` | — | `src/root.ts` |
| `user.ensure` | `user` | `bot.command` (text path) | `src/middleware/handle-user-middleware.ts` |
| `bot.command` | `bot` | — | `src/routes/bot.ts` |
| `bot.callback` | `bot` | inline button (`owner_block:*`) | `src/routes/bot.ts` |
| `policy.send` | `policy` | `bot.command` | `src/use-cases/handle-policy.ts` |
| `onboarding.flow` | `onboarding` | `bot.command` (`/start`) | `src/use-cases/onboarding.ts` |
| `onboarding.connect` | `onboarding` | `onboarding.flow` | `src/use-cases/onboarding.ts` |
| `onboarding.sign_in` | `onboarding` | `onboarding.flow` | `src/use-cases/onboarding.ts` |
| `onboarding.persist_session` | `onboarding` | `onboarding.flow` | `src/use-cases/onboarding.ts` |
| `auth_http.request` | `auth` | — | `src/bg-services/auth-http-service.ts` |
| `chat_automation.handle_update` | `chat_automation` | — | `src/controllers/chat-automation-controller.ts` |
| `chat_automation.get_business_connection` | `chat_automation` | `chat_automation.handle_update` | `src/controllers/chat-automation-controller.ts` |
| `chat_automation.resolve_session` | `chat_automation` | `chat_automation.handle_update` | `src/controllers/chat-automation-controller.ts` |
| `mtproto.handle_message` | `mtproto` | — | `src/controllers/mtproto-controller.ts` |
| `moderation.process_incoming` | `moderation` | `chat_automation.handle_update` or `mtproto.handle_message` | `src/use-cases/process-incoming-message.ts` |
| `moderation.dedupe` | `moderation` | `moderation.process_incoming` | `src/use-cases/process-incoming-message.ts` |
| `moderation.load_history` | `moderation` | `moderation.process_incoming` | `src/use-cases/process-incoming-message.ts` |
| `moderation.assign_tier` | `moderation` | `moderation.process_incoming` | `src/use-cases/process-incoming-message.ts` |
| `moderation.send_reply` | `moderation` | `moderation.process_incoming` | `src/use-cases/process-incoming-message.ts` |
| `moderation.queue_block` | `moderation` | `moderation.process_incoming` | `src/use-cases/process-incoming-message.ts` |
| `moderation.prior_block_prompt` | `moderation` | first warning + cross-account prior block | `src/use-cases/send-prior-block-owner-prompt.ts` |
| `moderation.owner_block_callback` | `moderation` | mgmt bot "Block now" button | `src/use-cases/handle-owner-block-callback.ts` |
| `moderation.execute_owner_block` | `moderation` | `moderation.owner_block_callback` | `src/use-cases/handle-owner-block-callback.ts` |
| `moderation.execute_block` | `moderation` | action queue task | `src/use-cases/execute-moderation-action.ts` |
| `moderation.resolve_peer` | `moderation` | `moderation.execute_block` | `src/use-cases/execute-moderation-action.ts` |
| `moderation.send_block_message` | `moderation` | `moderation.execute_block` | `src/use-cases/execute-moderation-action.ts` |
| `moderation.block_contact` | `moderation` | `moderation.execute_block` | `src/use-cases/execute-moderation-action.ts` |
| `notification.send` | `notification` | various | `src/services/client-notification-service.ts` |

### Hierarchy

```
app.startup
├── app.init_env
├── app.init_telemetry
├── app.start_auth_http
└── app.start_mgmt_bot

app.shutdown

bot.command
├── user.ensure
├── policy.send          (/help, /terms, /commitment, /sponsor)
└── onboarding.flow      (/start)
    ├── onboarding.connect
    ├── onboarding.sign_in
    └── onboarding.persist_session

auth_http.request        (parallel HTTP server)

chat_automation.handle_update
├── chat_automation.get_business_connection
├── chat_automation.resolve_session
└── moderation.process_incoming
    ├── moderation.dedupe
    ├── moderation.load_history
    ├── moderation.assign_tier
    ├── moderation.send_reply
    └── moderation.queue_block
        └── moderation.execute_block
            ├── moderation.resolve_peer
            ├── moderation.send_block_message
            └── moderation.block_contact

mtproto.handle_message
└── moderation.process_incoming  (same subtree as above)

notification.send        (nested under policy, onboarding, block notice, etc.)
```

---

### `app.startup`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **When:** Process boot — wires services and starts HTTP + management bot
- **Child spans:** `app.init_env`, `app.init_telemetry`, `app.start_auth_http`, `app.start_mgmt_bot`

### `app.init_env`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **Parent:** `app.startup`
- **When:** Vault/env bootstrap (`initEnv()`)

### `app.init_telemetry`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **Parent:** `app.startup`
- **When:** OTEL SDK start (`initTelemetry()`)

### `app.start_auth_http`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **Parent:** `app.startup`
- **When:** Onboarding web challenge server listening

### `app.start_mgmt_bot`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **Parent:** `app.startup`
- **When:** Telegraf management bot long-polling started

### `app.shutdown`

- **Source:** `src/root.ts`
- **Tracer:** `app`
- **When:** SIGINT/SIGTERM — stops bot, auth HTTP, MTProto sessions, store, telemetry

### `user.ensure`

- **Source:** `src/middleware/handle-user-middleware.ts`
- **Tracer:** `user`
- **Parent:** runs before `bot.command` handlers on text updates
- **When:** Telegraf middleware upserts `users` / `group_chats` row
- **Attributes:** `telegram.user_id`, `telegram.chat_id`, `user.status` (`ok` | rejected via throw)
- **Related analytics:** `user_ensure_rejected`

### `bot.command`

- **Source:** `src/routes/bot.ts`
- **Tracer:** `bot`
- **When:** Slash command received (`/start`, `/help`, `/terms`, `/commitment`, `/sponsor`, `/toggle`)
- **Attributes:** `telegram.user_id`, `bot.command`
- **Related logs:** `bot_command_failed`

### `policy.send`

- **Source:** `src/use-cases/handle-policy.ts`
- **Tracer:** `policy`
- **Parent:** `bot.command`
- **When:** Policy HTML file read and sent to user
- **Attributes:** `telegram.user_id`, `policy.command`, `policy.sent`
- **Related analytics:** `policy_requested`, `policy_sent`

### `onboarding.flow`

- **Source:** `src/use-cases/onboarding.ts` (`runAuthFlow`)
- **Tracer:** `onboarding`
- **Parent:** `bot.command` (`/start` → phone received)
- **When:** GramJS phone/code auth through session string persisted
- **Attributes:** `telegram.user_id`
- **Related analytics:** `onboarding_start`, `onboarding_completed`, `onboarding_failed`
- **Related logs:** `onboarding_*`

### `onboarding.connect`

- **Source:** `src/use-cases/onboarding.ts`
- **Tracer:** `onboarding`
- **Parent:** `onboarding.flow`
- **When:** `TelegramClient.connect()` with connect timeout race

### `onboarding.sign_in`

- **Source:** `src/use-cases/onboarding.ts`
- **Tracer:** `onboarding`
- **Parent:** `onboarding.flow`
- **When:** `client.signInUser` — code and 2FA via web challenge

### `onboarding.persist_session`

- **Source:** `src/use-cases/onboarding.ts`
- **Tracer:** `onboarding`
- **Parent:** `onboarding.flow`
- **When:** Session string written to Postgres (`sessions.upsertActive`)

### `auth_http.request`

- **Source:** `src/bg-services/auth-http-service.ts` (Express middleware)
- **Tracer:** `auth`
- **When:** Each HTTP request to `/auth/:token` (GET form, POST submit)
- **Attributes:** `http.method`, `http.route`, `http.status_code`
- **Related logs:** `auth_http_service_started`

### `chat_automation.handle_update`

- **Source:** `src/controllers/chat-automation-controller.ts`
- **Tracer:** `chat_automation`
- **When:** Bot API business automation delivers an inbound DM
- **Attributes:** `telegram.business_connection_id`, `telegram.chat_id`, `telegram.message_id`
- **Related logs:** `chat_automation_*`

### `chat_automation.get_business_connection`

- **Source:** `src/controllers/chat-automation-controller.ts`
- **Tracer:** `chat_automation`
- **Parent:** `chat_automation.handle_update`
- **When:** `getBusinessConnection` Bot API call resolves account owner

### `chat_automation.resolve_session`

- **Source:** `src/controllers/chat-automation-controller.ts`
- **Tracer:** `chat_automation`
- **Parent:** `chat_automation.handle_update`
- **When:** Loads onboarded `sessions` row for owner user id

### `mtproto.handle_message`

- **Source:** `src/controllers/mtproto-controller.ts`
- **Tracer:** `mtproto`
- **When:** GramJS `NewMessage` event for inbound private DM (non-out, non-bot)
- **Attributes:** `telegram.session_id`, `telegram.chat_id`, `telegram.sender_id`, `telegram.message_id`
- **Related logs:** `mtproto_event_handler_failed`

### `moderation.process_incoming`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `chat_automation.handle_update` or `mtproto.handle_message`
- **When:** Core 3-step flow — dedupe, prior-block check, tier, reply or queue block
- **Attributes:** `telegram.chat_id`, `telegram.sender_id`, `telegram.message_id`, `telegram.source`, `moderation.tier`, `moderation.action`, `experiment`, `variant`
- **Related analytics:** `moderation_decision`, `first_message_reply_sent`, `second_message_warning_sent`, `sender_block_queued`, `moderation_skipped_prior_block`, `moderation_duplicate_inbound_skipped`, `block_notice_sent`

### `moderation.dedupe`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.process_incoming`
- **When:** `InboundMessageDedupe.tryClaim(chatId, messageId)`

### `moderation.load_history`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.process_incoming`
- **When:** `countBySender` for tier selection (1st / 2nd / 3rd+ message from sender)

### `moderation.assign_tier`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.process_incoming`
- **When:** `ExperimentService.assignModerationTier` for warning/block variant
- **Attributes:** `moderation.tier` (`first_warning` | `second_warning` | `block`)

### `moderation.send_reply`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.process_incoming`
- **When:** Level-1 or level-2 warning reply (MTProto or business automation path)

### `moderation.queue_block`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.process_incoming`
- **When:** Third+ message — enqueues block task on `ActionQueueService`

### `moderation.execute_block`

- **Source:** `src/use-cases/execute-moderation-action.ts`
- **Tracer:** `moderation`
- **Parent:** action queue worker (child of `moderation.queue_block` trace tree)
- **When:** Block DM sent + `contacts.Block` invoked
- **Attributes:** `telegram.sender_id`, `telegram.chat_id`

### `moderation.resolve_peer`

- **Source:** `src/use-cases/execute-moderation-action.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.execute_block`
- **When:** `resolveOutboundPeer` or `getInputEntity` for block target

### `moderation.send_block_message`

- **Source:** `src/use-cases/execute-moderation-action.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.execute_block`
- **When:** Block template DM via MTProto `sendMessage` or business automation reply

### `moderation.block_contact`

- **Source:** `src/use-cases/execute-moderation-action.ts`
- **Tracer:** `moderation`
- **Parent:** `moderation.execute_block`
- **When:** `Api.contacts.Block` invoke
- **Related logs:** `sender_blocked`, `failed_contacts_block`

### `notification.send`

- **Source:** `src/services/client-notification-service.ts`
- **Tracer:** `notification`
- **When:** Outbound DM to session owner or business automation reply
- **Attributes:** `telegram.client_user_id` or `telegram.chat_id`, `notification.kind`:
  - `text` — `sendToClient`
  - `html` — `sendHTML`
  - `business_html_reply` — `sendBusinessHTMLReply`
- **Related logs:** `client_notification_sent`, `client_notification_failed`, `business_automation_reply_*`

---

## Metrics

| Metric | Source | Labels | Dashboard |
|--------|--------|--------|-----------|
| `analytics_events_total` | `Analytics.trackEvent` | `event`, prop attributes, `deployment_environment` | [dashboards/grafana.json](../../dashboards/grafana.json) |

Event-level search uses Elasticsearch index `secretchatonly-bot-analytics-*` — [dashboards/kibana.ndjson](../../dashboards/kibana.ndjson).

```promql
sum by (event) (rate(analytics_events_total{deployment_environment="test"}[5m]))
```

Business **counts** → analytics + Mimir. Workflow **timing** → spans + Tempo.

---

## Querying

### Grafana — traces (Tempo)

```
{ resource.service.name = "secretchatonly-bot" && name = "moderation.process_incoming" }
```

### Grafana — metrics (Mimir)

Import [dashboards/grafana.json](../../dashboards/grafana.json) (datasource UID `mimir`). Business analytics: [dashboards/kibana.ndjson](../../dashboards/kibana.ndjson).

### Kibana — business analytics (Elasticsearch)

Index `secretchatonly-bot-analytics-*`. See [analytics.md](analytics.md).

### Kibana — ops logs (Filebeat)

Filter parsed stdout JSON — full catalog in [logging.md](logging.md):

- `message: "mgmt_bot_identity_ok"`
- `level: "error"`

---

## Adding spans

Use `withSpan` from `telemetry.ts` (handles attributes, errors, `span.end()`):

```typescript
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const tracer = getTracer("moderation");

await withSpan(tracer, "moderation.process_incoming", async (span) => {
  setSpanAttributes(span, { "telegram.chat_id": chatId });
  // ...
});
```

Add new spans to this catalog when introducing workflows. Keep `Analytics.trackEvent` for aggregation — do not duplicate counts on spans.
