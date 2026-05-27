const amqp = require('amqplib');
const connectDB = require('./database');
const { processActivity } = require('./services/activityProcessor');

// Guard flag prevents multiple overlapping reconnection attempts when both the
// channel and connection fire close/error events in rapid succession.
let isReconnecting = false;

/**
 * Opens a RabbitMQ connection + channel, registers error/close listeners on
 * both, and starts consuming from the user_activities queue.
 *
 * If either the connection or channel closes (e.g. broker restart, network
 * blip), the listener triggers a 5 s debounced reconnection attempt, rebuilding
 * the full connection + channel stack from scratch.
 */
const connectRabbitMQAndConsume = async () => {
    isReconnecting = false;

    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');

        // ── Connection-level events ────────────────────────────────────────────
        connection.on('error', (err) => {
            // 'close' fires after 'error', so reconnection is triggered there.
            // We just log here to surface the root cause.
            console.error('RabbitMQ connection error:', err.message);
        });

        connection.on('close', () => {
            console.error('RabbitMQ connection closed unexpectedly. Reconnecting in 5s...');
            scheduleReconnect();
        });

        // ── Channel setup ──────────────────────────────────────────────────────
        const channel = await connection.createChannel();

        // Channel-level events — the channel can die independently of the
        // connection (e.g. consumer cancellation, broker-side channel error).
        channel.on('error', (err) => {
            // 'close' fires after 'error' on the channel too; reconnection is
            // scheduled there to avoid double-triggering.
            console.error('RabbitMQ channel error:', err.message);
        });

        channel.on('close', () => {
            console.error('RabbitMQ channel closed. Re-establishing connection in 5s...');
            scheduleReconnect();
        });

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
                        // Malformed JSON will never recover — discard (dead-letter)
                        channel.nack(msg, false, false);
                    } else {
                        // Transient errors (e.g., DB unavailable) — requeue for retry
                        channel.nack(msg, false, true);
                    }
                }
            }
        });
    } catch (error) {
        console.error('RabbitMQ connection attempt failed:', error.message);
        scheduleReconnect();
    }
};

/**
 * Debounced reconnection scheduler.
 * Ensures only one reconnection attempt is in-flight at any time even if both
 * the channel and connection fire close events simultaneously.
 */
const scheduleReconnect = () => {
    if (isReconnecting) return;
    isReconnecting = true;
    setTimeout(connectRabbitMQAndConsume, 5000);
};

const startWorker = async () => {
    await connectDB();
    await connectRabbitMQAndConsume();
};

startWorker();