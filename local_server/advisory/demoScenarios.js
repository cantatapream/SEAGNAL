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

// 실제 엔진(predictionEngine.js)이 만드는 오버레이 URL 규칙과 동일하게 목업 경로 생성.
//   base: /uploads/advisory/<zone>.png  ·  blink: /uploads/advisory/<zone>_danger.png
const OVERLAY_URL_BASE = '/uploads/advisory';
function overlayUrls(zone) {
    const enc = encodeURIComponent(zone);
    return { overlay: `${OVERLAY_URL_BASE}/${enc}.png`, overlayBlink: `${OVERLAY_URL_BASE}/${enc}_danger.png` };
}

// 기상청 단기전망 병기(kmaForecast) — 실제 crossReference.js 산출 형태와 1:1.
//   { windSpeed, windKtMs, waveHeight, periodLabel, office, publishTime, publishLabel, outlook }
function kmaRef({ windKtMs, waveHeight, periodLabel, office, outlook }) {
    return {
        windSpeed: null,
        windKtMs: windKtMs || null,
        waveHeight: waveHeight || null,
        periodLabel: periodLabel || null,
        office: office || null,
        publishTime: BASE,
        publishLabel: `${BASE.slice(4, 6)}/${BASE.slice(6, 8)} ${BASE.slice(8, 10)}:00 발표`,
        outlook: outlook || null,
    };
}

function pred(zone, grade, probPct, windKt, waveM, onsetLabel, kma) {
    const windMs = Math.round(windKt * 0.514444);
    const ovl = overlayUrls(zone);
    const p = {
        office: 'demo', zone, lat: 33, lon: 126,
        grade, probPct, windKt, windMs, waveM,
        onsetISO: '2026-06-13T12:00:00.000Z', onsetLabel,
        // 실제 카드와 동일하게 "위험기상 일기도 보기" 버튼이 뜨도록 오버레이 경로 부착
        overlay: ovl.overlay, overlayBlink: ovl.overlayBlink,
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
        desc: '제주도남쪽바깥먼바다 80% · 풍속~30kt, 기상청 단기예보 병기 + 일기도 보기',
        payload: payload([
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                kmaRef({ windKtMs: '25~33kt(13~17m/s)', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후',
                    office: '제주지방기상청', outlook: '저기압의 영향으로 바람이 강하게 불고 물결이 높게 일겠음.' })),
        ], []),
    },
    watch_single: {
        title: '🟡 관심 1건',
        desc: '서해남부남쪽바깥먼바다 63% · 풍속~25kt',
        payload: payload([
            pred('서해남부남쪽바깥먼바다', WATCH, 63, 25, 2, '6/13(토) 새벽',
                kmaRef({ windKtMs: '19~27kt(10~14m/s)', waveHeight: '1.5~2.5', periodLabel: '6/13(토) 오전',
                    office: '광주지방기상청', outlook: '기압골의 영향으로 바람이 다소 강하게 불겠음.' })),
        ], []),
    },
    mixed: {
        title: '🔴🟡 복합 (높음 2 + 관심 2)',
        desc: '여러 해역 동시 표출 + 정렬(높음 우선) 확인',
        payload: payload([
            pred('서해남부남쪽안쪽먼바다', HIGH, 95, 15, 6, '6/12(금) 새벽',
                kmaRef({ windKtMs: '23~31kt(12~16m/s)', waveHeight: '5.0~6.0', periodLabel: '6/12(금) 오전',
                    office: '광주지방기상청', outlook: '발달한 저기압의 영향으로 물결이 매우 높게 일겠음.' })),
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                kmaRef({ windKtMs: '25~33kt(13~17m/s)', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후',
                    office: '제주지방기상청', outlook: '저기압의 영향으로 바람이 강하게 불고 물결이 높게 일겠음.' })),
            pred('동해북부앞바다', WATCH, 63, 25, 2.5, '6/13(토) 새벽', null),
            pred('제주도남부앞바다', WATCH, 63, 25, 2, '6/14(일) 오후',
                kmaRef({ windKtMs: '17~25kt(9~13m/s)', waveHeight: '1.5~2.0', periodLabel: '6/14(일) 오후',
                    office: '제주지방기상청', outlook: '바람이 다소 강하게 불겠음.' })),
        ], []),
    },
    with_resolved: {
        title: '✓ 활성 1 + 최근 해소 1',
        desc: '활성 예측과 "최근 해소" 서브섹션 동시 표출',
        payload: payload([
            pred('제주도남쪽바깥먼바다', HIGH, 80, 30, 2.5, '6/13(토) 밤',
                kmaRef({ windKtMs: '25~33kt(13~17m/s)', waveHeight: '2.0~3.0', periodLabel: '6/13(토) 오후',
                    office: '제주지방기상청', outlook: '저기압의 영향으로 바람이 강하게 불고 물결이 높게 일겠음.' })),
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
