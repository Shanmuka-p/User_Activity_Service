openapi: 3.0.0
info:
  title: Event-Driven User Activity Service API
  description: API gateway for ingesting user activity events and queueing them for asynchronous processing.
  version: 1.0.0
servers:
  - url: http://localhost:3000/api/v1
    description: Local development server
paths:
  /activities:
    post:
      summary: Ingest a new user activity event
      description: Validates the incoming payload, enforces IP-based rate limiting, and queues the event to RabbitMQ.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ActivityEvent'
      responses:
        '202':
          description: Event successfully received and queued.
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
                    example: Event successfully received and queued.
        '400':
          description: Bad Request. Invalid input payload.
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: string
                    example: Bad Request
                  details:
                    type: array
                    items:
                      type: string
                    example: 
                      - "\"userId\" must be a valid GUID"
        '429':
          description: Too Many Requests. Rate limit of 50 requests per minute exceeded.
          headers:
            Retry-After:
              description: Seconds remaining until the next request is allowed.
              schema:
                type: integer
                example: 45
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: string
                    example: Too Many Requests
  /health:
    get:
      summary: API Health Check
      description: Verifies the operational status of the API service for Docker Compose health checks.
      responses:
        '200':
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: UP
components:
  schemas:
    ActivityEvent:
      type: object
      required:
        - userId
        - eventType
        - timestamp
        - payload
      properties:
        userId:
          type: string
          format: uuid
          example: a1b2c3d4-e5f6-7890-1234-567890abcdef
        eventType:
          type: string
          example: user_login
        timestamp:
          type: string
          format: date-time
          example: "2023-10-27T10:00:00Z"
        payload:
          type: object
          additionalProperties: true
          example:
            ipAddress: 192.168.1.1
            device: desktop
            browser: Chrome