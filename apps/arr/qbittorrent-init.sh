#!/bin/sh
# Rewrites qBittorrent.conf on every start, so the Web UI cannot drift from Git.
# qBittorrent 5 reads Web UI settings from [WebUI]; with a current MigrationVersion it no longer
# migrates the legacy [Preferences] WebUI\* keys, so those would be silently ignored.
set -eu

conf_dir=/config/qBittorrent/config
mkdir -p "$conf_dir"

cat >"$conf_dir/qBittorrent.conf" <<EOF
[BitTorrent]
Session\DefaultSavePath=${SAVE_PATH}
Session\TempPath=${INCOMPLETE_PATH}
Session\TempPathEnabled=true
Session\Port=6881

[LegalNotice]
Accepted=true

[Meta]
MigrationVersion=12

[WebUI]
Port=8080
Address=*
CSRFProtection=false
HostHeaderValidation=false
LocalHostAuth=false
AuthSubnetWhitelistEnabled=true
AuthSubnetWhitelist=${TRUSTED_SUBNET}
EOF
