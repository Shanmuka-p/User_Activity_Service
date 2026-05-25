const request = require('supertest');
const app = require('../src/server');
const rabbitmq = require('../src/rabbitmq');

jest.mock('../src/rabbitmq', () => ({
    connectRabbitMQ: jest.fn().mockResolvedValue(),
    publishActivity: jest.fn()
}));

describe('POST /api/v1/activities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 202 for valid payload', async () => {
        const payload = {
            userId: "123e4567-e89b-12d3-a456-426614174000",
            eventType: "user_login",
            timestamp: "2023-10-27T10:00:00.000Z",
            payload: { ipAddress: "192.168.1.1" }
        };

        const response = await request(app)
            .post('/api/v1/activities')
            .send(payload);

        expect(response.status).toBe(202);
        expect(rabbitmq.publishActivity).toHaveBeenCalledWith({
            ...payload,
            timestamp: new Date(payload.timestamp)
        });
    });

    it('should return 400 for invalid payload', async () => {
        const payload = {
            eventType: "user_login"
        };

        const response = await request(app)
            .post('/api/v1/activities')
            .send(payload);

        expect(response.status).toBe(400);
        expect(rabbitmq.publishActivity).not.toHaveBeenCalled();
    });
});