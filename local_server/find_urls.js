const fs = require('fs');
const data = fs.readFileSync('kma_debug.html', 'utf8');

const regex = /<script\s+[^>]*src="([^"]+)"/g;
let match;
console.log('--- JS 파일 목록 ---');
while ((match = regex.exec(data)) !== null) {
    console.log(match[1]);
}

console.log('\n--- 인라인 스크립트 기반 URL 탐색 ---');
const urlRegex = /["']([^"']+\.do[^"']*)["']/g;
while ((match = urlRegex.exec(data)) !== null) {
    console.log(match[1]);
}
