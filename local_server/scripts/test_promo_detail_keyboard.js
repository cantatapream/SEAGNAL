'use strict';
// ============================================================================
// [게시글 상세 창 — 키보드 대응] 시험 — node scripts/test_promo_detail_keyboard.js
//   2026-11-19 사용자 지적: 게시글 상세에서 댓글 입력창을 누르면 머리(제목)가 위로 밀려 올라가고 본문이
//   휴대폰 상태표시줄 밑까지 넘어갔다. 키보드가 뜨면 「보이는 화면」(visualViewport)만 줄고 전체 화면 크기는
//   그대로라, 전체 화면 기준으로 놓인 창이 키보드 뒤로 들어가고 브라우저가 입력창을 보이려고 화면을 밀었다.
//   고침: promo.js fitPromoDetailToViewport 가 바깥 칸을 보이는 화면에 맞추고(AI 챗봇 채팅 ai_chat.js fitChat 과
//   같은 방식), style.css 가 창 높이를 vh 대신 바깥 칸 기준으로 잡는다.
//   실제 소스의 세 함수를 가짜 화면(visualViewport·DOM)으로 돌린다 — 브라우저·시각 의존 없음.
//   (실제 Chromium 으로 index2.html 전체를 띄우는 모양 시험은 test_promo_detail_ui.)
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const client = path.join(__dirname, '..', '..', 'client');
const src = fs.readFileSync(path.join(client, 'js', 'notice', 'board', 'promo.js'), 'utf8');
const css = fs.readFileSync(path.join(client, 'style.css'), 'utf8');
const grab = (n) => { const m = src.match(new RegExp('^function ' + n + '\\([\\s\\S]*?^}', 'm')); return m ? m[0] : null; };
const names = ['fitPromoDetailToViewport', 'bindPromoDetailKeyboardFit', 'unbindPromoDetailKeyboardFit'];
ok('세 함수를 소스에서 찾았다', names.every(grab));

/** 가짜 화면: 높이 915 의 폰, visualViewport 는 이벤트를 받는 객체. */
function screen(withVV) {
    const listeners = {};
    const vv = { offsetTop: 0, height: 915,
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
        fire(t) { (listeners[t] || []).slice().forEach(f => f()); } };
    const cls = new Set();
    const modal = { style: { top: '', height: '' }, classList: { toggle(c, on) { on ? cls.add(c) : cls.delete(c); }, remove(c) { cls.delete(c); }, contains: (c) => cls.has(c) } };
    const ctx = { window: { innerHeight: 915, visualViewport: withVV ? vv : undefined }, document: { getElementById: (id) => (id === 'promo-detail-modal' ? modal : null) } };
    vm.createContext(ctx);
    vm.runInContext(names.map(grab).join('\n'), ctx);
    return { ctx, vv, modal, listeners, kb: () => cls.has('promo-kb-open') };
}

console.log('\n[열기·키보드·닫기]');
let s = screen(true);
s.ctx.bindPromoDetailKeyboardFit();
ok('열면 바깥 칸을 보이는 화면에 맞춘다(키보드 없음 = 화면 전체)', s.modal.style.top === '0px' && s.modal.style.height === '915px' && !s.kb(), s.modal.style);
s.ctx.bindPromoDetailKeyboardFit();
ok('두 번 불러도 한 번만 건다', (s.listeners.resize || []).length === 1 && (s.listeners.scroll || []).length === 1);
s.vv.offsetTop = 330; s.vv.height = 520; s.vv.fire('resize');
ok('키보드가 뜨면 보이는 화면(위치 330·높이 520)에 맞추고 키보드 표시를 켠다', s.modal.style.top === '330px' && s.modal.style.height === '520px' && s.kb(), s.modal.style);
s.vv.offsetTop = 0; s.vv.fire('scroll');
ok('보이는 화면이 위로 움직이면(scroll) 따라간다', s.modal.style.top === '0px' && s.modal.style.height === '520px');
s.vv.height = 860; s.vv.fire('resize');
ok('작은 차이(55px — 주소창 등)는 키보드로 보지 않는다', !s.kb());
s.vv.height = 915; s.vv.fire('resize');
ok('키보드가 내려가면 원래대로', s.modal.style.height === '915px' && !s.kb());
s.vv.height = 520; s.vv.fire('resize');
s.ctx.unbindPromoDetailKeyboardFit();
ok('닫으면 위치·높이·키보드 표시를 지우고(style.css 의 .modal 로 돌아감) 귀 기울이기를 끈다', s.modal.style.top === '' && s.modal.style.height === '' && !s.kb() && (s.listeners.resize || []).length === 0 && (s.listeners.scroll || []).length === 0);
s.vv.offsetTop = 100; s.vv.fire('resize');
ok('닫은 뒤 키보드가 움직여도 건드리지 않는다', s.modal.style.top === '');
s.ctx.bindPromoDetailKeyboardFit();
ok('다시 열면 다시 건다', (s.listeners.resize || []).length === 1 && s.modal.style.top === '100px');

s = screen(false);
s.ctx.bindPromoDetailKeyboardFit(); s.ctx.unbindPromoDetailKeyboardFit();
ok('visualViewport 가 없는 옛 브라우저: 아무것도 바꾸지 않는다(종전 동작)', s.modal.style.top === '' && s.modal.style.height === '');

console.log('\n[연결·모양]');
ok('openPromoDetail: 창을 보인 직후 bindPromoDetailKeyboardFit()', /modal\.classList\.remove\('hidden'\);\s*\n\s*bindPromoDetailKeyboardFit\(\);/.test(src));
ok('closePromoDetail: unbindPromoDetailKeyboardFit()', /window\.closePromoDetail = function \(\) \{\s*const modal = document\.getElementById\('promo-detail-modal'\);\s*unbindPromoDetailKeyboardFit\(\);/.test(src));
const block = (css.match(/#promo-detail-modal \{[^}]*\}/) || [''])[0];
ok('폰: 위 여백은 상태표시줄(safe-area) 이상, 기본 위아래 40px', /padding: max\(40px, env\(safe-area-inset-top, 0px\)\) 0 40px;/.test(block), block);
ok('폰: 창 높이는 vh 가 아니라 바깥 칸 기준(max-height:100%)', /#promo-detail-modal \.promo-modal-content \{ max-height: 100%; \}/.test(css));
ok('폰: 키보드가 떠 있으면 아래 여백 6px(댓글 입력이 키보드 바로 위)', /#promo-detail-modal\.promo-kb-open \{ padding-bottom: 6px; \}/.test(css));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
