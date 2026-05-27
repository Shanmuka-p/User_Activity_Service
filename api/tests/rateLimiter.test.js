/**
 * Rate Limiter Tests
 *
 * The Redis client is replaced with a deterministic in-memory fake that
 * simulates the sorted-set pipeline used by rateLimiter.js.  No real Redis
 * process is needed — tests run fully offline and at Jest's native speed.
 *
 * The fake stores per-key sorted sets as arrays of { score, member } objects
 * and executes the exact ZREMRANGEBYSCORE / ZADD / ZCARD / EXPIRE / ZRANGE
 * commands the middleware issues.
 */

const { setClient } = require('../src/middlewares/rateLimiter');
const rateLimiter = require('../src/middlewares/rateLimiter');

// Prevent any real ioredis client from being created during the test run.
// setClient(null) ensures _client is null on module load, and beforeEach
// injects FakeSortedSet before each test, so getClient() is never called.
beforeAll(() => {
    setClient(null);
});

afterAll(() => {
    setClient(null); // ensure clean state after suite
});

// ─── In-Memory Redis Fake ─────────────────────────────────────────────────────

class FakeSortedSet {
    constructor() {
        this.data = {}; // key -> Array<{ score: number, member: string }>
    }

    _getSet(key) {
        if (!this.data[key]) this.data[key] = [];
        return this.data[key];
    }

    zremrangebyscore(key, min, max) {
        const set = this._getSet(key);
        this.data[key] = set.filter(({ score }) => score < min || score > max);
        return Promise.resolve(null);
    }

    zadd(key, score, member) {
        // Sorted sets disallow duplicate members; replace if already present.
        const set = this._getSet(key);
        const idx = set.findIndex((e) => e.member === member);
        if (idx !== -1) {
            set[idx].score = score;
        } else {
            set.push({ score, member });
            set.sort((a, b) => a.score - b.score);
        }
        return Promise.resolve(null);
    }

    zcard(key) {
        return Promise.resolve(this._getSet(key).length);
    }

    expire(key, _ttl) {
        // TTL management not needed for unit tests
        return Promise.resolve(null);
    }

    zrange(key, start, stop, withScores) {
        const set = this._getSet(key);
        const slice = set.slice(start, stop === -1 ? undefined : stop + 1);
        if (withScores === 'WITHSCORES') {
            // ioredis returns a flat array: [member, score, member, score, ...]
            return Promise.resolve(slice.flatMap(({ member, score }) => [member, score.toString()]));
        }
        return Promise.resolve(slice.map(({ member }) => member));
    }

    // Pipeline — collects commands, executes them all and returns [[err, val], …]
    multi() {
        const commands = [];
        const pipe = {
            zremrangebyscore: (...args) => { commands.push(['zremrangebyscore', args]); return pipe; },
            zadd: (...args) => { commands.push(['zadd', args]); return pipe; },
            zcard: (...args) => { commands.push(['zcard', args]); return pipe; },
            expire: (...args) => { commands.push(['expire', args]); return pipe; },
            exec: async () => {
                const results = [];
                for (const [cmd, args] of commands) {
                    const val = await this[cmd](...args);
                    results.push([null, val]);
                }
                return results;
            },
        };
        return pipe;
    }

    on() { /* no-op — error events not needed in tests */ }
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

let fakeRedis;

beforeEach(() => {
    fakeRedis = new FakeSortedSet();
    setClient(fakeRedis);
    jest.useRealTimers();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Each test uses a unique IP to avoid state bleed (the fake Redis is shared per
// test via beforeEach reset, but using distinct IPs makes intent explicit).
const mockReq = (ip = '192.168.1.1') => ({
    ip,
    connection: { remoteAddress: ip },
});

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Rate Limiter Middleware (Redis-backed)', () => {
    it('should allow the first request through', async () => {
        const next = jest.fn();
        await rateLimiter(mockReq('10.1.0.1'), mockRes(), next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('should allow requests up to the maximum limit', async () => {
        const ip = '10.1.0.2';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const next = jest.fn();

        for (let i = 0; i < maxRequests; i++) {
            // Use unique timestamps by temporarily shifting Date.now
            jest.spyOn(Date, 'now').mockReturnValue(Date.now() + i);
            await rateLimiter(mockReq(ip), mockRes(), next);
        }

        jest.restoreAllMocks();
        expect(next).toHaveBeenCalledTimes(maxRequests);
    });

    it('should block the request that exceeds the limit with 429', async () => {
        const ip = '10.1.0.3';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;

        // Exhaust the limit — give each call a unique ms timestamp
        const baseTime = Date.now();
        for (let i = 0; i < maxRequests; i++) {
            jest.spyOn(Date, 'now').mockReturnValue(baseTime + i);
            await rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        // The (limit+1)th request should be blocked
        jest.spyOn(Date, 'now').mockReturnValue(baseTime + maxRequests);
        const res = mockRes();
        const next = jest.fn();
        await rateLimiter(mockReq(ip), res, next);

        jest.restoreAllMocks();

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({ error: 'Too Many Requests' });
    });

    it('should set the Retry-After header when rate limited', async () => {
        const ip = '10.1.0.4';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const baseTime = Date.now();

        for (let i = 0; i < maxRequests; i++) {
            jest.spyOn(Date, 'now').mockReturnValue(baseTime + i);
            await rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        jest.spyOn(Date, 'now').mockReturnValue(baseTime + maxRequests);
        const res = mockRes();
        await rateLimiter(mockReq(ip), res, jest.fn());

        jest.restoreAllMocks();

        expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
        const retryAfterValue = res.set.mock.calls.find((c) => c[0] === 'Retry-After')[1];
        expect(Number(retryAfterValue)).toBeGreaterThan(0);
        expect(Number(retryAfterValue)).toBeLessThanOrEqual(60);
    });

    it('should allow requests again after the window resets', async () => {
        const ip = '10.1.0.5';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;

        // Fill up the window with requests at t=0..maxRequests-1
        const baseTime = 1_000_000; // fixed base for determinism
        for (let i = 0; i < maxRequests; i++) {
            jest.spyOn(Date, 'now').mockReturnValue(baseTime + i);
            await rateLimiter(mockReq(ip), mockRes(), jest.fn());
        }

        // Confirm it's blocked
        jest.spyOn(Date, 'now').mockReturnValue(baseTime + maxRequests);
        const blockedRes = mockRes();
        await rateLimiter(mockReq(ip), blockedRes, jest.fn());
        expect(blockedRes.status).toHaveBeenCalledWith(429);

        // Advance time beyond the window — all old entries fall outside windowStart
        const afterWindowTime = baseTime + windowMs + 1000;
        jest.spyOn(Date, 'now').mockReturnValue(afterWindowTime);

        const next = jest.fn();
        await rateLimiter(mockReq(ip), mockRes(), next);

        jest.restoreAllMocks();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('should rate limit each IP independently', async () => {
        const ip1 = '10.2.0.1';
        const ip2 = '10.2.0.2';
        const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
        const baseTime = Date.now();

        // Exhaust ip1's limit
        for (let i = 0; i < maxRequests; i++) {
            jest.spyOn(Date, 'now').mockReturnValue(baseTime + i);
            await rateLimiter(mockReq(ip1), mockRes(), jest.fn());
        }

        jest.spyOn(Date, 'now').mockReturnValue(baseTime + maxRequests);

        // ip2 should still be allowed
        const next = jest.fn();
        await rateLimiter(mockReq(ip2), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);

        // ip1 should be blocked
        const blockedRes = mockRes();
        await rateLimiter(mockReq(ip1), blockedRes, jest.fn());
        expect(blockedRes.status).toHaveBeenCalledWith(429);

        jest.restoreAllMocks();
    });

    it('should fail open and call next() when Redis is unavailable', async () => {
        // Replace the client with one that always rejects
        const failingClient = {
            multi: () => ({
                zremrangebyscore: () => failingPipe,
                zadd: () => failingPipe,
                zcard: () => failingPipe,
                expire: () => failingPipe,
                exec: () => Promise.reject(new Error('ECONNREFUSED')),
            }),
            on: () => {},
        };
        const failingPipe = failingClient.multi();
        setClient(failingClient);

        const next = jest.fn();
        const res = mockRes();
        await rateLimiter(mockReq('10.3.0.1'), res, next);

        // Should fail open — request is allowed through
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
