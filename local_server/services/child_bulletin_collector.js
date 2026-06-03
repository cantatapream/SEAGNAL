/**
 * ============================================================================
 * 파일명: services/child_bulletin_collector.js
 * 역할: 자식(연안바다/평수구역) 통보문을 부모 해역 통보문 목록에 반영하기 위한
 *       이벤트 기반 수집기.
 *
 * [배경]
 *   GET /api/zone-bulletins 는 ef/list(부모 행만 존재)로 통보문 목록을 만든다.
 *   부모는 변화가 없고 자식(S2/S3 = 연안바다/평수구역)만 바뀌는 통보문은 ef/list 에
 *   부모 행이 없어 목록에서 통째로 누락된다. 이 모듈이 그 누락분을 메운다.
 *
 * [설계 (사용자 합의 — 고정)]
 *   1. 이벤트 기반. 전 지방청 상시 폴링 금지.
 *   2. 크롤러의 "확정 자식 변동"(기존 디바운스·의심가드 통과분) 에만 펜딩 등록.
 *      → notePendingChildChanges() 가 크롤러 run() 말미에서 호출됨.
 *   3. 펜딩이 열린 동안 매 사이클 그 부모의 관할 지방청(ZONE_HOME_OFFICE) ntfctn/list
 *      "만" 조회 → 새 PDF 만 파싱(file_nm 캐시, 불변) → 본문에 부모명+자식명 포함 확인.
 *      → tick() 가 크롤러 run() 사이클마다 호출됨(펜딩 없으면 0 호출).
 *   4. 매칭 시 { 부모, 자식통보문:{time,title,pdfUrl,file_nm} } 영속 저장 → 그 펜딩 종료.
 *   5. 고정 시간창 없음 — 매칭될 때까지 개방(데이터 조기기록/통보문 지연업로드 대응).
 *   6. 안전망: ① 상태반전/후속변동 시 펜딩 자동 폐기, ② 하드 캡(시도횟수) 도달 시 graceful 포기.
 *   7. 영속화: 매칭 자식통보문 + 열린 펜딩을 디스크 저장(재시작 생존).
 *   8. /api/zone-bulletins 는 ef/list 부모 ∪ 저장된 자식통보문, file_nm dedup, 최신순.
 *
 * [제약]
 *   - 기존 라우트·푸시·크롤러 동작 무영향. 평상시 ntfctn 호출 0. 관할청 1곳.
 *   - PDF 추출 실패 시 정규화(공백제거) 매칭 + 다음 사이클 재시도(캡 내).
 *   - 외부 라이브러리는 node built-in https + 기존 pdf-parse 만 사용.
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const marineClient = require('./marine_client');

// ----------------------------------------------------------------------------
// 상수
// ----------------------------------------------------------------------------
const MARINE_PDF_HOST = 'https://marine.kma.go.kr';
const STORE_FILE = path.join(__dirname, '..', 'data', 'child_bulletins.json');
const STORE_TMP = STORE_FILE + '.tmp';

// 펜딩 폴링 하드 캡 — 무한대기 금지(안전망 ②).
// 크롤러는 ~1분 주기 → 캡 720회 ≈ 약 12시간 관찰 후 graceful 포기.
const MAX_POLL_ATTEMPTS = 720;
// ntfctn/list 조회 시 file_nm 날짜로 좁히는 조회 범위(KST 기준, 펜딩 시작일 ±여유).
const NTFCTN_LOOKBACK_DAYS = 1;
// 저장 자식 통보문 보존 상한(파일 비대화 방지) — file_nm 기준 dedup 후 최신 N건.
const MAX_STORED = 400;

// [해역 → 관할 지방청 prdc_go] — routes/weather.js ZONE_HOME_OFFICE 와 동일한 정적 매핑.
//   PDF 원문 내용검증으로 생성한 1차 진실. '108' = 지방청 PDF 에 해역명이 확인 안 돼
//   전국(본청)으로 폴백하는 해역 → ntfctn/list 로 좁혀 받을 수 없어 펜딩 대상에서 제외.
const ZONE_HOME_OFFICE = {
    '강원남부앞바다': '108', '강원북부앞바다': '108', '강원중부앞바다': '108',
    '경북남부앞바다': '143', '경북북부앞바다': '143',
    '남해동부바깥먼바다': '159', '남해동부안쪽먼바다': '159',
    '남해서부동쪽먼바다': '156', '남해서부서쪽먼바다': '184',
    '동해남부남쪽바깥먼바다': '159', '동해남부남쪽안쪽먼바다': '159',
    '동해남부북쪽바깥먼바다': '143', '동해남부북쪽안쪽먼바다': '143',
    '동해중부바깥먼바다': '105', '동해중부안쪽먼바다': '105',
    '부산앞바다': '159',
    '서해남부남쪽바깥먼바다': '156', '서해남부남쪽안쪽먼바다': '156',
    '서해남부북쪽바깥먼바다': '156', '서해남부북쪽안쪽먼바다': '156',
    '서해중부바깥먼바다': '109', '서해중부안쪽먼바다': '109',
    '울산앞바다': '159',
    '인천·경기남부앞바다': '109', '인천·경기북부앞바다': '109',
    '전남남부서해앞바다': '156', '전남북부서해앞바다': '156', '전남중부서해앞바다': '156',
    '전북남부앞바다': '146', '전북북부앞바다': '146',
    '제주도남동쪽안쪽먼바다': '184', '제주도남부앞바다': '184', '제주도남서쪽안쪽먼바다': '184',
    '제주도남쪽바깥먼바다': '184', '제주도동부앞바다': '184', '제주도북부앞바다': '184',
    '제주도서부앞바다': '184',
    '충남남부앞바다': '133', '충남북부앞바다': '133'
};

/** 부모 해역 → 관할 지방청 prdc_go (미등록/108 폴백이면 null). */
function homeOfficeFor(parent) {
    const g = ZONE_HOME_OFFICE[parent];
    return (g && g !== '108') ? g : null;
}

// pdf-parse 는 root node_modules 에서 resolve. 미존재 시 graceful(매칭 비활성).
let _pdfParse = null;
try { _pdfParse = require('pdf-parse'); }
catch (e) { console.warn('[child_bulletin] pdf-parse 미로드 — PDF 매칭 비활성:', e && e.message); }

// ----------------------------------------------------------------------------
// 영속 상태 (디스크)
//   { pendings: { [key]: PendingEntry }, matched: { [file_nm]: MatchedBulletin },
//     pdfCache: { [file_nm]: { parents:[], norm:'' }|null } }
//   - pdfCache 값 null = 파싱 실패(다음 사이클 재시도 대상). 객체 = 파싱 성공(불변 캐시).
// ----------------------------------------------------------------------------
let _store = null;

function _emptyStore() {
    return { pendings: {}, matched: {}, pdfFail: {} };
}

function _load() {
    if (_store) return _store;
    try {
        if (fs.existsSync(STORE_FILE)) {
            const j = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
            _store = {
                pendings: (j && j.pendings) || {},
                matched: (j && j.matched) || {},
                pdfFail: (j && j.pdfFail) || {}
            };
            return _store;
        }
    } catch (e) {
        console.warn('[child_bulletin] store 복원 실패 (무시):', e && e.message);
    }
    _store = _emptyStore();
    return _store;
}

function _save() {
    try {
        const dir = path.dirname(STORE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // matched dedup + 보존 상한
        const s = _load();
        const entries = Object.values(s.matched);
        if (entries.length > MAX_STORED) {
            entries.sort((a, b) => (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));
            const keep = {};
            for (const e of entries.slice(0, MAX_STORED)) keep[e.file_nm] = e;
            s.matched = keep;
        }
        fs.writeFileSync(STORE_TMP, JSON.stringify(s), 'utf8');
        fs.renameSync(STORE_TMP, STORE_FILE);
    } catch (e) {
        console.warn('[child_bulletin] store 저장 실패 (무시):', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 정규화 / 매칭 헬퍼
// ----------------------------------------------------------------------------
const _norm = (s) => String(s || '').replace(/\s+/g, '');

/**
 * file_nm(KTKO50_<YYYYMMDDHHMM>_<go>_<seq>.pdf)의 timestamp 를 ef/list 와 동일한
 * 표시형식 "YYYY.MM.DD HH:mm"(KST)로 변환. /api/zone-bulletins 의 최신순 정렬·표기 일관성용.
 * (ntfctn/list tm_fc 는 UTC ISO 라 ef/list 표기와 정렬·표시가 어긋남 → file_nm 기준 통일.)
 * @returns {string} 표시형식 시각, 실패 시 ''
 */
function _displayTimeFromFileNm(fileNm) {
    const m = String(fileNm || '').match(/_(\d{12})_/);
    if (!m) return '';
    const t = m[1];
    return `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`;
}

/**
 * 자식 full name 에서 매칭에 쓸 "자식 식별 토큰" 추출.
 *   자식명 패턴: <부모>중<접미> (예: 제주도북부앞바다중연안바다, 울산앞바다중평수구역)
 *   또는 부모 prefix 없는 독립명(예: 천수만평수구역, 울릉도울릉읍연안바다).
 *   PDF 본문은 "제주도북부앞바다(연안바다)" 처럼 괄호형으로 자식을 표기하므로,
 *   접미('연안바다'/'평수구역' 및 그 한정사)를 토큰으로 잡아 부모명과 함께 검증한다.
 * @returns {string} 정규화된 자식 식별 토큰
 */
function _childSuffixToken(parent, childFull) {
    const c = _norm(childFull);
    const idx = c.indexOf('중');
    if (idx > 0) return c.slice(idx + 1);   // '중' 이후 접미
    // '중' 없음 — 부모 prefix 가 붙어있으면 떼고, 아니면 통째로 토큰.
    const p = _norm(parent);
    if (p && c.startsWith(p)) return c.slice(p.length);
    return c;
}

/**
 * PDF 본문(정규화)에 부모명 + 자식 토큰이 모두 들어있는지 검사.
 *   - 부모명은 그대로 포함되어야 함.
 *   - 자식 토큰은 통째로, 또는 '연안바다'/'평수구역' 핵심어 + 변별 토큰 일부로 완화 매칭.
 * @returns {boolean}
 */
function _pdfMatchesChild(pdfNorm, parent, childFull) {
    if (!pdfNorm) return false;
    const p = _norm(parent);
    const cFull = _norm(childFull);
    const tok = _childSuffixToken(parent, childFull);
    if (!tok) return false;

    // [제외 가드] 부모 통보문 본문은 "<부모>(연안바다 제외)" 처럼 자식을 *제외*했다고
    //   명시한다. 이 경우 자식 통보문이 아니라 부모 통보문이므로 매칭에서 배제한다.
    const excluded = (core) => pdfNorm.includes(core + '제외');

    // [독립명 자식] 자식 full name 이 부모 prefix·'중' 없이 고유명(천수만평수구역,
    //   울릉도울릉읍연안바다 등)인 경우 → 그 고유명 자체가 변별자. 부모명 포함 불요.
    const isStandalone = cFull.indexOf('중') < 0 && !(p && cFull.startsWith(p));
    if (isStandalone) {
        if (pdfNorm.includes(cFull) && !pdfNorm.includes(cFull + '제외')) return true;
        return false;
    }

    // [부모 종속 자식] 부모명이 본문에 있어야 하고, 자식 토큰(또는 핵심어 인접)이 함께 있어야 함.
    if (!p || !pdfNorm.includes(p)) return false;
    if (pdfNorm.includes(tok) && !pdfNorm.includes(tok + '제외')) return true;
    // 완화: 핵심어(연안바다/평수구역)가 부모명 인접(±40자)에 함께 등장하면 매칭으로 인정.
    for (const core of ['연안바다', '평수구역']) {
        if (tok.includes(core) && pdfNorm.includes(core) && !excluded(core)) {
            const pi = pdfNorm.indexOf(p);
            const ci = pdfNorm.indexOf(core);
            if (pi >= 0 && ci >= 0 && Math.abs(pi - ci) <= 40) return true;
        }
    }
    return false;
}

// ----------------------------------------------------------------------------
// PDF fetch
// ----------------------------------------------------------------------------
function _fetchPdf(fileNm) {
    return new Promise((resolve, reject) => {
        const url = MARINE_PDF_HOST + fileNm;
        const req = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/child-bulletin)' },
            timeout: 15000
        }, (r) => {
            if (r.statusCode !== 200) {
                r.resume();
                reject(new Error('PDF HTTP ' + r.statusCode));
                return;
            }
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('PDF timeout')));
    });
}

/**
 * file_nm 의 PDF 를 1회 파싱하여 정규화 본문 반환.
 *   성공 시 pdfFail 캐시에서 제거(불변 — 한 번 파싱 성공한 file_nm 은 재요청 안 함:
 *   상위 tick() 가 이미 파싱된 파일은 skip). 실패 시 pdfFail 에 기록(다음 사이클 재시도).
 * @returns {Promise<string|null>} 정규화 본문 or null(실패)
 */
async function _parsePdf(fileNm) {
    if (!_pdfParse) return null;
    try {
        const buf = await _fetchPdf(fileNm);
        const data = await _pdfParse(buf);
        return _norm(data && data.text);
    } catch (e) {
        return null;
    }
}

// ----------------------------------------------------------------------------
// ntfctn/list 조회 — KST 날짜 헬퍼
// ----------------------------------------------------------------------------
function _ymdKST(offsetDays) {
    const kst = new Date(Date.now() + 9 * 3600000 + (offsetDays || 0) * 86400000);
    return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// ============================================================================
// 공개 API
// ============================================================================

/**
 * [설계 §2] 확정 자식 변동을 펜딩으로 등록.
 *   크롤러 run() 말미(디바운스·의심가드 통과 후)에서, 직전 사이클 대비 자식 set/등급이
 *   실제로 바뀐 (부모,자식) 쌍 목록을 받아 펜딩에 등록한다. 이미 매칭/펜딩이면 no-op.
 *
 * @param {Array<{parent:string, child:string, home:string}>} changes
 *   - parent: 부모 해역명, child: 자식 full name, home: 부모 관할 지방청 prdc_go(ZONE_HOME_OFFICE)
 */
function notePendingChildChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) return;
    const s = _load();
    const now = Date.now();
    let dirty = false;
    for (const ch of changes) {
        const parent = ch && ch.parent;
        const child = ch && ch.child;
        const home = ch && ch.home;
        if (!parent || !child || !home) continue;
        // 관할청 미상('108' 전국 폴백 해역)은 ntfctn/list 로 좁혀 받을 수 없어 펜딩 무의미 → skip.
        if (home === '108') continue;
        const key = parent + '|' + child;
        if (s.pendings[key]) continue;   // 이미 열린 펜딩
        s.pendings[key] = {
            parent, child, home,
            openedAt: now,
            startYmd: _ymdKST(0),
            attempts: 0,
            seen: {}   // 이 펜딩 동안 이미 파싱한 file_nm 집합(불변 캐시)
        };
        dirty = true;
        console.log(`[child_bulletin] 펜딩 등록: ${parent} > ${child} (관할청 ${home})`);
    }
    if (dirty) _save();
}

/**
 * [설계 §6①] 상태 반전/후속 변동 시 열린 펜딩을 폐기.
 *   크롤러가 같은 (부모,자식)에 대해 또 다른 확정 변동을 감지하면 직전 펜딩은
 *   이미 의미가 없어졌을 수 있으므로, 새 등록 전에 기존 펜딩을 자동 폐기한다.
 *   (notePendingChildChanges 에서 새 변동을 받으면 같은 key 펜딩을 갱신하지 않고
 *    유지하지만, 명시적 폐기가 필요할 때 이 함수를 쓴다.)
 * @param {Array<{parent:string, child:string}>} pairs
 */
function discardPendings(pairs) {
    if (!Array.isArray(pairs) || !pairs.length) return;
    const s = _load();
    let dirty = false;
    for (const pr of pairs) {
        const key = (pr && pr.parent) + '|' + (pr && pr.child);
        if (s.pendings[key]) {
            console.log(`[child_bulletin] 펜딩 폐기(후속 변동): ${pr.parent} > ${pr.child}`);
            delete s.pendings[key];
            dirty = true;
        }
    }
    if (dirty) _save();
}

/**
 * [설계 §3·§4] 열린 펜딩에 대해 관할 지방청 ntfctn/list 를 조회하고 PDF 본문으로 매칭.
 *   - 펜딩 없으면 즉시 return(ntfctn 호출 0 — 평상시 비용 없음).
 *   - 같은 관할청의 여러 펜딩은 ntfctn/list 1회로 묶어 처리.
 *   - 새 file_nm 만 파싱(펜딩별 seen 캐시). 매칭 시 store.matched 에 영속 저장 후 펜딩 종료.
 *   - [§6②] attempts 가 MAX_POLL_ATTEMPTS 도달하면 graceful 포기.
 *   - 인증 미설정/네트워크 실패는 graceful — 이번 사이클 skip, 펜딩 유지(다음 재시도).
 */
async function tick() {
    const s = _load();
    const keys = Object.keys(s.pendings);
    if (!keys.length) return;   // 평상시: ntfctn 호출 0

    // 관할청별 펜딩 묶기 + 조회 날짜 범위 산정
    const byHome = new Map();   // home -> { keys:[], minYmd }
    for (const key of keys) {
        const p = s.pendings[key];
        if (!byHome.has(p.home)) byHome.set(p.home, { keys: [], minYmd: p.startYmd });
        const g = byHome.get(p.home);
        g.keys.push(key);
        if (p.startYmd < g.minYmd) g.minYmd = p.startYmd;
    }

    let dirty = false;
    for (const [home, g] of byHome) {
        // 조회 범위: 가장 이른 펜딩 시작일 - lookback ~ 오늘.
        const minD = new Date(
            Number(g.minYmd.slice(0, 4)),
            Number(g.minYmd.slice(4, 6)) - 1,
            Number(g.minYmd.slice(6, 8))
        );
        const stYmd = (() => {
            const d = new Date(minD.getTime() - NTFCTN_LOOKBACK_DAYS * 86400000);
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        })();
        const edYmd = _ymdKST(0);

        let rows;
        try {
            rows = await marineClient.fetchWarnNtfctnList({ prdc_go: home, st_tm: stYmd, ed_tm: edYmd });
        } catch (e) {
            console.warn(`[child_bulletin] ntfctn/list 조회 실패(관할청 ${home}) — 펜딩 유지:`, e && e.message);
            continue;   // graceful — 펜딩 유지, 다음 사이클 재시도
        }
        const list = Array.isArray(rows) ? rows : [];

        // 모든 펜딩 시도횟수 +1 (실제 조회가 일어난 사이클만 카운트)
        for (const key of g.keys) s.pendings[key].attempts += 1;
        dirty = true;

        // 이번 관할청의 새 file_nm 만 파싱(펜딩 합집합의 seen 기준) → 본문 캐시
        const pdfNormByFile = {};   // file_nm -> norm text | null
        const fileMeta = {};        // file_nm -> { tm_fc, warn_title }
        for (const r of list) {
            const fileNm = String(r.file_nm || '').trim();
            if (!fileNm) continue;
            if (!fileMeta[fileNm]) {
                fileMeta[fileNm] = {
                    tm_fc: String(r.tm_fc || '').trim(),
                    warn_title: String(r.warn_title || '').trim()
                };
            }
        }

        for (const key of g.keys) {
            const pend = s.pendings[key];
            let matched = false;
            for (const fileNm of Object.keys(fileMeta)) {
                if (pend.seen[fileNm]) continue;   // 이 펜딩에서 이미 검사한 파일(불변)
                // 본문 파싱(파일당 1회, 관할청 사이클 내 공유)
                if (!(fileNm in pdfNormByFile)) {
                    pdfNormByFile[fileNm] = await _parsePdf(fileNm);
                }
                const norm = pdfNormByFile[fileNm];
                if (norm == null) {
                    // 파싱 실패 — seen 으로 마킹하지 않음(다음 사이클 재시도). pdfFail 기록.
                    s.pdfFail[fileNm] = (s.pdfFail[fileNm] || 0) + 1;
                    continue;
                }
                // 파싱 성공 → 이 펜딩에서 검사 완료 처리(매칭 여부와 무관, 본문 불변)
                pend.seen[fileNm] = true;
                if (_pdfMatchesChild(norm, pend.parent, pend.child)) {
                    const meta = fileMeta[fileNm];
                    s.matched[fileNm] = {
                        parent: pend.parent,
                        child: pend.child,
                        // 표시·정렬은 ef/list 와 동일한 KST "YYYY.MM.DD HH:mm" 로 통일(file_nm 기준).
                        //   파싱 실패 시 ntfctn tm_fc(ISO) 폴백.
                        time: _displayTimeFromFileNm(fileNm) || meta.tm_fc,
                        title: meta.warn_title,
                        file_nm: fileNm,
                        pdfUrl: MARINE_PDF_HOST + fileNm,
                        childOnly: true,
                        matchedAt: new Date().toISOString()
                    };
                    console.log(`[child_bulletin] ✅ 매칭: ${pend.parent} > ${pend.child} → ${fileNm}`);
                    matched = true;
                    break;
                }
            }
            if (matched) {
                delete s.pendings[key];   // [§4] 펜딩 종료
            } else if (pend.attempts >= MAX_POLL_ATTEMPTS) {
                // [§6②] 하드 캡 도달 — graceful 포기
                console.warn(`[child_bulletin] ⏱️ 하드 캡(${MAX_POLL_ATTEMPTS}) 도달 — 포기: ${pend.parent} > ${pend.child}`);
                delete s.pendings[key];
            }
        }
    }
    if (dirty) _save();
}

/**
 * [설계 §8] 특정 부모 해역에 저장된 자식 통보문 반환(/api/zone-bulletins 병합용).
 * @param {string} parent 부모 해역명
 * @returns {Array<{time,title,pdfUrl,file_nm,national,childOnly}>}
 */
function getMatchedForZone(parent) {
    const s = _load();
    const out = [];
    for (const m of Object.values(s.matched)) {
        if (m.parent === parent) {
            out.push({
                time: m.time,
                title: m.title,
                pdfUrl: m.pdfUrl,
                file_nm: m.file_nm,
                national: false,    // 관할 지방청 PDF 라 연안/평수 포함
                childOnly: true     // [§8] 자식-only 구분 플래그
            });
        }
    }
    return out;
}

/** 상태 조회(디버그/테스트). */
function getStatus() {
    const s = _load();
    return {
        pendingCount: Object.keys(s.pendings).length,
        matchedCount: Object.keys(s.matched).length,
        pdfParseEnabled: !!_pdfParse,
        pendings: Object.values(s.pendings).map((p) => ({
            parent: p.parent, child: p.child, home: p.home, attempts: p.attempts
        }))
    };
}

/** 테스트용 — 메모리 상태 초기화(디스크 미변경). */
function _resetForTest() { _store = _emptyStore(); }

module.exports = {
    notePendingChildChanges,
    discardPendings,
    tick,
    getMatchedForZone,
    getStatus,
    homeOfficeFor,
    ZONE_HOME_OFFICE,
    // 내부(테스트 노출)
    _childSuffixToken,
    _pdfMatchesChild,
    _parsePdf,
    _norm,
    _resetForTest,
    _STORE_FILE: STORE_FILE,
    MAX_POLL_ATTEMPTS
};
