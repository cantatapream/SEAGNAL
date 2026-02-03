const https = require('https');
const fs = require('fs');

const ajaxUrl = 'https://www.weather.go.kr/w/repos/ajax/special-report/overall.do';

async function testAjax() {
    console.log(`🌐 AJAX 요청 테스트: ${ajaxUrl}`);
    const options = {
        hostname: 'www.weather.go.kr',
        path: '/w/repos/ajax/special-report/overall.do',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.weather.go.kr/w/special-report/overall.do',
            'X-Requested-With': 'XMLHttpRequest'
        }
    };

    return new Promise((resolve, reject) => {
        https.get(options, (res) => {
            let data = Buffer.alloc(0);
            res.on('data', (chunk) => { data = Buffer.concat([data, chunk]); });
            res.on('end', () => {
                const str = data.toString();
                fs.writeFileSync('kma_ajax_overall.html', data);
                console.log(`✅ 응답 수신 완료 (길이: ${str.length})`);

                const keywords = ['특정관리해역', '연안바다', '평수구역'];
                keywords.forEach(kw => {
                    const idx = str.indexOf(kw);
                    if (idx !== -1) {
                        console.log(`\n✅ '${kw}' 발견!`);
                        console.log(str.substring(idx - 50, idx + 500).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
                    }
                });
                resolve(str);
            });
        }).on('error', reject);
    });
}

testAjax().catch(console.error);
