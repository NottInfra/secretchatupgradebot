#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=../../cmd/lib/project.sh
source "${ROOT}/cmd/lib/project.sh"

STAGING="${1:-}"
[[ -n "$STAGING" ]] || { echo "[!] staging required: live|test" >&2; exit 1; }
project_load_staging "$STAGING"

branch_gate() {
  local ref="${GITHUB_REF_NAME:-${CI_COMMIT_BRANCH:-}}"
  if [[ -n "$ref" && "$ref" != "$EXPECTED_BRANCH" ]]; then
    echo "Skip: ${ref} != ${EXPECTED_BRANCH}"
    exit 0
  fi
}

mono_network() {
  local n
  n="$(project_yaml_get mono.network 2>/dev/null || true)"
  printf '%s' "${n:-mono}"
}
