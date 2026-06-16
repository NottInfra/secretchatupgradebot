#!/usr/bin/env bash
# Live pipeline wrapper — delegates to standalone release/steps scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step="${1:-all}"
run() { bash "${ROOT}/release/steps/$1.sh" live; }

case "$step" in
  build) run build ;;
  unit-test) run unit-test ;;
  scan|trivy) run trivy ;;
  sonar) run sonar ;;
  push) run push ;;
  deploy) run deploy ;;
  all)
    run build
    run unit-test
    run trivy
    run sonar
    run push
    run deploy
    ;;
  *)
    echo "[!] unknown step: $step (build|unit-test|scan|sonar|push|deploy|all)" >&2
    exit 1
    ;;
esac
