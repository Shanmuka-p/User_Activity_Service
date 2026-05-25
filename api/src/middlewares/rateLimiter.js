const rateLimitMap = new Map();

const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50;
    const currentTime = Date.now();

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, {
            count: 1,
            resetTime: currentTime + windowMs
        });
        return next();
    }

    const clientData = rateLimitMap.get(ip);

    if (currentTime > clientData.resetTime) {
        clientData.count = 1;
        clientData.resetTime = currentTime + windowMs;
        return next();
    }

    clientData.count++;

    if (clientData.count > maxRequests) {
        const retryAfterSeconds = Math.ceil((clientData.resetTime - currentTime) / 1000);
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            error: 'Too Many Requests'
        });
    }

    next();
};

module.exports = rateLimiter;