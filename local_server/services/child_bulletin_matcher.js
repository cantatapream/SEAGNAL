'use strict';

// ============================================================================
// child_bulletin_matcher.js — 자식(연안바다/평수구역)-only 통보문 보강 (엔지니어 A)
// ============================================================================
//
// [문제] ef/list 에는 부모(S1) 행만 있어, 부모는 그대로인데 자식만 발효/해제/격상되는
//   "자식-only 변경 통보문"은 부모 ef 행이 안 생겨 /api/zone-bulletins 목록에서 누락된다.
//
// [설계 — 이벤트 기반, 사용자 합의]
//   1. 전 지방청 상시 폴링 금지. 자식 변동이 "확정"됐을 때만 동작.
//   2. 기존 디바운스·의심가드를 통과해 실제 자식 푸시가 나가는 그 신호
//      (CHILD_ADD/CHILD_RELEASE/CHILD_*_EXTEND, 또는 부모변화에 동반된 childState
//       added/released)에만 펜딩을 등록한다. (새 글리치 로직 금지 — 통과분에 얹음.)
//   3. 펜딩이 열린 동안, 매 cycle 그 부모의 관할 지방청(ZONE_HOME_OFFICE) ntfctn/list만
//      조회 → 새 file_nm 통보문 PDF만 파싱(file_nm 단위 캐시, PDF 불변) →
//      본문에 부모명 + 바뀐 자식명이 들어있는지 확인.
//   4. 매칭되면 { 부모, 자식통보문:{time, title, pdfUrl, file_nm} } 영속 저장 → 펜딩 종료.
//   5. 고정 시간창(+N분) 금지. 매칭될 때까지 열어둔다(하드 캡 내).
//   6. 안전망: (a) 상태 반전/후속 변동 시 펜딩 자동 폐기(supersession),
//             (b) 하드 캡(당일/수시간) 도달 시 graceful 포기(미매칭 기록). 무한 대기 없게.
//   7. 영속화: 매칭 자식 통보문 + 열린 펜딩을 디스크 저장(재시작 생존), 타 크롤러 state 와 동일 방식.
//   8. 라우트는 ef/list 부모 통보문 ∪ 저장된 자식 통보문을 file_nm dedup, tm_fc 최신순.
//
// [제약] 평상시(변동 없음) ntfctn 호출 0회. 관할청 1곳만. 가볍게.
//
// [중요한 실측] 통보문 PDF 본문은 자식명을 앱 정식명(예 '제주도북부앞바다중연안바다')이
//   아니라 축약형(예 '제주도북부연안바다')으로 적는다. 따라서 매칭은 정식명 + 여러 축약형
//   후보를 모두 생성해 정규화(공백제거) 부분일치로 본다. PDF 가 부분추출돼 실패하면 다음
//   cycle 재시도(캡 내).

const fs = require('fs');
const path = require('path');

let pdfParse = null;
try { pdfParse = require('pdf-parse'); }
catch (e) { console.warn('[child-bulletin] pdf-parse 미설치 — 자식 통보문 매칭 비활성:', e && e.message); }

const MARINE_PDF_HOST = 'https://marine.kma.go.kr';
const NATIONAL_GO = '108';

// 영속 파일 — 타 크롤러 state 와 동일 디렉터리/atomic write 패턴.
const _DATA_DIR = path.join(__dirname, '..', 'data');
const _STATE_FILE = path.join(_DATA_DIR, 'child_bulletin_state.json');
const _STATE_TMP = _STATE_FILE + '.tmp';

// 펜딩 하드 캡 — 매칭 안 되면 이 시간 경과 시 graceful 포기(미매칭 기록). 무한 대기 방지.
const PENDING_HARD_CAP_MS = 6 * 60 * 60 * 1000;   // 6시간
// PDF 본문 파싱 캐시 — file_nm 단위(불변). 메모리. 텍스트만 보관.
const _pdfTextCache = new Map();                  // file_nm -> normalized text | null(파싱실패)
const PDF_CACHE_MAX = 400;
// 매칭 자식 통보문 보관 상한(부모당) — 라우트 dedup 후 50건 슬라이스이므로 넉넉히.
const MATCHED_PER_PARENT_MAX = 60;
// ntfctn/list 조회 윈도우(일) — 펜딩 감지 이후 최근 통보문만 보면 됨. 가볍게 당일+전일.
const NTFCTN_LOOKBACK_DAYS = 1;

// ----------------------------------------------------------------------------
// 상태: 메모리 + 디스크.
//   pendings: { key -> { parent, children:[자식명...], changeType, detectedAt(ms),
//                        capUntil(ms), seenFiles:[file_nm...], tries } }
//   matched:  { parentNorm -> [ { time, title, pdfUrl, file_nm, children:[], matchedAt } ] }
// ----------------------------------------------------------------------------
let _state = null;   // lazy load

function _emptyState() {
    return { pendings: {}, matched: {}, updatedAt: null };
}

function _loadState() {
    try {
        if (fs.existsSync(_STATE_FILE)) {
            const j = JSON.parse(fs.readFileSync(_STATE_FILE, 'utf8'));
            if (j && typeof j === 'object') {
                return {
                    pendings: (j.pendings && typeof j.pendings === 'object') ? j.pendings : {},
                    matched: (j.matched && typeof j.matched === 'object') ? j.matched : {},
                    updatedAt: j.updatedAt || null
                };
            }
        }
    } catch (e) {
        console.warn('[child-bulletin] state 복원 실패 (무시):', e && e.message);
    }
    return _emptyState();
}

function _ensureState() {
    if (_state === null) _state = _loadState();
    return _state;
}

let _saveTimer = null;
function _saveState() {
    try {
        if (!fs.existsSync(_DATA_DIR)) fs.mkdirSync(_DATA_DIR, { recursive: true });
        const obj = { ..._state, updatedAt: new Date().toISOString() };
        fs.writeFileSync(_STATE_TMP, JSON.stringify(obj), 'utf8');
        fs.renameSync(_STATE_TMP, _STATE_FILE);
    } catch (e) {
        console.warn('[child-bulletin] state 저장 실패 (무시):', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 이름 정규화 / 후보 생성
// ----------------------------------------------------------------------------
const _norm = (s) => String(s || '').replace(/\s+/g, '');

/**
 * 자식 정식명에서 PDF 본문에 등장할 만한 후보 문자열들을 생성.
 *   PDF 는 자식을 축약(예 '제주도북부앞바다중연안바다' → '제주도북부연안바다')해 적는다.
 *   - 정식명 자체
 *   - '중' 제거: '제주도북부앞바다연안바다'
 *   - 부모prefix 의 '앞바다'/'먼바다' 등 꼬리 제거 후 + suffix:
 *       '제주도북부' + '연안바다' = '제주도북부연안바다'  ← 실측 형태
 *   - suffix 가 충분히 변별적(우도/가파도/추자도/조도 등 고유지명 포함)이면 그 자체도 후보.
 * @returns {string[]} 정규화(공백제거)된 후보 배열 (중복 제거)
 */
function _childNameCandidates(childFull) {
    const full = _norm(childFull);
    const out = new Set();
    if (!full) return [];
    out.add(full);
    // '중' 기준 분해 (앱 정식명은 대부분 '<부모>중<suffix>')
    const idx = full.indexOf('중');
    if (idx > 0 && idx < full.length - 1) {
        const prefix = full.slice(0, idx);     // 예: 제주도북부앞바다
        const suffix = full.slice(idx + 1);    // 예: 연안바다 / 동부평수구역 / 우도연안바다
        out.add(prefix + suffix);              // 중 제거형
        // 부모 prefix 의 '...앞바다'/'...먼바다' 꼬리를 떼고 suffix 결합 (실측 축약형)
        const locality = prefix
            .replace(/앞바다$/, '')
            .replace(/먼바다$/, '')
            .replace(/바다$/, '');
        if (locality && locality !== prefix) out.add(locality + suffix);
        // suffix 가 고유지명을 포함하면 단독 후보 (예: 우도연안바다, 가파도연안바다, 추자도연안바다,
        //   조도부근평수구역) — 흔한 일반어('연안바다'/'평수구역' 단독)는 변별력이 없어 제외.
        if (suffix.length >= 5 && !/^연안바다$|^평수구역$|^동부평수구역$|^서부평수구역$|^남부평수구역$|^먼평수구역$|^앞평수구역$/.test(suffix)) {
            out.add(suffix);
        }
    }
    return Array.from(out);
}

// ----------------------------------------------------------------------------
// [SPEC §2] 확정된 자식 변동 등록 — 크롤러의 _buildUserPushChanges 결과를 받아 처리.
//   childState = { all, active, added:[], released:[], extended:[] } (변화 종류별 키)
//   부모변화에 동반된 childState 의 added/released, 또는 자식 단독 변화(CHILD_*)를 모두 흡수.
// ----------------------------------------------------------------------------
const _CHILD_CHANGE_TYPES = new Set([
    'CHILD_ADD', 'CHILD_RELEASE', 'CHILD_EF_EXTEND', 'CHILD_YN_EXTEND'
]);

/**
 * @param {Array} userChanges  crawler._buildUserPushChanges() 반환 배열 (확정 푸시 신호)
 * @returns {number} 새로 연 펜딩 수
 */
function registerChildChanges(userChanges) {
    if (!Array.isArray(userChanges) || userChanges.length === 0) return 0;
    const st = _ensureState();
    const now = Date.now();
    let opened = 0;
    let dirty = false;

    for (const ch of userChanges) {
        if (!ch || !ch.zone) continue;
        const parent = ch.zone;
        const cs = ch.childState || {};
        // 변화한 자식만 수집 (added/released/extended). 부모 발효에 그냥 따라온 active 전체는 아님.
        const changed = []
            .concat(Array.isArray(cs.added) ? cs.added : [])
            .concat(Array.isArray(cs.released) ? cs.released : [])
            .concat(Array.isArray(cs.extended) ? cs.extended : []);
        // CHILD_* 단독 변화 타입은 child block 으로도 신호가 옴 — childState 에 이미 반영되어 있으나,
        //   혹시 비어있으면 type 만 보고 스킵(자식명이 없으면 매칭 불가).
        const uniq = Array.from(new Set(changed.filter(Boolean)));
        if (uniq.length === 0) {
            if (_CHILD_CHANGE_TYPES.has(ch.type)) {
                // 자식명 없는 자식변화 — 매칭 불가, 등록 안 함.
            }
            continue;
        }
        // 부모-자식 동시 변화든 자식-only 든, "그 부모의 자식이 바뀐" 확정 신호이므로 펜딩 등록.
        const key = parent + '|' + uniq.slice().sort().join(',');
        const ex = st.pendings[key];
        if (ex) {
            // [안전망 a — supersession] 후속 동일-부모 자식 변동이 또 확정되면 펜딩을 갱신
            //   (캡 리셋 + 시도 흔적 유지). 상태 반전(추가→해제 등)도 같은 부모 변동이므로
            //   여기서 detectedAt 을 갱신해 "최신 변동" 기준으로 매칭하게 한다.
            ex.detectedAt = now;
            ex.capUntil = now + PENDING_HARD_CAP_MS;
            ex.changeType = ch.type || ex.changeType;
            dirty = true;
            continue;
        }
        st.pendings[key] = {
            parent,
            children: uniq,
            changeType: ch.type || '',
            detectedAt: now,
            capUntil: now + PENDING_HARD_CAP_MS,
            seenFiles: [],
            tries: 0
        };
        opened++;
        dirty = true;
    }

    // [안전망 a — supersession 보강] 같은 부모에 대해 펜딩이 여러 개 열렸다가, 한 cycle 에서
    //   서로 모순되는 자식 변동이 더 들어오면 위 갱신으로 capUntil 이 미뤄진다. 무한 누적 방지를
    //   위해 부모당 펜딩 수 상한(가장 오래된 것부터 폐기).
    _capPendingsPerParent(st);

    if (dirty) _saveState();
    return opened;
}

const PENDING_PER_PARENT_MAX = 6;
function _capPendingsPerParent(st) {
    const byParent = {};
    for (const [k, p] of Object.entries(st.pendings)) {
        (byParent[p.parent] = byParent[p.parent] || []).push([k, p]);
    }
    for (const arr of Object.values(byParent)) {
        if (arr.length <= PENDING_PER_PARENT_MAX) continue;
        arr.sort((a, b) => (a[1].detectedAt || 0) - (b[1].detectedAt || 0));
        const drop = arr.slice(0, arr.length - PENDING_PER_PARENT_MAX);
        for (const [k] of drop) delete st.pendings[k];
    }
}

// ----------------------------------------------------------------------------
// PDF 본문 추출 — file_nm 단위 캐시 (PDF 불변). 실패 시 null 캐시 안 함(재시도 허용).
// ----------------------------------------------------------------------------
const https = require('https');
function _downloadPdf(fileNm) {
    return new Promise((resolve, reject) => {
        const url = MARINE_PDF_HOST + fileNm;
        const req = https.get(url, { rejectUnauthorized: false, timeout: 20000 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('PDF HTTP ' + res.statusCode));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('PDF timeout')));
    });
}

async function _getPdfText(fileNm) {
    if (_pdfTextCache.has(fileNm)) return _pdfTextCache.get(fileNm);   // null(실패)도 캐시됨
    if (!pdfParse) return null;
    let text = null;
    try {
        const buf = await _downloadPdf(fileNm);
        const d = await pdfParse(buf);
        text = _norm(d.text || '');
        if (!text) text = null;
    } catch (e) {
        // 다운로드/파싱 실패 → 캐시하지 않음(다음 cycle 재시도). 부분추출은 text 있으면 캐시.
        return null;
    }
    // LRU 비슷한 단순 cap
    if (_pdfTextCache.size >= PDF_CACHE_MAX) {
        const firstKey = _pdfTextCache.keys().next().value;
        _pdfTextCache.delete(firstKey);
    }
    _pdfTextCache.set(fileNm, text);
    return text;
}

/**
 * PDF 본문 text(정규화됨)에 부모명 + 변경 자식명(후보 중 하나)이 모두 있으면 매칭.
 * @returns {string[]|null} 매칭된 자식 정식명 배열 (없으면 null)
 */
function _matchInText(text, parent, children) {
    if (!text) return null;
    const parentNorm = _norm(parent);
    // 부모명 또는 그 핵심(앞/먼바다 꼬리 제거) 이 본문에 있어야 함.
    const parentCore = parentNorm.replace(/앞바다$/, '').replace(/먼바다$/, '');
    const hasParent = text.includes(parentNorm) || (parentCore.length >= 3 && text.includes(parentCore));
    if (!hasParent) return null;
    const hit = [];
    for (const child of children) {
        const cands = _childNameCandidates(child);
        if (cands.some((c) => c && text.includes(c))) hit.push(child);
    }
    return hit.length ? hit : null;
}

// ----------------------------------------------------------------------------
// [SPEC §3,§4,§5,§6] 매 cycle 틱 — 열린 펜딩의 부모 관할청 ntfctn/list 만 조회 → 매칭.
//   marineClient: marine_client 모듈 (fetchWarnNtfctnList).
//   zoneHomeOffice: { 부모정규화명 -> prdc_go } 정적 매핑 (weather.js 의 ZONE_HOME_OFFICE).
// ----------------------------------------------------------------------------
function _kstYmd(offsetDays) {
    const kst = new Date(Date.now() + 9 * 3600000 + (offsetDays || 0) * 86400000);
    return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// file_nm 형식 KTKO50_<YYYYMMDDHHMM>_<prdc_go>_<seq>.pdf 에서 tm_fc 회수.
function _tmFcFromRow(row) {
    if (row && row.tm_fc_file_nm && /^\d{12}$/.test(String(row.tm_fc_file_nm))) {
        return String(row.tm_fc_file_nm);
    }
    const fn = String((row && row.file_nm) || '');
    const m = fn.match(/KTKO\d+_(\d{12})_/);
    if (m) return m[1];
    // ISO tm_fc fallback (UTC) → KST YYYYMMDDHHmm
    if (row && row.tm_fc) {
        const d = new Date(row.tm_fc);
        if (!isNaN(d)) {
            const k = new Date(d.getTime() + 9 * 3600000);
            return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}${String(k.getUTCHours()).padStart(2, '0')}${String(k.getUTCMinutes()).padStart(2, '0')}`;
        }
    }
    return '';
}

/**
 * @param {Object} deps { marineClient, zoneHomeOffice }
 * @returns {Promise<{ matched:number, gaveUp:number, offices:number }>}
 */
async function tick(deps) {
    const st = _ensureState();
    const now = Date.now();
    const marineClient = deps && deps.marineClient;
    const zoneHomeOffice = (deps && deps.zoneHomeOffice) || {};
    if (!marineClient || typeof marineClient.fetchWarnNtfctnList !== 'function') {
        return { matched: 0, gaveUp: 0, offices: 0 };
    }

    const pendingEntries = Object.entries(st.pendings);
    if (pendingEntries.length === 0) return { matched: 0, gaveUp: 0, offices: 0 };   // 평상시 0회 호출

    let dirty = false;
    let gaveUp = 0;

    // [안전망 b] 하드 캡 도달 펜딩은 graceful 포기 (미매칭 기록만 남기고 종료).
    for (const [key, p] of pendingEntries) {
        if (now >= (p.capUntil || 0)) {
            delete st.pendings[key];
            gaveUp++;
            dirty = true;
            console.log(`[child-bulletin] 펜딩 캡 도달 — graceful 포기: ${p.parent} [${(p.children || []).join(',')}]`);
        }
    }

    // 남은 펜딩의 부모 → 관할 지방청(prdc_go) 묶음 (108=전국 폴백 해역은 자식 없어 skip).
    const officeToPendings = new Map();   // prdc_go -> [ [key,p] ]
    for (const [key, p] of Object.entries(st.pendings)) {
        const home = zoneHomeOffice[_norm(p.parent)];
        if (!home || home === NATIONAL_GO) continue;   // 관할 지방청 PDF 가 자식 포함 — 108 폴백은 무의미
        if (!officeToPendings.has(home)) officeToPendings.set(home, []);
        officeToPendings.get(home).push([key, p]);
    }

    if (officeToPendings.size === 0) {
        if (dirty) _saveState();
        return { matched: 0, gaveUp, offices: 0 };
    }

    const stTm = _kstYmd(-NTFCTN_LOOKBACK_DAYS);
    const edTm = _kstYmd(0);
    let matched = 0;

    for (const [office, pendings] of officeToPendings.entries()) {
        let rows;
        try {
            rows = await marineClient.fetchWarnNtfctnList({ prdc_go: office, st_tm: stTm, ed_tm: edTm });
        } catch (e) {
            console.warn(`[child-bulletin] ntfctn/list 조회 실패 (office=${office}) — 다음 cycle 재시도:`, e && e.message);
            continue;
        }
        const safeRows = Array.isArray(rows) ? rows : [];
        // 발표시각 오름차순 정렬 후, file_nm 단위로 신규만 파싱.
        const byFile = new Map();
        for (const r of safeRows) {
            const fn = String((r && r.file_nm) || '').trim();
            if (!fn) continue;
            if (!byFile.has(fn)) byFile.set(fn, r);
        }

        for (const [key, p] of pendings) {
            if (!st.pendings[key]) continue;   // 위에서 캡으로 폐기됐을 수 있음
            const seen = new Set(p.seenFiles || []);
            let resolvedHere = false;
            // 감지시각 이후(또는 직전 약간 여유) 발표된 통보문만 — 너무 옛 PDF 재파싱 방지.
            const detectKey = _ymdHmKeyFromMs(p.detectedAt - 10 * 60 * 1000);   // 10분 여유
            for (const [fn, row] of byFile.entries()) {
                if (resolvedHere) break;
                const tmFc = _tmFcFromRow(row);
                if (tmFc && detectKey && tmFc < detectKey) continue;   // 감지 전 통보문 skip
                if (seen.has(fn)) continue;                            // 이미 파싱(미매칭)한 file
                // 새 file → 파싱 (캐시됨)
                const text = await _getPdfText(fn);
                if (text === null) {
                    // 파싱 실패 — seen 에 넣지 않음 → 다음 cycle 재시도(캡 내)
                    continue;
                }
                seen.add(fn);
                const hit = _matchInText(text, p.parent, p.children);
                if (hit) {
                    _recordMatch(st, p.parent, {
                        time: tmFc,
                        title: _composeTitle(row, hit),
                        pdfUrl: MARINE_PDF_HOST + fn,
                        file_nm: fn,
                        children: hit,
                        matchedAt: new Date().toISOString()
                    });
                    delete st.pendings[key];
                    matched++;
                    resolvedHere = true;
                    dirty = true;
                    console.log(`[child-bulletin] 매칭: ${p.parent} ← ${fn} [${hit.join(',')}]`);
                }
            }
            if (!resolvedHere && st.pendings[key]) {
                p.seenFiles = Array.from(seen);
                p.tries = (p.tries || 0) + 1;
                dirty = true;
            }
        }
    }

    if (dirty) _saveState();
    return { matched, gaveUp, offices: officeToPendings.size };
}

function _ymdHmKeyFromMs(ms) {
    const k = new Date(ms + 9 * 3600000);
    return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}${String(k.getUTCHours()).padStart(2, '0')}${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

function _composeTitle(row, hitChildren) {
    // ntfctn warn_title 예: '[ 특보 ] 제06-17호 : 2026.06.02.11:30 / 풍랑주의보 발표'
    //   → 사용자에게는 자식명 + 통보문 종류를 노출해 자식-only 임을 구분 가능하게.
    const raw = String((row && row.warn_title) || '').trim();
    // '/' 뒤 종류·발표구분 부분 추출
    let tail = raw;
    const slash = raw.lastIndexOf('/');
    if (slash >= 0) tail = raw.slice(slash + 1).trim();
    const childLabel = (hitChildren && hitChildren.length) ? hitChildren.join('·') : '';
    return childLabel ? `${childLabel} ${tail}`.trim() : (tail || raw);
}

function _recordMatch(st, parent, entry) {
    const pn = _norm(parent);
    const arr = st.matched[pn] = st.matched[pn] || [];
    // file_nm + children 조합으로 dedup (같은 PDF 가 여러 자식 변동을 한 번에 담을 수 있음).
    const dedupKey = entry.file_nm + '|' + (entry.children || []).slice().sort().join(',');
    if (arr.some((e) => (e.file_nm + '|' + (e.children || []).slice().sort().join(',')) === dedupKey)) return;
    arr.push(entry);
    arr.sort((a, b) => (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));
    if (arr.length > MATCHED_PER_PARENT_MAX) arr.length = MATCHED_PER_PARENT_MAX;
}

// ----------------------------------------------------------------------------
// [SPEC §8] 라우트용 — 부모의 저장된 자식 통보문 반환.
//   반환: [{ time, title, pdfUrl, national:false, child:true, file_nm }]
// ----------------------------------------------------------------------------
function getChildBulletinsForZone(parent) {
    const st = _ensureState();
    const pn = _norm(parent);
    const arr = st.matched[pn];
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return arr.map((e) => ({
        time: e.time || '',
        title: e.title || '',
        pdfUrl: e.pdfUrl || '',
        file_nm: e.file_nm || '',
        national: false,
        child: true               // 자식-only 통보문 구분 플래그
    }));
}

// 디버그/관리자/테스트용 상태 조회
function getState() {
    const st = _ensureState();
    return {
        pendingCount: Object.keys(st.pendings).length,
        pendings: st.pendings,
        matchedParents: Object.keys(st.matched).length,
        matched: st.matched,
        updatedAt: st.updatedAt
    };
}

function _resetForTest() {
    _state = _emptyState();
    _pdfTextCache.clear();
}

module.exports = {
    registerChildChanges,
    tick,
    getChildBulletinsForZone,
    getState,
    // 테스트 노출
    _childNameCandidates,
    _matchInText,
    _getPdfText,
    _composeTitle,
    _tmFcFromRow,
    _resetForTest,
    _STATE_FILE,
    PENDING_HARD_CAP_MS
};
