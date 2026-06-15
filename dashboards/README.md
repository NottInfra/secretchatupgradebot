# Dashboards (source of truth)

UI exports for **secretchatonly-bot**. Not deployed by app CI — import on **mono** separately.

| File | Platform |
|------|----------|
| `grafana.json` | Grafana / Mimir |
| `kibana.ndjson` | Kibana / Elasticsearch |

## Where to look after deploy

| Signal | Where |
|--------|--------|
| Bot startup, `/toggle`, moderation flow | `docker logs <container>` or Kibana Discover on **`logstash-*`**, filter `container.name: *secretchatonly*` |
| Event counts / rates | **Grafana** dashboard (`analytics_events_total`), environment = `test` |
| Analytics saved searches dashboard | **Kibana** `secretchatonly-bot-analytics` — empty until ES document export is implemented |

Apply ES bootstrap before Kibana import: `./cmd/define-elasticsearch --on-mono`

```bash
./cmd/define-elasticsearch --on-mono
```

**On mono host** (ES at 127.0.0.1:9200):

```bash
./cmd/define-elasticsearch
```

Must complete through **field caps** (200 JSON) — not just the index template line. If you only see `== index template ==` and the script stops, ES was unreachable (you ran it against Mac localhost, not mono).

Then delete failed Kibana saved objects and re-import `kibana.ndjson`.

Mono runs **Kibana 8.12** — NDJSON must use `typeMigrationVersion` and `fieldFormatMap` (match `devops/servers/mono/configs/kibana/objects/minecraft.ndjson`). Hand-crafted `migrationVersion` causes **mapping set to strict** on the `.kibana` index, not on analytics data.

```bash
./cmd/import-kibana --on-mono   # or Stack Management → Import after git pull
```

Data view name: **`secretchatonly-bot-analytics`** (exact data stream, no `*`).

After real analytics data, add KQL filters in saved searches (see descriptions in Kibana).

## Grafana

Dashboards → Import → `grafana.json` (datasource UID `mimir`).

## Mono GitOps paths (when used)

- `devops/servers/mono/configs/kibana/dashboards/secretchatonly-bot.ndjson`
- `devops/servers/mono/configs/grafana/dashboards/secretchatonly-bot.json`
- `devops/servers/mono/configs/elasticsearch/index-templates/secretchatonly-bot-analytics.json` ← copy from `assets/elasticsearch/analytics-index-template.json`
