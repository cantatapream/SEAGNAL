/**
 * test_tide_edges.js — 간출암 조석 상자(해양안전 위험지형 팝업·연안 브리핑 바위 상자)의 네 가지 결함이 다시 생기지 않게 고정한다.
 *
 * [왜 있나 — 2026-10-18 사용자 화면 + 독립 검토 3명 + 실데이터 재현]
 *   A. 고조·저조 목록이 하루 20~26개 — 평탄 구간을 모르는 극값 찾기가 1cm 계단마다 고조/저조를 번갈아 만들었다
 *      (운영 id=410 오늘 26개, 하루 끝 「저조 23:20 / 고조 23:30 / 저조 23:40」 같은 꼴).
 *   B. 새벽 앞쪽 빈칸 — TideBED slctdDt = obsrvnDt + 조시차(한림 +66분)라 그날 00:00~01:05 가 늘 비었다.
 *   C. 제주 「모레」 빈칸 — 제주 두 수집기는 23:30 에만 돌고 서버 기동 때 부족분을 채우지 않았다.
 *   D. 바텀시트 조석 요청에 시간 제한이 없어 연결이 안 되면 약 134초 기다렸고, 네트워크 오류 때 다른 키로 다시 묻지 않았다.
 *
 * [무엇을] 화면 없이 확인할 수 있는 것 — 극값 규칙(실데이터 고정값 포함)·가장자리 메우기·수집기의 API 호출 수
 *   (tide_collector 를 가짜로 바꿔 센다)·기동 보충 줄세우기·시간 제한/키 재시도(https.get 을 가짜로).
 *   실제 TideBED 는 이 환경에서 접속이 막혀 있어 부르지 않는다. 시험이 만든 파일은 이름을 하나씩 지정해 지운다.
 *
 * [실행] NODE_PATH=…/node_modules node local_server/scripts/test_tide_edges.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/peak_finder.js(findPeaksInSamples) · services/tide_curve_edges.js · services/hazard_rocks_submersion.js
 *        → services/hazard_rocks_tide_collector.js · services/tide_collector.js · services/tide_field_common.js · server.js · scheduler.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LS = path.join(ROOT, 'local_server');
const { findPeaksInSamples, findTidePeaks } = require(path.join(LS, 'peak_finder.js'));
const Edges = require(path.join(LS, 'services', 'tide_curve_edges.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isoOf = (ymd) => `${String(ymd).slice(0, 4)}-${String(ymd).slice(4, 6)}-${String(ymd).slice(6, 8)}`;
const alternates = (pk) => pk.every((p, i) => i === 0 || p.type !== pk[i - 1].type);
const minGap = (pk) => pk.reduce((g, p, i) => i ? Math.min(g, p.m - pk[i - 1].m) : g, Infinity);

/** 이 수정 전의 극값 찾기(hazard_rocks_submersion.js findLocalExtrema 그대로) — "고친 것이 실제로 다른가"를 보이려고만 둔다. */
function oldFindLocalExtrema(samples) {
    const raw = [];
    for (let i = 1; i < samples.length - 1; i++) {
        const p = samples[i - 1], c = samples[i], n = samples[i + 1];
        if (c.cm >= p.cm && c.cm >= n.cm && (c.cm > p.cm || c.cm > n.cm)) raw.push({ m: c.m, cm: c.cm, type: 'high' });
        else if (c.cm <= p.cm && c.cm <= n.cm && (c.cm < p.cm || c.cm < n.cm)) raw.push({ m: c.m, cm: c.cm, type: 'low' });
    }
    const merged = [];
    for (const p of raw) {
        const last = merged[merged.length - 1];
        if (last && last.type === p.type && (p.m - last.m) <= 120) { if (p.type === 'high' ? p.cm > last.cm : p.cm < last.cm) merged[merged.length - 1] = p; }
        else merged.push(p);
    }
    return merged;
}
/** 조위(cm, 소수) — 반일주조(M2) + 일조부등(K1) 합성. dayMin 은 그날 0시 기준 분. */
function tide(dayMin, o) {
    const t = dayMin + (o.shift || 0);
    return o.mean + o.m2 * Math.cos(2 * Math.PI * (t - o.ph) / 745.2) + (o.k1 || 0) * Math.cos(2 * Math.PI * (t - (o.phk || 0)) / 1436);
}

(async () => {
// ── [A] 고조·저조 규칙 ─────────────────────────────────────────────────────
console.log('\n[A] 고조·저조 — 바텀시트와 같은 규칙(평탄 구간 하나로·같은 종류 180분 합침) + 흔들림 지우기');

// A-1 운영 실데이터: id=410(한림 앞, HRJ002 앵커와 같은 자리) 2026-10-18 오늘 곡선(운영 공개 API 10분 표본 그대로)
const P410 = [175.2,175.4,176.5,177.5,178.5,179.2,161,161,162,162,163,163,164,164,164,164,163,163,162,161,160,159,157,156,154,152,150,148,146,143,141,138,136,133,131,128,126,123,121,118,116,114,112,110,108,106,105,103,102,101,100,99,98,98,97,97,97,98,98,99,100,101,103,105,107,109,111,113,116,119,122,125,128,131,134,137,140,144,147,150,153,156,159,162,165,168,170,173,175,177,180,182,183,185,187,188,189,190,191,191,192,192,192,192,192,192,191,191,190,190,189,188,187,186,184,183,182,180,179,177,176,174,173,171,169,167,166,164,162,160,159,157,155,154,153,151,150,149,149,148,147,147,146,146];
(function () {
    const s = P410.map((cm, i) => ({ m: i * 10, cm }));
    const old = oldFindLocalExtrema(s), now = findPeaksInSamples(s);
    ok('운영 id=410 오늘 — 고치기 전 함수는 26개(사용자 화면 그대로 재현)', old.length === 26, String(old.length));
    ok('운영 id=410 오늘 — 고친 뒤 5개 이하', now.length <= 5, now.map(p => p.type[0] + hhmm(p.m)).join(' '));
    ok('운영 id=410 오늘 — 고조·저조가 번갈아 온다', alternates(now));
    ok('운영 id=410 오늘 — 고조 16:50 무렵(192cm 평탄 구간 가운데)', now.some(p => p.type === 'high' && Math.abs(p.m - 1010) <= 20 && p.cm === 192),
        now.map(p => p.type[0] + hhmm(p.m) + '/' + p.cm).join(' '));
    ok('운영 id=410 오늘 — 저조 09:20 무렵(97cm)', now.some(p => p.type === 'low' && Math.abs(p.m - 560) <= 20 && p.cm === 97));
})();

// A-2 사용자 화면(2.8m 간출암) 하루 끝 꼴: 저조 23:20 / 고조 23:30 / 저조 23:40 (값이 다 183 언저리)
(function () {
    const tail = [{ m: 1360, cm: 186.4 }, { m: 1370, cm: 185.1 }, { m: 1380, cm: 184.0 }, { m: 1390, cm: 183.0 }, { m: 1400, cm: 183.2 }, { m: 1410, cm: 183.0 }, { m: 1420, cm: 183.4 }, { m: 1430, cm: 184.1 }];
    const s = [];
    for (let m = 0; m < 1360; m += 10) s.push({ m, cm: Math.round(tide(m, { mean: 205, m2: 78, ph: 1040 }) * 10) / 10 });
    const all = s.concat(tail);
    const oldEnd = oldFindLocalExtrema(all).filter(p => p.m >= 1380);
    const newEnd = findPeaksInSamples(all).filter(p => p.m >= 1380);
    ok('하루 끝 23:20~23:40 계단 — 고치기 전엔 저조·고조·저조 3개(사용자 화면 재현)', oldEnd.length === 3 && oldEnd.map(p => p.type).join() === 'low,high,low',
        oldEnd.map(p => p.type[0] + hhmm(p.m)).join(' '));
    ok('하루 끝 23:20~23:40 계단 — 고친 뒤 저조 1개 이하', newEnd.length <= 1 && newEnd.every(p => p.type === 'low'), newEnd.map(p => p.type[0] + hhmm(p.m)).join(' '));
})();

// A-3 합성: 1cm 계단(한 기준점 정수값) · 조금(조차 작음) · 1분 → 10분 표본
(function () {
    for (const [label, o] of [['조금(조차 약 40cm)', { mean: 150, m2: 20, ph: 200 }], ['보통(조차 약 160cm)', { mean: 200, m2: 80, ph: 500 }], ['사리(조차 약 600cm)', { mean: 350, m2: 300, ph: 50 }]]) {
        const s = [];
        for (let m = 0; m < 1440; m += 10) s.push({ m, cm: Math.round(tide(m, o)) });
        const pk = findPeaksInSamples(s);
        ok(`정수 계단 ${label} — 3~4개(하루 반일주조)`, pk.length >= 3 && pk.length <= 4, pk.map(p => p.type[0] + hhmm(p.m)).join(' '));
        ok(`정수 계단 ${label} — 번갈아 온다`, alternates(pk));
    }
})();

// A-4 합성: 여러 기준점(조시 10~30분 차이)의 1cm 계단을 거리 가중으로 섞은 소수 곡선(흔들림이 생기는 꼴) — 조금 날
(function () {
    const refs = [{ d: 1.5, sh: 0 }, { d: 3.2, sh: 12 }, { d: 4.1, sh: 25 }, { d: 6.0, sh: -18 }];
    const s = [];
    for (let m = 0; m < 1440; m += 10) {
        let ws = 0, vs = 0;
        for (const r of refs) { const w = 1 / (r.d * r.d); ws += w; vs += w * Math.round(tide(m, { mean: 160, m2: 35, ph: 300, shift: r.sh })); }
        s.push({ m, cm: Math.round(vs / ws * 10) / 10 });
    }
    const old = oldFindLocalExtrema(s), pk = findPeaksInSamples(s);
    ok('IDW 섞인 조금 곡선 — 고치기 전엔 6개 넘게(계단·흔들림)', old.length > 6, String(old.length));
    ok('IDW 섞인 조금 곡선 — 고친 뒤 3~4개, 번갈아, 서로 3시간 이상 떨어짐', pk.length >= 3 && pk.length <= 4 && alternates(pk) && minGap(pk) >= 180,
        pk.map(p => p.type[0] + hhmm(p.m)).join(' '));
})();

// A-5 하루 고조·저조가 3개뿐인 날(일조부등이 커 한 물때가 사라짐) — 3개 그대로
(function () {
    const s = [];
    for (let m = 0; m < 1440; m += 10) s.push({ m, cm: Math.round(tide(m, { mean: 150, m2: 20, ph: 100, k1: 45, phk: 300 })) });
    const pk = findPeaksInSamples(s);
    ok('일조부등 큰 날 — 3개 안팎(지어내지 않음)', pk.length >= 2 && pk.length <= 3, pk.map(p => p.type[0] + hhmm(p.m) + '/' + p.cm).join(' '));
})();

// A-6 자정 근처 극값 — 앞뒤 날 표본을 붙이면 00:05 고조를 잡고, 붙이지 않으면 못 잡는다(종전 한계)
(function () {
    const o = { mean: 200, m2: 80, ph: 5 };
    const day = [], padded = [];
    for (let m = -720; m < 2160; m += 10) { const p = { m, cm: Math.round(tide(m, o)) }; padded.push(p); if (m >= 0 && m < 1440) day.push(p); }
    const withPad = findPeaksInSamples(padded), noPad = findPeaksInSamples(day);
    ok('자정 근처 00:05 고조 — 앞뒤 12시간을 붙이면 잡힌다', withPad.some(p => p.type === 'high' && p.m >= 0 && p.m <= 20), withPad.map(p => p.type[0] + hhmm(p.m)).join(' '));
    ok('자정 근처 — 붙여도 그날 밖(전날·다음날) 극값은 내지 않는다', withPad.every(p => p.m >= 0 && p.m < 1440));
    ok('자정 근처 — 그날 표본만이면 00:05 고조는 빠진다(종전과 같은 한계, 패딩이 필요한 이유)', !noPad.some(p => p.type === 'high' && p.m <= 20));
})();

// A-7 바텀시트(findTidePeaks)와 같은 답 — 한 지점 정수 곡선(흔들림 없음)이면 고조·저조 시각·높이가 같다
(function () {
    const o = { mean: 180, m2: 60, ph: 400 };
    const iso = '2026-10-18';
    const items = [], s = [];
    for (let m = 0; m < 1440; m++) { const cm = Math.round(tide(m, o)); items.push({ slctdDt: `${iso} ${hhmm(m)}`, slctdHgt: String(cm) }); s.push({ m, cm }); }
    const ftp = findTidePeaks(items, iso), mine = findPeaksInSamples(s);
    const ftpList = ['highTide1', 'highTide2', 'highTide3', 'highTide4', 'lowTide1', 'lowTide2', 'lowTide3', 'lowTide4']
        .filter(k => ftp[k]).map(k => `${k.startsWith('high') ? 'h' : 'l'}${ftp[k].time}/${ftp[k].height}`).sort();
    const mineList = mine.map(p => `${p.type[0]}${hhmm(p.m)}/${p.cm}`).sort();
    ok('바텀시트 findTidePeaks 와 같은 결과(1분 정수 곡선)', JSON.stringify(ftpList) === JSON.stringify(mineList), `${ftpList.join(' ')} vs ${mineList.join(' ')}`);
})();

// A-8 어제 극값 요약(prev_peaks)도 같은 함수
(function () {
    const PrevPeaks = require(path.join(LS, 'services', 'hazard_rocks_prev_peaks.js'));
    const curve = P410.flatMap((cm, i) => Array.from({ length: 10 }, (_, k) => ({ t: hhmm(i * 10 + k), h: cm })));
    const ex = PrevPeaks.extremaOfCurve(curve);
    ok('어제 극값 요약 — 같은 실데이터에서 5개 이하·번갈아', ex.length <= 5 && ex.every((p, i) => i === 0 || p.type !== ex[i - 1].type), ex.map(p => p.type[0] + p.t).join(' '));
    const SRC = fs.readFileSync(path.join(LS, 'services', 'hazard_rocks_prev_peaks.js'), 'utf8');
    const SUB = fs.readFileSync(path.join(LS, 'services', 'hazard_rocks_submersion.js'), 'utf8');
    ok('두 곳(팝업·어제 요약)이 같은 함수 findPeaksInSamples 를 쓴다', /findPeaksInSamples\(/.test(SRC) && /findPeaksInSamples\(seq\)/.test(SUB) && /peaksWithNeighborDays\(samples, refs/.test(SUB));
    ok('예전 복사본(findLocalExtrema)이 남아 있지 않다', !/function findLocalExtrema/.test(SUB));
})();

// A-9 서버 응답(getTideCurve) 통합 — id=410(HRJ002 앵커와 같은 자리) 앵커 곡선 파일을 시험값(정수 계단·조금)으로 깔고 부른다.
//   그날 앞뒤 날 파일도 깔아 자정 근처 극값(패딩)까지 본다. 실제 파일이 이미 있으면 덮지 않고 건너뛴다. 끝나면 이름별로 지운다.
(function () {
    const HR = require(path.join(LS, 'services', 'hazard_rocks_tide_collector.js'));
    const HRC = require(path.join(LS, 'services', 'hazard_rocks_tide_common.js'));
    const Subm = require(path.join(LS, 'services', 'hazard_rocks_submersion.js'));
    const win = HR.windowDatesKST(HRC.WINDOW_DAYS);
    const all = [Edges.addDays(win[0], -1)].concat(win);
    const laid = [];
    if (all.some(ymd => fs.existsSync(HR.curvePath('HRJ002', ymd)))) { console.log('  ⏭️ HRJ002 실제 곡선 파일이 있어 A-9 를 건너뜀(덮지 않음)'); return; }
    try {
        // 날짜마다 이어지는 곡선 — 연속 분(dayIndex*1440+m) 기준 조금 곡선(조차 약 50cm), 1분 정수.
        //   위상은 내일(win[1]) 00:05 에 고조가 오게 맞춘다(자정 근처 극값 확인용).
        all.forEach((ymd, di) => {
            const curve = [];
            for (let m = 0; m < 1440; m++) {
                const abs = (di - 2) * 1440 + m;   // win[1] 0시 = 0
                curve.push({ t: hhmm(m), h: Math.round(150 + 25 * Math.cos(2 * Math.PI * (abs - 5) / 745.2)) });
            }
            const p = HR.curvePath('HRJ002', ymd);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify({ anchorId: 'HRJ002', date: ymd, status: 'complete', loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve }));
            laid.push(p);
        });
        for (const day of [0, 1, 2]) {
            const r = Subm.getTideCurve(410, day);
            const pk = (r.peaks || []).map(p => ({ m: +p.t.slice(0, 2) * 60 + +p.t.slice(3), type: p.type }));
            ok(`getTideCurve(410, ${day}) — 3~4개·번갈아·서로 3시간 넘게 떨어짐`, r.ready && pk.length >= 3 && pk.length <= 4 && alternates(pk) && minGap(pk) >= 180,
                (r.peaks || []).map(p => p.type[0] + p.t).join(' '));
            ok(`getTideCurve(410, ${day}) — 극값 꼴 {t:"HH:MM", cm, type}`, (r.peaks || []).every(p => /^\d\d:\d\d$/.test(p.t) && typeof p.cm === 'number' && (p.type === 'high' || p.type === 'low')));
        }
        const d1 = Subm.getTideCurve(410, 1);
        ok('내일 00:05 무렵 고조를 잡는다(오늘 곡선을 앞에 붙여서)', (d1.peaks || []).some(p => p.type === 'high' && p.t <= '00:20'), (d1.peaks || []).map(p => p.type[0] + p.t).join(' '));
        const d0 = Subm.getTideCurve(410, 0);
        ok('오늘 마지막(다음날 00:05) 고조는 오늘 목록에 넣지 않는다', !(d0.peaks || []).some(p => p.type === 'high' && p.t >= '23:50'), (d0.peaks || []).map(p => p.type[0] + p.t).join(' '));
    } finally {
        for (const p of laid) { try { fs.unlinkSync(p); } catch (e) { /* noop */ } }
    }
})();

// A-11 「정체 저조」는 남기고 흔들림만 지운다(독립 검토 A-F1) — 운영 공개 API 암초 1586(성산포 3km)
//   2026-10-18 오늘 144점 + 내일 00:00~11:50(새벽 00:00~01:00 은 운영 값이 새벽 빈칸(B) 결함이라 전날 23:50 ~ 01:10 직선으로 메움).
//   성산포 공식 조석표 오늘: 저조 07:23(99) · 고조 15:48(180) · **저조 23:46(145)**. 내려가다 1cm 남짓 오르고(정체) 다시 내려가는 물때다.
(function () {
    const D0 = [163.7,163.7,160.5,160.5,160.1,159.9,159.9,159.3,158.3,157.7,156.7,156.1,154.6,153,151.4,149.8,147.8,146.2,143.8,141.6,139.6,137.3,134.6,132.3,130,128,125.3,123,121,119,117,115,113,111.6,109.6,108.2,106.6,105.2,104.2,103.2,102,101.4,101,100.4,99.9,100.1,100.1,100.5,101.1,101.3,101.9,103.3,104.5,105.5,107,108.6,110.6,112.2,114.4,116.4,118.8,121,123.4,125.6,128.6,130.9,133.1,136.1,138.7,141.1,143.7,146.7,149.3,151.7,154.3,156.7,159.1,161.3,163.7,165.7,168.1,169.8,171.6,173.1,174.6,176.2,177.2,178.6,179.4,180.4,181,181.8,181.8,182.2,182.2,182.2,182.7,182.7,182.7,182.1,181.7,181.5,181.1,180.1,180.1,179.1,178.5,177.5,177.3,176.3,175.3,173.9,172.9,171.9,170.7,169.7,168.4,167.1,166.1,164.4,163.1,162.1,161.1,159.4,158.1,157.1,156.1,155.1,154.1,153.1,152.1,151.7,150.7,149.7,149.3,148.7,148.3,147.9,147.3,147.3,147.3,146.9,146.9,146.9];
    const D1 = [147,147.1,147.1,147.2,147.3,147.4,147.4,147.5,147.5,147.9,147.9,147.9,147.9,147.9,147.5,147.3,147.3,146.3,145.9,145.7,144.7,144.1,143.1,142.1,141.6,140.6,139.6,138.6,137.6,136.6,135.4,134,133,131.6,130.4,129,128,126.8,125.8,124.4,123,122,120.8,119.8,118.8,117.8,116.8,116,115,114.4,113.6,112.9,112.6,112.1,112.1,111.7,111.7,112.1,112.3,112.3,112.9,113.9,114.5,115.5,116.5,117.5,119,120.2,121.6,123.2,124.8,126.4];
    const seq = D0.map((cm, i) => ({ m: i * 10, cm })).concat(D1.map((cm, i) => ({ m: 1440 + i * 10, cm })));
    const pk = findPeaksInSamples(seq);
    ok('정체 저조 — 오늘 23:40 무렵 저조를 남긴다(공식 23:46, 바텀시트도 싣는다)', pk.some(p => p.type === 'low' && p.m >= 1380 && p.m < 1440), pk.map(p => p.type[0] + hhmm(p.m) + '/' + p.cm).join(' '));
    ok('정체 저조 — 공식 저조 07:23·고조 15:48 도 그대로(±40분)', pk.some(p => p.type === 'low' && Math.abs(p.m - 443) <= 40) && pk.some(p => p.type === 'high' && Math.abs(p.m - 948) <= 40));
    const pk1 = findPeaksInSamples(seq.map(p => ({ m: p.m - 1440, cm: p.cm })));   // 내일 기준
    ok('정체 고조 — 내일 01:50 무렵 고조(1cm 오른 정체)도 남긴다(바텀시트와 같은 꼴)', pk1.some(p => p.type === 'high' && p.m >= 60 && p.m <= 150), pk1.map(p => p.type[0] + hhmm(p.m)).join(' '));
    // 흔들림(10~20분 간격·1cm 미만)은 그대로 지운다 — 운영 표본에서 본 꼴: 1654 내일 고조 17:25/206.9 · 저조 17:40/206.8 · 고조 17:50/206.9
    const w = []; for (let m = 0; m < 1440; m += 10) w.push({ m, cm: Math.round((150 + 57 * Math.cos(2 * Math.PI * (m - 1050) / 745.2)) * 10) / 10 });
    const at = (m, cm) => { w[m / 10].cm = cm; };
    at(1040, 206.9); at(1050, 206.9); at(1060, 206.8); at(1070, 206.9);
    const pw = findPeaksInSamples(w);
    ok('흔들림(10~20분·0.1cm 짝) — 고조 하나로 합친다', pw.filter(p => Math.abs(p.m - 1055) <= 30).length === 1 && alternates(pw), pw.map(p => p.type[0] + hhmm(p.m) + '/' + p.cm).join(' '));
    const PF = fs.readFileSync(path.join(LS, 'peak_finder.js'), 'utf8');
    ok('주석이 실측 분포로 정정돼 있다(1cm 미만 22·1~3cm 12·3~20cm 9·20cm 이상 604)', /1cm 미만 22 · 1~3cm 12 · 3~20cm 9 · 20cm 이상 604쌍/.test(PF) && !/진짜 물때는 전부 20cm 이상\(356쌍\)/.test(PF));
})();

// A-10 자정 이음매 — 옆날에 앵커 일부만 있을 때(독립 검토 C-2·A-F2). 암초 2532(가까운 앵커 HRJ017·016·014·015)에
//   앵커마다 높이를 조금씩 다르게(+0·+20·−10·+25cm) 깐다 → 옆날을 따로 섞으면 자정에서 단차가 생겨
//   진짜 극값이 지워지거나 가짜 극값이 생겼다. 지금은 세 날 다 있는 같은 앵커 묶음으로만 이어 붙인다.
(function () {
    const HR = require(path.join(LS, 'services', 'hazard_rocks_tide_collector.js'));
    const HRC = require(path.join(LS, 'services', 'hazard_rocks_tide_common.js'));
    const Subm = require(path.join(LS, 'services', 'hazard_rocks_submersion.js'));
    const win = HR.windowDatesKST(HRC.WINDOW_DAYS);
    const ids = ['HRJ017', 'HRJ016', 'HRJ014', 'HRJ015'], off = { HRJ017: 0, HRJ016: 20, HRJ014: -10, HRJ015: 25 };
    if (win.some(y => ids.some(id => fs.existsSync(HR.curvePath(id, y))))) { console.log('  ⏭️ 실제 곡선 파일이 있어 A-10 을 건너뜀(덮지 않음)'); return; }
    const lay = (ymd, di, list, phase) => { for (const id of list) {
        const curve = []; for (let m = 0; m < 1440; m++) curve.push({ t: hhmm(m), h: Math.round(150 + 25 * Math.cos(2 * Math.PI * (di * 1440 + m - phase) / 745.2) + off[id]) });
        const p = HR.curvePath(id, ymd); fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ status: 'complete', loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve })); } };
    const clear = () => { for (const id of ids) for (const y of win) { try { fs.unlinkSync(HR.curvePath(id, y)); } catch (e) { /* 없으면 그만 */ } } };
    const run = (prevIds, nextIds, phase) => { clear(); lay(win[0], 0, prevIds, phase); lay(win[1], 1, ids, phase); lay(win[2], 2, nextIds, phase);
        const r = Subm.getTideCurve(2532, 1); clear(); return (r.peaks || []).map(p => p.type[0] + p.t).join(' '); };
    try {
        // ① 저조가 내일 00:20 (위상 1087) — 전날에 가까운 앵커 하나만 있어도 00:20 저조를 지우지 않는다
        const base1 = run(ids, ids, 1087);
        ok('이음매① 기준(네 앵커 다 있음) — 내일 00:20 저조가 있다', /^l00:20 /.test(base1), base1);
        ok('이음매① 전날에 가까운 앵커 하나만 — 같은 결과(저조 00:20 안 지워짐)', run([ids[0]], ids, 1087) === base1, run([ids[0]], ids, 1087));
        ok('이음매① 전날에 셋만 — 같은 결과', run(ids.slice(0, 3), ids, 1087) === base1);
        // ② 자정이 오르는 중(위상 −90 → 고조 01:30 무렵) — 다음날 일부만 있어도 23:50 근처에 가짜 극값을 만들지 않는다
        const base2 = run(ids, ids, 1440 + 90 - 1440);
        ok('이음매② 다음날에 가까운 앵커 하나만 — 기준과 같은 결과(가짜 극값 없음)', run(ids, [ids[0]], 0 + 90) === base2, `${run(ids, [ids[0]], 90)} vs ${base2}`);
        ok('이음매② 다음날에 셋만 — 같은 결과', run(ids, ids.slice(1), 90) === base2);
    } finally { clear(); }
})();

// ── [B] 새벽·밤 가장자리 ───────────────────────────────────────────────────
console.log('\n[B] 새벽 빈칸 — 조시차만큼 넘친 꼬리를 남겨 옆날이 쓴다(호출 0), 모자라면 옆날 한 페이지(호출 1)');

const D = 20261018;
/** TideBED 응답 흉내 — reqYmd 의 obsrvnDt 00:00~23:59(또는 pages 만) 에 josi(분)를 더한 slctdDt. 높이는 정수 문자열. */
function fakeItems(reqYmd, josi, pages) {
    const out = [];
    const base = Date.UTC(+String(reqYmd).slice(0, 4), +String(reqYmd).slice(4, 6) - 1, +String(reqYmd).slice(6, 8));
    for (let i = 0; i < 1440; i++) {
        const page = Math.floor(i / 300) + 1;
        if (pages && !pages.includes(page)) continue;
        const ob = new Date(base + i * 60000), sl = new Date(base + (i + josi) * 60000);
        const f = (d) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
        const slDayMin = Math.round((sl.getTime() - Date.UTC(2026, 9, 18)) / 60000);
        out.push({ obsrvnDt: f(ob), slctdDt: f(sl), slctdHgt: String(Math.round(tide(slDayMin, { mean: 200, m2: 80, ph: 300 }))), josi: '+1시간6분' });
    }
    return out;
}
(function () {
    const sp = Edges.splitByDay(fakeItems(D, 66), D);
    ok('josi +66분 — 그날 몫은 01:06~23:59(1374분)', sp.curve.length === 1374 && sp.curve[0].t === '01:06' && sp.curve[sp.curve.length - 1].t === '23:59', `${sp.curve.length} ${sp.curve[0].t}`);
    ok('josi +66분 — 다음날 몫 00:00~01:05(66분)이 spill 에 남는다', (sp.spill[String(Edges.addDays(D, 1))] || []).length === 66);
    ok('josi +66분 — 예전 기준(1300분)으로는 "완전"인데 새 기준은 아니다(앞 66분 빔)',
        sp.curve.length >= 1300 && !Edges.isFullDay({ loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve: sp.curve }));
    const neg = Edges.splitByDay(fakeItems(D, -40), D);
    ok('josi −40분 — 그날 몫은 00:00~23:19, 전날 몫 40분이 spill', neg.curve[0].t === '00:00' && neg.curve[neg.curve.length - 1].t === '23:19' &&
        (neg.spill[String(Edges.addDays(D, -1))] || []).length === 40);
})();

await (async function () {
    // 옆날 파일의 spill 로 메움 — 호출 0회
    const prevFile = { spill: { [String(D)]: Edges.splitByDay(fakeItems(Edges.addDays(D, -1), 66), Edges.addDays(D, -1)).spill[String(D)] } };
    let calls = [];
    const io = { readNeighbor: (ymd) => ymd === Edges.addDays(D, -1) ? prevFile : null, fetchPage: async (r, p) => { calls.push([r, p]); return []; } };
    const own = Edges.splitByDay(fakeItems(D, 66), D).curve;
    const f1 = await Edges.fillEdges(own, D, io);
    ok('전날 파일 spill 로 새벽 66분을 채운다(호출 0회)', f1.curve.length === 1440 && f1.fromSpill === 66 && calls.length === 0, `${f1.curve.length} ${f1.fromSpill} calls=${calls.length}`);
    ok('채운 새벽 값이 이어진다(00:59→01:06 점프 없음)', (() => { const v = (t) => f1.curve.find(p => p.t === t).h; return Math.abs(v('01:06') - v('01:05')) <= 2; })());

    // 전날 파일이 없음 → 전날 5페이지 1번
    calls = [];
    const io2 = { readNeighbor: () => null, fetchPage: async (r, p) => { calls.push([r, p]); return fakeItems(r, 66, [p]); } };
    const f2 = await Edges.fillEdges(own, D, io2);
    ok('전날 파일이 없으면 전날 5페이지만 1번 받아 채운다', calls.length === 1 && calls[0][0] === Edges.addDays(D, -1) && calls[0][1] === 5 && f2.curve.length === 1440,
        JSON.stringify(calls) + ' ' + f2.curve.length);

    // 조시차 음수 — 밤 끝 40분이 빔 → 다음날 1페이지 1번
    calls = [];
    const ownNeg = Edges.splitByDay(fakeItems(D, -40), D).curve;
    const io3 = { readNeighbor: () => null, fetchPage: async (r, p) => { calls.push([r, p]); return fakeItems(r, -40, [p]); } };
    const f3 = await Edges.fillEdges(ownNeg, D, io3);
    ok('조시차 음수 — 다음날 1페이지만 1번 받아 밤 끝을 채운다', calls.length === 1 && calls[0][0] === Edges.addDays(D, 1) && calls[0][1] === 1 && f3.curve.length === 1440,
        JSON.stringify(calls) + ' ' + f3.curve.length);

    // 조시차 작음(+7분) — 15분 이하라 호출하지 않는다(읽는 쪽 ±15분 보간이 메운다)
    calls = [];
    const f4 = await Edges.fillEdges(Edges.splitByDay(fakeItems(D, 7), D).curve, D, io2);
    ok('조시차 +7분 — 호출하지 않는다(완전 판정도 통과)', calls.length === 0 && Edges.isFullDay({ loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve: f4.curve }));

    // 옆 페이지 받기 실패 — 곡선은 그대로, "완전" 아님(다음 수집 때 다시)
    const f5 = await Edges.fillEdges(own, D, { readNeighbor: () => null, fetchPage: async () => null });
    ok('옆 페이지를 못 받으면 곡선은 그대로·완전 아님(다음에 다시)', f5.curve.length === 1374 && !Edges.isFullDay({ loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve: f5.curve }));
})();

// B-2 수집기 통합 — tide_collector 를 가짜로 바꿔 API 호출 수를 센다(실제 파일은 시험 날짜 1900-01-xx 로만, 끝나면 이름별로 지움)
await (async function () {
    const tcPath = require.resolve(path.join(LS, 'services', 'tide_collector.js'));
    const calls = [];
    let gridAns = { hash: '1_2', error: false }, edgeDown = false;
    const fake = {
        getGridHash: async () => { calls.push('grid'); return gridAns.hash; },
        lookupGridHash: async () => { calls.push('grid'); return gridAns; },
        collectTideBedPages: async (lat, lon, req, pages) => {
            const pg = pages || [1, 2, 3, 4, 5]; calls.push(`pages:${req}:${pg.join(',')}`);
            if (edgeDown && pg.length < 5) return { items: [], loadedPages: [], failedPages: pg };   // 가장자리 페이지 장애
            return { items: fakeItems(+req, 66, pg), loadedPages: pg, failedPages: [] };
        },
        isUserActive: () => false
    };
    const saved = require.cache[tcPath];
    require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: fake };
    const HR = require(path.join(LS, 'services', 'hazard_rocks_tide_collector.js'));
    const anchor = { id: 'TESTEDGE_A', lat: 33.39662, lon: 126.23928 };
    const days = [19000101, 19000102, 19000103];
    const made = [];
    const cleanup = () => { for (const ymd of days) { const p = HR.curvePath(anchor.id, ymd); try { fs.unlinkSync(p); } catch (e) { /* 없으면 그만 */ } } };
    try {
        cleanup();
        // ① 처음(전날 파일 없음): 하루치 6회(격자 1 + 5페이지) + 전날 5페이지 1회
        calls.length = 0;
        const r1 = await HR.collectOne(anchor, days[0]);
        ok('첫날(전날 파일 없음) — 격자 1 + 하루치 5페이지 1묶음 + 전날 5페이지 1회', calls.join('|') === 'grid|pages:19000101:1,2,3,4,5|pages:18991231:5' && r1.status === 'complete',
            calls.join('|') + ' ' + r1.status);
        made.push(days[0]);
        const j1 = JSON.parse(fs.readFileSync(HR.curvePath(anchor.id, days[0]), 'utf8'));
        ok('저장 파일 — 00:00~23:59 1440분 + 다음날 몫 spill', j1.curve.length === 1440 && j1.curve[0].t === '00:00' && (j1.spill['19000102'] || []).length === 66);
        ok('저장 파일 — 새 기준으로 완전(isComplete)', HR.isComplete(anchor.id, days[0]));
        // ② 다음날: 전날 파일 spill 로 새벽을 채움 → 추가 호출 0
        calls.length = 0;
        const r2 = await HR.collectOne(anchor, days[1]);
        ok('둘째 날 — 전날 파일 spill 로 채워 추가 호출 없음(격자 1 + 5페이지만)', calls.join('|') === 'grid|pages:19000102:1,2,3,4,5' && r2.status === 'complete', calls.join('|'));
        made.push(days[1]);
        // ③ 옛 파일(이 수정 전 꼴: complete·1374분·spill 없음) → 하루치를 다시 받지 않고 전날 5페이지 1회만
        const oldRec = { anchorId: anchor.id, date: days[2], status: 'complete', loadedPages: [1, 2, 3, 4, 5], failedPages: [], count: 1374,
            curve: Edges.splitByDay(fakeItems(days[2], 66), days[2]).curve };
        fs.writeFileSync(HR.curvePath(anchor.id, days[2]), JSON.stringify(oldRec));
        made.push(days[2]);
        ok('옛 파일(1300분 기준 "완전")은 이제 완전이 아니다 → 다시 손볼 대상', !HR.isComplete(anchor.id, days[2]));
        calls.length = 0;
        // 옆날(19000102) 파일에 이미 spill[19000103] 이 있으므로 호출 0회로 고쳐진다
        const r3 = await HR.collectOne(anchor, days[2]);
        ok('옛 파일 — 옆날 spill 이 있으면 호출 0회로 새벽만 채운다(하루치 재수집 없음)', calls.length === 0 && r3.edgeOnly === true && HR.isComplete(anchor.id, days[2]), calls.join('|') + ' ' + JSON.stringify(r3));
        // ④ 옛 파일 + 옆날 spill 없음 → 전날 5페이지 1회만(하루치 6회 대신)
        fs.writeFileSync(HR.curvePath(anchor.id, days[2]), JSON.stringify(oldRec));
        const j2 = JSON.parse(fs.readFileSync(HR.curvePath(anchor.id, days[1]), 'utf8')); delete j2.spill;
        fs.writeFileSync(HR.curvePath(anchor.id, days[1]), JSON.stringify(j2));
        calls.length = 0;
        const r4 = await HR.collectOne(anchor, days[2]);
        ok('옛 파일 + 옆날 spill 없음 — 전날 5페이지 1회만(하루치 6회 대신)', calls.join('|') === 'pages:19000102:5' && r4.status === 'complete', calls.join('|'));
        // ⑤ 기동 보충 — 이미 완전한 날짜는 다시 받지 않는다(호출 0). anchors.json 의 실제 17앵커 × 시험 날짜 2개를
        //   완전한 파일로 깔아 두고 수집기 전체(collectHazardRockTides)를 돌린다.
        //   ⚠작업이 하나라도 생기면 수집기가 극값 요약(prev_peaks)을 정리(prune)하므로, 그 폴더 파일을 미리 읽어 두고 끝나면 되살린다.
        const ppDir = require(path.join(LS, 'services', 'hazard_rocks_prev_peaks.js')).PREV_PEAKS_DIR;
        const ppBackup = {};
        try { for (const f of fs.readdirSync(ppDir)) ppBackup[f] = fs.readFileSync(path.join(ppDir, f)); } catch (e) { /* 폴더 없음 */ }
        const anchors = HR.loadAnchors() || [];
        const full = JSON.parse(fs.readFileSync(HR.curvePath(anchor.id, days[0]), 'utf8'));
        const laid = [];
        try {
            for (const a of anchors) for (const ymd of [days[0], days[1]]) {
                const p = HR.curvePath(a.id, ymd);
                if (fs.existsSync(p)) continue;
                fs.writeFileSync(p, JSON.stringify({ ...full, anchorId: a.id, date: ymd })); laid.push(p);
            }
            calls.length = 0;
            const r5 = await HR.collectHazardRockTides({ dates: [days[0], days[1]], log: () => {} });
            ok(`기동 보충 — 이미 완전한 날짜(앵커 ${anchors.length} × 2일)는 다시 받지 않는다(호출 0)`,
                anchors.length > 0 && calls.length === 0 && r5.collected === 0 && r5.skipped === anchors.length * 2, calls.length + ' ' + JSON.stringify(r5));
        } finally {
            for (const p of laid) { try { fs.unlinkSync(p); } catch (e) { /* noop */ } }
            for (const f of Object.keys(ppBackup)) { const p = path.join(ppDir, f); if (!fs.existsSync(p)) fs.writeFileSync(p, ppBackup[f]); }
        }

        // ⑥ 격자 조회 실패(장애) — 곡선이 있던 파일을 no_grid 빈 파일로 덮지 않는다(독립 검토 C-1)
        const before6 = fs.readFileSync(HR.curvePath(anchor.id, days[0]), 'utf8');
        const p6 = HR.curvePath(anchor.id, 19000105);
        fs.writeFileSync(p6, JSON.stringify({ status: 'partial', loadedPages: [1, 2, 3, 4], failedPages: [5], curve: JSON.parse(before6).curve.slice(0, 1200) }));
        days.push(19000105);
        gridAns = { hash: null, error: true }; calls.length = 0;
        const r6 = await HR.collectOne(anchor, 19000105);
        const j6 = JSON.parse(fs.readFileSync(p6, 'utf8'));
        ok('격자 조회 장애 — 결과는 failed(차단기가 센다)', r6.status === 'failed', JSON.stringify(r6));
        ok('격자 조회 장애 — 4페이지 부분 파일을 빈 no_grid 로 덮지 않는다', j6.status === 'partial' && j6.curve.length === 1200, `${j6.status} ${j6.curve.length}`);
        // ⑦ 격자 미제공 답이 와도 곡선이 있던 파일은 그대로
        gridAns = { hash: null, error: false };
        const r7 = await HR.collectOne(anchor, 19000105);
        ok('격자 미제공 답 — 곡선이 있던 파일은 덮지 않는다(kept)', r7.status === 'no_grid' && r7.kept === true && JSON.parse(fs.readFileSync(p6, 'utf8')).curve.length === 1200, JSON.stringify(r7));
        // ⑦-2 곡선이 없던 날짜면 종전처럼 no_grid 를 기록
        const r7b = await HR.collectOne(anchor, 19000106); days.push(19000106);
        ok('격자 미제공 + 파일 없음 — 종전처럼 no_grid 기록', r7b.status === 'no_grid' && JSON.parse(fs.readFileSync(HR.curvePath(anchor.id, 19000106), 'utf8')).status === 'no_grid');
        gridAns = { hash: '1_2', error: false };

        // ⑧ 가장자리 페이지 장애 — partial 이어도 edgeFailed 로 차단기가 센다(독립 검토 B-D1).
        //   anchors.json 의 실제 17앵커 × 시험 날짜 1개를 「하루치는 있고 새벽만 빈」 옛 파일로 깔고 전부 가장자리 장애.
        //   종전: partial 이라 차단기를 우회해 17곳 전부 두드렸다 → 지금: 연속 8곳에서 멈춘다.
        const ppBackup2 = {};
        try { for (const f of fs.readdirSync(ppDir)) ppBackup2[f] = fs.readFileSync(path.join(ppDir, f)); } catch (e) { /* 폴더 없음 */ }
        const laid8 = [];
        try {
            const oldCurve = Edges.splitByDay(fakeItems(19000110, 66), 19000110).curve;
            for (const a of anchors) {
                const p = HR.curvePath(a.id, 19000110);
                if (fs.existsSync(p)) continue;
                fs.writeFileSync(p, JSON.stringify({ anchorId: a.id, date: 19000110, status: 'complete', loadedPages: [1, 2, 3, 4, 5], failedPages: [], curve: oldCurve })); laid8.push(p);
            }
            edgeDown = true; calls.length = 0;
            const r8 = await HR.collectHazardRockTides({ dates: [19000110], log: () => {} });
            ok(`가장자리 장애 — 연속 8곳에서 차단(앵커 ${anchors.length}곳 전부 두드리지 않음)`, r8.aborted === true && calls.length === 8, `aborted=${r8.aborted} 호출=${calls.length}`);
        } finally {
            edgeDown = false;
            for (const p of laid8) { try { fs.unlinkSync(p); } catch (e) { /* noop */ } }
            try { fs.unlinkSync(require(path.join(LS, 'services', 'hazard_rocks_prev_peaks.js')).filePath('hr', 19000110)); } catch (e) { /* noop */ }
            for (const f of Object.keys(ppBackup2)) { const p = path.join(ppDir, f); if (!fs.existsSync(p)) fs.writeFileSync(p, ppBackup2[f]); }
        }
    } finally {
        cleanup();
        if (saved) require.cache[tcPath] = saved; else delete require.cache[tcPath];
    }
})();

// ── [C] 제주 기동 보충 + 줄세우기 ──────────────────────────────────────────
console.log('\n[C] 제주 「모레」 — 서버 기동 때 제주 두 수집기도 부족분만, 23:30 묶음과 한 줄로');
(function () {
    const SERVER = fs.readFileSync(path.join(LS, 'server.js'), 'utf8');
    const SCHED = fs.readFileSync(path.join(LS, 'scheduler.js'), 'utf8');
    const blk = (SERVER.match(/runTideBatchExclusive\(async \(\) => \{[\s\S]*?\n {16}\}\);/) || [''])[0];
    ok('기동 보충이 물빠짐 → 제주 간출암 → 제주 고립판정 순서로 한 묶음이다',
        /bootstrapTideField\(\)[\s\S]*collectHazardRockTides\(\)[\s\S]*collectJejuIsolationTides\(\)/.test(blk), blk.slice(0, 80));
    ok('기동 보충은 await 로 차례차례(동시 호출 없음)', (blk.match(/await /g) || []).length >= 3);
    ok('23:30 묶음도 같은 줄(runTideBatchExclusive)에 선다', /hm === '23:30'[\s\S]{0,600}runTideBatchExclusive\(async/.test(SCHED));
    ok('23:30 묶음 순서 그대로(서해·남해 → 제주 → 고립판정 → 잠김 교차시각)',
        /collectTideField\(\{ log \}\)[\s\S]*collectHazardRockTides\(\{ log \}\)[\s\S]*collectJejuIsolationTides\(\{ log \}\)[\s\S]*computeAllCrossings\(\{ log \}\)/.test(SCHED));
    for (const f of ['hazard_rocks_tide_collector.js', 'jeju_isolation_tide_collector.js']) {
        const s = fs.readFileSync(path.join(LS, 'services', f), 'utf8');
        ok(`${f} — 사용자 조석 요청 중엔 키를 양보한다(isUserActive)`, /tcMod\.isUserActive\(\) && yielded < MAX_USER_YIELD_MS/.test(s));
        ok(`${f} — 완전 판정에 가장자리 기준을 쓴다(Edges.isFullDay)`, /Edges\.isFullDay\(j\)/.test(s));
    }
    ok('tide_field_collector.js — 같은 가장자리 메우기를 쓴다', /Edges\.fillEdges\(split\.curve/.test(fs.readFileSync(path.join(LS, 'services', 'tide_field_collector.js'), 'utf8')));
})();
await (async function () {
    const TFC = require(path.join(LS, 'services', 'tide_field_common.js'));
    const log = [];
    const a = TFC.runTideBatchExclusive(async () => { log.push('a1'); await new Promise(r => setTimeout(r, 30)); log.push('a2'); });
    const b = TFC.runTideBatchExclusive(async () => { log.push('b1'); throw new Error('b 실패'); });
    const c = TFC.runTideBatchExclusive(async () => { log.push('c1'); });
    await a; await b.catch(() => {}); await c;
    ok('줄세우기 — 앞 묶음이 끝나야 다음이 시작하고, 실패한 묶음이 뒤를 막지 않는다', log.join(',') === 'a1,a2,b1,c1', log.join(','));
})();

// ── [D] 바텀시트 조석 요청 시간 제한·키 재시도 ──────────────────────────────
console.log('\n[D] TideBED 요청 — 연결 기한(다른 키로 1회) · 전체 기한(다시 묻지 않음)');
await (async function () {
    const cfgPath = path.join(LS, 'data', 'tidebed_config.json');
    const hadCfg = fs.existsSync(cfgPath);
    const cfgBackup = hadCfg ? fs.readFileSync(cfgPath) : null;
    const https = require('https'), http = require('http');
    const realGet = https.get;
    let srv = null;
    try {
        const TC = require(path.join(LS, 'services', 'tide_collector.js'));
        const keysBackup = TC.tideBedConfig.keys.slice();
        const toBackup = { ...TC.TIDEBED_TIMEOUTS };
        TC.tideBedConfig.keys.splice(0, TC.tideBedConfig.keys.length,
            { key: 'TESTKEY_A', used: 0, owner: 'A' }, { key: 'TESTKEY_B', used: 0, owner: 'B' }, { key: 'TESTKEY_C', used: 0, owner: 'C' });
        TC.tideBedConfig.lastResetDate = new Date(Date.now() + 9 * 3600000).toISOString().split('T')[0];   // 날짜 바뀜 저장 안 일어나게
        ok('기본 기한 — 연결 5초·전체 15초', toBackup.connectMs === 5000 && toBackup.totalMs === 15000, JSON.stringify(toBackup));
        TC.TIDEBED_TIMEOUTS.connectMs = 80; TC.TIDEBED_TIMEOUTS.totalMs = 300;   // 시험만 짧게(실제로 15초 기다리지 않음)
        const EventEmitter = require('events');

        // D-1 연결이 영영 안 됨(소켓이 연결 중에서 멈춤) — 종전 req.setTimeout 은 연결 뒤에만 시작해 이 경우를 못 막았다(검토 B-D2).
        let seen = [];
        https.get = (url) => {
            seen.push((String(url).match(/serviceKey=([^&]+)/) || [])[1]);
            const req = new EventEmitter();
            req.destroy = (err) => setImmediate(() => { req.emit('error', err); req.emit('close'); });
            setImmediate(() => req.emit('socket', Object.assign(new EventEmitter(), { connecting: true })));
            return req;
        };
        let t0 = Date.now();
        const r1 = await TC.fetchTideBedPage(33.4, 126.2, '20261018', 1, 1);
        ok('연결이 안 되면 연결 기한에 끊고 null', r1 === null && Date.now() - t0 < 1000, `${JSON.stringify(r1)} ${Date.now() - t0}ms`);
        ok('연결 실패는 다른 키로 1회만 다시(총 2회)', seen.length === 2 && seen[0] !== seen[1], seen.join(' → '));
        seen = [];
        const g = await TC.lookupGridHash(33.4, 126.2, '20261018');
        ok('격자 조회도 빨리 끝나고 「조회 실패」로 표시(격자 미제공과 구분)', g.hash === null && g.error === true && seen.length === 2, JSON.stringify(g));

        // D-2 실제 소켓 — 가짜 TideBED 서버(127.0.0.1)로 돌린다
        let mode = 'ok', hits = 0;
        const okBody = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [{ m2TconstAmp: '1.234', m2TconstTlag: '5.678', slctdDt: '2026-10-18 00:00', slctdHgt: '1' }] } } } });
        srv = http.createServer((req, res) => {
            hits++;
            if (mode === 'ok') res.end(okBody);
            else if (mode === 'slow') setTimeout(() => { try { res.end(okBody); } catch (e) { /* 이미 끊김 */ } }, 600);
            else if (mode === 'nodata') res.end(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } }));
            else if (mode === 'err10') res.end(JSON.stringify({ response: { header: { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' } } }));
            else if (mode === 'err99') res.end(JSON.stringify({ response: { header: { resultCode: '99', resultMsg: 'UNKNOWN_ERROR' } } }));
        });
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        const port = srv.address().port;
        https.get = (url, cb) => http.get(String(url).replace('https://apis.data.go.kr', `http://127.0.0.1:${port}`), cb);
        hits = 0; mode = 'ok';
        ok('정상 응답 — 그대로 받는다', (await TC.getGridHash(33.4, 126.2, '20261018')) === '1234_5678' && hits === 1);
        hits = 0; mode = 'slow'; t0 = Date.now();
        const r2 = await TC.fetchTideBedPage(33.4, 126.2, '20261018', 1, 300);
        ok('느린 응답(전체 기한 넘음) — 끊고 다시 묻지 않는다(요청 1회)', r2 && r2._timedOut === true && hits === 1, `${JSON.stringify(r2)} hits=${hits}`);
        hits = 0; t0 = Date.now();
        const r3 = await TC.collectTideBedPages(33.4, 126.2, '20261018', [1, 2, 3, 4, 5]);
        ok('5페이지 모두 느림 — 페이지 재시도도 안 해 요청 5회(종전 검토 실측 30회)', hits === 5 && r3.loadedPages.length === 0 && r3.failedPages.length === 5, `hits=${hits} ${JSON.stringify(r3.failedPages)}`);
        mode = 'nodata';
        ok('응답 코드 03(자료 없음) — 「격자 미제공」(조회 실패 아님)', JSON.stringify(await TC.lookupGridHash(33.4, 126.2, '20261018')) === JSON.stringify({ hash: null, error: false }));
        mode = 'err10';
        ok('응답 코드 10(격자 밖 좌표) — 「격자 미제공」(조회 실패로 세면 차단기가 수집을 멈춘다, 2026-10-19 운영 로그)', JSON.stringify(await TC.lookupGridHash(33.4, 126.2, '20261018')) === JSON.stringify({ hash: null, error: false }));
        mode = 'err99';
        ok('응답 코드 99(알 수 없는 오류) — 「조회 실패」', (await TC.lookupGridHash(33.4, 126.2, '20261018')).error === true);
        Object.assign(TC.TIDEBED_TIMEOUTS, toBackup);
        TC.tideBedConfig.keys.splice(0, TC.tideBedConfig.keys.length, ...keysBackup);
    } finally {
        https.get = realGet;
        if (srv) srv.close();
        // 시험이 설정 파일을 만들었거나 바꿨으면 되돌린다(서비스키를 디스크에 남기지 않게)
        try { if (hadCfg) fs.writeFileSync(cfgPath, cfgBackup); else if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath); } catch (e) { /* noop */ }
    }
    const SRC = fs.readFileSync(path.join(LS, 'services', 'tide_collector.js'), 'utf8');
    ok('응답 본문을 받다 끊겨도(response error) 처리한다', /response\.on\('error', onNetError\)/.test(SRC));
    ok('연결 단계 실패만 다른 키로 다시 묻는다', /if \(!connected && !netRetried\)/.test(SRC));
})();

// 격자 조회 장애를 인근 격자 탐색의 「못 찾음」으로 세지 않는다(서해·남해 — 3번이면 앵커 영구 포기, 독립 검토 C-1)
(function () {
    const TFS = fs.readFileSync(path.join(LS, 'services', 'tide_field_collector.js'), 'utf8');
    ok('인근 격자 탐색 — 조회 장애면 시도 횟수를 올리지 않고 멈춘다', /if \(g\.error\) \{[\s\S]{0,200}return \{ error: true \};/.test(TFS) && /if \(nudged && nudged\.error\) return \{[^}]*status: 'failed'/.test(TFS));
    ok('물빠짐 수집 — 격자 조회 장애면 failed(파일 안 건드림)', /if \(g\.error\) return \{ anchorId: anchor\.id, date: yyyymmdd, status: 'failed', reason: 'grid_lookup_failed' \};/.test(TFS));
    for (const f of ['tide_field_collector.js', 'hazard_rocks_tide_collector.js', 'jeju_isolation_tide_collector.js']) {
        const src = fs.readFileSync(path.join(LS, 'services', f), 'utf8');
        ok(`${f} — 가장자리 장애(edgeFailed)도 연속 실패로 센다`, /r\.status === 'failed' \|\| r\.edgeFailed/.test(src));
    }
    const SERVER = fs.readFileSync(path.join(LS, 'server.js'), 'utf8');
    ok('기동 보충이 곡선을 바꿨을 때만 잠김경고 재계산(computeAllCrossings)', /if \(changed\) \{[\s\S]{0,120}computeAllCrossings\(\)/.test(SERVER));
})();

console.log('\n[E] 게이트 등록');
ok('verify_all.sh SUITES 에 test_tide_edges 가 있다', /test_tide_edges/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8')));

console.log(`\n${pass} PASS / ${fail} FAIL`);
// 디바운스 저장 타이머 등이 남아 있어도 끝낸다(가짜 키가 디스크에 쓰이지 않게 — 위에서 이미 되돌렸다)
process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log('  ❌ 실행 오류 — ' + (e && e.stack || e)); console.log(`\n${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
