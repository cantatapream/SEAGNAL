'use strict';
// ============================================================================
// [게시글 유튜브 쇼츠 재생] 시험 — node scripts/test_promo_youtube_shorts.js
//   2026-11-19: 게시글 편집기 「동영상」(필름 모양) 버튼에 쇼츠 주소를 넣으면 Quill 1.3.6 이
//   주소를 그대로 넣어, 유튜브가 막아(x-frame-options: SAMEORIGIN) 빈 칸이 됐다.
//   promo.js promoYoutubeEmbedUrl 이 쇼츠 주소를 embed 주소로 바꾼다.
//   + 같은 날: 사슬 모양 「링크」 버튼이 글자를 선택하지 않으면 반응하지 않던 것 → 주소 팝업이 뜨게
//     (enablePromoLinkWithoutSelection · promoNormalizeLinkUrl).
//   실제 소스에서 함수를 꺼내 돌린다 — 브라우저·네트워크·시각 의존 없음.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'notice', 'board', 'promo.js'), 'utf8');
const grab = (n) => { const m = src.match(new RegExp('^function ' + n + '\\([\\s\\S]*?^}', 'm')); return m ? m[0] : null; };
const fn = grab('promoYoutubeEmbedUrl');
ok('promoYoutubeEmbedUrl 를 소스에서 찾았다', !!fn);
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn, ctx);
const E = 'https://www.youtube.com/embed/DEDfhpVVsJg?showinfo=0';

console.log('\n[쇼츠 → embed]');
[
    'https://www.youtube.com/shorts/DEDfhpVVsJg',
    'https://youtube.com/shorts/DEDfhpVVsJg?si=AbC123',      // 공유 버튼 주소(뒤에 ?si= 가 붙는다)
    'https://m.youtube.com/shorts/DEDfhpVVsJg',              // 폰 주소
    'youtube.com/shorts/DEDfhpVVsJg',                        // https 없이
    '  https://www.youtube.com/shorts/DEDfhpVVsJg  ',        // 앞뒤 공백
].forEach((u) => ok(JSON.stringify(u) + ' → embed', ctx.promoYoutubeEmbedUrl(u) === E, ctx.promoYoutubeEmbedUrl(u)));

console.log('\n[쇼츠가 아니면 그대로 — Quill 이 원래 하던 대로]');
[
    'https://www.youtube.com/embed/DEDfhpVVsJg?showinfo=0',  // watch·youtu.be 는 Quill 이 이미 이렇게 바꿔서 넘긴다
    'https://player.vimeo.com/video/76979871/',
    'https://example.com/shorts/DEDfhpVVsJg',                // 유튜브가 아닌 곳의 /shorts/
    'https://www.youtube.com/watch?v=DEDfhpVVsJg',
    '',
].forEach((u) => ok(JSON.stringify(u) + ' 그대로', ctx.promoYoutubeEmbedUrl(u) === u, ctx.promoYoutubeEmbedUrl(u)));

console.log('\n[연결]');
ok('Quill 을 만들기 직전에 registerPromoVideoFormat() 을 부른다', /registerPromoVideoFormat\(\);[^\n]*\n\s*promoQuillEditor = new Quill\(/.test(src));
ok('registerPromoVideoFormat 이 video 형식의 sanitize 를 promoYoutubeEmbedUrl 로 감싼다', /static sanitize\(url\) \{ return super\.sanitize\(promoYoutubeEmbedUrl\(url\)\); \}/.test(grab('registerPromoVideoFormat') || ''));
ok('편집기 툴바에 video 버튼이 있다', /\['link', 'image', 'video'\]/.test(src));

console.log('\n[링크 버튼 — 글자 선택 없이 눌러도 팝업] (2026-11-19)');
const fnN = grab('promoNormalizeLinkUrl');
ok('promoNormalizeLinkUrl 를 소스에서 찾았다', !!fnN);
vm.runInContext(fnN, ctx);
[[' naver.com ', 'https://naver.com'], ['https://a.kr/x', 'https://a.kr/x'], ['http://a.kr', 'http://a.kr'], ['mailto:a@b.kr', 'mailto:a@b.kr'],
 ['tel:0101234', 'tel:0101234'], ['', ''], ['   ', ''], ['www.youtube.com/watch?v=DEDfhpVVsJg', 'https://www.youtube.com/watch?v=DEDfhpVVsJg']]
    .forEach(([i, o]) => ok(JSON.stringify(i) + ' → ' + JSON.stringify(o), ctx.promoNormalizeLinkUrl(i) === o, ctx.promoNormalizeLinkUrl(i)));
// 선택 없이 → 팝업, 저장 때 링크 글자 삽입. 가짜 Quill 로 실제 함수를 돌린다.
const fnE = grab('enablePromoLinkWithoutSelection');
ok('enablePromoLinkWithoutSelection 를 소스에서 찾았다', !!fnE);
vm.runInContext(fnE, ctx);
function fakeQuill(sel) {
    const log = [];
    const handlers = { link(v) { log.push(['original', v]); } };
    const tooltip = { root: { attrs: {}, getAttribute(k) { return this.attrs[k]; } }, textbox: { value: '' },
        edit(mode, preview) { log.push(['edit', mode, preview]); this.root.attrs['data-mode'] = mode; },
        save() { log.push(['originalSave', this.textbox.value]); }, hide() { log.push(['hide']); } };
    const q = { theme: { tooltip }, getSelection: () => sel,
        getModule: () => ({ handlers, addHandler(n, f) { handlers[n] = f; } }),
        insertText: (...a) => log.push(['insertText', ...a]), setSelection: (...a) => log.push(['setSelection', ...a]) };
    return { q, log, tooltip, handlers };
}
let f = fakeQuill({ index: 3, length: 0 });
ctx.enablePromoLinkWithoutSelection(f.q);
f.handlers.link.call({}, true);
ok('선택 없이 누르면 주소 팝업(edit link)을 연다', JSON.stringify(f.log[0]) === JSON.stringify(['edit', 'link', '']), f.log);
f.tooltip.textbox.value = 'naver.com'; f.tooltip.save();
ok('저장하면 커서 자리에 주소를 링크 글자로 넣고 팝업을 닫는다', JSON.stringify(f.log.slice(1)) === JSON.stringify([['insertText', 3, 'https://naver.com', 'link', 'https://naver.com', 'user'], ['setSelection', 20, 0, 'user'], ['hide']]), f.log);
f.tooltip.textbox.value = 'x.kr'; f.tooltip.save();
ok('한 번 넣은 뒤의 저장(예: 동영상 팝업)은 원본 저장으로 간다', JSON.stringify(f.log.at(-1)) === JSON.stringify(['originalSave', 'x.kr']), f.log);
f = fakeQuill({ index: 3, length: 0 }); ctx.enablePromoLinkWithoutSelection(f.q);
f.handlers.link.call({}, true); f.tooltip.textbox.value = '  '; f.tooltip.save();
ok('빈 칸으로 저장하면 아무것도 넣지 않고 닫는다', !f.log.some(x => x[0] === 'insertText') && f.log.at(-1)[0] === 'hide', f.log);
f = fakeQuill({ index: 0, length: 4 }); ctx.enablePromoLinkWithoutSelection(f.q);
f.handlers.link.call({}, true);
ok('글자를 선택했으면 원본 동작(선택한 글자에 링크)', JSON.stringify(f.log) === JSON.stringify([['original', true]]), f.log);
f = fakeQuill({ index: 3, length: 0 }); ctx.enablePromoLinkWithoutSelection(f.q);
f.handlers.link.call({}, true); f.tooltip.linkRange = { index: 0, length: 2 }; f.tooltip.textbox.value = 'https://e.kr'; f.tooltip.save();
ok('기존 링크를 고칠 때(linkRange)는 원본 저장', f.log.at(-1)[0] === 'originalSave', f.log);
ok('편집기를 만든 뒤 enablePromoLinkWithoutSelection(promoQuillEditor) 를 부른다', /enablePromoLinkWithoutSelection\(promoQuillEditor\);/.test(src));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
