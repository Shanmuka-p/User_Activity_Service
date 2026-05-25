#!/bin/bash
# =============================================================
# User Activity Service — curl Examples
# Run `docker-compose up --build` first, then execute these.
# =============================================================

BASE_URL="http://localhost:3000"

echo ""
echo "============================================"
echo "  1. Health Check"
echo "============================================"
curl -s "$BASE_URL/health" | jq .
# Expected: { "status": "UP" }

echo ""
echo "============================================"
echo "  2. Ingest a valid user_login event"
echo "============================================"
curl -s -X POST "$BASE_URL/api/v1/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "eventType": "user_login",
    "timestamp": "2023-10-27T10:00:00Z",
    "payload": {
      "ipAddress": "192.168.1.1",
      "device": "desktop",
      "browser": "Chrome"
    }
  }' | jq .
# Expected: 202 { "message": "Event successfully received and queued." }

echo ""
echo "============================================"
echo "  3. Ingest a purchase event"
echo "============================================"
curl -s -X POST "$BASE_URL/api/v1/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "b2c3d4e5-f6a7-8901-2345-678901bcdef0",
    "eventType": "purchase",
    "timestamp": "2023-10-27T11:30:00Z",
    "payload": {
      "productId": "prod_abc123",
      "amount": 99.99,
      "currency": "USD"
    }
  }' | jq .

echo ""
echo "============================================"
echo "  4. 400 Bad Request — missing required fields"
echo "============================================"
curl -s -X POST "$BASE_URL/api/v1/activities" \
  -H "Content-Type: application/json" \
  -d '{ "eventType": "user_login" }' | jq .
# Expected: 400 { "error": "Bad Request", "details": [...] }

echo ""
echo "============================================"
echo "  5. 400 Bad Request — invalid UUID format"
echo "============================================"
curl -s -X POST "$BASE_URL/api/v1/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "not-a-valid-uuid",
    "eventType": "user_login",
    "timestamp": "2023-10-27T10:00:00Z",
    "payload": {}
  }' | jq .

echo ""
echo "============================================"
echo "  6. 400 Bad Request — invalid timestamp"
echo "============================================"
curl -s -X POST "$BASE_URL/api/v1/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "eventType": "user_login",
    "timestamp": "tomorrow",
    "payload": {}
  }' | jq .

echo ""
echo "============================================"
echo "  7. Test rate limiting (51 rapid requests)"
echo "     The 51st should return 429"
echo "============================================"
for i in $(seq 1 51); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/activities" \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "eventType": "rate_test",
      "timestamp": "2023-10-27T10:00:00Z",
      "payload": {}
    }')
  echo "Request $i: HTTP $STATUS"
done
