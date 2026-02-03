const fs = require('fs');
const data = fs.readFileSync('kma_debug.html', 'utf8');

const keywords = ['제주', '풍랑', '주의보', '경보', '예비'];

console.log('🔍 파일 내 지명/특보 키워드 탐색 중...');

keywords.forEach(kw => {
    const idx = data.indexOf(kw);
    if (idx !== -1) {
        console.log(`\n✅ '${kw}' 발견!`);
        console.log(data.substring(idx - 20, idx + 100).replace(/\s+/g, ' ').trim());
    }
});
