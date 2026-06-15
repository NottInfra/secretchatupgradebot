#!/usr/bin/env bash
# CI helpers for self-hosted runners on mono — use platform services, not isolated Docker Hub pulls.
set -euo pipefail

_mono_ci_network() {
  local n
  n="$(project_yaml_get mono.network 2>/dev/null || true)"
  printf '%s' "${n:-mono}"
}

# Trivy server on mono (docker-compose.deployments.yml) — shared DB/cache at trivy:8080.
mono_trivy_scan() {
  local image="$1" network="${MONO_NETWORK:-$(_mono_ci_network)}"
  local server="${TRIVY_SERVER:-http://trivy:8080}"
  local cli="${TRIVY_CLI_IMAGE:-aquasec/trivy:0.58.1}"

  docker run --rm --network "$network" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "$cli" image \
    --server "$server" \
    --severity HIGH,CRITICAL \
    --exit-code 1 \
    "$image"
}

# SonarQube server on mono — scanner is a client only; must join mono network to reach sonarqube:9000.
mono_sonar_scan() {
  local project_key="$1" sources="${2:-src}" network="${MONO_NETWORK:-$(_mono_ci_network)}"
  local sonar_url="${SONAR_HOST_URL:-http://sonarqube:9000}"
  local scanner="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:11.1.1.1667_4.2.1}"

  [[ -n "${SONAR_TOKEN:-}" ]] || return 0

  docker run --rm --network "$network" \
    -e SONAR_HOST_URL="$sonar_url" \
    -e SONAR_TOKEN \
    -v "$PWD:/usr/src" -w /usr/src \
    "$scanner" \
    sonar-scanner \
      -Dsonar.projectKey="$project_key" \
      -Dsonar.sources="$sources" \
    || true
}

# Host daemon push (127.0.0.1:5000) + local tag for compose (registry:5000 on mono network).
mono_registry_publish() {
  local host_image="$1" compose_image="$2" context="${3:-.}"
  docker build -t "$host_image" "$context"
  docker push "$host_image"
  if [[ "$host_image" != "$compose_image" ]]; then
    docker tag "$host_image" "$compose_image"
  fi
}
