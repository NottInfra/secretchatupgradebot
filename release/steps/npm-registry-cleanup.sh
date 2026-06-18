#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

rm -f .npmrc

if [[ -f package-lock.json.npm-registry-bak ]]; then
  mv package-lock.json.npm-registry-bak package-lock.json
fi
