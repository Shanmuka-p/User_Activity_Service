const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.DATABASE_URL || 'mongodb://user:password@localhost:27017/activity_db?authSource=admin';
        await mongoose.connect(uri);
        console.log('MongoDB Connected successfully');
    } catch (error) {
        console.error('MongoDB Connection Error:', error);
        process.exit(1);
    }
};

module.exports = connectDB;