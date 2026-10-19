/**
 * 역할: 기상청 해수욕장 날씨(수집기 services/beach_weather_collector.js · 판단·문구 services/beach_weather.js ·
 *       소해구 수온 대체 services/smallzone_forecast.twNear · 정적 표 config/coastal_safety/beach_weather_static.json · 라우트 beach 필드)를 검사한다.
 *       판단 경계값·확정 문구·개장 날짜 경계(5일 전)·몰운대 제외·3km·수온 대체 순서·오래된 값 숨김·발표 시각 스케줄·
 *       메모리(남기는 꼴 크기 상한)·시간 제한(연결 5초·전체 15초 — 짧게 바꿔 잼)·연속 실패 차단·키가 파일에 안 남음.
 *       (설계서 client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md §18)
 * [연계] 외부 API 호출 없음(가짜 요청·임시 폴더). 실측 응답 꼴은 2026-10-18 받아 둔 을왕리 표본(1페이지 300행, totalCount 835)과 같은 필드.
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_beach_weather.js · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib'), assert = require('assert');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');
const C = require('../services/beach_weather_collector');
const W = require('../services/beach_weather');
const S = require('../services/smallzone_forecast');

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.error('❌', name, e && e.message); } }
/** 줄 배열 → 글 배열(2026-10-19 §18.11 부터 줄은 {kind,text,name,concl}). 예: txt([{text:'가'}]) → ['가'] */
const txt = (ls) => ls.map((l) => l.text);
const CONFIG = path.join(__dirname, '..', 'config', 'coastal_safety');
const STATIC = JSON.parse(fs.readFileSync(path.join(CONFIG, 'beach_weather_static.json'), 'utf8'));
const SPOTS = JSON.parse(fs.readFileSync(path.join(CONFIG, 'risk_spots.json'), 'utf8')).spots;
const kst = (s) => Date.parse(s + '+09:00');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beachw-'));
function km(a, b, c, d) { const R = Math.PI / 180, h = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(h)); }

/** 가짜 단기예보 items(실측 응답과 같은 필드). 날짜 date 의 h0~h1 시에 값 v(항목별). */
function items(date, h0, h1, v, base = '202607121400') {
    const out = [], ymd = date.replace(/-/g, '');
    for (let h = h0; h <= h1; h++) for (const [cat, val] of Object.entries(v)) if (cat !== 'TMX') out.push({ beachNum: '1', baseDate: base.slice(0, 8), baseTime: base.slice(8), category: cat, fcstDate: ymd, fcstTime: String(h).padStart(2, '0') + '00', fcstValue: String(val), nx: 49, ny: 124 });
    if (v.TMX !== undefined) out.push({ category: 'TMX', fcstDate: ymd, fcstTime: '1500', fcstValue: String(v.TMX) });
    return out;
}
const CALM = { TMP: 26, SKY: 1, PTY: 0, POP: 10, WAV: 0.5, WSD: 4, TMX: 27 };

(async () => {
    try {
        // ── 정적 표 ────────────────────────────────────────────────────────────
        await check('정적 표: 기상청 420곳 중 몰운대(164) 제외 419곳 · 번호 겹침 없음 · 화면 이름에 「 해수욕장」 띄어쓰기·괄호 없음', () => {
            assert.equal(STATIC.beaches.length, 419);
            assert.ok(!STATIC.beaches.some((b) => b.n === 164 || /몰운대/.test(b.kma)), '몰운대 없음');
            assert.equal(new Set(STATIC.beaches.map((b) => b.n)).size, 419);
            assert.ok(STATIC.beaches.every((b) => !/\s해수욕장|[()]/.test(b.name)), STATIC.beaches.find((b) => /\s해수욕장|[()]/.test(b.name))?.name);
            assert.ok(!Object.values(STATIC.links).some((l) => l.n === 164), '몰운대에 연결된 관광지 없음');
            assert.ok(!Object.keys(STATIC.open).includes('164'));
        });
        await check('정적 표: 관광지 연결은 모두 3km 안(같은 계산으로 다시 잼) · 3km 안에 연결 가능한 해수욕장이 있는 관광지는 빠짐없이 연결', () => {
            const by = new Map(STATIC.beaches.map((b) => [b.n, b]));
            let n = 0;
            for (const [id, l] of Object.entries(STATIC.links)) {
                const s = SPOTS.find((x) => x.id === id), b = by.get(l.n);
                assert.ok(s && b, id);
                const d = km(s.lat, s.lon, b.lat, b.lon);
                assert.ok(d <= 3000.5 && Math.abs(d - l.m) <= 1, id + ' ' + d);
                n++;
            }
            assert.ok(n > 700, '연결 ' + n);
            for (const s of SPOTS) {
                if (STATIC.links[s.id]) continue;
                // 좌표를 못 고친 부정확 해수욕장(flags·coord kma)은 이름이 같을 때만 쓰므로 빼고 잰다
                const near = STATIC.beaches.filter((b) => !(b.flags.length && b.coord === 'kma') && km(s.lat, s.lon, b.lat, b.lon) <= 3000);
                assert.equal(near.length, 0, s.id + ' 3km 안 ' + near.map((b) => b.name).join(','));
            }
        });
        await check('정적 표: 같은 이름 연결(self)은 이름이 실제로 같다(예: 협재) · 해수부 개장 일정은 미개장 없이 기상청 번호에만', () => {
            const s = Object.entries(STATIC.links).find(([id]) => /협재해수욕장/.test(id));
            assert.ok(s && s[1].self === true, '협재 self');
            assert.equal(STATIC.beaches.find((b) => b.n === s[1].n).name, '협재해수욕장');
            const mof = JSON.parse(fs.readFileSync(path.join(CONFIG, 'beach_sources', 'mof_open_2026.json'), 'utf8')).schedule;
            assert.equal(mof.length, 283); assert.equal(mof.filter((r) => r.status === '개장').length, 252);
            for (const [n, o] of Object.entries(STATIC.open)) for (const no of o.mof) { const r = mof.find((x) => x.no === no); assert.equal(r.status, '개장'); assert.ok(String(r.beach_num) === n || (r.beach_num === null && (o.manual || []).includes(no)), n + '/' + no); }
            const hj = STATIC.open[String(s[1].n)];
            assert.deepEqual([hj.open, hj.close], [mof.find((r) => r.name === '협재').open, mof.find((r) => r.name === '협재').close]);
        });

        const REVIEW = fs.readFileSync(path.join(CONFIG, 'beach_links_review.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split('\n').slice(1).map((l) => l.split(','));
        await check('[검토 B②] 해수부 개장인데 기상청 대조가 안 된 줄 — 표기 차이만 있는 두 곳(때뿌루↔떼뿌루·난지섬↔난지도)은 근거 거리 300m 안으로 손으로 잇고, 나머지 19줄은 확인 목록에', () => {
            assert.deepEqual(STATIC.open['15'].manual, [161]); assert.deepEqual(STATIC.open['78'].manual, [259]);
            const hand = REVIEW.filter((r) => r[0].startsWith('해수부 개장 연결(표기 차이'));
            assert.equal(hand.length, 2); assert.ok(hand.every((r) => +r[5] <= 300), JSON.stringify(hand));
            const none = REVIEW.filter((r) => r[0] === '해수부 개장인데 기상청 연결 없음');
            assert.equal(none.length, 19); assert.ok(none.some((r) => /송지호오토캠핑장/.test(r[4])) && !none.some((r) => /때뿌루|난지섬/.test(r[4])));
        });
        await check('[검토 B③] 좌표 맞바뀜(금진↔옥계)은 자기 이름 관광지 좌표로 고침 · 이름 같은 관광지와 1km 넘게 떨어진 나머지는 「좌표 의심」 목록만', () => {
            const sp = (id) => SPOTS.find((x) => x.id === id), b = (n) => STATIC.beaches.find((x) => x.n === n);
            assert.deepEqual([b(185).lat, b(185).lon, b(185).coord], [sp('51150|옥계해변').lat, sp('51150|옥계해변').lon, 'spot:51150|옥계해변']);
            assert.deepEqual([b(186).lat, b(186).lon, b(186).coord], [sp('51150|금진해변').lat, sp('51150|금진해변').lon, 'spot:51150|금진해변']);
            assert.deepEqual(STATIC.links['51150|금진해변'], { n: 186, m: 0, self: true });
            assert.equal(REVIEW.filter((r) => r[0] === '좌표 맞바뀜 고침').length, 2);
            const sus = REVIEW.filter((r) => r[0].startsWith('좌표 의심'));
            assert.equal(sus.length, 15); assert.ok(sus.every((r) => +r[5] > 1000 && +r[5] <= 10000));
            assert.ok(!sus.some((r) => r[1] === '185' || r[1] === '186'), '고친 두 곳은 의심 목록에 없음');
        });
        await check('[검토 B④] 바다 건너 3km 연결은 규칙대로 두고 「시군구 다름」 확인 목록에', () => {
            const x = REVIEW.filter((r) => r[0].startsWith('시군구 다름'));
            assert.ok(x.length > 0);
            for (const r of x) assert.equal(STATIC.links[r[3]].n, +r[1], r[3]);
        });
        await check('[검토 B⑤] 거리 괄호를 빼는 「그 해수욕장 자체」 = 이름이 정말 같고(꼬리 해수욕장·해변·해안 차이만) 500m 안 — 쏠비치 삼척 → 삼척해수욕장은 괄호 있음', () => {
            const k = Object.keys(STATIC.links).find((id) => /쏠비치 삼척/.test(id));
            assert.ok(k, '쏠비치 삼척 관광지'); assert.equal(STATIC.links[k].self, undefined);
            const norm = (x) => x.replace(/\([^)]*\)/g, '').replace(/[\s·.,\-_/]/g, '').replace(/(해수욕장|해변|해안)$/, '');
            for (const [id, l] of Object.entries(STATIC.links)) if (l.self) {
                const b = STATIC.beaches.find((x) => x.n === l.n);
                assert.ok(l.m <= 500 && norm(id.split('|')[1]) === norm(b.kma), id + ' → ' + b.kma + ' ' + l.m);
            }
        });

        // ── 판단 경계값·문구 ─────────────────────────────────────────────────
        await check('판단 경계: 좋음 = 수온 20↑·낮 최고 25↑·비 없음·파고 1m↓·풍속 7m/s↓ (화면 숫자로 반올림해 비교)', () => {
            const g = (o) => W.decide({ tw: 20, tmax: 25, wav: 1, wsd: 7, rain: false, ...o });
            assert.equal(g({}).kind, 'good');
            assert.equal(g({ tw: 19.5 }).kind, 'good', '19.5 → 20℃');
            assert.equal(g({ tw: 19.4 }).kind, 'maybe');
            assert.equal(g({ tmax: 24.4 }).kind, 'maybe');
            assert.equal(g({ wav: 1.04 }).kind, 'good', '1.04 → 1m');
            assert.deepEqual(g({ wav: 1.05 }).bad, ['wave']);
            assert.equal(g({ wsd: 7.4 }).kind, 'good');
            assert.deepEqual(g({ wsd: 7.5 }).bad, ['wind']);
            assert.deepEqual(g({ rain: true, wav: 2, wsd: 9 }).bad, ['wave', 'wind', 'rain']);
            assert.equal(W.decide({ tw: 18, tmax: 23, wav: 3, wsd: 12, rain: true }).kind, 'warn', '18~19℃·23~24℃ 범위도 나쁜 항목이 있으면 경고(2026-10-18 사용자 결정)');
            assert.equal(W.decide({ tw: 18, tmax: 23, wav: 1, wsd: 7, rain: false }).kind, 'maybe');
            assert.equal(W.decide({ tw: 17.4, tmax: 30, wav: 0.5, wsd: 2, rain: false }), null);
            assert.equal(W.decide({ tw: 25, tmax: 22.4, wav: 0.5, wsd: 2, rain: false }), null);
        });
        await check('확정 문구 세 가지(사용자 확정 — 글자 그대로, 숫자만)', () => {
            assert.equal(W.swimText('협재해수욕장(1.2km)', W.decide({ tw: 22, tmax: 27, wav: 0.5, wsd: 3, rain: false })),
                '협재해수욕장(1.2km) — 수온 22℃ · 낮 최고 27℃ · 파도 0.5m로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.');
            assert.equal(W.swimText('협재해수욕장(1.2km)', W.decide({ tw: 22, tmax: 27, wav: 0.04, wsd: 3, rain: false })),
                '협재해수욕장(1.2km) — 수온 22℃ · 낮 최고 27℃ · 파도 거의 없음으로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.', '파도 0m → 「파도 거의 없음」(사용자 2026-10-19)');
            assert.equal(W.swimText('협재해수욕장(1.2km)', W.decide({ tw: 19, tmax: 24, wav: 0.5, wsd: 3, rain: false })),
                '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃로 물놀이하기에 아주 좋은 날씨는 아니지만, 바닷물에 들어가는 사람이 있을 수 있습니다.');
            assert.equal(W.swimText('협재해수욕장(1.2km)', W.decide({ tw: 22, tmax: 27, wav: 1.8, wsd: 3, rain: false })),
                '협재해수욕장(1.2km) — 수온 22℃로 따뜻하지만 파도가 1.8m로 높아 물에 들어가기에 적절하지 않습니다.');
        });
        await check('[사용자 2026-10-18 「경고문구로 넣어야지 파고가 3m인데」] 수온 18~19℃·낮 최고 23~24℃ 에서 나쁜 항목이 있으면 경고 문구(「이나,」 — 사용자 2026-10-19 「좋아」, 종전 「이고」·끝 문장 없음) · 하나씩 · 경계 1.0m·7m/s 는 아님 · 없으면 종전 「있을 수 있음」', () => {
            const t = (o) => W.swimText('협재해수욕장(1.2km)', W.decide({ tw: 19, tmax: 24, wav: 0.5, wsd: 3, rain: false, ...o }));
            assert.equal(t({ wav: 3.5, wsd: 14, rain: true }).replace('3.5m', '3m').replace('14m', '13m'), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃이나, 파도가 3m로 높고 바람이 초속 13m로 강하고 비가 예보되어 물에 들어가기에 적절하지 않습니다.', '사용자 예시 꼴');
            assert.equal(t({ wav: 3.5, wsd: 14, rain: true }), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃이나, 파도가 3.5m로 높고 바람이 초속 14m로 강하고 비가 예보되어 물에 들어가기에 적절하지 않습니다.', '운영 재현 꼴');
            assert.equal(t({ wav: 3 }), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃이나, 파도가 3m로 높아 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ wsd: 13 }), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃이나, 바람이 초속 13m로 강해 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ rain: true }), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃이나, 비가 예보되어 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ wav: 1.0, wsd: 7 }), '협재해수욕장(1.2km) — 수온 19℃ · 낮 최고 24℃로 물놀이하기에 아주 좋은 날씨는 아니지만, 바닷물에 들어가는 사람이 있을 수 있습니다.', '경계(1.0m·7m/s)는 나쁜 항목 아님');
            assert.ok(!/따뜻하지만|그래도/.test(t({ wav: 3 })));
            assert.equal(W.swimText('협재해수욕장', W.decide({ tw: 19, tmax: 24, wav: 3, wsd: 3, rain: false })), '협재해수욕장 — 수온 19℃ · 낮 최고 24℃이나, 파도가 3m로 높아 물에 들어가기에 적절하지 않습니다.', '자체 관광지는 괄호 없음');
        });
        await check('거친 날 나쁜 항목만 바꿔 넣기 · 여럿이면 「-고」로 이음(파도 → 바람 → 비)', () => {
            const t = (o) => W.swimText('A', W.decide({ tw: 22, tmax: 27, wav: 0.5, wsd: 3, rain: false, ...o }));
            assert.equal(t({ wsd: 9 }), 'A — 수온 22℃로 따뜻하지만 바람이 초속 9m로 강해 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ rain: true }), 'A — 수온 22℃로 따뜻하지만 비가 예보되어 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ wav: 1.8, wsd: 9 }), 'A — 수온 22℃로 따뜻하지만 파도가 1.8m로 높고 바람이 초속 9m로 강해 물에 들어가기에 적절하지 않습니다.');
            assert.equal(t({ wav: 2, wsd: 9, rain: true }), 'A — 수온 22℃로 따뜻하지만 파도가 2m로 높고 바람이 초속 9m로 강하고 비가 예보되어 물에 들어가기에 적절하지 않습니다.');
        });
        await check('개장 줄: 5일 전부터 예정(6일 전은 없음) · 당일(오늘 보기) · 당일(내일 보기 = 예정) · 기간 · 폐장일 포함 · 폐장 뒤 없음 · 받침', () => {
            const o = { open: '2026-07-10', close: '2026-08-23' }, N = '협재해수욕장';
            assert.equal(W.openText(N, o, '2026-07-04', '2026-07-04'), null, '6일 전');
            assert.equal(W.openText(N, o, '2026-07-05', '2026-07-05'), '협재해수욕장이 7월 10일 개장 예정이라 개장 후 사람이 많이 몰릴 수 있습니다.');
            assert.equal(W.openText(N, o, '2026-07-10', '2026-07-10'), '협재해수욕장이 오늘 개장해 사람이 많이 몰릴 수 있습니다.');
            assert.equal(W.openText(N, o, '2026-07-10', '2026-07-09'), '협재해수욕장이 7월 10일 개장 예정이라 개장 후 사람이 많이 몰릴 수 있습니다.');
            assert.equal(W.openText(N, o, '2026-07-11', '2026-07-11'), '협재해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.');
            assert.equal(W.openText(N, o, '2026-08-23', '2026-08-23'), '협재해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.');
            assert.equal(W.openText(N, o, '2026-08-24', '2026-08-24'), null);
            assert.equal(W.openText(N, null, '2026-07-11', '2026-07-11'), null, '해수부 일정 없음 → 아무 말 없음');
            assert.ok(W.openText('애견전용해수욕장 멍비치', o, '2026-07-11', '2026-07-11').startsWith('애견전용해수욕장 멍비치가 개장'));
            assert.equal(W.OPEN_SOON_DAYS, 5);
        });

        // ── 발표 시각 스케줄 ───────────────────────────────────────────────────
        await check('발표 시각: 10분 뒤부터 제공 · 정기 수집은 02:15·05:15·…·23:15 여덟 번', () => {
            const at = (s) => C.kstParts(C.issueAt(kst(s))).hm;
            assert.equal(at('2026-10-18T14:09:59'), '1100'); assert.equal(at('2026-10-18T14:10:00'), '1400');
            assert.equal(at('2026-10-18T01:00:00'), '2300'); assert.equal(C.kstParts(C.issueAt(kst('2026-10-18T01:00:00'))).date, '2026-10-17');
            assert.equal(at('2026-10-18T02:10:00'), '0200'); assert.equal(at('2026-10-18T23:59:00'), '2300');
            const mins = [];
            for (let t = kst('2026-10-18T00:00:00'); t < kst('2026-10-19T00:00:00'); t += 60000) if (C.isCollectMinute(t)) mins.push(C.kstParts(t).hm);
            assert.deepEqual(mins, ['0215', '0515', '0815', '1115', '1415', '1715', '2015', '2315']);
            const due = (x) => C.kstParts(C.dueIssue(kst(x))).hm;
            assert.deepEqual([due('2026-10-18T14:14:59'), due('2026-10-18T14:15:00'), due('2026-10-18T16:59:00'), due('2026-10-18T02:14:00')], ['1100', '1400', '1400', '2300']);
        });

        // ── 이틀치 덮어쓰기·창 옮기기 ─────────────────────────────────────────
        await check('창(사흘 72칸 — 검토 A⑤): 새 판은 준 칸만 덮고 지난 칸(앞 판)은 남김 · 결측(+900) → 없음 · 다음 날 창을 하루 옮김', () => {
            assert.equal(C.HOURS, 72);
            const e = C.blank();
            C.merge(e, items('2026-07-12', 0, 23, { TMP: 20, WAV: 0.3 }).concat(items('2026-07-13', 0, 23, { TMP: 21 })), '2026-07-12');
            C.merge(e, items('2026-07-12', 15, 23, { TMP: 25, WAV: 900 }), '2026-07-12');
            const get = (i, c) => { const x = e.v[i * C.CATS.length + C.CATS.indexOf(c)]; return x === C.MISS ? null : x / C.SCALE[c]; };
            assert.equal(get(9, 'TMP'), 20, '지난 칸 앞 판 값'); assert.equal(get(15, 'TMP'), 25, '새 판 칸'); assert.equal(get(15, 'WAV'), null, '900 → 결측'); assert.equal(get(24 + 10, 'TMP'), 21);
            C.merge(e, [{ category: 'TMX', fcstDate: '20260713', fcstTime: '1500', fcstValue: '29.0' }], '2026-07-12');
            C.shift(e, 1);
            assert.equal(get(10, 'TMP'), 21, '어제의 내일 = 오늘'); assert.equal(get(24 + 10, 'TMP'), null); assert.deepEqual(e.tmx, [29, null, null]);
            C.merge(e, items('2026-07-15', 9, 9, { TMP: 30 }), '2026-07-13'); assert.equal(get(48 + 9, 'TMP'), 30, '셋째 날 칸');
            C.shift(e, 2); assert.equal(get(9, 'TMP'), 30, '이틀 옮김'); C.shift(e, 3); assert.equal(get(9, 'TMP'), null, '사흘 이상 → 비움');
        });

        // ── 판단 통합(가짜 수집기·소해구) ───────────────────────────────────────
        const now = kst('2026-07-12T14:20:00');   // 14시 발표(14:10~) 를 받은 뒤
        const col = C.createCollector({ dir: path.join(tmp, 'c1'), clock: () => now, beachNums: [1, 2], alert: async () => ({}) });
        const table = { beaches: [{ n: 1, name: '협재해수욕장', lat: 33.39, lon: 126.24 }, { n: 2, name: '금능해수욕장', lat: 33.39, lon: 126.23 }],
            open: { 1: { open: '2026-07-10', close: '2026-08-23' } }, links: { s1: { n: 1, m: 1230 }, s2: { n: 1, m: 40, self: true }, s3: { n: 2, m: 2000 }, s4: { n: 2, m: 30 } } };
        let smallCalls = [], small = () => null;
        const svc = W.createBeachWeather({ table, collector: col, clock: () => now, smallTw: (lat, lon, date, n) => { smallCalls.push(date); return small(lat, lon, date, n); } });
        col._put(1, '202607121400', '2026-07-12', items('2026-07-12', 0, 23, CALM).concat(items('2026-07-13', 0, 23, { ...CALM, WAV: 1.8, TMX: 28 })));
        col._putTw(1, '202607121300', 22.3);
        await check('줄 순서 = 개장 줄 → 입수 줄 · 거리 한 자리(1.2km) · 같은 이름 관광지는 거리 괄호 없음', () => {
            assert.deepEqual(txt(svc.linesFor('s1', '2026-07-12')), ['협재해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.',
                '협재해수욕장(1.2km) — 수온 22℃ · 낮 최고 27℃ · 파도 0.5m로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.']);
            assert.ok(svc.linesFor('s2', '2026-07-12')[1].text.startsWith('협재해수욕장 — 수온'));
        });
        await check('[§18.11 사용자 2026-10-19 「해당 종류 분류에 따른 색상을 해수욕장 명칭에 반영」] 줄 = {kind, text, name, concl} — 종류 다섯(개장·좋음·있을 수 있음·경고·거친 날) 모두 text 는 이름으로 시작·결론으로 끝남 · 결론 글자 그대로', () => {
            assert.deepEqual(W.CONCL, { open: '사람이 많이 몰릴 수 있습니다.', good: '바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.',
                maybe: '바닷물에 들어가는 사람이 있을 수 있습니다.', warn: '물에 들어가기에 적절하지 않습니다.', rough: '물에 들어가기에 적절하지 않습니다.' }, '사용자 지시의 결론 부분');
            const ls = svc.linesFor('s1', '2026-07-12');
            assert.deepEqual(ls.map((l) => [l.kind, l.name, l.concl]), [['open', '협재해수욕장', W.CONCL.open], ['good', '협재해수욕장', W.CONCL.good]]);
            assert.equal(svc.linesFor('s1', '2026-07-13')[1].kind, 'rough');
            const N = '협재해수욕장', o = { open: '2026-07-10', close: '2026-08-23' };
            const all = [['open', W.openText(N, o, '2026-07-05', '2026-07-05')], ['open', W.openText(N, o, '2026-07-10', '2026-07-10')], ['open', W.openText(N, o, '2026-07-11', '2026-07-11')]];
            for (const x of [{ wav: 0.5 }, { tw: 19, tmax: 24 }, { tw: 19, tmax: 24, wav: 3 }, { wav: 1.8, rain: true }]) { const r = W.decide({ tw: 22, tmax: 27, wav: 0.5, wsd: 3, rain: false, ...x }); all.push([r.kind, W.swimText(N + '(1.2km)', r)]); }
            assert.deepEqual(all.map((a) => a[0]), ['open', 'open', 'open', 'good', 'maybe', 'warn', 'rough']);
            for (const [k, t] of all) { const l = W.line(k, N, t); assert.ok(l.text.startsWith(l.name) && l.text.endsWith(l.concl) && l.name.length + l.concl.length < l.text.length, k + ' ' + t); }
        });
        await check('내일: 내일 낮 예보 + 오늘 수온(사용자 확정 「내일 판단도 오늘 수온값」) · 모레·어제·연결 없는 관광지는 줄 없음', () => {
            assert.equal(svc.linesFor('s1', '2026-07-13')[1].text, '협재해수욕장(1.2km) — 수온 22℃로 따뜻하지만 파도가 1.8m로 높아 물에 들어가기에 적절하지 않습니다.');
            assert.deepEqual(svc.linesFor('s1', '2026-07-14'), []); assert.deepEqual(svc.linesFor('s1', '2026-07-11'), []); assert.deepEqual(svc.linesFor('없음', '2026-07-12'), []);
            assert.deepEqual(svc.linesForSpots(['s1', 's3', '없음'], '2026-07-12'), { s1: svc.linesFor('s1', '2026-07-12') });
        });
        await check('낮 09~18시만 본다(최댓값) — 08시·19시의 높은 파도·비는 판단에 안 들어감', () => {
            col._put(1, '202607121400', '2026-07-12', items('2026-07-12', 8, 8, { WAV: 3, PTY: 1 }).concat(items('2026-07-12', 19, 19, { WAV: 3, POP: 90 })));
            assert.match(svc.linesFor('s1', '2026-07-12')[1].text, /좋은 날씨/);
            col._put(1, '202607121400', '2026-07-12', items('2026-07-12', 18, 18, { POP: 60 }));
            assert.match(svc.linesFor('s1', '2026-07-12')[1].text, /비가 예보되어/, '강수확률 60% 칸 = 비');
            col._put(1, '202607121400', '2026-07-12', items('2026-07-12', 9, 18, { POP: 10 }));
        });
        await check('수온 출처 순서: 부이(12시간 안) → 소해구 예보 수온(오늘 날짜로 물음) → 없으면 입수 줄 없음(개장 줄은 남음)', () => {
            col._putTw(1, '202607120100', 22.3);   // 13시간 전 → 낡음
            small = () => ({ tw: 19.2, zone: '233-5' }); smallCalls = [];
            assert.match(svc.linesFor('s1', '2026-07-13')[1].text, /수온 19℃/, '소해구 값');
            assert.deepEqual(smallCalls, ['2026-07-12'], '내일 보기도 오늘 날짜 소해구 수온');
            assert.equal(svc.waterTemp(1).from, 'smallzone');
            small = () => null;
            assert.deepEqual(txt(svc.linesFor('s1', '2026-07-12')), ['협재해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.']);
            col._putTw(1, '202607121300', 22.3);
            assert.equal(svc.waterTemp(1).from, 'buoy');
        });
        await check('오래된 예보 숨김: 기대 발표(14시)보다 6시간 넘게 옛 판(05시)이면 입수 줄 없음 · 08시 판은 씀', () => {
            col._put(1, '202607120800', '2026-07-12', []);
            assert.equal(svc.linesFor('s1', '2026-07-12').length, 2, '08시 판(2 발표 놓침)은 씀');
            col._put(1, '202607120500', '2026-07-12', []);
            assert.equal(svc.linesFor('s1', '2026-07-12').length, 1, '05시 판 → 입수 줄 없음');
            assert.equal(W.dayWeather(col.forecast(1), '2026-07-12', now), null);
            col._put(1, '202607121400', '2026-07-12', []);
        });
        await check('항목 결측이면 입수 줄 없음(파고 없는 날) · 판단에 쓰는 값만 남김(SKY 는 판단에 안 씀)', () => {
            col._put(2, '202607121400', '2026-07-12', items('2026-07-12', 0, 23, { ...CALM, WAV: -999 }));
            col._putTw(2, '202607121300', 24);
            assert.deepEqual(svc.linesFor('s3', '2026-07-12'), []);
        });

        await check('[검토 B⑥] 오늘은 지금 이후 낮 칸만 — 14:20 이면 10시 높은 파도·비는 빼고, 19시가 되면 오늘 입수 줄 없음(내일 줄은 그대로)', () => {
            const t = { v: kst('2026-07-12T14:20:00') };
            const c = C.createCollector({ dir: path.join(tmp, 'b6'), clock: () => t.v, beachNums: [1], alert: async () => ({}) });
            c._put(1, '202607121400', '2026-07-12', items('2026-07-12', 0, 23, CALM).concat(items('2026-07-12', 10, 10, { WAV: 3, PTY: 1 }), items('2026-07-13', 0, 23, CALM)));
            c._putTw(1, '202607121300', 22);
            const sv = W.createBeachWeather({ table, collector: c, clock: () => t.v, smallTw: () => null });
            assert.match(sv.linesFor('s1', '2026-07-12')[1].text, /좋은 날씨/, '지난 10시 칸은 빼고 봄');
            t.v = kst('2026-07-12T18:40:00'); assert.equal(sv.linesFor('s1', '2026-07-12').length, 2, '18시 칸까지는 오늘');
            t.v = kst('2026-07-12T19:00:00');
            assert.deepEqual(txt(sv.linesFor('s1', '2026-07-12')), ['협재해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.'], '오늘 낮이 지나면 입수 줄 없음');
            assert.equal(sv.linesFor('s1', '2026-07-13').length, 2, '내일 줄은 그대로');
        });
        await check('[검토 A④] 낮 최고: TMX 가 없으면 낮 10칸(09~18시) 기온이 모두 있을 때만 그 최댓값 — 빈 상태에서 늦은 판(17시)만 받으면 오늘 입수 줄 없음', () => {
            const t = { v: kst('2026-07-12T17:20:00') };
            const c = C.createCollector({ dir: path.join(tmp, 'a4'), clock: () => t.v, beachNums: [1], alert: async () => ({}) });
            c._put(1, '202607121700', '2026-07-12', items('2026-07-12', 18, 23, { ...CALM, TMX: undefined, TMP: 24 }));
            c._putTw(1, '202607121700', 22);
            const sv = W.createBeachWeather({ table, collector: c, clock: () => t.v, smallTw: () => null });
            assert.equal(W.dayWeather(c.forecast(1), '2026-07-12', t.v), null);
            assert.equal(sv.linesFor('s1', '2026-07-12').length, 1, '개장 줄만');
            c._put(1, '202607121700', '2026-07-12', items('2026-07-12', 9, 17, { ...CALM, TMX: undefined, TMP: 26 }));
            assert.equal(W.dayWeather(c.forecast(1), '2026-07-12', t.v).tmax, 26, '10칸 다 있으면 최댓값');
        });
        await check('[검토 A⑤] 자정 ~ 02:15(새 날 첫 발표 전) 에도 「내일」 줄 — 23시 판의 셋째 날 칸', () => {
            const t = { v: kst('2026-07-12T23:20:00') };
            const c = C.createCollector({ dir: path.join(tmp, 'a5'), clock: () => t.v, beachNums: [1], alert: async () => ({}) });
            c._put(1, '202607122300', '2026-07-12', items('2026-07-13', 0, 23, CALM).concat(items('2026-07-14', 0, 23, { ...CALM, WAV: 1.8 })));
            c._putTw(1, '202607122200', 22);
            const sv = W.createBeachWeather({ table, collector: c, clock: () => t.v, smallTw: () => null });
            t.v = kst('2026-07-13T00:30:00');
            assert.match(sv.linesFor('s1', '2026-07-13')[1].text, /좋은 날씨/, '오늘(7-13)');
            assert.match(sv.linesFor('s1', '2026-07-14')[1].text, /파도가 1.8m로 높아/, '내일(7-14) — 종전 48칸이면 없음');
        });
        await check('비 판정선 강수확률 60%(사용자 「통상적인 수준」) — 실측 표본(을왕리 2026-10-18 11시 판 25시간): POP 60 이상 칸은 모두 PTY≥1, 30 이하 칸은 모두 PTY 0', () => {
            const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'beach_weather', 'vilage_sample_pop_pty.json'), 'utf8'));
            assert.equal(W.RAIN_POP, 60);
            for (const [pop, pty] of v.pairs) assert.equal(pty > 0, pop >= W.RAIN_POP, pop + '/' + pty);
        });

        // ── 소해구 수온(twNear) ─────────────────────────────────────────────────
        await check('소해구 예보 수온: 낮(UTC 00·03·06·09) 최댓값만 날짜별로 남김(경고를 더 내는 쪽) · 위치가 든 칸 → 20km 안 가장 가까운 칸 · 판 48시간 넘으면 없음 · 기존 행에는 TW 없음 · [검토 A③] 12UTC 판이 와도 오늘 값 이어받음', async () => {
            const sd = path.join(tmp, 'sz'); fs.mkdirSync(sd);
            const HEAD = '#START7777\n#   TMA_FC     TMA_EF LZONE SZONE   LAT_LB    LON_LB    LAT_LT    LON_LT    LAT_RT    LON_RT    LAT_RB    LON_RB       WH_SIG     WVPRD_MAX          WVDR            WS            WD            VS          RAIN            TW         SWELL\n';
            const cells = { 1: [33.333, 126.167, -999], 2: [33.333, 126.333, 0], 3: [33.5, 126.5, 0] };   // 칸 1 = 육지(-999) · 2·3 = 바다
            const fetchImpl = async (u) => { const q = Object.fromEntries(new URL(u).searchParams); let t = HEAD; for (const [s, [la, lo, base]] of Object.entries(cells)) { const tw = base === -999 ? -999 : 20 + (+q.tma_ef.slice(8)) / 10 + +s; t += `${q.tma_fc} ${q.tma_ef}   233 ${s} ${la} ${lo} ${la + 1 / 6} ${lo} ${la + 1 / 6} ${lo + 1 / 6} ${la} ${lo + 1 / 6} 1.0 5.0 90 5 90 -999 0 ${tw} -999\n`; } return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(t + '#7777END\n') }; };
            S._reset(); S.configure({ fetchImpl, getKey: () => 'K', dataDir: sd, wait: async () => { } });
            await S.prefetch(['233'], '2026071200');
            const b = S.peek('233');
            assert.deepEqual(Object.keys(b.data['2'][0]), ['tm', 'wh', 'wp', 'waveDir', 'ws', 'windDir'], '행에 TW 없음');
            const t0 = Date.UTC(2026, 6, 12, 6);
            const r = S.twNear(33.42, 126.42, '2026-07-12', t0);   // 칸 2 가운데(33.4165,126.4165) 안
            assert.equal(r.zone, '233-2'); assert.equal(r.tw, 22.9, '낮 최댓값 = 09UTC 값 20+0.9+2');
            const land = S.twNear(33.41, 126.25, '2026-07-12', t0);   // 칸 1(육지) 안 → 옆 바다 칸
            assert.equal(land.zone, '233-2');
            assert.equal(S.twNear(34.5, 128.5, '2026-07-12', t0), null, '20km 밖');
            assert.equal(S.twNear(33.42, 126.42, '2026-07-12', Date.UTC(2026, 6, 14, 1)), null, '판 49시간 → 없음');
            const disk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(sd, 'smallzone_forecast.json.gz'))).toString());
            assert.ok(Array.isArray(disk.tw) && disk.tw.length === 2, '육지 칸은 tw 표에 없음');
            assert.ok(JSON.stringify(disk.tw).length < 400, '소해구 수온은 날짜별 숫자 하나씩만 ' + JSON.stringify(disk.tw).length);
            // 12UTC 판(21시 KST): 발효 시각이 그날 12UTC 부터라 오늘 낮 칸이 없다 → 직전 판의 오늘 값을 이어받는다
            await S.prefetch(['233'], '2026071212');
            const late = Date.UTC(2026, 6, 12, 14);   // 23시 KST
            assert.equal(S.getStatus().baseTm, '2026071212');
            assert.equal(S.twNear(33.42, 126.42, '2026-07-12', late).tw, 22.9, '오늘 값 이어받음');
            assert.ok(S.twNear(33.42, 126.42, '2026-07-13', late), '내일 값은 새 판');
            assert.deepEqual(S.twCarry([{ z: 'a', lat: 1, lon: 2, d: { '2026-07-11': 1, '2026-07-12': 2 } }], [{ z: 'a', lat: 1, lon: 2, d: { '2026-07-13': 3 } }], '2026-07-12'), [{ z: 'a', lat: 1, lon: 2, d: { '2026-07-13': 3, '2026-07-12': 2 } }], '지난 날짜는 버림');
            S._reset();
        });

        // ── 수집 회차(가짜 요청) ────────────────────────────────────────────────
        const KEY = 'SECRET_KEY_zz9';
        const body = (its, total) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { dataType: 'JSON', items: { item: its }, pageNo: 1, numOfRows: 1000, totalCount: total == null ? its.length : total } } });
        await check('수집 회차: 419곳 한 곳씩(요청 주소 = base_date·base_time·beach_num) · 성공하면 파일 · 수온은 가장 최근 관측 · 키는 파일에 없음', async () => {
            const urls = [], d = path.join(tmp, 'c2'), alerts = [];
            const nums = STATIC.beaches.map((b) => b.n);
            const c = C.createCollector({ dir: d, clock: () => now, beachNums: nums, getKey: () => KEY, gapMs: 0, alert: async (id, o) => alerts.push([id, o.ok]),
                fetchText: async (u) => { urls.push(u); const q = new URL(u).searchParams; if (u.includes('getTwBuoyBeach')) return body([{ beachNum: q.get('beach_num'), tm: '202607121300', tw: '23.1' }, { beachNum: q.get('beach_num'), tm: '202607121200', tw: '22.0' }]); return body(items('2026-07-12', 0, 23, CALM)); } });
            const r = await c.collect();
            assert.equal(r.forecast.ok, 419); assert.equal(r.tw.ok, 419); assert.equal(urls.length, 838);
            const q = new URL(urls[0]).searchParams;
            assert.deepEqual([q.get('base_date'), q.get('base_time'), q.get('beach_num'), q.get('dataType'), q.get('numOfRows')], ['20260712', '1400', String(nums[0]), 'JSON', '1000']);
            assert.ok(urls[0].startsWith(C.BASE_URL + '/getVilageFcstBeach?'));
            assert.equal(new URL(urls[419]).searchParams.get('searchTime'), '202607121400');
            assert.deepEqual(c.waterTemp(nums[0]), { tm: '202607121300', tw: 23.1 });
            assert.deepEqual(alerts, [['beachForecast', true], ['beachWaterTemp', true]]);
            for (const f of fs.readdirSync(d)) assert.ok(!fs.readFileSync(path.join(d, f), 'utf8').includes(KEY), f + ' 키 없음');
            const c2 = C.createCollector({ dir: d, clock: () => now, beachNums: nums });   // 재시작
            assert.equal(c2.forecast(nums[0]).at(10, 'WAV'), 0.5); assert.equal(c2.forecast(nums[0]).tmx[0], 27); assert.equal(c2.meta().status.issue, '202607121400');
        });
        await check('연속 실패 차단: 5번 연속 실패면 그 단계 멈춤(419곳 다 묻지 않음) · 이전 값 유지 · 실패 기록 · 30분 뒤 같은 발표 다시', async () => {
            const d = path.join(tmp, 'c3'), alerts = []; let calls = 0, t = now;
            const c = C.createCollector({ dir: d, clock: () => t, beachNums: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], getKey: () => KEY, gapMs: 0, alert: async (id, o) => alerts.push([id, o.ok, o.error && o.error.message]),
                fetchText: async () => { calls++; throw new Error('연결 시간 초과'); } });
            c._put(1, '202607121100', '2026-07-12', items('2026-07-12', 9, 18, CALM));
            const r = await c.collect();
            assert.equal(calls, 2 * C.BREAK_AFTER, '예보 5 + 수온 5');
            assert.equal(r.forecast.broken, true); assert.equal(r.ok, false);
            assert.deepEqual(alerts, [['beachForecast', false, '연결 시간 초과'], ['beachWaterTemp', false, '연결 시간 초과']]);
            assert.equal(c.forecast(1).base, '202607121100', '이전 값 유지');
            t = now + 29 * 60000; assert.equal(c.tick(), null);
            t = now + 30 * 60000; const p = c.tick(); assert.ok(p, '30분 뒤 다시'); await p;
            t = kst('2026-07-12T17:15:00'); assert.ok(c.tick(), '다음 정기 시각');
        });
        await check('[검토 A①] 띄엄띄엄 실패(4곳 중 3곳 — 연속 3번)도 실패율 10% 초과면 회차 실패·실패 보고 · 5% 는 정상 · 회차 요약 줄(status.json message)', async () => {
            const run = async (bad) => { const d = fs.mkdtempSync(path.join(tmp, 'a1-')), alerts = [];
                const c = C.createCollector({ dir: d, clock: () => now, beachNums: Array.from({ length: 40 }, (_, i) => i + 1), getKey: () => KEY, gapMs: 0, alert: async (id, o) => alerts.push([id, o.ok]),
                    fetchText: async (u) => { const n = +new URL(u).searchParams.get('beach_num'); if (bad(n)) throw new Error('HTTP 500'); return u.includes('getTwBuoyBeach') ? body([{ tm: '202607121300', tw: '22' }]) : body(items('2026-07-12', 9, 18, CALM)); } });
                const origW = console.warn; console.warn = () => { }; const r = await c.collect(); console.warn = origW;
                return { r, alerts, st: JSON.parse(fs.readFileSync(path.join(d, 'status.json'), 'utf8')) }; };
            const a = await run((n) => n % 4 !== 0);
            assert.equal(a.r.forecast.broken, false); assert.equal(a.r.ok, false); assert.deepEqual(a.alerts, [['beachForecast', false], ['beachWaterTemp', false]]);
            assert.match(a.st.message, /예보 성공 10·실패 30\(75%\)/); assert.match(a.st.message, /실패\(10% 초과/);
            const b = await run((n) => n === 7 || n === 8);   // 2/40 = 5%
            assert.equal(b.r.ok, true); assert.deepEqual(b.alerts, [['beachForecast', true], ['beachWaterTemp', true]]);
        });
        await check('[검토 A②] 재시도는 이번 판을 이미 받은 곳을 건너뛰고, 수온은 수온 단계가 실패했을 때만 — 실패 곳만 다시 묻는다', async () => {
            let t = now, bad = (n) => n > 30, urls = [];
            const c = C.createCollector({ dir: path.join(tmp, 'a2'), clock: () => t, beachNums: Array.from({ length: 40 }, (_, i) => i + 1), getKey: () => KEY, gapMs: 0, alert: async () => ({}),
                fetchText: async (u) => { urls.push(u); const n = +new URL(u).searchParams.get('beach_num'); if (!u.includes('getTwBuoyBeach') && bad(n)) throw new Error('HTTP 500'); return u.includes('getTwBuoyBeach') ? body([{ tm: '202607121300', tw: '22' }]) : body(items('2026-07-12', 9, 18, CALM)); } });
            const origW = console.warn; console.warn = () => { };
            await c.collect(); console.warn = origW;   // 예보 30 성공·10 실패(25%) → 실패, 수온 40 성공
            assert.equal(c.meta().status.ok, false); assert.equal(c.meta().status.twOk, true);
            urls = []; bad = () => false; t = now + 30 * 60000;
            const r = await c.tick();
            assert.equal(urls.length, 10, '실패한 예보 10곳만 다시(수온 다시 안 물음)');
            assert.ok(urls.every((u) => u.includes('getVilageFcstBeach') && +new URL(u).searchParams.get('beach_num') > 30));
            assert.equal(r.ok, true); assert.equal(r.forecast.skip, 30); assert.equal(r.tw.skipped, true);
        });
        await check('[검토 A⑥·⑦] 기동 직후(14:12 — 14시 판 제공 뒤)에 받으면 14:15 정기 점검은 같은 판을 다시 안 받음 · 점검이 17:15 를 놓쳐도 17:16 에 따라잡음 · 회차 중 점검은 겹치지 않음', async () => {
            let t = kst('2026-07-12T14:12:00'), n = 0;
            const c = C.createCollector({ dir: path.join(tmp, 'a6'), clock: () => t, beachNums: [1], getKey: () => KEY, gapMs: 0, alert: async () => ({}),
                fetchText: async (u) => { n++; return u.includes('getTwBuoyBeach') ? body([{ tm: '202607121400', tw: '22' }]) : body(items('2026-07-12', 9, 18, CALM)); } });
            const p0 = c.tick(); assert.ok(p0, '기동 — 받은 기록 없음'); assert.strictEqual(c.tick(), p0, '회차 중 다시 불러도 같은 회차'); await p0;
            assert.equal(c.meta().status.issue, '202607121400');
            const n0 = n; t = kst('2026-07-12T14:15:00'); assert.equal(c.tick(), null, '14:15 — 같은 판 다시 안 받음'); assert.equal(n, n0);
            t = kst('2026-07-12T17:14:00'); assert.equal(c.tick(), null, '17:14 — 17시 판은 15분 뒤부터');
            t = kst('2026-07-12T17:16:30'); const p1 = c.tick(); assert.ok(p1, '17:15 를 놓쳐도 17:16 에 받음'); await p1;
            assert.equal(c.meta().status.issue, '202607121700');
            const n1 = n; t = kst('2026-07-12T17:47:00'); assert.equal(c.tick(), null); assert.equal(n, n1, '같은 판 다시 안 받음');
        });
        await check('수온 지금 정시가 자료 없음(03)이면 1시간 앞 정시로 한 번 더(호출 2회) — 그것도 없으면 자료 없음', async () => {
            const q = [];
            const c = C.createCollector({ dir: path.join(tmp, 'tw03'), clock: () => now, beachNums: [1, 2], getKey: () => KEY, gapMs: 0, alert: async () => ({}),
                fetchText: async (u) => { const sp = new URL(u).searchParams; if (!u.includes('getTwBuoyBeach')) return body(items('2026-07-12', 9, 18, CALM));
                    q.push(sp.get('beach_num') + '@' + sp.get('searchTime')); if (sp.get('searchTime') === '202607121400' || sp.get('beach_num') === '2') return JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } });
                    return body([{ tm: '202607121300', tw: '21.5' }]); } });
            const r = await c.collect();
            assert.deepEqual(q, ['1@202607121400', '1@202607121300', '2@202607121400', '2@202607121300']);
            assert.deepEqual(c.waterTemp(1), { tm: '202607121300', tw: 21.5 }); assert.equal(r.tw.nodata, 1);
        });
        await check('자료 없음(resultCode 03)·키 오류(XML)는 고정 분류로 · 오류 글에 주소·키 없음', () => {
            assert.equal(C.parseBody(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } })), null);
            assert.throws(() => C.parseBody('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'), /^Error: API 오류 코드 30$/);
            assert.throws(() => C.parseBody('<html>'), /응답 해석 실패/);
        });

        // ── 시간 제한 ────────────────────────────────────────────────────────────
        await check('시간 제한: 기본 연결 5초·전체 15초 · 연결 안 됨 → 「연결 시간 초과」 · 연결 뒤 응답 없음 → 「전체 시간 초과」 · HTTP 500', async () => {
            assert.deepEqual(C.TIMEOUTS, { connectMs: 5000, totalMs: 15000 });
            const save = { ...C.TIMEOUTS };
            C.TIMEOUTS.connectMs = 60; C.TIMEOUTS.totalMs = 200;
            try {
                // 연결이 끝나지 않는 가짜 소켓
                const lib = { get: () => { const req = new EventEmitter(); req.destroy = (e) => setImmediate(() => req.emit('error', e)); setImmediate(() => { const s = new EventEmitter(); s.connecting = true; req.emit('socket', s); }); return req; } };
                let t0 = Date.now();
                await assert.rejects(C.httpGet('https://x.invalid/', { lib }), /^Error: 연결 시간 초과$/);
                assert.ok(Date.now() - t0 < 180, '연결 기한에 끊김 ' + (Date.now() - t0));
                const srv = http.createServer((q, s) => { if (q.url === '/500') { s.statusCode = 500; s.end('x'); } /* 그 밖은 응답하지 않음 */ });
                await new Promise((r) => srv.listen(0, '127.0.0.1', r));
                const base = 'http://127.0.0.1:' + srv.address().port;
                t0 = Date.now();
                await assert.rejects(C.httpGet(base + '/hang'), /^Error: 전체 시간 초과$/);
                assert.ok(Date.now() - t0 >= 190 && Date.now() - t0 < 600, '전체 기한 ' + (Date.now() - t0));
                await assert.rejects(C.httpGet(base + '/500'), /^Error: HTTP 500$/);
                srv.closeAllConnections && srv.closeAllConnections(); srv.close();
            } finally { Object.assign(C.TIMEOUTS, save); }
        });

        // ── 메모리 ───────────────────────────────────────────────────────────────
        await check('메모리: 419곳 × 72시간 × 6항목을 다 채워도 heap+ArrayBuffer(Int16Array 칸은 heap 밖) 증가 1.5MB 아래(원본 응답을 쌓지 않음)', () => {
            const d = path.join(tmp, 'mem');
            const out = execFileSync(process.execPath, ['--expose-gc', '-e', `
                const C=require(${JSON.stringify(path.join(__dirname, '..', 'services', 'beach_weather_collector.js'))});
                const its=[];for(const day of ['20260712','20260713','20260714'])for(let h=0;h<24;h++)for(const c of C.CATS)its.push({category:c,fcstDate:day,fcstTime:String(h).padStart(2,'0')+'00',fcstValue:'12.3'});
                const col=C.createCollector({dir:${JSON.stringify(d)},clock:()=>${now},beachNums:[]});col.meta();
                global.gc();global.gc();const m0=process.memoryUsage(),h0=m0.heapUsed+m0.arrayBuffers;
                for(let n=1;n<=419;n++)col._put(n,'202607121400','2026-07-12',its);
                its.length=0;global.gc();global.gc();const m1=process.memoryUsage(),h1=m1.heapUsed+m1.arrayBuffers;
                console.log(JSON.stringify({delta:h1-h0}));`]).toString();
            const { delta } = JSON.parse(out.trim().split('\n').pop());
            console.log('   heap+ArrayBuffer 증가(419곳 가득) = ' + (delta / 1048576).toFixed(2) + 'MB');
            assert.ok(delta < 1.5 * 1048576, 'heap ' + delta);
        });
        await check('보관 파일 크기: 419곳 가득 찬 예보 파일 < 1MB(실측 원본 1곳 835항목 ≈ 45KB/300행 — 원본이면 수십 MB)', async () => {
            const d = path.join(tmp, 'size'), nums = STATIC.beaches.map((b) => b.n);
            const full = []; for (const day of ['2026-07-12', '2026-07-13', '2026-07-14']) full.push(...items(day, 0, 23, { ...CALM, REH: 80, UUU: 1, VVV: 2, VEC: 180, PCP: '강수없음', SNO: '적설없음' }));
            const c = C.createCollector({ dir: d, clock: () => now, beachNums: nums, getKey: () => KEY, gapMs: 0, alert: async () => ({}), fetchText: async (u) => u.includes('getTwBuoyBeach') ? body([]) : body(full) });
            await c.collect();
            const size = fs.statSync(path.join(d, 'forecast.json')).size;
            console.log('   forecast.json = ' + (size / 1024).toFixed(0) + 'KB');
            assert.ok(size < 1048576, size);
        });

        // ── 라우트 ───────────────────────────────────────────────────────────────
        await check('라우트: 연안 상세 beach = 그 날짜 줄 · 안내 함수가 실패해도 상세는 그대로(beach 빈 배열)', async () => {
            const express = require('express');
            const { createRouter } = require('../routes/risk_forecast');
            const store = { sources: () => ({}), coastDayDetail: (id, t) => ({ title: id, daily: { date: '2026-07-12' } }) };
            let fn = (id, date) => [id + '|' + date];
            const app = express(); app.use(createRouter({ store, marine: {}, trafficHistory: {}, beach: (id, date) => fn(id, date) }));
            const srv = app.listen(0); const u = 'http://127.0.0.1:' + srv.address().port + '/api/risk-forecast/coast/spot?id=a&t=x';
            try {
                assert.deepEqual((await (await fetch(u)).json()).beach, ['a|2026-07-12']);
                fn = () => { throw new Error('boom'); };
                const origErr = console.error; console.error = () => { };
                const j = await (await fetch(u)).json(); console.error = origErr;
                assert.equal(j.ok, true); assert.deepEqual(j.beach, []);
            } finally { srv.close(); }
        });
        await check('라우트: 브리핑 beach = 연안 카드 관광지만(브리핑 날짜) · 저장된 판은 고치지 않음', async () => {
            const express = require('express');
            const { createRouter } = require('../routes/station_briefing');
            const b = { land: { cards: [{ link: { spotId: 's1' } }, { link: { spotId: 's2' } }, {}] } };
            const fake = { readConfig: () => ({ exposure: 'user' }), stations: () => [{ key: 'K' }], pick: () => ({ date: '2026-07-13', briefing: b }) };
            let got = null;
            const app = express(); app.use(createRouter({ service: fake, isAdminDevice: () => true, verifyToken: () => true, beachLines: (ids, date) => { got = [ids, date]; return { s1: ['줄'] }; } }));
            const srv = app.listen(0);
            try {
                const j = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/station-briefing?station=K')).json();
                assert.deepEqual(got, [['s1', 's2'], '2026-07-13']); assert.deepEqual(j.beach, { s1: ['줄'] });
                assert.equal('beach' in b, false); assert.equal(JSON.stringify(b).includes('줄'), false);
            } finally { srv.close(); }
        });

        // ── 관리자 수집현황·수집 실패 기록 ────────────────────────────────────────
        await check('관리자: 데이터 수집현황 목록에 단기예보·수온 두 줄(02:15~23:15 여덟 번) · 회차 요약 줄(statusFile) · 수집 실패 푸시(사용자 「푸시보내」) · statusFile 만 있는 항목도 실패 기록이면 빨강', async () => {
            const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'data_collection_manifest.json'), 'utf8')).items;
            const f = m.find((i) => i.id === 'beachForecast'), t = m.find((i) => i.id === 'beachWaterTemp');
            assert.deepEqual(f.schedule.times, ['02:15', '05:15', '08:15', '11:15', '14:15', '17:15', '20:15', '23:15']);
            assert.equal(f.state.file, 'beach_weather/forecast.json'); assert.equal(t.state.file, 'beach_weather/watertemp.json');
            assert.equal(f.state.statusFile, 'beach_weather/status.json'); assert.equal(t.state.statusFile, 'beach_weather/status.json');
            const A = require('../services/collect_fail_alert');
            assert.ok(A.ITEMS.beachForecast.push !== false && A.ITEMS.beachWaterTemp.push !== false, '푸시 보냄');
            const dd = path.join(tmp, 'dcs'); fs.mkdirSync(path.join(dd, 'beach_weather'), { recursive: true });
            fs.writeFileSync(path.join(dd, 'beach_weather', 'forecast.json'), JSON.stringify({ fmt: 2, collectedAt: '2026-07-12T14:16:00+09:00', issueAt: '2026-07-12T14:00:00+09:00' }));
            fs.writeFileSync(path.join(dd, 'beach_weather', 'status.json'), JSON.stringify({ message: '발표 14시 · 예보 성공 10·실패 30(75%) — 실패' }));
            const DS = require('../services/data_collection_status').createStatus({ dataDir: dd, clock: () => kst('2026-07-12T14:30:00'), riskCurrent: () => [], schedulerStatus: () => null,
                collectFails: () => ({ beachForecast: { streak: 1, since: '2026-07-12T05:16:00.000Z', reason: 'HTTP 500' } }) });
            const it = (await DS.list()).items.find((i) => i.id === 'beachForecast');
            assert.equal(it.status, 'error'); assert.ok(/예보 성공 10·실패 30/.test(it.detail) && /마지막 수집 실패: HTTP 500/.test(it.detail), it.detail);
        });
    } catch (e) {
        fail++; console.error('❌ 실행 실패', e && e.stack);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
        setTimeout(() => process.exit(process.exitCode), 50).unref();
    }
})();
