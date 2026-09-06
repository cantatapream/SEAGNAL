/**
 * ============================================================================
 * 파일명: local_server/scripts/navwarn_probe.js
 * 역할  : 항행경보가 "불러오는 중"에서 멈추는 원인을 확정하기 위한 읽기 전용 정찰.
 *         두 개의 바깥 창구를 각각 따로 두드려 보고, 어느 쪽이 살아있고 어느 쪽이
 *         죽었는지 · KHOA 응답에 어떤 항목(제목·본문 등)이 실제로 들어있는지를
 *         그대로 찍어 본다. 고치기 전에 사실부터 확인하는 단계이고, 이 스크립트는
 *         아무것도 저장·변경하지 않는다.
 * ----------------------------------------------------------------------------
 * [무엇을 확인하나]
 *   A. KHOA 홈페이지 창구(인증키 없음, 세션쿠키 방식)
 *      1) mainPage.do 로 세션(JSESSIONID) 발급이 되는가
 *      2) getDocList.do 가 문서 목록을 주는가 · 그 안에 어떤 항목이 들어있는가
 *         (지금 코드는 DOC_NUM·ID 두 개만 꺼내 쓰고 나머지는 버리고 있어,
 *          제목·본문·발표기관이 함께 오는지 아무도 확인한 적이 없다)
 *      3) getDocAreaPoint.do 가 구역 좌표를 주는가 · 항목 구성은 무엇인가
 *   B. 공공데이터포털 창구(인증키 사용) — apis.data.go.kr
 *      운영 서버에서는 30초를 기다려도 응답이 없다(2026-09-06 확인). 바깥망이
 *      열린 곳에서도 똑같이 무응답인지 보면, "정부 API 자체 문제"인지
 *      "우리 서버에서 나가는 길만 막힌 것"인지 갈린다.
 *      ※ 인증키는 없어도 된다 — 키가 틀리면 '틀렸다'는 응답이 곧바로 오므로,
 *        응답이 오기만 하면 접속 자체는 되는 것이다(무응답과 구분됨).
 *
 * [연계]
 *  - 대상 코드   : local_server/routes/navigational_warning.js (같은 주소·같은 순서로 두드린다)
 *  - 실행 위치   : .github/workflows/navwarn-probe.yml
 *                  (개발 샌드박스는 khoa.go.kr·apis.data.go.kr 접속이 프록시 정책으로
 *                   막혀 있어 여기서 못 돌린다 — 2026-09-06 curl 403 · WebFetch
 *                   EGRESS_BLOCKED 로 재확인)
 *  - 결과 확인   : 실행 화면 위쪽 "Summary" + 콘솔 출력
 * ============================================================================
 */

'use strict';

const KHOA_BASE = 'https://www.khoa.go.kr/nwb';
const OFFICIAL_URL = 'https://apis.data.go.kr/1192136/NavigationalWarning/getNavigationalWarningInfo';
const TIMEOUT_MS = 20000;   // 20초 안에 응답이 없으면 "무응답"으로 판정

const lines = [];   // Summary 에 그대로 찍을 줄들

/** 화면과 Summary 양쪽에 같은 줄을 남긴다. */
function say(text) {
    console.log(text);
    lines.push(text);
}

/** 20초 제한을 건 fetch — 시간 초과면 '무응답'으로 구분되는 에러를 던진다. */
async function fetchWithTimeout(url, options) {
    const started = Date.now();
    try {
        const res = await fetch(url, Object.assign({}, options, {
            signal: AbortSignal.timeout(TIMEOUT_MS)
        }));
        return { res: res, ms: Date.now() - started };
    } catch (e) {
        const ms = Date.now() - started;
        const timedOut = (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw Object.assign(new Error(timedOut ? '무응답(시간 초과)' : e.message), { ms: ms, timedOut: timedOut });
    }
}

/** 오늘 날짜(YYYYMMDD, KST 기준) — 서버 코드 _todayYmd() 와 같은 값이 나오게 KST 로 맞춘다. */
function todayYmdKst() {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

/** 객체의 항목 이름과 값 미리보기를 보기 좋게 정리한다(값이 길면 잘라서). */
function describeFields(obj) {
    return Object.keys(obj).map(function (key) {
        let value = obj[key];
        if (value === null || value === undefined) value = '(빈값)';
        else value = String(value).replace(/\s+/g, ' ');
        if (value.length > 120) value = value.slice(0, 120) + '…';
        return '  - `' + key + '` : ' + value;
    }).join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// A. KHOA 홈페이지 창구
// ────────────────────────────────────────────────────────────────────────────

/** mainPage.do 를 방문해 세션 쿠키(JSESSIONID)를 받는다. 서버 코드와 동일한 방식. */
async function getSessionCookie() {
    const { res, ms } = await fetchWithTimeout(KHOA_BASE + '/mainPage.do?lang=ko', { redirect: 'follow' });
    const setCookies = (typeof res.headers.getSetCookie === 'function')
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie') || ''];
    const cookie = setCookies
        .map(function (c) { return String(c).split(';')[0]; })
        .find(function (c) { return c.startsWith('JSESSIONID='); });
    return { cookie: cookie || null, status: res.status, ms: ms, finalUrl: res.url };
}

/** KHOA 내부 창구(POST, form 형식)를 두드린다. 서버 코드 _khoaPost() 와 같은 헤더를 쓴다. */
async function khoaPost(pathName, formData, cookie) {
    const { res, ms } = await fetchWithTimeout(KHOA_BASE + '/' + pathName, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': KHOA_BASE + '/mainPage.do?lang=ko',
            'Cookie': cookie
        },
        body: new URLSearchParams(formData).toString()
    });
    const text = await res.text();
    return { status: res.status, ms: ms, text: text };
}

async function probeKhoa(dateYmd) {
    say('## A. KHOA 홈페이지 창구 (인증키 없음)');
    say('');

    // 1) 세션 발급
    let session;
    try {
        session = await getSessionCookie();
    } catch (e) {
        say('- ❌ **1단계 mainPage.do 실패** : ' + e.message + ' (' + e.ms + 'ms)');
        say('  → 홈페이지 첫 관문부터 막힘. 이 아래 단계는 확인 불가.');
        return null;
    }
    if (!session.cookie) {
        say('- ⚠ **1단계 mainPage.do**: 응답은 왔으나(HTTP ' + session.status + ', ' + session.ms + 'ms) **세션 쿠키가 안 옴**');
        say('  → 최종 주소: ' + session.finalUrl);
        say('  → 세션 방식이 바뀌었을 가능성. 이 아래 단계는 확인 불가.');
        return null;
    }
    say('- ✅ **1단계 mainPage.do**: HTTP ' + session.status + ', ' + session.ms + 'ms, 세션 쿠키 받음');
    say('');

    // 2) 문서 목록
    let listData = null;
    try {
        const listRes = await khoaPost('getDocList.do', {
            doctype: '', appcat: '', noticat: '', searchArea: '', searchtext: '', ordertype: '',
            lang: 'ko', menuType: 'navWarning',
            startdate: dateYmd, enddate: dateYmd, startnum: 1, endnum: 50
        }, session.cookie);

        say('- **2단계 getDocList.do**: HTTP ' + listRes.status + ', ' + listRes.ms + 'ms, 응답 길이 ' + listRes.text.length);
        try {
            listData = JSON.parse(listRes.text);
        } catch (parseErr) {
            say('  - ❌ **JSON 이 아님** — 응답 앞부분:');
            say('```');
            say(listRes.text.slice(0, 500));
            say('```');
            return null;
        }
        const rows = listData.RESULT_DATA || [];
        say('  - RESULT_CODE = `' + listData.RESULT_CODE + '` · 문서 ' + rows.length + '건');
        if (rows.length) {
            say('  - **첫 문서에 실제로 들어있는 항목 전부** (여기에 제목·본문이 있는지가 핵심):');
            say(describeFields(rows[0]));
        } else {
            say('  - ⚠ 오늘 날짜 문서가 0건 — 날짜 조건이 바뀌었을 수 있음');
        }
        say('');
    } catch (e) {
        say('- ❌ **2단계 getDocList.do 실패** : ' + e.message + ' (' + e.ms + 'ms)');
        return null;
    }

    // 3) 구역 좌표
    const rows = (listData && listData.RESULT_DATA) || [];
    if (!rows.length) return listData;
    const firstId = rows[0].ID;
    try {
        const areaRes = await khoaPost('getDocAreaPoint.do', { id: firstId, searchArea: '' }, session.cookie);
        say('- **3단계 getDocAreaPoint.do** (문서 ID ' + firstId + '): HTTP ' + areaRes.status + ', ' + areaRes.ms + 'ms');
        let areaData;
        try {
            areaData = JSON.parse(areaRes.text);
        } catch (parseErr) {
            say('  - ❌ **JSON 이 아님** — 응답 앞부분:');
            say('```');
            say(areaRes.text.slice(0, 500));
            say('```');
            return listData;
        }
        const areas = areaData.RESULT_DATA || [];
        say('  - RESULT_CODE = `' + areaData.RESULT_CODE + '` · 구역 ' + areas.length + '건');
        if (areas.length) {
            say('  - **첫 구역에 들어있는 항목 전부**:');
            say(describeFields(areas[0]));
        }
        say('');
    } catch (e) {
        say('- ❌ **3단계 getDocAreaPoint.do 실패** : ' + e.message + ' (' + e.ms + 'ms)');
    }
    return listData;
}

// ────────────────────────────────────────────────────────────────────────────
// B. 공공데이터포털 창구
// ────────────────────────────────────────────────────────────────────────────

/**
 * 인증키 없이 한 번 두드려 본다. 목적은 "값을 받아오는 것"이 아니라
 * **응답이 오기는 하는지**를 보는 것이다 — 키가 없거나 틀리면 그렇다는 답이
 * 곧바로 오므로, 응답이 온다 = 접속은 된다. 반대로 20초 무응답이면
 * 운영 서버에서 겪는 것과 같은 증상이다.
 */
async function probeOfficial(dateYmd) {
    say('## B. 공공데이터포털 창구 (apis.data.go.kr)');
    say('');
    const key = process.env.ROMS_SERVICE_KEY || 'PROBE-NO-KEY';
    const usingRealKey = !!process.env.ROMS_SERVICE_KEY;
    say('- 인증키: ' + (usingRealKey ? '실제 키 사용' : '없음(접속 가능 여부만 확인)'));
    const url = OFFICIAL_URL + '?ServiceKey=' + key + '&type=json&date=' + dateYmd + '&numOfRows=100&pageNo=1';
    try {
        const { res, ms } = await fetchWithTimeout(url);
        const text = await res.text();
        say('- ✅ **응답 옴**: HTTP ' + res.status + ', ' + ms + 'ms, 길이 ' + text.length);
        say('  - 응답 앞부분:');
        say('```');
        say(text.slice(0, 600));
        say('```');
        say('  - → **접속 자체는 됨.** 운영 서버에서만 무응답이라면 우리 서버에서 나가는 길 문제.');
    } catch (e) {
        if (e.timedOut) {
            say('- ❌ **무응답** (' + e.ms + 'ms 동안 아무 답 없음)');
            say('  - → 바깥망이 열린 곳에서도 똑같이 무응답. **정부 API 쪽 문제**로 좁혀짐.');
        } else {
            say('- ❌ **실패**: ' + e.message + ' (' + e.ms + 'ms)');
        }
    }
    say('');
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
    const dateYmd = process.env.PROBE_DATE || todayYmdKst();
    say('# 항행경보 정찰 결과');
    say('');
    say('- 조회 날짜: **' + dateYmd + '**');
    say('- 응답 제한시간: ' + (TIMEOUT_MS / 1000) + '초');
    say('');

    await probeKhoa(dateYmd);
    await probeOfficial(dateYmd);

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
        require('fs').appendFileSync(summaryPath, lines.join('\n') + '\n');
    }
}

main().catch(function (e) {
    console.error('정찰 스크립트 자체 오류:', e);
    process.exit(1);
});
