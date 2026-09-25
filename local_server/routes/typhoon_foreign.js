/**
 * ============================================================================
 * 파일명: routes/typhoon_foreign.js
 * 역할: 해외 기관 태풍 자료를 우리 태풍 탭이 쓰는 형식으로 바꿔 내주는 API.
 *       지금은 미국 JTWC(합동태풍경보센터) 하나 — JTWC 공개 통보문을 직접 읽는다.
 * ============================================================================
 *
 * - GET /api/typhoon/foreign?src=jtwc        → 활성 태풍 + 통보(자문) + 예보 프레임
 * - GET /api/typhoon/foreign/image?src=jtwc&seq=wp2526  → JTWC 경고 그래픽(gif) 중계
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
 *   목록  https://www.metoc.navy.mil/jtwc/jtwc.html          지금 경보 중인 태풍 번호
 *   본문  https://www.metoc.navy.mil/jtwc/products/wp2526web.txt   위치·풍속·반경·예보
 *   그림  https://www.metoc.navy.mil/jtwc/products/wp2526.gif      경고 그래픽
 *   seq 는 그 파일 이름의 앞부분('wp2526')을 그대로 쓴다 — 번호를 따로 만들지 않는다.
 *
 * [기상청과 다른 점 — 그대로 옮길 수 없는 것들]
 *   1. 중심기압: 현재 시점만 준다(통보문 REMARKS). 예보 시점은 발표하지 않는다 → null.
 *   2. 70% 확률반경: 없다. 경로 오차 범위도 글자 통보문에는 없다 → radProb 는 null,
 *      경로 오차를 담는 칸 자체를 만들지 않는다.
 *      (원뿔은 경고 그래픽 그림 안에 그려져 있다 — 지도 버튼으로 볼 수 있다.)
 *   3. 풍속반경: 북동·남동·남서·북서 네 방향 거리를 34/50/64노트별로 준다.
 *      네 방향 값을 그대로 싣고(radQuad34/50/64), 장·단반경도 함께 채운다.
 *   4. 풍속 평균 시간: JTWC 1분 · 기상청 10분 → 강도는 0.88 을 곱해 환산 후 판정.
 *
 * [시각] 통보문은 UTC("일일시시분분Z")다. 여기서 한국시각 문자열로 바꿔 보낸다.
 *
 * [호출수] 목록 1회 + 태풍 수만큼. 상류가 6시간마다 갱신되므로 30분 캐시면 충분하다.
 *
 * [연계 파일]
 * - server.js → app.use() 로 등록
 * - services/jtwc_parse.js → 통보문·목록 해독
 * - client/js/typhoon/ocean_typhoon.js → 출처 드롭다운에서 "미국(JTWC)" 선택 시 호출
 * ============================================================================
 */

'use strict';

const express = require('express');
const router = express.Router();
const jtwc = require('../services/jtwc_parse');

const JTWC_BASE = 'https://www.metoc.navy.mil/jtwc/';
const LIST_URL = JTWC_BASE + 'jtwc.html';
const DIR_URL = JTWC_BASE + 'products/';      // 제품 폴더 목록 — /products/ 는 막히지 않는다
const PRODUCT_BASE = JTWC_BASE + 'products/';
const HTTP_TIMEOUT_MS = 20000;
// [왜 표식을 보내나] .mil 사이트는 브라우저 표식이 없는 요청을 막는 경우가 있다.
//   그림(products/*.gif)은 표식 없이도 받아지는데 목록 화면만 실패했다 — 그 차이를 메운다.
const UA = 'Mozilla/5.0 (compatible; SEAGNAL/1.0; +https://seagnal-server.fly.dev)';
const REQ_HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,text/plain,*/*' };
const TTL_MS = 30 * 60 * 1000;          // 상류가 6시간마다 갱신 — 30분이면 충분
const KST_OFFSET_MS = 9 * 3600 * 1000;
const PER_BASIN = 4;                    // 해역마다 최신 번호 몇 개까지 볼지
const FRESH_MS = 18 * 3600 * 1000;      // 이 시간보다 오래된 통보문은 끝난 태풍으로 본다
// [왜 이렇게 고르나] 제품 폴더에는 올해 끝난 태풍의 통보문도 그대로 남아 있다.
//   전부 받으면 요청이 수십 건이 되고 화면에도 죽은 태풍이 뜬다.
//   활동 중인 태풍은 언제나 그 해역에서 번호가 가장 큰 축이므로, 해역별 최신 몇 개만
//   받아 보고 발표 시각이 최근인 것만 남긴다. JTWC 는 활동 중이면 6시간마다 낸다.

let cache = null;   // { at: ms, data: 응답객체 }

/**
 * 후보 파일 이름들 중 해역마다 번호가 큰 것부터 n 개만 남긴다.
 * 예: topPerBasin(['wp0126','wp2426','wp2526','ep1726'], 2) → ['wp2526','wp2426','ep1726']
 * @param {Array<string>} bases - ['wp2526', …]
 * @param {number} n - 해역당 개수
 * @returns {Array<string>}
 */
function topPerBasin(bases, n) {
    const byBasin = {};
    bases.forEach((b) => {
        const basin = b.slice(0, 2);
        (byBasin[basin] = byBasin[basin] || []).push(b);
    });
    const out = [];
    Object.keys(byBasin).forEach((basin) => {
        byBasin[basin]
            .sort((a, b) => parseInt(b.slice(2, 4), 10) - parseInt(a.slice(2, 4), 10))
            .slice(0, n)
            .forEach(x => out.push(x));
    });
    return out;
}

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
async function fetchActive() {
    if (cache && (Date.now() - cache.at) < TTL_MS) return cache.data;

    lastError = '';
    Object.keys(probe).forEach(k => delete probe[k]);
    const year = new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear();

    // [왜 두 곳을 보나] 2026-09-25 확인: /jtwc/jtwc.html 은 우리 서버에 403 을 준다.
    //   반면 같은 호스트의 /jtwc/products/ 안 파일(그림)은 200 으로 받아진다.
    //   그래서 제품 폴더 목록을 먼저 보고, 안 되면 안내 화면을 본다.
    const dir = await fetchText(DIR_URL);
    let bases = dir ? jtwc.parseProductDir(dir, year) : [];
    let html = null;
    if (!bases.length) {
        html = await fetchText(LIST_URL);
        if (html) bases = jtwc.parseStormList(html)
            .map(s => jtwc.fileBase(s.code, year)).filter(Boolean);
    }
    bases = topPerBasin(bases, PER_BASIN);
    // [왜 남기나] 화면이 비었을 때 "정말 태풍이 없다"와 "목록을 못 읽었다"가 구별돼야 한다.
    //   (L-291 — 실패가 무결처럼 보이면 안 된다.)
    console.log(`[typhoon-foreign] 폴더 ${dir ? dir.length : 'X'}자 · 화면 ${html ? html.length : 'X'}자`
              + ` → 후보 ${bases.length}개`);
    if (!bases.length) { lastError = lastError || 'no_storm_found'; return null; }

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

    const typhoons = [];
    warnings.forEach((w) => {
        if (!w) return;
        const label = '[ JTWC ] 제' + w.advisory + '호 자문'
                    + (w.issuedKst ? ' / ' + stampToLabel(w.issuedKst) + ' 기준(KST)' : '');
        typhoons.push({
            seq: w.seq,                       // 'wp2526' — 제품 파일 이름과 같다
            name: w.name,
            nameEn: w.name,
            // 경고 그래픽은 목록에 오른 태풍이면 모두 있다(해역과 무관).
            imageName: w.seq + '.gif',
            latestTmFc: w.issuedKst,
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
                   + '|70% 확률반경은 발표되지 않습니다. 경로 오차 범위는 지도 그림 버튼의'
                   + ' 예보도에서 보실 수 있습니다.'
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
        listChars: (dir ? dir.length : 0) + (html ? html.length : 0),
        typhoons: typhoons
    };
    cache = { at: Date.now(), data: data };
    return data;
}

/**
 * GET /api/typhoon/foreign?src=jtwc
 * 성공: { success:true, src, label, updatedAt, year, hasActive, typhoons:[…] }
 *   — 기상청 응답과 같은 모양이라 화면(ocean_typhoon.js)이 그대로 그린다.
 * 실패: { success:false, reason:'bad_src'|'upstream' }
 */
router.get('/api/typhoon/foreign', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=600');
    const src = String(req.query.src || 'jtwc').toLowerCase();
    if (src !== 'jtwc') return res.json({ success: false, reason: 'bad_src' });
    const data = await fetchActive();
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
 * 실패: 400(형식 오류) · 404(그림 없음·상류 실패)
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
router._clearCache = function () { cache = null; };
router._stampToLabel = stampToLabel;
router._topPerBasin = topPerBasin;
router._kstStampToMs = kstStampToMs;

module.exports = router;
