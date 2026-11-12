#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
restart=true
if [[ "${1:-}" == "--no-restart" ]]; then
  restart=false
  shift
fi
[[ $# -gt 0 ]] || {
  echo "usage: $0 [--no-restart] <node>..." >&2
  exit 1
}

ssh_opts=(-o ConnectTimeout=20 -o ServerAliveInterval=10)

install_node() {
  local node="$1" stage
  stage="$(ssh "${ssh_opts[@]}" "$node" 'mktemp -d')"
  scp -q -r "${ssh_opts[@]}" "$here/config.yaml" "$here/config.yaml.d" "$here/systemd" "$node:$stage/"
  if [[ -d "$here/$node" ]]; then
    scp -q -r "${ssh_opts[@]}" "$here/$node/config.yaml.d/." "$node:$stage/config.yaml.d/"
  fi
  ssh "${ssh_opts[@]}" "$node" "sudo bash -s -- $stage" <<'REMOTE'
set -euo pipefail
stage="$1"
conf=/etc/rancher/k3s
install -d -m 0755 "$conf/config.yaml.d" /etc/systemd/system/k3s.service.d
rm -f "$conf"/config.yaml.d/*.yaml
install -m 0644 "$stage/config.yaml" "$conf/config.yaml"
install -m 0644 "$stage"/config.yaml.d/*.yaml "$conf/config.yaml.d/"
install -m 0644 "$stage/systemd/memory-low.conf" /etc/systemd/system/k3s.service.d/memory-low.conf
systemctl daemon-reload
rm -rf "$stage"
REMOTE
}

wait_ready() {
  local node="$1"
  for _ in $(seq 1 60); do
    if [[ "$(kubectl get node "$node" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" == "True" ]]; then
      return 0
    fi
    sleep 10
  done
  echo "$node did not become Ready within 10 minutes" >&2
  return 1
}

for node in "$@"; do
  echo "== $node: installing config"
  install_node "$node"
  if $restart; then
    echo "== $node: restarting k3s"
    ssh "${ssh_opts[@]}" "$node" 'sudo systemctl restart k3s'
    wait_ready "$node"
  fi
done
