/**
 * 지방기상청 단기예보 PDF 해상 표 읽기 — 칸 수를 표 머리에 맞추는지 검사.
 * 실행: node local_server/scripts/test_regional_marine_parse.js
 * 왜: 읽는 코드가 9칸(그글피 오전·오후)까지 찾아, 표의 마지막 구역이 다음 줄(「동중국해」 등 구역 아닌 줄)의 값을 끌어왔다 —
 *   제주청 05시 「제주도남동쪽바깥먼바다」에 동중국해 값이 「12월 1일 오전」 칸으로 붙었다(2026-11-27, 사용자 「9번째 칸 고치고」).
 *   실제 PDF 21개(일곱 지방청 × 05·11·17시)로 고친 앞뒤를 견줘 그 4개 구역만 바뀌고 나머지는 글자까지 같음을 확인했다(커밋 메시지).
 *   이 검사는 pdf-parse 가 내는 글자 꼴(구역 이름 두 줄 → 풍향/풍속 · 날씨 · 파고 반복)을 그대로 흉내 낸다.
 * [연계] local_server/regional_forecast_collector.js parseMarineForecast(_parseMarineForecast 로 내보냄)
 */
'use strict';
const { _parseMarineForecast: parse } = require('../regional_forecast_collector');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

// 한 칸 = 풍향/풍속 · 날씨 · 파고(세 줄 「0.5 / ~ / 1.5」)
const cell = (w, sky, a, b) => [w, sky, a, '~', b];
const zone = (l1, l2, cells) => [l1, l2, ...cells.flatMap((c) => cell(...c))];
const head = (labels) => ['단 기 예 보 [해상]', '쪽수(3/3)', '2026년 11월 27일 05시 00분 발표', '구역', ...labels, '날씨', '파고'];
const SW = [['남서~서 / 7~11', '흐리고 한때 비', '0.5', '1.5'], ['서~북서 / 8~13', '구름많음', '1.0', '2.5'], ['북서~북 / 9~16', '구름많음', '1.5', '4.0'], ['북서~북 / 10~18', '구름많고 한때 비', '2.0', '5.0'],
    ['북서~북 / 10~18', '구름많음', '2.0', '4.5'], ['남서~서 / 9~15', '맑음', '1.5', '3.5'], ['남서~서 / 8~12', '맑음', '1.0', '2.0'], ['남~남서 / 7~11', '맑음', '0.5', '1.5'], ['북~북동 / 5~9', '맑음', '0.5', '1.0']];
const SE = SW.map(([w, s, a, b], i) => [w, i % 2 ? '흐림' : s, a, (+b + 1).toFixed(1)]);   // 남서쪽과 값을 일부러 다르게(섞이면 드러나게)
const ECS = [['남서~서 / 9~13', '구름많음', '1.5', '2.5'], ['서~북서 / 9~13', '구름많음', '1.5', '2.5']];
const text = (labels, n) => [...head(labels), ...zone('제주도남서쪽', '바깥먼바다', SW.slice(0, n)), ...zone('제주도남동쪽', '바깥먼바다', SE.slice(0, n)), '동중국해', ...ECS.flatMap((c) => cell(...c)), '※ 날씨는 풍향, 풍속'].join('\n');
const L05 = ['오전(06~12시)', '오후(12~24시)', '오전(00~12시)', '오후(12~24시)', '오전(00~12시)', '오후(12~24시)', '오전(00~12시)', '오후(12~24시)'];

console.log('A. 05시 발표 — 8칸(오늘 오전~글피 오후)');
{
    const r = parse(text(L05, 8), '202611270500').farSeaZones;
    const w = r['제주도남서쪽바깥먼바다'], e = r['제주도남동쪽바깥먼바다'];
    ok('새 두 구역을 각각 읽는다', !!w && !!e, Object.keys(r));
    ok('남서쪽 8칸', w && w.periods.length === 8, w && w.periods.length);
    ok('남동쪽(표의 마지막 구역) 8칸 — 동중국해 값을 끌어오지 않는다', e && e.periods.length === 8, e && e.periods.map((p) => p.date + p.period + ' ' + p.waveHeight));
    ok('남동쪽 마지막 칸 = 글피 오후 자기 값', e && e.periods[7].date === '20261130' && e.periods[7].period === 'pm' && e.periods[7].waveHeight === '0.5~2.5', e && e.periods[7]);
    ok('두 구역 값이 섞이지 않는다(남서쪽 첫 칸 1.5 · 남동쪽 첫 칸 2.5)', w.periods[0].waveHeight === '0.5~1.5' && e.periods[0].waveHeight === '0.5~2.5' && e.periods[1].weather === '흐림');
    ok('날짜·오전오후: 오늘 오전부터', w.periods[0].date === '20261127' && w.periods[0].period === 'am' && w.periods[1].period === 'pm');
}
console.log('B. 11시 발표 — 7칸(오늘 오후~글피 오후)');
{
    const L11 = L05.slice(1);
    const r = parse(text(L11, 7).replace('05시 00분', '11시 00분'), '202611271100').farSeaZones;
    const e = r['제주도남동쪽바깥먼바다'];
    ok('남동쪽 7칸(종전엔 9칸 — 동중국해 두 칸)', e && e.periods.length === 7, e && e.periods.length);
    ok('첫 칸 = 오늘 오후', e && e.periods[0].date === '20261127' && e.periods[0].period === 'pm');
}
console.log('C. 17시 발표 — 9칸(오늘 오후~그글피 오후) 그대로');
{
    const L17 = ['오후(18~24시)', ...L05.slice(2), '오전(00~12시)', '오후(12~24시)'];
    const r = parse(text(L17, 9).replace('05시 00분', '17시 00분'), '202611271700').farSeaZones;
    const w = r['제주도남서쪽바깥먼바다'], e = r['제주도남동쪽바깥먼바다'];
    ok('두 구역 모두 9칸(그글피 오후까지)', w && e && w.periods.length === 9 && e.periods.length === 9, [w && w.periods.length, e && e.periods.length]);
    ok('마지막 칸 = 그글피 오후 자기 값(북~북동)', e && e.periods[8].date === '20261201' && e.periods[8].period === 'pm' && /북~북동/.test(e.periods[8].wind), e && e.periods[8]);
}
console.log('D. 표 머리를 못 읽으면 종전대로(9칸까지 찾는다)');
{
    const r = parse(text([], 8), '202611270500').farSeaZones;
    ok('머리 없음 → 종전 동작(마지막 구역 9칸)', r['제주도남동쪽바깥먼바다'] && r['제주도남동쪽바깥먼바다'].periods.length === 9, r['제주도남동쪽바깥먼바다'] && r['제주도남동쪽바깥먼바다'].periods.length);
}
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
