const amqp = require('amqplib');
const connectDB = require('./database');
const { processActivity } = require('./services/activityProcessor');

const startWorker = async () => {
    await connectDB();

    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');

        // Reconnect automatically if the connection drops unexpectedly.
        // Without these handlers, the worker would silently hang after a broker restart.
        connection.on('close', () => {
            console.error('RabbitMQ connection closed unexpectedly. Reconnecting in 5s...');
            setTimeout(startWorker, 5000);
        });

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err.message);
            // The 'close' event fires after 'error' and will trigger reconnection
        });

        const channel = await connection.createChannel();
        
        await channel.assertQueue('user_activities', { durable: true });
        channel.prefetch(10);

        console.log('Worker started. Listening for messages...');

        channel.consume('user_activities', async (msg) => {
            if (msg !== null) {
                try {
                    await processActivity(msg.content.toString());
                    channel.ack(msg);
                } catch (error) {
                    console.error('Error processing message:', error);
                    
                    if (error instanceof SyntaxError) {
                        // Malformed JSON will never recover — discard it (dead-letter)
                        channel.nack(msg, false, false);
                    } else {
                        // Transient errors (e.g., DB unavailable) — requeue for retry
                        channel.nack(msg, false, true);
                    }
                }
            }
        });
    } catch (error) {
        console.error('RabbitMQ Connection Error:', error);
        setTimeout(startWorker, 5000);
    }
};

startWorker();