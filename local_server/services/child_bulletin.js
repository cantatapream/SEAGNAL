'use strict';

// ============================================================================
// child_bulletin.js — 자식(연안바다/평수구역)-only 통보문 보강 (병합 최종본)
// ============================================================================
//
// [문제] GET /api/zone-bulletins 는 ef/list(부모 S1 행만 존재)로 통보문을 구성한다.
//   부모는 그대로인데 자식(S2/S3 = 연안바다/평수구역)만 발효/해제/격상되는 "자식-only
//   변경 통보문"은 ef/list 에 부모 행이 없어 목록에서 통째로 누락된다. 이 모듈이 그 누락분을 메운다.
//
// [설계 — 이벤트 기반, 사용자 합의 고정]
//   1. 전 지방청 상시 폴링 금지. 평상시(변동 없음·펜딩 없음) ntfctn 호출 0회.
//   2. 크롤러의 "확정 자식 변동"(기존 디바운스·의심가드 통과분 = _buildUserPushChanges 의
//      CHILD_ADD/CHILD_RELEASE/CHILD_*_EXTEND, 또는 자식 한정사를 동반한 부모 변동)에만
//      펜딩 등록. (새 글리치 로직을 만들지 않고 통과분에만 얹는다 — 글리치 가짜 등록 방지.)
//   3. 펜딩이 열린 동안, 매 cycle 그 부모의 관할 지방청(ZONE_HOME_OFFICE) ntfctn/list "만"
//      조회 → 새 file_nm 통보문 PDF 만 파싱(file_nm 단위 캐시, PDF 불변) → 본문에 부모명 +
//      바뀐 자식명이 들어있는지 확인.
//   4. 매칭되면 { 부모, 자식통보문:{time,title,pdfUrl,file_nm} } 영속 저장 → 그 펜딩 종료.
//   5. 고정 시간창 없음 — 매칭될 때까지 개방(데이터 조기기록/통보문 지연업로드 대응).
//   6. 안전망: (a) 상태 반전/후속 변동 시 펜딩 갱신/폐기(supersession),
//             (b) 하드 캡(6h) 도달 시 graceful 포기(무한 대기 방지).
//   7. 영속화: 매칭 자식 통보문 + 열린 펜딩을 디스크 atomic write(재시작 생존).
//   8. 라우트는 ef/list 부모 ∪ 저장 자식, file_nm dedup, tm_fc 최신순, 자식-only 구분 표식.
//
// [제약] 기존 라우트·푸시·크롤러 무영향. 관할청 1곳만. PDF 추출 실패 시 다음 cycle 재시도(캡 내).
//
// [실측 — 매칭 견고성의 핵심]
//   통보문 PDF 본문은 자식을 앱 정식명(예 '제주도북부앞바다중연안바다')이 아니라 축약형
//   (예 '제주도북부연안바다')으로 적는다. 또한 한 PDF 가 부모 발표(자식 제외)와 자식 해제를
//   동시에 담기도 한다. 실증(2026-06-02 184_17): 부모 '제주도북부앞바다(연안바다제외)' 발표 +
//   참고사항 '제주도북부연안바다해제'. 따라서 매칭은:
//     - 자식 정식명에서 여러 축약형 후보를 생성해 정규화(공백제거) 부분일치로 보고,
//     - '<후보>제외' 형태(부모가 자식을 *제외*한 표기)만 그 후보에서 배제한다.
//   (B 의 'PDF 전체에 "연안바다제외" 가 있으면 통째로 reject' 방식은 위 실증 케이스를
//    false-negative 로 떨어뜨리므로 채택하지 않고, A 의 후보별 정밀 배제를 쓴다.)
//
// [출처] 후보생성·매칭·supersession·하드캡 = A; file_nm 기반 KST 시각 정규화 = B;
//   독립명(부모 prefix 없는 고유 자식명) 처리 = C 보강. 단일 출처 ZONE_HOME_OFFICE 공유.

const fs = require('fs');
const path = require('path');
const https = require('https');

let pdfParse = null;
try { pdfParse = require('pdf-parse'); }
catch (e) { console.warn('[child-bulletin] pdf-parse 미설치 — 자식 통보문 매칭 비활성:', e && e.message); }

const MARINE_PDF_HOST = 'https://marine.kma.go.kr';
const NATIONAL_GO = '108';   // 본청(전국) — 연안/평수 미포함이라 자식 매칭 대상 아님
// [2026-07-12 실측] MMIS 통보사서함(warn/ntfctn/list)에 항목이 없는 관서 — 조회해도 영원히
//   0건이라 펜딩이 6h 하드캡까지 무익 폴링만 남긴다. 105(강원청): 최근 1개월·겨울 모두 0건
//   실측 + 강원청 통보문은 자식 연안·평수 명칭 자체를 표기하지 않아(내용 실측) 이중 무의미.
//   (zone_home_office 의 105 는 날씨누리 스캔·통보문 딥링크용으로는 유효 — 소비자별 분리.)
const NTFCTN_ABSENT_OFFICES = new Set(['105']);

// 영속 파일 — 타 크롤러 state 와 동일 디렉터리/atomic write 패턴.
const _DATA_DIR = path.join(__dirname, '..', 'data');
const _STATE_FILE = path.join(_DATA_DIR, 'child_bulletin_state.json');
const _STATE_TMP = _STATE_FILE + '.tmp';

// 펜딩 하드 캡 — 매칭 안 되면 이 시간 경과 시 graceful 포기. 통보문 지연업로드를 넉넉히 흡수.
const PENDING_HARD_CAP_MS = 6 * 60 * 60 * 1000;   // 6시간
// PDF 본문 파싱 캐시 — file_nm 단위(PDF 불변). 메모리. 정규화 텍스트만 보관.
const _pdfTextCache = new Map();                  // file_nm -> normalized text | null(파싱실패는 캐시 안 함)
const PDF_CACHE_MAX = 400;
let _warnedUnreadablePdf = false;                 // 판독불가(ToUnicode 부재) PDF 경고 1회 throttle
// 매칭 자식 통보문 보관 상한(부모당) — 라우트 dedup 후 50건 슬라이스라 넉넉히.
const MATCHED_PER_PARENT_MAX = 60;
// 부모당 동시 펜딩 상한 — supersession 누적 방지(오래된 것부터 폐기).
const PENDING_PER_PARENT_MAX = 6;
// ntfctn/list 조회 윈도우(일) — 펜딩 직후 최근 통보문만 보면 됨. 당일+전일(자정경계 흡수).
const NTFCTN_LOOKBACK_DAYS = 1;
// PDF fetch 타임아웃
const PDF_TIMEOUT_MS = 20000;

// ----------------------------------------------------------------------------
// 상태: 메모리 + 디스크 (lazy load).
//   pendings: { key -> { parent, children:[자식정식명...], changeType, detectedAt(ms),
//                        capUntil(ms), seenFiles:[file_nm...], tries } }
//   matched:  { parentNorm -> [ { time, title, pdfUrl, file_nm, children:[], matchedAt } ] }
// ----------------------------------------------------------------------------
let _state = null;

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

function _saveState() {
    try {
        if (!fs.existsSync(_DATA_DIR)) fs.mkdirSync(_DATA_DIR, { recursive: true });
        const obj = { ..._state, updatedAt: new Date().toISOString() };
        fs.writeFileSync(_STATE_TMP, JSON.stringify(obj), 'utf8');
        fs.renameSync(_STATE_TMP, _STATE_FILE);   // atomic
    } catch (e) {
        console.warn('[child-bulletin] state 저장 실패 (무시):', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 이름 정규화 / 후보 생성 (A 의 견고한 축약 후보생성 + C 의 독립명 처리 보강)
// ----------------------------------------------------------------------------
const _norm = (s) => String(s || '').replace(/[\s·.•・]/g, '');   // 공백 + 구분자(가운뎃점·마침표) 제거 — 통보문 '인천·경기'/'태안·서산' vs 정식 '인천.경기'/'태안.서산' 흡수

/**
 * 자식 정식명에서 PDF 본문에 등장할 만한 후보 문자열들을 생성.
 *   PDF 는 자식을 축약(예 '제주도북부앞바다중연안바다' → '제주도북부연안바다')해 적는다.
 *   - 정식명 자체
 *   - '중' 제거형: '제주도북부앞바다연안바다'
 *   - 부모 prefix 의 '앞바다'/'먼바다'/'바다' 꼬리 제거 후 + suffix:
 *       '제주도북부' + '연안바다' = '제주도북부연안바다'  ← 실측 형태
 *   - suffix 가 충분히 변별적(우도/가파도/추자도/조도 등 고유지명 포함)이면 그 자체도 후보.
 *   - '중' 이 없는 독립 고유명(예 '천수만평수구역')은 정식명 자체가 변별자(C 보강).
 * @returns {string[]} 정규화(공백제거)된 후보 배열 (중복 제거)
 */
function _childNameCandidates(childFull) {
    const full = _norm(childFull);
    const out = new Set();
    if (!full) return [];
    out.add(full);
    const idx = full.lastIndexOf('중');         // 자식꼬리엔 '중'이 없으므로 *마지막* '중'으로 분할
                                                //   (예 '강원중부앞바다중연안바다' → 첫 '중'에 걸려 깨지던 버그 수정)
    if (idx > 0 && idx < full.length - 1) {
        const prefix = full.slice(0, idx);     // 예: 제주도북부앞바다
        const suffix = full.slice(idx + 1);    // 예: 연안바다 / 동부평수구역 / 우도연안바다
        out.add(prefix + suffix);              // 중 제거형
        const locality = prefix
            .replace(/앞바다$/, '')
            .replace(/먼바다$/, '')
            .replace(/바다$/, '');
        if (locality && locality !== prefix) out.add(locality + suffix);
        // suffix 가 고유지명을 포함하면 단독 후보. 흔한 일반어 단독('연안바다'/'평수구역')은 변별력 없어 제외.
        if (suffix.length >= 5 && !/^연안바다$|^평수구역$|^동부평수구역$|^서부평수구역$|^남부평수구역$|^먼평수구역$|^앞평수구역$/.test(suffix)) {
            out.add(suffix);
        }
    }
    return Array.from(out);
}

// ----------------------------------------------------------------------------
// 매칭: PDF 본문(정규화)에 부모명 + 변경 자식명(후보 중 하나)이 모두 있으면 매칭.
//   '<후보>제외'(부모가 그 자식을 *제외*한 표기) 형태만 그 후보 매칭에서 배제한다.
//   같은 후보가 본문에서 '제외'가 아닌 곳에 한 번이라도 등장하면 정상 매칭으로 인정.
// ----------------------------------------------------------------------------
/** text 에서 needle 이 '제외' 가 아닌 문맥으로 한 번이라도 등장하는가? */
function _includesNonExcluded(text, needle) {
    if (!needle) return false;
    let from = 0;
    while (true) {
        const i = text.indexOf(needle, from);
        if (i < 0) return false;
        const after = text.slice(i + needle.length, i + needle.length + 2);
        if (after !== '제외') return true;   // '제외' 직후가 아니면 진짜 등장
        from = i + needle.length;
    }
}

/** 정규화 본문에서 `head(` … `)` 괄호 그룹의 내용들을 모두 반환. */
function _parenGroupsAfter(text, head) {
    const groups = [];
    if (!head) return groups;
    const needle = head + '(';
    let from = 0;
    while (true) {
        const i = text.indexOf(needle, from);
        if (i < 0) break;
        const start = i + needle.length;
        const end = text.indexOf(')', start);
        if (end < 0) break;
        groups.push(text.slice(start, end));
        from = end + 1;
    }
    return groups;
}

/**
 * 한 자식이 본문에 등장하는가? 두 경로를 모두 시도한다.
 *   A) 독립 축약/고유명 후보 (예: 참고사항의 '제주도북부연안바다', 지명형 '천수만평수구역').
 *   B) 괄호 그룹형 '부모명( … 자식꼬리 … )' — 지방청 통보문의 표준 표기. 일반어 자식꼬리
 *      ('연안바다'/'평수구역'/'먼평수구역' 등)는 변별력이 없어 A 에선 못 잡지만, *부모 괄호
 *      그룹 안의 콤마 토큰*으로는 변별 가능. 토큰이 '…제외' 면 그 자식 *제외* 표기라 배제.
 */
function _matchChild(text, parentNorm, childFull) {
    // Path A — 독립 후보
    if (_childNameCandidates(childFull).some((c) => _includesNonExcluded(text, c))) return true;
    // Path B — 괄호 그룹
    const full = _norm(childFull);
    const ci = full.lastIndexOf('중');
    const suffix = (ci > 0 && ci < full.length - 1) ? full.slice(ci + 1) : full;
    if (!suffix) return false;
    const heads = new Set([parentNorm]);
    if (ci > 0) heads.add(full.slice(0, ci));   // 자식명에 들어있는 부모 prefix 도 head 후보
    for (const head of heads) {
        for (const group of _parenGroupsAfter(text, head)) {
            for (const tok of group.split(',')) {
                if (!tok) continue;
                if (tok.slice(-2) === '제외') continue;   // '…제외' 토큰 = 그 자식 제외 표기
                if (tok === suffix) return true;          // 콤마 토큰 정확 일치(부분일치 오탐 방지)
            }
        }
    }
    return false;
}

/**
 * @returns {string[]|null} 매칭된 자식 정식명 배열 (없으면 null)
 */
function _matchInText(text, parent, children) {
    if (!text) return null;
    const parentNorm = _norm(parent);
    // 부모명 또는 그 핵심(앞/먼바다 꼬리 제거)이 본문에 있어야 함.
    const parentCore = parentNorm.replace(/앞바다$/, '').replace(/먼바다$/, '');
    // core 2자(부산·울산)도 인정 — 자식 후보가 변별자라 게이트 완화의 오탐 위험은 낮음.
    const hasParent = text.includes(parentNorm) || (parentCore.length >= 2 && text.includes(parentCore));
    if (!hasParent) return null;
    const hit = [];
    for (const child of children) {
        if (_matchChild(text, parentNorm, child)) hit.push(child);
    }
    return hit.length ? hit : null;
}

// ----------------------------------------------------------------------------
// [SPEC §2] 확정 자식 변동 등록 — 크롤러의 _buildUserPushChanges 결과를 받아 처리.
//   change = { type, zone, childState:{ all, active, added:[], released:[], extended?:[] } }
//   부모 변동(CURRENT_CHANGE/UPCOMING_CHANGE 등)의 childState 는 added/released 가 비어
//   있으므로(=실제 자식 set 변동 아님) 자연히 등록 대상에서 빠진다. 자식 set/등급이 실제로
//   바뀐 CHILD_ADD/CHILD_RELEASE/CHILD_*_EXTEND 만 added/released/extended 가 채워진다.
//   → 새 글리치 로직 없이 "확정 푸시 신호"에만 얹는다. (글리치 가짜 등록 방지)
// ----------------------------------------------------------------------------
const _CHILD_CHANGE_TYPES = new Set([
    'CHILD_ADD', 'CHILD_RELEASE', 'CHILD_EF_EXTEND', 'CHILD_YN_EXTEND',
    'CHILD_TIME_EF_CHANGE', 'CHILD_TIME_YN_CHANGE'   // 수정 #3 — 자식 단독 시각/해제예고 변경
]);

/**
 * @param {Array} userChanges  crawler._buildUserPushChanges() 반환 배열 (확정 푸시 신호)
 * @param {Object} zoneHomeOffice  { 부모명 -> prdc_go } 단일 출처 매핑
 * @returns {number} 새로 연 펜딩 수
 */
function registerChildChanges(userChanges, zoneHomeOffice) {
    if (!Array.isArray(userChanges) || userChanges.length === 0) return 0;
    const zho = zoneHomeOffice || {};
    const st = _ensureState();
    const now = Date.now();
    let opened = 0;
    let dirty = false;

    // 관할청 정규화 매핑(부모명 공백제거 키)
    const homeNormMap = {};
    for (const k of Object.keys(zho)) homeNormMap[_norm(k)] = zho[k];

    for (const ch of userChanges) {
        if (!ch || !ch.zone) continue;
        const parent = ch.zone;
        // 관할청이 없거나 108(전국 폴백)이면 ntfctn 으로 좁혀 받을 수 없어 펜딩 무의미 → skip.
        const home = homeNormMap[_norm(parent)];
        if (!home || home === NATIONAL_GO || NTFCTN_ABSENT_OFFICES.has(home)) continue;

        const cs = ch.childState || {};
        const changed = []
            .concat(Array.isArray(cs.added) ? cs.added : [])
            .concat(Array.isArray(cs.released) ? cs.released : [])
            .concat(Array.isArray(cs.extended) ? cs.extended : [])
            // [수정 #3] 자식 단독 시각/해제예고 변경(CHILD_TIME_*_CHANGE)도 통보문 보강 대상.
            .concat(Array.isArray(cs.timeChanged) && cs.parentTimeUnchanged === true ? cs.timeChanged : []);
        const uniq = Array.from(new Set(changed.filter(Boolean)));
        if (uniq.length === 0) continue;   // 실제 자식 set 변동 없음(부모만 변동) → 등록 안 함

        const key = parent + '|' + uniq.slice().sort().join(',');
        const ex = st.pendings[key];
        if (ex) {
            // [안전망 a — supersession] 후속 동일 변동 재확정 → 캡 리셋 + 최신 변동 기준 갱신.
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
        if (_CHILD_CHANGE_TYPES.has(ch.type)) { /* 명시적 자식 변동 — 로깅만 생략 */ }
        console.log(`[child-bulletin] 펜딩 등록: ${parent} [${uniq.join('/')}] (관할청 ${home}, ${ch.type || ''})`);
    }

    _capPendingsPerParent(st);
    if (dirty) _saveState();
    return opened;
}

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

// 참고(안전망): 글리치성 자식 반전은 상류 `_applyChildReleaseDebounce`(3분)에서 흡수되어
//   애초에 확정 변동으로 등록되지 않으며, 무한 대기는 하드 캡(PENDING_HARD_CAP_MS)으로 차단된다.
//   "반전 시 펜딩 강제 폐기"는 진짜 짧은 해제의 통보문을 잃을 수 있어 두지 않는다.

// ----------------------------------------------------------------------------
// PDF 본문 추출 — file_nm 단위 캐시(PDF 불변). 실패 시 캐시 안 함(재시도 허용).
// ----------------------------------------------------------------------------
function _downloadPdf(fileNm) {
    return new Promise((resolve, reject) => {
        const url = MARINE_PDF_HOST + fileNm;
        const req = https.get(url, { rejectUnauthorized: false, timeout: PDF_TIMEOUT_MS }, (res) => {
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
    if (_pdfTextCache.has(fileNm)) return _pdfTextCache.get(fileNm);
    if (!pdfParse) return null;
    let text = null;
    try {
        const buf = await _downloadPdf(fileNm);
        const d = await pdfParse(buf);
        text = _norm(d && d.text);
        if (!text) return null;   // 빈 추출 → 캐시 안 함(다음 cycle 재시도)
        // KMA 통보문 PDF 중 일부(예: ~2025-11 이전)는 ToUnicode CMap 없는 CID 서브셋 폰트라
        //   한글이 글리프 코드로만 추출돼 본문 판독이 불가능하다(현재 통보문은 정상). 한글이
        //   거의 없으면 판독 불가로 보고 캐시하지 않는다(폰트 정상 PDF로 바뀌면 재시도).
        if ((text.match(/[가-힣]/g) || []).length < 2) {
            if (!_warnedUnreadablePdf) {
                console.warn('[child-bulletin] 통보문 PDF 한글 추출 불가(ToUnicode 부재 가능) — 매칭 skip:', fileNm);
                _warnedUnreadablePdf = true;
            }
            return null;
        }
    } catch (e) {
        return null;              // 다운로드/파싱 실패 → 캐시 안 함(재시도)
    }
    if (_pdfTextCache.size >= PDF_CACHE_MAX) {
        const firstKey = _pdfTextCache.keys().next().value;
        _pdfTextCache.delete(firstKey);
    }
    _pdfTextCache.set(fileNm, text);
    return text;
}

// ----------------------------------------------------------------------------
// 시각 정규화 — file_nm 기반 KST "YYYY.MM.DD HH:mm" (B). ef/list 표기·정렬과 통일.
//   ntfctn tm_fc 는 UTC ISO 라 ef/list 표기와 어긋남 → file_nm 의 12자리 KST 로 통일.
// ----------------------------------------------------------------------------
function _displayTimeFromFileNm(fileNm) {
    const m = String(fileNm || '').match(/_(\d{12})_/);
    if (!m) return '';
    const t = m[1];
    return `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`;
}

function _kstYmd(offsetDays) {
    const kst = new Date(Date.now() + 9 * 3600000 + (offsetDays || 0) * 86400000);
    return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function _composeTitle(row, hitChildren) {
    // ntfctn warn_title 예: '[ 특보 ] 제06-17호 : 2026.06.02.11:30 / 풍랑주의보 발표'
    //   → 사용자에게 자식명 + 통보문 종류를 노출(자식-only 임을 구분).
    const raw = String((row && row.warn_title) || '').trim();
    let tail = raw;
    const slash = raw.lastIndexOf('/');
    if (slash >= 0) tail = raw.slice(slash + 1).trim();
    const childLabel = (hitChildren && hitChildren.length) ? hitChildren.join('·') : '';
    return childLabel ? `${childLabel} ${tail}`.trim() : (tail || raw);
}

function _recordMatch(st, parent, entry) {
    const pn = _norm(parent);
    const arr = st.matched[pn] = st.matched[pn] || [];
    const dedupKey = entry.file_nm + '|' + (entry.children || []).slice().sort().join(',');
    if (arr.some((e) => (e.file_nm + '|' + (e.children || []).slice().sort().join(',')) === dedupKey)) return;
    arr.push(entry);
    arr.sort((a, b) => (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));
    if (arr.length > MATCHED_PER_PARENT_MAX) arr.length = MATCHED_PER_PARENT_MAX;
}

// ----------------------------------------------------------------------------
// [SPEC §3,§4,§5,§6] 매 cycle 틱 — 열린 펜딩의 부모 관할청 ntfctn/list 만 조회 → 매칭.
// ----------------------------------------------------------------------------
/**
 * @param {Object} deps { marineClient, zoneHomeOffice }
 * @returns {Promise<{ matched:number, gaveUp:number, offices:number }>}
 */
async function tick(deps) {
    const st = _ensureState();
    const now = Date.now();
    const marineClient = deps && deps.marineClient;
    const zho = (deps && deps.zoneHomeOffice) || {};
    if (!marineClient || typeof marineClient.fetchWarnNtfctnList !== 'function') {
        return { matched: 0, gaveUp: 0, offices: 0 };
    }

    const pendingEntries = Object.entries(st.pendings);
    if (pendingEntries.length === 0) return { matched: 0, gaveUp: 0, offices: 0 };   // 평상시 0회

    const homeNormMap = {};
    for (const k of Object.keys(zho)) homeNormMap[_norm(k)] = zho[k];

    let dirty = false;
    let gaveUp = 0;

    // [안전망 b] 하드 캡 도달 펜딩 graceful 포기.
    for (const [key, p] of pendingEntries) {
        if (now >= (p.capUntil || 0)) {
            delete st.pendings[key];
            gaveUp++;
            dirty = true;
            console.log(`[child-bulletin] 펜딩 캡 도달 — graceful 포기: ${p.parent} [${(p.children || []).join(',')}]`);
        }
    }

    // 남은 펜딩 → 관할 지방청(prdc_go) 묶음 (108/미등록은 skip).
    const officeToPendings = new Map();
    for (const [key, p] of Object.entries(st.pendings)) {
        const home = homeNormMap[_norm(p.parent)];
        if (!home || home === NATIONAL_GO || NTFCTN_ABSENT_OFFICES.has(home)) continue;
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
        // file_nm 단위로 신규만 파싱. 같은 file_nm 의 첫 row(메타) 보관.
        const byFile = new Map();
        for (const r of safeRows) {
            const fn = String((r && r.file_nm) || '').trim();
            if (!fn) continue;
            // file_nm 의 prdc_go 가 office 와 다르면 skip(다른 청 PDF 혼입 방지).
            const fm = fn.match(/_(\d{3,4})_\d+\.pdf$/);
            if (fm && fm[1] !== String(office)) continue;
            if (!byFile.has(fn)) byFile.set(fn, r);
        }

        for (const [key, p] of pendings) {
            if (!st.pendings[key]) continue;   // 위 캡으로 폐기됐을 수 있음
            const seen = new Set(p.seenFiles || []);
            let resolvedHere = false;
            // 감지시각 이전(여유 10분) 통보문은 무관 → skip(옛 PDF 재파싱 방지).
            //   file_nm 의 12자리(KST) 와 비교 — 동일 포맷이라 문자열 비교로 충분.
            const detectFloor = _ymdHmKeyFromMs(p.detectedAt - 10 * 60 * 1000);
            for (const [fn, row] of byFile.entries()) {
                if (resolvedHere) break;
                const tmKey = (fn.match(/_(\d{12})_/) || [])[1] || '';
                if (tmKey && detectFloor && tmKey < detectFloor) continue;   // 감지 전 통보문 skip
                if (seen.has(fn)) continue;
                const text = await _getPdfText(fn);
                if (text === null) continue;   // 파싱 실패 → seen 에 안 넣음(재시도)
                seen.add(fn);
                const hit = _matchInText(text, p.parent, p.children);
                if (hit) {
                    _recordMatch(st, p.parent, {
                        time: _displayTimeFromFileNm(fn) || String(row.tm_fc || ''),
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
                    console.log(`[child-bulletin] ✅ 매칭: ${p.parent} ← ${fn.split('/').pop()} [${hit.join(',')}]`);
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

// ----------------------------------------------------------------------------
// [SPEC §8] 라우트용 — 부모의 저장된 자식 통보문 반환.
//   반환: [{ time, title, pdfUrl, file_nm, national:false, childOnly:true }]
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
        childOnly: true   // 자식-only 통보문 구분 플래그(프론트 〔연안/평수〕 표식)
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
    _includesNonExcluded,
    _getPdfText,
    _composeTitle,
    _displayTimeFromFileNm,
    _resetForTest,
    _STATE_FILE,
    PENDING_HARD_CAP_MS
};
