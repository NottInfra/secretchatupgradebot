#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

NETWORK="${MONO_NETWORK:-$(mono_network)}"
CLI="${TRIVY_CLI_IMAGE:-aquasec/trivy:0.58.1}"

TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-${PWD}/.trivy-cache}"
mkdir -p "$TRIVY_CACHE_DIR"

# Default: use the mono Trivy server (fast, no external DB downloads).
# Set TRIVY_SERVER="" to run standalone (slower; requires DB downloads).
SERVER="${TRIVY_SERVER:-http://trivy:8080}"

if [[ -n "${SERVER}" ]]; then
  docker run --rm --network "$NETWORK" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${TRIVY_CACHE_DIR}:/root/.cache/trivy" \
    "$CLI" image \
    --server "$SERVER" \
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --exit-code 1 \
    "$IMAGE"
else
  docker run --rm --network "$NETWORK" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${TRIVY_CACHE_DIR}:/root/.cache/trivy" \
    "$CLI" image \
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --exit-code 1 \
    "$IMAGE"
fi
