#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh" "${1:?staging required}"
branch_gate

command -v make >/dev/null 2>&1 || { echo "[!] make required for unit tests" >&2; exit 1; }
make test
