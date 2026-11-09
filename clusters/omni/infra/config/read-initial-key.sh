#!/bin/sh
set -eu

kubeconfig="$(mktemp)"
trap 'rm -f "$kubeconfig"' EXIT
printf '%s' "$KUBECONFIG_DATA" > "$kubeconfig"

attempts=0
until kubectl --kubeconfig "$kubeconfig" -n omni exec deploy/omni \
  -c key-reader -- cat /initial-key/key 2> /dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    echo "Omni did not write its initial service account key in 10 minutes" >&2
    exit 1
  fi
  sleep 10
done
