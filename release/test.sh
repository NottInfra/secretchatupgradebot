#!/usr/bin/env bash
# Test pipeline — GitLab CI calls this; compose in release/test.yml
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=../cmd/lib/project.sh
source "${ROOT}/cmd/lib/project.sh"
# shellcheck source=lib/mono-ci.sh
source "${ROOT}/release/lib/mono-ci.sh"

project_load_staging test

branch_gate() {
  local ref="${GITHUB_REF_NAME:-${CI_COMMIT_BRANCH:-}}"
  if [[ -n "$ref" && "$ref" != "$EXPECTED_BRANCH" ]]; then
    echo "Skip: ${ref} != ${EXPECTED_BRANCH}"
    exit 0
  fi
}

step="${1:-all}"

run_build() {
  branch_gate
  mono_registry_publish "$IMAGE_HOST" "$IMAGE"
}

run_scan() {
  branch_gate
  mono_trivy_scan "$IMAGE"
}

run_sonar() {
  branch_gate
  mono_sonar_scan "$SONAR_KEY"
}

run_deploy() {
  branch_gate
  export IMAGE CONTAINER_NAME HOST_PORT CONTAINER_PORT VAULT_READ_TOKEN
  docker compose -f "$RELEASE_FILE" up -d --force-recreate --remove-orphans
  docker compose -f "$RELEASE_FILE" ps
}

case "$step" in
  build) run_build ;;
  scan) run_scan ;;
  sonar) run_sonar ;;
  deploy) run_deploy ;;
  all)
    run_build
    run_scan
    run_sonar
    run_deploy
    ;;
  *)
    echo "[!] unknown step: $step (build|scan|sonar|deploy|all)" >&2
    exit 1
    ;;
esac
