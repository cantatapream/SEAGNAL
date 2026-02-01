const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        // 모바일 화면 비율 (S24 Ultra 등 최신 기기 비율인 20:9에 가깝게)
        defaultViewport: { width: 500, height: 1100, deviceScaleFactor: 3 }
    });
    const page = await browser.newPage();

    // 로컬 서버로 이동
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });

    // 배경을 투명하게 설정 (이미지만 따기 위해)
    // 단, 글로우 효과가 잘 보이려면 배경이 있는 게 나을 수도 있지만,
    // 안드로이드 레이어 리스트에서 배경색을 따로 깔아주므로 여기서는 '콘텐츠'만 캡처하는 것이 좋음.
    // 하지만, 안드로이드 12 스플래시 아이콘 허용 크기가 작아서 
    // 그냥 "화면 전체를 채우는" 방식이 아니라 "아이콘 영역"에 모든 정보를 구겨 넣어야 함.

    // 대기 (애니메이션 완료)
    await new Promise(r => setTimeout(r, 2800));

    // 스플래시 콘텐츠 전체 영역 선택
    const element = await page.$('.splash-content');

    if (element) {
        // 배경 투명 캡처
        await element.screenshot({
            path: 'images/splash_full_re.png',
            omitBackground: true
        });
        console.log('이미지 생성 완료: images/splash_full_re.png');
    }

    await browser.close();
})();
