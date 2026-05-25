const mongoose = require('mongoose');
const crypto = require('crypto');

const activitySchema = new mongoose.Schema({
    id: { 
        type: String, 
        unique: true, 
        required: true,
        default: () => crypto.randomUUID()
    },
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    eventType: { 
        type: String, 
        required: true 
    },
    timestamp: { 
        type: Date, 
        required: true 
    },
    processedAt: { 
        type: Date, 
        default: Date.now 
    },
    payload: { 
        type: mongoose.Schema.Types.Mixed 
    }
}, { 
    versionKey: false 
});

module.exports = mongoose.model('Activity', activitySchema);