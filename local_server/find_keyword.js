const fs = require('fs');

function findKeyword() {
    const filename = process.argv[2] || 'kma_debug.html';
    if (!fs.existsSync(filename)) {
        console.error(`❌ 파일 없음: ${filename}`);
        return;
    }
    const data = fs.readFileSync(filename, 'utf8');
    const keywords = ['특정관리해역', '연안바다', '평수구역', '특보 내용'];

    console.log(`🔍 ${filename} 내 키워드 탐색 중...`);

    keywords.forEach(kw => {
        const index = data.indexOf(kw);
        if (index !== -1) {
            console.log(`\n✅ '${kw}' 발견! (Index: ${index})`);
            console.log('--- 주변 텍스트 500자 ---');
            console.log(data.substring(index - 50, index + 500).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
            console.log('------------------------');
        } else {
            console.log(`❌ '${kw}' 없음`);
        }
    });
}

findKeyword();
