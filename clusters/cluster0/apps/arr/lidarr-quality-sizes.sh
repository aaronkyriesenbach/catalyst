#!/bin/sh
set -eu

auth="X-Api-Key: ${LIDARR_API_KEY}"

curl -fsS -H "$auth" "${LIDARR_URL}/api/v1/qualitydefinition" |
  sed 's/"maxSize": *[0-9.]*/"maxSize": null/' |
  curl -fsS -X PUT -H "$auth" -H 'Content-Type: application/json' --data-binary @- \
    "${LIDARR_URL}/api/v1/qualitydefinition/update" >/dev/null
