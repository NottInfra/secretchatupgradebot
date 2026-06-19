#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

export IMAGE CONTAINER_NAME VAULT_READ_TOKEN

COMPOSE_FILE="$RELEASE_FILE"
COMPOSE_PROJECT="$CONTAINER_NAME"

# Compose project used to default to the checkout directory (e.g. secretchatupgradebot).
# After switching to -p "$CONTAINER_NAME", stale containers from the legacy project
# still hold container_name / host port — tear them down first.
LEGACY_PROJECT="${CI_PROJECT_NAME:-$(basename "$PWD")}"
if [[ "$LEGACY_PROJECT" != "$COMPOSE_PROJECT" ]]; then
  docker compose -p "$LEGACY_PROJECT" -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
fi

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  managed_id="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps -q 2>/dev/null | head -1 || true)"
  existing_id="$(docker container inspect -f '{{.Id}}' "$CONTAINER_NAME")"
  if [[ -z "$managed_id" || "$managed_id" != "$existing_id" ]]; then
    docker rm -f "$CONTAINER_NAME"
  fi
fi

docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps
