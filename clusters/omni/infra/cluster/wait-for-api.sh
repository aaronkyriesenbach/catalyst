#!/bin/sh
# Blocks until the API server answers, so the Helm releases that follow do not
# race the control plane's first start.
set -eu

kubeconfig="$(mktemp)"
trap 'rm -f "$kubeconfig"' EXIT
printf '%s' "$KUBECONFIG_DATA" > "$kubeconfig"

attempts=0
until kubectl --kubeconfig "$kubeconfig" get --raw /readyz > /dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 90 ]; then
    echo "API server did not become ready in 15 minutes" >&2
    exit 1
  fi
  sleep 10
done
