const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ALERT_FILE = path.join(DATA_DIR, 'weather_alerts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'alert_history.json');

console.log('--- Local Weather Alerts Reset & Recrawl Start ---');

// 1. 기존 데이터 삭제
if (fs.existsSync(ALERT_FILE)) {
    fs.unlinkSync(ALERT_FILE);
    console.log('Deleted weather_alerts.json');
}
if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE);
    console.log('Deleted alert_history.json');
}

// 2. 크롤러 실행
const crawler = require('./weather_alerts_crawler');

console.log('Running crawler...');
crawler.run().then(changes => {
    console.log('--- Recrawl Finished ---');
    console.log('Changes detected:', changes ? changes.length : 0);
    process.exit(0);
}).catch(err => {
    console.error('Crawler Error:', err);
    process.exit(1);
});
