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
  - traefik
```

- `tls-san` adds the kube-vip control plane VIP to the API server's TLS certificate
- `disable: servicelb` removes k3s's built-in ServiceLB (Klipper) since kube-vip handles LoadBalancer services
- `disable: traefik` removes k3s's bundled Traefik; the official chart is deployed by the `traefik` ArgoCD app instead (see [Traefik](#traefik)). Set it on **every** server before restarting any of them: a node that still has it enabled restages `traefik.yaml` on startup, and helm-controller then reinstalls (or uninstalls) the bundled chart over Argo's resources.

Restart k3s after updating: `sudo systemctl restart k3s`

When restarting a multi-node cluster, restart one server at a time and verify it rejoins before restarting the next. With only two servers, etcd has no quorum while one is down: the API server is unavailable until it rejoins (running workloads keep serving, but kube-vip loses its leases and the VIPs flap).

## Server Manifests

Copy these files to `/var/lib/rancher/k3s/server/manifests/` on every server node. k3s automatically applies manifests in this directory on startup.

| File                      | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `kube-vip-rbac.yaml`      | ServiceAccount and RBAC for the kube-vip DaemonSet                   |
| `kube-vip-daemonset.yaml` | kube-vip in ARP mode, provides two floating VIPs across server nodes |

### kube-vip

kube-vip runs as a DaemonSet on control-plane nodes and manages two VIPs via ARP:

| VIP           | Address          | Purpose                                        |
| ------------- | ---------------- | ---------------------------------------------- |
| Control plane | `192.168.53.200` | Stable API server endpoint (port 6443)         |
| Service       | `192.168.53.201` | Stable Traefik ingress endpoint (ports 80/443) |

The service VIP is assigned to Traefik's LoadBalancer service via the `kube-vip.io/loadbalancerIPs` annotation in `apps/traefik/values.yaml`.

After kube-vip is running, update your kubeconfig server to `https://192.168.53.200:6443`.

### Traefik

Traefik is not a server manifest. The `traefik` ArgoCD app installs the official `traefik/traefik` chart into the `traefik` namespace, with values in `apps/traefik/values.yaml`:

- Gateway API provider enabled; the chart's default Gateway is disabled (our own, with TLS, are in `apps/traefik/gateway.ts`)
- Service LoadBalancer IP pinned to `192.168.53.201` via the kube-vip annotation
- Ports 80 and 443 exposed, the legacy `web`/`websecure` entrypoints not
- 2 replicas with soft pod anti-affinity and a PodDisruptionBudget (`minAvailable: 1`)
- CrowdSec bouncer and OIDC plugins loaded (see `docs/waf.md`); the `crowdsec-bouncer-key` secret is mounted from the `traefik` namespace and created by the `crowdsec` app

The chart also installs the Gateway API and Traefik CRDs. On a rebuilt cluster there is no ingress until Argo has synced `traefik`; reach the Argo UI with `kubectl -n argocd port-forward svc/argocd-server 8080:80` until then. Apps that define routes retry until the CRDs exist.

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

`catalyst-app.yaml` is the root Application that renders every AppProject and child Application. Apply it by hand with `kubectl apply -f cluster/catalyst-app.yaml`; it is not self-managed and `apply-cluster` skips it. It auto-syncs with `prune: true` and `selfHeal: true`, so removing an `apps/*.ts` file prunes that app's Application and, through its finalizer, the app's resources.

ArgoCD syncs apps defined in `apps/*.ts` from this repo. The CMP sidecar container (`oven/bun:1.3.11`) runs in the repo-server pod.

## Adding a New Server Node

1. Install k3s with the config above (including `disable: traefik`) and `--server https://192.168.53.200:6443` (use the VIP)
2. Copy the kube-vip manifests from this directory to `/var/lib/rancher/k3s/server/manifests/`
3. The node will join the etcd cluster and kube-vip will schedule a pod on it automatically
