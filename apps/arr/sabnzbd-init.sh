#!/usr/bin/env bash
# Rebuilds sabnzbd.ini from the image defaults on every start, so the Web UI cannot drift from
# Git. The image entrypoint then applies the API key, NZB key, host whitelist and local ranges
# from the environment to the file this writes.
set -euo pipefail

ini=/config/sabnzbd.ini
cp /defaults/sabnzbd.ini "$ini"

set_misc() {
  sed -i -e "s|^$1 *=.*$|$1 = $2|" "$ini"
}

set_misc download_dir "$INCOMPLETE_DIR"
set_misc complete_dir "$COMPLETE_DIR"

{
  echo "[categories]"
  echo "[[*]]"
  echo "name = *"
  echo "order = 0"
  echo "pp = 3"
  echo "script = None"
  echo "dir = \"\""
  echo "priority = 0"
  order=1
  for category in $CATEGORIES; do
    echo "[[$category]]"
    echo "name = $category"
    echo "order = $order"
    echo "pp = \"\""
    echo "script = Default"
    echo "dir = $category"
    echo "priority = -100"
    order=$((order + 1))
  done
} >>"$ini"

# The provider is optional: without credentials SABnzbd starts with no server.
if [[ -n "${USENET_HOST:-}" ]]; then
  {
    echo "[servers]"
    echo "[[$USENET_HOST]]"
    echo "name = $USENET_HOST"
    echo "displayname = $USENET_HOST"
    echo "host = $USENET_HOST"
    echo "port = $USENET_PORT"
    echo "timeout = 60"
    echo "username = ${USENET_USERNAME:-}"
    echo "password = ${USENET_PASSWORD:-}"
    echo "connections = $USENET_CONNECTIONS"
    echo "ssl = 1"
    echo "ssl_verify = 2"
    echo "enable = 1"
    echo "required = 0"
    echo "optional = 0"
    echo "retention = 0"
    echo "priority = 0"
  } >>"$ini"
fi
