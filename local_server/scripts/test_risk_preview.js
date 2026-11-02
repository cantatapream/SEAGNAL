/**
 * 파일명: local_server/scripts/test_risk_preview.js
 * 역할  : 위험예측 미리보기와 실제 앱의 원본 스위치 CSS·스크립트 순서·오버레이 연결을 검사한다.
 * [연계] index2.html · risk_forecast_preview.html / verify_all.sh
 */
'use strict';const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../..');let pass=0,fail=0;
/** 화면 계약을 비교하고 결과를 기록한다. 예: test('원본 CSS',()=>assert.equal(...)). @param {string} label 사례 @param {Function} fn 검사 [연계] ← 아래 사례 / → 앱 마크업 */
function test(label,fn){try{fn();pass++;}catch(e){fail++;console.error('FAIL',label,e.message);}}
const index=fs.readFileSync(path.join(root,'client/index2.html'),'utf8'),preview=fs.readFileSync(path.join(root,'client/risk_forecast_preview.html'),'utf8');
const css=index.slice(index.indexOf('        .ocean-legend-stack > .banzone-legend,'),index.indexOf('        /* 선택 초기화 버튼',index.indexOf('        .ocean-legend-stack > .banzone-legend,')));
test('미리보기 원본 CSS 동일',()=>assert.ok(preview.includes(css)));
test('index2 버튼 한 줄',()=>assert.match(index,/<span class="ocean-overlay-label">위험예측<\/span>/));
test('실제 범례 칸',()=>assert.match(index,/<div class="ocean-legend-stack" id="ocean-legend-stack">\s*<div class="rf-legend" id="risk-forecast-legend"/));
test('위험 범례 컨테이너 원본 선택자',()=>assert.match(css,/\.ocean-legend-stack > \.rf-legend > \.banzone-legend \{/));
test('실제 시트',()=>assert.ok(index.includes('id="risk-forecast-sheet"')));
const modules=['risk_format','risk_api','risk_map_layer','risk_slider','risk_sheet','risk_basis_content','risk_basis','risk_forecast'];
for(const html of [index,preview])for(let i=1;i<modules.length;i++)test('로드 '+modules[i],()=>assert.ok(html.indexOf('/'+modules[i-1]+'.js')<html.indexOf('/'+modules[i]+'.js')));
test('life_safety 뒤 로드 방지',()=>assert.ok(index.indexOf('<script src="js/marine-life/risk-forecast/risk_forecast.js')<index.indexOf('<script src="js/marine-life/safety/life_safety.js')));
test('지도 클릭 연결',()=>assert.match(fs.readFileSync(path.join(root,'client/js/ocean-map/map/ocean_map.js'),'utf8'),/_riskForecastTryHandleClick\(oceanMap, evt\)/));
test('단독 오버레이 등록',()=>assert.match(fs.readFileSync(path.join(root,'client/js/marine-life/safety/life_safety.js'),'utf8'),/var SOLO_BTN_IDS = \[\s*'ocean-risk-forecast-toggle-btn'/));
test('미리보기 실제 모듈 사용',()=>assert.match(preview,/RiskForecast\.mount/));
test('미리보기 검색 제외',()=>assert.match(preview,/name="robots" content="noindex"/));
console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
