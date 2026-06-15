#!/usr/bin/env bash
# Read docs/project.yml (fixed layout — bash only).
set -euo pipefail

PROJECT_YML="${PROJECT_YML:-docs/project.yml}"

project_root() {
  if [[ -n "${PROJECT_ROOT:-}" ]]; then
    printf '%s' "$PROJECT_ROOT"
    return
  fi
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fi
  PROJECT_ROOT="$root"
  printf '%s' "$root"
}

project_file() {
  local root f
  if [[ "$PROJECT_YML" == /* ]]; then
    f="$PROJECT_YML"
  else
    root="$(project_root)"
    f="${root}/${PROJECT_YML}"
  fi
  [[ -f "$f" ]] || { echo "[!] missing $f" >&2; return 1; }
  printf '%s' "$f"
}

_yaml_top() {
  awk -v k="$1" '$1 == k ":" { print $2; exit }' "$(project_file)"
}

_yaml_section2() {
  local section="$1" key="$2"
  awk -v s="$section:" -v k="$key" '
    $0 == s { on=1; next }
    on && /^[^ #]/ { exit }
    on && $1 == k ":" { print $2; exit }
  ' "$(project_file)"
}

_yaml_section3() {
  local section="$1" sub="$2" key="$3"
  awk -v s="$section:" -v m="$sub:" -v k="$key" '
    $0 == s { on=1; next }
    on && $0 == "  " m { subon=1; next }
    on && subon && /^  [^ ]/ && $0 !~ /^    / { subon=0 }
    on && subon && /^    / && $1 == k ":" { print $2; exit }
  ' "$(project_file)"
}

_yaml_staging_port() {
  local staging="$1" key="$2"
  awk -v st="$staging:" -v k="$key" '
    $0 == "staging:" { on=1; next }
    on && /^[^ #]/ && !/^  / { exit }
    on && $0 == "  " st { ch=1; next }
    on && ch && /^  [^ ]/ && $0 != "  " st { ch=0 }
    on && ch && /^      / && $1 == k ":" { print $2; exit }
  ' "$(project_file)"
}

_yaml_remote() {
  local staging="$1" key="$2"
  awk -v s="  ${staging}:" -v k="$key" '
    $0 ~ /^remotes:/ { on=1; next }
    on && /^[^ #]/ && !/^  / { exit }
    $0 == s { ch=1; next }
    ch && /^  [^ ]/ && $0 != s { ch=0 }
    ch && $1 == k ":" { print $2; exit }
  ' "$(project_file)"
}

_yaml_env_file() {
  local staging="$1"
  awk -v st="$staging" '
    /^env:/ { on=1; next }
    on && /^[^ #]/ && !/^ / { exit }
    on && $0 ~ "^  " st ":[[:space:]]*" {
      sub(/^[^:]*:[[:space:]]*/, "")
      gsub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$(project_file)"
}

project_yaml_get() {
  local path="$1" v
  case "$path" in
    project) _yaml_top project ;;
    group) _yaml_top group ;;
    mono.host) _yaml_section2 mono host ;;
    mono.registry) _yaml_section2 mono registry ;;
    mono.registry_host) _yaml_section2 mono registry_host ;;
    mono.network) _yaml_section2 mono network ;;
    remotes.live.remote) _yaml_remote live remote ;;
    remotes.live.url) _yaml_remote live url ;;
    remotes.live.branch) _yaml_remote live branch ;;
    remotes.live.release) _yaml_remote live release ;;
    remotes.test.remote) _yaml_remote test remote ;;
    remotes.test.url) _yaml_remote test url ;;
    remotes.test.branch) _yaml_remote test branch ;;
    remotes.test.release) _yaml_remote test release ;;
    env.live) _yaml_env_file live ;;
    env.test) _yaml_env_file test ;;
    staging.live.registry_tag) _yaml_section3 staging live registry_tag ;;
    staging.live.ports.host) _yaml_staging_port live host ;;
    staging.live.ports.container) _yaml_staging_port live container ;;
    staging.test.ports.host) _yaml_staging_port test host ;;
    staging.test.ports.container) _yaml_staging_port test container ;;
    staging.test.registry_tag) _yaml_section3 staging test registry_tag ;;
    *) echo "[!] unknown project key: $path" >&2; return 1 ;;
  esac
}

_lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

project_normalize_staging() {
  case "$(_lc "$1")" in
    production|live|prod) echo live ;;
    test|staging) echo test ;;
    *) echo "$1" ;;
  esac
}

project_vault_path() {
  local staging project group g
  staging="$(project_normalize_staging "$1")"
  project="$(project_yaml_get project)"
  group="$(project_yaml_get group)"
  g="$(_lc "$group")"
  if [[ -z "$g" || "$g" == "null" || "$g" == "none" ]]; then
    echo "${staging}-${project}"
  else
    echo "${staging}-${g}-${project}"
  fi
}

# Host env file materialized from Vault — mirrors secret/{vault_project}
project_host_env_file() {
  printf '/root/%s.env' "$(project_vault_path "$1")"
}

project_image() {
  local staging registry project tag
  staging="$(project_normalize_staging "$1")"
  registry="$(project_yaml_get mono.registry)"
  registry="${registry:-registry:5000}"
  project="$(project_yaml_get project)"
  tag="$(project_yaml_get "staging.${staging}.registry_tag")"
  echo "${registry}/${project}:${tag}"
}

# Host Docker daemon (CI build/push via socket) — registry:5000 only resolves on mono network.
project_registry_host() {
  local host
  host="${REGISTRY_HOST:-${REGISTRY:-}}"
  if [[ -n "$host" ]]; then
    printf '%s' "$host"
    return
  fi
  host="$(project_yaml_get mono.registry_host 2>/dev/null || true)"
  printf '%s' "${host:-127.0.0.1:5000}"
}

project_image_host() {
  local staging registry project tag
  staging="$(project_normalize_staging "$1")"
  registry="$(project_registry_host)"
  project="$(project_yaml_get project)"
  tag="$(project_yaml_get "staging.${staging}.registry_tag")"
  echo "${registry}/${project}:${tag}"
}

project_container_name() {
  local staging project
  staging="$(project_normalize_staging "$1")"
  project="$(project_yaml_get project)"
  echo "${project}-${staging}"
}

project_load_staging() {
  local staging
  staging="$(project_normalize_staging "$1")"
  STAGING="$staging"
  PROJECT_NAME="$(project_yaml_get project)"
  IMAGE="$(project_image "$staging")"
  IMAGE_HOST="$(project_image_host "$staging")"
  CONTAINER_NAME="$(project_container_name "$staging")"
  VAULT_PROJECT="$(project_vault_path "$staging")"
  ENV_FILE="$(project_host_env_file "$staging")"
  HOST_PORT="$(project_yaml_get "staging.${staging}.ports.host")"
  CONTAINER_PORT="$(project_yaml_get "staging.${staging}.ports.container")"
  EXPECTED_BRANCH="$(project_yaml_get "remotes.${staging}.branch")"
  RELEASE_FILE="$(project_yaml_get "remotes.${staging}.release")"
  REMOTE_NAME="$(project_yaml_get "remotes.${staging}.remote")"
  REMOTE_URL="$(project_yaml_get "remotes.${staging}.url")"
  SONAR_KEY="$(project_yaml_get mono.sonar_project_key 2>/dev/null || true)"
  SONAR_KEY="${SONAR_KEY:-$PROJECT_NAME}"
  MONO_HOST="$(project_yaml_get mono.host)"
  ENV_SOURCE="$(project_yaml_get "env.${staging}")"
}

# Source docs/project.yml env.{live,test} file (+ optional .env.local override).
project_source_staging_env() {
  local staging="${1:-${STAGING:-}}"
  [[ -n "$staging" ]] || { echo "[!] project_source_staging_env: staging required" >&2; return 1; }
  staging="$(project_normalize_staging "$staging")"
  local root f local_f
  root="$(project_root)"
  f="$(project_yaml_get "env.${staging}")"
  [[ -n "$f" && "$f" != "null" ]] || { echo "[!] No env file for staging $staging in project.yml" >&2; return 1; }
  [[ "$f" == /* ]] || f="${root}/${f}"
  [[ -f "$f" ]] || { echo "[!] Missing env file: $f" >&2; return 1; }
  set -a
  # shellcheck disable=SC1090
  source "$f"
  local_f="${root}/.env.local"
  if [[ -f "$local_f" ]]; then
    # shellcheck disable=SC1090
    source "$local_f"
  fi
  set +a
}

project_export_staging() {
  local staging="${1:?}" fmt="${2:-shell}"
  project_load_staging "$staging"
  local vars=(
    STAGING PROJECT_NAME IMAGE IMAGE_HOST CONTAINER_NAME ENV_FILE HOST_PORT CONTAINER_PORT
    VAULT_PROJECT EXPECTED_BRANCH RELEASE_FILE REMOTE_NAME REMOTE_URL SONAR_KEY MONO_HOST ENV_SOURCE
  )
  local v
  for v in "${vars[@]}"; do
    if [[ "$fmt" == github ]]; then
      printf '%s=%s\n' "$v" "${!v}"
    else
      printf 'export %s=%q\n' "$v" "${!v}"
    fi
  done
}

project_list_staging() {
  awk '/^env:/ { on=1; next } on && /^[^ #]/ && !/^ / { exit } on && /^  [a-z]+:/ { gsub(/:$/, "", $1); print $1 }' "$(project_file)"
}
