#!/usr/bin/env bash
# Purpose: run the M0 walking-skeleton smoke path end to end.
# This script does not tear down on failure; containers stay up for log and ClickHouse inspection.
# Next step for visual confirmation: make app-run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "=== agent-observability M0 walking-skeleton demo ==="

make clickhouse-up
make clickhouse-migrate
make collector-up

CH_READY=0
COLLECTOR_READY=0
ATTEMPT=0
while [ "${ATTEMPT}" -lt 30 ]; do
  if [ "${CH_READY}" -eq 0 ] && curl -fsS http://localhost:8123/ping >/dev/null 2>&1; then
    CH_READY=1
  fi
  if [ "${COLLECTOR_READY}" -eq 0 ] && curl -fsS http://localhost:13133/ >/dev/null 2>&1; then
    COLLECTOR_READY=1
  fi
  if [ "${CH_READY}" -eq 1 ] && [ "${COLLECTOR_READY}" -eq 1 ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

if [ "${CH_READY}" -ne 1 ] || [ "${COLLECTOR_READY}" -ne 1 ]; then
  if [ "${CH_READY}" -ne 1 ]; then
    echo "✗ FAIL: ClickHouse readiness endpoint failed: http://localhost:8123/ping did not respond within 30s" >&2
  fi
  if [ "${COLLECTOR_READY}" -ne 1 ]; then
    echo "✗ FAIL: collector readiness endpoint failed: http://localhost:13133/ did not respond within 30s" >&2
  fi
  exit 1
fi

pushd sdk >/dev/null
[ -d .venv ] || uv venv --python 3.11 .venv
uv pip install -e . --quiet
# Keep this demo reproducible on fresh dev boxes regardless of ambient
# OTEL config from tools such as Langfuse, Grafana, or Claude Code telemetry.
# The SDK honoring standard OTEL env is correct library behavior, so pin
# the endpoint in this wrapper rather than in the library. Bare host:port is
# gRPC; the SDK derives insecure from the absence of https://.
# Clear conflicting ambient PROTOCOL/HEADERS/TRACES_ENDPOINT vars so this pin wins.
env -u OTEL_EXPORTER_OTLP_PROTOCOL \
    -u OTEL_EXPORTER_OTLP_HEADERS \
    -u OTEL_EXPORTER_OTLP_TRACES_ENDPOINT \
    OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4317 \
    uv run python examples/smoke.py
popd >/dev/null

sleep 3

CID="$(docker compose -f clickhouse/docker-compose.yml ps -q clickhouse)"
if [ -z "${CID}" ]; then
  echo "✗ FAIL: ClickHouse container id was empty; is the clickhouse service running?" >&2
  exit 1
fi

COUNT="$(docker exec -i "${CID}" clickhouse-client --query "SELECT count() FROM otel_traces WHERE SpanName = 'agent_obs_sdk.smoke' AND Timestamp > now() - INTERVAL 60 SECOND")"
[ "${COUNT}" -ge 1 ] || { echo "✗ FAIL: smoke span did not land in otel_traces (count=${COUNT})"; exit 1; }

cat <<'EOF'
✓ walking skeleton verified — span 'agent_obs_sdk.smoke' landed in ClickHouse.
  Now open the app to see it: make app-run
  Expect to see 'agent_obs_sdk.smoke' in the list within 10 seconds.
EOF
