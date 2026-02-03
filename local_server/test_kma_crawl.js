const https = require('https');

async function testCrawl() {
    console.log('🌐 기상청 특보종합 페이지 크롤링 테스트 시작...');

    const options = {
        hostname: 'www.weather.go.kr',
        path: '/w/special-report/overall.do',
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`✅ 응답 수신 완료 (길이: ${data.length})`);

                // 1. <특정관리해역 연안바다 특보상황> 텍스트 추출
                // HTML 구조상 박스 안에 텍스트가 들어있을 확률이 높음
                const startTag = '<특정관리해역 연안바다 특보사항>';
                const endTag = '<참고사항>';

                let startIndex = data.indexOf(startTag);
                if (startIndex === -1) {
                    // 특수 기호 대응 ( &lt; 등 )
                    startIndex = data.indexOf('&lt;특정관리해역 연안바다 특보사항&gt;');
                }

                if (startIndex !== -1) {
                    let part = data.substring(startIndex);
                    let endIndex = part.indexOf(endTag);
                    if (endIndex === -1) endIndex = part.indexOf('&lt;참고사항&gt;');

                    if (endIndex !== -1) {
                        const resultText = part.substring(0, endIndex);
                        console.log('\n--- [파싱 결과] ---');
                        console.log(resultText.replace(/<[^>]*>/g, '').trim());
                        console.log('-------------------\n');
                        resolve(resultText);
                    } else {
                        console.warn('⚠️ 종료 태그를 찾을 수 없습니다.');
                        resolve(part.substring(0, 1000));
                    }
                } else {
                    console.error('❌ <특정관리해역 연안바다 특보상황> 섹션을 찾을 수 없습니다.');
                    // 키워드로 위치 찾기
                    const keyword = '연안바다';
                    const keyIndex = data.indexOf(keyword);
                    if (keyIndex !== -1) {
                        console.log(`🔍 '${keyword}' 키워드 발견! 주변 텍스트:`);
                        console.log(data.substring(keyIndex - 100, keyIndex + 500));
                    } else {
                        console.log('🔍 키워드 없음. 전체 텍스트 상단 일부:');
                        console.log(data.substring(0, 1000));
                    }
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ 요청 실패: ${e.message}`);
            reject(e);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

testCrawl().catch(console.error);
