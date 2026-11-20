'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/fishcond_collector.js
 * 역할  : 국립수산과학원 「어황정보」 게시판의 새 글을 1시간마다 확인해, 첨부 PDF 를 우리 서버에 받아 두고
 *         쪽마다 그림(PNG)으로 바꿔 둔다 — 앱 「뉴스·공지·어황」 탭의 어황정보 목록·팝업이 이것을 읽는다.
 *         30일이 지난 글은 파일째 지운다.
 * 사용자 2026-11-21:
 *   「어황정보는 공지사항의 게시글처럼 하되 누르면 … 게시글 팝업이 뜨고 해당 pdf 정보가 표출되도록」
 *   「업데이트 될떄마다 pdf를 가져와서 우리 게시글로 등록하고자하는거지.」
 *   「어황정보는 다 가져오고 최근 1주치를 미리 채워. 그리고 pdf 다운로드 기능도 반영」
 *   「어황정보는 한달치 … 보관하는건 어때?」 · 바다별 꼬리표 「붙여」 · 저장 위치 「추천대로」(공지 게시판과 따로) · 댓글·반응 「불필요」
 *   설계안: https://claude.ai/artifact/6Wpmf7NFYcVj5Dgtkseq3B (2·7·10절)
 * 동작(run — 1시간마다):
 *   ① 게시판 목록 첫 쪽을 읽는다(주 6~7건이 올라온다 — 실측 2026-11-20: 첫 쪽 10건이 9일치).
 *   ② 작성일이 최근 7일 안이고 아직 없는 글을 목록(index.json)에 더한다 — 첫 실행이면 그것이 「1주치 채우기」다.
 *   ③ PDF 가 없거나 그림이 없는 글은 받기·바꾸기를 다시 해 본다(실패하면 다음 시간에 또).
 *   ④ 작성일이 30일을 넘긴 글은 목록에서 빼고 파일을 지운다. 목록에 없는 파일(지운 글의 찌꺼기)도 지운다.
 *   목록을 못 읽었으면(0건) 아무것도 지우지 않는다 — 게시판이 빈 것이 아니라 못 읽은 것이다.
 *   매 실행 결과를 state.json 에 남긴다(관리자 화면이 「마지막 확인 시각·결과」를 띄운다 — 조용한 실패를 막는다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_docs(convertPdf — 기상특보 원문과 같은 크기·같은 변환기) · services/atomic_write
 *  - 바깥          : https://www.nifs.go.kr/board/actionBoard0014List.do (목록) · /cmmnFile/fileDownloadStat.do?FILE_ID=… (PDF)
 *  - 저장          : data/fishcond/index.json · state.json · views.json(조회 수) · <글ID>.pdf · <글ID>-<쪽>.png
 *  조회 수(2026-11-21 사용자 「날짜 왼쪽에 조회 눈 붙이고」): 팝업을 열 때마다 1 — 공지 게시글 조회수와 같은 규칙(관리자 기기는 같은 글을 하루 1번만).
 *   index.json 과 따로 둔다 — 1시간 확인(run)이 index.json 을 읽고 쓰는 사이에 들어온 조회가 덮여 사라지지 않게.
 *  - 나를 쓰는 곳  : server.js(운영에서만 start) · routes/fishcond.js(목록·그림·PDF 내려주기) · 검사 scripts/test_fishcond_collector.js
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic_write');

const DIR = path.join(__dirname, '..', 'data', 'fishcond');
const ORIGIN = 'https://www.nifs.go.kr';
const LIST_URL = ORIGIN + '/board/actionBoard0014List.do';
const FILE_URL = ORIGIN + '/cmmnFile/fileDownloadStat.do?FILE_ID=';
const VIEW_URL = ORIGIN + '/board/actionBoard0014PopupPrevew.do?BBS_ID=';   // 게시판의 「새창 열림」 미리보기 — 원문 보기 단추가 연다
const KEEP_DAYS = 30;        // 사용자 「한달치」
const BACKFILL_DAYS = 7;     // 사용자 「최근 1주치를 미리 채워」 — 평소에도 이 창 안의 새 글만 더한다(새 글은 늘 이 안에 있다)
const ID_RE = /^\d{17}[A-Z]{3}$/;          // 게시판 글 ID 꼴(실측: 20261120132915271ZVR) — 바깥 글자를 파일 이름에 그대로 쓰지 않으려고 꼴을 확인한다
const FILE_ID_RE = /^DX5-\d+-\d+$/;        // 첨부 파일 ID 꼴(실측: DX5-1795148838521-1)
const UA = 'Mozilla/5.0 (compatible; SEAGNAL-fishcond/1.0)';

/** KST 날짜(YYYY-MM-DD). 예: kstDate(Date.parse('2026-11-20T16:00Z')) → '2026-11-21' @param {number} ms @returns {string} */
function kstDate(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
/** 두 날짜(YYYY-MM-DD) 사이 일수. 예: daysBetween('2026-11-01','2026-11-21') → 20 */
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
/** HTML 조각을 글자로. 예: '서해 &amp; 남해 <b>N</b>' → '서해 & 남해 N' */
function text(s) {
    return String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

/**
 * 게시판 목록 HTML 에서 글 줄을 읽는다(첨부 PDF 가 없는 줄은 뺀다 — 보여줄 것이 없다).
 * 예: parseList(html) → [{ id:'20261120132915271ZVR', title:'서해주간해어황정보 제26-48호', dept:'기후환경자원과',
 *                          date:'2026-11-20', fileId:'DX5-1795148838521-1', fileName:'2026년 서해 주간 해어황정보 제 48 호.pdf' }, …]
 * @param {string} html @returns {Array<object>}
 * [연계] ← run(이 파일) / 줄 모양은 2026-11-20 실제 목록에서 확인(제목 칸 fnPopupPrevew('글ID') · 원본 칸 FILE_ID · 작성일 칸 class="date")
 */
function parseList(html) {
    const out = [];
    for (const row of String(html || '').match(/<tr[\s\S]*?<\/tr>/g) || []) {
        const id = (row.match(/fnPopupPrevew\('([^']+)'\)/) || [])[1];
        const subject = (row.match(/<td[^>]*class="subject"[^>]*>([\s\S]*?)<\/td>/) || [])[1];
        if (!id || !ID_RE.test(id) || subject == null) continue;
        const a = subject.match(/<a[^>]*>([\s\S]*?)<\/a>/);
        const title = text(a ? a[1] : subject);
        const dept = text((row.match(/<td[^>]*data-label="부서"[^>]*>([\s\S]*?)<\/td>/) || [])[1]);
        const date = text((row.match(/<td[^>]*class="date"[^>]*>([\s\S]*?)<\/td>/) || [])[1]);
        const file = row.match(/fileDownloadStat\.do\?FILE_ID=(DX5-\d+-\d+)"(?:[^>]*title="([^"]*)")?/);
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !file || !FILE_ID_RE.test(file[1])) continue;
        out.push({ id, title, dept, date, fileId: file[1], fileName: text(file[2] || '') || (title + '.pdf') });
    }
    return out;
}

/**
 * 바다 꼬리표를 정한다 — 제목에 바다 이름이 있으면 그 바다, 없으면 전국.
 * 예: '서해주간해어황정보' → '서해' · '남동해해역어장환경' → '남해'(남동해수산연구소는 통영 — 남해 동부) · '동해주간해황정보' → '동해' · '주간해어황정보' → '전국'
 * @param {string} title @returns {'서해'|'남해'|'동해'|'전국'}
 * [연계] ← run · 화면의 꼬리표 색(client/js/notice/fishcond)
 */
function seaOf(title) {
    const t = String(title || '');
    if (/서해/.test(t)) return '서해';
    if (/남동해|남해/.test(t)) return '남해';   // 「남동해」에 「동해」가 들어 있어 남쪽을 먼저 본다
    if (/동해/.test(t)) return '동해';
    return '전국';
}

/** 게시판 목록 HTML 을 받는다. @returns {Promise<string>} */
async function realFetchText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('목록 응답 ' + r.status);
    return r.text();
}
/** 첨부 PDF 를 받는다. PDF 가 아니면 null. @returns {Promise<Buffer|null>} */
async function realFetchPdf(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;   // 이 서버는 내용 종류를 application/stream 으로 준다(실측) — 머리 글자로 확인
}

/**
 * 어황정보 보관소를 만든다. 검사에서는 받기·바꾸기·저장 위치·시계를 바꿔 끼운다.
 * @param {{dir?:string, fetchText?:function, fetchPdf?:function, convert?:function, now?:function}} [o]
 * @returns {{run:function, list:function, get:function, file:function, state:function, start:function}}
 * [연계] ← 모듈 기본(운영) / 검사 test_fishcond_collector
 */
function createFishcond({ dir = DIR, fetchText = realFetchText, fetchPdf = realFetchPdf, convert = null, now = Date.now } = {}) {
    const doConvert = convert || ((pdf, prefix) => require('./bulletin_docs').convertPdf(pdf, prefix));
    const indexFile = path.join(dir, 'index.json'), stateFile = path.join(dir, 'state.json'), viewsFile = path.join(dir, 'views.json');
    let running = null, timer = null;
    const ls = () => { try { return fs.readdirSync(dir); } catch (_) { return []; } };
    const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };
    const readIndex = () => { const v = readJson(indexFile, []); return Array.isArray(v) ? v : []; };
    /** 그 글의 쪽 그림 번호들(1부터 빠짐없이 이어진 만큼). pdftoppm 은 10쪽 이상이면 -01 처럼 0 을 채운다 — 숫자로 읽는다. */
    const pagesIn = (files, id) => {
        const ns = files.map((f) => { const m = f.match(/^(.+)-(\d+)\.png$/); return m && m[1] === id ? +m[2] : 0; }).filter(Boolean).sort((a, b) => a - b);
        let n = 0; while (ns[n] === n + 1) n++;
        return ns.slice(0, n);
    };

    /** 한 글의 PDF·그림을 갖춘다. 던지지 않고 그 글의 상태 글자를 돌려준다('ok'|'no_pdf'|'convert_failed'). */
    async function ensureFiles(e) {
        const pdf = path.join(dir, e.id + '.pdf');
        let files = ls();
        try {
            if (!files.includes(e.id + '.pdf')) {
                const buf = await fetchPdf(FILE_URL + e.fileId);
                if (!buf) return 'no_pdf';
                fs.writeFileSync(pdf + '.tmp', buf); fs.renameSync(pdf + '.tmp', pdf);
                e.bytes = buf.length;
            }
            if (pagesIn(files, e.id).length) return 'ok';
            // 임시 이름(<ID>.part-N.png)으로 만든 뒤 제 이름으로 바꾼다 — 만드는 도중의 반쪽 그림이 나가지 않게(bulletin_docs 와 같은 까닭)
            const part = (f) => f.match(/^(.+)\.part-(\d+)\.png$/);
            for (const f of ls()) { const m = part(f); if (m && m[1] === e.id) fs.unlinkSync(path.join(dir, f)); }
            try { await doConvert(pdf, path.join(dir, e.id + '.part')); } catch (err) {
                // 변환기가 없는 것(ENOENT)이 아니면 받은 PDF 가 깨진 것으로 보고 지운다 — 다음 시간에 다시 받는다
                if (!(err && err.code === 'ENOENT')) { try { fs.unlinkSync(pdf); } catch (_) { /* 이미 없다 */ } }
                console.warn('[fishcond] 그림 바꾸기 실패(다음 시간에 다시) — ' + e.id + ':', String((err && err.message) || err).split('\n')[0]);
                return 'convert_failed';
            }
            const made = ls().map(part).filter((m) => m && m[1] === e.id).sort((a, b) => b[2] - a[2]);   // 큰 번호부터 — 1쪽이 맨 나중
            for (const m of made) fs.renameSync(path.join(dir, m[0]), path.join(dir, e.id + '-' + m[2] + '.png'));
            files = ls();
            return pagesIn(files, e.id).length ? 'ok' : 'convert_failed';
        } catch (err) {
            console.warn('[fishcond] PDF 받기 실패(다음 시간에 다시) — ' + e.id + ':', String((err && err.message) || err).split('\n')[0]);
            return 'no_pdf';
        }
    }

    /**
     * 한 번 확인한다. 절대 던지지 않는다(다른 수집을 막지 않게). 겹쳐 부르면 도는 것을 함께 기다린다.
     * 예: await run() → { ok:true, listed:10, added:7, ready:7, failed:0, removed:0, total:7 }
     * @returns {Promise<object>} state.json 에 남기는 것과 같은 모양
     * [연계] ← start(1시간마다) · routes/fishcond(관리자 「지금 확인」 — 다음 단계) / → fetchText · ensureFiles
     */
    function run() {
        if (running) return running;
        running = (async () => {
            const t0 = now(), today = kstDate(t0);
            const st = { lastRun: new Date(t0).toISOString(), ok: false, listed: 0, added: 0, ready: 0, failed: 0, removed: 0, total: 0, error: null };
            let logged = false;   // 잡은 자리에서 이미 로그를 남겼으면 끝에서 또 남기지 않는다
            try {
                fs.mkdirSync(dir, { recursive: true });
                let rows = [];
                try { rows = parseList(await fetchText(LIST_URL)); } catch (err) {
                    st.error = '게시판 목록을 받지 못함: ' + String((err && err.message) || err).split('\n')[0];
                    console.warn('[fishcond] 확인 실패:', st.error); logged = true;   // state.json 에도 남는다(관리자 화면이 띄운다)
                }
                st.listed = rows.length;
                if (!rows.length && !st.error) st.error = '게시판 목록에서 글을 하나도 읽지 못함(게시판 모양이 바뀌었을 수 있음)';
                const index = readIndex(), have = new Set(index.map((e) => e.id));
                for (const r of rows) {
                    if (have.has(r.id) || daysBetween(r.date, today) > BACKFILL_DAYS) continue;
                    index.push(Object.assign({}, r, { sea: seaOf(r.title), addedAt: new Date(t0).toISOString(), pages: 0, status: 'pending' }));
                    have.add(r.id); st.added++;
                }
                for (const e of index) {
                    if (e.status === 'ok' && pagesIn(ls(), e.id).length && ls().includes(e.id + '.pdf')) continue;
                    e.status = await ensureFiles(e);
                    e.pages = pagesIn(ls(), e.id).length;
                }
                // 30일 정리 — 목록을 못 읽은 회차에도 날짜로만 판단하므로 안전하다(게시판 상태와 무관)
                const keep = index.filter((e) => daysBetween(e.date, today) <= KEEP_DAYS);
                st.removed = index.length - keep.length;
                const ids = new Set(keep.map((e) => e.id));
                for (const f of ls()) {
                    if (f === 'index.json' || f === 'state.json' || f === 'views.json' || f.endsWith('.tmp')) continue;
                    const m = f.match(/^(\d{17}[A-Z]{3})(?:\.pdf|(?:\.part)?-\d+\.png)$/);
                    if (m && !ids.has(m[1])) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* 이미 없다 */ } }
                }
                keep.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
                // 지운 글의 조회 수도 뺀다(읽고 쓰기를 한 번에 — 그 사이에 다른 일이 끼지 않는다)
                const vw = readViews(); let cut = false;
                for (const k of Object.keys(vw.count)) if (!ids.has(k)) { delete vw.count[k]; delete vw.adminDay[k]; cut = true; }
                if (cut) writeFileAtomic(viewsFile, JSON.stringify(vw));
                writeFileAtomic(indexFile, JSON.stringify(keep, null, 1));
                st.total = keep.length;
                st.ready = keep.filter((e) => e.status === 'ok').length;
                st.failed = keep.length - st.ready;
                st.ok = !st.error;
            } catch (err) {
                st.error = '확인 중 오류: ' + String((err && err.message) || err).split('\n')[0];
                console.error('[fishcond] 확인 실패:', st.error); logged = true;
            }
            st.ms = now() - t0;
            try { fs.mkdirSync(dir, { recursive: true }); writeFileAtomic(stateFile, JSON.stringify(st)); } catch (_) { /* 상태 파일을 못 써도 다음 시간에 다시 */ }
            if (!st.ok && !logged) console.warn('[fishcond] 확인 실패:', st.error);
            return st;
        })().finally(() => { running = null; });
        return running;
    }

    const readViews = () => { const v = readJson(viewsFile, null) || {}; return { count: v.count || {}, adminDay: v.adminDay || {} }; };
    /** 앱에 보일 목록(최신순). 예: list() → [{ id, title, dept, date, sea, pages, status, views, sourceUrl }] */
    function list() {
        const vw = readViews().count;
        return readIndex().map((e) => ({ id: e.id, title: e.title, dept: e.dept, date: e.date, sea: e.sea, pages: e.pages || 0, status: e.status, fileName: e.fileName, views: vw[e.id] || 0, sourceUrl: VIEW_URL + e.id }));
    }
    /**
     * 조회 수를 1 올린다(없는 글이면 무시). 관리자 기기는 같은 글을 하루(KST) 1번만 센다 — 공지 게시글(routes/content.js GET /api/promo/:id)과 같은 규칙.
     * 예: hit('20261120132915271ZVR') → 7 · hit(같은 ID, true) 를 같은 날 두 번 → 두 번째는 그대로
     * @param {string} id @param {boolean} [isAdmin] @returns {number|null} 지금 조회 수(없는 글이면 null)
     * [연계] ← routes/fishcond.js GET /api/fishcond/:id/view(팝업이 여는 보기 페이지)
     */
    function hit(id, isAdmin) {
        id = String(id || '');
        if (!ID_RE.test(id) || !readIndex().some((e) => e.id === id)) return null;
        const vw = readViews(), day = kstDate(now());
        if (isAdmin && vw.adminDay[id] === day) return vw.count[id] || 0;
        vw.count[id] = (vw.count[id] || 0) + 1;
        if (isAdmin) vw.adminDay[id] = day;
        try { fs.mkdirSync(dir, { recursive: true }); writeFileAtomic(viewsFile, JSON.stringify(vw)); } catch (_) { /* 조회 수를 못 써도 보기는 막지 않는다 */ }
        return vw.count[id];
    }
    /** 글 하나(없으면 null). */
    function get(id) { return list().find((e) => e.id === String(id)) || null; }
    /**
     * 내려줄 파일의 경로(없거나 꼴이 아니면 null — 바깥 글자를 경로에 그대로 붙이지 않는다).
     * 예: file('20261120132915271ZVR','pdf') → '…/20261120132915271ZVR.pdf' · file(id, 2) → '…/<id>-2.png'
     */
    function file(id, what) {
        id = String(id || '');
        if (!ID_RE.test(id)) return null;
        const files = ls();
        if (what === 'pdf') return files.includes(id + '.pdf') ? path.join(dir, id + '.pdf') : null;
        const n = +what; if (!Number.isInteger(n) || n < 1) return null;
        const f = files.find((x) => { const m = x.match(/^(.+)-(\d+)\.png$/); return m && m[1] === id && +m[2] === n; });
        return f ? path.join(dir, f) : null;
    }
    /** 마지막 확인 결과(없으면 null). */
    function state() { return readJson(stateFile, null); }
    /**
     * 운영에서만(FLY_ALLOC_ID — 다른 수집기와 같은 규칙) 시작 직후 한 번, 그 뒤 매시 7분(KST)에 확인한다.
     * @returns {boolean} 시작했으면 true [연계] ← server.js
     */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        run().catch(() => {});
        timer = setInterval(() => { if (new Date(now() + 9 * 3600000).getUTCMinutes() === 7) run().catch(() => {}); }, 60000);
        timer.unref();
        return true;
    }
    return { run, list, get, file, state, start, hit };
}

let real = null;
const getReal = () => (real = real || createFishcond());

module.exports = {
    run: () => getReal().run(),
    list: () => getReal().list(),
    get: (id) => getReal().get(id),
    file: (id, w) => getReal().file(id, w),
    state: () => getReal().state(),
    hit: (id, admin) => getReal().hit(id, admin),
    start: () => getReal().start(),
    createFishcond, parseList, seaOf, kstDate, ID_RE, KEEP_DAYS, BACKFILL_DAYS, LIST_URL, VIEW_URL,
};
