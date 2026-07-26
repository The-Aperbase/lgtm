#!/bin/sh

set -eu

: "${SWARM_NODE_ID:?SWARM_NODE_ID is required}"
: "${SWARM_SERVICE_NAME:?SWARM_SERVICE_NAME is required}"

chown -R 10001:10001 /storage/loki /storage/tempo
docker node update --label-add observability=true "$SWARM_NODE_ID"

stack_name="${SWARM_SERVICE_NAME%_prepare-swarm-node}"

for component in grafana alloy loki tempo prometheus; do
  target="${stack_name}_${component}"
  if docker service inspect "$target" >/dev/null 2>&1; then
    docker service update --force --detach=true "$target"
  fi
done
