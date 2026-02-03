const https = require('https');
const fs = require('fs');

async function download() {
    console.log('🌐 기상청 특보종합 페이지 다운로드 중...');
    const options = {
        hostname: 'www.weather.go.kr',
        path: '/w/special-report/overall.do',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.get(options, (res) => {
            if (res.statusCode !== 200) {
                console.error(`❌ 서버 오류: ${res.statusCode}`);
                return reject(new Error(`Status: ${res.statusCode}`));
            }
            let data = Buffer.alloc(0);
            res.on('data', (chunk) => { data = Buffer.concat([data, chunk]); });
            res.on('end', () => {
                fs.writeFileSync('kma_debug.html', data);
                console.log(`✅ 저장 완료 (kma_debug.html, ${data.length} 바이트)`);
                resolve(data.toString());
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

download().catch(console.error);
