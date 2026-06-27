# Dashboards (source of truth)

UI exports for **secretchatonly-bot**. Not deployed by app CI — import on **mono** separately.

| File | Platform |
|------|----------|
| `grafana.json` | Grafana / Mimir |
| `kibana.ndjson` | Kibana / Elasticsearch |

## Apply (from laptop)

```bash
./cmd/apply-dashboards --on-mono   # from laptop → SSH to mono
./cmd/apply-alerts --on-mono
```

On the mono host (ES/Kibana/Grafana on localhost):

```bash
./cmd/apply-dashboards
./cmd/apply-alerts
```

Credentials (`GRAFANA_ADMIN_*`, optional `ELASTIC_*`) load from `.env.test` / `.env.production` — same Vault path as app secrets via `./cmd/apply-env-file-hashicorp`. Scripts no longer read `/var/lib/mono/.env`.

Requires SSH to mono for `--on-mono`. One password prompt per run (single SSH session). Add your SSH key to skip passwords: `ssh-copy-id root@104.152.211.241`

| Choice | `DASHBOARD_ENV` / `ALERTS_ENV` |
|--------|--------------------------------|
| test (default) | `test` |
| live | `production` |

## Where to look after deploy

| Signal | Where |
|--------|--------|
| Bot startup, `/toggle`, moderation flow | `docker logs <container>` or Kibana Discover on **`logstash-*`**, filter `container.name: *secretchatonly*` |
| Event counts / rates | **Grafana** dashboard (`analytics_events_total` + **Traces** panel / Tempo), environment = `test` or `production` |
| Analytics saved searches dashboard | **Kibana** `secretchatonly-bot-analytics` (OTLP logs + bootstrap doc) |

`apply-dashboards` runs ES index template + bootstrap, Kibana import, and Grafana dashboard import in one pass. Must complete through **field caps** (200 JSON) — not just the index template line. If ES was unreachable, you ran against Mac localhost instead of mono.

Mono runs **Kibana 8.12** — NDJSON must use `typeMigrationVersion` and `fieldFormatMap` (match `devops/servers/mono/configs/kibana/objects/minecraft.ndjson`). Hand-crafted `migrationVersion` causes **mapping set to strict** on the `.kibana` index.

Data view name: **`secretchatonly-bot-analytics`** (exact data stream, no `*`).

After real analytics data, add KQL filters in saved searches (see descriptions in Kibana).

## Grafana

Dashboard UID/title include the environment (`secretchatonly-bot-test` / `secretchatonly-bot-production`). Datasource UID `mimir`.

## Mono GitOps paths (when used)

- `devops/servers/mono/configs/kibana/dashboards/secretchatonly-bot.ndjson`
- `devops/servers/mono/configs/grafana/dashboards/secretchatonly-bot.json`
- `devops/servers/mono/configs/elasticsearch/index-templates/secretchatonly-bot-analytics.json` ← same shape as `observability_analytics_index_template_body` in `cmd/lib/observability.sh` (`{project}-analytics*`, dynamic mappings)
- `devops/servers/mono/configs/grafana/provisioning/alerting/secretchatonly-bot-{test,production}.yml` ← written by `apply-alerts`
