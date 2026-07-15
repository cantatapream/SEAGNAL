'use strict';

// ============================================================================
// bulletin_cancel_scanner.js — [예비특보 취소 판정 보류실] 통보문 취소 문구 스캐너 (§7.7.23)
// ============================================================================
//
// [역할]
//   예비특보가 MMIS 실황에서 사라졌을 때 "진짜 취소"인지 확정하기 위해, 해당 해역의
//   관할 지방청 통보문(날씨누리 special-report/list.do)을 가져와 참고사항 섹션에서
//   취소 문구("…의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다")를 정규식으로 찾는다.
//   호출 측(marine_warning_crawler 판정 보류실)은 이 결과로만 취소 푸시를 발사한다.
//
// [소스 선택 근거 — 2026-07 실측 검증]
//   - 지방청별 통보문: /w/special-report/list.do?stn=<관서>&kind=<met|pwn>&date=<YYYY-MM-DD>
//     (전국(108) 통보문에는 연안바다·평수구역이 나오지 않음 — 지방청 페이지 필수. 실측 확인.)
//   - 특정 통보문 조회는 reportId 단독으로는 무시되고 prevStn+prevKind 를 함께 보내야 반영됨
//     (누락 시 조용히 최신 통보문으로 폴백 — 응답의 selected 마커로 교차 검증한다).
//   - 예비특보 통보문은 kind=pwn 별도 목록 → met/pwn 둘 다 조회.
//   - 무인증 접근 가능. 조회는 보류 건이 열려 있을 때만 수행(평상시 트래픽 0).
//   [향후] 방재기상플랫폼(dmdw) 통보문 API(V3 정규식 검증 원천과 동일 소스)를 1순위로
//   추가하고 본 모듈을 폴백으로 두는 확장 여지 — dmdw 응답의 참고사항 필드 위치를
//   자격증명 있는 운영 환경에서 확인한 뒤 붙인다.
//
// [정규식 계보]
//   V3: 5년(2021-05~2026-05)×10발행처 약 6,200건 통보문 아카이브 전수 분석으로 확정된
//       10가지 어휘 변형 흡수판 (weather_alerts_crawler.js parseReferenceSection 과 동일 계열).
//   V4(신규, 보수적): V3 구조에 "특보(자식1, 자식2)" 괄호 자식 표기 캡처만 추가.
//       괄호형은 과거 조사에서 의도적 제외(V4 후보)였던 패턴 — 실물 검증 전이므로
//       V3 의 "발표/발효 가능성이 낮아/적어" 접두 강제를 그대로 유지해 오탐을 차단하고,
//       놓치면 보류실 TTL 이 무푸시+로그로 처리한다(오보 없음). 로그의 참고사항 원문으로
//       사후 보강한다.
//
// [매칭 4단 — 호출 측 계약]
//   0.5순위 "묶음명/부모명 중 단축자식명" 직접 지목(2026-07-14 제07-17호 실물 보강:
//   "서해남부앞바다 중 평수구역과 남해서부앞바다 중 평수구역의 풍랑 예비특보는 …해제"),
//   1순위 자식명 직접(괄호 캡처 토큰), 2순위 부모명(부모 취소가 자식을 대표),
//   3순위 묶음명(ZONE_GROUP_MAP 사전 번역: "동해중부앞바다"=강원북부/중부/남부앞바다).
//   matchesZone()/matchesChild() 가 이 계약을 구현한다.

const https = require('https');
const { ZONE_GROUP_MAP } = require('../config/zone_group_map');

const HOST = 'www.weather.go.kr';
const LIST_PATH = '/w/special-report/list.do';
const HTTP_TIMEOUT_MS = 10000;
const FETCH_GAP_MS = 250;                    // 요청 사이 최소 간격
const SEEN_REPORT_TTL_MS = 24 * 60 * 60 * 1000;   // 스캔 완료 통보문 재조회 억제
const RELEASE_MEMORY_TTL_MS = 2 * 60 * 60 * 1000; // 발견 취소문구 보존 — (c)가 발견 즉시 소비하므로 2h 로 충분(보류가 24h 여도 스캔은 매분 계속됨)
const KINDS = ['met', 'pwn'];                // 특보 통보문 + 예비특보 통보문
// [적대검증 5] 한 번의 scan() 이 크롤 주기(1분)를 붙들지 않도록 상세 조회 상한 — 초과분은
//   _seenReports 미기록 상태로 남아 다음 사이클에 이어서 조회된다(이월).
const MAX_DETAIL_FETCH_PER_SCAN = 8;

/** reportId("met:202607110930:16")의 발행시각(KST) → epoch ms. 파싱 불가 시 null. */
function _reportIssuedAtMs(reportId) {
    const m = /^(?:met|pwn):(\d{4})(\d{2})(\d{2})(\d{2})(\d{2}):/.exec(String(reportId || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]);   // KST(+9) → UTC ms
}

// 스캔 완료 reportKey("stn|kind|reportId") → ts. 재시작 시 재스캔되지만 결과는 멱등(무해).
const _seenReports = new Map();
// [4차 통합검증 6] reportId 별 상세 조회 실패 횟수 — 페이지 구조 변화 등으로 selected 검증이
//   계속 실패하는 통보문을 매 사이클 무한 재시도하지 않도록 5회 후 포기(seen 처리).
const _failCounts = new Map();
const MAX_DETAIL_FAILS = 5;
// 발견된 취소 문구 누적 — 보류 등록 "이전"에 발행된 통보문의 취소 문구도 판정에 쓰이도록 보존.
let _recentReleases = [];
// [2026-07-14 실사고] 해당구역 절의 "부모명(자식 제외)" 단서 누적 — 부모는 발표되고 자식만
//   대상에서 빠지는 서식(대구청 6/20·7/14 실물). 자식 취소 보류의 "긍정 확정 근거"로만 사용
//   (부모 판정에는 불사용 — 제외 단서는 부모가 살아있음을 전제하는 표현).
let _recentExclusions = [];
let _recentDesignations = [];

// ---------------------------------------------------------------------------
// 저수준 fetch (프로덕션: 직결 https — marine_client 와 동일 방식)
// ---------------------------------------------------------------------------
let _lastFetchAt = 0;
function _fetchHtml(path) {
    return new Promise((resolve, reject) => {
        const gap = _lastFetchAt + FETCH_GAP_MS - Date.now();
        setTimeout(() => {
            _lastFetchAt = Date.now();
            const req = https.request({
                method: 'GET', host: HOST, path,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/bulletin-scanner)',
                    'Accept': 'text/html'
                },
                timeout: HTTP_TIMEOUT_MS
            }, res => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`GET ${path} HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            req.on('timeout', () => { req.destroy(new Error('timeout')); });
            req.on('error', reject);
            req.end();
        }, Math.max(0, gap));
    });
}

// ---------------------------------------------------------------------------
// HTML → 텍스트 / 참고사항 절단 / 문장 분리 (legacy parseReferenceSection 과 동일 정책)
// ---------------------------------------------------------------------------
function _htmlToText(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ');
}

function _refSection(text) {
    const i = text.indexOf('참고사항');
    if (i === -1) return '';
    let sec = text.substring(i);
    // [적대검증 3] 페이지 꼬리(footer 안내문 등) 유입 차단 — 알려진 footer 마커에서 절단 + 길이 상한.
    //   무마침표 장문이 정규식 백트래킹을 폭발시키는 것을 원천 봉쇄 (참고사항 본문은 통상 수백 자).
    for (const marker of ['관련 페이지 링크', '개인정보처리방침', '기상청 기관 정보']) {
        const j = sec.indexOf(marker);
        if (j !== -1) sec = sec.substring(0, j);
    }
    return sec.slice(0, 4000);
}

// [적대검증 3] 문장 길이 상한 — 취소 문구 문장은 통상 100자 내. 상한 초과 문장(마침표 없는
//   안내 문단 등)은 skip 해 초선형 백트래킹(실측 4.8KB→13초, 동기 블록)을 차단한다.
const MAX_SENTENCE_LEN = 500;

// ---------------------------------------------------------------------------
// 취소 문구 정규식 — V3 + V4(괄호 자식 캡처)
//   $1 = 해역 구절(앞부분), $2 = 종류(풍랑|태풍), $3 = 괄호 안 자식 나열(없으면 undefined)
//   V3 대비 변경점은 `특보` 뒤 `(?:\(([^)]{1,120})\))?` 하나뿐 — 접두 강제(가능성이 낮아/적어)
//   등 오탐 방어 구조는 그대로다.
// ---------------------------------------------------------------------------
const RE_RELEASE = /([^.\n]*?(?:의|에)[^.\n]*?)\s*(풍랑|태풍)\s*(?:예비\s*)?특보(?:\s*\(([^)]{1,120})\))?(?:는|를)?\s*[^.\n]*?\s*(?:발표|발효)\s*가능성이?\s*(?:낮아|적어)(?:져)?\s*(?:[^.\n]*?\s*예비\s*특보를?\s*)?해제\s*(?:합니다|함\.?|하나|하였으나|하며)/g;

// ---------------------------------------------------------------------------
// [2026-07-14 실사고] 해당구역 절 제외 단서 — "경북남부앞바다(평수구역 제외)"
//   부모가 발표/변경되면서 특정 자식만 대상에서 빠질 때의 표준 서식(참고사항 아님).
//   자식 취소 보류의 긍정 확정 근거. 종류(풍랑/태풍)는 매치 앞 200자에서 역추적
//   (하위 불릿 "o 부모명(자식 제외)"에는 종류가 없고 상위 줄에 있음), 미상이면 ''.
// ---------------------------------------------------------------------------
const RE_EXCLUSION = /([가-힣·]{2,20}?(?:앞바다|먼바다))\s*\(\s*([^)]{1,60}?)\s*제외\s*\)/g;

function parseExclusions(fullText) {
    const out = [];
    if (!fullText) return out;
    const txt = String(fullText).slice(0, 6000).replace(/([가-힣])\.([가-힣])/g, '$1·$2');
    RE_EXCLUSION.lastIndex = 0;
    let m;
    while ((m = RE_EXCLUSION.exec(txt)) !== null) {
        const excluded = m[2].split(/[,·]/).map(s => s.trim()).filter(t => t && _plausibleZoneToken(t));
        if (excluded.length === 0) continue;   // 비해역 괄호("...시각 제외" 류) 무시
        const before = txt.slice(Math.max(0, m.index - 200), m.index);
        const tpm = before.match(/(풍랑|태풍)(?!.*(?:풍랑|태풍))/s) || before.match(/.*(풍랑|태풍)/s);
        out.push({ parent: m[1], excluded, tp: tpm ? tpm[1] : '' });
    }
    return out;
}

// ---------------------------------------------------------------------------
// [2026-07-14 제주 실물, 제07-33·36·44호] 해당구역 절 지정 단서 — "제주도동부앞바다( 북동연안바다 )"
//   발표/변경이 괄호로 "남는 자식만" 지목하는 서식 — (c2) 제외형("평수구역 제외")의 반대 방향.
//   나열에서 빠진 자식 = 대상에서 빠진 것이므로 자식 취소 보류의 긍정 확정 근거가 된다.
//   부정 조건 3중:
//   ① 괄호 안 '제외'는 제외형(parseExclusions 담당), '포함'은 병기 장식 — 지정이 아니므로 배제
//   ② 앞 문맥(120자)의 최근접 동작어가 '발표|변경'일 때만 채택 — '해제|취소|예고|유지'가
//      최근접이면 폐기. "풍랑주의보 해제 : Z( A )"(07-44호 실물)는 A만 해제한다는 뜻이라
//      부재 자식의 취소 근거가 될 수 없다(나머지는 무언급 = 유지).
//   ③ 괄호 토큰 "전원"이 해역명일 때만 — "(09시~12시)" 시각 괄호·혼합 괄호 오인 방지
// ---------------------------------------------------------------------------
const RE_DESIGNATION = /([가-힣·]{2,20}?(?:앞바다|먼바다))\s*\(\s*([^)]{1,60}?)\s*\)/g;

/**
 * 통보문 전문에서 "부모( 자식 나열 )" 지정 단서를 추출한다.
 * 예: parseDesignations('풍랑주의보 발표 : 제주도동부앞바다( 북동연안바다 )')
 *     → [{ parent:'제주도동부앞바다', listed:['북동연안바다'], tp:'풍랑' }]
 * @param {string} fullText - 통보문 텍스트 전문 (참고사항 아님 — 해당구역 절 포함)
 * @returns {Array<{parent:string, listed:string[], tp:string}>} 발표/변경 문맥의 지정 단서만
 * [연계] ← scan (이 파일) — 통보문마다 호출해 _recentDesignations 에 누적한다
 *        → _plausibleZoneToken (이 파일) — 괄호 토큰이 해역명인지 판별
 *        누가: marine_warning_crawler._evaluateCancelVerdicts (c3) 가 이 결과를 소비한다
 */
function parseDesignations(fullText) {
    const out = [];
    if (!fullText) return out;
    const txt = String(fullText).slice(0, 6000).replace(/([가-힣])\.([가-힣])/g, '$1·$2');
    RE_DESIGNATION.lastIndex = 0;
    let m;
    while ((m = RE_DESIGNATION.exec(txt)) !== null) {
        const inner = m[2];
        if (inner.indexOf('제외') !== -1 || inner.indexOf('포함') !== -1) continue;   // ① 제외형/병기형
        const toks = inner.split(/[,·]/).map(s => s.trim()).filter(Boolean);
        if (toks.length === 0 || !toks.every(_plausibleZoneToken)) continue;          // ③ 전원 해역명
        // ② 발표/변경 문맥만 — [적대검증(c3) 결함2] 앞 창의 "괄호 병기"("(19일 05시 발표)")를
        //   먼저 제거해야 해제 절이 발표로 둔갑하지 않는다. 캡션("발표구역")·산문("발표 가능성",
        //   "발표된/되었" 회고)도 동작어로 치지 않고, 회고 표지(지난/어제/전날)면 통째 폐기.
        //   채택 동작어와 지정 사이에 콜론이 있어야(헤더 서식 "발표 : Z( A )" 강제).
        const before = txt.slice(Math.max(0, m.index - 120), m.index).replace(/\([^)]*\)/g, ' ');
        if (/지난|어제|전날/.test(before)) continue;
        let act = '', actIdx = -1;
        for (const am of before.matchAll(/발표(?!구역|된|되었|\s*가능)|변경(?!된|되었)|해제|취소|예고|유지/g)) {
            act = am[0]; actIdx = am.index;
        }
        if (act !== '발표' && act !== '변경') continue;
        if (!/[:：]/.test(before.slice(actIdx))) continue;
        // [적대검증(c3) 결함3] 종류(tp)는 동작어 "직전 15자"에서만 — 헤더 서식("풍랑주의보 발표 :")
        //   의 종류 자리다. 창 전체 역추적은 산문("제12호 태풍 북상의 영향으로")에 오귀속됐다.
        //   미상('')이면 (c3)의 엄격 tp 일치가 발사를 막는다(안전 침묵).
        const tpm = before.slice(Math.max(0, actIdx - 15), actIdx).match(/(풍랑|태풍)(?!.*(?:풍랑|태풍))/s);
        out.push({ parent: m[1], listed: toks, tp: tpm ? tpm[1] : '' });
    }
    return out;
}

/** 지정 단서가 이 부모 해역의 것인가(부모명 정규화 일치) — (c3)에서 "같은 부모의 최신 지정만
 *  권위" 대조에 쓴다. [연계] ← marine_warning_crawler.js _evaluateCancelVerdicts (c3) */
function designationAppliesTo(des, zone) {
    return !!des && !!zone && _norm(des.parent) === _norm(zone);
}

/**
 * 지정 단서가 자식(zone 아래 child)의 취소를 확정하는가 — 부모명 "직접 일치"에서
 * 자식이 나열에 "빠져" 있으면 참(부재 = 대상 제외). 묶음 확장 없음, (c2)와 동일하게 보수 우선.
 * 예: matchesChildDesignation({parent:'제주도동부앞바다', listed:['북동연안바다']},
 *     '제주도동부앞바다', '제주도동부앞바다중우도연안바다') → true (우도가 나열에 없음)
 * @param {Object} des - parseDesignations 결과 항목 ({ parent, listed, tp })
 * @param {string} zone - 부모 해역명
 * @param {string} child - 자식 정식명 (예: '제주도동부앞바다중우도연안바다')
 * @returns {boolean} 이 지정 단서가 해당 자식의 취소(대상 제외)를 확정하면 true
 * [연계] ← marine_warning_crawler.js _evaluateCancelVerdicts (c3) — 자식 보류 판정에서 부른다
 *          (true 면 CHILD_PRELIM_CANCEL 발사 — (c2) 제외 단서와 같은 발사 경로)
 */
function matchesChildDesignation(des, zone, child) {
    if (!des || !zone || !child) return false;
    if (_norm(des.parent) !== _norm(zone)) return false;
    const shortC = _norm(String(child).split('중').pop());
    const fullC = _norm(child);
    const listed = (des.listed || []).some(t => {
        const nt = _norm(t);
        return nt === shortC || nt === fullC || (fullC.indexOf(nt) !== -1 && nt.length >= 2);
    });
    return !listed;
}

/** 제외 단서가 자식(zone 아래 child)의 취소를 확정하는가 — 부모명 "직접 일치" + 자식
 *  단축명 토큰 일치만 인정(묶음 확장 없음 — 실물 서식이 개별 부모명이며 보수 우선). */
function matchesChildExclusion(exc, zone, child) {
    if (!exc || !zone || !child) return false;
    if (_norm(exc.parent) !== _norm(zone)) return false;
    const shortC = _norm(String(child).split('중').pop());
    const fullC = _norm(child);
    return (exc.excluded || []).some(t => {
        const nt = _norm(t);
        return nt === shortC || nt === fullC || (fullC.indexOf(nt) !== -1 && nt.length >= 2);
    });
}

/** [적대검증 10] 괄호 토큰 중 해역명으로 보이는 것만 채택 — "(19일 05시 발표)" 같은
 *   비해역 괄호가 자식 매칭을 오염(부모 대표 폴백 차단)하지 않도록. */
function _plausibleZoneToken(t) {
    return /바다|연안|평수/.test(t);
}

/**
 * 참고사항 텍스트에서 취소 문구 추출.
 * @returns [{ wrnTp:'풍랑'|'태풍', phrase, parenChildren:[], sentence }]
 */
const RE_KEEP = /([^.\n]{1,60}?)(?:는|은)\s*(풍랑|태풍)\s*예비\s*특보를?\s*유지/g;

function parseCancelPhrases(refText) {
    const out = [];
    if (!refText) return out;
    // [아카이브 실물 보정 2026-07-12] 도서명 연결 마침표("울릉도.독도", "흑산도.홍도")가
    //   ① 문장 분리를 섬 이름 한가운데서 끊고 ② 정규식의 [^.\n] 클래스를 막아,
    //   "…동해중부안쪽먼바다의 풍랑특보와 울릉도.독도의 강풍특보는 발표가능성이 낮아져
    //   해제합니다"(2026-04-04 전국, 실물) 같은 복합 주어 취소 문구를 통째로 놓치게 했다.
    //   한글 사이 마침표만 가운뎃점으로 정규화 — 우리 해상 해역명에는 마침표가 없어 무해.
    const norm = String(refText).replace(/([가-힣])\.([가-힣])/g, '$1·$2');
    // [5차 전수열거 — 교차문장 유지 선언] "…해제합니다. 한편 B는 예비특보를 유지합니다"처럼
    //   취소 절의 묶음 확장을 "다른 문장"의 유지 선언이 부정하는 서식 — 참고사항 전체에서
    //   유지 선언을 수집해 각 release 에 부착, 매칭 단계에서 해당 해역 확정을 금지한다.
    const keeps = [];
    RE_KEEP.lastIndex = 0;
    let km;
    while ((km = RE_KEEP.exec(norm)) !== null) {
        // 캡처가 앞 절(취소 주어)까지 삼키지 않도록 마지막 절 경계 이후만 유지 주어로 인정
        //   ("…해제하나 B는 …유지" → B 만). 경계: 해제/하나/하며/하였으나/쉼표.
        const clause = km[1].split(/해제|하나|하며|하였으나|,/).pop();
        keeps.push({ tp: km[2], clause });
    }
    const sentences = norm.split(/[\.\n\r]+/).map(s => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
        if (sentence.length > MAX_SENTENCE_LEN) continue;   // [적대검증 3] ReDoS 상한
        RE_RELEASE.lastIndex = 0;
        let m;
        while ((m = RE_RELEASE.exec(sentence)) !== null) {
            // [레드팀 1-C] 과거 회고 차단 — "지난 10일 …의 예비특보는 …해제하였으나 다시
            //   발효되었습니다" 같은 회고 문장은 현재 취소가 아니다. 주어 절($1)에 과거
            //   표지가 있으면 폐기. (정당 문구는 "당초 오늘(N일)…" 형 — 영향 없음)
            if (/지난|어제|전날/.test(m[1] || '')) continue;
            const parenChildren = m[3]
                ? m[3].split(/[,·]/).map(s => s.trim()).filter(t => t && _plausibleZoneToken(t))
                : [];
            // [레드팀 1-A/1-B] clause = 정규식이 실제로 매치한 "취소 절"(주어~해제 종결어).
            //   해역 매칭은 이 절 안에서만 수행 — "…해제하나 B는 유지합니다"의 대조 절이나
            //   "…해제하며, C에는 주의보 발효 중" 같은 부가 절의 해역·묶음명이 취소 대상으로
            //   오인되던(유지라고 적힌 해역에 취소 푸시) 오발사를 원천 차단.
            const clause = sentence.slice(m.index, RE_RELEASE.lastIndex);
            // [5차 전수열거 발견2] 재발효 회고 차단 — "…해제하였으나 다시 발표되었습니다"는
            //   과거 취소의 회고(현재는 살아있음). 과거형("되었/됐/하였/했")만 차단하고,
            //   실물 정당 문구 "…해제하나 …발표될 가능성이 있으니"(미래 안내)는 통과.
            const tail = sentence.slice(RE_RELEASE.lastIndex, RE_RELEASE.lastIndex + 30);
            if (/(다시|재)\s*(발표|발효)\s*(되었|됐|하였|했)/.test(tail)) continue;
            out.push({ wrnTp: m[2], phrase: m[1] || '', parenChildren, sentence, clause, keeps });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 해역 매칭 (3단) — 공백 제거 정규화 후 "유효 언급" 검사
// ---------------------------------------------------------------------------
const _norm = s => String(s || '').replace(/\s+/g, '');

/**
 * [적대검증 2·4] hay(공백제거 텍스트)에 name 의 "유효한 언급"이 있는가.
 *   무효 occurrence: ① 바로 뒤가 '중'(자식 정식명 접두 — "제주도북부앞바다중연안바다"는
 *   부모 언급이 아님), ② 뒤따르는 문맥이 제외 단서("…를 제외한", 대구청 실측 서식 —
 *   제외된 해역은 취소 대상이 아님). 유효 occurrence 가 1개라도 있으면 참.
 */
function _mentions(hay, name, keepMode) {
    const n = _norm(name);
    if (!n) return false;
    let idx = hay.indexOf(n);
    while (idx !== -1) {
        const after = hay.slice(idx + n.length, idx + n.length + 6);
        const childPrefix = after.charAt(0) === '중';
        const excluded = /^(?:를|을|은|는|만)?제외/.test(after);
        // ③ [2026-07-14 대구 실물형] 지정 괄호 — "경북남부앞바다(평수구역)의 …해제"는
        //   괄호 안 자식"만"의 취소이지 부모 전체 언급이 아니다(부모 오확정 차단).
        //   제외("평수구역 제외")·병기("연안바다 포함")·비해역 괄호는 종전대로 유효 언급.
        //   [적대검증(c3) 결함1] 단, 유지(keep) 선언 검사(keepMode)에서는 ③을 끈다 —
        //   "강원북부앞바다(연안바다)는 …유지"의 괄호가 유지 선언을 무력화해 유지라고
        //   적힌 해역에 취소가 발사되던 회귀. 유지 판정은 넓을수록 안전(취소 차단 방향).
        const desig = keepMode ? null : _designationParenAt(hay, idx + n.length);
        if (!childPrefix && !excluded && !desig) return true;
        idx = hay.indexOf(n, idx + 1);
    }
    return false;
}

/** hay[at] 이 "순수 지정 괄호"(전원 해역 토큰, 제외/포함 없음)의 시작이면 그 토큰 배열을,
 *  아니면 null 을 반환. _mentions ③ 과 matchesChild 지정 게이트가 공용.
 *  [연계] ← _mentions · matchesChild (이 파일) */
function _designationParenAt(hay, at) {
    if (hay.charAt(at) !== '(') return null;
    const close = hay.indexOf(')', at + 1);
    if (close === -1) return null;
    const inner = hay.slice(at + 1, close);
    if (!inner || inner.indexOf('제외') !== -1 || inner.indexOf('포함') !== -1) return null;
    const toks = inner.split(/[,·]/).filter(Boolean);
    return (toks.length > 0 && toks.every(_plausibleZoneToken)) ? toks : null;
}

/** [적대검증 2] name 이 명시적 제외 문맥("…를 제외")으로 등장하는가 — 묶음 확장보다 우선. */
function _explicitlyExcluded(hay, name) {
    const n = _norm(name);
    if (!n) return false;
    let idx = hay.indexOf(n);
    while (idx !== -1) {
        const after = hay.slice(idx + n.length, idx + n.length + 6);
        if (/^(?:를|을|은|는|만)?제외/.test(after)) return true;
        idx = hay.indexOf(n, idx + 1);
    }
    return false;
}

/** [강원청 서식, 2026-07-12 아카이브 실측] 묶음명이 "해역 나열 괄호"를 동반하면
 *  ("동해중부앞바다(강원남부앞바다)") 괄호 안 개별 부모 목록이 권위 — 묶음 확장 금지.
 *  (괄호에 나열된 부모는 직접 언급 매칭으로 이미 잡히므로 누락 없음.)
 *  [3차 검증 보정] 괄호 내용이 해역 나열이 아니면(시각·요약 "(12일 05시 발표)", 제외 단서
 *  "(먼바다 제외)") 권위 목록이 아니므로 확장을 막지 않는다 — 막으면 개별 매칭도 성립하지
 *  않아 전 해역 침묵 누락. 제외 단서의 개별 해역 배제는 _explicitlyExcluded 가 담당. */
function _mentionsAsGroup(hay, key) {
    const n = _norm(key);
    if (!n) return false;
    let idx = hay.indexOf(n);
    while (idx !== -1) {
        const after = hay.slice(idx + n.length, idx + n.length + 6);
        const childPrefix = after.charAt(0) === '중';
        const excluded = /^(?:를|을|은|는|만)?제외/.test(after);
        let authoritativeParen = false;
        if (after.charAt(0) === '(') {
            const close = hay.indexOf(')', idx + n.length + 1);
            const inner = close !== -1 ? hay.slice(idx + n.length + 1, close) : '';
            authoritativeParen = /바다|연안|평수/.test(inner) && inner.indexOf('제외') === -1;
        }
        if (!childPrefix && !authoritativeParen && !excluded) return true;
        idx = hay.indexOf(n, idx + 1);
    }
    return false;
}

/**
 * hay(공백 제거된 취소 절)에서 "묶음명/부모명 + 중 + 단축자식명" 직접 지목을 찾는다.
 * 예: hay "…서해남부앞바다중평수구역과…" + prefixName "서해남부앞바다" + shortC "평수구역" → true
 * @param {string} hay - 공백 제거된 취소 절 텍스트 (_hayOf 결과)
 * @param {string} prefixName - 묶음명 또는 부모 해역명 (예: "서해남부앞바다")
 * @param {string} shortC - 자식 단축명 (정식명의 마지막 '중' 뒤 부분, 예: "먼평수구역")
 * @returns {boolean} 유효한 지목이 1곳이라도 있으면 true — 단 제외 문맥("…중 평수구역을 제외")은 무효
 * [연계] ← matchesChild (이 파일) — 0.5순위 자식 판정을 위해 부른다
 *        → _norm · _plausibleZoneToken (이 파일) — 공백 정규화 / 해역 토큰 판별을 위해 부른다
 * [실물 근거 2026-07-14] 제07-17호 "서해남부앞바다 중 평수구역과 남해서부앞바다 중 평수구역의
 *   풍랑 예비특보는 …해제하나" — 괄호도 자식 정식명도 없이 지목하는 서식이라 0·1순위가 못 잡고,
 *   '중' 가드가 부모 확정을 (옳게) 차단해 2·3순위도 못 잡아 전남 평수 7해역 취소가 침묵 누락됐다.
 *   이 함수가 그 서식을 전담한다.
 */
function _mentionsChildViaGroup(hay, prefixName, shortC) {
    const p = _norm(prefixName);
    if (!p) return false;
    let idx = hay.indexOf(p + '중');
    while (idx !== -1) {
        const tail = hay.slice(idx + p.length + 1, idx + p.length + 1 + 24);
        const tm = tail.match(/^[가-힣·]{1,18}?(?:구역|바다)/);   // 최단 매치 — "평수구역과…" → "평수구역"
        if (tm) {
            const token = tm[0];
            const after = tail.slice(token.length, token.length + 6);
            const excluded = /^(?:를|을|은|는|만)?제외/.test(after);
            const named = token === shortC ||
                (token.length >= 2 && _plausibleZoneToken(token) && shortC.indexOf(token) !== -1);
            if (!excluded && named) return true;
        }
        idx = hay.indexOf(p + '중', idx + 1);
    }
    return false;
}

/** release 가 부모 zone 을 지목하는가 — 부모명 직접(2순위) 또는 묶음명 번역(3순위).
 *  "A를 제외한 [묶음명]의 …해제" 서식(대구청 실측 계열)에서 A 는 묶음 확장에서도 빠진다. */
/** 매칭 검사 범위 — [레드팀 1-A/1-B] 취소 절(clause)만. sentence 전체를 쓰면 대조·부가
 *  절("…하나 B는 유지", "…하며 C에는 발효 중")의 해역이 취소로 오발사된다. */
function _hayOf(release) {
    return _norm(release.clause || ((release.phrase || '') + '|' + (release.sentence || '')));
}

/** 참고사항 어딘가에 "zone 는 [종류] 예비특보를 유지" 선언이 있으면 그 해역은 확정 금지. */
function _keepDeclared(release, zone) {
    if (!release || !Array.isArray(release.keeps)) return false;
    // [적대검증(c3) 결함1] keepMode=true — 유지 절의 "Z(자식)" 지정 괄호도 Z 의 유지 선언으로
    //   인정(넓은 유지 = 취소 차단 방향 = 안전).
    return release.keeps.some(k => k.tp === release.wrnTp && _mentions(_norm(k.clause), zone, true));
}

function matchesZone(release, zone) {
    if (!release || !zone) return false;
    const hay = _hayOf(release);
    if (_keepDeclared(release, zone)) return false;     // [5차] 유지 선언 — 직접·묶음 모든 경로 차단
    if (_explicitlyExcluded(hay, zone)) return false;   // 명시 제외 — 묶음 확장보다 우선
    if (_mentions(hay, zone)) return true;
    for (const key of Object.keys(ZONE_GROUP_MAP)) {
        if (ZONE_GROUP_MAP[key].indexOf(zone) !== -1 && _mentionsAsGroup(hay, key)) return true;
    }
    return false;
}

/**
 * release 가 자식(zone 아래 child)을 지목하는가.
 *   0순위: 자식 정식명이 문장에 직접 등장 ("제주도북부앞바다중연안바다" 등)
 *   0.5순위: "묶음명/부모명 중 단축명" 직접 지목 ("서해남부앞바다 중 평수구역의 …해제" —
 *          2026-07-14 제07-17호 실물. 이 zone 이 속한 묶음명(또는 zone 자신)+중+토큰이
 *          이 자식의 단축명을 가리키면 확정)
 *   1순위: 괄호 토큰이 자식 단축명과 일치 (+같은 문장에 부모/묶음명 존재 — "연안바다" 같은
 *          범용 단축명의 타 해역 오귀속 방지)
 *   2·3순위: 부모명/묶음명 매칭이면 자식도 대표(부모 취소 = 자식 자동 취소 원칙)
 *          — 단 괄호에 유효 해역 토큰이 있는데 이 자식이 없으면 "지목에서 빠진 것"이므로 비대표.
 * 예: "제주도동부앞바다의 풍랑 예비특보(북동연안바다)는 …해제" + child "북동연안바다" → true
 * @param {Object} release - parseCancelPhrases 결과 항목 ({ wrnTp, clause, parenChildren, keeps … })
 * @param {string} zone - 부모 해역명 (예: "전남북부서해앞바다")
 * @param {string} child - 자식 정식명 (예: "전남북부서해앞바다중평수구역")
 * @returns {boolean} 이 취소 문구가 해당 자식을 지목하면 true
 * [연계] ← marine_warning_crawler.js _evaluateCancelVerdicts — 보류실 (c) 자식 판정에서 부른다
 *          (true 면 그 자식의 예비취소가 확정되어 CHILD_PRELIM_CANCEL 푸시가 발사됨)
 *        → matchesZone · _mentionsChildViaGroup · _mentions · _keepDeclared (이 파일)
 */
function matchesChild(release, zone, child) {
    if (!release || !zone || !child) return false;
    if (_keepDeclared(release, zone) || _keepDeclared(release, child)) return false;   // [5차] 유지 선언
    const hay = _hayOf(release);
    const shortC = _norm(String(child).split('중').pop());
    const fullC = _norm(child);
    if (_mentions(hay, fullC)) return true;   // 0순위 — 정식명 직접
    // 0.5순위 — 묶음명/부모명 + 중 + 단축명 (취소 절 안에서만: hay 가 이미 clause 한정)
    const prefixes = [zone].concat(Object.keys(ZONE_GROUP_MAP).filter(k => ZONE_GROUP_MAP[k].indexOf(zone) !== -1));
    if (prefixes.some(p => _mentionsChildViaGroup(hay, p, shortC))) return true;
    // 0.7순위 — [2026-07-14 대구 실물형] 부모명에 직접 붙은 지정 괄호("경북남부앞바다(평수구역)의
    //   …해제")는 취소 범위의 권위: 나열된 자식만 확정, 빠진 자식은 부모 대표 금지.
    //   (부모 자체의 오확정 차단은 _mentions ③ 이 담당 — 여기는 자식 방향)
    //   [적대검증(c3) 결함5] 같은 zone 이 비지정 괄호("Z(13일 05시 발표)")와 지정 괄호를 함께
    //   달고 나올 수 있어 첫 occurrence 에서 멈추지 않고 지정 괄호가 나올 때까지 전부 훑는다.
    {
        const zn = _norm(zone);
        let zi = hay.indexOf(zn + '(');
        while (zi !== -1) {
            const toks = _designationParenAt(hay, zi + zn.length);
            if (toks) {
                return toks.some(t => t === shortC || t === fullC || (fullC.indexOf(t) !== -1 && t.length >= 2));
            }
            zi = hay.indexOf(zn + '(', zi + 1);
        }
    }
    const tokenHit = release.parenChildren.some(t => {
        const nt = _norm(t);
        return nt === shortC || nt === fullC || (fullC.indexOf(nt) !== -1 && nt.length >= 2);
    });
    if (tokenHit && matchesZone(release, zone)) return true;
    // 괄호 유효 토큰 없음 → 부모명 대표 (동해권 서식: 자식 명칭 미표기 실측 확정)
    if (release.parenChildren.length === 0 && matchesZone(release, zone)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// 통보문 목록/상세 조회
// ---------------------------------------------------------------------------
function _parseOptions(html) {
    const out = [];
    const seen = new Set();
    const re = /<option\s+value="((?:met|pwn):\d{12}:\d+)"[^>]*>([^<]*)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (seen.has(m[1])) continue;   // 데스크톱/모바일 select 중복 제거
        seen.add(m[1]);
        out.push({ reportId: m[1], title: m[2].trim() });
    }
    return out;
}

async function _fetchReportText(stn, kind, date, reportId) {
    const qs = `prevStn=${stn}&prevKind=${kind}&prevCmtCd=&stn=${stn}&kind=${kind}&date=${date}` +
        `&reportId=${encodeURIComponent(reportId)}`;
    const html = await _fetchHtml(`${LIST_PATH}?${qs}`);
    // [함정 방어] reportId 가 무시되면 조용히 최신 통보문이 온다 — selected 마커로 교차 검증.
    //   검증 실패 시 이 통보문은 "스캔 안 됨"으로 두고(seen 미기록) 다음 사이클에 재시도.
    const selRe = new RegExp(`value="${reportId.replace(/[:]/g, '\\:')}"[^>]*selected`);
    if (!selRe.test(html)) {
        throw new Error(`reportId 선택 미반영: ${stn}/${reportId}`);
    }
    return _htmlToText(html);
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 보류 중 해역들의 관할 지방청 통보문을 스캔해 취소 문구를 수집한다.
 * @param {Object} p
 *   p.offices : Set<string> — 조회할 관서코드 집합 (호출측이 관할청+108(+강원 105) 구성)
 *   p.dates   : string[]    — 'YYYY-MM-DD' (보통 오늘, 자정 걸침 대비 등록일 포함)
 * @returns { fetchedAt, releases, scannedCount, rawByOffice } | throw(전체 실패 시)
 *   releases: 최근 RELEASE_MEMORY_TTL_MS 내 발견 누적(보류 등록 전 발행 통보문 커버).
 */
async function scan({ offices, dates }) {
    const now = Date.now();
    // seen/누적 TTL 정리
    for (const [k, ts] of _seenReports) if (now - ts > SEEN_REPORT_TTL_MS) { _seenReports.delete(k); _failCounts.delete(k); }
    _recentReleases = _recentReleases.filter(r => now - r.foundAt < RELEASE_MEMORY_TTL_MS);
    _recentExclusions = _recentExclusions.filter(r => now - r.foundAt < RELEASE_MEMORY_TTL_MS);
    _recentDesignations = _recentDesignations.filter(r => now - r.foundAt < RELEASE_MEMORY_TTL_MS);

    const rawByOffice = {};
    let scanned = 0;
    let anySuccess = false, lastErr = null;

    for (const stn of offices) {
        for (const kind of KINDS) {
            for (const date of dates) {
                let options;
                try {
                    const listHtml = await _fetchHtml(`${LIST_PATH}?stn=${stn}&kind=${kind}&date=${date}`);
                    options = _parseOptions(listHtml);
                    anySuccess = true;
                } catch (e) { lastErr = e; continue; }

                let attempted = 0;   // [4차 통합검증 6] 실패도 계수 — 전건 실패 시 무상한 재조회 방지
                for (const opt of options) {
                    const key = `${stn}|${kind}|${opt.reportId}`;
                    if (_seenReports.has(key)) continue;
                    if (scanned + attempted >= MAX_DETAIL_FETCH_PER_SCAN) continue;   // [적대검증 5] 이월
                    let text;
                    try {
                        text = await _fetchReportText(stn, kind, date, opt.reportId);
                    } catch (e) {
                        lastErr = e;
                        attempted++;
                        const fc = (_failCounts.get(key) || 0) + 1;
                        _failCounts.set(key, fc);
                        if (fc >= MAX_DETAIL_FAILS) {
                            _seenReports.set(key, Date.now());   // 포기 — 더는 재시도하지 않음
                            console.warn(`[BulletinScan] 상세 조회 ${fc}회 실패 — 포기: ${key} (${e && e.message})`);
                        }
                        continue;   // 미포기 건은 다음 사이클 재시도
                    }
                    _failCounts.delete(key);
                    _seenReports.set(key, Date.now());
                    scanned++;
                    // [2026-07-14] 해당구역 절 제외 단서 수집 (참고사항 밖 — 전문에서)
                    for (const exc of parseExclusions(text)) {
                        exc.foundAt = Date.now();
                        exc.issuedAtMs = _reportIssuedAtMs(opt.reportId);
                        exc.source = `${stn}/${kind}/${opt.reportId}`;
                        _recentExclusions.push(exc);
                        console.log(`[BulletinScan] 제외 단서 발견: ${exc.parent}(${exc.excluded.join(',')} 제외) [${exc.tp || '종류미상'}] (${exc.source})`);
                    }
                    // [2026-07-14 제주 실물] 해당구역 절 지정 단서 수집 ("부모( 남는 자식만 )")
                    for (const des of parseDesignations(text)) {
                        des.foundAt = Date.now();
                        des.issuedAtMs = _reportIssuedAtMs(opt.reportId);
                        des.source = `${stn}/${kind}/${opt.reportId}`;
                        _recentDesignations.push(des);
                        console.log(`[BulletinScan] 지정 단서 발견: ${des.parent}(${des.listed.join(',')}) [${des.tp || '종류미상'}] (${des.source})`);
                    }
                    const ref = _refSection(text);
                    if (ref) {
                        // TTL 만료 로그용 원문 보존 (관서당 최근 1건, 500자)
                        rawByOffice[stn] = ref.slice(0, 500);
                        for (const rel of parseCancelPhrases(ref)) {
                            rel.foundAt = Date.now();
                            rel.source = `${stn}/${kind}/${opt.reportId}`;
                            // [적대검증 1] 통보문 발행시각 — (c) 판정의 시간 축 게이트에 사용.
                            rel.issuedAtMs = _reportIssuedAtMs(opt.reportId);
                            _recentReleases.push(rel);
                            console.log(`[BulletinScan] 취소 문구 발견: [${rel.wrnTp}] "${rel.sentence.slice(0, 120)}" (${rel.source})`);
                        }
                    }
                }
            }
        }
    }

    if (!anySuccess) throw (lastErr || new Error('bulletin scan: 전 관서 조회 실패'));
    return {
        fetchedAt: now,
        releases: _recentReleases.slice(),
        exclusions: _recentExclusions.slice(),
        designations: _recentDesignations.slice(),
        scannedCount: scanned,
        rawByOffice
    };
}

/** 테스트/리허설용 상태 초기화 */
function _resetForTest() {
    _seenReports.clear();
    _failCounts.clear();
    _recentReleases = [];
    _recentExclusions = [];
    _recentDesignations = [];
}

module.exports = {
    scan,
    parseCancelPhrases,
    parseExclusions,
    matchesChildExclusion,
    parseDesignations,
    matchesChildDesignation,
    designationAppliesTo,
    matchesZone,
    matchesChild,
    RE_RELEASE,
    _htmlToText,
    _refSection,
    _parseOptions,
    _reportIssuedAtMs,
    _mentions,
    _resetForTest
};
