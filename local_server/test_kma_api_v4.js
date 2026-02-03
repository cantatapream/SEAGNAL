const https = require('https');
const fs = require('fs');

async function testCorrectApi() {
    const urls = [
        '/w/wnuri-fct2021/main/warning.do',
        '/w/wnuri-fct2021/weather/warning.do'
    ];

    for (const path of urls) {
        console.log(`🌐 정밀 API 요청 테스트: ${path}`);
        const options = {
            hostname: 'www.weather.go.kr',
            path: path,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.weather.go.kr/w/special-report/overall.do',
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        try {
            const data = await new Promise((resolve, reject) => {
                https.get(options, (res) => {
                    let d = Buffer.alloc(0);
                    res.on('data', (chunk) => { d = Buffer.concat([d, chunk]); });
                    res.on('end', () => resolve(d.toString()));
                }).on('error', reject);
            });

            console.log(`✅ 응답 수신 완료 (길이: ${data.length})`);

            const keywords = ['특정관리해역', '연안바다', '평수구역', '특보 내용'];
            keywords.forEach(kw => {
                const idx = data.indexOf(kw);
                if (idx !== -1) {
                    console.log(`\n🎯🎯🎯 '${kw}' 발견!!! (Path: ${path})`);
                    console.log('--- [내용 추출] ---');
                    console.log(data.substring(idx - 50, idx + 1500).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
                    console.log('------------------\n');
                }
            });
        } catch (e) {
            console.error(`❌ 실패: ${e.message}`);
        }
    }
}

testCorrectApi();
