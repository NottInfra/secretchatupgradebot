#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

WORKDIR="$(cd "${CI_PROJECT_DIR:-$PWD}" && pwd)"

if ! command -v sentrux >/dev/null 2>&1; then
  echo "[i] sentrux not installed — skip architecture check"
  exit 0
fi

[[ -f "${WORKDIR}/.sentrux/rules.toml" ]] || {
  echo "[!] .sentrux/rules.toml missing in ${WORKDIR}" >&2
  exit 1
}

echo "[+] sentrux check workdir=${WORKDIR}"
(
  cd "$WORKDIR"
  sentrux check .
)
