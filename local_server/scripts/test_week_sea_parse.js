/**
 * 주간예보 PDF 「4.해상날씨」 → 중기 해상예보 꼴 — 제주도해상 줄을 제 날짜 열쇠로 읽는지 검사.
 * 실행: node local_server/scripts/test_week_sea_parse.js
 * 왜: 중기 해상예보 API 권역에 「제주도해상」이 없어 앱이 제주 해역 카드에 남해서부 값을 「제주도해상」 이름으로
 *   보여 주고 있었다(2026-11-27, 사용자 「중기예보부분도 수정해줘. 제주도해상으로 나오도록」).
 *   서버가 제주청 주간예보 PDF 의 「제주도 해상」 줄을 읽어 'JEJU' 로 넣는다.
 *   글 꼴은 pdf-parse 출력 그대로다(칸 사이 구분자 없음) — 실제 PDF 3개(26일 06·18시, 25일 18시)로 확인했고,
 *   같은 PDF 의 「남해서부」 줄을 읽은 값이 운영 API 12B10000 값과 열쇠·값 모두 같았다.
 * [연계] local_server/regional_forecast_collector.js parseWeekSeaTable(_parseWeekSeaTable) ·
 *        client/js/forecast/outlook/forecast.js ZONE_NAME_TO_MID_TERM_REG_ID
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { _parseWeekSeaTable: parse } = require('../regional_forecast_collector');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

const TAIL = '※ 육상날씨의 괄호 안은 강수가능성(조금 30%, 보통 60%, 높음 80%)';
// 2026-11-26 18시 발표 실제 글(제주도·남해서부 두 줄만)
const T18 = '4.해상날씨\n구역\n01일(화)02일(수)03일(목)\n04일(금)05일(토)06일(일)\n오전오후오전오후오전오후\n'
    + '제주도\n해상\n날씨맑음맑음맑음구름많음구름많음구름많음구름많음흐림흐림\n파고(m)1~1.50.5~10.5~10.5~10.50.50.5~20.5~2.51~3\n'
    + '남해서부\n해상\n날씨맑음맑음맑음맑음구름많음맑음구름많음흐림흐림\n파고(m)0~1.50~10~0.50~0.50~0.50~0.50~20~20~2\n' + TAIL;
// 2026-11-26 06시 발표 실제 글(4일치 오전·오후)
const T06 = '4.해상날씨\n구역\n30일(월)01일(화)02일(수)03일(목)\n04일(금)05일(토)06일(일)\n오전오후오전오후오전오후오전오후\n'
    + '제주도\n해상\n날씨맑음맑음맑음맑음구름많음구름많음구름많음구름많음맑음맑음구름많음\n파고(m)1~21~21~21~21~21~21~21~21~21~21~2\n' + TAIL;

console.log('A. 18시 발표 — 5~7일 오전·오후 + 8~10일');
{
    const r = parse(T18, '제주도', '202611261800');
    ok('읽힌다', !!r, r);
    ok('12월 1일(+5) 오전 = 맑음 1~1.5', r && r.wf5Am === '맑음' && r.wh5AAm === 1 && r.wh5BAm === 1.5, r);
    ok('7일 오전 한 값 0.5 → 최소·최대 같게', r && r.wh7AAm === 0.5 && r.wh7BAm === 0.5);
    ok('10일(12월 6일) = 흐림 1~3', r && r.wf10 === '흐림' && r.wh10A === 1 && r.wh10B === 3);
    ok('4일 열쇠는 없다(18시는 5일부터)', r && r.wf4Am === undefined);
    const nw = parse(T18, '남해서부', '202611261800');
    // 운영 /api/mid-term-sea-forecasts 12B10000 (tmFc 202611261800) 값 그대로
    const API = { wf5Am: '맑음', wf5Pm: '맑음', wf6Am: '맑음', wf6Pm: '맑음', wf7Am: '구름많음', wf7Pm: '맑음', wf8: '구름많음', wf9: '흐림', wf10: '흐림', wh5AAm: 0, wh5APm: 0, wh5BAm: 1.5, wh5BPm: 1, wh6AAm: 0, wh6APm: 0, wh6BAm: 0.5, wh6BPm: 0.5, wh7AAm: 0, wh7APm: 0, wh7BAm: 0.5, wh7BPm: 0.5, wh8A: 0, wh8B: 2, wh9A: 0, wh9B: 2, wh10A: 0, wh10B: 2 };
    ok('같은 PDF 남해서부 줄 = API 12B10000 값(열쇠·값 모두)', nw && Object.keys(API).every((k) => nw[k] === API[k]), nw);
    ok('제주도 값과 남해서부 값이 다르다(섞이지 않음)', r && nw && r.wh10B === 3 && nw.wh10B === 2);
}
console.log('B. 06시 발표 — 4~7일 오전·오후 + 8~10일 (11칸)');
{
    const r = parse(T06, '제주도', '202611260600');
    ok('11월 30일(+4) 오전 = 맑음 1~2', r && r.wf4Am === '맑음' && r.wh4AAm === 1 && r.wh4BAm === 2, r);
    ok('7일 오후 = 구름많음', r && r.wf7Pm === '구름많음');
    ok('8일 = 맑음 · 10일 = 구름많음', r && r.wf8 === '맑음' && r.wf10 === '구름많음');
}
console.log('C. 앞 발표분으로 대신할 때 — 기준 발표시각으로 날 수를 다시 센다');
{
    // 25일 18시 판(30일~3일 오전·오후 … 처럼 머리글이 하루 앞)을 26일 18시 기준으로
    const T = T06.replace('오전오후오전오후오전오후오전오후', '오전오후오전오후오전오후').replace(/파고\(m\)(1~2){11}/, '파고(m)' + '1~2'.repeat(10)).replace(/날씨(맑음|구름많음)+/, '날씨맑음맑음맑음맑음구름많음구름많음구름많음맑음맑음구름많음');
    const r = parse(T, '제주도', '202611261800');
    ok('30일 = +4 오전·오후', r && r.wf4Am === '맑음' && r.wf4Pm === '맑음', r);
    ok('한 칸짜리 3일(+7)은 오전·오후 열쇠 둘 다에(앱이 4~7일을 그 열쇠로 읽는다)', r && r.wf7Am === '구름많음' && r.wf7Pm === '구름많음' && r.wh7AAm === 1 && r.wf7 === undefined, r);
}
console.log('D. 이상한 글은 버린다(틀린 칸에 값을 넣지 않는다)');
{
    ok('파고 칸 수가 머리글과 다르면 null', parse(T18.replace('1~3\n', '\n'), '제주도', '202611261800') === null);
    ok('줄이 없으면 null', parse(T18, '서해남부', '202611261800') === null);
    ok('해상날씨 표가 없으면 null', parse('단기예보', '제주도', '202611261800') === null);
    const r = parse(T18.replace('날씨맑음맑음맑음구름많음', '날씨맑음맑음뭔가구름많음'), '제주도', '202611261800');
    ok('날씨 칸만 어긋나면 파고는 살리고 날씨는 「-」', r && r.wf5Am === '-' && r.wh10B === 3, r);
}
console.log('E. 앱 매핑 — 제주 해역은 전부 JEJU(제주도해상), 남해서부 코드로 가지 않는다');
{
    const src = fs.readFileSync(path.join(__dirname, '../../client/js/forecast/outlook/forecast.js'), 'utf8');
    const block = src.slice(src.indexOf('const ZONE_NAME_TO_MID_TERM_REG_ID'), src.indexOf('};', src.indexOf('const ZONE_NAME_TO_MID_TERM_REG_ID')));
    const pairs = [...block.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
    const jeju = pairs.filter(([k]) => k.startsWith('제주도'));
    ok('제주 이름 11개', jeju.length === 11, jeju.map((p) => p[0]));
    ok('전부 JEJU', jeju.every(([, v]) => v === 'JEJU'), jeju);
    ok('새 두 구역 포함', ['제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다'].every((z) => jeju.some(([k]) => k === z)));
    ok('표시명 JEJU → 제주도해상', /'JEJU':\s*'제주도해상'/.test(src));
}
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
