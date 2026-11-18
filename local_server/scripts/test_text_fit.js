/**
 * test_text_fit.js — 긴 안내 글의 줄 정렬(저장소 NOTICE.md 「줄 정렬」)을 고정한다.
 *
 * [왜 있나] 사용자 확정 2026-11-18: 「텍스트는 어절단위로 끊어져 정리될 수 있도록」 · 「두번쨰 줄이 첫줄의 내용시작되는 부분부터」 ·
 *   「다음줄이 2~3개 텍스트 때문에 어절단위로 안끊어지면 그 줄의 자간을 좀 줄여서 한줄에」 — 처음엔 패치노트(게시판)만,
 *   같은 날 해상 기상 전망·「안내」 팝업에도. 기호는 원문 그대로(「거기에 정렬되어 있는 그 방식 그대로」).
 *
 * [무엇을 고정하나]
 *   ① 다음 줄로 넘어간 낱말이 2글자쯤 모자라면 → 그 줄을 좁혀 올린다(한도 0.12em 안) · 한 줄에 두 번 당겨도 앞서 좁힌 값을 덮어쓰지 않음
 *   ② 많이 모자라면(긴 낱말) → 좁히지 않고 낱말째 다음 줄(낱말 중간에서 안 끊김·칸 밖 넘침 없음)
 *   ③ 굵은 글씨와 붙은 조각(「[저장]」+「을」)은 한 낱말로 함께 · ④ 폭이 넓어지면 좁힌 것을 푼다
 *   ⑤ 숨은 칸(폭 0)은 보이게 되면 맞춘다(접힌 아코디언·안 보이는 안내 탭)
 *   ⑥ 해상 기상 전망: 줄 앞 기호(○ - o ※)를 떼어 두고 둘째 줄이 글자 시작점에서 시작 · 꺾쇠 제목은 그대로
 *   ⑦ 안내 팝업: 아이콘 문단(tf-ic) 둘째 줄이 글자 시작점에서 시작 · 굵은 제목 문단 tf-h
 *   ⑧ 정적: 붙인 자리(게시판 보기 칸만·편집기 ✗ · 해상 기상 전망 두 곳 · 안내 팝업 세 곳 · 로드 순서 · CSS keep-all)
 *
 * [실행] node local_server/scripts/test_text_fit.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/shared/ui/text_fit.js · client/style.css(promo-md·해상 기상 전망) · client/index2.html(안내 팝업 CSS·로드 순서)
 *        → client/js/notice/board/promo.js · client/js/forecast/outlook/marine_forecast.js(hangHtml) · ocean_cctv.js · life_safety.js
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
    const fit = read('client/js/shared/ui/text_fit.js');
    const html = read('client/index2.html');
    const mf = read('client/js/forecast/outlook/marine_forecast.js');

    console.log('── ⑧ 정적: 붙인 자리 ──');
    ok(/word-break:\s*keep-all/.test(css.slice(a, b)), 'style.css promo-md 덩어리에 word-break:keep-all');
    ok(/\.regional-forecast-line\s*\{[^}]*\}|\.regional-forecast-line\s*\{\s*word-break/.test(css) && /\.marine-forecast-category-text, \.marine-forecast-sub-item, \.regional-forecast-line \{ word-break: keep-all/.test(css), 'style.css 해상 기상 전망 줄에 keep-all');
    ok(/\.ocean-info-panel p \{[^}]*word-break: keep-all/.test(html), 'index2.html 안내 팝업 문단에 keep-all');
    const promo = read('client/js/notice/board/promo.js');
    const calls = promo.split('\n').filter((l) => /textFit\(/.test(l));
    ok(calls.length === 1 && /contentEl/.test(calls[0]) && /format === 'md'/.test(calls[0]), 'promo.js 는 마크다운 글 보기 칸(contentEl)에만 textFit', calls.join(' / '));
    ok(!/promoQuillEditor[^\n]*textFit|textFit[^\n]*promoQuillEditor/.test(promo), '편집기(promoQuillEditor)에는 걸지 않는다');
    ok((mf.match(/if \(window\.textFit\)/g) || []).length === 2, 'marine_forecast.js 두 곳(초단기·단기 / 지방청 단기 전망)에서 textFit');
    const infoCalls = (read('client/js/ocean-map/cctv/ocean_cctv.js').match(/textFitInfo\(/g) || []).length + (read('client/js/marine-life/safety/life_safety.js').match(/textFitInfo\(/g) || []).length;
    ok(infoCalls === 3, '안내 팝업 세 곳(해양종합정보 · 해양생활 · 해양안전)에서 textFitInfo', String(infoCalls));
    const iFit = html.indexOf('js/shared/ui/text_fit.js'), iMf = html.indexOf('js/forecast/outlook/marine_forecast.js'), iPromo = html.indexOf('js/notice/board/promo.js');
    ok(iFit > 0 && iFit < iMf && iFit < iPromo, 'index2.html: text_fit.js 가 marine_forecast.js·promo.js 앞에 로드');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const infoCss = (html.match(/\.ocean-info-panel p \{[\s\S]*?text-indent: 0; \}/) || [''])[0];
    const fcCss = (css.match(/\.marine-forecast-category-text, \.marine-forecast-sub-item, \.regional-forecast-line \{[\s\S]*?\.tf-hang > \.tf-text \{[^}]*\}/) || [''])[0];
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif}' +
        '.c{width:318px;color:#ccc}.c li{list-style:none}' + css.slice(a, b) + infoCss + fcCss + '.regional-forecast-line{font-size:13px;line-height:1.7}</style>' +
        '<div class="c ql-editor promo-md" id="c"></div><div id="fc" style="width:300px"></div><div id="info" style="width:270px"></div>');
    await page.addScriptTag({ content: fit });
    await page.addScriptTag({ content: 'function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}window.renderMarineMarkup=escapeHtml;' + (mf.match(/function hangHtml[\s\S]*?\n\}/) || [''])[0] });

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
    }, { overChars, word });
    // 그 낱말(조각 글자)이 첫 줄에 있나 — 글자 범위(Range)로 잰다(맞추기 전에는 조각이 없으므로)
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
    const FIT = "textFit(document.getElementById('c'), 'p, li, h2, h3, blockquote')";

    console.log('── ① 2글자 모자람 → 좁혀 올림 ──');
    await setup(1.6, '바다날씨예보');
    const before = await onFirstLine('바다날씨예보');
    await page.evaluate(FIT);
    let s = await state();
    ok(!before && await onFirstLine('바다날씨예보'), '다음 줄에 있던 낱말이 첫 줄로 올라옴');
    ok(!(await onFirstLine('끝')), '그 뒤 낱말(끝)은 다음 줄 그대로 — 두 번 당길 때 앞서 좁힌 값을 덮어쓰지 않음');
    ok(s.min < 0 && s.min >= -0.12 * 15 - 0.01, '좁힌 값이 한도(0.12em = 1.8px) 안', String(s.min));

    console.log('── ④ 폭이 넓어지면 푼다(관찰기가 다시 맞춤) ──');
    await page.evaluate(() => { document.getElementById('c').style.width = '600px'; });
    await page.waitForTimeout(150);
    s = await state();
    ok(s.min === 0, '넓은 폭에서는 좁힘 없음', String(s.min));

    console.log('── ② 많이 모자람 → 좁히지 않고 낱말째 다음 줄 ──');
    await setup(5, '제주도남쪽바깥먼바다를');
    await page.evaluate(FIT);
    s = await state();
    ok(s.min === 0, '좁히지 않음', String(s.min));
    ok(s.split.length === 0, '낱말 중간에서 안 끊김', s.split.join(','));
    ok(!s.over, '칸 밖으로 안 넘침');

    console.log('── ③ 굵은 글씨에 붙은 조각은 한 낱말 ──');
    await setup(1.4, '<strong>[저장]</strong>을');
    await page.evaluate(FIT);
    const together = await page.evaluate(() => {
        const sp = [...document.querySelectorAll('#c p span')], a = sp.find((x) => x.textContent === '[저장]'), b = sp.find((x) => x.textContent === '을');
        return Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2 && (parseFloat(a.style.letterSpacing) || 0) === (parseFloat(b.style.letterSpacing) || 0);
    });
    ok(together, '「[저장]」과 「을」이 같은 줄·같은 간격');
    ok(await onFirstLine('을'), '첫 줄로 함께 올라옴');

    console.log('── ⑤ 숨은 칸은 보이게 되면 맞춘다 ──');
    // 앞 시험이 등록해 둔 칸을 다시 쓰면 폭을 바꾸는 순간 관찰기가 먼저 맞춰 버린다 → 숨긴 새 칸(복제)으로 시험한다
    await setup(1.6, '바다날씨예보');
    const hiddenSpans = await page.evaluate(() => {
        // 얕은 복제(폭만) + 글은 새로 — 깊은 복제는 이미 맞춰진 조각까지 베낄 수 있다
        const c = document.getElementById('c'), n = c.cloneNode(false), p = document.createElement('p');
        p.textContent = c.querySelector('p').textContent; n.appendChild(p);
        n.style.display = 'none'; c.replaceWith(n);
        textFit(n, 'p, li, h2, h3, blockquote');
        return n.querySelectorAll('p span').length;
    });
    await page.evaluate(() => { document.getElementById('c').style.display = ''; });
    let shown = false;
    for (let t = 0; t < 20 && !shown; t++) { await page.waitForTimeout(50); shown = await page.evaluate(() => document.querySelectorAll('#c p span').length > 0); }
    ok(hiddenSpans === 0 && shown && await onFirstLine('바다날씨예보'), '숨어 있을 때는 손대지 않고, 보이자 맞춤');

    console.log('── ⑥ 해상 기상 전망: 기호를 떼어 두고 둘째 줄은 글자 시작점 ──');
    const fc = await page.evaluate(() => {
        // 두 줄에 걸친 조각 중, 줄이 바뀐 자리가 한글 글자 사이인 것(문장부호·괄호 자리는 허용 — 띄어쓰기 없이 긴 묶음)
        function badSplits(list) {
            const bad = [];
            list.forEach((sp) => {
                if (sp.getClientRects().length < 2) return;
                const t = sp.firstChild, r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); const top0 = r.getClientRects()[0].top;
                for (let i = 1; i < t.nodeValue.length; i++) {
                    r.setStart(t, i); r.setEnd(t, i + 1);
                    if (Math.abs(r.getClientRects()[0].top - top0) > 2) { if (/[가-힣]/.test(t.nodeValue[i - 1]) && /[가-힣]/.test(t.nodeValue[i])) bad.push(t.nodeValue); break; }
                }
            });
            return bad.join('|');
        }
        const el = document.getElementById('fc');
        el.innerHTML = '<div class="regional-forecast-summary">' +
            '<div class="regional-forecast-line">&lt;특보 현황&gt;</div>' +
            hangHtml('○ 풍랑주의보: 남해서부서쪽먼바다, 제주도앞바다(제주도남부앞바다, 남동연안바다 제외)(해제 예고: 21일 오전(09~12시))', 'regional-forecast-line regional-forecast-day') +
            hangHtml('- 한편, 북서쪽에서 찬 공기가 남하하면서 기온이 차차 낮아지겠습니다', 'regional-forecast-line regional-forecast-sub') + '</div>';
        textFit(el.firstChild, '.regional-forecast-line:not(.tf-hang), .tf-text');
        const day = el.querySelector('.regional-forecast-day'), t = day.querySelector('.tf-text'), m = day.querySelector('.tf-mark');
        const rs = [...t.getClientRects()], spans = [...t.querySelectorAll('span')];
        const lefts = [...new Set(spans.map((x) => Math.round(x.getClientRects()[0].left)))].sort((p, q) => p - q);
        return { mark: m.textContent, hdr: el.querySelector('.regional-forecast-line').classList.contains('tf-hang'), lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)),
            minLeft: lefts[0], textLeft: Math.round(t.getBoundingClientRect().left), markRight: Math.round(m.getBoundingClientRect().right), subMark: el.querySelector('.regional-forecast-sub .tf-mark').textContent,
            split: badSplits(spans) };
    });
    ok(fc.mark === '○' && fc.subMark === '-', '○ · - 기호를 원문 그대로 따로 둠');
    ok(!fc.hdr, '꺾쇠 제목(<특보 현황>)은 기호 없이 그대로');
    ok(fc.lines >= 2 && fc.minLeft >= fc.textLeft && fc.textLeft > fc.markRight, '두 줄 이상일 때 모든 줄이 기호 오른쪽(글자 시작점)에서 시작', JSON.stringify(fc));
    ok(fc.split === '', '한글 글자 사이에서 안 끊김(괄호 등 문장부호 자리만 허용)', fc.split);

    console.log('── ⑦ 안내 팝업: 아이콘 문단 둘째 줄은 글자 시작점 · 제목 문단 ──');
    const info = await page.evaluate(() => {
        const el = document.getElementById('info');
        el.innerHTML = '<div class="ocean-info-panel active" style="display:block;font-size:14px;line-height:1.65"><p><strong>1. 목적</strong></p>' +
            '<p><i style="display:inline-block">✔</i> 누르면 지금 내 위치로 지도를 옮기고, 그 자리를 <strong>파란 점</strong>으로 표시합니다.</p></div>';
        textFitInfo(el);
        const ps = el.querySelectorAll('p'), p = ps[1];
        const spans = [...p.querySelectorAll('span')].filter((x) => !x.closest('i')), tops = [...new Set(spans.map((x) => Math.round(x.getClientRects()[0].top)))];
        const firstText = spans[0].getClientRects()[0].left, secondLine = spans.find((x) => Math.round(x.getClientRects()[0].top) === tops[1]);
        return { h: ps[0].classList.contains('tf-h'), ic: p.classList.contains('tf-ic'), lines: tops.length, firstText: Math.round(firstText), second: secondLine ? Math.round(secondLine.getClientRects()[0].left) : null };
    });
    ok(info.h && info.ic, '제목 문단 tf-h · 아이콘 문단 tf-ic');
    ok(info.lines >= 2 && Math.abs(info.second - info.firstText) <= 1, '둘째 줄이 첫 줄 글자 시작점과 같은 자리', JSON.stringify(info));

    await browser.close();
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
