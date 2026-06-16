#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

WORKDIR="$(cd "${CI_PROJECT_DIR:-$PWD}" && pwd)"
SONAR_URL="${SONAR_HOST_URL:-http://sonarqube:9000}"
SCANNER_IMAGE="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:11.5}"
NETWORK="${MONO_NETWORK:-$(mono_network)}"

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "[i] SONAR_TOKEN unset — skip sonar scan"
  exit 0
fi

[[ -f "${WORKDIR}/sonar-project.properties" ]] || {
  echo "[!] sonar-project.properties missing in ${WORKDIR}" >&2
  exit 1
}

if command -v git >/dev/null 2>&1; then
  if git -C "$WORKDIR" rev-parse --is-shallow-repository 2>/dev/null | grep -q '^true$'; then
    echo "[!] shallow git clone — set GIT_DEPTH: \"0\" in CI for Sonar SCM/blame" >&2
    exit 1
  fi
fi

if command -v sonar-scanner >/dev/null 2>&1; then
  echo "[+] sonar-scanner (job image) workdir=${WORKDIR}"
  (
    cd "$WORKDIR"
    export SONAR_HOST_URL="$SONAR_URL"
    export SONAR_TOKEN
    sonar-scanner "-Dsonar.projectKey=${SONAR_KEY}"
  )
else
  echo "[+] sonar-scanner (docker) workdir=${WORKDIR}"
  docker run --rm --network "$NETWORK" \
    -e SONAR_HOST_URL="$SONAR_URL" \
    -e SONAR_TOKEN \
    -v "${WORKDIR}:${WORKDIR}" \
    -w "${WORKDIR}" \
    "$SCANNER_IMAGE" \
    sonar-scanner "-Dsonar.projectKey=${SONAR_KEY}"
fi
