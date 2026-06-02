# Postgres Migration: NFS Sidecar → iSCSI StatefulSet

Postgres instances are migrating from NFS-backed sidecar containers to standalone StatefulSets using iSCSI volumes provisioned by the [TrueNAS CSI driver](https://github.com/truenas/truenas-csi). NFS is not a supported storage backend for Postgres and causes WAL corruption.

## Architecture

### Legacy (NFS sidecar)

`withPostgres(version, { legacy: true })` adds Postgres as an init container (with `restartPolicy: "Always"`, i.e., a native sidecar) inside the app's pod. Data is stored on the NAS via NFS at `cluster/<app>/postgres`.

- App connects to Postgres at `localhost:5432`
- Data lives on NFS share (`192.168.53.120:/mnt/tank/data/cluster/<app>/postgres`)
- Single pod contains both the app and Postgres containers

### Current (iSCSI StatefulSet)

`withPostgres(version)` (no `legacy` flag) generates a separate StatefulSet and headless Service as `extraResources`. Data is stored on a dynamically-provisioned iSCSI volume (ZFS zvol on TrueNAS).

- App connects to Postgres at `<app>-postgres:5432`
- Data lives on a dedicated iSCSI block device (ext4-formatted zvol)
- Postgres runs as its own StatefulSet with a PersistentVolumeClaim

## Prerequisites

### One-time cluster setup

1. **Install `open-iscsi` on all k3s nodes:**

   ```bash
   sudo apt install open-iscsi
   sudo systemctl enable --now iscsid
   ```

2. **Enable iSCSI on TrueNAS:**

   TrueNAS Web UI → Shares → iSCSI → enable the service.

3. **Create a TrueNAS API key:**

   TrueNAS Web UI → Profile → API Keys → create a new key.

4. **Create the CSI driver secret:**

   ```bash
   kubectl create namespace truenas-csi
   kubectl create secret generic truenas-api-credentials \
     --namespace truenas-csi \
     --from-literal=api-key='<your-truenas-api-key>'
   ```

5. **Deploy the CSI driver:**

   ```bash
   bun run render truenas-csi  # verify output
   git add apps/truenas-csi.ts apps/truenas-csi/
   git commit -m "feat: add truenas-csi driver"
   git push  # ArgoCD picks it up
   ```

6. **Verify the driver is running:**

   ```bash
   kubectl get pods -n truenas-csi
   kubectl get csidrivers  # should show csi.truenas.io
   kubectl get storageclass truenas-iscsi
   ```

## Migrating an app

This example migrates `miniflux`. The same steps apply to any app using `withPostgres`.

### 1. Update the app config

In `apps/miniflux.ts`:

```typescript
// Change DATABASE_URL from localhost to the headless service
{ name: "DATABASE_URL", value: "postgres://miniflux:miniflux@miniflux-postgres:5432/miniflux?sslmode=disable" },

// Remove { legacy: true } from withPostgres
export default applyModifiers(
  base,
  withPostgres(18),
  withOidcAuth(),
);
```

The headless service name follows the pattern `<app-name>-postgres`.

### 2. Verify the rendered output

```bash
bun run render miniflux
```

Confirm the output contains:
- A `StatefulSet` named `miniflux-postgres` with a `volumeClaimTemplates` entry
- A headless `Service` named `miniflux-postgres` (with `clusterIP: None`)
- The main `Deployment` with **no** Postgres init container
- No NFS volume references in the main Deployment

### 3. Export data from the old instance

```bash
# Scale down the app to stop writes
kubectl scale deployment miniflux --replicas=0 -n miniflux

# Dump the database from the NFS-backed sidecar
# (Start a temporary pod with the NFS mount if the sidecar is gone)
kubectl run pg-dump --rm -it --restart=Never -n miniflux \
  --image=docker.int.lab53.net/library/postgres:18-alpine \
  --overrides='{
    "spec": {
      "volumes": [{"name": "nas", "nfs": {"server": "192.168.53.120", "path": "/mnt/tank/data"}}],
      "containers": [{"name": "pg-dump", "image": "docker.int.lab53.net/library/postgres:18-alpine",
        "command": ["pg_dump", "-U", "miniflux", "-Fc", "-f", "/tmp/dump.pgdump", "miniflux"],
        "env": [{"name": "PGDATA", "value": "/var/lib/postgresql/18/docker"}],
        "volumeMounts": [{"name": "nas", "mountPath": "/var/lib/postgresql/18/docker", "subPath": "cluster/miniflux/postgres"}]
      }]
    }
  }' -- sleep infinity

# Copy the dump out
kubectl cp miniflux/pg-dump:/tmp/dump.pgdump ./miniflux.pgdump
kubectl delete pod pg-dump -n miniflux
```

### 4. Deploy the new StatefulSet

Push the updated app config. ArgoCD will create the StatefulSet with a fresh iSCSI volume.

```bash
git add apps/miniflux.ts
git commit -m "feat: migrate miniflux postgres to iSCSI StatefulSet"
git push
```

Wait for the StatefulSet pod to be running:

```bash
kubectl get pods -n miniflux -l app=miniflux-postgres
```

### 5. Restore data

```bash
# Copy dump into the new Postgres pod
kubectl cp ./miniflux.pgdump miniflux/miniflux-postgres-0:/tmp/dump.pgdump

# Restore
kubectl exec -n miniflux miniflux-postgres-0 -- \
  pg_restore -U miniflux -d miniflux --clean --if-exists /tmp/dump.pgdump

# Clean up
kubectl exec -n miniflux miniflux-postgres-0 -- rm /tmp/dump.pgdump
```

### 6. Scale the app back up

ArgoCD should deploy the updated Deployment automatically. If not:

```bash
kubectl scale deployment miniflux --replicas=1 -n miniflux
```

Verify the app connects to Postgres and is functional.

### 7. Clean up old NFS data

Once confirmed working, remove the old Postgres data from the NAS:

```bash
rm -rf /mnt/tank/data/cluster/miniflux/postgres
```

## withPostgres options

| Option | Type | Default | Description |
|---|---|---|---|
| `legacy` | `boolean` | `false` | Use NFS sidecar mode (original behavior) |
| `storage` | `string` | `"10Gi"` | PVC size for iSCSI mode |
| `storageClassName` | `string` | `"truenas-iscsi"` | StorageClass for iSCSI mode |
| `variant` | `string` | `"alpine"` | Postgres image variant |
| `user` | `string` | app name | Postgres user |
| `password` | `string` | app name | Postgres password |
| `database` | `string` | app name | Postgres database name |
| `image` | `string` | auto | Full image override |
| `dataSubPath` | `string` | auto | NFS subpath (legacy mode only) |

## CSI driver configuration

### Storage pool

The default ZFS pool is set in `apps/truenas-csi/deploy.yaml` via the `defaultPool` field in the ConfigMap (currently `tank`). Individual StorageClasses can override this with the `pool` parameter:

```typescript
const ssdStorageClass: ResourceLike = {
  apiVersion: "storage.k8s.io/v1",
  kind: "StorageClass",
  metadata: { name: "truenas-iscsi-ssd" },
  provisioner: "csi.truenas.io",
  parameters: {
    protocol: "iscsi",
    pool: "ssd-pool",  // overrides defaultPool
    compression: "LZ4",
  },
  reclaimPolicy: "Retain",
  volumeBindingMode: "Immediate",
  allowVolumeExpansion: true,
};
```

### API key management

The TrueNAS API key must be created manually as a Kubernetes Secret before deploying the CSI driver:

```bash
kubectl create secret generic truenas-api-credentials \
  --namespace truenas-csi \
  --from-literal=api-key='<your-truenas-api-key>'
```

The CSI controller and node containers reference it via `secretKeyRef` on the key `api-key`.
