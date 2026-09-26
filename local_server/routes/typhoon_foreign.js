/**
 * ============================================================================
 * 파일명: routes/typhoon_foreign.js
 * 역할: 해외 기관 태풍 자료를 우리 태풍 탭이 쓰는 형식으로 바꿔 내주는 API.
 *       미국 JTWC(합동태풍경보센터)·일본 기상청(JMA)·유럽 ECMWF 세 곳 — 모두 공개 자료를 직접 읽는다.
 * ============================================================================
 *
 * - GET /api/typhoon/foreign?src=jtwc|jma|ecmwf → 활성 태풍 + 통보(자문) + 예보 프레임
 * - GET /api/typhoon/foreign/image?src=jtwc&seq=wp2526  → JTWC 경고 그래픽(gif) 중계
 *   (일본은 예보도 그림 파일이 없어 이 주소를 쓰지 않는다)
 *
 * [왜 중계 업체를 거치지 않나 — 2026-09-25 전환]
 *   처음에는 Xweather 라는 중계 업체를 거쳐 받았다. 그런데 그 이용약관
 *   (Vaisala General Conditions of Subscription Services)이
 *     §2.2 받은 자료를 "for your internal business purposes" 로만 쓰도록 제한하고,
 *     §2.3(ii) "distribute, publish ... or otherwise make available ... to third
 *              parties" 를 명시적으로 금지한다.
 *   우리 앱은 일반에 공개돼 있으므로 그 경로로는 쓸 수 없다.
 *   JTWC 자료 자체는 미국 정부 저작물이라 저작권이 없고 누구나 쓸 수 있다.
 *   그래서 중계를 빼고 JTWC 가 공개하는 원본을 직접 읽는다. 키도 필요 없어졌다.
 *
 * [어디서 무엇을 받나]
 *   목록  .../jtwc/products/abpwweb.txt · abioweb.txt    지금 활동 중인 태풍 번호·이름
 *   본문  https://www.metoc.navy.mil/jtwc/products/wp2526web.txt   위치·풍속·반경·예보
 *   도형  https://www.metoc.navy.mil/jtwc/products/wp2526.kmz      위험구역·지나온 경로
 *   그림  https://www.metoc.navy.mil/jtwc/products/wp2526.gif      경고 그래픽
 *   seq 는 그 파일 이름의 앞부분('wp2526')을 그대로 쓴다 — 번호를 따로 만들지 않는다.
 *
 * [기상청과 다른 점 — 그대로 옮길 수 없는 것들]
 *   1. 중심기압: 현재 시점만 준다(통보문 REMARKS). 예보 시점은 발표하지 않는다 → null.
 *   2. 70% 확률반경: 없다 → radProb 는 null.
 *      대신 구글어스 파일(.kmz)의 '34노트 위험구역'을 그대로 싣는다(swath). 이 도형은
 *      바람 반경을 이어 붙인 것이 아니라 예보 오차가 이미 들어 있다(services/jtwc_kmz.js).
 *      .kmz 를 못 받거나 자문 회차가 통보문과 다르면 싣지 않는다 — 지어내지 않는다.
 *   3. 풍속반경: 북동·남동·남서·북서 네 방향 거리를 34/50/64노트별로 준다.
 *      네 방향 값을 그대로 싣고(radQuad34/50/64), 장·단반경도 함께 채운다.
 *   4. 풍속 평균 시간: JTWC 1분 · 기상청 10분 → 강도는 0.88 을 곱해 환산 후 판정.
 *   5. 지나온 경로: 글자 통보문에는 없고 .kmz 에만 있다(past). 기상청 경로에는 이 칸이
 *      없으므로 화면은 있을 때만 그린다.
 *
 * [시각] 통보문은 UTC("일일시시분분Z")다. 여기서 한국시각 문자열로 바꿔 보낸다.
 *
 * [호출수] 목록 1회 + 태풍 수만큼. 상류가 6시간마다 갱신되므로 30분 캐시면 충분하다.
 *
 * [일본(JMA)은 무엇이 다른가 — 2026-09-25 추가]
 *   일본 기상청은 우리 기상청과 **같은 방식**으로 발표한다(둘 다 세계기상기구 방식).
 *   그래서 미국에 없던 70% 확률반경과 예상 시점 중심기압이 그대로 들어 있고,
 *   풍속도 10분 평균이라 환산이 필요 없다. 자세한 것은 services/jma_parse.js 참조.
 *   [출처표기] 일본 기상청 홈페이지 자료는 「공공데이터 이용규약(제1.0판)」 적용이라
 *     출처를 적고, 가공했으면 가공했다고 밝혀야 한다 — 화면 안내문에 그렇게 적는다.
 *     (https://www.jma.go.jp/jma/kishou/info/coment.html)
 *
 * [유럽(ECMWF)은 무엇이 다른가 — 2026-09-26 추가]
 *   기관이 사람이 검토해 내는 '공식 예보'가 아니라 **컴퓨터 모델(IFS)의 예측 경로**다.
 *   이진 형식(BUFR)이라 services/ecmwf_bufr.js 가 직접 푼다(ecCodes 와 전 칸 대조로 검증).
 *   70% 확률반경·돌풍·이동방향이 없고, 풍속은 모델이 계산한 10m 바람이라 강도는 참고용이다.
 *   이용 조건 CC-BY-4.0 — 출처를 밝힌다(https://www.ecmwf.int/en/forecasts/datasets/open-data).
 *
 * [연계 파일]
 * - server.js → app.use() 로 등록
 * - services/jtwc_parse.js → 통보문·목록 해독
 * - services/jtwc_kmz.js → 구글어스 파일(.kmz)에서 위험구역·지나온 경로 해독
 * - services/jma_parse.js → 일본 기상청 태풍 JSON 해독
 * - services/ecmwf_bufr.js → 유럽 ECMWF 태풍 경로(BUFR) 해독
 * - client/js/typhoon/ocean_typhoon.js → 출처 드롭다운에서 "미국(JTWC)" 선택 시 호출
 * ============================================================================
 */

'use strict';

const express = require('express');
const router = express.Router();
const jtwc = require('../services/jtwc_parse');
const jtwcKmz = require('../services/jtwc_kmz');
const jma = require('../services/jma_parse');
const ecmwf = require('../services/ecmwf_bufr');

const JTWC_BASE = 'https://www.metoc.navy.mil/jtwc/';
// [어디서 목록을 얻나 — 2026-09-25 실측]
//   jtwc.html        → 403   안내 화면은 막혀 있다
//   products/        → 403   폴더 목록 보기도 막혀 있다
//   products/<파일>  → 200   폴더 안의 '파일'은 받아진다
//   그래서 활동 중인 태풍을 나열해 주는 '해역 기상정보' 파일 두 개를 읽는다.
//   ABPW10 = 서태평양·남태평양(우리 앞바다 포함) · ABIO10 = 인도양.
const ADVISORY_URLS = [
    JTWC_BASE + 'products/abpwweb.txt',
    JTWC_BASE + 'products/abioweb.txt'
];
const PRODUCT_BASE = JTWC_BASE + 'products/';
const HTTP_TIMEOUT_MS = 20000;
// [왜 표식을 보내나] .mil 사이트는 브라우저 표식이 없는 요청을 막는 경우가 있다.
//   그림(products/*.gif)은 표식 없이도 받아지는데 목록 화면만 실패했다 — 그 차이를 메운다.
const UA = 'Mozilla/5.0 (compatible; SEAGNAL/1.0; +https://seagnal-server.fly.dev)';
const REQ_HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,text/plain,*/*' };
const JMA_BASE = 'https://www.jma.go.jp/bosai/typhoon/data/';
const SOURCES = ['jtwc', 'jma', 'ecmwf'];
const ECMWF_BASE = 'https://data.ecmwf.int/forecasts/';
// [보여 줄 범위] 유럽 파일은 6시간 간격으로 최대 360시간(15일)까지 준다. 그대로 그리면
//   시점마다 말풍선이 붙어 지도가 60개 넘는 말풍선으로 뒤덮인다. 다른 기관(최대 120시간)과
//   같은 범위·간격으로 맞춘다 — 자료를 지어내는 게 아니라 있는 시점 중 일부만 고르는 것이다.
const ECMWF_MAX_HOURS = 120;
const ECMWF_STEP_HOURS = 12;
const TTL_MS = 30 * 60 * 1000;          // 상류가 6시간마다 갱신 — 30분이면 충분
// [왜 15분인가] 2026-09-25 21:47 KST 에 나란히 받아 보니 일본은 21:00 기준, 미국은 15:00 기준이었다.
//   일본의 정확한 발표 주기는 확인하지 않았다 — 새 발표를 늦게 보이지 않도록 미국(30분)보다 짧게 둔다.
const JMA_TTL_MS = 15 * 60 * 1000;
const KST_OFFSET_MS = 9 * 3600 * 1000;
const FRESH_MS = 18 * 3600 * 1000;      // 이 시간보다 오래된 통보문은 끝난 태풍으로 본다
// [왜 한 번 더 거르나] 해역 기상정보는 하루 단위로 나온다(ABPW10 은 24시간 유효).
//   그 사이 경보가 끝난 태풍이 글에 남아 있을 수 있어, 통보문 발표 시각으로 한 번 더 본다.
//   JTWC 는 활동 중이면 6시간마다 통보문을 낸다.

const cache = {};   // 출처별 { at: ms, data: 응답객체 } — 출처마다 따로 담는다

/** 한국시각 문자열("YYYYMMDDHHmm") → epoch ms. 못 읽으면 null. */
function kstStampToMs(stamp) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(stamp || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST_OFFSET_MS;
}

/** 상류에서 글자 자료를 받아온다. 실패하면 null(예외를 위로 던지지 않는다). */
let lastError = '';   // 마지막 상류 실패 사유 — 응답의 detail 로 내보낸다(원인 없이 실패하지 않게)
const probe = {};     // 어느 주소가 몇 번으로 답했는지 — 막힌 곳을 찾을 때 쓴다

async function fetchText(url) {
    try {
        const res = await fetch(url, {
            headers: REQ_HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
        });
        probe[url] = res.status;
        if (!res.ok) {
            lastError = 'http_' + res.status;
            console.log(`[typhoon-foreign] ${url} 응답 ${res.status}`);
            return null;
        }
        return await res.text();
    } catch (e) {
        lastError = String(e.name || 'error') + ':' + String(e.message || '').slice(0, 80);
        console.log(`[typhoon-foreign] ${url} 호출 실패: ${e.message}`);
        return null;
    }
}

/**
 * 상류에서 덩어리 자료(.kmz)를 받아온다. 실패하면 null.
 * [왜 따로 두나] fetchText 는 글자로 바꿔 버려서 압축 파일이 깨진다.
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function fetchBuffer(url) {
    try {
        const res = await fetch(url, {
            headers: REQ_HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
        });
        probe[url] = res.status;
        if (!res.ok) {
            console.log(`[typhoon-foreign] ${url} 응답 ${res.status}`);
            return null;
        }
        return Buffer.from(await res.arrayBuffer());
    } catch (e) {
        console.log(`[typhoon-foreign] ${url} 호출 실패: ${e.message}`);
        return null;
    }
}

/**
 * 태풍 하나의 구글어스 파일(.kmz)을 받아 위험구역·지나온 경로를 꺼낸다.
 * 예: fetchShapes('wp2526', 8) → { swath:[[135.84,34.09], …], past:[…] }
 * [왜 회차를 맞춰 보나] .kmz 가 통보문보다 한 회차 늦게 올라오는 때가 있다. 그러면
 *   지난 예보의 위험구역을 새 예보 위에 그리게 된다 — 다르면 아예 싣지 않는다.
 * [실패해도 전체는 살린다] 도형이 없다고 태풍 자체를 못 보여 줄 이유는 없다.
 * @param {string} base - 'wp2526'
 * @param {string} advisory - 통보문에서 읽은 자문 회차('8')
 * @returns {Promise<{swath:Array|null, past:Array}|null>}
 */
async function fetchShapes(base, advisory) {
    const buf = await fetchBuffer(PRODUCT_BASE + base + '.kmz');
    if (!buf) return null;
    const k = jtwcKmz.parseKmz(buf);
    if (!k) { console.log(`[typhoon-foreign] ${base}.kmz 해독 실패(${buf.length}바이트)`); return null; }
    if (k.advisory !== null && String(k.advisory) !== String(advisory)) {
        console.log(`[typhoon-foreign] ${base}.kmz 자문 ${k.advisory}호 ≠ 통보문 ${advisory}호 — 도형 제외`);
        return null;
    }
    console.log(`[typhoon-foreign] ${base}.kmz 위험구역 ${k.swath ? k.swath.length : 0}점 · 지나온 경로 ${k.past.length}개`);
    return k;
}

/**
 * 한국시각 문자열("YYYYMMDDHHmm") → 통보문 라벨에 쓰는 "09.25. 09:00" 꼴.
 * @param {string} stamp
 * @returns {string}
 */
function stampToLabel(stamp) {
    const s = String(stamp || '');
    if (s.length < 12) return '';
    return s.slice(4, 6) + '.' + s.slice(6, 8) + '. ' + s.slice(8, 10) + ':' + s.slice(10, 12);
}

/**
 * JTWC 목록 + 통보문을 받아 우리 응답 형식으로 만든다. 30분 캐시.
 * @returns {Promise<Object|null>} 실패하면 null
 */
async function fetchJtwc() {
    if (cache.jtwc && (Date.now() - cache.jtwc.at) < TTL_MS) return cache.jtwc.data;

    lastError = '';
    Object.keys(probe).forEach(k => delete probe[k]);
    const year = new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear();

    // 해역 기상정보 두 개를 읽어 활동 중인 태풍 번호를 모은다.
    const texts = await Promise.all(ADVISORY_URLS.map(fetchText));
    if (texts.every(t => t === null)) return null;      // 둘 다 못 받으면 지어내지 않는다

    let chars = 0;
    const bases = [];
    const seen = {};
    texts.forEach((t) => {
        if (!t) return;
        chars += t.length;
        jtwc.parseAdvisory(t).forEach((st) => {
            const base = jtwc.fileBase(st.code, year);
            if (!base || seen[base]) return;
            seen[base] = true;
            bases.push(base);
        });
    });
    // [왜 남기나] 화면이 비었을 때 "정말 태풍이 없다"와 "목록을 못 읽었다"가 구별돼야 한다.
    //   (L-291 — 실패가 무결처럼 보이면 안 된다.) 글은 받았는데 0개면 정말 없는 것이다.
    console.log(`[typhoon-foreign] 해역정보 ${chars}자 → 활동 중 ${bases.length}개`);

    const warnings = await Promise.all(bases.map(async (base) => {
        const txt = await fetchText(PRODUCT_BASE + base + 'web.txt');
        if (txt === null) return null;
        const w = jtwc.parseWarning(txt);
        if (!w) { console.log(`[typhoon-foreign] ${base} 통보문 해독 실패`); return null; }
        // 끝난 태풍 거르기 — 통보문이 남아 있어도 발표가 끊기면 더는 활동 중이 아니다.
        const ms = kstStampToMs(w.issuedKst);
        if (ms !== null && (Date.now() - ms) > FRESH_MS) {
            console.log(`[typhoon-foreign] ${base} 오래된 통보문(${w.issuedKst}) — 제외`);
            return null;
        }
        return w;
    }));

    // 도형(.kmz)은 통보문을 읽은 태풍에 대해서만 받는다 — 헛걸음을 만들지 않는다.
    const shapes = await Promise.all(warnings.map(
        (w) => (w ? fetchShapes(w.seq, w.advisory) : Promise.resolve(null))
    ));

    const typhoons = [];
    warnings.forEach((w, i) => {
        if (!w) return;
        const sh = shapes[i];
        const label = '[ JTWC ] 제' + w.advisory + '호 자문'
                    + (w.issuedKst ? ' / ' + stampToLabel(w.issuedKst) + ' 기준(KST)' : '');
        typhoons.push({
            seq: w.seq,                       // 'wp2526' — 제품 파일 이름과 같다
            name: w.name,
            nameEn: w.name,
            // 경고 그래픽은 목록에 오른 태풍이면 모두 있다(해역과 무관).
            imageName: w.seq + '.gif',
            latestTmFc: w.issuedKst,
            // .kmz 에서 온 것들 — 못 받았으면 아예 없다(빈 껍데기를 만들지 않는다).
            swath: (sh && sh.swath) || null,
            past: (sh && sh.past && sh.past.length) ? sh.past : null,
            bulletins: [{
                code: w.seq + '_' + w.advisory,
                label: label,
                kind: 'TYP',
                isLatest: true,
                current: w.current,
                forecast: w.forecast,
                // 화면 안내(i 버튼)가 그대로 쓰는 자리 — 기관 차이를 여기서 알린다.
                rem: 'JTWC(미국 합동태풍경보센터)가 공개한 통보문을 그대로 읽은 자료입니다.'
                   + '|풍속은 1분 평균이라 기상청(10분 평균)보다 높게 나옵니다.'
                   + '|강도(약~초강력)는 그 풍속을 10분 평균으로 환산해 기상청 기준에 맞춘 값입니다.'
                   + '|중심기압은 지금 위치만 발표됩니다. 예상 위치의 기압은 제공되지 않습니다.'
                   + '|70% 확률반경은 발표되지 않습니다. 대신 JTWC 가 발표하는'
                   + ' \'34노트 위험구역\'을 그립니다 — 예보가 빗나갈 가능성까지 넣어,'
                   + ' 태풍이 그대로 가지 않더라도 초속 17m 이상 바람이 닿을 수 있는 범위입니다.'
                   + '|강풍·폭풍반경은 북동·남동·남서·북서 네 방향 거리를 그대로 그립니다.',
                other: '미국 합동태풍경보센터(JTWC) 공개 통보문 · 미국 정부 공공저작물 · 6시간마다 갱신'
            }]
        });
    });

    const data = {
        success: true,
        src: 'jtwc',
        label: '미국(JTWC)',
        updatedAt: new Date().toISOString(),
        year: year,
        hasActive: typhoons.length > 0,
        // 목록을 읽은 흔적 — 0개일 때 "태풍이 없다"인지 "못 읽었다"인지 가르는 단서.
        listChars: chars,
        typhoons: typhoons
    };
    cache.jtwc = { at: Date.now(), data: data };
    return data;
}

/** JSON 자료를 받아온다. 실패하면 null(예외를 위로 던지지 않는다). */
async function fetchJson(url) {
    const txt = await fetchText(url);
    if (txt === null) return null;
    try {
        return JSON.parse(txt);
    } catch (e) {
        lastError = 'json:' + String(e.message || '').slice(0, 60);
        console.log(`[typhoon-foreign] ${url} 해독 실패: ${e.message}`);
        return null;
    }
}

/**
 * 일본 기상청 자료를 받아 우리 응답 형식으로 만든다. 15분 캐시.
 * [어떻게 받나] 목록(targetTc.json) → 태풍마다 본문(specifications.json)과
 *   경로(forecast.json). 셋 다 그냥 JSON 이라 미국 통보문보다 해독이 간단하다.
 * [못 받으면] 목록을 못 받으면 null — 지어내지 않는다. 태풍 하나의 본문만 못 받으면
 *   그 태풍만 빼고 나머지는 보여 준다.
 * @returns {Promise<Object|null>}
 */
async function fetchJma() {
    if (cache.jma && (Date.now() - cache.jma.at) < JMA_TTL_MS) return cache.jma.data;

    lastError = '';
    Object.keys(probe).forEach(k => delete probe[k]);

    const list = await fetchJson(JMA_BASE + 'targetTc.json');
    if (list === null) return null;              // 못 읽은 것과 '태풍 없음'은 다르다
    const targets = jma.parseTargetList(list);
    console.log(`[typhoon-foreign] JMA 목록 ${Array.isArray(list) ? list.length : 0}건 → 읽은 태풍 ${targets.length}개`);

    const typhoons = [];
    for (const t of targets) {
        const spec = await fetchJson(JMA_BASE + t.id + '/specifications.json');
        const parsed = spec ? jma.parseSpecifications(spec) : null;
        if (!parsed) { console.log(`[typhoon-foreign] JMA ${t.id} 본문 해독 실패 — 제외`); continue; }

        const fc = await fetchJson(JMA_BASE + t.id + '/forecast.json');
        const past = fc ? jma.parseTrack(fc) : [];

        const current = parsed.frames.find(f => f.isCurrent) || null;
        const forecast = parsed.frames.filter(f => !f.isCurrent);
        const label = '[ JMA ] 제' + parsed.number.slice(2) + '호 태풍'
                    + (current ? ' / ' + stampToLabel(current.time) + ' 기준(KST)' : '');
        console.log(`[typhoon-foreign] JMA ${t.id} ${parsed.name} 프레임 ${parsed.frames.length}개 · 지나온 경로 ${past.length}점`);

        typhoons.push({
            seq: t.id,                       // 'TC2632' — 일본이 쓰는 식별자 그대로
            name: parsed.name,
            nameEn: parsed.name,
            latestTmFc: current ? current.time : parsed.issuedKst,
            // 일본은 예보도 그림 파일이 없다 → 지도 그림 버튼을 띄우지 않는다.
            past: past.length ? past : null,
            // 미국의 '34노트 위험구역' 같은 도형은 일본에 없다.
            swath: null,
            bulletins: [{
                code: t.id + '_' + (parsed.issuedKst || ''),
                label: label,
                kind: 'TYP',
                isLatest: true,
                current: current,
                forecast: forecast,
                rem: '일본 기상청(JMA)이 공개한 태풍정보를 우리 화면 형식으로 옮긴 자료입니다.'
                   + '|풍속은 10분 평균이라 우리 기상청과 같은 기준입니다.'
                   + '|강풍반경은 초속 15m, 폭풍반경은 초속 25m 이상이 부는 범위로'
                   + ' 우리 기상청과 기준이 같습니다.'
                   + '|70% 확률반경(예보원)과 예상 시점의 중심기압도 함께 발표됩니다.'
                   + '|강풍반경은 현재 시점에, 폭풍반경은 예상 시점에 발표됩니다 —'
                   + ' 일본 기상청이 그렇게 발표하는 것이라 없는 시점은 그리지 않습니다.',
                other: '출처: 일본 기상청 홈페이지(https://www.jma.go.jp/bosai/typhoon/)'
                     + ' — 우리 화면 형식으로 가공해 작성'
            }]
        });
    }

    const data = {
        success: true,
        src: 'jma',
        label: '일본(JMA/RSMC)',
        updatedAt: new Date().toISOString(),
        year: new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear(),
        hasActive: typhoons.length > 0,
        listChars: JSON.stringify(list).length,
        typhoons: typhoons
    };
    cache.jma = { at: Date.now(), data: data };
    return data;
}

/**
 * 유럽 파일 주소 후보 — 최신 실행부터. 00·12 UTC 두 번 돌고, 태풍이 있을 때만 파일이 생긴다.
 * 예: 2026-09-26 05Z 에 부르면 → 26일 00z, 25일 12z, 25일 00z 순서
 * [아직 안 올라온 실행] 실행 뒤 몇 시간 지나야 올라오므로 404 면 다음 후보로 넘어간다.
 * @param {number} nowMs
 * @returns {Array<{url:string, runUtcMs:number}>}
 */
function ecmwfCandidates(nowMs) {
    const out = [];
    const day0 = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
    const p = (n) => String(n).padStart(2, '0');
    for (let back = 0; back <= 1; back++) {
        [12, 0].forEach((hh) => {
            const run = day0 - back * 86400000 + hh * 3600000;
            if (run > nowMs) return;                       // 아직 오지 않은 실행
            const d = new Date(run);
            const ymd = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
            out.push({
                url: ECMWF_BASE + ymd + '/' + p(hh) + 'z/ifs/0p25/oper/' + ymd + p(hh) + '0000-360h-oper-tf.bufr',
                runUtcMs: run
            });
        });
    }
    return out;
}

/**
 * 유럽 ECMWF 자료를 받아 우리 응답 형식으로 만든다. 30분 캐시(상류는 하루 두 번).
 * [못 받으면] 후보를 다 돌아도 파일이 없으면 null — '태풍 없음'과 구별되게 실패로 알린다.
 *   (파일은 태풍이 있을 때만 생기므로, 없는 경우도 실제로 있을 수 있다 — probe 로 가른다.)
 * @returns {Promise<Object|null>}
 */
async function fetchEcmwf() {
    if (cache.ecmwf && (Date.now() - cache.ecmwf.at) < TTL_MS) return cache.ecmwf.data;

    lastError = '';
    Object.keys(probe).forEach(k => delete probe[k]);

    let buf = null, used = null;
    for (const c of ecmwfCandidates(Date.now())) {
        buf = await fetchBuffer(c.url);
        if (buf && buf.slice(0, 4).toString('latin1') === 'BUFR') { used = c; break; }
        buf = null;
    }
    if (!buf) { lastError = lastError || 'no_file'; return null; }

    const recs = ecmwf.decodeMessages(buf);
    const storms = recs.map(ecmwf.toTyphoon).filter(Boolean);
    console.log(`[typhoon-foreign] ECMWF ${used.url.split('/').pop()} 메시지 ${recs.length}개`
              + ` (못 푼 것 ${recs.filter(r => !r).length}) → 태풍 ${storms.length}개`);

    const typhoons = storms.map((t) => {
        const current = t.frames[0];
        // 12시간 간격·120시간까지만 고른다(위 ECMWF_MAX_HOURS 주석).
        const baseMs = kstStampToMs(t.baseKst);
        const forecast = t.frames.slice(1).filter((f) => {
            const h = Math.round((kstStampToMs(f.time) - baseMs) / 3600000);
            return h > 0 && h <= ECMWF_MAX_HOURS && h % ECMWF_STEP_HOURS === 0;
        });
        const seq = 'EC' + t.id;
        return {
            seq: seq,
            name: t.name,
            nameEn: t.name,
            latestTmFc: t.baseKst,
            past: null,                 // 이 파일은 앞으로의 경로만 준다
            swath: null,
            bulletins: [{
                code: seq + '_' + t.baseKst,
                label: '[ ECMWF ] 모델 예측 / ' + stampToLabel(t.baseKst) + ' 기준(KST)',
                kind: 'TYP',
                isLatest: true,
                current: current,
                forecast: forecast,
                rem: '유럽중기예보센터(ECMWF)의 컴퓨터 모델(IFS)이 계산한 예측 경로입니다.'
                   + ' 기관이 발표하는 공식 태풍 예보가 아닙니다.'
                   + '|풍속은 모델이 계산한 바람이라 관측 기준의 평균 시간이 없습니다.'
                   + ' 강도(약~초강력)는 참고용입니다.'
                   + '|70% 확률반경·돌풍·이동 방향은 제공되지 않습니다.'
                   + '|강풍·폭풍반경은 초속 18m·26m 이상 바람의 네 방향 거리입니다.'
                   + '|원자료는 15일까지 있으나, 다른 기관과 같게 5일(120시간)까지 12시간 간격으로 보여 드립니다.',
                other: '출처: 유럽중기예보센터(ECMWF) 공개자료(https://data.ecmwf.int) · CC BY 4.0'
            }]
        };
    });

    const data = {
        success: true,
        src: 'ecmwf',
        label: '유럽(ECMWF)',
        updatedAt: new Date().toISOString(),
        year: new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear(),
        hasActive: typhoons.length > 0,
        listChars: buf.length,
        typhoons: typhoons
    };
    cache.ecmwf = { at: Date.now(), data: data };
    return data;
}

/** 출처 이름에 맞는 자료를 준다. 모르는 출처면 null. */
function fetchActive(src) {
    if (src === 'jtwc') return fetchJtwc();
    if (src === 'jma') return fetchJma();
    if (src === 'ecmwf') return fetchEcmwf();
    return Promise.resolve(null);
}

/**
 * GET /api/typhoon/foreign?src=jtwc|jma
 * 성공: { success:true, src, label, updatedAt, year, hasActive, typhoons:[…] }
 *   — 기상청 응답과 같은 모양이라 화면(ocean_typhoon.js)이 그대로 그린다.
 * 실패: { success:false, reason:'bad_src'|'upstream' }
 */
router.get('/api/typhoon/foreign', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=600');
    const src = String(req.query.src || 'jtwc').toLowerCase();
    if (SOURCES.indexOf(src) < 0) return res.json({ success: false, reason: 'bad_src' });
    const data = await fetchActive(src);
    if (!data) {
        // 어느 주소가 몇 번으로 답했는지 함께 알린다 — 막힌 곳을 바로 짚을 수 있게.
        const where = Object.keys(probe).map(u => u.replace(JTWC_BASE, '') + '=' + probe[u]).join(' ');
        return res.json({ success: false, reason: 'upstream', detail: lastError, probe: where });
    }
    res.json(data);
});

/**
 * GET /api/typhoon/foreign/image?src=jtwc&seq=wp2526[&download=1]
 * JTWC 경고 그래픽(gif)을 중계한다 — 기상청 통보문 이미지 버튼과 같은 자리에 쓴다.
 * [왜 중계하나] 앱에서 바깥 주소를 직접 물면 CORS·혼합콘텐츠에 걸린다. 기상청 이미지도
 *   같은 이유로 /api/typhoon/image 가 중계하고 있다 — 그 방식을 그대로 따른다.
 * [형식 검사] seq 는 'wp2526' 처럼 영문 두 자 + 숫자 네 자만 받는다(경로조작 차단).
 * [일본은 없다] JMA 는 예보도 그림 파일을 공개하지 않아 이 주소를 쓰지 않는다(400).
 * 실패: 400(형식 오류·그림 없는 출처) · 404(그림 없음·상류 실패)
 */
router.get('/api/typhoon/foreign/image', async (req, res) => {
    if (String(req.query.src || 'jtwc').toLowerCase() !== 'jtwc') return res.status(400).end();
    const seq = String(req.query.seq || '').toLowerCase();
    if (!/^[a-z]{2}\d{4}$/.test(seq)) return res.status(400).end();
    const name = seq + '.gif';
    try {
        const up = await fetch(PRODUCT_BASE + name, {
            headers: REQ_HEADERS,
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
        });
        const type = up.headers.get('content-type') || '';
        if (!up.ok || type.indexOf('image') === -1) {
            console.log(`[typhoon-foreign] 그래픽 ${name} 실패 ${up.status} ${type}`);
            return res.status(404).end();
        }
        const buf = Buffer.from(await up.arrayBuffer());
        res.set('Content-Type', type || 'image/gif');
        res.set('Cache-Control', 'public, max-age=600');   // 상류가 6시간마다 갱신
        if (req.query.download) res.set('Content-Disposition', 'attachment; filename="' + name + '"');
        res.send(buf);
    } catch (e) {
        console.log(`[typhoon-foreign] 그래픽 호출 실패: ${e.message}`);
        res.status(404).end();
    }
});

// 시험에서 쓰는 내부 접근구 — 규칙을 화면 없이도 고정해 둔다.
// [연계] → local_server/scripts/test_typhoon_source.js (verify_all.sh SUITES 등록)
router._clearCache = function () { Object.keys(cache).forEach(k => delete cache[k]); };
router._stampToLabel = stampToLabel;
router._kstStampToMs = kstStampToMs;
router._ecmwfCandidates = ecmwfCandidates;

module.exports = router;
