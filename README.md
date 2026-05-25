# User Activity Service

An event-driven microservice for tracking user activities at scale. A REST API ingests activity events, validates them, enforces IP-based rate limiting, and publishes them to a **RabbitMQ** message queue. A separate **Consumer Worker** asynchronously reads from the queue and persists the data into **MongoDB**. The entire stack is orchestrated via **Docker Compose**.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Client / API Consumer                  │
└──────────────────────────┬───────────────────────────────────┘
                           │ POST /api/v1/activities
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    API Service (Express)                      │
│                                                              │
│  1. Rate Limiter Middleware (50 req/min per IP)              │
│  2. Joi Input Validation                                     │
│  3. Publish to RabbitMQ queue: user_activities               │
│  4. Return 202 Accepted                                      │
└──────────────────────────┬───────────────────────────────────┘
                           │ Publish (JSON message)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              RabbitMQ — Queue: user_activities (durable)     │
└──────────────────────────┬───────────────────────────────────┘
                           │ Consume
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  Consumer Worker (Node.js)                   │
│                                                              │
│  1. Parse JSON message                                       │
│  2. Save Activity document to MongoDB                        │
│  3. channel.ack(msg) on success                              │
│  4. channel.nack(msg) with/without requeue on failure        │
└──────────────────────────┬───────────────────────────────────┘
                           │ Persist
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                        MongoDB                               │
│              Collection: activities                          │
└──────────────────────────────────────────────────────────────┘
```

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed Mermaid sequence diagram.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- Git

---

## Quick Start (One Command)

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/User_Activity_Service.git
cd User_Activity_Service

# 2. Copy environment variables
cp .env.example .env

# 3. Start all services
docker-compose up --build
```

All services will start automatically. Docker Compose health checks ensure RabbitMQ and MongoDB are fully ready before the API and Consumer boot.

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| API Health Check | http://localhost:3000/health |
| RabbitMQ Management UI | http://localhost:15672 (guest / guest) |
| MongoDB | mongodb://localhost:27017 |

---

## Running Tests

### Inside Docker (Recommended — matches CI environment)

```bash
# Run API tests
docker-compose exec api npm test

# Run Consumer tests
docker-compose exec consumer npm test
```

### Locally (requires Node.js 20+)

```bash
# API tests
cd api
npm install
npm test

# Consumer tests
cd ../consumer
npm install
npm test
```

---

## API Endpoints

### `POST /api/v1/activities`

Ingests a user activity event. Validates the payload, enforces rate limiting, and queues the event to RabbitMQ.

**Request Body:**

```json
{
  "userId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "eventType": "user_login",
  "timestamp": "2023-10-27T10:00:00Z",
  "payload": {
    "ipAddress": "192.168.1.1",
    "device": "desktop",
    "browser": "Chrome"
  }
}
```

| Field | Type | Rules |
|---|---|---|
| `userId` | string | Required, valid UUID (v4) |
| `eventType` | string | Required, non-empty |
| `timestamp` | string | Required, valid ISO-8601 date |
| `payload` | object | Required, any JSON object |

**Responses:**

| Status | Description |
|---|---|
| `202 Accepted` | Event successfully received and queued |
| `400 Bad Request` | Invalid or missing fields — body includes `details` array |
| `429 Too Many Requests` | Rate limit exceeded — includes `Retry-After` header (seconds) |
| `500 Internal Server Error` | RabbitMQ publish failure |

**curl Examples:**

```bash
# ✅ Valid request
curl -X POST http://localhost:3000/api/v1/activities \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "eventType": "user_login",
    "timestamp": "2023-10-27T10:00:00Z",
    "payload": { "ipAddress": "192.168.1.1", "device": "desktop", "browser": "Chrome" }
  }'
# → 202 Accepted: { "message": "Event successfully received and queued." }

# ❌ Missing required fields
curl -X POST http://localhost:3000/api/v1/activities \
  -H "Content-Type: application/json" \
  -d '{ "eventType": "user_login" }'
# → 400 Bad Request: { "error": "Bad Request", "details": [...] }

# ❌ Invalid UUID
curl -X POST http://localhost:3000/api/v1/activities \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "not-a-uuid",
    "eventType": "user_login",
    "timestamp": "2023-10-27T10:00:00Z",
    "payload": {}
  }'
# → 400 Bad Request
```

---

### `GET /health`

Returns the operational status of the API service. Used by Docker Compose health checks.

```bash
curl http://localhost:3000/health
# → 200 OK: { "status": "UP" }
```

---

## Environment Variables

See [.env.example](./.env.example) for all variables. Copy to `.env` before running locally.

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | RabbitMQ connection string |
| `DATABASE_URL` | `mongodb://user:password@localhost:27017/activity_db?authSource=admin` | MongoDB connection string |
| `API_PORT` | `3000` | API service port |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit time window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `50` | Max requests per window per IP |

---

## Architecture Decisions

### 1. Why RabbitMQ for message queuing?
RabbitMQ decouples the API (ingestion) from the Consumer (processing). If the consumer is temporarily down, events are safely held in the queue — the API continues accepting requests without data loss. This is the core benefit of an event-driven architecture.

### 2. Why durable queues + persistent messages?
`{ durable: true }` on `assertQueue` and `{ persistent: true }` on `sendToQueue` ensure that messages survive a RabbitMQ broker restart. Without these, a broker crash would silently drop all unprocessed messages.

### 3. Why smart nack — requeue vs dead-letter?
When the consumer encounters a `SyntaxError` (malformed JSON), it calls `channel.nack(msg, false, false)` — **no requeue**. A malformed message will never become valid JSON, so requeueing it would create an infinite retry loop, consuming resources and never succeeding. For all other errors (transient DB issues), it requeues with `channel.nack(msg, false, true)`.

### 4. Why in-memory sliding window rate limiting?
A sliding window log prevents burst attacks that exploit fixed-window boundaries. It uses an array of request timestamps per IP, filtering out those older than the window on every request — giving a true per-minute view. An in-memory Map is sufficient for a single-instance deployment. For multi-instance, Redis would be the production choice.

### 5. Why MongoDB over MySQL?
The `payload` field is intentionally schema-less (any valid JSON object). MongoDB's `Mixed` type handles arbitrary payload structures without requiring schema migrations for every new event type — a natural fit for activity tracking.

### 6. Why generate `id` at the API layer?
By generating a UUID for each event at ingestion time (before publishing), the event message itself carries its identity. This enables the consumer to implement **idempotency** — checking if an `id` already exists in the database before saving, preventing duplicate processing in failure-retry scenarios.

---

## Project Structure

```
User_Activity_Service/
├── api/
│   ├── src/
│   │   ├── controllers/
│   │   │   └── activityController.js   # Joi validation + publish
│   │   ├── middlewares/
│   │   │   └── rateLimiter.js          # Sliding window rate limiter
│   │   ├── routes/
│   │   │   └── activityRoutes.js       # Route definitions
│   │   ├── rabbitmq.js                 # RabbitMQ connection + publish
│   │   └── server.js                   # Express app entry point
│   ├── tests/
│   │   ├── activity.test.js            # API integration tests
│   │   └── rateLimiter.test.js         # Rate limiter unit tests
│   ├── .dockerignore
│   ├── Dockerfile
│   └── package.json
├── consumer/
│   ├── src/
│   │   ├── models/
│   │   │   └── Activity.js             # Mongoose schema
│   │   ├── services/
│   │   │   └── activityProcessor.js    # Parse + save logic
│   │   ├── database.js                 # MongoDB connection
│   │   └── worker.js                   # RabbitMQ consumer loop
│   ├── tests/
│   │   └── processor.test.js           # Consumer unit tests
│   ├── .dockerignore
│   ├── Dockerfile
│   └── package.json
├── examples/
│   └── curl_examples.sh                # Ready-to-run curl commands
├── ARCHITECTURE.md                     # Mermaid sequence diagram
├── API_DOCS.md                         # OpenAPI 3.0 specification
├── docker-compose.yml
├── .env.example
└── README.md
```