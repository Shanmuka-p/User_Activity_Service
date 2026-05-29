const request = require('supertest');
const app = require('../src/server');
const rabbitmq = require('../src/rabbitmq');
const { setClient, disconnect } = require('../src/middlewares/rateLimiter');

jest.mock('../src/rabbitmq', () => ({
    connectRabbitMQ: jest.fn().mockResolvedValue(),
    publishActivity: jest.fn()
}));

// Inject a no-op Redis client so the rate limiter never attempts a real
// connection during the integration test run.
beforeAll(() => {
    const noopClient = {
        multi: () => {
            const pipe = {
                zremrangebyscore: () => pipe,
                zadd: () => pipe,
                zcard: () => pipe,
                expire: () => pipe,
                exec: async () => [[null, 0], [null, 1], [null, 1], [null, 1]],
            };
            return pipe;
        },
        zrange: async () => [],
        on: () => {},
    };
    setClient(noopClient);
});

afterAll(async () => {
    await disconnect();
});


// A fully valid base payload for reuse across tests
const validPayload = {
    userId: "123e4567-e89b-12d3-a456-426614174000",
    eventType: "user_login",
    timestamp: "2023-10-27T10:00:00.000Z",
    payload: { ipAddress: "192.168.1.1" }
};

describe('POST /api/v1/activities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 202 for valid payload', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send(validPayload);

        expect(response.status).toBe(202);
        expect(response.body).toHaveProperty('message', 'Event successfully received and queued.');
        expect(rabbitmq.publishActivity).toHaveBeenCalledTimes(1);
    });

    it('should call publishActivity with the validated payload including a generated id', async () => {
        await request(app)
            .post('/api/v1/activities')
            .send(validPayload);

        const publishedArg = rabbitmq.publishActivity.mock.calls[0][0];
        expect(publishedArg).toHaveProperty('id');
        expect(publishedArg.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
        expect(publishedArg.userId).toBe(validPayload.userId);
        expect(publishedArg.eventType).toBe(validPayload.eventType);
    });

    it('should return 400 when required fields are missing', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send({ eventType: "user_login" });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Bad Request');
        expect(response.body.details).toBeDefined();
        expect(Array.isArray(response.body.details)).toBe(true);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });

    it('should return 400 when userId is not a valid UUID', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send({ ...validPayload, userId: 'not-a-uuid' });

        expect(response.status).toBe(400);
        expect(response.body.details.some(d => d.includes('userId'))).toBe(true);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });

    it('should return 400 when timestamp is not a valid ISO-8601 date', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send({ ...validPayload, timestamp: 'not-a-date' });

        expect(response.status).toBe(400);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });

    it('should return 400 when eventType is an empty string', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send({ ...validPayload, eventType: '' });

        expect(response.status).toBe(400);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });

    it('should return 400 when payload is not an object', async () => {
        const response = await request(app)
            .post('/api/v1/activities')
            .send({ ...validPayload, payload: 'not-an-object' });

        expect(response.status).toBe(400);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });

    it('should return 500 when publishActivity throws an error', async () => {
        rabbitmq.publishActivity.mockImplementation(() => {
            throw new Error('RabbitMQ channel not initialized');
        });

        const response = await request(app)
            .post('/api/v1/activities')
            .send(validPayload);

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });
});

describe('GET /health', () => {
    it('should return 200 with status UP', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'UP');
    });
});

describe('GET /', () => {
    it('should return 200 with HTML content', async () => {
        const response = await request(app).get('/');

        expect(response.status).toBe(200);
        expect(response.text).toContain('<!DOCTYPE html>');
        expect(response.text).toContain('User Activity Service');
    });
});