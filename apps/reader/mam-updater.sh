#!/bin/sh
# Keeps MAM's dynamic seedbox IP current. Expects MAM_ID in the environment.

while true; do
  echo "[$(date)] Updating MAM dynamic seedbox IP..."
  response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "mam_id=${MAM_ID}" "https://t.myanonamouse.net/json/dynamicSeedbox.php")
  body=$(echo "$response" | sed "/HTTP_STATUS:/d")
  status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
  echo "$body"
  if [ "$status" != "200" ]; then
    echo "[$(date)] ERROR: MAM update failed with HTTP $status"
  elif echo "$body" | grep -qi "error"; then
    echo "[$(date)] ERROR: MAM returned error response"
  else
    echo "[$(date)] MAM update successful"
  fi
  sleep 1800
done
