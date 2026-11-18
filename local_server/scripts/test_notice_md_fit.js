/**
 * test_notice_md_fit.js — 공지 게시판 마크다운 글(패치노트)의 줄 맞춤을 고정한다.
 *
 * [왜 있나] 사용자 확정 2026-11-18: 「텍스트는 어절단위로 끊어져 정리될 수 있도록」 ·
 *   「다음줄이 2~3개 텍스트 때문에 어절단위로 안끊어지면 그 줄의 자간을 좀 줄여서 한줄에 들어갈 수 있도록」 · 「일단 패치노트만」.
 *   style.css .promo-md 의 word-break:keep-all(낱말 중간 줄바꿈 금지) + md_fit.js(줄 끝 넘침을 그 줄 글자 간격으로 맞춤).
 *
 * [무엇을 고정하나]
 *   ① 다음 줄로 넘어간 낱말이 2글자쯤 모자라면 → 그 줄을 좁혀 한 줄로 올린다(좁힌 값은 한도 0.12em 안)
 *   ② 많이 모자라면(긴 낱말) → 좁히지 않고 낱말 통째로 다음 줄(낱말 중간에서 안 끊김)
 *   ③ 굵은 글씨와 붙은 조각(「[저장]」+「을」)은 한 낱말로 함께 올라간다
 *   ④ 칸 밖으로 삐져나가는 문단이 없다 · ⑤ 폭이 넓어져 다시 맞추면 좁힌 것을 푼다
 *   ⑥ .promo-md 가 없는 칸(옛 글)은 건드리지 않는다 · ⑦ 편집기(Quill)에는 걸지 않는다(정적 — 낱말마다 span 을 씌우므로 저장 글이 바뀐다)
 *
 * [실행] node local_server/scripts/test_notice_md_fit.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/notice/board/md_fit.js · client/style.css(promo-md 덩어리) · client/js/notice/board/promo.js(openPromoDetail) · client/index2.html(로드 순서)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }

(async () => {
    const css = read('client/style.css'), a = css.indexOf('/* promo-md:start'), b = css.indexOf('/* promo-md:end */');
    const fit = read('client/js/notice/board/md_fit.js');

    console.log('── 정적: 붙인 자리 ──');
    ok(/word-break:\s*keep-all/.test(css.slice(a, b)), 'style.css promo-md 덩어리에 word-break:keep-all');
    const promo = read('client/js/notice/board/promo.js');
    const calls = promo.split('\n').filter((l) => /promoMdFit\(/.test(l));
    ok(calls.length >= 1 && calls.every((l) => /contentEl/.test(l)), 'promo.js 는 보기 칸(contentEl)에만 promoMdFit 를 건다', calls.join(' / '));
    ok(!/promoQuillEditor[^\n]*promoMdFit|promoMdFit[^\n]*promoQuillEditor/.test(promo), '편집기(promoQuillEditor)에는 걸지 않는다');
    const html = read('client/index2.html'), iFit = html.indexOf('js/notice/board/md_fit.js'), iPromo = html.indexOf('js/notice/board/promo.js');
    ok(iFit > 0 && iFit < iPromo, 'index2.html: md_fit.js 가 promo.js 앞에 로드');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif}' +
        '.c{width:318px;color:#ccc}.c li{list-style:none}' + css.slice(a, b) + '</style>' +
        '<div class="c ql-editor promo-md" id="c"></div><div class="c ql-editor" id="old"></div>');
    await page.addScriptTag({ content: fit });

    // 폭을 글꼴에 맞춰 정해 「다음 낱말이 N글자 모자란」 상황을 만든다 — 글꼴이 달라도 같은 상황이 되게
    const setup = (overChars, word) => page.evaluate(({ overChars, word }) => {
        const c = document.getElementById('c');
        const lead = '가나다라 마바사아 자차카타 파하가나';
        c.style.width = '';
        c.innerHTML = '<p>' + lead + ' ' + word + ' 끝</p>';
        const m = document.createElement('span'); m.style.whiteSpace = 'nowrap'; m.style.fontSize = '15px';
        document.body.appendChild(m);
        m.textContent = lead + ' ' + word.replace(/<[^>]+>/g, ''); const full = m.getBoundingClientRect().width;
        m.textContent = '가'; const ch = m.getBoundingClientRect().width; m.remove();
        c.style.width = Math.floor(full - overChars * ch) + 'px';
        return { ch };
    }, { overChars, word });
    // 그 낱말(조각 글자)이 첫 줄에 있나 — 첫 조각과 윗선이 같은가
    //   (맞추기 전에는 조각이 없으므로 글자 범위(Range)로 잰다)
    const onFirstLine = (txt) => page.evaluate((txt) => {
        const p = document.querySelector('#c p'), w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let first = null, hit = null;
        while (w.nextNode()) { const t = w.currentNode, i = t.nodeValue.indexOf(txt); if (!first && t.nodeValue.trim()) first = t; if (i >= 0 && !hit) { hit = document.createRange(); hit.setStart(t, i); hit.setEnd(t, i + txt.length); } }
        const r0 = document.createRange(); r0.setStart(first, first.nodeValue.search(/\S/)); r0.setEnd(first, first.nodeValue.search(/\S/) + 1);
        return Math.abs(hit.getClientRects()[0].top - r0.getClientRects()[0].top) < 2;
    }, txt);
    const state = () => page.evaluate(() => {
        const p = document.querySelector('#c p'), sp = [...p.querySelectorAll('span')];
        const ls = sp.map((s) => parseFloat(s.style.letterSpacing) || 0);
        return { min: Math.min(0, ...ls), split: sp.filter((s) => s.getClientRects().length > 1).map((s) => s.textContent), over: p.scrollWidth > p.clientWidth + 1 };
    });

    console.log('── ① 2글자 모자람 → 좁혀 올림 ──');
    await setup(1.6, '바다날씨예보');
    const before = await onFirstLine('바다날씨예보');
    await page.evaluate(() => promoMdFit(document.getElementById('c')));
    let s = await state(), after = await onFirstLine('바다날씨예보');
    ok(!before && after, '다음 줄에 있던 낱말이 첫 줄로 올라옴', 'before ' + before + ' after ' + after);
    ok(!(await onFirstLine('끝')), '그 뒤 낱말(끝)은 다음 줄 그대로 — 한 줄에 두 번 당길 때 앞서 좁힌 값을 덮어쓰지 않음');
    ok(s.min < 0 && s.min >= -0.12 * 15 - 0.01, '좁힌 값이 한도(0.12em = 1.8px) 안', String(s.min));

    console.log('── ⑤ 폭이 넓어지면 다시 맞출 때 푼다 ──');
    await page.evaluate(() => { const c = document.getElementById('c'); c.style.width = '600px'; promoMdFit(c); });
    s = await state();
    ok(s.min === 0, '넓은 폭에서는 좁힘 없음', String(s.min));

    console.log('── ② 많이 모자람 → 좁히지 않고 낱말째 다음 줄 ──');
    await setup(5, '제주도남쪽바깥먼바다를');
    await page.evaluate(() => promoMdFit(document.getElementById('c')));
    s = await state();
    ok(s.min === 0, '좁히지 않음', String(s.min));
    ok(s.split.length === 0, '낱말 중간에서 안 끊김', s.split.join(','));
    ok(!s.over, '칸 밖으로 안 넘침');

    console.log('── ③ 굵은 글씨에 붙은 조각은 한 낱말 ──');
    await setup(1.4, '<strong>[저장]</strong>을');
    await page.evaluate(() => promoMdFit(document.getElementById('c')));
    const together = await page.evaluate(() => {
        const sp = [...document.querySelectorAll('#c p span')], a = sp.find((x) => x.textContent === '[저장]'), b = sp.find((x) => x.textContent === '을');
        return Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2 && (parseFloat(a.style.letterSpacing) || 0) === (parseFloat(b.style.letterSpacing) || 0);
    });
    ok(together, '「[저장]」과 「을」이 같은 줄·같은 간격');
    ok(await onFirstLine('을'), '첫 줄로 함께 올라옴');

    console.log('── ⑥ .promo-md 가 없는 칸은 그대로 ──');
    const untouched = await page.evaluate(() => { const o = document.getElementById('old'); o.innerHTML = '<p>가나다 라마바</p>'; promoMdFit(o); return o.querySelectorAll('span').length === 0; });
    ok(untouched, '옛 글 칸에는 span 을 씌우지 않음');

    await browser.close();
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
