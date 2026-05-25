const express = require('express');
const { ingestActivity } = require('../controllers/activityController');
const rateLimiter = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/', rateLimiter, ingestActivity);

module.exports = router;