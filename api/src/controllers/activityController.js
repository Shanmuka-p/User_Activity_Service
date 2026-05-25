const Joi = require('joi');
const { publishActivity } = require('../rabbitmq');

const activitySchema = Joi.object({
    userId: Joi.string().uuid().required(),
    eventType: Joi.string().trim().min(1).required(),
    timestamp: Joi.date().iso().required(),
    payload: Joi.object().required()
});

const ingestActivity = async (req, res) => {
    const { error, value } = activitySchema.validate(req.body);

    if (error) {
        return res.status(400).json({
            error: 'Bad Request',
            details: error.details.map(d => d.message)
        });
    }

    try {
        publishActivity(value);
        res.status(202).json({ message: 'Event successfully received and queued.' });
    } catch (err) {
        console.error('Publish Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    ingestActivity
};