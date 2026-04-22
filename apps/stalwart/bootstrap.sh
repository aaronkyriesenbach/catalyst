#!/bin/sh
set -e

SETUP_COMPLETE="/etc/stalwart/.setup-complete"

if [ -f "$$SETUP_COMPLETE" ]; then
  echo "Setup already completed, sleeping..."
  sleep infinity
fi

# --- Phase 1: Bootstrap (if not already done) ---

if [ ! -f /etc/stalwart/config.json ]; then
  echo "Waiting for Stalwart bootstrap mode..."
  until curl -sf http://localhost:8080/login > /dev/null 2>&1; do
    sleep 2
  done

  echo "Stalwart is ready on port 8080, sending bootstrap payload to /jmap..."
  http_code=$(curl -s -o /tmp/bootstrap-response.json -w '%{http_code}' -X POST http://localhost:8080/jmap -u "admin:$$ADMIN_PASSWORD" -H "Content-Type: application/json" -d "$$BOOTSTRAP_PAYLOAD")
  echo "Bootstrap response (HTTP $$http_code):"
  cat /tmp/bootstrap-response.json
  echo ""

  if [ "$$http_code" != "200" ]; then
    echo "ERROR: Bootstrap request failed with HTTP $$http_code"
    exit 1
  fi

  echo "Waiting for config.json to appear..."
  until [ -f /etc/stalwart/config.json ]; do
    sleep 2
  done

  echo "Restarting Stalwart to load bootstrapped config..."
  stalwart_pid=$(grep -rl 'stalwart' /proc/[0-9]*/comm 2>/dev/null | head -1 | cut -d/ -f3)
  if [ -n "$$stalwart_pid" ]; then
    kill "$$stalwart_pid"
    echo "Sent SIGTERM to Stalwart (PID $$stalwart_pid), waiting for it to come back..."
  fi
  until curl -sf http://localhost:8080/login > /dev/null 2>&1; do
    sleep 2
  done
  echo "Stalwart is back up after bootstrap restart."
fi

# --- Phase 2: Create user account ---

echo "Querying domain ID..."
domain_response=$(curl -s -X POST http://localhost:8080/jmap -u "admin:$$ADMIN_PASSWORD" -H "Content-Type: application/json" -d '{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Domain/query",{"filter":{}},"d1"]]}')
echo "Domain response: $$domain_response"

domain_id=$(echo "$$domain_response" | grep -o '"ids":\["[^"]*"' | grep -o '"[^"]*"$$' | tr -d '"')
echo "Domain ID: $$domain_id"

if [ -z "$$domain_id" ]; then
  echo "ERROR: Could not determine domain ID"
  exit 1
fi

echo "Creating user account..."
user_payload=$(echo "$$CREATE_USER_PAYLOAD" | sed "s|__DOMAIN_ID__|$$domain_id|" | sed "s|__USER_PASSWORD__|$$USER_PASSWORD|")

http_code=$(curl -s -o /tmp/user-response.json -w '%{http_code}' -X POST http://localhost:8080/jmap -u "admin:$$ADMIN_PASSWORD" -H "Content-Type: application/json" -d "$$user_payload")
echo "User creation response (HTTP $$http_code):"
cat /tmp/user-response.json
echo ""

if [ "$$http_code" != "200" ]; then
  echo "ERROR: User creation failed with HTTP $$http_code"
  exit 1
fi

# --- Phase 3: Configure TLS certificate ---

echo "Creating TLS certificate from mounted files..."
http_code=$(curl -s -o /tmp/cert-response.json -w '%{http_code}' -X POST http://localhost:8080/jmap -u "admin:$$ADMIN_PASSWORD" -H "Content-Type: application/json" -d '{
  "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
  "methodCalls": [
    [
      "x:Certificate/set",
      {
        "create": {
          "internal-ca-cert": {
            "certificate": {
              "@type": "File",
              "filePath": "/tls/tls.crt"
            },
            "privateKey": {
              "@type": "File",
              "filePath": "/tls/tls.key"
            }
          }
        }
      },
      "create-cert"
    ]
  ]
}')
echo "Certificate creation response (HTTP $$http_code):"
cat /tmp/cert-response.json
echo ""

if [ "$$http_code" != "200" ]; then
  echo "ERROR: Certificate creation failed with HTTP $$http_code"
  exit 1
fi

cert_id=$(cat /tmp/cert-response.json | grep -o '"internal-ca-cert":{[^}]*"id":"[^"]*"' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Certificate ID: $$cert_id"

if [ -n "$$cert_id" ]; then
  echo "Setting default certificate..."
  http_code=$(curl -s -o /tmp/default-cert-response.json -w '%{http_code}' -X POST http://localhost:8080/jmap -u "admin:$$ADMIN_PASSWORD" -H "Content-Type: application/json" -d "{
    \"using\": [\"urn:ietf:params:jmap:core\", \"urn:stalwart:jmap\"],
    \"methodCalls\": [
      [
        \"x:SystemSettings/set\",
        {
          \"update\": {
            \"singleton\": {
              \"defaultCertificateId\": \"$$cert_id\"
            }
          }
        },
        \"set-default-cert\"
      ]
    ]
  }")
  echo "Default certificate response (HTTP $$http_code):"
  cat /tmp/default-cert-response.json
  echo ""
fi

# --- Restart Stalwart to load config + TLS certificate ---

echo "Restarting Stalwart to apply all configuration..."
stalwart_pid=$(grep -rl 'stalwart' /proc/[0-9]*/comm 2>/dev/null | head -1 | cut -d/ -f3)
if [ -n "$$stalwart_pid" ]; then
  kill "$$stalwart_pid"
  echo "Sent SIGTERM to Stalwart (PID $$stalwart_pid)"
fi

touch "$$SETUP_COMPLETE"
echo "Setup complete, sleeping..."
sleep infinity
