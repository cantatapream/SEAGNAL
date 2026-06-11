/**
 * ============================================================================
 * advisory/demoScenarios.js — "특보 예측 시연" 목업 시나리오 + 상태 파일 헬퍼
 * ============================================================================
 *
 * 통합관리자센터의 "특보 예측 시연" 탭이 사용하는 상황별 목업 데이터와,
 * 시연 on/off · 표출중 시나리오를 디스크에 보관하는 헬퍼를 한곳에 모았다.
 *
 * - SCENARIOS: id → { title, desc, payload }  (payload = /api/advisory-prediction 응답 형태)
 * - 상태 파일(데이터 디렉토리):
 *     advisory_demo_testmode.json  { enabled, updatedAt }
 *     advisory_demo_active.json    { scenarioId, updatedAt }   (없으면 표출 없음)
 *
 * 관리자 제어(routes/admin.js, 인증)와 기기 폴링(routes/advisoryDemo.js, 공개)이
 * 같은 파일/시나리오를 공유한다. 모든 입출력은 graceful(실패 흡수).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

let DATA_DIR;
try { ({ DATA_DIR } = require('../config/server_config')); } catch (_) { DATA_DIR = null; }
if (!DATA_DIR) DATA_DIR = path.resolve(__dirname, '..', 'data');

const TESTMODE_FILE = path.join(DATA_DIR, 'advisory_demo_testmode.json');
const ACTIVE_FILE = path.join(DATA_DIR, 'advisory_demo_active.json');

// ── 목업 페이로드 빌더 ────────────────────────────────────────────────────────
const HIGH = { key: 'high', label: '높음', emoji: '🔴' };
const WATCH = { key: 'watch', label: '관심', emoji: '🟡' };
const BASE = '2026061021';

function pred(zone, grade, probPct, windKt, waveM, onsetLabel, kma) {
    const windMs = Math.round(windKt * 0.514444);
    const p = {
        office: 'demo', zone, lat: 33, lon: 126,
        grade, probPct, windKt, windMs, waveM,
        onsetISO: '2026-06-13T12:00:00.000Z', onsetLabel,
        narrative: `${zone} 일기도를 분석한 결과, ${onsetLabel}경 풍속이 ~${windKt}kt(${windMs}m/s), ` +
            `파고 ~${waveM}m 로 예상됩니다. 과거 유사 패턴 기준 발효 가능성 ${probPct}%(${grade.emoji}${grade.label}).`,
    };
    if (kma) p.kmaForecast = kma;
    return p;
}
function payload(active, resolved) {
    let high = 0, watch = 0;
    (active || []).forEach((a) => { if (a.grade.key === 'high') high++; else if (a.grade.key === 'watch') watch++; });
    return {
        generatedAt: new Date().toISOString(),
        baseTimeKST: BASE,
        active: active || [],
        resolved: resolved || [],
        counts: { high, watch, resolved: (resolved || []).length },
        filtered: false,
        _demo: true,
    };
}

// ── 상황별 시나리오 ───────────────────────────────────────────────────────────
const SCENARIOS = {
    high_single: {
        title: '🔴 높음 1건 (기상청 병기 일치)',
        desc: '제주도남쪽바깥먼바다 80% · 풍속~30kt, 기상청 단기예보 병기 표시',
        payload: payload([
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                { windSpeed: '13~17', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후', publishTime: BASE }),
        ], []),
    },
    watch_single: {
        title: '🟡 관심 1건',
        desc: '서해남부남쪽바깥먼바다 63% · 풍속~25kt',
        payload: payload([
            pred('서해남부남쪽바깥먼바다', WATCH, 63, 25, 2, '6/13(토) 새벽',
                { windSpeed: '10~14', waveHeight: '1.5~2.5', periodLabel: '6/13(토) 오전', publishTime: BASE }),
        ], []),
    },
    mixed: {
        title: '🔴🟡 복합 (높음 2 + 관심 2)',
        desc: '여러 해역 동시 표출 + 정렬(높음 우선) 확인',
        payload: payload([
            pred('서해남부남쪽안쪽먼바다', HIGH, 95, 15, 6, '6/12(금) 새벽',
                { windSpeed: '12~16', waveHeight: '5.0~6.0', periodLabel: '6/12(금) 오전', publishTime: BASE }),
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                { windSpeed: '13~17', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후', publishTime: BASE }),
            pred('동해북부앞바다', WATCH, 63, 25, 2.5, '6/13(토) 새벽', null),
            pred('제주도남부앞바다', WATCH, 63, 25, 2, '6/14(일) 오후',
                { windSpeed: '9~13', waveHeight: '1.5~2.0', periodLabel: '6/14(일) 오후', publishTime: BASE }),
        ], []),
    },
    with_resolved: {
        title: '✓ 활성 1 + 최근 해소 1',
        desc: '활성 예측과 "최근 해소" 서브섹션 동시 표출',
        payload: payload([
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                { windSpeed: '13~17', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후', publishTime: BASE }),
        ], [
            {
                zone: '제주도남서쪽안쪽먼바다', office: 'demo', reason: 'forecast_eased',
                onsetISO: '2026-06-12T00:00:00.000Z', resolvedAt: new Date().toISOString(),
                before: { windKt: 30, waveM: 3.5, probPct: 65 }, after: { windKt: 18, waveM: 1.5, probPct: 20 },
                narrative: '제주도남서쪽안쪽먼바다 예보 호전 — 발효 가능성 낮아짐 (풍속 ~30kt→~18kt, 파고 ~3.5m→~1.5m, 가능성 65%→20%)',
            },
        ]),
    },
    no_kma: {
        title: '🟡 관심 1건 (기상청 병기 없음)',
        desc: '해당 해역·시간대 기상청 예보 없음 → 병기 줄 숨김 확인',
        payload: payload([
            pred('서해남부남쪽바깥먼바다', WATCH, 63, 25, 2, '6/13(토) 새벽', null),
        ], []),
    },
    empty: {
        title: '— 빈 상태',
        desc: '"현재 예측된 특보가 없습니다" 표출 확인',
        payload: payload([], []),
    },
};

// ── 상태 파일 헬퍼 (graceful) ─────────────────────────────────────────────────
function readJson(file) {
    try {
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, 'utf8');
        return raw && raw.trim() ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}
function writeJson(file, obj) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
        return true;
    } catch (_) { return false; }
}

function isTestMode() {
    const d = readJson(TESTMODE_FILE);
    return !!(d && d.enabled);
}
function setTestMode(enabled) {
    writeJson(TESTMODE_FILE, { enabled: !!enabled, updatedAt: new Date().toISOString() });
    if (!enabled) clearActive(); // OFF 시 표출중 시연도 정리
    return !!enabled;
}
function getActiveId() {
    const d = readJson(ACTIVE_FILE);
    return d && typeof d.scenarioId === 'string' ? d.scenarioId : null;
}
function setActive(scenarioId) {
    if (!SCENARIOS[scenarioId]) return false;
    return writeJson(ACTIVE_FILE, { scenarioId, updatedAt: new Date().toISOString() });
}
function clearActive() {
    return writeJson(ACTIVE_FILE, { scenarioId: null, updatedAt: new Date().toISOString() });
}

/**
 * 기기 폴링 응답: { testMode, scenarioId, payload }.
 *   - 테스트모드 OFF 또는 표출중 시나리오 없음 → payload:null (기기는 실제 예측 표시).
 */
function pollState() {
    const testMode = isTestMode();
    const scenarioId = testMode ? getActiveId() : null;
    const sc = scenarioId ? SCENARIOS[scenarioId] : null;
    return {
        testMode,
        scenarioId: sc ? scenarioId : null,
        payload: sc ? sc.payload : null,
    };
}

function listScenarios() {
    return Object.keys(SCENARIOS).map((id) => ({ id, title: SCENARIOS[id].title, desc: SCENARIOS[id].desc }));
}

module.exports = {
    SCENARIOS, TESTMODE_FILE, ACTIVE_FILE,
    isTestMode, setTestMode, getActiveId, setActive, clearActive,
    pollState, listScenarios,
};
