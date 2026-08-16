# Homelab Platform

The `catalyst` repo's home-lab Kubernetes platform: physical infrastructure, cluster lifecycle, shared
platform services, and the app-config layer that renders workloads onto it.

## Language

**Bootstrap layer**:
The physical, pre-cluster layer — Proxmox, TrueNAS, and Unifi — provisioned declaratively before any
Kubernetes cluster exists. Owned entirely by OpenTofu (ADR 0001). Ends where the cluster layer begins:
it does not provision individual Kubernetes node VMs.
_Avoid_: physical layer, infra layer (as formal terms; fine in casual prose)

**Cluster layer**:
The Kubernetes node/cluster lifecycle domain — creating, joining, and upgrading Talos node VMs and the
clusters they form, for every cluster (platform, workload, or experimental) alike. Owned entirely by the
cluster-lifecycle tool (Omni), never by the bootstrap layer's OpenTofu.
_Avoid_: node provisioning (as a formal term for the whole layer; fine for describing one act)
