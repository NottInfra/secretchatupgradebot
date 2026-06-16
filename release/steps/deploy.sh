#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

export IMAGE CONTAINER_NAME HOST_PORT CONTAINER_PORT VAULT_READ_TOKEN

docker compose -f "$RELEASE_FILE" up -d --force-recreate --remove-orphans
docker compose -f "$RELEASE_FILE" ps
