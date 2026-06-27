# Operations

Runbook for **secretchatonly-bot** on the shared **mono** host. Project wiring lives in [project.yml](project.yml).

## Environments

| Staging | Branch | Remote | Registry tag | Compose |
|---------|--------|--------|--------------|---------|
| **test** | `develop` | GitLab | `test` | [release/test.yml](../release/test.yml) |
| **live** | `main` | GitHub | `prod` | [release/production.yml](../release/production.yml) |

Both deploy to mono (`104.152.211.241`) on the external Docker network `mono`. Containers use Watchtower for image updates after CI push.

**Test vs live differences**

- `NODE_ENV`: `test` vs `production`
- Live compose sets `TELEGRAM_SOCKS_PROXY=socks5h://whonix-socks-front:9050` for TDLib/session-provider egress; test omits it (Bot API still uses direct egress in both).

## CI pipeline

Entry points: [release/test.sh](../release/test.sh) (test), [release/production.sh](../release/production.sh) (live).

| Step | Script | Purpose |
|------|--------|---------|
| build | `release/steps/build.sh` | Docker image |
| unit-test | `release/steps/unit-test.sh` | Vitest + coverage |
| trivy | `release/steps/trivy.sh` | Image scan |
| sonar | `release/steps/sonar.sh` | SonarQube (new-code gate) |
| deploy | `release/steps/deploy.sh` | `docker compose up` on mono |

Image name and container name come from `docs/project.yml` (`secretchatonly-bot`, tag per staging). CI injects `VAULT_READ_TOKEN` so the app loads secrets at runtime.

## Secrets and configuration

**Source of truth (local, gitignored):** `.env.test`, `.env.production` — see [.env.example](../.env.example) for keys.

**Push to Vault:**

```bash
./cmd/apply-env-file-hashicorp test    # or live
```

That script can also mint `VAULT_READ_TOKEN` and sync `SONAR_TOKEN` to GitHub/GitLab for CI.

**Runtime:** `initEnv()` reads Vault (`VAULT_ADDR`, `VAULT_READ_TOKEN`) inside the container. No secrets in the image.

Important runtime keys:

| Key | Use |
|-----|-----|
| `DATABASE_URL` | Postgres |
| `MGMT_BOT_TOKEN` | Telegraf management + Business bot |
| `SESSION_PROVIDER_*` | WebSocket session provider (owner TDLib sessions) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | TDLib |
| `MESSAGE_INSTANCE_COLLAPSE_SECONDS` | Burst collapse for instance counting |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Metrics, logs, traces → otel-collector on mono |

## Database

Schema: [assets/db.sql](../assets/db.sql). Applied outside this repo’s CI (mono Postgres). Core tables:

- `incoming_messages` — one row per moderated inbound message
- `action_logs` — warn / block / approve / ignore decisions
- `svc_users` — per-owner moderation enabled flag
- `users` — Telegram user metadata from bot updates

## Deploy (manual)

On mono, after CI has pushed the image:

```bash
export IMAGE=127.0.0.1:5000/secretchatonly-bot:test   # or :prod
export CONTAINER_NAME=secretchatonly-bot-test         # naming from CI/project
export VAULT_READ_TOKEN=...
docker compose -p "$CONTAINER_NAME" -f release/test.yml up -d --force-recreate
```

Normal path is CI `deploy` step; use manual compose only for recovery or debugging.

## Observability

App exports OTLP to `otel-collector:4318` on mono (`OTEL_SERVICE_NAME=secretchatonly-bot`).

| Signal | Where to look |
|--------|----------------|
| Process logs | Container stdout → Filebeat → Kibana **`logstash-*`** |
| Analytics events | ES data stream **`secretchatonly-bot-analytics`**, Grafana `analytics_events_total` |
| Traces | Tempo (see [telemetry/tracing.md](telemetry/tracing.md)) |

**Apply dashboards and alerts from laptop:**

```bash
./cmd/apply-dashboards --on-mono   # test or live prompt
./cmd/apply-alerts --on-mono
```

Credentials load from the same `.env.*` / Vault path as the app. Details: [dashboards/README.md](../dashboards/README.md), [telemetry/README.md](telemetry/README.md), [alerts/README.md](alerts/README.md).

Useful log events after a block tier: `sender_blocked`, `business_automation_reply_sent`. Failures often show as `failed_contacts_block` or `block_failed_sending_warning`.

## Local development

```bash
npm ci
npm run build:sdk
npm run build
cp .env.example .env.development   # fill in tokens + DATABASE_URL
npm run start
```

Requires Postgres, a running session provider, and a Bot API token with Business mode. Session provider hosts owner auth UI — not this repo.

## Related services

- **sessionprovider** — separate repo; WebSocket API for owner login and TDLib session files
- **mono stack** — Vault, registry, Elasticsearch, Kibana, Grafana, otel-collector, Watchtower

Interface detail: [interfaces/telegram-bot.md](interfaces/telegram-bot.md).
