// Distributed Sliding Window rate limiter backed by Redis.
// Uses a sorted set per IP (key: rate_limit:<ip>) where each member is a request
// timestamp. An atomic MULTI pipeline removes stale entries, records the new
// request, reads the count, and sets TTL — all in one round-trip.
//
// This approach is safe for horizontally-scaled deployments: every API instance
// shares the same Redis state, so a client cannot bypass the limit by routing
// requests across multiple pods.

// NOTE: ioredis is required lazily (inside getClient) rather than at module
// load time. This prevents an unwanted connection attempt when the module is
// imported during tests before a mock client has been injected via setClient().

let _Redis = null; // required lazily to keep module load side-effect-free
let _client = null;

const getClient = () => {
    if (!_client) {
        if (!_Redis) _Redis = require('ioredis');
        _client = new _Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
            enableOfflineQueue: false,
            lazyConnect: false,
            maxRetriesPerRequest: 1,
        });

        _client.on('error', (err) => {
            // Log but do not crash — graceful degradation is handled in the middleware
            console.error('Redis client error:', err.message);
        });
    }
    return _client;
};

// Injected by tests to replace the real Redis client with a fake.
const setClient = (mockClient) => {
    _client = mockClient;
};

// Disconnect the client cleanly. Called in afterAll() during tests.
const disconnect = async () => {
    if (_client && typeof _client.quit === 'function') {
        await _client.quit().catch(() => {});
    }
    _client = null;
};

const rateLimiter = async (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
    const now = Date.now();
    const windowStart = now - windowMs;
    const key = `rate_limit:${ip}`;

    try {
        const client = getClient();

        // Atomic pipeline — single round-trip to Redis:
        //   1. Remove timestamps older than the window
        //   2. Add the current request timestamp (score = value = ms timestamp)
        //   3. Count all timestamps in the window
        //   4. Set TTL so keys auto-expire from Redis memory
        const pipeline = client.multi();
        pipeline.zremrangebyscore(key, 0, windowStart);
        pipeline.zadd(key, now, now.toString());
        pipeline.zcard(key);
        pipeline.expire(key, Math.ceil(windowMs / 1000));

        const results = await pipeline.exec();
        // results is an array of [error, value] pairs
        const count = results[2][1]; // zcard result

        if (count > maxRequests) {
            // Calculate retry window: time until the oldest request ages out
            const oldestResult = await client.zrange(key, 0, 0, 'WITHSCORES');
            const oldestTimestamp = oldestResult.length >= 2
                ? parseInt(oldestResult[1], 10)
                : now;
            const retryAfterMs = windowMs - (now - oldestTimestamp);
            const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({ error: 'Too Many Requests' });
        }

        next();
    } catch (err) {
        // Fail open: if Redis is unavailable, allow the request through
        // rather than blocking all traffic. Log for observability.
        console.error('Rate limiter Redis error — failing open:', err.message);
        next();
    }
};

module.exports = rateLimiter;
module.exports.setClient = setClient;
module.exports.getClient = getClient;
module.exports.disconnect = disconnect;