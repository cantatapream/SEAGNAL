'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_compare.js
 * 역할  : MMIS 기준 특보현황(실제 앱)과 통보문 기준 특보현황(bulletin_status)을 매분 맞대어 기록하고,
 *         「통보문 기준이었다면 나갔을 푸시」(가상 — 보내지 않음)를 계산해 실제 MMIS 푸시와 나란히 남긴다.
 *         지금 두 쪽이 다른 구역 표(부모 해역별·칸별 다름·「왜?」 규칙 문장)도 매분 다시 만들어 관리자 메인 팝업에 준다.
 * 사용자 확정 2026-11-15:
 *   「두 개를 비교해서 … 보고서가 만들어지도록 … MMIS는 어떻게 MMIS 신호가 들어온 뒤 얼마 후에 어떠한 그 푸시 알림이 몇 분 몇 초에 나갔는데,
 *    통보문을 했을 때는 몇 분 몇 초에 어떠한 내용의 푸시 알림이 나갔을 거다라는 것을 비교하는 문서」
 *   「MMIS에서의 문제점들이 … 통보문으로 했을 때는 그런 문제점이 발생하지 않는지」
 *   가상 푸시에는 MMIS 의 3분 디바운스·의심 가드·취소 문구 대기를 넣지 않는다(「통보문만 정확하게 나왔다면 디바운스 같은 기능이 필요가 없는것」).
 *   예비 시간창 끝 뒤 10분 대기는 bulletin_status 가 이미 한다.
 * 가상 푸시 문구는 실제 푸시와 같은 함수(push_helpers.generateMessage)로 만든다 — 같은 종류면 같은 꼴.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_status(통보문 기준) · data/weather_alerts.json(MMIS 기준 — marine_warning_crawler 가 씀) ·
 *                   data/custom_push_history.json(실제 보낸 푸시 — routes/push.js 가 씀) · services/push_helpers.generateMessage(문구)
 *  - 저장          : data/bulletin_compare/<KST 날짜>.jsonl(기록, 60일) · data/bulletin_compare/state.json(앞 상태 + 지금 다른 곳 표 diff)
 *  - 나를 쓰는 곳  : scheduler.js(통보문 기준 계산 다음 매분) · routes/bulletin_watch.js(GET /api/admin/bulletin-compare/report.md ·
 *                   GET /api/admin/bulletin-status 의 diff — 관리자 메인 「MMIS와 상이 N개소」 팝업) · 검사 test_bulletin_compare
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'bulletin_compare');
const ALERTS_FILE = path.join(__dirname, '..', 'data', 'weather_alerts.json');
const PUSH_FILE = path.join(__dirname, '..', 'data', 'custom_push_history.json');
const KEEP_DAYS = 60;
const KST = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const dayOf = (ms) => KST(ms).slice(0, 10);

/**
 * MMIS 나무(/api/weather-alerts current) → 단위(부모·자식)별 상태. bulletin_status.zones 와 같은 꼴.
 * 예: {동해:{…:{울산앞바다:{current:null, upcoming:{wrnTpNm:'풍랑', wrnLvlNm:'예비', tmEf:'…'}, children:{}}}}} → { 울산앞바다: {kind:'yebi', type:'풍랑', level:'예비', …} }
 * [연계] ← run(이 파일)
 */
function flattenTree(tree) {
    const out = {};
    const blk = (b, parent) => {
        if (!b || typeof b !== 'object') return null;
        const level = b.wrnLvlNm || b.wrnLvl || '';
        if (!level || level === '해제') return null;
        // MMIS 는 「발표됐지만 아직 발효 전」을 등급 「예비」 + 정확한 발효 시각(…04시 30분)으로 적는다(2026-11-16 실측 강원 11-22호) → 「발표(발효 전)」으로 따로 본다
        const exact = /\d{1,2}시\s*\d{1,2}분\s*$/.test(String(b.tmEf || ''));
        return { parent, kind: level === '예비' ? (exact ? 'pending' : 'yebi') : 'formal', type: b.wrnTpNm || b.wrnTp || '', level: level === '예비' && exact ? '발표' : level, tmFc: b.tmFc || '', tmEf: b.tmEf || '', clr: b.clrNtcTm || b.tmCc || '' };
    };
    (function walk(o) {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object' && 'current' in v && 'children' in v) {
                const cur = blk(v.current, k);
                let upc = blk(v.upcoming, k);
                //   발효 중 해역의 upcoming 은 정의상 아직 발효 전 — MMIS 는 격상·격하 발표대기를 등급(경보 등)으로 적는다(crawler _tryAddCoexistingUpcoming · toBlock wrnLvlReal) → 발표(발효 전)으로(적대검증 2026-11-17 D2)
                if (cur && upc && upc.kind === 'formal') upc = Object.assign(upc, { kind: 'pending', level: '발표' });
                const s = cur || upc; if (s) out[k] = cur && upc ? Object.assign(cur, { up: upc }) : s;   // 발효 중 + 다가오는 특보 = up(2026-11-17 — 종전엔 upcoming 을 버려 다가오는 칸 차이를 못 봤다)
                for (const [c, cv] of Object.entries(v.children || {})) { const cs = blk(cv, k); if (cs) out[c] = cs; }
            } else walk(v);
        }
    })(tree);
    return out;
}

/**
 * 통보문 쪽: 정식 특보인데 발효 시각이 아직 안 됐으면 「발표(발효 전)」 — MMIS 표기와 맞춘다.
 * 예: { 강원북부앞바다: {kind:'formal', level:'주의보', efMs: 04:30} } (지금 01:40) → kind 'pending'
 * [연계] ← run(이 파일)
 */
function pendingOf(zones, nowMs) {
    const out = {};
    for (const [u, z] of Object.entries(zones || {})) {
        const o = (z.kind === 'formal' && z.efMs && z.efMs > nowMs) ? Object.assign({}, z, { kind: 'pending' }) : Object.assign({}, z);
        // 다가오는 특보(다음 정식 = 발표(발효 전) · 예비) — MMIS flattenTree 의 up 과 같은 꼴
        const up = z.next ? Object.assign({ parent: z.parent, kind: 'pending' }, z.next) : z.upYebi ? Object.assign({ parent: z.parent, kind: 'yebi' }, z.upYebi) : null;
        //   부모 해역만 — MMIS 나무의 자식은 블록이 하나뿐이라 다가오는 칸이 없다(자식에 붙이면 늘 「다름」 — 적대검증 2026-11-17 D1, 앱 crawler 도 다가오는 특보는 부모에서만 본다)
        if (up && u === z.parent) o.up = up; else delete o.up;
        out[u] = o;
    }
    return out;
}

/** 상태 비교용 서명 — 종류·등급(예비는 시간창, 정식은 해제 예고까지). */
/** 예비 시간창을 시각만으로 — MMIS 「아침(06시~12시)」·「저녁(18시~00시)」 = 통보문 「오전(06시~12시)」·「밤(18시~24시)」(2026-11-16 실측). 예: → '2026-11-16|06-12' */
const winKey = (t) => { const m = String(t || '').match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일[^(]*\((\d{1,2})시\s*~\s*(\d{1,2})시\)/); if (!m) return String(t || '').replace(/\s+/g, ''); const e = +m[5] === 0 ? 24 : +m[5]; return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}|${+m[4]}-${e}`; };
/** 해제 예고를 시각만으로(「17일 오전(09시~12시)」 → '17|9-12'). */
const clrKey = (t) => { const m = String(t || '').match(/(\d{1,2})일[^(]*\((\d{1,2})시\s*~\s*(\d{1,2})시\)/); return m ? `${+m[1]}|${+m[2]}-${+m[3] === 0 ? 24 : +m[3]}` : String(t || '').replace(/\s+/g, ''); };
const sig1 = (z) => (z ? (z.kind === 'pending' ? `pending|${z.type}|${String(z.tmEf).replace(/\s+/g, '')}` : `${z.kind}|${z.type}|${z.level}|${z.kind === 'yebi' ? winKey(z.tmEf) : clrKey(z.clr)}`) : '');
/** 상태 서명 = 지금 특보 + 다가오는 특보(up) — 다가오는 칸이 달라도 「두 쪽이 다름」으로 본다(2026-11-17). */
const sig = (z) => (z ? sig1(z) + (z.up ? ' ^ ' + sig1(z.up) : '') : '');
const word1 = (z) => (z ? (z.kind === 'yebi' ? `${z.type} 예비(${z.tmEf})` : z.kind === 'pending' ? `${z.type}${z.level === '발표' ? '' : z.level} 발표(${z.tmEf} 발효 예정)` : `${z.type}${z.level}${z.clr ? `(해제 예고 ${z.clr})` : ''}`) : '없음');
const word = (z) => (z ? word1(z) + (z.up ? ` · 다가오는 특보 ${word1(z.up)}` : '') : '없음');

// ── 지금 두 쪽이 다른 해역 표(관리자 메인 「HH:MM 기준 MMIS와 상이 N개소」 팝업 — 2026-11-16) ──
// 「다르다」는 위 sig() 와 같은 기준이라 팝업과 비교 기록(mismatch_start)이 늘 같은 곳을 가리킨다.
const pad2 = (n) => String(n).padStart(2, '0');
/** '2026년 11월 16일 04시 30분' → '16일 04시 30분'(연·월을 뗀다). 빈 값은 '—'. */
const shortT = (s) => String(s || '').replace(/^\d{4}년\s*\d{1,2}월\s*/, '').trim() || '—';
/** '2026년 11월 15일 16시 00분' → ms(못 읽으면 0). 두 쪽 발표 시각의 앞뒤를 가릴 때만 쓴다. */
const fcMs = (s) => { const m = String(s || '').match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/); return m ? Date.parse(`${m[1]}-${pad2(m[2])}-${pad2(m[3])}T${pad2(m[4])}:${pad2(m[5])}:00+09:00`) : 0; };
/** weather_alerts.json updatedAt(ko-KR 지역 시각 글자 — '2026. 11. 16. 오전 3:31:35' 또는 'AM 3:31:35') → '03:31'. 못 읽으면 ''. */
const mmisHm = (s) => {
    const m = String(s || '').match(/(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
    if (!m) return '';
    let h = +m[2]; if (/오후|PM/.test(m[1] || '') && h < 12) h += 12; if (/오전|AM/.test(m[1] || '') && h === 12) h = 0;
    return `${pad2(h)}:${m[3]}`;
};
const STAGE = { formal: '발효 중인 특보', yebi: '예비특보', pending: '발표(발효 전)' };
/** 다가오는 특보 칸 글자. 예: '풍랑 예비특보 (16일 밤(18시~24시))' · 없으면 '—' */
const upLabel = (z) => (z && z.up ? `${label(z.up)} (${shortT(z.up.tmEf)})` : '—');
const label = (z) => (!z ? '없음' : z.kind === 'yebi' ? `${z.type} 예비특보` : z.kind === 'pending' ? `${z.type}${z.level === '발표' ? '' : z.level} 발표(발효 전)` : `${z.type}${z.level}`);
/** 종류·단계 칸 비교값 — sig 처럼 발표(발효 전)은 등급을 안 본다(MMIS 는 등급을 모르고 「발표」로만 적는다). */
const typeKey = (z) => (!z ? '' : z.kind === 'pending' ? `pending|${z.type}` : `${z.kind}|${z.type}|${z.level}`);
const efKey = (z) => (!z ? '' : z.kind === 'yebi' ? winKey(z.tmEf) : String(z.tmEf || '').replace(/\s+/g, ''));
/** 자식 이름 끝말로 칩 글자. 예: '경북북부앞바다중연안바다' → '연안바다' · 부모 자신 → '해역 전체' */
const partKind = (u, parent) => (u === parent ? '해역 전체' : /연안바다$/.test(u) ? '연안바다' : /평수구역$/.test(u) ? '평수구역' : '일부 구역');

/**
 * 한 구역의 「왜?」 한 줄을 규칙 틀로 만든다(AI 없음). 원인은 단정하지 않고 두 값에서 보이는 사실만 쓴다.
 * 예: (MMIS 풍랑주의보, 통보문 없음) → { id:'mmis_only', text:'통보문에는 이 구역에 아무 특보도 없는데 MMIS에는 풍랑주의보 표시가 남아 있습니다.' }
 * @param {object|null} m MMIS 쪽 상태  @param {object|null} b 통보문 쪽 상태
 * @returns {{id: string, text: string}} id = mmis_only|bulletin_only|stage|type|level|yebi_time|pending_time|clr|upcoming|other
 * [연계] ← diffSnapshot(이 파일) · 검사 test_bulletin_compare
 */
function whyOf(m, b) {
    if (m && !b) return { id: 'mmis_only', text: `통보문에는 이 구역에 아무 특보도 없는데 MMIS에는 ${label(m)} 표시가 남아 있습니다.` };
    if (!m && b) return { id: 'bulletin_only', text: `MMIS에는 이 구역에 아무 특보도 없는데 통보문에는 ${label(b)} 표시가 있습니다.` };
    const fm = fcMs(m.tmFc), fb = fcMs(b.tmFc);
    const later = fm && fb && fb > fm ? ' 통보문 쪽 발표 시각이 더 나중입니다.' : fm && fb && fm > fb ? ' MMIS 쪽 발표 시각이 더 나중입니다.' : '';
    if (m.kind !== b.kind) return { id: 'stage', text: `MMIS는 ${STAGE[m.kind]}, 통보문은 ${STAGE[b.kind]} 상태입니다.${later}` };
    if (m.type !== b.type) return { id: 'type', text: `특보 종류가 다릅니다(MMIS ${m.type} · 통보문 ${b.type}).${later}` };
    if (m.kind === 'formal' && m.level !== b.level) return { id: 'level', text: `특보 단계가 다릅니다(MMIS ${m.level} · 통보문 ${b.level}).${later}` };
    if (m.kind === 'yebi') return { id: 'yebi_time', text: `종류는 같고 예비특보 시간대만 다릅니다(MMIS ${shortT(m.tmEf)} · 통보문 ${shortT(b.tmEf)}).${later}` };
    if (m.kind === 'pending') return { id: 'pending_time', text: `종류는 같고 발효 예정 시각만 다릅니다(MMIS ${shortT(m.tmEf)} · 통보문 ${shortT(b.tmEf)}).${later}` };
    if (clrKey(m.clr) !== clrKey(b.clr)) return { id: 'clr', text: `특보는 같고 해제 예고 시각만 다릅니다(MMIS ${m.clr || '없음'} · 통보문 ${b.clr || '없음'}).${later}` };
    if (sig1(m.up) !== sig1(b.up)) return { id: 'upcoming', text: `지금 특보는 같고 다가오는 특보만 다릅니다(MMIS ${upLabel(m)} · 통보문 ${upLabel(b)}).` };
    return { id: 'other', text: '두 자료가 서로 다릅니다.' };
}

/**
 * 한 구역의 표(구분 | MMIS | 통보문) — 칸마다 보여 줄 글자와 「다름」 표시.
 * 같은 단계끼리는 sig 가 보는 칸만 다름으로 친다(예비 = 시간창, 발표(발효 전) = 발효 시각, 정식 = 해제 예고). 단계가 다르거나 한쪽이 없으면 보이는 값끼리 비교.
 * 예: diffPart('강원중부앞바다', '강원중부앞바다', {kind:'yebi',…}, {kind:'pending',…}, '오전 3:31:35') → { unit, kind:'해역 전체', rows:[{k:'특보 종류·단계', m:'풍랑 예비특보', b:'풍랑주의보 발표(발효 전)', diff:true}, …], why }
 * @returns {{unit, kind, rows: Array<{k, m, b, diff}>, why: {id, text}}}
 * [연계] ← diffSnapshot(이 파일)
 */
function diffPart(u, parent, m, b, mmisAt) {
    const same = m && b && m.kind === b.kind;
    const efDiff = same && m.kind === 'formal' ? false : efKey(m) !== efKey(b);
    const clrDiff = same && m.kind === 'pending' ? false : clrKey(m ? m.clr : '') !== clrKey(b ? b.clr : '');
    const ef = (z) => (z && z.tmEf ? shortT(z.tmEf) + (z.kind === 'pending' ? ' 발효 예정' : '') : '—');
    const hm = mmisHm(mmisAt);
    return {
        unit: u, kind: partKind(u, parent),
        rows: [
            { k: '특보 종류·단계', m: label(m), b: label(b), diff: typeKey(m) !== typeKey(b) },
            { k: '발효 시각', m: ef(m), b: ef(b), diff: efDiff },
            { k: '해제 예고', m: (m && m.clr) || '—', b: (b && b.clr) || '—', diff: clrDiff },
            { k: '발표 시각', m: m ? shortT(m.tmFc) : '—', b: b ? shortT(b.tmFc) : '—', diff: false },
            { k: '근거 자료', m: hm ? `MMIS ${hm} 갱신` : '—', b: b && b.ho ? `${b.ho} 통보문` : '—', diff: false },
            { k: '다가오는 특보', m: upLabel(m), b: upLabel(b), diff: sig1(m && m.up) !== sig1(b && b.up) },
        ],
        why: whyOf(m, b),
    };
}

/**
 * 지금 두 쪽이 다른 구역을 부모 해역별로 묶는다(sig 기준). 순서는 MMIS 나무 순서, 통보문에만 있는 곳은 뒤에.
 * 예: { 경북북부앞바다중연안바다: MMIS 주의보 / 통보문 예비 } → { count:1, zones:[{ parent:'경북북부앞바다', count:1, sub:'연안바다만 다름', parts:[…] }] }
 * @param {object} M MMIS 단위별 상태(flattenTree)  @param {object} B 통보문 단위별 상태(pendingOf)
 * @param {number} atMs 비교한 시각  @param {string} mmisAt weather_alerts.json updatedAt(없으면 '')
 * @returns {{atMs, at, mmisAt, count, zones: Array<{parent, count, sub, parts}>}} count = 다른 부모 해역 수
 * [연계] ← run(이 파일) · 검사 test_bulletin_compare / → routes/bulletin_watch GET /api/admin/bulletin-status 의 diff
 */
function diffSnapshot(M, B, atMs, mmisAt) {
    const groups = new Map();
    for (const u of new Set([...Object.keys(M), ...Object.keys(B)])) {
        const m = M[u] || null, b = B[u] || null;
        if (sig(m) === sig(b)) continue;
        const parent = (m || b).parent || u;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(diffPart(u, parent, m, b, mmisAt));
    }
    const zones = [...groups].map(([parent, parts]) => {
        parts.sort((x, y) => (y.unit === parent) - (x.unit === parent));   // 부모 자신이 맨 위
        const kinds = [...new Set(parts.map((p) => p.kind))];
        const sub = kinds.length > 1 ? `${kinds.join('·')} 다름` : kinds[0] === '해역 전체' ? '해역 전체가 다름' : parts.length === 1 ? `${kinds[0]}만 다름` : `${kinds[0]} ${parts.length}곳 다름`;
        return { parent, count: parts.length, sub, parts };
    });
    return { atMs, at: KST(atMs), mmisAt: mmisAt || '', count: zones.length, zones };
}

/**
 * 통보문 쪽 상태 바뀜 하나 → 가상 푸시 종류(실제 push_sender 와 같은 templateId).
 * 예: 없음 → 예비 = publish · 예비/없음 → 정식 = active · 정식 → 없음 = release · 예비 → 없음 = prelim_cancel ·
 *     등급 오름 = level_upgrade_active · 해제 예고만 바뀜 = time_yn_change · 예비 시간창만 바뀜 = time_ef_change ·
 *     자식(연안바다·평수구역)은 부모가 정식 중이면 additional_active / partial_release, 예비 추가는 child_prelim.
 * @returns {{templateId, typeName, level, prevLevel?, prevTypeName?}|null}
 * [연계] ← run(이 파일)
 */
// 범위 끝 비교용(연장 판정) — 예비 시간창 「2026년 11월 16일 오전(06시~12시)」 → 날짜·끝 시각 ms, 해제 예고 「17일 오전(09시~12시)」 → 일·끝 시(같은 달로 봄). 범위가 아니면 null.
const winEnd = (t) => { const k = winKey(t); const m = k.match(/^(\d{4}-\d{2}-\d{2})\|\d+-(\d+)$/); return m ? Date.parse(m[1] + 'T00:00:00+09:00') + (+m[2]) * 3600e3 : null; };
const clrEnd = (t) => { const k = clrKey(t); const m = k.match(/^(\d+)\|\d+-(\d+)$/); return m ? (+m[1]) * 100 + (+m[2]) : null; };

/**
 * 통보문 쪽 단위 하나의 바뀜 → 실제 푸시와 같은 종류(templateId). 앱(push_sender·marine_warning_crawler)과 같은 규칙(2026-11-16 사용자 「앱과 맞춰」):
 *   - 예비(시간 범위) → 발표(정확한 발효 시각) = 「🕐 발효시각 변경」(time_ef_change) — 앱 isPreToAdvisory. 예비 없이 바로 발표면 「📢 발표」.
 *   - 예비 시간창이 같은 종류로 더 늦은 범위로(06~12시 → 12~18시) = 「발효 예정시각 연장」(ef_extend), 그 밖의 시간창 바뀜 = 발효시각 변경.
 *   - 해제 예고가 같은 종류·등급으로 더 늦은 범위로 = 「해제 예정시각 연장」(yn_extend), 그 밖(범위 → 정확한 시각 등) = 「🕐 해제시각 변경」(time_yn_change).
 *   - 자식만 시각이 바뀌고 부모는 그대로면 child_time_ef_change / child_time_yn_change, 부모도 같이 바뀌면 부모 푸시가 맡는다(자식 몫 안 냄).
 * @param {string} unit  @param {object|null} before  @param {object|null} after  @param {object|null} parentNow 지금 부모 상태  @param {boolean} [parentChanged] 이번에 부모 상태도 바뀜
 * @returns {{templateId, typeName, level, prevLevel?, prevTypeName?, oldTime?, newTime?}|null}
 * [연계] ← run(이 파일) / → push_helpers.generateMessage
 */
/**
 * 발효 중인 특보(cur) 위의 「다가오는 특보」가 나타나거나 바뀔 때의 푸시 종류 — 앱 push_sender UPCOMING_CHANGE 와 같은 규칙:
 *   - 다가오는 특보가 이미 있었고 종류·등급이 같다(예비→발표는 isPreToAdvisory 로 같다고 봄): 시간만 바뀜 → 발효시각 변경(예비 범위가 같은 종류로 더 늦어지면 발효 예정시각 연장)
 *   - 처음 나타나거나 등급이 다르다: 지금 발효 중인 것과 점수 비교(예비 = 주의보 동급 — push_sender LVL_RANK) → 종류 다름 = 종류 격상/격하 발표, 등급 다름 = 격상/격하 발표, 같음 = 발표
 * 예: (풍랑주의보 발효 중, 없음 → 풍랑 예비 18~24시) → publish(📢 풍랑 주의보 발표) · (풍랑경보 발효 중, 없음 → 풍랑 예비) → level_downgrade_publish
 *   종류가 다르면 종류 격상/격하 발표(「풍랑경보→태풍주의보 격상 발표」 — 2026-11-17 사용자 확정, 앱 push_sender 도 같은 날 같게 고침).
 * [연계] ← run(이 파일) — 2026-11-17 사용자 「같은 해역에 예비 특보가 나오는 경우 다가오는 특보로」 · 적대검증 2026-11-16 #2
 */
function upTemplate(cur, up0, up1, isChild) {
    const lv = (z) => (z.level === '예비' || z.level === '발표' ? '주의보' : z.level);
    if (up0 && up0.type === up1.type && (lv(up0) === lv(up1))) {
        if (up0.kind === 'yebi' && up1.kind === 'yebi') {
            if (winKey(up0.tmEf) === winKey(up1.tmEf)) return null;
            const o = winEnd(up0.tmEf), n = winEnd(up1.tmEf);
            if (o != null && n != null && n > o) return isChild ? null : { templateId: 'ef_extend', typeName: up1.type, level: '주의보', oldTime: up0.tmEf, newTime: up1.tmEf };
        }
        return { templateId: isChild ? 'child_time_ef_change' : 'time_ef_change', typeName: up1.type, level: lv(up1) };
    }
    const SC = { 주의보: 2, 경보: 5 }, TS = { 풍랑: 10, 태풍: 100 };
    // 다가오는 특보가 이미 있었고 등급은 같은데 종류만 바뀜(풍랑 예비 → 태풍 예비) = 앞 다가오는 특보와 비교한 종류 격상/격하 발표(앱 push_sender 「예비 단계 종류 격상/격하」 분기)
    if (up0 && up0.type !== up1.type && lv(up0) === lv(up1)) return { templateId: (TS[up1.type] || 10) > (TS[up0.type] || 10) ? 'type_upgrade_publish' : 'type_downgrade_publish', typeName: up1.type, level: lv(up1), prevTypeName: up0.type, prevLevel: lv(up0) };
    if (cur.type !== up1.type) return { templateId: (TS[up1.type] || 10) > (TS[cur.type] || 10) ? 'type_upgrade_publish' : 'type_downgrade_publish', typeName: up1.type, level: lv(up1), prevTypeName: cur.type, prevLevel: cur.level };
    if (lv(cur) !== lv(up1)) return { templateId: (SC[lv(up1)] || 0) > (SC[lv(cur)] || 0) ? 'level_upgrade_publish' : 'level_downgrade_publish', typeName: up1.type, level: lv(up1), prevLevel: cur.level };
    return { templateId: 'publish', typeName: up1.type, level: lv(up1) };
}

function templateOf(unit, before, after, parentNow, parentChanged) {
    const isChild = !!(after || before) && (after || before).parent !== unit;
    const timeTp = (base, extra) => (isChild ? (parentChanged ? null : Object.assign({ templateId: 'child_' + base.templateId }, extra)) : Object.assign({}, base, extra));
    const lv = (z) => (z.level === '발표' || z.level === '예비' ? '주의보' : z.level);
    // 발표(발효 전)
    if (after && after.kind === 'pending' && before && before.kind === 'yebi' && before.type === after.type) {
        const tp = { templateId: 'time_ef_change', typeName: after.type, level: lv(after) };
        return isChild ? (parentChanged ? null : Object.assign(tp, { templateId: 'child_time_ef_change' })) : tp;
    }
    if (after && after.kind === 'pending' && (!before || before.kind !== 'pending')) return { templateId: 'publish', typeName: after.type, level: lv(after) };
    if (before && before.kind === 'pending' && after && after.kind === 'formal') return { templateId: 'active', typeName: after.type, level: after.level };
    if (before && before.kind === 'pending' && !after) return { templateId: 'release', typeName: before.type, level: lv(before) };
    if (before && before.kind === 'pending' && after && after.kind === 'pending') return before.tmEf !== after.tmEf ? timeTp({ templateId: 'time_ef_change' }, { typeName: after.type, level: lv(after) }) : null;
    const LV = { 주의보: 1, 경보: 2 };
    if (!before && after) {
        if (after.kind === 'yebi') return { templateId: isChild && parentNow ? 'child_prelim' : 'publish', typeName: after.type, level: '주의보' };
        return { templateId: isChild && parentNow && parentNow.kind === 'formal' ? 'additional_active' : 'active', typeName: after.type, level: after.level };
    }
    if (before && !after) {
        if (before.kind === 'yebi') return { templateId: 'prelim_cancel', typeName: before.type, level: '주의보' };
        return { templateId: isChild && parentNow && parentNow.kind === 'formal' ? 'partial_release' : 'release', typeName: before.type, level: before.level };
    }
    if (before.kind === 'yebi' && after.kind === 'formal') return { templateId: 'active', typeName: after.type, level: after.level };
    if (before.kind === 'formal' && after.kind === 'yebi') return { templateId: 'release', typeName: before.type, level: before.level };
    if (before.kind === 'yebi') {
        if (winKey(before.tmEf) === winKey(after.tmEf)) return null;
        const o = winEnd(before.tmEf), n = winEnd(after.tmEf);
        if (before.type === after.type && o != null && n != null && n > o) return isChild && parentChanged ? null : { templateId: 'ef_extend', typeName: after.type, level: '주의보', oldTime: before.tmEf, newTime: after.tmEf };   // 부모도 같이 바뀌면 부모 푸시가 맡는다(적대검증 #4)
        return timeTp({ templateId: 'time_ef_change' }, { typeName: after.type, level: '주의보' });
    }
    if (before.type !== after.type) return { templateId: after.type === '태풍' ? 'type_upgrade_active' : 'type_downgrade_active', typeName: after.type, level: after.level, prevTypeName: before.type, prevLevel: before.level };
    if (before.level !== after.level) return { templateId: (LV[after.level] || 0) > (LV[before.level] || 0) ? 'level_upgrade_active' : 'level_downgrade_active', typeName: after.type, level: after.level, prevLevel: before.level };
    if (clrKey(before.clr) !== clrKey(after.clr)) {
        const o = clrEnd(before.clr), n = clrEnd(after.clr);
        if (o != null && n != null && n > o) return isChild && parentChanged ? null : { templateId: 'yn_extend', typeName: after.type, level: after.level, oldTime: before.clr, newTime: after.clr };
        return timeTp({ templateId: 'time_yn_change' }, { typeName: after.type, level: after.level });
    }
    return null;
}

/**
 * 비교 기록기를 만든다. 검사에서는 읽는 곳(통보문 기준·MMIS·푸시 기록)·시계·저장 위치를 바꿔 끼운다.
 * @param {{getBulletin?: function(): object|null, getMmis?: function(): object|null, getMmisAt?: function(): string, getPushes?: function(): Array, now?: function(): number, dir?: string}} o
 *   getMmisAt = MMIS 자료를 마지막으로 쓴 시각(weather_alerts.json updatedAt) — 팝업 「근거 자료」 칸
 * @returns {{run: function(): object, readDay: function(string): Array, days: function(): string[], latestDiff: function(): object|null}}
 * [연계] ← module.exports · test_bulletin_compare
 */
function createCompare({
    getBulletin = () => require('./bulletin_status').read(),
    getMmis = () => { try { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')).current; } catch (_) { return null; } },
    getMmisAt = () => { try { return String(JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')).updatedAt || ''); } catch (_) { return ''; } },
    getPushes = () => { try { const h = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); return Array.isArray(h) ? h : (h.history || []); } catch (_) { return []; } },
    now = () => Date.now(), dir = DIR,
} = {}) {
    const stateFile = path.join(dir, 'state.json');
    let st = null;
    const load = () => { if (st) return; try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { st = null; } };
    const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st)); fs.renameSync(stateFile + '.tmp', stateFile); };
    const log = (ev) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, dayOf(ev.atMs) + '.jsonl'), JSON.stringify(Object.assign({ at: KST(ev.atMs) }, ev)) + '\n'); };

    function run() {
        load();
        const t = now();
        const b = getBulletin(), mTree = getMmis();
        if (!b || !b.zones || !mTree) return { skipped: true, why: !b ? '통보문 기준 없음' : 'MMIS 없음' };
        const B = pendingOf(b.zones, t), M = flattenTree(mTree);
        const pushes = getPushes().filter((p) => p && p.type === 'auto');
        const stat = { events: 0 };
        const emit = (ev) => { log(Object.assign({ atMs: t }, ev)); stat.events++; };
        if (!st) {   // 처음: 지금 상태를 기준으로만 남기고 바뀜·푸시는 세지 않는다
            st = { ver: 2, mmis: M, bulletin: B, lastPushId: Math.max(0, ...pushes.map((p) => +p.id || 0)), mismatch: {}, diff: diffSnapshot(M, B, t, getMmisAt()) };
            emit({ kind: 'baseline', mmis: Object.keys(M).length, bulletin: Object.keys(B).length, 설명: `비교 시작 — MMIS ${Object.keys(M).length}곳 · 통보문 ${Object.keys(B).length}곳에 특보·예비` });
            save(); return stat;
        }
        // 저장본이 「다가오는 특보(up)」를 모르던 판(ver 없음)이면 앞 상태에 지금 up 을 그대로 붙여 둔다 — 배포 순간 up 이 한꺼번에 「새로 나타남」으로 잡혀 가짜 바뀜·푸시가 쏟아지지 않게(2026-11-17)
        if (st.ver !== 2) {
            for (const [side, NOW] of [['mmis', M], ['bulletin', B]]) for (const u of Object.keys(st[side] || {})) { if (NOW[u] && NOW[u].up && sig1(st[side][u]) === sig1(NOW[u])) st[side][u].up = NOW[u].up; }
            st.ver = 2;
        }
        // ① 양쪽 상태 바뀜
        const units = new Set([...Object.keys(st.mmis), ...Object.keys(M), ...Object.keys(st.bulletin), ...Object.keys(B)]);
        const virtual = {};
        for (const u of units) {
            for (const [side, prev, cur] of [['mmis', st.mmis[u], M[u]], ['bulletin', st.bulletin[u], B[u]]]) {
                if (sig(prev) === sig(cur)) continue;
                if (side === 'bulletin' && sig1(prev) === sig1(cur)) continue;   // 다가오는 특보만 바뀜 — 아래 다가오는 특보 줄이 기록한다(두 번 세지 않게, 적대검증 D5)
                emit({ kind: 'change', side, unit: u, before: prev || null, after: cur || null, 설명: `${side === 'mmis' ? 'MMIS' : '통보문'} ${u}: ${word(prev)} → ${word(cur)}` });
                if (side === 'bulletin') {
                    const par = (cur || prev).parent;
                    const tp = templateOf(u, prev, cur, B[par], par !== u && sig(st.bulletin[par]) !== sig(B[par]));
                    if (tp) { const k = [tp.templateId, tp.typeName, tp.level, tp.prevLevel || ''].join('|'); (virtual[k] = virtual[k] || Object.assign({ items: [] }, tp)).items.push({ zones: [u], tmFc: (cur || prev).tmFc, tmEf: (cur || prev).tmEf, tmYn: (cur || prev).clr, oldTime: tp.oldTime, newTime: tp.newTime }); }
                }
            }
            // 통보문 쪽 「다가오는 특보」(up = 다음 정식 · 예비): 나타나거나 바뀌면 앱 UPCOMING_CHANGE 처럼(격상/격하 발표 · 발표 · 발효시각 변경·연장).
            //   사라질 때(정식으로 넘어감·취소)는 앱도 따로 안 보낸다(현재 특보가 있으면 취소 판정을 안 함 — crawler 2497).
            const upP = st.bulletin[u] && st.bulletin[u].up, upC = B[u] && B[u].up;
            if (upC && sig1(upP) !== sig1(upC)) {
                const par = B[u].parent, isChild = par !== u;
                const parUpChanged = isChild && sig1(st.bulletin[par] && st.bulletin[par].up) !== sig1(B[par] && B[par].up);
                emit({ kind: 'change', side: 'bulletin', unit: u, before: upP || null, after: upC, upcoming: true, 설명: `통보문 ${u}: ${word1(B[u])} 중 다가오는 특보 ${word1(upP)} → ${word1(upC)}` });
                const tp = isChild && parUpChanged ? null : upTemplate(B[u], upP, upC, isChild);
                if (tp) { const k = [tp.templateId, tp.typeName, tp.level, tp.prevLevel || '', tp.prevTypeName || ''].join('|'); (virtual[k] = virtual[k] || Object.assign({ items: [] }, tp)).items.push({ zones: [u], tmFc: upC.tmFc, tmEf: upC.tmEf, tmYn: upC.clr, oldTime: tp.oldTime, newTime: tp.newTime }); }
            }
            // 두 쪽이 다른 동안(시작·끝)
            const diff = sig(M[u]) !== sig(B[u]);
            if (diff && !st.mismatch[u]) { st.mismatch[u] = t; emit({ kind: 'mismatch_start', unit: u, mmis: M[u] || null, bulletin: B[u] || null, 설명: `${u} 두 쪽이 달라짐 — MMIS ${word(M[u])} / 통보문 ${word(B[u])}` }); }
            else if (!diff && st.mismatch[u]) { const m = Math.round((t - st.mismatch[u]) / 60e3); delete st.mismatch[u]; emit({ kind: 'mismatch_end', unit: u, minutes: m, 설명: `${u} 두 쪽이 다시 같아짐(${m}분 동안 달랐음)` }); }
        }
        // ② 통보문 기준 가상 푸시(보내지 않음 — 같은 분·같은 종류는 한 묶음, 실제와 같은 문구 함수)
        const { generateMessage } = require('./push_helpers');
        for (const v of Object.values(virtual)) {
            // 자식 단독 종류(child_*)는 앱이 「자식 해역 보기」를 켠 사용자에게만 보낸다 — 비교 기록에서는 그 사용자 기준 문구로 남긴다
            const msg = generateMessage(/^child_/.test(v.templateId) ? Object.assign({ showChildZones: true }, v) : v);
            if (!msg.title) continue;
            emit({ kind: 'virtual_push', templateId: v.templateId, title: msg.title, content: msg.body, target: v.items.flatMap((i) => i.zones).join(', '), 설명: `통보문 기준이었다면 이 때 푸시: ${msg.title}` });
        }
        // ③ 실제 MMIS 푸시(보낸 기록 — id 가 보낸 시각 ms)
        for (const p of pushes.filter((p) => (+p.id || 0) > st.lastPushId).sort((a, b) => a.id - b.id)) {
            log({ atMs: Math.floor(+p.id), kind: 'mmis_push', title: p.title, content: p.content, target: p.target, count: p.count, tab: p.tab || '', 설명: `MMIS 기준 실제 푸시: ${p.title} (${p.target})` });
            stat.events++;
            st.lastPushId = Math.max(st.lastPushId, +p.id);
        }
        st.mmis = M; st.bulletin = B; st.diff = diffSnapshot(M, B, t, getMmisAt());   // 지금 다른 곳 표(관리자 메인 팝업)
        save(); prune();
        return stat;
    }
    function prune() {
        const cut = dayOf(now() - KEEP_DAYS * 86400e3);
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) fs.unlinkSync(path.join(dir, f));
    }
    const days = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort();
    const readDay = (d) => { try { return fs.readFileSync(path.join(dir, d + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
    /** 마지막 비교 때 두 쪽이 다른 곳 표(diffSnapshot) — 아직 비교 전이면 null. [연계] → routes/bulletin_watch GET /api/admin/bulletin-status */
    const latestDiff = () => { load(); return (st && st.diff) || null; };
    return { run, readDay, days, latestDiff };
}

/**
 * 비교 보고서(마크다운): 요약 → 푸시 짝 맞추기(MMIS 실제 ↔ 통보문 가상, 같은 해역·6시간 안) → 두 쪽이 달랐던 동안 → 시간순 기록 → 부록(원본).
 * @param {Array<object>} events  @param {string} day
 * @returns {string}
 * [연계] ← routes/bulletin_watch GET /api/admin/bulletin-compare/report.md
 */
function reportMarkdown(events, day) {
    const hm = (s) => String(s).slice(5, 16).replace('T', ' ');
    // 위치기반 경보(📍 — services/location_alert_dispatch)는 MMIS 특보 현황을 동의 기기에 조용히 보내 기기가 자기 위치로 판정하는 별도 기능이라
    //   통보문 쪽에 대응하는 푸시가 없다 → 짝 맞추기에서 빼고 따로 적는다(2026-11-16 사용자 「따로 표시하자」 — 아직 사용자에게 열지 않은 기능)
    //   구분은 푸시 기록의 탭(tab: location·typhoon)으로 — 옛 기록(탭 없음)만 제목으로(적대검증 #5: 「📍 [위치기반] 태풍 반경」이 해상특보 위치기반 칸에, 「🌀 태풍 발생」이 짝 맞추기에 섞였다).
    const isTyp = (e) => e.tab === 'typhoon' || (!e.tab && /🌀|태풍 반경/.test(String(e.title || '')));
    const isLoc = (e) => !isTyp(e) && (e.tab === 'location' || (!e.tab && /\[위치기반\]\s*해상특보/.test(String(e.title || ''))));
    const mp = events.filter((e) => e.kind === 'mmis_push');
    const real = mp.filter((e) => !isLoc(e) && !isTyp(e)), loc = mp.filter(isLoc), typ = mp.filter(isTyp), virt = events.filter((e) => e.kind === 'virtual_push');
    const zonesOf = (e) => String(e.target || '').split(/,\s*/).filter(Boolean);
    const used = new Set(), pairs = [];
    for (const r of real) {
        const rz = zonesOf(r), rt = Date.parse(r.at);
        let best = null;
        virt.forEach((v, i) => { if (used.has(i)) return; const dt = Date.parse(v.at) - rt; if (Math.abs(dt) > 6 * 3600e3) return; if (!zonesOf(v).some((z) => rz.includes(z))) return; if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { i, v, dt }; });
        if (best) used.add(best.i);
        pairs.push({ r, v: best && best.v, dt: best && best.dt });
    }
    const lone = virt.filter((_, i) => !used.has(i));
    const ms = (dt) => { const s = Math.round(Math.abs(dt) / 1000); return `${dt < 0 ? '통보문이 ' : 'MMIS가 '}${Math.floor(s / 60)}분 ${s % 60}초 빠름`; };
    const mis = events.filter((e) => e.kind === 'mismatch_end');
    const open = {}; for (const e of events) { if (e.kind === 'mismatch_start') open[e.unit] = e; if (e.kind === 'mismatch_end') delete open[e.unit]; }
    const out = [
        `# MMIS ↔ 통보문 특보 비교 (${day === 'all' ? '전체' : day})`, '',
        'MMIS 기준(실제 앱)과 방재기상플랫폼 통보문 기준(관찰·계산만)의 해역별 특보 상태와 푸시를 매분 맞대어 남긴 기록입니다. 시각은 KST.',
        '통보문 쪽 푸시는 **보내지 않은 가상 푸시**이며, 실제 푸시와 같은 문구 함수로 만들었습니다. MMIS 의 3분 디바운스 등은 넣지 않았고, 예비 시간창 끝 뒤 10분만 기다립니다.', '',
        '## 요약', '',
        `- 상태 바뀜: MMIS ${events.filter((e) => e.kind === 'change' && e.side === 'mmis').length}번 · 통보문 ${events.filter((e) => e.kind === 'change' && e.side === 'bulletin').length}번`,
        `- 푸시: MMIS 실제 ${real.length}건 · 통보문 가상 ${virt.length}건 · 짝이 맞은 것 ${pairs.filter((p) => p.v).length}건 · MMIS 만 ${pairs.filter((p) => !p.v).length}건 · 통보문만 ${lone.length}건`,
        `- 위치기반 경보(MMIS, 짝 맞추기에서 뺌): ${loc.length}건 — 아래 「위치기반 경보」 · 태풍 알림(짝 맞추기에서 뺌): ${typ.length}건`,
        `- 두 쪽 상태가 달랐다가 같아진 일: ${mis.length}번${mis.length ? ` (길이 중앙 ${mis.map((e) => e.minutes).sort((a, b) => a - b)[Math.floor(mis.length / 2)]}분)` : ''} · 지금도 다른 해역: ${Object.keys(open).length}곳`, '',
        '## 푸시 짝 맞추기 (같은 해역 · 6시간 안 가장 가까운 것)', '',
        '| MMIS 실제 | 통보문 가상 | 시간 차이 |', '|---|---|---|',
        ...pairs.map((p) => `| ${hm(p.r.at)} ${p.r.title} — ${p.r.target} | ${p.v ? `${hm(p.v.at)} ${p.v.title} — ${p.v.target}` : '(없음)'} | ${p.v ? ms(p.dt) : '—'} |`),
        ...lone.map((v) => `| (없음) | ${hm(v.at)} ${v.title} — ${v.target} | — |`), '',
        '## 위치기반 경보 (MMIS — 짝 맞추기에서 뺌)', '',
        'MMIS 특보가 바뀔 때 위치기반에 동의한 기기에 지금 특보 현황을 조용한 신호로 보내고, 기기가 자기 위치로 판정해 경고를 띄우는 별도 기능입니다(services/location_alert_dispatch). 통보문 쪽에는 대응하는 푸시가 없고, 아직 사용자에게 열지 않은 기능입니다.', '',
        ...(loc.length ? loc.map((e) => `- ${hm(e.at)} ${e.content || e.title}${e.count != null ? ` (기기 ${e.count}대)` : ''}`) : ['- 없음']), '',
        '## 태풍 알림 (MMIS — 짝 맞추기에서 뺌)', '',
        '태풍 발생·소멸, 태풍 반경 위치기반 신호 등 태풍 기능의 알림입니다. 해상 특보 통보문 비교 대상이 아니라 따로 적습니다.', '',
        ...(typ.length ? typ.map((e) => `- ${hm(e.at)} ${e.title}${e.content ? ' — ' + String(e.content).replace(/\n/g, ' / ').slice(0, 120) : ''}`) : ['- 없음']), '',
        '## 두 쪽이 달랐던 동안', '',
        ...mis.map((e) => `- ${hm(e.at)}까지 ${e.unit}: ${e.minutes}분`),
        ...Object.values(open).map((e) => `- ${hm(e.at)}부터 지금까지 ${e.unit}: MMIS ${word(e.mmis)} / 통보문 ${word(e.bulletin)}`), '',
        '## 시간순 기록 (쉬운 설명)', '',
        ...events.map((e) => `- ${hm(e.at)} ${e.설명 || e.kind}${e.kind === 'mmis_push' || e.kind === 'virtual_push' ? `\n  > ${String(e.content || '').replace(/\n/g, ' / ')}` : ''}`), '',
        '## 부록: 원본 기록(한 줄 = 한 사건, JSON)', '', '```jsonl', ...events.map((e) => JSON.stringify(e)), '```', '',
    ];
    return out.join('\n');
}

let real = null;
const getReal = () => (real = real || createCompare());
module.exports = { upTemplate, run: () => getReal().run(), days: () => getReal().days(), readDay: (d) => getReal().readDay(d), latestDiff: () => getReal().latestDiff(), createCompare, flattenTree, templateOf, reportMarkdown, sig, pendingOf, winKey, clrKey, diffSnapshot, whyOf, mmisHm };
