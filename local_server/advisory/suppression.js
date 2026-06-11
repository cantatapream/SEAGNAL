/**
 * suppression.js — SEAGNAL 특보 예측 Phase 2 (억제 모듈, 통합본 C)
 *
 * 목적: 예측 결과(predictions) 중 **이미 공식 특보 또는 예비특보가 발효/예정된 구역**은
 *       제거한다. 공식이 이미 있으면 우리 예측은 불필요하기 때문.
 *
 * 공식 정보원 2종을 합집합으로 본다.
 *   1) 발효중 특보(풍랑/강풍)
 *        - data/weather_alerts.json : current 트리(.current 루트)에서 current!==null 인 잎의 부모구역
 *        - data/dmdw_alerts.json    : children 맵의 풍랑/강풍 자식 → parentZone
 *      → getActiveWarningZones()  (동기, 파일 없으면 빈 Set)
 *   2) 활성 예비특보(풍랑/태풍)
 *        - dmdw.kma.go.kr rpt=7 (최근 3일) 목록+상세 본문 파싱
 *      → fetchActivePreliminaryZones()  (실패시 빈 Set)
 *
 * 통보문에 등장하는 묶음명(예: "제주도먼바다", "서해중부전해상")은 ZONE_GROUP_MAP 으로
 * 구성 부모구역으로 펼친 뒤, zones.resolveZone 으로 정규화하여 예측 구역과 매칭한다.
 *
 * 설계 원칙: graceful — require/파일읽기/크롤/파싱 실패는 전부 흡수하고 빈(혹은 부분)
 *            결과로 폴백한다. 억제 모듈이 죽어도 본 예측 파이프라인 영향 0
 *            (최악의 경우 억제가 덜 될 뿐).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URLSearchParams } = require('url');

// ── 재사용 모듈 (read-only) ─────────────────────────────────────────────────
//   require 실패해도 본 모듈은 로드되도록 graceful 폴백.
let ZONE_GROUP_MAP = {};
try {
    ZONE_GROUP_MAP = require('../ai_report_parser').ZONE_GROUP_MAP || {};
} catch (e) {
    ZONE_GROUP_MAP = {};
}

// resolveZone: { name, ... } 또는 null 반환. 실패시 공백제거 폴백.
let resolveZone = (name) =>
    (name ? { name: String(name).replace(/\s+/g, '').trim() } : null);
try {
    const z = require('../analysis/wave_leadtime/zones');
    if (z && typeof z.resolveZone === 'function') resolveZone = z.resolveZone;
} catch (e) { /* keep fallback */ }

const DATA_DIR = path.join(__dirname, '..', 'data');

/** 이름 정규화 — resolveZone(z.name) 우선, 없으면 공백제거. (officialSet/pred 양쪽 동일 적용) */
function normalizeName(name) {
    if (!name) return '';
    const z = resolveZone(name);
    return z && z.name ? z.name : String(name).replace(/\s+/g, '').trim();
}

// ============================================================================
// 1. dmdw 로그인 + 예비특보 크롤 (preDetailCrawl2 패턴을 "현재시점"용으로 적응)
// ============================================================================

const HOST = 'dmdw.kma.go.kr';
const BASE = 'https://' + HOST;

const enc64 = (s) => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');

/** 쿠키 직렬화 */
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

/** set-cookie 헤더 → jar 누적 */
function ingestCookies(jar, setCookie) {
    if (!setCookie) return;
    (Array.isArray(setCookie) ? setCookie : [setCookie]).forEach((c) => {
        const kv = c.split(';')[0].trim();
        const i = kv.indexOf('=');
        if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1);
    });
}

/** 단일 HTTPS 요청 (Promise) */
function httpReq(jar, method, p, body, extraHeaders) {
    return new Promise((resolve, reject) => {
        const headers = Object.assign(
            { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookieHeader(jar) },
            extraHeaders || {}
        );
        if (body) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const r = https.request(
            { method, host: HOST, path: p, headers, timeout: 25000 },
            (res) => {
                ingestCookies(jar, res.headers['set-cookie']);
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () =>
                    resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            }
        );
        r.on('error', reject);
        r.on('timeout', () => r.destroy(new Error('timeout')));
        if (body) r.write(body);
        r.end();
    });
}

/** HTML 에서 _csrf meta content 추출 */
const grabCsrf = (html) => {
    const m = String(html || '').match(/name=["']_csrf["'][^>]*content=["']([^"']+)["']/);
    return m ? m[1] : '';
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** YYYYMMDD */
function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/**
 * 예비특보 상세 본문 파싱 — 풍랑/태풍 예비특보 섹션의 해역명만 추출.
 *
 * (N) 풍랑/태풍 예비특보 섹션 아래의 "o ... : 해역A, 해역B(부가설명)" 라인에서
 * 해역명만 모은다. 강풍/대설/호우 등 다른 섹션은 kind=null 로 두어 스킵.
 * 괄호(자식해역 설명)는 제거하며, 묶음명(전해상 등)은 원문 그대로 반환하여
 * 호출측 expandOfficial 이 펼치게 한다.
 *
 * @param {string} html  상세 본문(t4 + other 결합 텍스트)
 * @returns {string[]}   해역명 배열 (묶음명/전해상 포함 가능 — 미펼침 원문)
 */
function parsePreliminaryAreas(html) {
    if (!html) return [];
    const lines = String(html).replace(/<br\s*\/?>/g, '\n').split('\n');
    const out = [];
    let kind = null; // '풍랑' | '태풍' | null(관심 외 섹션)
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        // 섹션 헤더: "(1) 풍랑 예비특보" / "(2) 태풍 예비특보" / "(3) 강풍 예비특보" 등
        const sec = line.match(/\((\d+)\)\s*(풍랑|태풍|강풍|대설|호우|한파|건조|폭풍해일|황사)\s*예비특보/);
        if (sec) {
            kind = (sec[2] === '풍랑' || sec[2] === '태풍') ? sec[2] : null;
            continue;
        }
        // 관심 섹션(풍랑/태풍) 안의 "o ... : 해역들" 라인
        if (kind && /^o\s/.test(line)) {
            const ci = line.indexOf(':');
            if (ci < 0) continue;
            const right = line.slice(ci + 1);
            // 콤마 분리 + 괄호(자식해역 설명) 제거
            const areas = right
                .split(/[,，]/)
                .map((s) => s.replace(/\(.*?\)/g, '').trim())
                .filter(Boolean);
            for (const a of areas) out.push(a);
        }
    }
    return out;
}

/**
 * dmdw 로그인 후 rpt=7 (예비특보) 최근 3일 목록 + 상세를 받아,
 * 풍랑/태풍 예비특보 섹션의 해역명을 Set 으로 반환 (미펼침 원문).
 *
 * 자격증명은 환경변수 KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD 사용.
 * 어떤 단계든 실패하면 빈(혹은 부분) Set 반환 (graceful — 앱 영향 0).
 *
 * @returns {Promise<Set<string>>}
 */
async function fetchActivePreliminaryZones() {
    const areas = new Set();
    const userId = process.env.KMA_DMDW_USER_ID;
    const userPwd = process.env.KMA_DMDW_USER_PWD;
    if (!userId || !userPwd) {
        // 자격증명 없으면 크롤 불가 — graceful 빈 Set
        return areas;
    }

    const jar = {};
    let csrf = '';
    try {
        // (1) 메인 진입 → csrf
        const main = await httpReq(jar, 'GET', '/rsw/mfp/mfpMain');
        csrf = grabCsrf(main.text);

        // (2) 로그인 (base64(encodeURIComponent(자격)))
        await httpReq(
            jar, 'POST', '/rsw/rest/frm/login_user',
            new URLSearchParams({ userId: enc64(userId), userPwd: enc64(userPwd) }).toString(),
            {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': csrf,
                'Origin': BASE,
                'Referer': BASE + '/rsw/mfp/mfpMain',
                'Accept': 'application/json'
            }
        );

        // (3) 서브 페이지 진입 → csrf 갱신
        const sub = await httpReq(jar, 'GET', '/rsw/mfp/mfpSub?lv2Id=B002');
        csrf = grabCsrf(sub.text) || csrf;

        const post = (p, body) =>
            httpReq(jar, 'POST', p, new URLSearchParams(body).toString(), {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': csrf,
                'Origin': BASE,
                'Referer': BASE + '/rsw/mfp/wrn/rswWeaWnotRetrieve',
                'Accept': 'application/json, text/javascript, */*'
            });

        // (4) 목록: 최근 3일 (오늘 포함 — endDate 는 내일로 여유, 당일 발표분 누락 방지)
        const now = new Date();
        const start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const end = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

        let listResp;
        try {
            listResp = await post('/rsw/rest/mfp/wrn/retRswWrnRptList.json', {
                rpt: '7',
                stnId: '108',
                startDate: ymd(start),
                endDate: ymd(end)
            });
        } catch (e) {
            return areas; // 목록 요청 실패 → graceful
        }

        let items;
        try {
            items = JSON.parse(listResp.text).body || [];
        } catch (e) {
            return areas; // 목록 파싱 실패 → graceful
        }

        // (5) 각 통보문 상세 → 풍랑/태풍 예비특보 해역 파싱
        for (const it of items) {
            let detail;
            try {
                detail = await post('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', {
                    rpt: it.code,
                    stnId: '108'
                });
            } catch (e) {
                continue;
            }
            let dj;
            try {
                dj = JSON.parse(detail.text);
            } catch (e) {
                continue;
            }
            const result = dj && dj.body && dj.body.result;
            if (!result) continue;
            const body = (result.t4 || '') + '<br>' + (result.other || '');
            for (const a of parsePreliminaryAreas(body)) areas.add(a);
            await sleep(85); // 서버 예의상 딜레이
        }
    } catch (e) {
        // 로그인/네트워크 등 어떤 실패도 흡수 — 빈(혹은 부분) Set 반환
        return areas;
    }

    return areas;
}

// ============================================================================
// 2. 발효중 특보(공식) 구역 — 디스크 트리/자식 파일에서 추출
// ============================================================================

/** JSON 파일 안전 로드 (없거나 깨졌으면 null) */
function loadJsonSafe(file) {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

/** 풍랑/강풍 종류 판별 (한글명 '풍랑'|'강풍' 또는 코드 'V'|'W') */
function isWindWaveType(tp) {
    const s = String(tp || '');
    return s === '풍랑' || s === '강풍' || s === 'V' || s === 'W';
}

/**
 * 현재 발효 중(current!==null)인 풍랑/강풍 부모구역명 Set 반환.
 *
 * 소스:
 *   - data/weather_alerts.json : 루트 .current 트리만 순회(.previous 는 무시).
 *     잎(leaf) = { current, upcoming, history, children } 형태. current!==null 이고
 *     풍랑/강풍이면 그 잎의 key(부모구역명)를 수집.
 *   - data/dmdw_alerts.json    : children 맵의 자식 중 풍랑/강풍이면 parentZone 수집
 *     (children 에 존재 = 발효중으로 간주).
 *
 * 두 파일 모두 없으면 빈 Set (graceful).
 * @returns {Set<string>}  미펼침 부모구역명 Set (펼침은 expandOfficial)
 */
function getActiveWarningZones() {
    const zones = new Set();

    // --- (A) weather_alerts.json: 루트 .current 트리 ---
    //   루트가 { current: <zoneTree>, previous: <zoneTree>, ... } 구조이므로
    //   반드시 .current 만 순회한다(previous 의 과거 특보로 인한 과잉 억제 방지).
    const wa = loadJsonSafe(path.join(DATA_DIR, 'weather_alerts.json'));
    const treeRoot = wa && wa.current && typeof wa.current === 'object' ? wa.current
        : (wa && typeof wa === 'object' && !wa.current ? wa : null);
    if (treeRoot) {
        const seen = new WeakSet(); // 순환참조 가드(디스크 JSON 은 보통 무순환이나 보수적으로)
        const walk = (node) => {
            if (!node || typeof node !== 'object' || Array.isArray(node)) return;
            if (seen.has(node)) return;
            seen.add(node);
            for (const [key, val] of Object.entries(node)) {
                if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
                const isLeaf =
                    Object.prototype.hasOwnProperty.call(val, 'current') ||
                    Object.prototype.hasOwnProperty.call(val, 'upcoming') ||
                    Object.prototype.hasOwnProperty.call(val, 'history');
                if (isLeaf) {
                    const cur = val.current;
                    if (cur && typeof cur === 'object' &&
                        isWindWaveType(cur.wrnTp || cur.wrnTpNm)) {
                        zones.add(key);
                    }
                    // 잎 안 children(자식해역)은 부모단위만 보므로 더 내려가지 않음.
                } else {
                    walk(val); // 중간 노드(바다/그룹) — 계속 내려간다.
                }
            }
        };
        walk(treeRoot);
    }

    // --- (B) dmdw_alerts.json 자식 맵 ---
    const dm = loadJsonSafe(path.join(DATA_DIR, 'dmdw_alerts.json'));
    if (dm && dm.children && typeof dm.children === 'object') {
        for (const child of Object.values(dm.children)) {
            if (!child || typeof child !== 'object') continue;
            if (isWindWaveType(child.wrnTp || child.wrnTpNm)) {
                const parent = child.parentZone || child.parent;
                if (parent) zones.add(String(parent).trim());
            }
        }
    }

    return zones;
}

// ============================================================================
// 3. 묶음명 펼침 + 정규화
// ============================================================================

/**
 * 각 이름이 ZONE_GROUP_MAP 키(묶음명/전해상)면 구성 부모구역으로 펼치고,
 * 아니면 그대로 둔다. 그 뒤 resolveZone 으로 정규화(없으면 공백제거 폴백).
 *
 * 중요: 펼침을 먼저 수행해야 한다 — '제주도먼바다' 같은 묶음명은 resolveZone 이
 *       집계(_agg) 이름으로 정규화해버려 개별 자식 예측과 매칭되지 않기 때문.
 *
 * @param {Iterable<string>|Array<string>} names
 * @returns {Set<string>}  펼친·정규화된 부모구역명 Set
 */
function expandOfficial(names) {
    const out = new Set();
    const list = names instanceof Set ? Array.from(names)
        : (Array.isArray(names) ? names : (names ? Array.from(names) : []));
    const addNormalized = (name) => {
        const n = normalizeName(name);
        if (n) out.add(n);
    };
    for (const raw of list) {
        const name = String(raw || '').trim();
        if (!name) continue;
        if (Object.prototype.hasOwnProperty.call(ZONE_GROUP_MAP, name) &&
            Array.isArray(ZONE_GROUP_MAP[name])) {
            for (const member of ZONE_GROUP_MAP[name]) addNormalized(member);
        } else {
            addNormalized(name);
        }
    }
    return out;
}

// ============================================================================
// 4. 억제 적용
// ============================================================================

/**
 * predictions 중 zone 이 officialSet 에 든 것을 제거.
 * zone 도 동일 normalizeName 으로 정규화하여 비교(표기 변이 흡수).
 *
 * @param {Array<{zone:string}>} predictions
 * @param {Set<string>|Iterable<string>} officialSet  expandOfficial 결과(정규화됨)
 * @returns {{visible:Array, suppressed:Array<{zone:string,reason:'official'}>}}
 */
function suppress(predictions, officialSet) {
    const visible = [];
    const suppressed = [];
    const set = officialSet instanceof Set ? officialSet : new Set(officialSet || []);
    const list = Array.isArray(predictions) ? predictions : [];
    for (const p of list) {
        const rawZone = p && p.zone ? String(p.zone).trim() : '';
        const key = normalizeName(rawZone);
        if (rawZone && key && set.has(key)) {
            suppressed.push({ zone: rawZone, reason: 'official' });
        } else {
            visible.push(p);
        }
    }
    return { visible, suppressed };
}

/**
 * 전체 억제 파이프라인.
 *   official = expandOfficial( 발효중특보 ∪ 활성예비특보 )
 *   return suppress(predictions, official)
 *
 * predictions 인자가 없으면 data/advisory_prediction.json 의 .predictions 로드.
 *
 * @param {Array<{zone:string}>} [predictions]
 * @returns {Promise<{visible:Array, suppressed:Array}>}
 */
async function applySuppression(predictions) {
    let preds = predictions;
    if (!Array.isArray(preds)) {
        const data = loadJsonSafe(path.join(DATA_DIR, 'advisory_prediction.json'));
        preds = (data && Array.isArray(data.predictions)) ? data.predictions
            : (Array.isArray(data) ? data : []);
    }

    const officialRaw = new Set();
    // 발효중 특보 (디스크) — 동기, 항상 안전
    for (const z of getActiveWarningZones()) officialRaw.add(z);
    // 활성 예비특보 (크롤) — 실패해도 빈 Set
    try {
        for (const z of await fetchActivePreliminaryZones()) officialRaw.add(z);
    } catch (e) {
        /* graceful */
    }

    const officialSet = expandOfficial(officialRaw);
    return suppress(preds, officialSet);
}

module.exports = {
    fetchActivePreliminaryZones,
    getActiveWarningZones,
    expandOfficial,
    suppress,
    applySuppression
};
