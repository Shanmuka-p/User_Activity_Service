const amqp = require('amqplib');
const connectDB = require('./database');
const { processActivity } = require('./services/activityProcessor');

const startWorker = async () => {
    await connectDB();

    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');
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
                        channel.nack(msg, false, false);
                    } else {
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