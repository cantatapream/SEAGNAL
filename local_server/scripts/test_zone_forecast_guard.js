/**
 * 역할: 해구별 기상예보 수집이 새 판을 못 받았을 때 「새 판 없음, 기존 판 유지」를 기록하고
 *       더 오래된 판으로 지금 판을 덮어쓰지 않는지 검사한다(2026-10-15 사용자 지시 ⓑ).
 * [연계] services/zone_forecast_guard.js(decide·storedBase·record) · scheduler.js collectZoneForecasts(호출 순서는 글자로 확인 —
 *        scheduler.js 는 require 하면 수집이 시작되므로 불러오지 않는다). 외부 API 호출 없음, 임시 폴더만 쓴다.
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_zone_forecast_guard.js · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert');
const G = require('../services/zone_forecast_guard');
let pass = 0,
    fail = 0;
function check(name, fn) {
    try {
        fn();
        pass++;
        console.log('✅', name);
    } catch (e) {
        fail++;
        console.error('❌', name, e.message);
    }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zone-guard-')),
    NOW = Date.parse('2026-10-15T21:31:00+09:00'); // 고정 시각(시각 의존 금지)
try {
    check('판 비교: 새 판 / 같은 판 / 더 오래된 판 / 판 없음', () => {
        assert.equal(G.decide('2026101500', '2026101512'), 'new');
        assert.equal(G.decide('2026101500', '2026101500'), 'same');
        assert.equal(G.decide('2026101512', '2026101500'), 'older');
        assert.equal(G.decide('2026101512', null), 'none');
        assert.equal(G.decide(null, '2026101500'), 'new', '가진 판이 없으면 새 판');
        assert.equal(G.decide('깨짐', '2026101500'), 'new', '가진 판 글자가 이상하면 새 판으로 받는다');
    });
    check('지금 가진 판 읽기: 파일 없음·깨짐은 null', () => {
        assert.equal(G.storedBase(dir), null);
        fs.writeFileSync(path.join(dir, 'zone_forecasts.json'), '{깨진');
        assert.equal(G.storedBase(dir), null);
        fs.writeFileSync(path.join(dir, 'zone_forecasts.json'), JSON.stringify({ updatedAt: 'x', baseTmUtf: '2026101512', data: {} }));
        assert.equal(G.storedBase(dir), '2026101512');
    });
    check('더 오래된 판: 「새 판 없음, 기존 판 유지」 기록 + 덮어쓰지 않음 문구', () => {
        const r = G.record(dir, { result: 'older', stored: '2026101512', found: '2026101500', expected: '2026101512' }, NOW);
        const f = JSON.parse(fs.readFileSync(path.join(dir, G.STATUS_NAME), 'utf8'));
        assert.deepEqual(r, f);
        assert.equal(f.result, 'older');
        assert.equal(f.lastRun, '2026-10-15T21:31:00+09:00');
        assert.ok(/새 판 없음, 기존 판 유지/.test(f.message) && /덮어쓰지 않음/.test(f.message), f.message);
        assert.equal(G.storedBase(dir), '2026101512', '가진 판 파일은 그대로');
    });
    check('같은 판 다시 받음·예정 판 미게시도 기록', () => {
        const f = G.record(dir, { result: 'same', stored: '2026101500', found: '2026101500', expected: '2026101512' }, NOW);
        assert.ok(/새 판 없음, 기존 판 유지/.test(f.message) && /예정 판 2026101512 미게시/.test(f.message), f.message);
        const n = G.record(dir, { result: 'none', stored: '2026101500', found: null, expected: '2026101512' }, NOW);
        assert.ok(/기존 판 유지/.test(n.message), n.message);
        const e = G.record(dir, { result: 'empty', stored: '2026101500', found: '2026101512', expected: '2026101512' }, NOW);
        assert.ok(/저장하지 않음/.test(e.message), e.message);
    });
    check('scheduler.js: 판 비교가 75시간치 내려받기·저장보다 먼저, 오래된 판·판 없음이면 return', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8'),
            fn = src.slice(src.indexOf('async function collectZoneForecasts('), src.indexOf('// 5. 중기해상예보 수집'));
        const decide = fn.indexOf('zoneGuard.decide(storedBaseTm, validBaseTm)'),
            guard = fn.indexOf("if (zoneVerdict === 'older' || zoneVerdict === 'none') {"),
            download = fn.indexOf('for (let h = 0; h <= 75; h += 3)'),
            save = fn.indexOf("saveData('zone_forecasts.json'");
        assert.ok(decide > 0 && guard > decide && download > guard && save > download, [decide, guard, download, save].join(','));
        const block = fn.slice(guard, download);
        assert.ok(/zoneGuard\.record\(/.test(block) && /\breturn;/.test(block), '오래된 판이면 기록하고 끝내야 함');
        assert.ok(!/saveData\(/.test(block), '오래된 판 갈래에서 저장하면 안 됨');
    });
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${pass} PASS / ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
}
