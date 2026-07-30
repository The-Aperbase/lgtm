#!/bin/sh

set -eu

: "${SWARM_NODE_ID:?SWARM_NODE_ID is required}"

chown -R 10001:10001 /storage/loki /storage/tempo
docker node update --label-add observability=true "$SWARM_NODE_ID"
