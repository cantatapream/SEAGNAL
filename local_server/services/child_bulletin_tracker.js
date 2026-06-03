/**
 * ============================================================================
 * 파일명: services/child_bulletin_tracker.js
 * 역할: "자식만 변경되는 통보문"(부모 해역 불변, 연안바다/평수구역만 변동)을
 *       부모 해역 통보문 목록(/api/zone-bulletins)에 합류시키기 위한 추적기.
 * ============================================================================
 *
 * [왜 필요한가 — 문제]
 *   /api/zone-bulletins 는 ef/list(인증) 로 부모 통보문을 구성한다. 그런데 ef/list
 *   에는 부모 해역(S1) row 만 있고 자식(연안바다/평수구역 S2/S3) row 가 없다.
 *   따라서 "부모는 그대로인데 자식만 발효/해제되는 통보문"은 ef/list 에 안 잡혀
 *   부모 통보문 목록에서 통째로 누락된다.
 *   (실증: 2026-06-02 제주도북부 — 11:30 풍랑주의보 발표 PDF의 '참고사항'에
 *    "제주도북부연안바다 해제"가 들어있으나, ef/list 부모 row 와 별개의 자식 변동.)
 *
 * [설계 — 이벤트 기반, 평상시 ntfctn 0회]
 *   1) 크롤러(marine_warning_crawler)가 "확정된 자식 변동"(기존 디바운스/의심가드를
 *      통과한 실제 자식 푸시 신호 = CHILD_ADD/CHILD_RELEASE/CHILD_*_EXTEND, 또는
 *      자식 한정사를 동반한 부모 변화)을 감지하면 notePendingChildChanges(zones) 로
 *      그 부모 해역을 "펜딩" 등록한다. (새 글리치 로직을 만들지 않는다 — 신호만 받음)
 *   2) 펜딩이 있을 때만, 매 사이클 poll() 이 "그 부모의 관할 지방청 1곳"의
 *      ntfctn/list 를 조회한다. 펜딩이 없으면 ntfctn 호출 0회.
 *   3) 새 PDF(file_nm 캐시로 신규만)만 받아 본문을 파싱하고, 본문에 "부모 해역명 +
 *      자식 구분 토큰(연안/평수)"이 함께 들어있으면 자식 통보문으로 인정.
 *   4) 인정된 자식 통보문 {time,title,pdfUrl,file_nm,zone,childOnly} 를 디스크에
 *      영속 저장하고 해당 부모의 펜딩을 종료한다.
 *   5) 고정 시간창 없음 — 매칭될 때까지 펜딩 유지(데이터 조기 기록/통보문 지연 대응).
 *
 * [안전망]
 *   ① 반전/후속 변동 시 펜딩 자동 폐기 — noteChildReversal(zones).
 *   ② 하드 캡 — 펜딩이 MAX_PENDING_MS 를 넘으면 graceful 포기(무한대기 금지).
 *   ③ 영속화 — 매칭 자식 통보문 + 열린 펜딩을 디스크 저장(재시작 생존).
 *
 * [제약]
 *   - 평상시(펜딩 0) ntfctn 호출 0회, 펜딩 시에도 부모별 관할청 1곳만.
 *   - PDF 추출 실패 시: 정규화 매칭 + 다음 사이클 재시도(캡 내).
 *   - 기존 라우트/푸시/크롤러 동작에 영향 없음(읽기 전용 신호 수신 + 별도 파일).
 *
 * [의존성]
 *   - services/marine_client (fetchWarnNtfctnList)
 *   - pdf-parse (regional_forecast_collector 와 동일 로더 패턴)
 *   - Node 내장 https/fs/path
 * ============================================================================
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

let marineClient = null;
try {
    marineClient = require('./marine_client');
} catch (e) {
    console.warn('[child_bulletin_tracker] marine_client 미로드 — 추적 비활성:', e && e.message);
}

// pdf-parse v1 함수형 API 확보 (regional_forecast_collector 와 동일 전략).
//   v2 가 로드되면 상위 node_modules 의 v1 lib 를 직접 require 해 디버그모드 우회.
let pdfParse = null;
try {
    const m = require('pdf-parse');
    if (typeof m === 'function') {
        pdfParse = m;
    } else {
        try {
            const libPath = require.resolve('pdf-parse/lib/pdf-parse.js', { paths: [path.join(__dirname, '..', '..')] });
            const v1 = require(libPath);
            if (typeof v1 === 'function') pdfParse = v1;
        } catch (_) { /* below warns */ }
    }
} catch (e) {
    console.warn('[child_bulletin_tracker] pdf-parse 로드 실패 — PDF 본문 매칭 비활성:', e && e.message);
}

// ============================================================================
// 상수 / 매핑
// ============================================================================

const MARINE_HOST = 'marine.kma.go.kr';
const NATIONAL_GO = '108';                 // 본청(전국) — 연안/평수 미포함이라 자식 매칭에 부적합

// 펜딩 하드 캡 — 이 시간을 넘기면 graceful 포기(무한대기 방지). 통보문 지연을 넉넉히 흡수.
const MAX_PENDING_MS = 6 * 60 * 60 * 1000;   // 6시간
// PDF fetch 타임아웃
const PDF_TIMEOUT_MS = 20000;
// 매칭된 자식 통보문 보관 상한(최신 우선) — 무한 증가 방지
const MAX_MATCHED = 400;
// 영속 file_nm 캐시 상한(이미 본 PDF 재파싱 방지)
const MAX_SEEN_FILES = 2000;

// [부모 해역 → 관할 지방청 prdc_go] — PDF 내용검증 정적 매핑(routes/weather.js ZONE_HOME_OFFICE 의 거울).
//   '108' = 지방청 PDF 에서 해역명이 확인 안 돼 전국(본청)으로 가는 해역 → 자식 통보문 매칭 불가로 간주.
//   미등록(신규) 해역은 매칭 대상에서 제외(보수적). 키는 정규화(공백제거) 비교.
const HOME_OFFICE = {
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
    '충남남부앞바다': '133', '충남북부앞바다': '133',
    // 남해권 연안 부모(PARENT_TO_CHILDREN 에 자식이 있는 해역) 보강 — 부산지방청(159)/광주(156)
    '경남중부남해앞바다': '159', '경남서부남해앞바다': '159', '경남동부남해앞바다': '159',
    '거제시동부앞바다': '159', '전남서부남해앞바다': '156', '전남동부남해앞바다': '156'
};

const _norm = (s) => String(s || '').replace(/\s+/g, '');

// 자식 정식명(예: '제주도북부앞바다중연안바다') → 부모명 + 자식 구분 토큰 추출.
//   '...중연안바다' / '...중XX평수구역' / '...중XX연안바다' 패턴.
//   반환: { parent, childTokens:[...] } — childTokens 는 PDF 본문에서 함께 찾을 키워드.
function _parseChildName(childName) {
    const n = String(childName || '');
    const idx = n.indexOf('중');
    let parent = '';
    let tail = n;
    if (idx > 0) {
        parent = n.slice(0, idx);
        tail = n.slice(idx + 1);
    }
    const tokens = [];
    if (/연안바다/.test(n)) tokens.push('연안');
    if (/평수구역/.test(n)) tokens.push('평수');
    // 세부 지명(예: '추자도', '조도', '울릉읍', '우도', '가파도') 도 보조 토큰으로.
    const place = tail.replace(/(연안바다|평수구역|먼|앞|북부|남부|동부|서부|중부|북|남|동|서)/g, '').trim();
    if (place && place.length >= 2) tokens.push(place);
    return { parent, childTokens: tokens };
}

// ============================================================================
// 영속 상태
// ============================================================================
//   pending:  { [parentNorm]: { parent, office, children:[정식자식명...], firstAt } }
//   matched:  [ { zone(정규화부모), zoneRaw, time, title, pdfUrl, file_nm, childOnly, at } ]
//   seenFiles:[ file_nm ... ]  (이미 파싱 시도한 PDF — 재파싱 방지, 최신 우선 캡)
const STATE_FILE = path.join(__dirname, '..', 'data', 'child_bulletins.json');
const STATE_TMP = STATE_FILE + '.tmp';

let _state = null;   // lazy load

function _emptyState() {
    return { pending: {}, matched: [], seenFiles: [] };
}

function _load() {
    if (_state) return _state;
    try {
        if (fs.existsSync(STATE_FILE)) {
            const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            _state = {
                pending: (j && j.pending && typeof j.pending === 'object') ? j.pending : {},
                matched: Array.isArray(j && j.matched) ? j.matched : [],
                seenFiles: Array.isArray(j && j.seenFiles) ? j.seenFiles : []
            };
            return _state;
        }
    } catch (e) {
        console.warn('[child_bulletin_tracker] 상태 복원 실패 (무시):', e && e.message);
    }
    _state = _emptyState();
    return _state;
}

let _dirty = false;
function _save() {
    if (!_state) return;
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_TMP, JSON.stringify({
            updatedAt: new Date().toISOString(),
            pending: _state.pending,
            matched: _state.matched.slice(0, MAX_MATCHED),
            seenFiles: _state.seenFiles.slice(0, MAX_SEEN_FILES)
        }), 'utf8');
        fs.renameSync(STATE_TMP, STATE_FILE);
        _dirty = false;
    } catch (e) {
        console.warn('[child_bulletin_tracker] 상태 저장 실패 (무시):', e && e.message);
    }
}

// ============================================================================
// 펜딩 등록 / 폐기 — 크롤러가 호출
// ============================================================================

/**
 * 확정된 자식 변동 신호 수신 → 부모 해역을 펜딩 등록.
 * @param {Array} items  [{ parent: 부모해역명, children:[자식정식명...] }, ...]
 *   (children 생략 가능 — 본문 매칭은 부모명만으로도 동작하나, 있으면 토큰 정밀도↑)
 */
function notePendingChildChanges(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const s = _load();
    const now = Date.now();
    for (const it of items) {
        const parent = it && it.parent;
        if (!parent) continue;
        const pn = _norm(parent);
        const office = HOME_OFFICE[pn];
        // 전국(108) 폴백 해역 / 미등록 해역은 자식 통보문 매칭 불가 → 펜딩 안 함(ntfctn 호출 절약).
        if (!office || office === NATIONAL_GO) continue;
        const kids = Array.isArray(it.children) ? it.children.filter(Boolean) : [];
        if (!s.pending[pn]) {
            s.pending[pn] = { parent: String(parent), office, children: kids, firstAt: now };
            console.log(`[child_bulletin] 펜딩 등록: ${parent} (관할청 ${office}, 자식 ${kids.join('/') || '-'})`);
        } else {
            // 이미 펜딩 중 — 자식 목록 병합(중복 제거), firstAt 은 유지(캡 기준).
            const set = new Set(s.pending[pn].children || []);
            for (const k of kids) set.add(k);
            s.pending[pn].children = Array.from(set);
        }
        _dirty = true;
    }
    if (_dirty) _save();
}

/**
 * 반전/후속 변동(예: 방금 등록한 자식이 곧바로 복귀/재변동) 시 펜딩 폐기 — 안전망 ①.
 * @param {Array<string>} parents  부모 해역명 목록
 */
function noteChildReversal(parents) {
    if (!Array.isArray(parents) || parents.length === 0) return;
    const s = _load();
    let changed = false;
    for (const p of parents) {
        const pn = _norm(p);
        if (s.pending[pn]) {
            console.log(`[child_bulletin] 펜딩 폐기(반전/후속 변동): ${s.pending[pn].parent}`);
            delete s.pending[pn];
            changed = true;
        }
    }
    if (changed) { _dirty = true; _save(); }
}

// ============================================================================
// PDF fetch + 파싱
// ============================================================================

function _fetchPdf(fileNm) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'GET', host: MARINE_HOST, path: fileNm,
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/child-bulletin)' },
            timeout: PDF_TIMEOUT_MS
        }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`pdf HTTP ${res.statusCode}`)); }
            const ch = [];
            res.on('data', (c) => ch.push(c));
            res.on('end', () => resolve(Buffer.concat(ch)));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('pdf timeout')));
        req.end();
    });
}

// file_nm '/.../KTKO50_<YYYYMMDDHHMM>_<prdc_go>_<seq>.pdf' → 발표시각 'YYYY.MM.DD HH:MM'
function _timeFromFileNm(fileNm) {
    const m = String(fileNm).match(/KTKO50_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_/);
    if (!m) return '';
    return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
}

// PDF 본문이 (부모 해역명 + 자식 구분 토큰)을 함께 포함하는지 → 자식 통보문 매칭.
//   부모명은 정규화(공백제거) 후 부분포함, 자식 토큰('연안'/'평수'/세부지명)은 최소 1개 포함.
//   부모 펜딩에 등록된 자식이 없으면(=children 비어있음) 부모명 + (연안|평수) 일반 토큰으로 판정.
function _matchesChild(text, pendingEntry) {
    const t = _norm(text);
    if (!t) return null;
    const parentNorm = _norm(pendingEntry.parent);
    if (!parentNorm || !t.includes(parentNorm)) return null;

    const kids = Array.isArray(pendingEntry.children) ? pendingEntry.children : [];
    // 등록된 자식별 토큰 검사 — 하나라도 부모+토큰이 함께 있으면 매칭.
    if (kids.length) {
        for (const childName of kids) {
            const { childTokens } = _parseChildName(childName);
            if (!childTokens.length) continue;
            if (childTokens.some((tok) => t.includes(_norm(tok)))) {
                return childName;
            }
        }
        // 등록 자식 토큰이 본문에 없음 → 자식 매칭 아님(부모만 언급된 부모 통보문일 수 있음).
        return null;
    }
    // 자식 목록이 비었으면 일반 토큰으로 보수적 판정(연안/평수가 본문에 있어야 함).
    if (t.includes('연안') || t.includes('평수')) return '(자식)';
    return null;
}

// ============================================================================
// poll — 매 사이클(펜딩 있을 때만 ntfctn 호출)
// ============================================================================

/**
 * 펜딩이 있는 부모들의 관할 지방청 ntfctn/list 를 조회 → 새 PDF 파싱 → 매칭/저장.
 *   - 같은 관할청(office)을 여러 부모가 공유하면 ntfctn 호출은 office 단위 1회로 합침.
 *   - 평상시(펜딩 0) 즉시 반환 → ntfctn 호출 0회.
 *   - 호출/파싱 실패는 graceful — 캡 내에서 다음 사이클 재시도.
 */
async function poll() {
    const s = _load();
    const pendingKeys = Object.keys(s.pending);
    if (pendingKeys.length === 0) return;       // 평상시 — ntfctn 0회
    if (!marineClient || !marineClient.AUTH_ENABLED) return;

    const now = Date.now();

    // 안전망 ② — 하드 캡 초과 펜딩 graceful 포기
    for (const pk of pendingKeys) {
        const ent = s.pending[pk];
        if (ent && (now - (ent.firstAt || now)) > MAX_PENDING_MS) {
            console.warn(`[child_bulletin] 펜딩 하드캡 초과 — graceful 포기: ${ent.parent} (${Math.round((now - ent.firstAt) / 60000)}분 경과)`);
            delete s.pending[pk];
            _dirty = true;
        }
    }
    const live = Object.keys(s.pending);
    if (live.length === 0) { if (_dirty) _save(); return; }

    // office 단위로 펜딩 부모 묶기 (관할청 1곳당 ntfctn 1회)
    const byOffice = new Map();   // office -> [pendingKey...]
    for (const pk of live) {
        const office = s.pending[pk].office;
        if (!byOffice.has(office)) byOffice.set(office, []);
        byOffice.get(office).push(pk);
    }

    // 조회 날짜창: 오늘 KST + 어제(자정 경계 통보문 누락 방지). ntfctn 은 최신 50건 반환.
    const kst = new Date(now + 9 * 3600000);
    const ymd = (off) => {
        const d = new Date(kst.getTime() + off * 86400000);
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const stTm = ymd(-1);
    const edTm = ymd(0);

    const seenSet = new Set(s.seenFiles);

    for (const [office, pks] of byOffice) {
        let rows;
        try {
            rows = await marineClient.fetchWarnNtfctnList({ prdc_go: office, st_tm: stTm, ed_tm: edTm });
        } catch (e) {
            console.warn(`[child_bulletin] ntfctn/list 실패(office ${office}) — 다음 사이클 재시도:`, e && e.message);
            continue;
        }
        if (!Array.isArray(rows) || rows.length === 0) continue;

        // 이 office 의 새 PDF (file_nm 미본 것)만, 같은 file_nm 은 1회만 파싱.
        const newFiles = [];
        const fileSeen = new Set();
        for (const r of rows) {
            const fn = String(r && r.file_nm || '').trim();
            if (!fn) continue;
            // file_nm 의 prdc_go 가 office 와 다르면 skip (다른 청 PDF 혼입 방지). 108(전국)도 skip.
            const fm = fn.match(/_(\d{3})_\d+\.pdf$/);
            const fileGo = fm ? fm[1] : '';
            if (fileGo && fileGo !== office) continue;
            if (seenSet.has(fn) || fileSeen.has(fn)) continue;
            fileSeen.add(fn);
            newFiles.push(fn);
        }
        if (newFiles.length === 0) continue;

        for (const fn of newFiles) {
            let text = '';
            let fetchedOk = false;
            try {
                const buf = await _fetchPdf(fn);
                fetchedOk = true;
                if (pdfParse) {
                    const parsed = await pdfParse(buf);
                    text = (parsed && parsed.text) || '';
                }
            } catch (e) {
                // fetch/parse 실패 → seen 에 넣지 않고 다음 사이클 재시도(캡 내).
                console.warn(`[child_bulletin] PDF 처리 실패(${fn.split('/').pop()}) — 재시도:`, e && e.message);
                continue;
            }

            // 텍스트 추출 성공(빈 텍스트 포함)으로 본 PDF 는 seen 처리(재파싱 방지).
            //   단, 텍스트가 비었고 pdfParse 가 있는데도 0자면 추출 실패로 보고 재시도.
            const extractionUsable = !pdfParse || (typeof text === 'string' && text.length > 0);

            let matchedAny = false;
            for (const pk of pks) {
                const ent = s.pending[pk];
                if (!ent) continue;
                if (!extractionUsable) continue;   // 추출 불가 — 다음 사이클 재시도
                const childName = _matchesChild(text, ent);
                if (!childName) continue;

                // 매칭 — 자식 통보문 저장 + 펜딩 종료
                const fileGo = (fn.match(/_(\d{3})_\d+\.pdf$/) || [])[1] || office;
                const title = String((rows.find((r) => r.file_nm === fn) || {}).warn_title || '').trim();
                const rec = {
                    zone: _norm(ent.parent),
                    zoneRaw: ent.parent,
                    child: childName,
                    time: _timeFromFileNm(fn),
                    title: title.replace(/^\[\s*특보\s*\]\s*/, '').trim() || '자식 통보문',
                    pdfUrl: 'https://' + MARINE_HOST + fn,
                    file_nm: fn,
                    childOnly: true,
                    national: fileGo === NATIONAL_GO,
                    at: now
                };
                // file_nm 중복 저장 방지
                if (!s.matched.some((m) => m.file_nm === fn && m.zone === rec.zone)) {
                    s.matched.unshift(rec);
                    if (s.matched.length > MAX_MATCHED) s.matched.length = MAX_MATCHED;
                }
                console.log(`[child_bulletin] ✅ 자식 통보문 매칭: ${ent.parent} > ${childName} (${rec.time}) ${fn.split('/').pop()}`);
                delete s.pending[pk];
                matchedAny = true;
                _dirty = true;
            }

            // 추출 가능했던 PDF 만 seen 기록(다음 사이클 재파싱 방지).
            if (extractionUsable) {
                seenSet.add(fn);
                s.seenFiles.unshift(fn);
                if (s.seenFiles.length > MAX_SEEN_FILES) s.seenFiles.length = MAX_SEEN_FILES;
                _dirty = true;
            }
            // matchedAny 여부와 무관 — 한 PDF가 여러 펜딩을 닫을 수 있으므로 위 루프에서 처리됨.
            void matchedAny;
        }
    }

    if (_dirty) _save();
}

// ============================================================================
// 조회 — 라우트가 호출
// ============================================================================

/**
 * 특정 부모 해역에 대해 저장된 자식 통보문 목록 반환.
 * @param {string} zoneName  부모 해역명(원문 또는 정규화)
 * @returns {Array} [{ time, title, pdfUrl, file_nm, childOnly, national }, ...]
 */
function getMatchedBulletins(zoneName) {
    const s = _load();
    const zn = _norm(zoneName);
    if (!zn) return [];
    return s.matched
        .filter((m) => m.zone === zn)
        .map((m) => ({
            time: m.time,
            title: m.title,
            pdfUrl: m.pdfUrl,
            file_nm: m.file_nm,
            childOnly: true,
            national: !!m.national
        }));
}

// 디버그/테스트용 상태 조회
function getState() {
    const s = _load();
    return {
        pending: s.pending,
        matchedCount: s.matched.length,
        seenCount: s.seenFiles.length
    };
}

// 테스트용 — 상태 초기화(메모리만)
function _resetForTest() {
    _state = _emptyState();
    _dirty = false;
}

module.exports = {
    notePendingChildChanges,
    noteChildReversal,
    poll,
    getMatchedBulletins,
    getState,
    // 내부 단위검증 노출
    _matchesChild,
    _parseChildName,
    _timeFromFileNm,
    _resetForTest,
    HOME_OFFICE
};
