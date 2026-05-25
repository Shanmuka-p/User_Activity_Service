const amqp = require('amqplib');

let channel = null;

const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');
        channel = await connection.createChannel();
        await channel.assertQueue('user_activities', { durable: true });
        console.log('Connected to RabbitMQ');
    } catch (error) {
        console.error('RabbitMQ Connection Error:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
};

const publishActivity = (activity) => {
    if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
    }
    channel.sendToQueue(
        'user_activities',
        Buffer.from(JSON.stringify(activity)),
        { persistent: true }
    );
};

module.exports = {
    connectRabbitMQ,
    publishActivity
};