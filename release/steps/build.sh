#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

# shellcheck source=npm-registry.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/npm-registry.sh" "$STAGING"

cleanup() {
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/npm-registry-cleanup.sh"
}
trap cleanup EXIT

NETWORK_ARG=()
if [[ -n "${GITLAB_INTERNAL_URL:-}" ]]; then
  NETWORK_ARG=(--network mono)
fi

if [[ "$STAGING" == "live" ]]; then
  docker build "${NETWORK_ARG[@]}" -t "$IMAGE_HOST" .
  if [[ "$IMAGE_HOST" != "$IMAGE" ]]; then
    docker tag "$IMAGE_HOST" "$IMAGE"
  fi
else
  docker build "${NETWORK_ARG[@]}" -t "$IMAGE_HOST" .
  docker push "$IMAGE_HOST"
  if [[ "$IMAGE_HOST" != "$IMAGE" ]]; then
    docker tag "$IMAGE_HOST" "$IMAGE"
  fi
fi
