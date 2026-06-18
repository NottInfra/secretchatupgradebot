#!/usr/bin/env bash
# Write .npmrc for @sessionprovider/sdk from GitLab Package Registry.
# Called before npm ci / docker build (CI: CI_JOB_TOKEN + internal gitlab HTTP on mono).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=../../cmd/lib/project.sh
source "${ROOT}/cmd/lib/project.sh"

STAGING="${1:-${STAGING:-test}}"
STAGING="$(project_normalize_staging "$STAGING")"

PACKAGE_SCOPE="sessionprovider"
PACKAGE_PROJECT_PATH="$(awk '
  /^packages:/ { on=1; next }
  on && /^[^ #]/ && !/^  / { exit }
  on && $0 ~ /^  sessionprovider:/ { sp=1; next }
  sp && /^  [^ ]/ && $0 !~ /^    / { sp=0 }
  sp && $1 == "project_path:" { print $2; exit }
' "$(project_file)")"
PACKAGE_PROJECT_PATH="${PACKAGE_PROJECT_PATH:-nottinfra-limited/session-provider}"

gitlab_project_id() {
  local api_base="$1" token="$2" project_path="$3" encoded
  command -v curl >/dev/null 2>&1 || { echo "[!] curl required to resolve GitLab project id" >&2; return 1; }
  command -v jq >/dev/null 2>&1 || { echo "[!] jq required to resolve GitLab project id" >&2; return 1; }
  encoded="$(jq -rn --arg p "$project_path" '$p|@uri')"
  curl -fsS --header "PRIVATE-TOKEN: ${token}" \
    "${api_base}/projects/${encoded}" | jq -r '.id // empty'
}

AUTH_TOKEN=""
API_V4_URL=""

if [[ -n "${CI:-}" && -n "${CI_JOB_TOKEN:-}" ]]; then
  AUTH_TOKEN="$CI_JOB_TOKEN"
  if [[ -n "${GITLAB_INTERNAL_URL:-}" ]]; then
    API_V4_URL="${GITLAB_INTERNAL_URL%/}/api/v4"
  elif [[ "${CI_API_V4_URL:-}" == *gitlab.nottinfra.co.uk* || "${CI_SERVER_HOST:-}" == "gitlab.nottinfra.co.uk" ]]; then
    API_V4_URL="http://gitlab/api/v4"
  elif [[ -n "${CI_API_V4_URL:-}" ]]; then
    API_V4_URL="$CI_API_V4_URL"
  else
    echo "[!] GitLab CI API URL missing — set GITLAB_INTERNAL_URL or CI_API_V4_URL" >&2
    exit 1
  fi
else
  project_source_staging_env "$STAGING" 2>/dev/null || true
  GITLAB_URL="${GITLAB_URL:-${GITLAB_EXTERNAL_URL:-https://gitlab.nottinfra.co.uk}}"
  GITLAB_URL="${GITLAB_URL%/}"
  AUTH_TOKEN="${GITLAB_TOKEN:-${NPM_TOKEN:-}}"
  API_V4_URL="${GITLAB_URL}/api/v4"
fi

PROJECT_ID="${SESSIONPROVIDER_PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" && -n "$AUTH_TOKEN" ]]; then
  PROJECT_ID="$(gitlab_project_id "$API_V4_URL" "$AUTH_TOKEN" "$PACKAGE_PROJECT_PATH")"
fi

if [[ -z "$AUTH_TOKEN" || -z "$PROJECT_ID" ]]; then
  echo "[!] npm registry auth missing — set CI_JOB_TOKEN (CI) or GITLAB_TOKEN (local)" >&2
  echo "[i] optional CI variable: SESSIONPROVIDER_PROJECT_ID (session-provider project id)" >&2
  exit 1
fi

REGISTRY="${API_V4_URL}/projects/${PROJECT_ID}/packages/npm/"
REGISTRY_HOST="${REGISTRY#https://}"
REGISTRY_HOST="${REGISTRY_HOST#http://}"

cat > .npmrc <<EOF
@${PACKAGE_SCOPE}:registry=${REGISTRY}
//${REGISTRY_HOST}/projects/${PROJECT_ID}/packages/npm/:_authToken=${AUTH_TOKEN}
EOF

echo "[+] npm registry → ${REGISTRY} (@${PACKAGE_SCOPE}/sdk)"

# Docker build on mono cannot reach gitlab.nottinfra.co.uk:443 — patch lockfile host for CI only.
if [[ -n "${GITLAB_INTERNAL_URL:-}" && -f package-lock.json ]]; then
  if [[ ! -f package-lock.json.npm-registry-bak ]]; then
    cp package-lock.json package-lock.json.npm-registry-bak
  fi
  sed 's|https://gitlab.nottinfra.co.uk|http://gitlab|g' package-lock.json.npm-registry-bak > package-lock.json
fi

# Refresh lockfile entry for @sessionprovider/sdk when npm is available (CI build job).
if command -v npm >/dev/null 2>&1; then
  npm install --package-lock-only "@sessionprovider/sdk@^0.1.0"
fi
