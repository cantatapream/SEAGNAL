const https = require('https');
const fs = require('fs');

async function testApi() {
    const urls = [
        '/w/repos/wnuri-fct2021/main/warning.do',
        '/w/repos/wnuri-fct2021/weather/warning.do'
    ];

    for (const path of urls) {
        console.log(`🌐 API 요청 테스트: ${path}`);
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
            if (data.includes('특보')) {
                console.log('✨ 데이터 내 키워드 발견!');
                fs.writeFileSync(`api_debug_${path.replace(/\//g, '_')}.html`, data);

                // 특정관리해역 체크
                if (data.includes('특정관리해역')) {
                    console.log('🎯 특정관리해역 섹션 발견!!!');
                    const idx = data.indexOf('특정관리해역');
                    console.log(data.substring(idx - 50, idx + 1000).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
                }
            }
        } catch (e) {
            console.error(`❌ 실패: ${e.message}`);
        }
    }
}

testApi();
