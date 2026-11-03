#!/bin/sh
# Rewrites qBittorrent.conf on every start, so the Web UI cannot drift from Git.
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
MigrationVersion=9999

[Preferences]
WebUI\Port=8080
WebUI\Address=*
WebUI\CSRFProtection=false
WebUI\HostHeaderValidation=false
WebUI\LocalHostAuth=false
WebUI\AuthSubnetWhitelistEnabled=true
WebUI\AuthSubnetWhitelist=${TRUSTED_SUBNET}
EOF
