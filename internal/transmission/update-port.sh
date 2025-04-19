#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=/dev/null
. /etc/transmission/environment-variables.sh

TRANSMISSION_PASSWD_FILE=/config/transmission-credentials.txt

transmission_username=$(head -1 ${TRANSMISSION_PASSWD_FILE})
transmission_passwd=$(tail -1 ${TRANSMISSION_PASSWD_FILE})
transmission_settings_file=${TRANSMISSION_HOME}/settings.json

function box_out() {
    local s="$*"
    printf "\033[36m╭─%s─╮\n\033[36m│ \033[34m%s\033[36m │\n\033[36m╰─%s─╯\033[0;39m\n" "${s//?/─}" "$s" "${s//?/─}"
}

open_port() {
    natpmpc -a 1 0 udp 60 && natpmpc -a 1 0 tcp 60
}

remote() {
    if test -n "$myauth"; then
        transmission-remote "$TRANSMISSION_RPC_PORT" --auth "$myauth" --json "$@"
    else
        transmission-remote "$TRANSMISSION_RPC_PORT" --json "$@"
    fi
}

bind_trans() {
    local new_port=$pf_port

    # Check if transmission remote is set up with authentication
    if test "$(jq -r '.["rpc-authentication-required"]' "$transmission_settings_file")" == "true"; then
        myauth="$transmission_username:$transmission_passwd"
    else
        myauth=""
    fi

    # Ensure transmission is responsive
    until test "$(remote --list | jq -r .result)" == "success"; do sleep 10; done

    # Bind port to Transmission
    transmission_peer_port=$(remote --session-info | jq -r '.arguments["peer-port"]')
    if test "$new_port" -ne "$transmission_peer_port"; then
        until test "$(remote --port "$new_port" | jq -r .result)" == "success"; do sleep 5; done
    fi
}

if ! which jq; then
    echo "jq is not installed! jq is required to configure ProtonVPN port forwarding."
    echo "port forwarding for ProtonVPN has not been configured."
    exit 1
fi

if ! which natpmpc; then
    echo "natpmpc is not installed! natpmpc is required to configure ProtonVPN port forwarding."
    echo "port forwarding for ProtonVPN has not been configured."
    exit 1
fi

sleep 60
box_out "ProtonVPN Port Forwarding"
last_known_port=""

# Custom seedbox update logic here
config_dir=${CONFIG_DIR:-/config}
last_run_file=$config_dir/mam.last-update
cookie_file=$config_dir/mam.cookies

if ! test -f $last_run_file; then
  last_run_time=0
else
  last_run_time=$(cat $last_run_file)
fi

current_time=$(date +%s)

thirty_min_ago_time=$((current_time - 1800))
if [ $thirty_min_ago_time -gt $last_run_time ]; then
  echo "$(date): More than 30 minutes have elapsed since container restarted, executing IP update"

  while ! ping -c 1 -W 1 1.1.1.1 > /dev/null; do
    echo "Waiting for network..."
    sleep 5
  done

  # Wait for transmission to be responsive
  until test "$(remote --list | jq -r .result)" == "success"; do sleep 10; done

  current_ip="$(curl -s ifconfig.me)"
  echo "Network connected! Current IP: $current_ip"

  echo $current_time > $last_run_file
  curl -c $cookie_file -b $cookie_file https://t.myanonamouse.net/json/dynamicSeedbox.php
else
  echo "$(date): Less than 30 mins have elapsed since last run, doing nothing"
fi
# End seedbox update logic

while true; do
    pf_port="$(open_port | sed -nr '1,//s/Mapped public port ([0-9]{4,5}) protocol.*/\1/p')"
    if test "$pf_port" -gt 1024; then
        if [[ "$pf_port" != "$last_known_port" ]]; then
            bind_trans
            last_known_port="$pf_port"
            box_out "The Forwarded Port is: $pf_port"
        fi
    else
        box_out "No valid port returned from natpmpc"
    fi
    sleep 45
done
