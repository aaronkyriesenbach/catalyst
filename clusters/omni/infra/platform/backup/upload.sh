#!/bin/sh
set -eu

stamp="$(date -u +%Y%m%dT%H%M%SZ)"

aws s3 cp /snapshots/snapshot.db "s3://${BUCKET}/omni/etcd/${stamp}.db" \
  --only-show-errors
