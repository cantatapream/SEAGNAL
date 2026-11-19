/**
 * Play 스토어 스크린샷 다시 만들기
 * sources/ 의 01_*.html ~ 08_*.html 을 1080×1920 PNG 로 찍어 final/ 에 같은 이름으로 저장한다.
 * 사용: node docs/store_listing/2026-11-19_playstore_screenshots/render.js [파일이름 일부]
 *   예) node .../render.js 04   → 04_태풍정보 만 다시 만듦
 * 필요: Playwright(Chromium), 인터넷(제목 글꼴 Noto Sans KR 을 Google Fonts 에서 받음)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, 'sources');
const OUT = path.join(__dirname, 'final');
const only = process.argv[2] || '';

(async () => {
  const files = fs.readdirSync(SRC).filter(f => /^\d\d_.*\.html$/.test(f) && f.includes(only)).sort();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const f of files) {
    await page.goto('file://' + path.join(SRC, f));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const out = path.join(OUT, f.replace(/\.html$/, '.png'));
    await page.screenshot({ path: out });
    console.log('saved', path.relative(process.cwd(), out));
  }
  await browser.close();
})();
