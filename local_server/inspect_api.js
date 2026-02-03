const fs = require('fs');

function inspect() {
    const filename = 'api_debug__w_repos_wnuri-fct2021_main_warning.do.html';
    if (!fs.existsSync(filename)) return;
    const data = fs.readFileSync(filename, 'utf8');

    // HTML 태그 제거 및 공백 정리
    const pureText = data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    console.log('--- [텍스트 추출 결과] ---');
    console.log(pureText.substring(0, 5000)); // 처음 5000자만 출력
    console.log('-------------------------');
}

inspect();
