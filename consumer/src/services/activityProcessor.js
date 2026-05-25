const Activity = require('../models/Activity');

const processActivity = async (messageData) => {
    const parsedData = JSON.parse(messageData);
    const activity = new Activity(parsedData);
    await activity.save();
};

module.exports = { 
    processActivity 
};