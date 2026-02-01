const fs = require('fs');
const path = require('path');

const warningsPath = path.join(__dirname, 'data', 'warnings.json');
const rawData = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));

let kmaRaw = rawData.kma;
if (kmaRaw.startsWith('BASE64:')) {
    kmaRaw = Buffer.from(kmaRaw.substring(7), 'base64').toString('utf8');
}
fs.writeFileSync(path.join(__dirname, 'hub_decoded.txt'), kmaRaw, 'utf8');
