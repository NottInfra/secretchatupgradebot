# Alerts

Alert rule definitions for **secretchatonly-bot**, grouped by platform. Source files live in [alerts/](../../alerts/). Applied on mono separately from app deploy (same pattern as [dashboards/](../../dashboards/)).

## Grafana (Mimir)

File: [alerts/grafana.yaml](../../alerts/grafana.yaml)

| Rule | PromQL / condition | Severity | When |
|------|-------------------|----------|------|
| `onboarding_failures_high` | `sum(rate(analytics_events_total{event="onboarding_failed"}[15m])) > 0.1` | warning | Onboarding auth failing repeatedly |
| `no_analytics_events` | `absent(analytics_events_total{deployment_environment="test"})` for 20m | critical | Telemetry or app likely down (per env) |
| `moderation_decisions_drop` | `sum(rate(analytics_events_total{event="moderation_decision"}[1h])) == 0` and business hours | warning | Automation path may be broken |
| `block_queue_stalled` | `increase(analytics_events_total{event="sender_block_queued"}[1h]) > 0` and no `sender_blocked` logs in 30m | warning | Block queue not draining |

Datasource: Mimir (`uid: mimir`). Folder on mono: `secretchatonly-bot`.

Duplicate `no_analytics_events` for `deployment_environment="production"` when live track is active.

## Kibana (Elasticsearch)

File: [alerts/kibana.ndjson](../../alerts/kibana.ndjson)

### Analytics index (`secretchatonly-bot-analytics-*`)

| Rule | Query | When |
|------|-------|------|
| `analytics_onboarding_failed_spike` | `event: "onboarding_failed"` count > 5 in 15m | Auth flow broken |
| `analytics_no_moderation_decisions` | no `event: "moderation_decision"` in 2h (test env) | Business automation not ingesting |
| `analytics_block_without_notice` | `sender_block_queued` without nearby `block_notice_sent` | Block pipeline partial failure |

### Ops logs index (container stdout via Filebeat)

| Rule | Query | When |
|------|-------|------|
| `ops_error_rate_high` | `level: "error"` and `message` matches `secretchatonly-bot` container > 10 in 5m | Runtime errors |
| `ops_mgmt_bot_launch_failed` | `message: "mgmt_bot_launch_failed"` | Bot API path down |
| `ops_action_queue_task_failed` | `message: "action_queue_task_failed"` | Moderation action failures |

Ops log rules use the Filebeat container index pattern on mono (not the analytics index).

## Applying

1. Import or provision from `alerts/grafana.yaml` and `alerts/kibana.ndjson`.
2. Set notification channels on mono (Slack, email, PagerDuty) in Grafana/Kibana UI — not stored in this repo.
3. Tune thresholds per environment after first week of baseline traffic.

See also [analytics.md](../telemetry/analytics.md) for event catalog and [logging.md](../telemetry/logging.md) for ops log keys.
