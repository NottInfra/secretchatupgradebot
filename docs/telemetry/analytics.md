# secretchatonly-bot analytics

Business telemetry via `Analytics.trackEvent(...)` in `src/utils/analytics.ts`.

Each event is exported to **Mimir metrics** and **Elasticsearch** (`secretchatonly-bot-analytics` via OTLP logs). Ops logs (including some events like `moderation_toggled`) go to **stdout → Filebeat → `logstash-*`** in Kibana Discover.

| Destination | Path | Question it answers | UI |
|-------------|------|---------------------|-----|
| **Mimir** | App → OTLP `/v1/metrics` → otel-collector → Mimir | How many? What rate? Per `event` label? | Grafana — [dashboards/grafana.json](../../dashboards/grafana.json) |
| **Ops logs (ELK)** | App → stdout JSON → Filebeat → Logstash → `logstash-*` | What happened in the process? grep by `message` | Kibana Discover (`logstash-*` data view) |
| **Elasticsearch analytics stream** | App → OTLP `/v1/logs` → otel-collector → `secretchatonly-bot-analytics` | Searchable event documents | [dashboards/kibana.ndjson](../../dashboards/kibana.ndjson) |

Counter in Mimir: `analytics_events_total` with labels `event`, prop attributes, `deployment_environment` (from OTEL resource via collector `resource_to_telemetry_conversion`).

Each `trackEvent` also emits an OTLP log that the collector writes to **`secretchatonly-bot-analytics`** (`mapping.mode: raw` — log attributes become ES fields). `apply-dashboards` still posts a one-off `import_bootstrap` doc so Kibana has field caps before live data arrives.

### Elasticsearch document shape

One document per `trackEvent` (OTLP log → collector `bodymap` → data stream):

```json
{
  "@timestamp": "2026-06-13T12:00:00.000Z",
  "service.name": "secretchatonly-bot",
  "deployment.environment": "test",
  "event": "moderation_decision",
  "senderId": "123456789",
  "chatId": "987654321",
  "tier": "first_warning",
  "action": "allow",
  "experiment": "level1_message_warning",
  "variant": "v2"
}
```

Props from the event catalog are flattened as top-level fields where possible. `event` is always present.

This is **not** the ops log index (Filebeat container stdout). Ops logs are separate — see [logging.md](logging.md). Alerts: [docs/alerts/README.md](../alerts/README.md).

No Postgres table. See [tracing.md](tracing.md) for workflow spans (Tempo).

## Event catalog

### `moderation_duplicate_inbound_skipped`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** The same Telegram `(chat_id, message_id)` was already processed (typically MTProto + Bot API/automation duplicate delivery).
- **Props:** `senderId`, `chatId`, `messageId`, `source` (`mtproto` | `bot_api_automation` | `unknown`)

### `moderation_decision`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** Incoming non-secret message is evaluated for the 3-step flow (level-1 warning → level-2 final warning → block), or skipped for a chat-scoped prior block
- **Props:** `senderId`, `chatId`, `action`, `confidence`, optional `reason`, optional `experiment`, optional `variant`, `tier` (`first_warning` | `second_warning` | `block` | `skipped_prior_block`)

### `user_ensure_rejected`

- **Source:** `src/middleware/handle-user-middleware.ts`
- **When:** Routed update has invalid Telegram user payload (`telegramId == 0`)
- **Props:** `status=invalid`, `reason=zero_telegram_id`, `chatId`

### `policy_sent`

- **Source:** `src/use-cases/handle-policy.ts`
- **When:** Policy command is processed (`/help`, `/terms`, `/commitment`)
- **Props:** `userId`, `command`, `sent`

### `policy_requested`

- **Source:** `src/use-cases/handle-policy.ts`
- **When:** Policy command is received before file delivery
- **Props:** `userId`, `command`

### `onboarding_start`

- **Source:** `src/use-cases/onboarding.ts`
- **When:** `/start` onboarding flow is entered
- **Props:** `userId`

### `onboarding_text`

- **Source:** `src/use-cases/onboarding.ts`
- **When:** Any onboarding text input is handled
- **Props:** `userId`, `textLength`

### `onboarding_completed`

- **Source:** `src/use-cases/onboarding.ts`
- **When:** Telegram auth succeeds and session is activated
- **Props:** `userId`

### `onboarding_failed`

- **Source:** `src/use-cases/onboarding.ts`
- **When:** Onboarding auth flow fails
- **Props:** `userId`, `error`

### `cross_account_prior_block_detected`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** First warning sent and sender was previously blocked on a different owner's account
- **Props:** `senderId`, `chatId`, `sessionId`

### `prior_block_owner_prompt_sent`

- **Source:** `src/use-cases/send-prior-block-owner-prompt.ts`
- **When:** Mgmt bot sends "Block now" inline button to account owner
- **Props:** `ownerUserId`, `senderId`, `chatId`

### `prior_block_owner_confirmed`

- **Source:** `src/use-cases/handle-owner-block-callback.ts`
- **When:** Owner taps "Block now" and block succeeds (requires MTProto session from `/start`)
- **Props:** `ownerUserId`, `senderId`, `chatId`, `experiment`, `variant`

### `prior_block_owner_block_skipped_no_session`

- **Source:** `src/use-cases/handle-owner-block-callback.ts`
- **When:** Owner tapped block but has no onboarded GramJS session
- **Props:** `ownerUserId`, `senderId`

### `prior_block_owner_prompt_expired`

- **Source:** `src/use-cases/handle-owner-block-callback.ts`
- **When:** Stale or invalid block-offer token on callback
- **Props:** `ownerUserId`, `token`

### `first_message_reply_sent`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** First non-secret incoming message is replied to (`message-warning` copy)
- **Props:** `senderId`, `chatId`, `experiment`, `variant`, `hasMedia`

### `second_message_warning_sent`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** Second non-secret incoming message is replied to (`message-warning-final` copy)
- **Props:** `senderId`, `chatId`, `experiment`, `variant`, `hasMedia`

### `sender_block_queued`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** Third or later non-secret message queues block execution (`messages-block` copy)
- **Props:** `senderId`, `chatId`, `experiment`, `variant`

### `moderation_skipped_prior_block`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** A prior `block` decision already exists for the same `(senderId, chatId)` pair, so no additional warning/block action is sent
- **Props:** `senderId`, `chatId`

### `block_notice_sent`

- **Source:** `src/use-cases/process-incoming-message.ts`
- **When:** Client block notification is attempted
- **Props:** `senderId`, `sessionId`, `sentViaBot`, `experiment`, `variant`

## Experiments

`experiment` and `variant` are stamped by `ExperimentService` (`src/services/experiment-service.ts`). Active manifests:

- **`level1_message_warning`** — `assets/messages/message-warning/manifest.json` (first reply)
- **`level2_message_warning_final`** — `assets/messages/message-warning-final/manifest.json` (second reply)
- **`level3_messages_block`** — `assets/messages/messages-block/manifest.json` (block DM)

For moderation steps, tiers use **`assignModerationTier`**, which hashes `moderation_flow_2026_05:${senderId}` and takes `digest % totalWeight` for each manifest. Tier 2 and tier 3 both use total weight 2, so the **same variant id** is chosen for the final warning and the block message for a given sender. Tier 1 uses total weight 4 (four first-warning variants).

### Query examples

**Grafana (Mimir)** — volume by tier:

```promql
sum by (event, experiment, variant) (
  increase(analytics_events_total{event=~"first_message_reply_sent|second_message_warning_sent|sender_block_queued"}[7d])
)
```

**Kibana (Elasticsearch)** — moderation decisions by tier:

```
event: "moderation_decision" AND deployment.environment: "test"
```

Aggregate on `tier.keyword`, `experiment.keyword`, `variant.keyword`.

**Kibana** — onboarding funnel:

```
event: (onboarding_start OR onboarding_completed OR onboarding_failed)
```

Skip visibility (Postgres `action_logs`, not analytics index):

```sql
SELECT created_at, sender_id, chat_id, decision_json
FROM action_logs
WHERE decision_json->>'action' = 'ignore'
  AND decision_json->>'reason' = 'prior_block_in_chat_skip'
ORDER BY created_at DESC
LIMIT 200;
```

## Chat automation (Bot API) vs MTProto

- **Ingest:** `src/routes/bot.ts` runs `ChatAutomationController` first. Updates that carry `business_message` or `message.business_connection_id` are treated as inbound mail for a connected account. The owner user id from `getBusinessConnection` must match an onboarded row in `sessions`.
- **Act:** Warnings and block DMs go through the management bot (`business_connection_id`). **`contacts.Block`** uses a **lazy** GramJS connection on demand (`MtprotoSessionService`).
- **Dedupe:** in-process `InboundMessageDedupe` (TTL ~30m, single Node process).

## Notes

- Analytics export is synchronous OTEL (no Postgres, no in-memory queue): Mimir counter + OTLP log per event.
- Mimir = aggregates; Elasticsearch = searchable event detail. Collector `logs` pipeline → `secretchatonly-bot-analytics`.
