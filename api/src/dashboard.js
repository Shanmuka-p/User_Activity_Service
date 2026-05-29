const fs = require('fs');
const path = require('path');

let htmlContent = '';
try {
    htmlContent = fs.readFileSync(path.join(__dirname, 'views', 'dashboard.html'), 'utf8');
} catch (err) {
    console.error('Failed to read dashboard.html:', err);
}

const getDashboardHtml = () => htmlContent;

module.exports = { getDashboardHtml };
