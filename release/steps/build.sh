#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

if [[ "$STAGING" == "live" ]]; then
  docker build -t "$IMAGE_HOST" .
  if [[ "$IMAGE_HOST" != "$IMAGE" ]]; then
    docker tag "$IMAGE_HOST" "$IMAGE"
  fi
else
  docker build -t "$IMAGE_HOST" .
  docker push "$IMAGE_HOST"
  if [[ "$IMAGE_HOST" != "$IMAGE" ]]; then
    docker tag "$IMAGE_HOST" "$IMAGE"
  fi
fi
