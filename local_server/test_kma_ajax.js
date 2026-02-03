const https = require('https');
const fs = require('fs');

const ajaxUrl = 'https://www.weather.go.kr/w/repos/special-report/overall.do';

async function testAjax() {
    const options = {
        hostname: 'www.weather.go.kr',
        path: '/w/repos/special-report/overall.do',
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
                fs.writeFileSync('kma_ajax_debug.html', data);
                const str = data.toString();
                const keywords = ['특정관리해역', '연안바다', '평수구역'];
                keywords.forEach(kw => {
                    const idx = str.indexOf(kw);
                    if (idx !== -1) {
                        console.log(`\n✅ '${kw}' 발견!`);
                    } else {
                        // 유니코드 이스케이프 체크
                        const escaped = '\\u' + kw.charCodeAt(0).toString(16).toUpperCase();
                        if (str.indexOf(escaped) !== -1) {
                            console.log(`\n✅ '${kw}' (유니코드) 발견!`);
                        }
                    }
                });
                resolve(str);
            });
        }).on('error', reject);
    });
}

testAjax().catch(console.error);
