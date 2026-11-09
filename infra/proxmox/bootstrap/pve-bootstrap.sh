#!/bin/sh
# Run once as root on any node of the new, already-clustered PVE cluster.
set -eu

role="PulumiAdmin"
user="pulumi@pve"
token="automation"

if ! pveum role list --output-format json | grep -q "\"roleid\":\"$role\""; then
  pveum role add "$role" -privs "Datastore.Allocate Datastore.AllocateSpace Datastore.AllocateTemplate Datastore.Audit Group.Allocate Mapping.Audit Mapping.Modify Mapping.Use Pool.Allocate Pool.Audit Realm.AllocateUser Realm.Allocate SDN.Allocate SDN.Audit SDN.Use Sys.AccessNetwork Sys.Audit Sys.Console Sys.Incoming Sys.Modify Sys.PowerMgmt Sys.Syslog User.Modify VM.Allocate VM.Audit VM.Backup VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.Console VM.Migrate VM.Monitor VM.PowerMgmt VM.Snapshot VM.Snapshot.Rollback"
fi

if ! pveum user list --output-format json | grep -q "\"userid\":\"$user\""; then
  pveum user add "$user" --comment "Pulumi automation (infra/proxmox)"
fi

pveum aclmod / --users "$user" --roles "$role"

if ! pveum user token list "$user" 2> /dev/null | grep -q "$token"; then
  echo "Copy this token now; PVE shows the secret once:"
  pveum user token add "$user" "$token" --privsep 0
fi

cat > /etc/apt/sources.list.d/pve-no-subscription.sources << 'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF
