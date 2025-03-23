#!/bin/sh

config_dir=${CONFIG_DIR:-/config}
last_run_file=$config_dir/mam.last-update
cookie_file=$config_dir/mam.cookies

while true; do
  if ! test -f $last_run_file; then
    last_run_time=0
  else
    last_run_time=$(cat $last_run_file)
  fi

  current_time=$(date +%s)

  hour_ago_time=$((current_time - 3600))
  if [ $hour_ago_time -gt $last_run_time ]; then
    echo "$(date): More than an hour has elapsed since last run, executing IP update"

    while ! ping -c 1 -W 1 1.1.1.1 > /dev/null; do
      echo "Waiting for network..."
      sleep 5
    done

    current_ip="$(curl -s ifconfig.me)"
    echo "Network connected! Current IP: $current_ip"

    echo $current_time > $last_run_file
    curl -c $cookie_file -b $cookie_file https://t.myanonamouse.net/json/dynamicSeedbox.php

    echo -e "\nSleeping for 1 hour..."
  else
    echo "$(date): Less than an hour has elapsed since last run, sleeping for 1 hour..."
  fi

  sleep 3600 # 1 hour
done