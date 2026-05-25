const rateLimiter = require('../src/middlewares/rateLimiter');

// Helper: build a mock request with a given IP
const mockReq = (ip = '192.168.1.1') => ({
    ip,
    connection: { remoteAddress: ip }
});

// Helper: build a mock response that chains correctly
const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

describe('Rate Limiter Middleware', () => {
    // Each test uses a unique IP to avoid state bleed between tests
    // since the rateLimitMap is module-level state

    it('should allow the first request through', () => {
        const req = mockReq('10.1.0.1');
        const res = mockRes();
        const next = jest.fn();

        rateLimiter(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow requests up to the maximum limit', () => {
        const ip = '10.1.0.2';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const next = jest.fn();

        for (let i = 0; i < maxRequests; i++) {
            rateLimiter(mockReq(ip), mockRes(), next);
        }

        expect(next).toHaveBeenCalledTimes(maxRequests);
    });

    it('should block the request that exceeds the limit with 429', () => {
        const ip = '10.1.0.3';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;

        // Exhaust the full limit
        for (let i = 0; i < maxRequests; i++) {
            rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        // The next (exceeding) request
        const res = mockRes();
        const next = jest.fn();
        rateLimiter(mockReq(ip), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({ error: 'Too Many Requests' });
    });

    it('should set the Retry-After header when rate limited', () => {
        const ip = '10.1.0.4';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;

        for (let i = 0; i < maxRequests; i++) {
            rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        const res = mockRes();
        rateLimiter(mockReq(ip), res, jest.fn());

        expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));

        const retryAfterValue = res.set.mock.calls.find(c => c[0] === 'Retry-After')[1];
        expect(Number(retryAfterValue)).toBeGreaterThan(0);
        expect(Number(retryAfterValue)).toBeLessThanOrEqual(60);
    });

    it('should allow requests again after the window resets', () => {
        jest.useFakeTimers();

        const ip = '10.1.0.5';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;

        // Exhaust the limit
        for (let i = 0; i < maxRequests; i++) {
            rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        // Confirm it's blocked
        const blockedRes = mockRes();
        rateLimiter(mockReq(ip), blockedRes, jest.fn());
        expect(blockedRes.status).toHaveBeenCalledWith(429);

        // Advance time beyond the window
        jest.advanceTimersByTime(windowMs + 1000);

        // Should now be allowed again
        const next = jest.fn();
        rateLimiter(mockReq(ip), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
    });

    it('should rate limit each IP independently', () => {
        const ip1 = '10.2.0.1';
        const ip2 = '10.2.0.2';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;

        // Exhaust ip1's limit
        for (let i = 0; i < maxRequests; i++) {
            rateLimiter(mockReq(ip1), mockRes(), jest.fn());
        }

        // ip2 should still be allowed
        const next = jest.fn();
        rateLimiter(mockReq(ip2), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);

        // ip1 should be blocked
        const blockedRes = mockRes();
        rateLimiter(mockReq(ip1), blockedRes, jest.fn());
        expect(blockedRes.status).toHaveBeenCalledWith(429);
    });
});
