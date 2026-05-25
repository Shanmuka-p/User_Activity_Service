// Sliding Window Log rate limiter
// Each IP stores an array of request timestamps within the current window.
// On every request, timestamps older than windowMs are discarded.
// This prevents burst attacks at fixed-window boundaries.

const requestLog = new Map(); // ip -> array of request timestamps (ms)

// Memory leak prevention: remove IPs with no recent activity every minute
setInterval(() => {
    const now = Date.now();
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    for (const [ip, timestamps] of requestLog.entries()) {
        const active = timestamps.filter(t => now - t < windowMs);
        if (active.length === 0) {
            requestLog.delete(ip);
        } else {
            requestLog.set(ip, active);
        }
    }
}, 60000).unref(); // .unref() prevents this timer from keeping the process alive in tests

const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
    const now = Date.now();

    // Get existing timestamps for this IP, or start fresh
    const timestamps = (requestLog.get(ip) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= maxRequests) {
        // Retry-After: time until the oldest request falls out of the window
        const retryAfterMs = windowMs - (now - timestamps[0]);
        const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            error: 'Too Many Requests'
        });
    }

    // Record this request and allow it through
    timestamps.push(now);
    requestLog.set(ip, timestamps);
    next();
};

module.exports = rateLimiter;