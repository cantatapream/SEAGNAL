'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_bulletin_docs.js
 * 역할  : 통보문 원문 보관(services/bulletin_docs) 검사 — 발자취에 든 통보문의 PDF 를 받아 쪽 그림으로 바꿔 두고,
 *         특보가 끝나면 지우는지. 받기·바꾸기는 가짜로 끼운다(바깥 서버·pdftoppm 없이 돈다).
 * 사용자 2026-11-18: 「통보문 원문 pdf 파일 자체를 우리서버에 보관, 요청시 우리서버에서 내려주고 -> 특보가 사라지면 삭제(생애주기 끝나면)」
 *                    「통보문이 한장 이상인 경우도 문제없이 표출되어야해」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_docs.js · routes/weather.js(글자 확인) · client/js/forecast/alerts/alert_history.js(글자 확인) · Dockerfile(글자 확인)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_bulletin_docs.js)
 * ============================================================================
 */
const fs = require('fs'), os = require('os'), path = require('path');
const D = require('../services/bulletin_docs');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

// 통보문(관찰기 꼴)과 발자취(bulletin_status trails 꼴)
const B = (rpt, ho, tmIn, img) => ({ office: '제주청', rpt, result: Object.assign({ t1Title: ho, tmIn: tmIn + ':30.0', tmFc: tmIn + ':00.0' }, rpt === '7' ? { pwnImageName: img } : { rptImageName2: img }) });
const ms = (b) => Date.parse(b.result.tmIn.slice(0, 19).replace(' ', 'T') + '+09:00');
const ref = (b) => ({ rpt: b.rpt, office: b.office, ho: b.result.t1Title, inMs: ms(b) });
const K51 = 'KTKO50_202611181600_184_51', K13 = 'KTKO52_202611171600_184_13', K36 = 'KTKO50_202611181600_143_36';
const b51 = B('6', '제11-51호', '2026-11-18 16:00', '202611/18/' + K51 + '.png'), b13 = B('7', '제11-13호', '2026-11-17 16:00', '202611/17/' + K13 + '.png');
const b36 = Object.assign(B('6', '제11-36호', '2026-11-18 16:00', '202611/18/' + K36 + '.png'), { office: '대구청' });

/** 가짜 바깥: ready 에 든 주소만 PDF 를 준다. pages[열쇠] 만큼 쪽 그림을 만든다(기본 1). */
function fake() {
    const f = { ready: new Set(), pages: {}, fetched: [], converted: [], noConverter: false, boom: null, broken: false, dieAfter: 0 };
    f.fetchPdf = async (url) => { f.fetched.push(url); if (f.boom) throw new Error(f.boom); return f.ready.has(url) ? Buffer.from('%PDF-1.4 ' + url) : null; };
    f.convert = async (pdf, prefix) => {
        if (f.noConverter) throw Object.assign(new Error('spawn pdftoppm ENOENT'), { code: 'ENOENT' });
        if (f.broken) throw new Error('Command failed: pdftoppm\nSyntax Error: Couldn\'t find trailer dictionary');
        const key = path.basename(prefix).replace(/\.part$/, ''), n = f.pages[key] || 1; f.converted.push(key);
        for (let i = 1; i <= n; i++) { fs.writeFileSync(prefix + '-' + (n >= 10 ? String(i).padStart(2, '0') : i) + '.png', 'PNG' + i); if (f.dieAfter === i) throw new Error('killed'); }
    };
    return f;
}
const url = (b) => D.docOf(b.result).url;

(async () => {
    console.log('A. 열쇠와 주소');
    {
        const d = D.docOf(b51.result);
        ok('특보 통보문: 그림 이름 → 열쇠·PDF 주소(같은 자리·같은 이름)', d.key === K51 && d.url === 'https://marine.kma.go.kr/resources/kmas/C5N_DATA/WRN/PDF/202611/18/' + K51 + '.pdf', d);
        ok('예비 통보문도 같다', D.docOf(b13.result).key === K13 && /\/202611\/17\/KTKO52_202611171600_184_13\.pdf$/.test(D.docOf(b13.result).url));
        ok('그림 이름이 없거나 꼴이 다르면 없음(주소를 지어내지 않는다)', D.docOf({}) === null && D.docOf({ rptImageName2: '../../etc/passwd.png' }) === null && D.docOf({ rptImageName2: '202611/18/x.png' }) === null && D.docOf(null) === null);
        const need = D.needed({ a: { list: [ref(b51), ref(b13)] }, b: { list: [ref(b51)] }, c: { list: [{ rpt: '6', office: '제주청', ho: '제11-99호', inMs: 1 }] } }, [b51, b13, b36]);
        ok('있어야 할 것 = 어느 해역의 발자취에든 든 통보문(겹치면 한 번, 발자취에 없는 통보문·본문을 못 찾은 줄은 빼고)', need.size === 2 && need.has(K51) && need.has(K13) && !need.has(K36), [...need.keys()]);
    }

    console.log('B. 받아 두기 · 그림으로 바꾸기 · 생애주기가 끝나면 지우기');
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc-')), f = fake(), docs = D.createDocs({ dir, fetchPdf: f.fetchPdf, convert: f.convert });
        const trails = { 제주도북부앞바다: { list: [ref(b13), ref(b51)] }, 동해남부북쪽안쪽먼바다: { list: [ref(b36)] } }, bulletins = [b51, b13, b36];
        f.ready.add(url(b13)); f.ready.add(url(b36)); f.pages[K36] = 2;
        const s1 = await docs.sync({ trails, bulletins });
        ok('발자취에 든 통보문의 PDF 를 받아 그림으로 바꾼다 — 아직 안 올라온 것(제11-51호)은 기다린다', s1.need === 3 && s1.fetched === 2 && s1.converted === 2 && s1.waiting === 1 && s1.removed === 0, s1);
        ok('한 장짜리: 쪽 그림 1 · 두 장짜리: 쪽 그림 1·2(사용자 「한장 이상인 경우도 문제없이」)', JSON.stringify(docs.pages(K13)) === '[1]' && JSON.stringify(docs.pages(K36)) === '[1,2]' && docs.pages(K51).length === 0);
        ok('내려줄 파일 경로: PDF · 쪽 그림', docs.file(K36, 'pdf') === path.join(dir, K36 + '.pdf') && docs.file(K36, 2) === path.join(dir, K36 + '-2.png') && docs.file(K36, 3) === null && docs.file(K51, 'pdf') === null);
        const s2 = await docs.sync({ trails, bulletins });
        ok('이미 받은 것은 다시 받지도 바꾸지도 않는다 — 안 올라온 것만 다시 물어본다', s2.fetched === 0 && s2.converted === 0 && s2.waiting === 1 && f.fetched.filter((u) => u === url(b13)).length === 1 && f.fetched.filter((u) => u === url(b51)).length === 2, s2);
        f.ready.add(url(b51));
        const s3 = await docs.sync({ trails, bulletins });
        ok('PDF 가 올라오면 그때 받아 바꾼다', s3.fetched === 1 && s3.converted === 1 && s3.waiting === 0 && docs.pages(K51).length === 1, s3);
        // 동해남부북쪽안쪽먼바다 특보가 끝남 → 발자취에서 빠짐
        const s4 = await docs.sync({ trails: { 제주도북부앞바다: trails.제주도북부앞바다 }, bulletins });
        ok('특보가 끝나 발자취에서 빠진 통보문은 PDF·쪽 그림을 모두 지운다(사용자 「특보가 사라지면 삭제」)', s4.removed === 3 && docs.pages(K36).length === 0 && docs.file(K36, 'pdf') === null && docs.pages(K51).length === 1 && docs.pages(K13).length === 1, s4);
        ok('두 해역이 함께 쓰는 통보문은 한 해역이 끝나도 남는다', (await docs.sync({ trails: { 제주도북부앞바다: { list: [ref(b51)] }, 제주도동부앞바다: { list: [ref(b13)] } }, bulletins })).removed === 0 && docs.pages(K13).length === 1);
        const s5 = await docs.sync({ trails: {}, bulletins });
        ok('살아 있는 특보가 없으면 보관소가 빈다', s5.removed === 4 && fs.readdirSync(dir).length === 0, [s5, fs.readdirSync(dir)]);
    }

    console.log('C. 잘 안 될 때');
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc2-')), f = fake(), docs = D.createDocs({ dir, fetchPdf: f.fetchPdf, convert: f.convert });
        const trails = { 제주도북부앞바다: { list: [ref(b51), ref(b13)] } }, bulletins = [b51, b13];
        f.ready.add(url(b51)); f.ready.add(url(b13)); f.noConverter = true;
        const s1 = await docs.sync({ trails, bulletins });
        ok('그림 변환기가 없으면(pdftoppm 미설치) PDF 만 받아 두고 계속 간다 — 쪽 그림 없음 → 팝업은 종전 길', s1.fetched === 2 && s1.converted === 0 && docs.pages(K51).length === 0 && docs.file(K51, 'pdf') !== null, s1);
        f.noConverter = false;
        const s2 = await docs.sync({ trails, bulletins });
        ok('변환기가 생기면 받아 둔 PDF 로 그림을 만든다(다시 받지 않는다)', s2.fetched === 0 && s2.converted === 2 && docs.pages(K51).length === 1, s2);
        f.boom = 'fetch failed'; fs.unlinkSync(docs.file(K13, 'pdf')); fs.unlinkSync(docs.file(K13, 1));
        const s3 = await docs.sync({ trails, bulletins });
        ok('받다가 오류가 나도 던지지 않고 다른 통보문은 그대로', s3.fetched === 0 && docs.pages(K51).length === 1 && docs.pages(K13).length === 0, s3);
        f.boom = null;
        const [r1, r2] = await Promise.all([docs.sync({ trails, bulletins }), docs.sync({ trails, bulletins })]);
        ok('겹쳐 불리면 한쪽은 건너뛴다(같은 파일을 두 번 받지 않는다)', (r1.skipped ? 1 : 0) + (r2.skipped ? 1 : 0) === 1 && docs.pages(K13).length === 1, [r1, r2]);
        // 쪽 수가 10 이상이면 pdftoppm 이 번호를 0 으로 채운다(-01 … -12)
        f.pages[K36] = 12; f.ready.add(url(b36));
        await docs.sync({ trails: { x: { list: [ref(b36)] } }, bulletins: [b36] });
        ok('쪽 수가 10 이상이어도 번호순으로 읽고 찾는다', docs.pages(K36).length === 12 && docs.pages(K36)[9] === 10 && docs.file(K36, 3) === path.join(dir, K36 + '-03.png') && docs.file(K36, 12) === path.join(dir, K36 + '-12.png'));
        ok('열쇠·쪽 번호 꼴이 아니면 파일을 찾지 않는다(바깥 글자를 경로에 붙이지 않는다)', docs.file('../' + K36, 'pdf') === null && docs.file(K36 + '/../x', 1) === null && docs.file(K36, '1/../../x') === null && docs.file(K36, 0) === null && docs.pages('constructor').length === 0 && docs.file('', 'pdf') === null);
    }

    console.log('C2. 별도 에이전트 검토(2026-11-18)에서 나온 것');
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc3-')), f = fake(), docs = D.createDocs({ dir, fetchPdf: f.fetchPdf, convert: f.convert });
        const trails = { x: { list: [ref(b36)] } }, bulletins = [b36];
        f.ready.add(url(b36)); f.pages[K36] = 2;
        // 올라오는 도중의 PDF 를 받았다 → 변환 실패
        f.broken = true;
        const s1 = await docs.sync({ trails, bulletins });
        ok('PDF 가 깨져 변환이 실패하면 그 PDF 를 지운다(다음 분에 다시 받게)', s1.fetched === 1 && s1.converted === 0 && docs.file(K36, 'pdf') === null && docs.pages(K36).length === 0, s1);
        f.broken = false;
        const s2 = await docs.sync({ trails, bulletins });
        ok('다음 분에 다시 받아 그림을 만든다 — 깨진 PDF 에 갇히지 않는다', s2.fetched === 1 && s2.converted === 1 && docs.pages(K36).length === 2 && f.fetched.length === 2, s2);
        // 변환이 1쪽만 만들고 죽었다(서버 재시작·시간초과)
        fs.unlinkSync(docs.file(K36, 1)); fs.unlinkSync(docs.file(K36, 2)); f.dieAfter = 1;
        const s3 = await docs.sync({ trails, bulletins });
        ok('변환이 도중에 죽으면 반쪽 그림을 내놓지 않는다(1쪽만 있는 통보문으로 굳지 않는다)', s3.converted === 0 && docs.pages(K36).length === 0 && docs.file(K36, 1) === null, [s3, fs.readdirSync(dir)]);
        f.dieAfter = 0; fs.writeFileSync(docs.file(K36, 'pdf') || path.join(dir, K36 + '.pdf'), '%PDF-1.4');
        f.ready.add(url(b36));
        const s4 = await docs.sync({ trails, bulletins });
        ok('다음 분에 처음부터 다시 만들어 두 쪽이 다 나온다(남은 임시 그림은 치운다)', s4.converted === 1 && JSON.stringify(docs.pages(K36)) === '[1,2]' && !fs.readdirSync(dir).some((x) => /\.part-/.test(x)), [s4, fs.readdirSync(dir)]);
        // 이름을 바꾸는 도중(2쪽만 제 이름) — 1쪽이 없으면 「없음」
        fs.renameSync(docs.file(K36, 1), path.join(dir, K36 + '.part-1.png'));
        ok('쪽 그림은 1쪽부터 빠짐없이 이어진 만큼만 센다(2쪽만 있으면 없음)', docs.pages(K36).length === 0);
        fs.renameSync(path.join(dir, K36 + '.part-1.png'), path.join(dir, K36 + '-1.png'));
        // 관찰기 상태를 못 읽어 통보문 자료가 비었다
        const s5 = await docs.sync({ trails: {}, bulletins: [] });
        ok('통보문 자료가 하나도 없으면(자료를 못 읽음) 보관소를 비우지 않는다', s5.removed === 0 && docs.pages(K36).length === 2, s5);
        const s6 = await docs.sync({ trails: {}, bulletins });
        ok('통보문 자료는 있는데 발자취가 비면(특보가 다 끝남) 비운다', s6.removed === 3 && fs.readdirSync(dir).length === 0, s6);
        ok('받은 것이 PDF 로 시작하지 않으면 받지 않는다(realFetch 글자 확인)', /buf\.subarray\(0, 5\)\.toString\('latin1'\) === '%PDF-' \? buf : null/.test(fs.readFileSync(path.join(__dirname, '..', 'services', 'bulletin_docs.js'), 'utf8')));
    }

    console.log('D. 이어진 곳(글자 확인)');
    {
        const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
        const route = read('local_server/routes/weather.js'), client = read('client/js/forecast/alerts/alert_history.js');
        ok('팝업 목록: 쪽 그림이 있는 줄에 보기 주소(viewUrl)를 붙이고, 없는 줄만 바깥 PDF 확인', /it\.viewUrl = '\/api\/bulletin-doc\/' \+ it\.docKey \+ '\/view'/.test(route) && /keepLivePdf\(dm\.bulletins\.filter\(\(it\) => !it\.viewUrl\), _pdfExists\)/.test(route));
        ok('보기 페이지·쪽 그림·PDF 를 내려주는 주소 셋', ["router.get('/api/bulletin-doc/:key/view'", "router.get('/api/bulletin-doc/:key/page/:n'", "router.get('/api/bulletin-doc/:key/pdf'"].every((x) => route.includes(x)));
        ok('보기 페이지는 쪽 그림을 세로로 이어 붙인다(여러 장이면 아래로 스크롤)', /pages\.map\(\(n, i\) =>/.test(route) && /<img src="page\/' \+ n \+ '"/.test(route));
        ok('화면: 보기 주소가 있으면 그것을 먼저 연다(구글 문서 뷰어·바깥 PDF 보다 앞)', /var url = b\.viewUrl \? b\.viewUrl : b\.webUrl/.test(client) && /if \(b\.viewUrl \|\| b\.pdfUrl \|\| b\.webUrl\)/.test(client) && /!b\.viewUrl && !b\.pdfUrl && !b\.webUrl/.test(client));
        ok('운영 서버 이미지에 그림 변환기(poppler-utils)를 깐다', /apt-get install[^\n]*poppler-utils/.test(read('Dockerfile')) && /command -v pdftoppm/.test(read('Dockerfile')));
        ok('통보문 기준 계산 다음 매분 맞춘다(scheduler)', /require\('\.\/services\/bulletin_docs'\)\.sync\(\{ trails: st\.trails, bulletins: bulletinWatch\.bulletins\(\), extra: escRefs \}\)/.test(read('local_server/scheduler.js')));
        ok('MMIS 코드를 쓰지 않는다', !/marine_client|fetchWarn|ntfctn/.test(read('local_server/services/bulletin_docs.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
    }

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
