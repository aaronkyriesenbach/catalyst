#!/bin/sh
# Pre-start setup for qBittorrent container
# Runs via LSIO custom-cont-init.d before s6 services start

# Remove stale lockfile and ipc-socket from unclean shutdown
rm -f /config/qBittorrent/lockfile /config/qBittorrent/ipc-socket

CONF="/config/qBittorrent/qBittorrent.conf"

# Skip config patching on first boot (qBittorrent generates defaults)
[ -f "$CONF" ] || exit 0

# Ensure a key=value pair exists under [Preferences].
# If the key exists, update it. Otherwise append after [Preferences].
set_pref() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" "$CONF"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CONF"
  else
    sed -i "/^\[Preferences\]/a ${key}=${value}" "$CONF"
  fi
}

# Disable CSRF protection (handled by OIDC at Traefik layer)
set_pref 'WebUI\\CSRFProtection' 'false'

# Bypass qBittorrent auth for pod network (OIDC handles auth)
set_pref 'WebUI\\AuthSubnetWhitelistEnabled' 'true'
set_pref 'WebUI\\AuthSubnetWhitelist' '10.42.0.0/16'
set_pref 'WebUI\\LocalHostAuth' 'false'
