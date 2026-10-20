/**
 * 파일명: local_server/scripts/test_notice_markdown.js
 * 역할  : 공지 게시판 「마크다운 파일 불러오기」(2026-10-20 사용자 결정 — 파일을 올리면 편집기에 채우고, 눈으로 보고 고친 뒤 저장 · 사진은 파일 안에)를 고정한다.
 *         ①변환(markdown_import.js toHtml): 제목 빼내기·소제목·문단·목록·인용·굵게·링크·사진(파일 안 data URI 만)·날 HTML 은 글자로·메모 뺌
 *         ②실제 편집기(Quill 1.3.6, Chromium)가 변환 결과를 그대로 담는지(소제목·목록 단계·굵게·색·사진 data URI) ③promo.js 연결(불러오기는 저장하지 않음).
 *         ④(2026-10-20 「추천대로」) 마크다운 글(format:'md')만 단계별 글자 크기·간격 — 실제 style.css 로 계산값 확인, 옛 글은 그대로 · 빌드 도구 3줄 검사.
 * [연계] client/js/notice/board/markdown_import.js · promo.js(importPromoMarkdown) · client/assets/vendor/quill · NOTICE.md / verify_all.sh SUITES
 * [로드 순서] 독립 검사 — 서버·외부 호출 없음. 브라우저 사례는 로컬 Chromium(파일만 읽음).
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_notice_markdown.js
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../..'), MD = require(path.join(root, 'client/js/notice/board/markdown_import.js'));
let pass = 0, fail = 0;
/** 사례 하나. 예: await check('제목', fn) @param {string} name @param {Function} fn @returns {Promise<void>} [연계] ← 아래 사례 */
async function check(name, fn) { try { await fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.error('❌', name, e.message); } }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SAMPLE = ['<!-- 작성 메모: 게시판에는 안 나감 -->', '# 10월 패치노트', '', '새 기능 **두 가지**가 생겼어요.', '이어지는 줄은 한 문단.', '', '## AI 연안 안전 브리핑', '',
    '- 예보 탭에서 *브리핑* 펼치기', '  - 하위 ==중요==', '    - 그 아래 !!주의!!', '- [자세히](https://seagnal-server.fly.dev)', '', '1. 첫째', '2. 둘째', '', '> 참고: 관리자 기기만', '', `![브리핑 화면](${PNG})`, '', '---', '<script>alert(1)</script>', '![빠진 사진](shots/a.png)'].join('\n');

(async () => {
    let chromium; try { ({ chromium } = require('playwright-core')); } catch (_) { chromium = null; }
    await check('변환: 맨 처음 「# 제목」은 게시글 제목으로 빼고, 소제목·문단(붙은 줄 합침)·목록·번호·인용·굵게·기울임·링크·사진', () => {
        const r = MD.toHtml(SAMPLE);
        assert.equal(r.title, '10월 패치노트');
        assert.ok(r.html.startsWith('<p>새 기능 <strong>두 가지</strong>가 생겼어요. 이어지는 줄은 한 문단.</p><h2>AI 연안 안전 브리핑</h2><ul>'), r.html.slice(0, 160));   // 덩어리 사이 간격은 화면 CSS(.promo-md) — 빈 줄 없음
        assert.ok(r.html.includes('<ul><li>예보 탭에서 <em>브리핑</em> 펼치기</li><li class="ql-indent-1">하위 <strong style="color: #facc15;">중요</strong></li><li class="ql-indent-2">그 아래 <strong style="color: #fb923c;">주의</strong></li><li><a href="https://seagnal-server.fly.dev">자세히</a></li></ul><ol><li>첫째</li><li>둘째</li></ol>'), r.html);
        assert.ok(r.html.includes('<blockquote>참고: 관리자 기기만</blockquote>'));
        assert.ok(r.html.includes('<img src="' + PNG + '" alt="브리핑 화면">'));
        assert.equal(r.images, 1);
    });
    await check('변환: 메모(<!-- -->)·가로줄은 빠지고 날 HTML 은 글자로(스크립트가 되지 않음) · 상대 경로 사진은 넣지 않고 경고', () => {
        const r = MD.toHtml(SAMPLE);
        assert.ok(!r.html.includes('작성 메모') && !r.html.includes('<hr') && !r.html.includes('<script'));
        assert.ok(r.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
        assert.ok(!r.html.includes('shots/a.png'));
        assert.equal(r.warnings.length, 1); assert.ok(r.warnings[0].includes('shots/a.png'));
    });
    await check('변환: 제목이 맨 처음이 아니면 소제목(h2) · #### 는 h3 · javascript: 링크·http 사진은 넣지 않음 · 빈 파일', () => {
        const r = MD.toHtml('첫 문단\n\n# 늦은 제목\n\n#### 작은 제목\n\n[나쁜](javascript:alert(1)) ![x](http://a.b/c.png)');
        assert.equal(r.title, ''); assert.ok(r.html.includes('<h2>늦은 제목</h2>') && r.html.includes('<h3>작은 제목</h3>'));
        assert.ok(!r.html.includes('href="javascript') && !r.html.includes('<img')); assert.equal(r.warnings.length, 1);
        assert.deepStrictEqual([MD.toHtml('').html, MD.toHtml('').title], ['', '']);
    });
    await check('변환: 사진 주소 안의 _·* 는 꾸밈으로 읽지 않음 · CRLF·BOM', () => {
        const r = MD.toHtml('﻿문단 _기울임_\r\n\r\n![a_b*c](https://x.y/a_b*c.jpg)');
        assert.ok(r.html.includes('<em>기울임</em>') && r.html.includes('<img src="https://x.y/a_b*c.jpg" alt="a_b*c">'), r.html);
    });
    await check('[단계 규칙] 실제 style.css + quill.snow.css 로 계산한 값: 마크다운 글(.promo-md)만 ## 17px·위 20 · ○ 15px·사이 10 · - 14px·5 · · 13px·3 · ### 하늘색 — 옛 글은 바뀌지 않음', async () => {
        assert.ok(chromium, 'playwright-core 없음');
        const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;
        const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage();
            const body = MD.toHtml('# t\n\n머리글\n\n## 큰 꼭지\n\n### 작은 제목\n\n- 가\n  - 나\n  - 다\n    - 라\n    - 마\n- 바').html;
            await page.setContent('<div id="md" class="promo-content-view ql-editor promo-md">' + body + '</div><div id="old" class="promo-content-view ql-editor">' + body + '</div>');
            await page.addStyleTag({ path: path.join(root, 'client/assets/vendor/quill/quill.snow.css') }); await page.addStyleTag({ path: path.join(root, 'client/style.css') });
            const v = await page.evaluate(() => { const g = (sel) => { const e = document.querySelector(sel), c = getComputedStyle(e); return [c.fontSize, c.marginTop, c.color]; };
                const lis = (id) => [...document.querySelectorAll('#' + id + ' li')].map((e) => { const c = getComputedStyle(e); return e.textContent + ':' + c.fontSize + '/' + c.marginTop + '/' + c.paddingLeft; });
                return { ul: getComputedStyle(document.querySelector('#md ul')).marginTop, h2: g('#md h2'), h3: g('#md h3'), li: lis('md'), before: [getComputedStyle(document.querySelector('#md li'), '::before').content, getComputedStyle(document.querySelector('#md li.ql-indent-1'), '::before').content, getComputedStyle(document.querySelector('#md li.ql-indent-2'), '::before').content], oldH2: g('#old h2')[0], oldLi: lis('old') }; });
            assert.deepStrictEqual(v.h2.slice(0, 2), ['17px', '20px']); assert.deepStrictEqual(v.h3, ['15px', '8px', 'rgb(125, 211, 252)']);
            assert.deepStrictEqual(v.li, ['가:15px/0px/18px', '나:14px/5px/36px', '다:14px/5px/36px', '라:13px/3px/54px', '마:13px/3px/54px', '바:15px/10px/18px'], v.li.join(' · '));
            assert.equal(v.ul, '8px', '소제목 바로 뒤 목록 덩어리 위 8');
            assert.deepStrictEqual(v.before, ['"○"', '"-"', '"·"']);
            assert.notEqual(v.oldH2, '17px'); assert.ok(!v.oldLi.some((x) => x.endsWith('/18px')), '옛 글(promo-md 없음)은 Quill 기본 그대로: ' + v.oldLi.join(' · '));
        } finally { await browser.close(); }
    });
    await check('[3줄 규칙] 빌드 도구가 휴대폰 3줄 넘는 꼭지를 찾는다(본문 폭 318px·단계별 글자 크기·들여쓰기로 어림) · 사진 문단·짧은 글은 통과', () => {
        const B = require(path.join(root, 'scripts/notice/build_notice.js'));
        assert.deepStrictEqual(B.threeLines(MD.toHtml('- ' + '가'.repeat(60) + '\n  - ' + '나'.repeat(50) + '\n\n짧다\n\n![a](' + PNG + ')').html), []);
        const long = B.threeLines(MD.toHtml('- ' + '가'.repeat(61) + '\n\n' + '다'.repeat(70)).html);
        assert.deepStrictEqual(long.map((x) => x.lines), [4, 4]);
        const src = fs.readFileSync(path.join(root, 'scripts/notice/build_notice.js'), 'utf8');
        assert.ok(src.includes("indexOf('/* promo-md:start')") && fs.readFileSync(path.join(root, 'client/style.css'), 'utf8').includes('/* promo-md:end */'), '미리보기는 style.css 의 같은 규칙을 읽는다');
    });
    await check('promo.js·서버 연결(2026-10-20): 불러온 글은 format:\'md\' 로 저장 · 보기·편집기에 promo-md · 서버는 \'md\' 만 받고 수정 때 안 보내면 그대로', () => {
        const src = fs.readFileSync(path.join(root, 'client/js/notice/board/promo.js'), 'utf8');
        assert.ok(/promoEditorFormat = 'md'; setPromoMd\(promoQuillEditor\.root, 'md'\)/.test(src), '불러오면 md');
        assert.ok(src.includes("promoEditorFormat = editData && editData.format === 'md' ? 'md' : null"), '편집기를 열 때마다 그 글 값으로 되돌림');
        assert.ok(src.includes('format: promoEditorFormat || undefined') && src.includes('setPromoMd(contentEl, post.format)'));
        const srv = fs.readFileSync(path.join(root, 'local_server/routes/content.js'), 'utf8');
        assert.ok(srv.includes("...(postData.format === 'md' ? { format: 'md' } : {})") && srv.includes("format: postData.format === 'md' ? 'md' : posts[index].format"));
    });
    await check('promo.js 연결: [마크다운 파일 불러오기] → importPromoMarkdown — 편집기에 채우기만, 저장(savePromoPost)·서버 호출 없음 · 제목은 비었을 때만', () => {
        const src = fs.readFileSync(path.join(root, 'client/js/notice/board/promo.js'), 'utf8');
        assert.ok(/id="promo-md-input"[^>]*accept="\.md/.test(src));
        assert.ok(src.includes("getElementById('promo-md-input').addEventListener('change'"));
        const body = src.slice(src.indexOf('async function importPromoMarkdown'), src.indexOf('// 8. 새 글 작성 에디터 열기'));
        assert.ok(body.includes('dangerouslyPasteHTML(r.html)') && body.includes('!titleEl.value.trim()'));
        assert.ok(!/savePromoPost|fetch\(|XMLHttpRequest/.test(body), '불러오기는 저장하지 않는다');
        const html = fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8');
        assert.ok(html.indexOf('js/notice/board/markdown_import.js') > 0 && html.indexOf('js/notice/board/markdown_import.js') < html.indexOf('js/notice/board/promo.js'), '로드 순서: promo.js 앞');
    });
    await check('실제 편집기(Quill 1.3.6): 변환 결과를 넣으면 소제목·목록·번호·인용·굵게·링크·사진(data URI)이 그대로 남는다', async () => {
        assert.ok(chromium, 'playwright-core 없음');
        const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;   // 다른 브라우저 시험(test_station_briefing_ui)과 같은 방식
        const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage();
            await page.setContent('<div id="ed"></div>');
            await page.addScriptTag({ path: path.join(root, 'client/assets/vendor/quill/quill.min.js') });
            await page.addScriptTag({ path: path.join(root, 'client/js/notice/board/markdown_import.js') });
            const out = await page.evaluate((md) => { const q = new window.Quill('#ed', { theme: 'snow', modules: { toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'image']] } });
                q.clipboard.dangerouslyPasteHTML(window.noticeMarkdown.toHtml(md).html); return q.root.innerHTML; }, SAMPLE);
            for (const x of ['<h2>AI 연안 안전 브리핑</h2>', '<strong>두 가지</strong>', '<em>브리핑</em>', '<ol><li>첫째</li><li>둘째</li></ol>', '<li class="ql-indent-1">', '<li class="ql-indent-2">', 'color: rgb(250, 204, 21)', 'color: rgb(251, 146, 60)', '<blockquote>참고: 관리자 기기만</blockquote>', 'href="https://seagnal-server.fly.dev"', '<img src="' + PNG + '"']) assert.ok(out.includes(x), x + ' / ' + out.slice(0, 300));
            assert.ok(!out.includes('<script'));
        } finally { await browser.close(); }
    });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
