#!/bin/sh
# No declarative Garage CRD exists, so this loop re-runs upstream's imperative
# setup (layout/bucket/key) every 5 minutes, converging instead of running once.
# Expects GARAGE_BUCKET, GARAGE_KEY_NAME, DOWNLOADER_S3_ACCESS_KEY and
# DOWNLOADER_S3_SECRET_KEY in the environment.
set -e

while true; do
  NODE_ID=$(/garage node id 2>/dev/null | head -n1 | cut -d@ -f1)
  if [ -n "$NODE_ID" ] && ! /garage layout show 2>/dev/null | sed -n "/CURRENT CLUSTER LAYOUT/,/^$/p" | grep -q "$NODE_ID"; then
    /garage layout assign -z dc1 -c 20GB "$NODE_ID"
    CURRENT_VERSION=$(/garage layout show 2>/dev/null | grep -oE "Current cluster layout version: [0-9]+" | grep -oE "[0-9]+" | head -n1)
    /garage layout apply --version "$((${CURRENT_VERSION:-0} + 1))"
  fi
  if ! /garage bucket list 2>/dev/null | grep -q "$GARAGE_BUCKET"; then
    /garage bucket create "$GARAGE_BUCKET"
  fi
  if ! /garage key info "$DOWNLOADER_S3_ACCESS_KEY" >/dev/null 2>&1; then
    /garage key import --yes -n "$GARAGE_KEY_NAME" "$DOWNLOADER_S3_ACCESS_KEY" "$DOWNLOADER_S3_SECRET_KEY"
  fi
  /garage bucket allow --read --write --owner --key "$DOWNLOADER_S3_ACCESS_KEY" "$GARAGE_BUCKET"
  sleep 300
done
