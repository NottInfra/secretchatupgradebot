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
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --exit-code 1 \
    "$image"
}

# SonarQube server on mono — scanner is a client only; must join mono network to reach sonarqube:9000.
mono_sonar_scan() {
  local project_key="$1" sources="${2:-src}" network="${MONO_NETWORK:-$(_mono_ci_network)}"
  local sonar_url="${SONAR_HOST_URL:-http://sonarqube:9000}"
  local scanner="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:11.5}"
  local workdir
  workdir="$(cd "${CI_PROJECT_DIR:-$PWD}" && pwd)"

  if [[ -z "${SONAR_TOKEN:-}" ]]; then
    echo "[i] SONAR_TOKEN unset — skip sonar scan"
    return 0
  fi

  if [[ ! -d "${workdir}/${sources}" ]]; then
    echo "[!] sonar: ${workdir}/${sources} not found" >&2
    ls -la "${workdir}" >&2 || true
    return 1
  fi

  local -a sonar_args=(
    -Dsonar.projectKey="$project_key"
    -Dsonar.sources="$sources"
    -Dsonar.typescript.tsconfigPath=tsconfig.json
    -Dsonar.exclusions=**/node_modules/**,**/dist/**,**/*.test.ts,**/test/**
    -Dsonar.tests="$sources"
    -Dsonar.test.inclusions=**/*.test.ts
    -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
    -Dsonar.qualitygate.wait=true
  )

  if command -v sonar-scanner >/dev/null 2>&1; then
    echo "[+] sonar-scanner (job image) workdir=${workdir}"
    (
      cd "$workdir"
      export SONAR_HOST_URL="$sonar_url"
      export SONAR_TOKEN
      sonar-scanner "${sonar_args[@]}"
    )
    return
  fi

  echo "[+] sonar-scanner (docker) workdir=${workdir}"
  docker run --rm --network "$network" \
    -e SONAR_HOST_URL="$sonar_url" \
    -e SONAR_TOKEN \
    -v "${workdir}:${workdir}" \
    -w "${workdir}" \
    "$scanner" \
    sonar-scanner "${sonar_args[@]}"
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
