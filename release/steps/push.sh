#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

docker push "$IMAGE_HOST"
if [[ "$IMAGE_HOST" != "$IMAGE" ]]; then
  docker tag "$IMAGE_HOST" "$IMAGE"
fi
