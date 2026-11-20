'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_fishcond_collector.js
 * 역할  : 어황정보 수집기(services/fishcond_collector) 검사 — 게시판 목록 읽기, 최근 1주치만 더하기, PDF 받기·쪽 그림 만들기,
 *         실패하면 다음에 다시, 목록을 못 읽으면 아무것도 안 지우기, 30일 지나면 지우기. 바깥 서버·pdftoppm 없이 가짜로 돈다.
 * 사용자 2026-11-21: 「어황정보는 다 가져오고 최근 1주치를 미리 채워. 그리고 pdf 다운로드 기능도 반영」 · 「어황정보는 한달치」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/fishcond_collector.js · routes/fishcond.js · server.js · services/bulletin_docs.js(글자 확인)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_fishcond_collector.js)
 * ============================================================================
 */
const fs = require('fs'), os = require('os'), path = require('path');
const F = require('../services/fishcond_collector');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

// 게시판 한 줄 — 2026-11-20 실제 목록의 모양 그대로(제목 칸 fnPopupPrevew · 원본 칸 FILE_ID · 작성일 class="date")
const row = (id, title, dept, date, fileId, fname) => `<tr > <td data-label="번호" class="no">9,923</td> <td data-label="제목" class="subject" style="width:50%;"> <!-- 팝업 미리보기 --> <a href="javascript:fnPopupPrevew('${id}')" title="${title} 새창 열림">${title} </a> <div class="new">N<span class="hidden">새글</span></div> </td> <td data-label="부서">${dept}</td> <td data-label="원본"> ${fileId ? `<a href="/cmmnFile/fileDownloadStat.do?FILE_ID=${fileId}" title="${fname}"><img src="/cmmn/images/pdf_icon.png" alt="pdf파일 다운로드"></a>` : ''} </td> <td data-label="첨부"> </td> <td data-label="작성일" class="date">${date}</td> <td data-label="조회수" class="hits">6</td> </tr>`;
const page = (rows) => '<table><thead><tr><th>번호</th><th>제목</th></tr></thead><tbody>' + rows.join('\n') + '</tbody></table>';

const DAY = 86400000, T0 = Date.parse('2026-11-21T00:30:00Z');   // KST 2026-11-21 09:30
const IDS = { a: '20261120132915271ZVR', b: '20261116174123835IMS', c: '20261111104408505OOI', d: '20261119154811984NIA' };

/** 가짜 바깥: html 을 목록으로 주고, pdf[파일ID] 가 있으면 PDF 를 준다. convert 는 pages[ID] 쪽만큼 그림을 만든다. */
function fake() {
    const f = { html: '', listBoom: null, pdf: {}, pages: {}, fetched: [], converted: [], broken: false, noConverter: false, clock: T0 };
    f.fetchText = async () => { if (f.listBoom) throw new Error(f.listBoom); return f.html; };
    f.fetchPdf = async (url) => { const id = url.split('FILE_ID=')[1]; f.fetched.push(id); return f.pdf[id] ? Buffer.from('%PDF-1.4 ' + id) : null; };
    f.convert = async (pdf, prefix) => {
        if (f.noConverter) throw Object.assign(new Error('spawn pdftoppm ENOENT'), { code: 'ENOENT' });
        if (f.broken) throw new Error('Command failed: pdftoppm\nSyntax Error');
        const id = path.basename(prefix).replace(/\.part$/, ''), n = f.pages[id] || 1; f.converted.push(id);
        for (let i = 1; i <= n; i++) fs.writeFileSync(prefix + '-' + (n >= 10 ? String(i).padStart(2, '0') : i) + '.png', 'PNG' + i);
    };
    f.now = () => f.clock;
    return f;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fishcond-'));
const mk = (f, dir) => F.createFishcond({ dir, fetchText: f.fetchText, fetchPdf: f.fetchPdf, convert: f.convert, now: f.now });

(async () => {
    console.log('① 게시판 목록 읽기');
    {
        const rows = F.parseList(page([
            row(IDS.a, '서해주간해어황정보 제26-48호', '기후환경자원과', '2026-11-20', 'DX5-1795148838521-1', '2026년 서해 주간 해어황정보 제 48 호.pdf'),
            row(IDS.d, '주간해어황정보 제26-48호', '연근해자원과', '2026-11-19', null, ''),                 // 첨부 없음 → 뺀다
            row('../../etc', '이상한 글', '부서', '2026-11-19', 'DX5-1-1', 'x.pdf'),                          // ID 꼴이 아님 → 뺀다
        ]));
        ok('PDF 있는 정상 줄 1건만 읽는다', rows.length === 1, rows);
        ok('제목·부서·날짜·파일ID·파일이름', rows[0] && rows[0].id === IDS.a && rows[0].title === '서해주간해어황정보 제26-48호' && rows[0].dept === '기후환경자원과'
            && rows[0].date === '2026-11-20' && rows[0].fileId === 'DX5-1795148838521-1' && rows[0].fileName === '2026년 서해 주간 해어황정보 제 48 호.pdf', rows[0]);
        ok('빈 글·엉뚱한 글은 빈 목록', F.parseList('<html>점검 중</html>').length === 0);
    }

    console.log('② 바다 꼬리표');
    ok('서해', F.seaOf('서해주간해어황정보 제26-48호') === '서해');
    ok('남동해 → 남해(「동해」가 들어 있어도)', F.seaOf('남동해해역어장환경(제26-46호)') === '남해');
    ok('동해', F.seaOf('동해주간해황정보(제26-11-03호)') === '동해');
    ok('바다 이름 없으면 전국', F.seaOf('주간 해황 정보(2026/11/22~2026/11/28)') === '전국' && F.seaOf('주간해어황정보 제26-48호') === '전국');

    console.log('③ 첫 실행 — 최근 1주치만 채우고 PDF·그림을 만든다');
    const f = fake(), dir = tmp(), c = mk(f, dir);
    f.html = page([
        row(IDS.a, '서해주간해어황정보 제26-48호', '기후환경자원과', '2026-11-20', 'DX5-1-1', 'a.pdf'),
        row(IDS.b, '주간 해황 정보', '기후변화연구과', '2026-11-14', 'DX5-2-1', 'b.pdf'),   // 7일 전 — 들어간다
        row(IDS.c, '남해주간해어황정보 제26-46호', '기후환경자원과', '2026-11-11', 'DX5-3-1', 'c.pdf'),   // 10일 전 — 안 들어간다
    ]);
    f.pdf = { 'DX5-1-1': 1, 'DX5-2-1': 1, 'DX5-3-1': 1 }; f.pages = { [IDS.a]: 3, [IDS.b]: 12 };
    let st = await c.run();
    ok('결과: 정상·목록 3·추가 2·준비 2', st.ok === true && st.listed === 3 && st.added === 2 && st.ready === 2 && st.failed === 0, st);
    ok('7일 넘은 글은 받지 않는다', !f.fetched.includes('DX5-3-1'), f.fetched);
    const L = c.list();
    ok('목록은 최신순 · 꼬리표·쪽 수·원문 주소', L.length === 2 && L[0].id === IDS.a && L[0].sea === '서해' && L[0].pages === 3 && L[1].pages === 12
        && L[0].sourceUrl === F.VIEW_URL + IDS.a, L);
    ok('PDF·그림 파일(10쪽 이상은 -01 꼴도 읽는다)', fs.existsSync(path.join(dir, IDS.a + '.pdf')) && fs.existsSync(path.join(dir, IDS.a + '-3.png')) && fs.existsSync(path.join(dir, IDS.b + '-12.png')));
    ok('임시 그림(.part-)이 남지 않는다', !fs.readdirSync(dir).some((x) => x.includes('.part-')), fs.readdirSync(dir));
    ok('file(): PDF·쪽 그림 경로', c.file(IDS.a, 'pdf') === path.join(dir, IDS.a + '.pdf') && c.file(IDS.b, 1) === path.join(dir, IDS.b + '-01.png'));
    ok('file(): 꼴이 아닌 ID·쪽은 null', c.file('../index', 'pdf') === null && c.file(IDS.a, 0) === null && c.file(IDS.a, 'x') === null && c.file(IDS.a, 9) === null);
    ok('state(): 마지막 확인 결과가 남는다', (c.state() || {}).ok === true && (c.state() || {}).total === 2);

    console.log('④ 두 번째 실행 — 다시 받지 않는다');
    const n0 = f.fetched.length, cv0 = f.converted.length;
    st = await c.run();
    ok('추가 0 · 다시 받기·바꾸기 없음', st.added === 0 && f.fetched.length === n0 && f.converted.length === cv0, { st, fetched: f.fetched.length, n0 });
    ok('겹쳐 부르면 같은 실행을 기다린다', (() => { const p1 = c.run(), p2 = c.run(); return p1 === p2; })());
    await c.run();

    console.log('⑤ 목록을 못 읽으면 실패로 남기고 아무것도 안 지운다');
    f.listBoom = 'fetch failed';
    st = await c.run();
    ok('ok:false + 이유', st.ok === false && /목록을 받지 못함/.test(st.error || ''), st);
    ok('기존 글·파일 그대로', c.list().length === 2 && fs.existsSync(path.join(dir, IDS.a + '.pdf')));
    f.listBoom = null; f.html = '<html>점검 중입니다</html>';
    st = await c.run();
    ok('글 0건이면 「못 읽음」으로 실패', st.ok === false && /하나도 읽지 못함/.test(st.error || '') && c.list().length === 2, st);

    console.log('⑥ PDF 가 없거나 그림을 못 만들면 다음 실행에 다시');
    {
        const g = fake(), d2 = tmp(), c2 = mk(g, d2);
        g.html = page([row(IDS.a, '서해주간해어황정보', '부서', '2026-11-20', 'DX5-9-1', 'a.pdf'), row(IDS.d, '주간해어황정보', '부서', '2026-11-19', 'DX5-8-1', 'd.pdf')]);
        g.pdf = { 'DX5-8-1': 1 };   // a 는 아직 PDF 가 안 옴
        g.broken = true;            // d 는 받은 PDF 가 깨짐
        let s = await c2.run();
        const by = Object.fromEntries(c2.list().map((e) => [e.id, e.status]));
        ok('a=no_pdf · d=convert_failed · 결과 실패 2', by[IDS.a] === 'no_pdf' && by[IDS.d] === 'convert_failed' && s.failed === 2 && s.ok === true, { by, s });
        ok('깨진 PDF 는 지운다(다음에 새로 받게)', !fs.existsSync(path.join(d2, IDS.d + '.pdf')));
        g.pdf['DX5-9-1'] = 1; g.broken = false;
        s = await c2.run();
        ok('다음 실행에 둘 다 준비됨', s.ready === 2 && s.failed === 0 && c2.list().every((e) => e.status === 'ok' && e.pages === 1), { s, l: c2.list() });
        g.noConverter = true;
        const g3 = fake(), d3 = tmp(), c3 = mk(g3, d3);
        g3.html = page([row(IDS.a, '서해', '부서', '2026-11-20', 'DX5-7-1', 'a.pdf')]); g3.pdf = { 'DX5-7-1': 1 }; g3.noConverter = true;
        s = await c3.run();
        ok('변환기가 없으면 PDF 는 남긴다(받기는 됐다)', fs.existsSync(path.join(d3, IDS.a + '.pdf')) && c3.list()[0].status === 'convert_failed', c3.list());
    }

    console.log('⑦ 30일이 지나면 글과 파일을 지운다');
    f.html = page([]); f.clock = T0 + 31 * DAY;   // 게시판은 다시 읽히지만(빈 표) 날짜로 지운다
    f.html = page([row(IDS.a, '서해주간해어황정보 제26-48호', '기후환경자원과', '2026-11-20', 'DX5-1-1', 'a.pdf')]);
    st = await c.run();
    ok('11-14 글(38일)·11-20 글(32일) 모두 빠진다', st.removed === 2 && c.list().length === 0, { st, l: c.list() });
    ok('파일도 지운다', !fs.readdirSync(dir).some((x) => /\.(pdf|png)$/.test(x)), fs.readdirSync(dir));
    f.clock = T0 + 30 * DAY;
    {
        const g = fake(), d4 = tmp(), c4 = mk(g, d4);
        g.html = page([row(IDS.a, '서해', '부서', '2026-11-20', 'DX5-1-1', 'a.pdf')]); g.pdf = { 'DX5-1-1': 1 };
        await c4.run();
        g.clock = Date.parse('2026-12-20T00:30:00Z'); g.html = page([]);   // 2026-12-20 KST = 30일째
        const s = await c4.run();
        ok('딱 30일째는 남긴다', c4.list().length === 1 && s.removed === 0, { s, l: c4.list() });
    }

    console.log('⑦-2 조회 수 — 열 때마다 1, 관리자는 하루 1번, 지운 글은 빠짐');
    {
        const g = fake(), d5 = tmp(), c5 = mk(g, d5);
        g.html = page([row(IDS.a, '서해', '부서', '2026-11-20', 'DX5-1-1', 'a.pdf'), row(IDS.d, '전국', '부서', '2026-11-19', 'DX5-2-1', 'd.pdf')]); g.pdf = { 'DX5-1-1': 1, 'DX5-2-1': 1 };
        await c5.run();
        ok('처음엔 0', c5.list().every((e) => e.views === 0), c5.list());
        c5.hit(IDS.a); c5.hit(IDS.a); const r = c5.hit(IDS.a);
        ok('일반 조회는 매번 1(3번 → 3)', r === 3 && c5.get(IDS.a).views === 3);
        c5.hit(IDS.d, true); c5.hit(IDS.d, true);
        ok('관리자는 같은 날 두 번 열어도 1', c5.get(IDS.d).views === 1);
        g.clock += DAY; c5.hit(IDS.d, true);
        ok('다음 날 관리자 조회는 다시 1', c5.get(IDS.d).views === 2);
        ok('없는 글·꼴이 아닌 ID 는 null', c5.hit(IDS.b) === null && c5.hit('../x') === null);
        const n0 = c5.get(IDS.a).views; await c5.run();
        ok('1시간 확인(run)이 조회 수를 덮지 않는다', c5.get(IDS.a).views === n0);
        g.clock = Date.parse('2026-12-20T00:30:00Z');   // 11-19 글만 30일 넘김(31일)
        g.html = page([]); await c5.run();
        const vw = JSON.parse(fs.readFileSync(path.join(d5, 'views.json'), 'utf8'));
        ok('지운 글의 조회 수는 views.json 에서도 빠진다', vw.count[IDS.d] === undefined && vw.count[IDS.a] === 3, vw);
        ok('views.json 은 찌꺼기로 지우지 않는다', fs.existsSync(path.join(d5, 'views.json')));
    }

    console.log('⑧ 연결(글자 확인)');
    const root = path.join(__dirname, '..');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    ok('server.js: 라우트 연결', server.includes("app.use(require('./routes/fishcond'))"));
    ok('server.js: 운영 시작에서 start', server.includes("require('./services/fishcond_collector').start()"));
    const route = fs.readFileSync(path.join(root, 'routes', 'fishcond.js'), 'utf8');
    ok('라우트: 목록·보기·쪽·PDF', ['/api/fishcond\'', '/api/fishcond/:id/view', '/api/fishcond/:id/page/:n', '/api/fishcond/:id/pdf'].every((s) => route.includes(s)));
    ok('라우트: PDF 는 첨부 + 한글 이름(filename*)', route.includes("attachment; filename=\"") && route.includes("filename*=UTF-8"));
    ok('라우트: 보기 페이지가 조회 수를 센다(관리자 ?admin=true)', route.includes("fc().hit(id, req.query.admin === 'true')"));
    ok('bulletin_docs: convertPdf 를 내보낸다', typeof require('../services/bulletin_docs').convertPdf === 'function');
    ok('운영이 아니면 start 하지 않는다', (() => { const was = process.env.FLY_ALLOC_ID; delete process.env.FLY_ALLOC_ID; const r = mk(fake(), tmp()).start(); if (was) process.env.FLY_ALLOC_ID = was; return r === false; })());

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
