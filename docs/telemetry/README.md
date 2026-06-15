# Telemetry

Observability for **secretchatonly-bot** on mono. Three app signals plus platform artifacts in-repo.

| Signal | Doc | App module | Destination | UI |
|--------|-----|------------|-------------|-----|
| **Ops logs** | [logging.md](logging.md) | `Logger` → stdout | Elasticsearch (Filebeat) | Kibana |
| **Business analytics** | [analytics.md](analytics.md) | `Analytics` → OTEL | Mimir **and** Elasticsearch | Grafana + Kibana |
| **Traces** | [tracing.md](tracing.md) | `withSpan` → OTEL | Tempo | Grafana |

## Platform artifacts

Applied on mono async (not app CI):

| Kind | Repo path | Docs |
|------|-----------|------|
| Dashboards | [dashboards/](../../dashboards/) | [dashboards/README.md](../../dashboards/README.md) |
| Alerts | [alerts/](../../alerts/) | [alerts/README.md](../alerts/README.md) |

**Grafana** (Mimir + Tempo): aggregate metrics, trace explore, alert on counters.

**Kibana** (Elasticsearch): ops log search ([logging.md](logging.md)) and business analytics event detail ([analytics.md](analytics.md)).

Ops logs and business analytics are **different indices** in Elasticsearch — do not conflate them.
