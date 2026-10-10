/**
 * ============================================================================
 * 파일명: services/gale_warning_store.js
 * 역할: 기상청 MMIS 특보 응답에서 **강풍(W) 행만** 골라 별도 파일에 저장한다.
 *       해안 안전 예보의 연안 위험분석이 강풍특보를 MMIS 에서 쓰기로 했기 때문이다
 *       (설계서 `client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` U5·§3.3·M10).
 *       기존 특보 수집·푸시 흐름(풍랑·태풍)은 건드리지 않는다 — 크롤러가 이미 받은 응답을 읽기만 한다.
 *       강풍 푸시는 보내지 않는다(U5 "강풍 푸시는 나가지 않도록 할 거야").
 *
 * [연계]
 *   - 호출처   : marine_warning_crawler.js run() — endpoint 4종(warn/list·warn-sasc/list·warn/ready·
 *                warn-sasc/ready) fetch 직후. 여기서 예외가 나도 크롤러는 그대로 진행한다(호출부 try/catch).
 *   - 저장     : data/gale_warnings.json      — 지금 떠 있는 강풍 행 전부(바뀔 때만 덮어씀)
 *                data/gale_warnings_log.jsonl — 처음 나타난 강풍 행을 한 줄씩 덧붙임(구역 이름 맞추기 확인용, M10).
 *                  모양이 예상과 다른 W 행(수준 이름·시각이 없는 행)도 live:false 와 원본(raw)째 남긴다 —
 *                  "강풍이 왔는데 모양이 달라 버려졌다"를 "안 왔다"로 오판하지 않으려고.
 *   - 적대검증 : 2026-10-10 독립 리뷰 반영 — 빈 응답 글리치 한 번에 0행으로 덮지 않음 · 기록 중복 방지 열쇠를
 *                24시간 기억 · 행 순서를 정렬해 순서만 바뀐 응답에 다시 쓰지 않음 · 판정 기준을 크롤러 _isLiveRow 와 같게
 *   - 읽는 곳  : (구현 예정) 해양안전 탭 「연안 위험분석」
 *   - 검사     : scripts/test_gale_store.js
 *
 * [로드 순서] 서버 모듈 — require 시점 부작용 없음(파일은 save() 를 부를 때만 쓴다).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data');
const SOURCES = ['warnList', 'warnSascList', 'warnReady', 'warnSascReady'];

/** 크롤러 _isLiveRow 와 같은 기준 — 수준 이름이 있고, 발표·발효 시각 중 하나가 있어야 실제 특보 행. */
function isLiveRow(r) {
    return !!(r && r.warn_lvl_nm && (r.tm_fc || r.tm_ef || r.st_tm));
}

/**
 * 응답 4종에서 강풍(W) 행을 모두 뽑아 필요한 칸만 남긴다(실제 특보 행이 아니면 live:false + 원본).
 * 예: { warnList: [{ warn_tp:'W', warn_lvl_nm:'주의보', warn_zone_cd:'L1090500', tm_fc:'…' }, { warn_tp:'V', … }] }
 *     → [{ src:'warnList', live:true, zoneCd:'L1090500', lvl:'주의보', … }]
 * @param {Object} fetched — marine_client.fetchAllRealtimeEndpoints() 결과
 * @returns {Array<Object>} 강풍 행(열쇠 순으로 정렬)
 * [연계] live 판정은 marine_warning_crawler.js _isLiveRow 와 같은 기준.
 */
function pickGaleRows(fetched) {
    const out = [];
    for (const src of SOURCES) {
        const rows = (fetched && Array.isArray(fetched[src])) ? fetched[src] : [];
        for (const r of rows) {
            if (!r || String(r.warn_tp || '').toUpperCase() !== 'W') continue;
            const live = isLiveRow(r);
            const row = {
                src,
                live,
                zoneCd: String(r.warn_zone_cd || ''),
                zoneNm: String(r.warn_zone_nm || r.kor_nm || '').trim(),
                lvl: String(r.warn_lvl_nm),
                tmFc: String(r.tm_fc || ''),
                tmEf: String(r.tm_ef || r.st_tm || ''),
                tmEd: String(r.tm_yn || r.ed_tm || ''),
                clrNtcTm: String(r.clr_ntc_tm || '')
            };
            if (!live) row.raw = r;
            out.push(row);
        }
    }
    return out.sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
}

/** 같은 행인지 가르는 열쇠 — 출처·구역·수준·발표·발효 시각이 같으면 같은 행. */
function rowKey(r) {
    return [r.src, r.live ? 1 : 0, r.zoneCd, r.zoneNm, r.lvl, r.tmFc, r.tmEf].join('|');
}

// 기록 중복 방지 열쇠를 24시간 기억한다 — 없으면 MMIS 빈 응답 글리치(2026-09-07 실측) 한 번마다
// 떠 있던 행 전부가 기록에 다시 들어간다(독립 리뷰 지적 C). 24시간보다 오래 안 보인 행은 다시 기록한다.
const SEEN_TTL_MS = 24 * 3600 * 1000;
let _seen = new Map();     // 행 열쇠 → 마지막으로 본 시각(ms)
let _prevLatest = null;    // 직전에 쓴 최신 파일 내용(같으면 다시 쓰지 않는다)
let _emptyStreak = 0;      // 강풍 행이 0개로 온 연속 주기 수

/**
 * 강풍 행을 파일로 남긴다.
 * 예: save(fetched) → { count: 2, wrote: true, appended: 2 }
 * @param {Object} fetched — 크롤러가 받은 응답 4종
 * @param {Object} [opts] — { dir: 저장 폴더(검사용), now: Date(검사용) }
 * @returns {{count:number, wrote:boolean, appended:number}}
 * [연계] marine_warning_crawler.js run() 이 매 주기(약 1분) 부른다. 서버가 다시 켜지면 직전 열쇠를
 *        잊으므로 그때 떠 있던 행이 기록에 한 번 더 들어갈 수 있다(확인용 기록이라 그대로 둔다).
 */
function save(fetched, opts = {}) {
    const dir = opts.dir || DEFAULT_DIR;
    const now = opts.now || new Date();
    const t = now.getTime();
    const all = pickGaleRows(fetched);
    const rows = all.filter(r => r.live);
    // 빈 응답 글리치 한 번에 "강풍 없음"으로 덮지 않는다 — 두 주기 연속 0개일 때만 0행으로 쓴다(리뷰 지적 C).
    _emptyStreak = rows.length ? 0 : _emptyStreak + 1;
    const latest = JSON.stringify(rows);
    let wrote = false;
    if (latest !== _prevLatest && (rows.length || _emptyStreak >= 2 || _prevLatest === null)) {
        const file = path.join(dir, 'gale_warnings.json');
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ savedAt: now.toISOString(), count: rows.length, rows }, null, 1));
        fs.renameSync(tmp, file);
        _prevLatest = latest;
        wrote = true;
    }
    for (const [k, v] of _seen) if (t - v > SEEN_TTL_MS) _seen.delete(k);
    const fresh = all.filter(r => !_seen.has(rowKey(r)));
    if (fresh.length) {
        const lines = fresh.map(r => JSON.stringify(Object.assign({ seenAt: now.toISOString() }, r))).join('\n') + '\n';
        fs.appendFileSync(path.join(dir, 'gale_warnings_log.jsonl'), lines);
    }
    for (const r of all) _seen.set(rowKey(r), t);
    return { count: rows.length, wrote, appended: fresh.length, odd: all.length - rows.length };
}

/** 검사용 — 모듈 안 기억(본 열쇠·직전 내용·빈 응답 연속)을 비운다. */
function _resetForTest() { _seen = new Map(); _prevLatest = null; _emptyStreak = 0; }

module.exports = { pickGaleRows, save, isLiveRow, _resetForTest };
