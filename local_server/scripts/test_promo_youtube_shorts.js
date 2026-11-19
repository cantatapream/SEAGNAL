'use strict';
// ============================================================================
// [게시글 유튜브 쇼츠 재생] 시험 — node scripts/test_promo_youtube_shorts.js
//   2026-11-19: 게시글 편집기 「동영상」(필름 모양) 버튼에 쇼츠 주소를 넣으면 Quill 1.3.6 이
//   주소를 그대로 넣어, 유튜브가 막아(x-frame-options: SAMEORIGIN) 빈 칸이 됐다.
//   promo.js promoYoutubeEmbedUrl 이 쇼츠 주소를 embed 주소로 바꾼다.
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

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
