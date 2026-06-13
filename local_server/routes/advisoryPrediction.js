/**
 * ============================================================================
 * 파일명: routes/advisoryPrediction.js
 * 역할: "특보 예측"(advisory prediction) 상태 조회 API 라우트 — 읽기 전용
 * ============================================================================
 *
 * [설명]
 * 스케줄러(advisory/stateManager)가 매 사이클마다 디스크에 써 둔 예측 상태파일
 * (data/advisory_state.json)을 읽어, 클라이언트의 관심해역(favorites)으로
 * 필터링하여 응답하는 읽기 전용 API 입니다.
 *   - GET /api/advisory-prediction?favorites=제주도먼바다,동해북부앞바다
 *
 * [중요] 이 라우트는 예측 엔진(dmdw 크롤링 — 느림)을 요청마다 실행하지 않습니다.
 *        오직 디스크 상태파일만 읽어 가볍게·결정론적으로 필터링해 응답합니다.
 *        상태 없음/깨짐/예외 상황에서도 항상 빈 payload 200 으로 graceful 동작.
 *
 * [상태파일 형태] (advisory/stateManager.js 가 생성/갱신)
 *   { updatedAt, baseTimeKST, active:[prediction...], resolved:[resolvedItem...] }
 *   - prediction.grade : 객체({key,label,emoji}) 또는 문자열('high'/'watch') 둘 다 허용
 *
 * [관심해역 필터]
 *   favorite 부모구역(예: '제주도먼바다')은 자식 먼바다 구역(예: '제주도남쪽바깥먼바다')
 *   으로 펼쳐 매칭한다. 펼침 모듈 로드 실패 시에도 정확일치 매칭으로 graceful 동작.
 *
 * [응답 형태]
 *   {
 *     generatedAt, baseTimeKST,
 *     active: [prediction...], resolved: [resolvedItem...],
 *     counts: { high, watch, resolved },
 *     filtered: boolean
 *   }
 *   - counts 는 "필터 후" active 의 grade.key(high/watch) 수 + resolved 길이.
 *
 * [연계 파일]
 * - advisory/stateManager.js    → data/advisory_state.json 생성/갱신(스케줄러)
 * - advisory/predictionConfig.js → GRADES(grade.key: 'high'/'watch')
 * - advisory/suppression.js      → expandOfficial(부모해역 → 자식 먼바다 펼침, 폴백)
 * - ai_report_parser.js          → ZONE_GROUP_MAP(펼침 1순위)
 * - config/server_config.js      → DATA_DIR 경로 상수
 * - server.js                    → app.use(require('./routes/advisoryPrediction'))
 * ============================================================================
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// ── DATA_DIR 결정 ─────────────────────────────────────────────────────────────
//   1순위: config/server_config.DATA_DIR (다른 라우트들과 동일 스타일).
//   폴백:  require 실패 시 이 파일 기준 ../data 로 추정 — 라우트는 항상 동작해야 함.
let DATA_DIR;
try {
    ({ DATA_DIR } = require('../config/server_config'));
} catch (_) {
    DATA_DIR = null;
}
if (!DATA_DIR) {
    DATA_DIR = path.resolve(__dirname, '..', 'data');
}

// 상태파일 경로 (= local_server/data/advisory_state.json)
const STATE_FILE = path.join(DATA_DIR, 'advisory_state.json');

// 표출 제어(관리자 운영) — graceful 로드(없으면 'all' 취급해 기존 동작 유지하지 않고,
//   안전하게 'off' 가 기본이므로 미로드 시엔 게이팅을 건너뛴다).
let displayControl = null;
try { displayControl = require('../advisory/displayControl'); } catch (_) { displayControl = null; }

// 관리자 인증(토큰) — admin 모드에서 '관리자 모드'로 로그인된 PC/기기 인가용(graceful).
//   푸시 미구독(PC 등)이라 admin_devices 등록이 불가한 관리자도, 통합관리자센터에서
//   발급된 유효 토큰(X-Admin-Token)이면 표출을 허용한다.
let adminAuth = null;
try { adminAuth = require('../services/admin_auth'); } catch (_) { adminAuth = null; }

// ── zone 펼침 헬퍼 로드 (graceful) ───────────────────────────────────────────
//   부모 관심해역(예: '제주도먼바다')이 자식 먼바다 예측(예: '제주도남쪽바깥먼바다')을
//   잡도록 펼친다. require 실패해도 라우트는 "정확일치"만으로 동작해야 한다.
//   1순위: ai_report_parser.ZONE_GROUP_MAP 직접(가벼움) — suppression.expandOfficial 과
//          동일한 자식 펼침 결과가 검증됨(['제주도먼바다'] → 제주도 3개 자식 먼바다).
//   폴백:  ZONE_GROUP_MAP 로드 실패 시 suppression.expandOfficial.
//   둘 다 실패: 펼침 없이 정확일치만(null).
let expandOfficial = null;     // (names:string[]) => Set<string>
try {
    const parser = require('../ai_report_parser');
    const ZONE_GROUP_MAP = (parser && parser.ZONE_GROUP_MAP) ? parser.ZONE_GROUP_MAP : null;
    if (ZONE_GROUP_MAP && typeof ZONE_GROUP_MAP === 'object') {
        expandOfficial = function expandFromMap(names) {
            const out = new Set();
            const list = Array.isArray(names) ? names : [];
            for (const raw of list) {
                const name = typeof raw === 'string' ? raw.trim() : '';
                if (!name) continue;
                out.add(name); // 정확일치 항상 포함
                const members = ZONE_GROUP_MAP[name];
                if (Array.isArray(members)) {
                    for (const m of members) {
                        if (typeof m === 'string' && m.trim()) out.add(m.trim());
                    }
                }
            }
            return out;
        };
    }
} catch (_) {
    expandOfficial = null;
}
if (!expandOfficial) {
    // 폴백: suppression.expandOfficial.
    try {
        const supp = require('../advisory/suppression');
        if (supp && typeof supp.expandOfficial === 'function') {
            expandOfficial = supp.expandOfficial;
        }
    } catch (_) {
        expandOfficial = null; // 펼침 불가 — 정확일치만.
    }
}

// ── 빈 payload (상태 없음/깨짐/필터없음 공용) ─────────────────────────────────
function emptyPayload() {
    return {
        generatedAt: null,
        baseTimeKST: null,
        active: [],
        resolved: [],
        counts: { high: 0, watch: 0, resolved: 0 },
        filtered: false,
        audience: 'off',
        display: false,
    };
}

/**
 * favorites 쿼리 문자열 파싱.
 *   "제주도먼바다, 동해북부앞바다" → ['제주도먼바다','동해북부앞바다']
 *   trim + 빈값 제거. 배열로 와도(?favorites=a&favorites=b) join 처리.
 *   express 가 이미 디코드하지만, %xx 가 남아있으면 한 번 더 안전 디코드.
 *
 * @param {string|string[]|undefined} q
 * @returns {string[]}
 */
function parseFavorites(q) {
    if (q == null) return [];
    let s = q;
    if (Array.isArray(s)) s = s.join(','); // ?favorites=a&favorites=b 방어
    s = String(s);
    if (/%[0-9A-Fa-f]{2}/.test(s)) {
        try { s = decodeURIComponent(s); } catch (_) { /* 잘못된 % 시퀀스 — 원문 유지 */ }
    }
    return s
        .split(',')
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => x.length > 0);
}

/**
 * grade 에서 key 추출 — 객체({key}) 또는 문자열('high'/'watch') 둘 다 허용.
 * @param {*} grade
 * @returns {string} 소문자 key, 없으면 ''
 */
function gradeKeyOf(grade) {
    if (grade == null) return '';
    if (typeof grade === 'string') return grade.trim().toLowerCase();
    if (typeof grade === 'object' && grade.key != null) {
        return String(grade.key).trim().toLowerCase();
    }
    return '';
}

/**
 * favorites 로 wantZones 집합 구성.
 *   각 favorite f → matchSet = {f} ∪ expandOfficial([f]).  전체 합집합.
 * @param {string[]} favoritesArr
 * @returns {Set<string>}
 */
function buildWantZones(favoritesArr) {
    const want = new Set();
    const list = Array.isArray(favoritesArr) ? favoritesArr : [];
    for (const f of list) {
        const name = typeof f === 'string' ? f.trim() : '';
        if (!name) continue;
        want.add(name); // 정확일치 항상 포함
        if (typeof expandOfficial === 'function') {
            try {
                const expanded = expandOfficial([name]);
                if (expanded && typeof expanded.forEach === 'function') {
                    expanded.forEach((z) => {
                        if (typeof z === 'string' && z.trim()) want.add(z.trim());
                    });
                }
            } catch (_) {
                /* 펼침 실패해도 정확일치는 유지 */
            }
        }
    }
    return want;
}

/**
 * 순수 필터 함수 — HTTP 무관, 결정론적.
 *   favorites 비면 전체 반환(filtered:false). 있으면 wantZones 필터(filtered:true).
 *   counts 는 항상 "필터 후" 기준.
 *
 * @param {*} state            advisory_state.json 파싱 결과(또는 null/깨짐)
 * @param {string[]} favoritesArr
 * @returns {{generatedAt, baseTimeKST, active:Array, resolved:Array,
 *            counts:{high:number,watch:number,resolved:number}, filtered:boolean}}
 */
function filterState(state, favoritesArr) {
    // 상태 없음/깨짐 → 빈 payload.
    if (!state || typeof state !== 'object') return emptyPayload();

    const allActive = Array.isArray(state.active) ? state.active : [];
    const allResolved = Array.isArray(state.resolved) ? state.resolved : [];
    const favs = Array.isArray(favoritesArr)
        ? favoritesArr.filter((x) => typeof x === 'string' && x.trim().length > 0)
        : [];

    let active;
    let resolved;
    let filtered;

    if (favs.length === 0) {
        // favorites 없음 → 전체 반환.
        active = allActive.slice();
        resolved = allResolved.slice();
        filtered = false;
    } else {
        const wantZones = buildWantZones(favs);
        active = allActive.filter(
            (p) => p && typeof p === 'object' && wantZones.has(String(p.zone || '').trim())
        );
        resolved = allResolved.filter(
            (r) => r && typeof r === 'object' && wantZones.has(String(r.zone || '').trim())
        );
        filtered = true;
    }

    // counts — 필터 후 기준.
    let high = 0;
    let watch = 0;
    for (const p of active) {
        const k = gradeKeyOf(p && p.grade);
        if (k === 'high') high += 1;
        else if (k === 'watch') watch += 1;
    }

    return {
        generatedAt: state.updatedAt != null ? state.updatedAt : null,
        baseTimeKST: state.baseTimeKST != null ? state.baseTimeKST : null,
        active,
        resolved,
        counts: { high, watch, resolved: resolved.length },
        filtered,
    };
}

/**
 * 상태파일 로드 — 없거나 깨졌으면 null 반환(throw 안 함).
 * 동기 — 작은 파일이고 라우트 thin wrapper 가 try/catch 로 감쌈.
 * @returns {{updatedAt, baseTimeKST, active, resolved}|null}
 */
function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        if (!raw || !raw.trim()) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            updatedAt: parsed.updatedAt != null ? parsed.updatedAt : null,
            baseTimeKST: parsed.baseTimeKST != null ? parsed.baseTimeKST : null,
            active: Array.isArray(parsed.active) ? parsed.active : [],
            resolved: Array.isArray(parsed.resolved) ? parsed.resolved : [],
        };
    } catch (_) {
        return null; // 깨진 JSON / IO 오류 → 빈 상태 취급.
    }
}

// ── 라우트 핸들러 (thin wrapper) ─────────────────────────────────────────────
//   loadState + parseFavorites + filterState 를 엮는 thin wrapper.
//   에러는 절대 throw 로 새지 않게 — 빈 payload 200(UI graceful degradation).
router.get('/api/advisory-prediction', (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.set('Content-Type', 'application/json; charset=utf-8');
    try {
        const favoritesArr = parseFavorites(req.query ? req.query.favorites : undefined);
        const state = loadState();           // null 가능 → filterState 가 빈 payload 반환.
        let payload = filterState(state, favoritesArr);

        // ── 표출 제어(청중 게이팅 + 구역 오버라이드) ──────────────────────────
        //   mode off → 누구에게도 미표출 / admin → 등록 관리자기기만 / all → 전체.
        //   display=true 일 때만 클라이언트가 아코디언을 표시한다.
        let audience = 'all', display = true;
        if (displayControl) {
            audience = displayControl.getMode();           // 'off' | 'admin' | 'all'
            if (audience === 'all') {
                display = true;
                payload = displayControl.applyOverrides(payload);
            } else if (audience === 'admin') {
                const dev = (req.query && (req.query.adminToken || req.query.endpoint)) || req.get('X-Admin-Device') || '';
                // 1) 등록된 관리자 기기(앱: 푸시 토큰/endpoint).
                display = displayControl.isAdminDevice(dev);
                // 2) 폴백 — '관리자 모드'로 로그인된 PC/기기: 유효한 관리자 토큰이면 인가.
                //    (PC 는 푸시 미구독이라 기기등록 불가 → X-Admin-Token 으로 인증)
                if (!display && adminAuth && typeof adminAuth.verifyToken === 'function') {
                    const tok = req.get('X-Admin-Token') || (req.query && req.query.adminAuthToken) || '';
                    if (tok) { try { display = !!adminAuth.verifyToken(tok); } catch (_) { /* graceful */ } }
                }
                payload = display ? displayControl.applyOverrides(payload)
                    : Object.assign({}, payload, { active: [], resolved: [], counts: { high: 0, watch: 0, resolved: 0 } });
            } else { // off
                display = false;
                payload = Object.assign({}, payload, { active: [], resolved: [], counts: { high: 0, watch: 0, resolved: 0 } });
            }
        }
        payload = Object.assign({}, payload, { audience, display });
        return res.status(200).send(JSON.stringify(payload));
    } catch (err) {
        // 진짜 예기치 못한 경우에도 빈 200 선호(UI graceful degradation).
        try {
            if (process.env.ADVISORY_DEBUG) {
                console.error('[advisoryPrediction] unexpected error:', err && err.message);
            }
            return res.status(200).send(JSON.stringify(emptyPayload()));
        } catch (_) {
            return res.status(500).json({ error: 'advisory-prediction failed' });
        }
    }
});

// ── export — express Router 함수 객체에 테스트용 내부 함수 부착 ────────────────
module.exports = router;
module.exports.filterState = filterState;
module.exports.parseFavorites = parseFavorites;
module.exports._loadState = loadState;
module.exports._buildWantZones = buildWantZones;
module.exports._gradeKeyOf = gradeKeyOf;
module.exports._emptyPayload = emptyPayload;
module.exports.STATE_FILE = STATE_FILE;
