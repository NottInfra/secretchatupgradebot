#!/usr/bin/env bash
# Shared mono observability helpers (Elasticsearch, Kibana, Grafana).
set -euo pipefail

observability_mono_ssh() {
  MONO_HOST="$(project_yaml_get mono.host)"
  MONO_SSH_USER="${MONO_SSH_USER:-root}"
  MONO_SSH="${MONO_SSH:-${MONO_SSH_USER}@${MONO_HOST}}"
  OBS_SSH_OPTS=(-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
}

observability_choose_staging() {
  echo ""
  echo "Target environment:"
  echo "  1) live  → DASHBOARD_ENV=production  ALERTS_ENV=production"
  echo "  2) test   → DASHBOARD_ENV=test         ALERTS_ENV=test"
  read -r -p "Choose 1/2 [2]: " choice
  choice="${choice:-2}"
  case "$choice" in
    1)
      STAGING=live
      DASHBOARD_ENV=production
      ALERTS_ENV=production
      ;;
    2)
      STAGING=test
      DASHBOARD_ENV=test
      ALERTS_ENV=test
      ;;
    *)
      echo "[!] Invalid choice"
      exit 1
      ;;
  esac
  export STAGING DASHBOARD_ENV ALERTS_ENV
  project_load_staging "$STAGING"
  project_source_staging_env "$STAGING"
  observability_mono_ssh
  echo "[+] STAGING=$STAGING DASHBOARD_ENV=$DASHBOARD_ENV ALERTS_ENV=$ALERTS_ENV"
}

observability_elastic_auth() {
  OBS_ELASTIC_USERPASS=""
  if [[ -n "${ELASTIC_USER:-}" && -n "${ELASTIC_PASSWORD:-}" ]]; then
    OBS_ELASTIC_USERPASS="${ELASTIC_USER}:${ELASTIC_PASSWORD}"
  fi
}

# macOS bash 3.2 + set -u: optional curl -u (empty auth arrays break "${arr[@]}")
observability_curl_f() {
  local userpass="${1:-}"
  shift
  if [[ -n "$userpass" ]]; then
    curl -fS -u "$userpass" "$@"
  else
    curl -fS "$@"
  fi
}

observability_curl_s() {
  local userpass="${1:-}"
  shift
  if [[ -n "$userpass" ]]; then
    curl -sS -u "$userpass" "$@"
  else
    curl -sS "$@"
  fi
}

observability_write_remote_env() {
  local dest="$1"
  {
    printf 'ES_URL=%q\n' "${ES_URL:-http://127.0.0.1:9200}"
    printf 'KIBANA_URL=%q\n' "${KIBANA_URL:-http://127.0.0.1:5601}"
    printf 'GRAFANA_URL=%q\n' "${GRAFANA_URL:-http://127.0.0.1:3000}"
    printf 'GRAFANA_ADMIN_USER=%q\n' "${GRAFANA_ADMIN_USER:-admin}"
    printf 'GRAFANA_ADMIN_PASSWORD=%q\n' "${GRAFANA_ADMIN_PASSWORD:-}"
    printf 'DASHBOARD_ENV=%q\n' "${DASHBOARD_ENV:-test}"
    printf 'ALERTS_ENV=%q\n' "${ALERTS_ENV:-test}"
    if [[ -n "${ELASTIC_USER:-}" ]]; then
      printf 'ELASTIC_USER=%q\n' "$ELASTIC_USER"
    fi
    if [[ -n "${ELASTIC_PASSWORD:-}" ]]; then
      printf 'ELASTIC_PASSWORD=%q\n' "$ELASTIC_PASSWORD"
    fi
  } >"$dest"
}

observability_grafana_auth() {
  GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:3000}"
  GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
  GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-}"
  if [[ -n "$GRAFANA_ADMIN_PASSWORD" ]]; then
    GRAFANA_USERPASS="${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASSWORD}"
  else
    GRAFANA_USERPASS=""
    echo "[!] GRAFANA_ADMIN_PASSWORD not set — add to .env.test / .env.production (→ Vault via apply-env-file-hashicorp)" >&2
    return 1
  fi
}

observability_ensure_grafana_folder() {
  local grafana_url="$1" folder_uid="$2" title="$3"
  local tmp http_code resp
  tmp="$(mktemp)"
  http_code="$(observability_curl_s "$GRAFANA_USERPASS" -o "$tmp" -w '%{http_code}' \
    "${grafana_url}/api/folders/${folder_uid}")" || http_code="000"
  if [[ "$http_code" == "200" ]]; then
    rm -f "$tmp"
    echo "[+] Grafana folder exists: $folder_uid"
    return 0
  fi
  if [[ "$http_code" != "404" ]]; then
    resp="$(cat "$tmp")"
    rm -f "$tmp"
    echo "$resp" | jq . 2>/dev/null || echo "$resp"
    echo "[!] Grafana folder GET HTTP $http_code"
    return 1
  fi
  rm -f "$tmp"
  tmp="$(mktemp)"
  http_code="$(observability_curl_s "$GRAFANA_USERPASS" -o "$tmp" -w '%{http_code}' \
    -X POST "${grafana_url}/api/folders" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg uid "$folder_uid" --arg title "$title" '{uid: $uid, title: $title}')")" || http_code="000"
  resp="$(cat "$tmp")"
  rm -f "$tmp"
  if [[ "$http_code" =~ ^2 ]] || [[ "$http_code" == "412" ]]; then
    echo "[+] Grafana folder created: $folder_uid"
    return 0
  fi
  echo "$resp" | jq . 2>/dev/null || echo "$resp"
  echo "[!] Grafana folder create HTTP $http_code"
  return 1
}

observability_apply_grafana_alerting_rules() {
  local rules_file="$1"
  local env="$2"
  local grafana_url="${GRAFANA_URL:-http://127.0.0.1:3000}"
  local folder_uid folder_title rule uid tmp http_code resp
  observability_grafana_auth
  echo "== Grafana alerting rules: $grafana_url (ALERTS_ENV=$env) =="
  command -v jq >/dev/null || { echo "[!] jq required"; exit 1; }

  folder_uid="$(jq -r '.folder.uid' "$rules_file")"
  folder_title="$(jq -r '.folder.title' "$rules_file")"
  observability_ensure_grafana_folder "$grafana_url" "$folder_uid" "$folder_title" || exit 1

  while IFS= read -r rule; do
    rule="$(jq --arg env "$env" 'walk(if type == "string" then gsub("__ENV__"; $env) else . end)' <<<"$rule")"
    uid="$(jq -r '.uid' <<<"$rule")"
    echo "   → $uid"
    tmp="$(mktemp)"
    http_code="$(observability_curl_s "$GRAFANA_USERPASS" -o "$tmp" -w '%{http_code}' \
      -X PUT "${grafana_url}/api/v1/provisioning/alert-rules/${uid}" \
      -H 'Content-Type: application/json' \
      -H 'X-Disable-Provenance: true' \
      -d "$rule")" || http_code="000"
    if [[ "$http_code" == "404" ]]; then
      http_code="$(observability_curl_s "$GRAFANA_USERPASS" -o "$tmp" -w '%{http_code}' \
        -X POST "${grafana_url}/api/v1/provisioning/alert-rules" \
        -H 'Content-Type: application/json' \
        -H 'X-Disable-Provenance: true' \
        -d "$rule")" || http_code="000"
    fi
    resp="$(cat "$tmp")"
    rm -f "$tmp"
    if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
      echo "$resp" | jq . 2>/dev/null || echo "$resp"
      echo "[!] Grafana rule $uid HTTP $http_code"
      exit 1
    fi
    echo "[+] Grafana rule OK: $(jq -r '.title // .uid' <<<"$resp" 2>/dev/null || echo "$uid")"
  done < <(jq -c '.rules[]' "$rules_file")
}

observability_apply_elasticsearch() {
  local root="$1"
  local template_file="${root}/assets/elasticsearch/analytics-index-template.json"
  local project_name data_stream template_id
  project_name="$(project_yaml_get project)"
  data_stream="${project_name}-analytics"
  template_id="${data_stream}"
  local es_url="${ES_URL:-http://127.0.0.1:9200}"
  observability_elastic_auth

  [[ -f "$template_file" ]] || { echo "[!] Missing $template_file"; exit 1; }

  echo "== Elasticsearch: $es_url =="
  echo "== index template ($template_id) =="
  observability_curl_f "$OBS_ELASTIC_USERPASS" -X PUT "$es_url/_index_template/$template_id" \
    -H 'Content-Type: application/json' \
    --data-binary "@$template_file"
  echo

  if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
    echo "== bootstrap document → $data_stream =="
    observability_curl_f "$OBS_ELASTIC_USERPASS" -X POST "$es_url/$data_stream/_doc?refresh=wait_for" \
      -H 'Content-Type: application/json' \
      -d "{\"@timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":\"import_bootstrap\",\"deployment.environment\":\"${DASHBOARD_ENV}\"}"
    echo
  fi

  echo "== data stream =="
  observability_curl_f "$OBS_ELASTIC_USERPASS" "$es_url/_data_stream/$data_stream"
  echo
  echo "== field caps =="
  observability_curl_f "$OBS_ELASTIC_USERPASS" "$es_url/$data_stream/_field_caps?fields=event,@timestamp"
  echo
}

observability_import_kibana_ndjson() {
  local kibana_url="$1"
  local ndjson_file="$2"
  echo "== Kibana import: $kibana_url =="
  echo "    file: $ndjson_file"
  local tmp http_code resp
  tmp="$(mktemp)"
  http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "${kibana_url}/api/saved_objects/_import?overwrite=true" \
    -H 'kbn-xsrf: true' \
    --form "file=@${ndjson_file}")" || http_code="000"
  resp="$(cat "$tmp")"
  rm -f "$tmp"
  echo "$resp" | jq . 2>/dev/null || echo "$resp"
  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "[!] Kibana HTTP $http_code"
    exit 1
  fi
  if echo "$resp" | grep -q '"success":true'; then
    echo "[+] Kibana import OK"
    return 0
  fi
  echo "[!] Kibana import reported errors"
  exit 1
}

observability_import_grafana_dashboard() {
  local dashboard_json="$1"
  observability_grafana_auth
  local payload tmp http_code resp
  tmp="$(mktemp)"
  payload="$(jq -n --argjson dashboard "$dashboard_json" '{dashboard: $dashboard, overwrite: true, message: "apply-dashboards"}')"
  http_code="$(observability_curl_s "$GRAFANA_USERPASS" -o "$tmp" -w '%{http_code}' \
    -X POST "${GRAFANA_URL}/api/dashboards/db" \
    -H 'Content-Type: application/json' \
    -d "$payload")" || http_code="000"
  resp="$(cat "$tmp")"
  rm -f "$tmp"
  echo "$resp" | jq . 2>/dev/null || echo "$resp"
  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "[!] Grafana dashboard HTTP $http_code"
    exit 1
  fi
  echo "[+] Grafana dashboard imported (DASHBOARD_ENV=$DASHBOARD_ENV)"
}

observability_prepare_grafana_dashboard() {
  local dashboard_file="$1"
  local env="$2"
  local project_name
  project_name="$(project_yaml_get project)"
  jq --arg env "$env" --arg title "${project_name} (${env})" --arg uid "${project_name}-${env}" '
    .title = $title
    | .uid = $uid
    | .tags = (.tags + [$env] | unique)
    | .templating.list |= map(
        if .name == "environment" then
          .current = {selected: true, text: $env, value: $env}
          | .options = [{selected: true, text: $env, value: $env}]
        else .
        end
      )
  ' "$dashboard_file"
}

observability_apply_kibana_alerting_rules() {
  local rules_file="$1"
  local env="$2"
  local kibana_url="${KIBANA_URL:-http://127.0.0.1:5601}"
  local rule id body_create body_update tmp http_code resp get_code
  echo "== Kibana alerting rules: $kibana_url (ALERTS_ENV=$env) =="
  command -v jq >/dev/null || { echo "[!] jq required"; exit 1; }

  while IFS= read -r rule; do
    id="$(jq -r '.id' <<<"$rule")"
    body_create="$(jq --arg env "$env" '
      del(.id)
      | if (.params.esQuery? | type) == "string" and (.params.esQuery | contains("__ENV__")) then
          .params.esQuery |= gsub("__ENV__"; $env)
        else . end
    ' <<<"$rule")"
    body_update="$(jq --arg env "$env" '
      del(.id, .rule_type_id, .consumer, .enabled)
      | if (.params.esQuery? | type) == "string" and (.params.esQuery | contains("__ENV__")) then
          .params.esQuery |= gsub("__ENV__"; $env)
        else . end
    ' <<<"$rule")"
    want_enabled="$(jq -r '.enabled' <<<"$rule")"
    echo "   → $id"
    tmp="$(mktemp)"
    get_code="$(curl -sS -o /dev/null -w '%{http_code}' \
      -H 'kbn-xsrf: true' \
      "${kibana_url}/api/alerting/rule/${id}")" || get_code="000"

    if [[ "$get_code" == "200" ]]; then
      http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
        -X PUT "${kibana_url}/api/alerting/rule/${id}" \
        -H 'kbn-xsrf: true' \
        -H 'Content-Type: application/json' \
        --data-binary "$body_update")" || http_code="000"
    else
      http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
        -X POST "${kibana_url}/api/alerting/rule/${id}" \
        -H 'kbn-xsrf: true' \
        -H 'Content-Type: application/json' \
        --data-binary "$body_create")" || http_code="000"
    fi

    resp="$(cat "$tmp")"
    rm -f "$tmp"
    if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
      echo "$resp" | jq . 2>/dev/null || echo "$resp"
      echo "[!] Kibana rule $id HTTP $http_code"
      exit 1
    fi
    if [[ "$get_code" == "200" && "$want_enabled" == "true" ]]; then
      curl -sS -o /dev/null -X POST "${kibana_url}/api/alerting/rule/${id}/_enable" \
        -H 'kbn-xsrf: true' || true
    fi
    echo "[+] Kibana rule OK: $(jq -r '.name // .id' <<<"$resp" 2>/dev/null || echo "$id")"
  done < <(jq -c '.[]' "$rules_file")
}

observability_apply_dashboards() {
  local root="$1"
  observability_apply_elasticsearch "$root"
  observability_import_kibana_ndjson "${KIBANA_URL:-http://127.0.0.1:5601}" "${root}/dashboards/kibana.ndjson"
  local dash_json
  dash_json="$(observability_prepare_grafana_dashboard "${root}/dashboards/grafana.json" "$DASHBOARD_ENV")"
  observability_import_grafana_dashboard "$dash_json"
  echo "[+] Dashboards applied (DASHBOARD_ENV=$DASHBOARD_ENV)"
}

observability_apply_alerts() {
  local root="$1"
  observability_apply_kibana_alerting_rules "${root}/alerts/kibana.json" "$ALERTS_ENV"
  observability_apply_grafana_alerting_rules "${root}/alerts/grafana.json" "$ALERTS_ENV"
  echo "[+] Alerts applied (ALERTS_ENV=$ALERTS_ENV)"
}

observability_run_on_mono() {
  local root="$1"
  local mode="$2"
  local remote_dir="/tmp/scb-obs-$$"
  local stage
  stage="$(mktemp -d /tmp/scb-st.XXXXXX)"
  trap 'rm -rf "$stage"' RETURN

  mkdir -p \
    "$stage/assets/elasticsearch" \
    "$stage/dashboards" \
    "$stage/alerts" \
    "$stage/cmd/lib" \
    "$stage/docs"

  observability_write_remote_env "$stage/observability.env"
  cp "${root}/cmd/lib/project.sh" "$stage/cmd/lib/"
  cp "${root}/cmd/lib/observability.sh" "$stage/cmd/lib/"
  cp "${root}/docs/project.yml" "$stage/docs/"
  cp "${root}/assets/elasticsearch/analytics-index-template.json" "$stage/assets/elasticsearch/"

  if [[ "$mode" == dashboards ]]; then
    cp "${root}/dashboards/kibana.ndjson" "$stage/dashboards/"
    cp "${root}/dashboards/grafana.json" "$stage/dashboards/"
  else
    cp "${root}/alerts/kibana.json" "$stage/alerts/"
    cp "${root}/alerts/grafana.json" "$stage/alerts/"
  fi

  cat >"$stage/run.sh" <<'RUNNER'
set -euo pipefail
[[ "${OBS_DEBUG:-0}" == "1" ]] && set -x
cd "$OBS_REMOTE_DIR"
set -a
# shellcheck disable=SC1091
source ./observability.env
set +a
export PROJECT_ROOT="$OBS_REMOTE_DIR" PROJECT_YML="$OBS_REMOTE_DIR/docs/project.yml"
# shellcheck disable=SC1091
source "$OBS_REMOTE_DIR/cmd/lib/project.sh"
# shellcheck disable=SC1091
source "$OBS_REMOTE_DIR/cmd/lib/observability.sh"
case "$OBS_MODE" in
  dashboards) observability_apply_dashboards "$OBS_REMOTE_DIR" ;;
  alerts) observability_apply_alerts "$OBS_REMOTE_DIR" ;;
  *) echo "[!] unknown mode: $OBS_MODE"; exit 1 ;;
esac
RUNNER
  chmod +x "$stage/run.sh"

  echo "[+] SSH → $MONO_SSH (single connection: upload + apply)"
  # COPYFILE_DISABLE: skip macOS xattr entries (noise on Linux tar)
  COPYFILE_DISABLE=1 tar czf - -C "$stage" . | ssh "${OBS_SSH_OPTS[@]}" "$MONO_SSH" \
    "set -euo pipefail
remote_dir='${remote_dir}'
rm -rf \"\${remote_dir}\"
mkdir -p \"\${remote_dir}\"
tar xzf - --warning=no-unknown-keyword -C \"\${remote_dir}\"
OBS_REMOTE_DIR=\"\${remote_dir}\" OBS_MODE='${mode}' SKIP_BOOTSTRAP='${SKIP_BOOTSTRAP:-0}' OBS_DEBUG='${OBS_DEBUG:-0}' bash \"\${remote_dir}/run.sh\"
rm -rf \"\${remote_dir}\"" \
    || {
      echo "[!] SSH to $MONO_SSH failed (exit $?)" >&2
      echo "[i] Test manually: ssh ${MONO_SSH}" >&2
      echo "[i] Add your SSH key: ssh-copy-id ${MONO_SSH}" >&2
      return 1
    }
}
