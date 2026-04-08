# Cluster Setup

This directory contains files that are applied outside of ArgoCD, either as k3s server manifests or via Helm.

## Prerequisites

- 3 server nodes (all run control plane + workloads) for etcd quorum
- Each node runs k3s with embedded etcd (`--cluster-init` on first server, `--server https://<first-server>:6443` on subsequent)

## k3s Server Config

On each server node, create/update `/etc/rancher/k3s/config.yaml`:

```yaml
cluster-init: true # node 1 only
tls-san:
  - 192.168.53.200
disable:
  - servicelb
```

- `tls-san` adds the kube-vip control plane VIP to the API server's TLS certificate
- `disable: servicelb` removes k3s's built-in ServiceLB (Klipper) since kube-vip handles LoadBalancer services

Restart k3s after updating: `sudo systemctl restart k3s`

When restarting a multi-node cluster, restart one server at a time and verify it rejoins before restarting the next.

## Server Manifests

Copy these files to `/var/lib/rancher/k3s/server/manifests/` on every server node. k3s automatically applies manifests in this directory on startup.

| File | Purpose |
|---|---|
| `kube-vip-rbac.yaml` | ServiceAccount and RBAC for the kube-vip DaemonSet |
| `kube-vip-daemonset.yaml` | kube-vip in ARP mode, provides two floating VIPs across server nodes |
| `traefik-config.yaml` | HelmChartConfig overlay for the built-in Traefik deployment |

### kube-vip

kube-vip runs as a DaemonSet on control-plane nodes and manages two VIPs via ARP:

| VIP | Address | Purpose |
|---|---|---|
| Control plane | `192.168.53.200` | Stable API server endpoint (port 6443) |
| Service | `192.168.53.201` | Stable Traefik ingress endpoint (ports 80/443) |

The service VIP is assigned to Traefik's LoadBalancer service via the `kube-vip.io/loadbalancerIPs` annotation in `traefik-config.yaml`.

After kube-vip is running, update your kubeconfig server to `https://192.168.53.200:6443`.

### traefik-config.yaml

Configures k3s's built-in Traefik deployment:

- Enables the Gateway API provider (Kubernetes Gateway, not Ingress)
- Disables Traefik's default Gateway (we define our own with TLS in the `traefik` namespace)
- Pins the service LoadBalancer IP to `192.168.53.201` via kube-vip annotation
- Exposes ports 80 and 443, disables the legacy `web`/`websecure` entrypoints

## ArgoCD

ArgoCD is installed via Helm (not as a k3s server manifest):

```sh
helm repo add argocd https://argoproj.github.io/argo-helm
bun run install-argo
```

`argocd-values.yaml` configures:

- A custom CMP plugin (`ts`) that runs `bun run main.ts` to render TypeScript app configs into Kubernetes manifests
- `server.insecure: true` for TLS termination at the Gateway level
- Resource exclusions to reduce watch event noise

ArgoCD syncs apps defined in `apps/*.ts` from this repo. The CMP sidecar container (`oven/bun:1.3.11`) runs in the repo-server pod.

## Adding a New Server Node

1. Install k3s with the config above and `--server https://192.168.53.200:6443` (use the VIP)
2. Copy all server manifests from this directory to `/var/lib/rancher/k3s/server/manifests/`
3. The node will join the etcd cluster and kube-vip will schedule a pod on it automatically
