#!/usr/bin/env bash
# Test pipeline wrapper — delegates to standalone release/steps scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step="${1:-all}"
run() { bash "${ROOT}/release/steps/$1.sh" test; }

case "$step" in
  build) run build ;;
  unit-test) run unit-test ;;
  scan|trivy) run trivy ;;
  sonar) run sonar ;;
  deploy) run deploy ;;
  all)
    run build
    run unit-test
    run trivy
    run sonar
    run deploy
    ;;
  *)
    echo "[!] unknown step: $step (build|unit-test|scan|sonar|deploy|all)" >&2
    exit 1
    ;;
esac
