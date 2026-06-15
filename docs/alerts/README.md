# Alerts

Alert rule definitions for **secretchatonly-bot**. Source files in [alerts/](../../alerts/). Applied via `./cmd/apply-alerts` (API upsert — no file drop or reload).

| File | Platform | API |
|------|----------|-----|
| `grafana.json` | Grafana / Mimir | `PUT /api/v1/provisioning/alert-rules/{uid}` |
| `kibana.json` | Kibana / Elasticsearch | `POST/PUT /api/alerting/rule/{id}` |

## Grafana (Mimir)

Rules appear under folder **secretchatonly-bot** in Grafana → Alerting → Alert rules.

| Rule | PromQL / condition | Severity | When |
|------|-------------------|----------|------|
| `scb-onboarding-failures-high` | `sum(rate(analytics_events_total{event="onboarding_failed"}[15m])) > 0.05` | warning | Onboarding auth failing repeatedly |
| `scb-no-analytics-events-{env}` | zero `analytics_events_total` rate for 20m | critical | Telemetry or app likely down |
| `scb-moderation-decisions-absent-{env}` | no `moderation_decision` events in 2h | warning | Business automation not ingesting |

Datasource: Mimir (`uid: mimir`). `__ENV__` in `grafana.json` is patched to `test` or `production` at apply time.

## Kibana (Elasticsearch)

Run **`./cmd/apply-dashboards`** first if the analytics index is not bootstrapped.

### Analytics index (`secretchatonly-bot-analytics`)

| Rule | Query | When |
|------|-------|------|
| onboarding failed spike | `event: "onboarding_failed"` count > 5 in 15m | Auth flow broken |
| no moderation decisions | no `moderation_decision` in 2h (per env) | Business automation not ingesting |

### Ops logs (`filebeat-*`)

| Rule | Query | When |
|------|-------|------|
| ops error rate high | `level: "error"` + `container.name: *secretchatonly*` > 10 in 5m | Runtime errors |
| ops action queue failed | `message: "action_queue_task_failed"` | Moderation action failures |

## Applying

```bash
./cmd/apply-alerts --on-mono   # from laptop
./cmd/apply-alerts             # on mono host
```

Set notification channels on mono (Slack, email, PagerDuty) in Grafana/Kibana UI — not stored in this repo.

See also [analytics.md](../telemetry/analytics.md) and [logging.md](../telemetry/logging.md).
