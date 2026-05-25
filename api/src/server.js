const express = require('express');
const activityRoutes = require('./routes/activityRoutes');
const { connectRabbitMQ } = require('./rabbitmq');

const app = express();

app.use(express.json());
app.use('/api/v1/activities', activityRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
});

const PORT = process.env.API_PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
    connectRabbitMQ().then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    });
}

module.exports = app;