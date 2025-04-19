#!/bin/sh

if ! test -n $SHARED_SECRET; then
  echo "Set SHARED_SECRET env var"
  exit 1
fi

while true; do
  current_ip="$(curl -s ifconfig.me)"

  string_to_hash="$current_ip$SHARED_SECRET"
  hash=$(echo -n $string_to_hash | sha256sum | head -c 40)

  echo "Current IP is $current_ip, hash is $hash"
  curl -s -H "Content-Type: application/json" -d "{ \"hash\": \"$hash\" }" https://7odqfnnmog33hwuxk3y4curdrq0bmzma.lambda-url.us-east-1.on.aws/ | tr -d '"'

  echo -e "\nSleeping 15 minutes..."
  sleep 900
done