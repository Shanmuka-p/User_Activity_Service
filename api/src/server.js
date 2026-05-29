const express = require('express');
const activityRoutes = require('./routes/activityRoutes');
const { connectRabbitMQ } = require('./rabbitmq');
const { getDashboardHtml } = require('./dashboard');
const { getClient } = require('./middlewares/rateLimiter');

const app = express();

app.use(express.json());
app.use('/api/v1/activities', activityRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
});

app.get('/', (req, res) => {
    res.send(getDashboardHtml());
});

const PORT = process.env.API_PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
    connectRabbitMQ().then(() => {
        // Initialize/warm up the Redis connection so the first request doesn't fail open
        try {
            getClient();
        } catch (err) {
            console.error('Failed to initialize Redis client:', err.message);
        }
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    });
}

module.exports = app;