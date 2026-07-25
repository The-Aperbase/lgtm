#!/usr/bin/env bash
set -euo pipefail

compose_file="${1:-deploy-compose.yml}"

if grep -Eq 'websecure|tls\.certresolver|\.tls=true|lgtm-otlp-grpc' "$compose_file"; then
  echo "Cloudflare Tunnel origins must not contain public gRPC, websecure, or origin TLS labels." >&2
  exit 1
fi

if grep -Eq '^[[:space:]]+ports:' "$compose_file"; then
  echo "The LGTM stack must not publish host ports." >&2
  exit 1
fi

required_lines=(
  'traefik.http.routers.lgtm-grafana.entrypoints=web'
  'traefik.http.routers.lgtm-otlp-http.entrypoints=web'
  'traefik.http.services.lgtm-otlp-http.loadbalancer.server.port=4318'
  'lgtm-otel-collector'
  'lgtm-ingest:'
)

for required_line in "${required_lines[@]}"; do
  if ! grep -Fq "$required_line" "$compose_file"; then
    echo "Missing required Cloudflare/overlay routing configuration: $required_line" >&2
    exit 1
  fi
done

echo "Cloudflare Tunnel and cross-stack routing invariants passed."
