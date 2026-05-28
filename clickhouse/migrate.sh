#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

export CH_HOST="${CH_HOST:=localhost}"
export CH_HTTP_PORT="${CH_HTTP_PORT:=8123}"
export CH_NATIVE_PORT="${CH_NATIVE_PORT:=9000}"
export CH_DATABASE="${CH_DATABASE:=default}"
export CH_USERNAME="${CH_USERNAME:=default}"
export CH_PASSWORD="${CH_PASSWORD:=}"

if command -v clickhouse-client >/dev/null 2>&1; then
  clickhouse-client \
    --host "$CH_HOST" \
    --port "$CH_NATIVE_PORT" \
    --user "$CH_USERNAME" \
    --password "$CH_PASSWORD" \
    --database "$CH_DATABASE" \
    --queries-file "$SCRIPT_DIR/schema.sql"
else
  container_id=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps -q clickhouse)
  if [[ -z "$container_id" ]]; then
    echo "ClickHouse container not running; run \`make clickhouse-up\` first" >&2
    exit 1
  fi

  docker exec -i "$container_id" clickhouse-client \
    --user "$CH_USERNAME" \
    --password "$CH_PASSWORD" \
    --database "$CH_DATABASE" \
    < "$SCRIPT_DIR/schema.sql"
fi

echo "schema applied to $CH_DATABASE@$CH_HOST:$CH_NATIVE_PORT"
