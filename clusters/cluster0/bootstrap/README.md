# Cluster Setup

This directory contains only what bootstraps ArgoCD: its Helm values and the root Application, both applied by hand. Everything else, including kube-vip and Traefik, is an ArgoCD app defined under `apps/`.

## Prerequisites

- Server nodes that all run control plane + workloads (currently 2). A 2-member etcd has no fault tolerance, so add a third server for a cluster that survives a node restart
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

`catalyst-app.yaml` is the root Application that renders every AppProject and child Application. Apply it by hand with `kubectl apply -f cluster/catalyst-app.yaml`; it is not self-managed. It auto-syncs with `prune: true` and `selfHeal: true`, so removing an `apps/*.ts` file prunes that app's Application and, through its finalizer, the app's resources.

ArgoCD syncs apps defined in `apps/*.ts` from this repo. The CMP sidecar container (`oven/bun:1.3.11`) runs in the repo-server pod.

## Bootstrapping a New Cluster

The API VIP and ingress come from ArgoCD apps, so the order matters:

1. Install k3s on the first server with the config above (`cluster-init: true`) and use its node IP for kubectl.
2. Install ArgoCD and apply the root Application (see above).
3. Wait for the `kube-vip` and `traefik` apps to sync. There is no API VIP, no `LoadBalancer` IP and no ingress until then; reach the Argo UI with `kubectl -n argocd port-forward svc/argocd-server 8080:80`.
4. Join the other servers through the VIP (below).

## Adding a New Server Node

1. Make sure the `kube-vip` app is synced and `192.168.53.200` answers on port 6443.
2. Install k3s with the config above (including `disable: traefik`) and `--server https://192.168.53.200:6443` (use the VIP).
3. The node joins the etcd cluster and kube-vip schedules a pod on it automatically. Nothing is copied to the node.
