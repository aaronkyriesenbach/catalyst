#!/bin/sh

config_dir=${CONFIG_DIR:-/config}
last_run_file=$config_dir/mam.last-update
cookie_file=$config_dir/mam.cookies

echo "Waiting for Transmission to come up..."
while ! curl -f http://localhost:9091; do
  sleep 5
done

echo "Transmission is up!"

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

  current_ip="$(curl -s ifconfig.me)"
  echo "Network connected! Current IP: $current_ip"

  echo $current_time > $last_run_file
  curl -c $cookie_file -b $cookie_file https://t.myanonamouse.net/json/dynamicSeedbox.php
else
  echo "$(date): Less than 30 mins have elapsed since last run, doing nothing"
fi