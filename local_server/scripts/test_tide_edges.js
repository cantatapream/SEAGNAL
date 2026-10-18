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
    ok('두 곳(팝업·어제 요약)이 같은 함수 findPeaksInSamples 를 쓴다', /findPeaksInSamples\(/.test(SRC) && /findPeaksInSamples\(padWithNeighborDays/.test(SUB));
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
    const fake = {
        getGridHash: async () => { calls.push('grid'); return '1_2'; },
        collectTideBedPages: async (lat, lon, req, pages) => {
            const pg = pages || [1, 2, 3, 4, 5]; calls.push(`pages:${req}:${pg.join(',')}`);
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
console.log('\n[D] TideBED 요청 — 시간 제한 + 네트워크 오류면 다른 키로 1회');
await (async function () {
    const cfgPath = path.join(LS, 'data', 'tidebed_config.json');
    const hadCfg = fs.existsSync(cfgPath);
    const cfgBackup = hadCfg ? fs.readFileSync(cfgPath) : null;
    const https = require('https');
    const realGet = https.get;
    let TC;
    try {
        TC = require(path.join(LS, 'services', 'tide_collector.js'));
        const keysBackup = TC.tideBedConfig.keys.slice();
        TC.tideBedConfig.keys.splice(0, TC.tideBedConfig.keys.length,
            { key: 'TESTKEY_A', used: 0, owner: 'A' }, { key: 'TESTKEY_B', used: 0, owner: 'B' }, { key: 'TESTKEY_C', used: 0, owner: 'C' });
        TC.tideBedConfig.lastResetDate = new Date(Date.now() + 9 * 3600000).toISOString().split('T')[0];   // 날짜 바뀜 저장 안 일어나게
        const EventEmitter = require('events');
        let seen = [];
        // 가짜 https.get — 연결이 영영 안 되는 요청. setTimeout 을 걸면 바로 시간 초과를 울린다(실제로 10초 기다리지 않음).
        https.get = (url) => {
            const key = (String(url).match(/serviceKey=([^&]+)/) || [])[1];
            const req = new EventEmitter();
            req.setTimeout = (ms, cb) => { seen.push({ key, ms }); setImmediate(cb); return req; };
            req.destroy = (err) => setImmediate(() => req.emit('error', err));
            return req;
        };
        const t0 = Date.now();
        const r = await TC.fetchTideBedPage(33.4, 126.2, '20261018', 1, 1);
        ok('연결이 안 되면 null 을 돌려준다(멈추지 않음)', r === null);
        ok('시간 제한을 건다(10초)', seen.length >= 1 && seen.every(s => s.ms === 10000) && TC.TIDEBED_TIMEOUT_MS === 10000, JSON.stringify(seen.map(s => s.ms)));
        ok('네트워크 오류면 한 번만 다시 묻는다(총 2회)', seen.length === 2, String(seen.length));
        ok('다시 물을 때는 다른 키를 쓴다', seen.length === 2 && seen[0].key !== seen[1].key, seen.map(s => s.key).join(' → '));
        ok('가짜 시간 초과 기준 바로 끝난다(실제 대기 없음)', Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
        // getGridHash(바텀시트가 응답 전에 기다리는 것)도 같은 길로 빨리 끝난다
        seen = [];
        const g = await TC.getGridHash(33.4, 126.2, '20261018');
        ok('격자 조회(getGridHash)도 null 로 빨리 끝난다 — 사용자에게 "격자 확인 불가"가 곧 간다', g === null && seen.length === 2);
        // 두 번째에 성공하면 그 결과를 쓴다
        let n = 0;
        https.get = (url, cb) => {
            const idx = n++;
            const req = new EventEmitter();
            req.setTimeout = (ms, tcb) => { if (idx === 0) setImmediate(tcb); return req; };
            req.destroy = (err) => setImmediate(() => req.emit('error', err));
            if (idx > 0) setImmediate(() => {
                const res = new EventEmitter();
                cb(res);
                res.emit('data', JSON.stringify({ response: { body: { items: { item: [{ m2TconstAmp: '1.234', m2TconstTlag: '5.678' }] } } } }));
                res.emit('end');
            });
            return req;
        };
        const g2 = await TC.getGridHash(33.4, 126.2, '20261018');
        ok('첫 요청이 시간 초과·두 번째가 성공하면 그 값을 쓴다', g2 === '1234_5678', String(g2));
        TC.tideBedConfig.keys.splice(0, TC.tideBedConfig.keys.length, ...keysBackup);
    } finally {
        https.get = realGet;
        // 시험이 설정 파일을 만들었거나 바꿨으면 되돌린다(서비스키를 디스크에 남기지 않게)
        try { if (hadCfg) fs.writeFileSync(cfgPath, cfgBackup); else if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath); } catch (e) { /* noop */ }
    }
    const SRC = fs.readFileSync(path.join(LS, 'services', 'tide_collector.js'), 'utf8');
    ok('응답 본문을 받다 끊겨도(response error) 처리한다', /response\.on\('error', onNetError\)/.test(SRC));
})();

console.log('\n[E] 게이트 등록');
ok('verify_all.sh SUITES 에 test_tide_edges 가 있다', /test_tide_edges/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8')));

console.log(`\n${pass} PASS / ${fail} FAIL`);
// 디바운스 저장 타이머 등이 남아 있어도 끝낸다(가짜 키가 디스크에 쓰이지 않게 — 위에서 이미 되돌렸다)
process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log('  ❌ 실행 오류 — ' + (e && e.stack || e)); console.log(`\n${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
