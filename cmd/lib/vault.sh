#!/usr/bin/env bash
# Vault HTTP helpers (mono: http://vault:8200 · dev NetBird: http://mono:8090).
set -euo pipefail

vault_require() {
  command -v curl >/dev/null || { echo "[!] curl required" >&2; exit 1; }
  command -v jq >/dev/null || { echo "[!] jq required" >&2; exit 1; }
  [[ -n "${VAULT_ADDR:-}" ]] || { echo "[!] export VAULT_ADDR" >&2; exit 1; }
  VAULT_ADDR="${VAULT_ADDR%/}"
}

vault_token_admin() {
  [[ -n "${VAULT_TOKEN:-}" ]] || { echo "[!] export VAULT_TOKEN" >&2; exit 1; }
}

vault_token_read() {
  printf '%s' "${VAULT_READ_TOKEN:-${VAULT_TOKEN:-}}"
}

# Dev workaround: load VAULT_* + GITLAB_* from sibling devops mono .env (not in this repo).
_mono_source_dev_env() {
  local root mono_dir f
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  for mono_dir in \
    "${root}/../devops/servers/mono" \
    "${HOME}/Documents/devops/servers/mono"; do
    [[ -d "$mono_dir" ]] || continue
    for f in "${mono_dir}/.env.local" "${mono_dir}/.env"; do
      [[ -f "$f" ]] || continue
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
    done
    return 0
  done
  return 1
}

vault_load_dev_credentials() {
  _mono_source_dev_env || true
  [[ -n "${VAULT_ADDR:-}" && -n "${VAULT_TOKEN:-}" ]] && return 0

  local root mono_dir f
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  for mono_dir in \
    "${root}/../devops/servers/mono" \
    "${HOME}/Documents/devops/servers/mono"; do
    [[ -d "$mono_dir" ]] || continue
    if [[ -n "${VAULT_ADDR:-}" ]]; then
      echo "[i] Vault creds from ${mono_dir}/.env(.local)"
      export VAULT_ADDR VAULT_TOKEN VAULT_READ_TOKEN
      return 0
    fi
  done
  return 1
}

vault_health() {
  vault_require
  curl -fsS "${VAULT_ADDR}/v1/sys/health?standbyok=true&sealedcode=503&uninitcode=503" >/dev/null
}

vault_read_secret_json() {
  local path="$1" token
  token="$(vault_token_read)"
  [[ -n "$token" ]] || { echo "[!] VAULT_READ_TOKEN or VAULT_TOKEN required" >&2; return 1; }
  curl -fsS -H "X-Vault-Token: ${token}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" 2>/dev/null \
    | jq -c '.data.data // {}' || echo '{}'
}

vault_read_version() {
  local path="$1" token
  token="$(vault_token_read)"
  curl -fsS -H "X-Vault-Token: ${token}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" 2>/dev/null \
    | jq -r '.data.metadata.version // empty' || true
}

vault_materialize() {
  local path="$1" out="$2" token tmp
  vault_require
  token="$(vault_token_read)"
  [[ -n "$token" ]] || { echo "[!] VAULT_READ_TOKEN or VAULT_TOKEN required" >&2; return 1; }
  tmp="$(mktemp)"
  if ! curl -fsS -H "X-Vault-Token: ${token}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "[!] Vault miss: secret/${path}" >&2
    return 1
  fi
  {
    echo "# secret/${path} @ ${VAULT_ADDR}"
    jq -r '.data.data // {} | to_entries[] | "\(.key)\t\(.value)"' "$tmp" | while IFS=$'\t' read -r key val; do
      [[ -n "$key" ]] || continue
      printf '%s=%q\n' "$key" "$val"
    done
  } >"$out"
  rm -f "$tmp"
  chmod 600 "$out"
  echo "[+] ${out} ← secret/${path}"
}

env_file_to_json() {
  local file="$1"
  jq -cn --rawfile raw "$file" '
    ($raw | split("\n")) as $lines
    | reduce $lines[] as $l ({};
        if ($l | test("^[[:space:]]*(#|$)")) then .
        else ($l | capture("^(?<k>[^=]+)=(?<v>.*)$")) as $m
        | if $m then . + {($m.k | gsub("^[[:space:]]+|[[:space:]]+$";"")): ($m.v | gsub("^[[:space:]]+|[[:space:]]+$";""))} else . end
        end)
  '
}

env_file_get() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 1
  env_file_to_json "$file" | jq -r --arg k "$key" '.[$k] // empty'
}

env_file_set() {
  local key="$1" val="$2" file="$3" tmp found=0 line
  [[ -f "$file" ]] || touch "$file"
  tmp="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^${key}= ]]; then
      printf '%s=%s\n' "$key" "$val" >>"$tmp"
      found=1
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$file"
  [[ "$found" -eq 1 ]] || printf '%s=%s\n' "$key" "$val" >>"$tmp"
  mv "$tmp" "$file"
}

vault_secret_get() {
  local path="$1" key="$2"
  vault_read_secret_json "$path" | jq -r --arg k "$key" '.[$k] // empty'
}

vault_merge_key() {
  local path="$1" key="$2" val="$3" merged
  merged="$(jq -n \
    --argjson v "$(vault_read_secret_json "$path")" \
    --arg k "$key" \
    --arg val "$val" \
    '$v + {($k): $val}')"
  vault_write_secret "$path" "$merged"
}

vault_write_secret() {
  local path="$1" json="$2"
  vault_require
  vault_token_admin
  curl -fsS -X POST \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "{\"data\":${json}}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" >/dev/null
}

# Scoped read policy + token for CI (secret/data/{path} only).
vault_ci_read_policy_name() {
  printf 'ci-read-%s' "$1"
}

vault_ensure_ci_read_policy() {
  local path="$1" policy_name hcl
  vault_require
  vault_token_admin
  policy_name="$(vault_ci_read_policy_name "$path")"
  hcl="$(cat <<EOF
path "secret/data/${path}" {
  capabilities = ["read"]
}
path "secret/metadata/${path}" {
  capabilities = ["read"]
}
EOF
)"
  curl -fsS -X PUT \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n --arg p "$hcl" '{policy: $p}')" \
    "${VAULT_ADDR}/v1/sys/policies/acl/${policy_name}" >/dev/null
  printf '%s' "$policy_name"
}

vault_create_ci_read_token() {
  local path="$1" policy_name display tmp
  vault_require
  vault_token_admin
  policy_name="$(vault_ensure_ci_read_policy "$path")"
  display="ci-${path}-$(date +%Y%m%d)"
  tmp="$(mktemp)"
  curl -fsS -X POST \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n \
      --arg pol "$policy_name" \
      --arg name "$display" \
      '{policies: [$pol], period: "8760h", display_name: $name, no_default_policy: true}')" \
    "${VAULT_ADDR}/v1/auth/token/create" >"$tmp"
  jq -r '.auth.client_token' "$tmp"
  rm -f "$tmp"
}

vault_verify_read_token() {
  local path="$1" token="$2"
  vault_require
  curl -fsS -H "X-Vault-Token: ${token}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" >/dev/null
}
