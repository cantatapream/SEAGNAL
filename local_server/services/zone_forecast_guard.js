/**
 * ============================================================================
 * 파일명: local_server/services/zone_forecast_guard.js
 * 역할  : 해구별 기상예보(기상청 API허브 marine_large_zone.php) 수집이 찾은 판(baseTmUtf)을
 *         지금 가진 판과 비교해 「새 판 / 같은 판 / 더 오래된 판 / 판 없음」을 가르고,
 *         그 결과를 data/zone_forecasts_status.json 에 한 줄 기록한다.
 *         더 오래된 판으로 지금 판을 덮어쓰지 않게 하는 것이 목적이다(2026-10-15 사용자 지시 ⓑ).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(fs 만)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : scheduler.js collectZoneForecasts(판 찾은 직후 decide → 저장 여부 결정 · record ·
 *                    30분마다 새 판 확인 때 pollCandidates — 기상청 「생성에 6시간 이상 걸릴 수 있다」 2026-10-16)
 *                    services/data_collection_status.js(관리자 「데이터 수집현황」이 상태 파일을 읽음)
 * [로드 순서] require 부작용 없음(파일을 읽고 쓰는 것은 함수 호출 때만).
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path');

const STATUS_NAME = 'zone_forecasts_status.json';

/**
 * 판 문자열(UTC YYYYMMDDHH 10자리)을 비교해 결과를 정한다.
 * 예: decide('2026101512', '2026101500') → 'older' (덮어쓰지 않는다)
 *     decide('2026101500', '2026101512') → 'new' · 같으면 'same' · 찾은 판 없음 → 'none'
 * @param {string|null} stored - 지금 파일에 든 판(baseTmUtf) 또는 null
 * @param {string|null} found  - 이번 수집이 찾은 판 또는 null
 * @returns {'new'|'same'|'older'|'none'}
 * [연계] ← scheduler.js collectZoneForecasts — 'older' 면 내려받기·저장을 하지 않기 위해 부른다
 */
function decide(stored, found) {
    const ok = (s) => typeof s === 'string' && /^\d{10}$/.test(s);
    if (!ok(found)) return 'none';
    if (!ok(stored)) return 'new';
    if (found > stored) return 'new';
    return found === stored ? 'same' : 'older';
}

/**
 * 지금 파일에 든 판을 읽는다. 파일이 없거나 깨졌으면 null.
 * 예: storedBase('/data') → '2026101500'
 * @param {string} dataDir - zone_forecasts.json 이 있는 폴더
 * @returns {string|null}
 * [연계] ← scheduler.js collectZoneForecasts — decide 의 비교 대상을 얻기 위해 부른다
 */
function storedBase(dataDir) {
    try {
        const d = JSON.parse(
            fs.readFileSync(path.join(dataDir, 'zone_forecasts.json'), 'utf8')
        );
        return typeof d?.baseTmUtf === 'string' ? d.baseTmUtf : null;
    } catch (_) {
        return null;
    }
}

/** 결과별 관리자용 한 줄. 예: kept → '새 판 없음 — 받은 판 2026101500 이 가진 판 2026101512 보다 오래되어 덮어쓰지 않음'. */
function messageOf(result, stored, found, expected) {
    const late =
        expected && found !== expected ? ' · 예정 판 ' + expected + ' 미게시' : '';
    if (result === 'new') return '새 판 ' + found + ' 저장' + late;
    if (result === 'same')
        return '새 판 없음, 기존 판 유지 — 같은 판 ' + found + ' 를 다시 받음' + late;
    if (result === 'older')
        return (
            '새 판 없음, 기존 판 유지 — 받은 판 ' + found + ' 이 가진 판 ' + stored +
            ' 보다 오래되어 덮어쓰지 않음' + late
        );
    if (result === 'empty') return '판 ' + found + ' 을 찾았으나 받은 줄이 없어 저장하지 않음(기존 판 유지)';
    if (result === 'waiting')
        return '새 판 ' + expected + ' 아직 미게시 — 기존 판 ' + stored + ' 유지(30분마다 다시 확인)';
    if (result === 'partial')
        return '새 판 ' + found + ' 이 아직 덜 올라옴(일부 시각 없음) — 저장하지 않고 기존 판 ' + stored + ' 유지(30분마다 다시 확인)';
    return '판을 찾지 못함(최근 4판 모두 응답 없음) — 기존 판 유지';
}

/**
 * 「새 판 확인」(30분마다)이 물어볼 판 목록 — 가진 판보다 새 판만, 최신부터 12시간씩 거슬러 최대 4개.
 *   기상청 API허브 답변(2026-10-16): 「생성하는데 6시간 이상이 소요될 수 있습니다」 — 그래서 정해진 두 회차만으로는
 *   새 판을 놓친다. 가진 판이 이미 최신이면 빈 목록(기상청에 묻지 않는다).
 * 예: pollCandidates('2026101512', '2026101612') → ['2026101612', '2026101600'] · pollCandidates('2026101612', '2026101612') → []
 * @param {string|null} stored - 가진 판(UTC YYYYMMDDHH) @param {string} latest - 지금 시각 기준 가장 최근 판(00·12 UTC)
 * @returns {string[]}
 * [연계] ← scheduler.js collectZoneForecasts({poll:true})
 */
function pollCandidates(stored, latest) {
    const ok = (s) => typeof s === 'string' && /^\d{10}$/.test(s);
    if (!ok(latest)) return [];
    const base = Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8), +latest.slice(8, 10)),
        out = [];
    for (let i = 0; i < 4; i++) {
        const tm = new Date(base - i * 12 * 3600000).toISOString().replace(/[-T:]/g, '').slice(0, 10);
        if (ok(stored) && tm <= stored) break;
        out.push(tm);
    }
    return out;
}

/** 판 문자열(UTC YYYYMMDDHH)을 ms 로. 예: '2026101612' → 2026-10-16T12:00Z. 이상하면 NaN. */
function baseMs(tm) {
    return typeof tm === 'string' && /^\d{10}$/.test(tm)
        ? Date.UTC(+tm.slice(0, 4), +tm.slice(4, 6) - 1, +tm.slice(6, 8), +tm.slice(8, 10))
        : NaN;
}

/**
 * 수집 결과를 상태 파일에 원자적으로 쓴다(덮어쓰기, 한 건만 보관).
 * 예: record('/data', {result:'older', stored:'2026101512', found:'2026101500', expected:'2026101512'}, Date.now())
 * @param {string} dataDir
 * @param {{result:string, stored:string|null, found:string|null, expected:string|null}} r
 * @param {number} now - ms
 * @returns {object|null} 기록한 객체(실패하면 null — 수집 자체는 막지 않는다)
 * [연계] ← scheduler.js collectZoneForecasts / → services/data_collection_status.js 가 읽어 「상세」에 띄운다
 */
function record(dataDir, r, now = Date.now()) {
    const out = {
        lastRun: new Date(now + 9 * 3600000).toISOString().slice(0, 19) + '+09:00',
        result: r.result,
        storedBaseTmUtf: r.stored || null,
        foundBaseTmUtf: r.found || null,
        expectedBaseTmUtf: r.expected || null,
        message: messageOf(r.result, r.stored, r.found, r.expected),
    };
    const file = path.join(dataDir, STATUS_NAME),
        tmp = file + '.' + process.pid + '.tmp';
    // 새 판을 처음 확인한 때가 판 시각 뒤 몇 분이었나 — 게시 지연을 재서 관리자 「자료 오래됨」 기준을 정하기 위한 기록(최근 14개).
    //   30분마다 확인하므로 실제 게시 시각보다 최대 30분 늦게 잡힌다(그보다 이르게 잡히지는 않는다).
    let recent = [];
    try {
        const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(prev.recentNew)) recent = prev.recentNew;
    } catch (_) { /* 상태 파일이 없거나 깨졌으면 새로 시작한다 */ }
    const base = baseMs(r.found);
    if (r.result === 'new' && Number.isFinite(base) && !recent.some((x) => x.base === r.found)) {
        const delayMinutes = Math.round((now - base) / 60000);
        recent = recent.concat({ base: r.found, foundAt: out.lastRun, delayMinutes }).slice(-14);
        out.message += ' · 판 시각 뒤 ' + Math.floor(delayMinutes / 60) + '시간 ' + (delayMinutes % 60) + '분에 확인';
    }
    out.recentNew = recent;
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(out));
        fs.renameSync(tmp, file);
        return out;
    } catch (_) {
        try { fs.unlinkSync(tmp); } catch (e) { /* 임시 파일이 없으면 정리할 것도 없다 */ }
        return null;
    }
}

module.exports = { decide, storedBase, record, pollCandidates, STATUS_NAME };
