'use strict';
// ============================================================================
// [2026-08-18] 조문 본문 안 원문 이미지 — 마커 정리·참조 상한 회귀 테스트
//   실행: node local_server/scripts/test_article_images.js
//
//   ★무엇을 고정하나
//     원문(law.go.kr 수집본)에는 그림이 있던 자리에 두 가지 표기가 섞여 있다:
//       ⓐ `<img id="123">`            — 그림이 끼어 있던 자리(전 raw 860개)
//       ⓑ `【이미지판독 123】(원본이미지: _이미지/123.png)` — 우리가 그 그림을 받아둔 표시(328개)
//     예전에는 ⓐ를 **통째로 지워서**, 우리가 `_이미지/123.png` 를 갖고 있는데도 화면에서
//     그림이 흔적 없이 사라지는 자리가 85개(18개 파일) 있었다. 이제 둘 다 `【이미지 N】`
//     참조로 남기고, 짝으로 붙어 있는 것(325개)은 하나로 합친다.
//     그리고 그림이 많은 조에서 이미지가 별표·서식 판정 칸(MAX_REFS 12)을 다 먹지 않도록
//     이미지 상한을 따로 뒀다(실측 최다: 한 조에 18장).
//
//   ★실제 저장소 원문으로도 한 번 훑는다(T3) — 위 개수는 추정이 아니라 실측이라, 원문이
//     바뀌면 이 테스트가 먼저 알려준다. 다만 "정확히 몇 개"로 못 박지 않고 **줄어들지
//     않았는지**만 본다(수집이 늘어나는 건 정상이다).
//   ★시각 비의존 — 고정 문자열과 저장소 파일만 쓴다(CLAUDE.md 결정로그).
//
//   [연계] services/article_text.js(cleanBody·collectRefs) ·
//          client/js/ai-chat/ai_chat.js appendText(이 참조를 그 자리에 <img> 로 그린다) ·
//          scripts/refactor/verify_all.sh V5 SUITES(여기 등록돼 있어야 실제로 돌아간다)
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRV = path.join(__dirname, '..');
const A = require(path.join(SRV, 'services', 'article_text.js'));
const RAW = path.join(SRV, 'knowledge', 'legal', 'raw');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

// ── T1. cleanBody — 그림이 있던 자리를 참조로 남긴다 ─────────────────────────────
console.log('\n[T1] cleanBody — 그림 자리를 참조로 남긴다');
ok('T1-1 태그+판독 짝은 참조 하나로 합친다',
  A.cleanBody('… 있다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]…')
    === '… 있다.【이미지 9】\n[표]…');
ok('T1-2 닫는 태그가 없는 짝도 하나로',
  A.cleanBody('A<img id="9">\n【이미지판독 9】(원본이미지: _이미지/9.png)B') === 'A【이미지 9】B');
// ★이 줄이 예전에 사라지던 자리다(항만건설장비 고시 제18조 "다음 표에 따른 기준" = 그림)
ok('T1-3 ★판독 마커 없는 태그도 자리를 남긴다(예전엔 통째로 지웠다)',
  A.cleanBody('…적합하여야 한다.<img id="34018983"></img>② 제2항…')
    === '…적합하여야 한다.【이미지 34018983】② 제2항…');
ok('T1-4 판독 마커만 있어도 참조로',
  A.cleanBody('앞【이미지판독 77】(원본이미지: _이미지/77.png)뒤') === '앞【이미지 77】뒤');
ok('T1-5 가리킬 파일이 없는 외부 주소 태그는 그대로 걷어낸다',
  A.cleanBody('앞<img src="http://www.law.go.kr/x.jpg">뒤') === '앞뒤');
ok('T1-6 남는 img 태그가 없다',
  !/<\/?img\b/i.test(A.cleanBody('a<img id="1">b<img src="x">c</img>d')));
// 항 기호(①②)가 마커 바로 뒤에 와도 항 쪼개기가 어긋나면 안 된다(마커가 글자를 끼워 넣으므로)
const paras = A.splitParagraphs(A.cleanBody('① 앞항.<img id="5"></img>② 뒷항.'));
ok('T1-7 마커를 끼워도 항 쪼개기가 그대로다', paras.length === 2 && paras[1].mark === '②',
  JSON.stringify(paras.map(p => p.mark)));

// ── T2. collectRefs — 이미지와 별표·서식은 상한이 따로다 ─────────────────────────
console.log('\n[T2] collectRefs — 이미지 상한은 별표·서식과 따로');
const manyImgs = Array.from({ length: 18 }, (_, i) => '【이미지 ' + (100 + i) + '】').join(' ');
const mixed = manyImgs + ' 수수료는 별표 1과 같다. 신청은 별지 제3호서식에 따른다.';
const got = A.collectRefs(mixed);
const keys = got.map(r => r.key);
// ★이것이 상한을 나눈 이유다 — 같이 세면 이미지 12장이 판정 칸을 다 먹어 별표·서식이 밀렸다.
ok('T2-1 ★그림이 18장이어도 별표·서식이 밀리지 않는다',
  keys.indexOf('별표1') >= 0 && keys.indexOf('서식3') >= 0, keys.join(','));
ok('T2-2 그림 18장이 다 판정 대상에 들어간다',
  keys.filter(k => k.indexOf('이미지') === 0).length === 18);
const many별표 = Array.from({ length: 20 }, (_, i) => '별표 ' + (i + 1)).join(' ');
const bylOnly = A.collectRefs(many별표).map(r => r.key);
ok('T2-3 별표·서식 상한(12)은 그대로다', bylOnly.length === 12, bylOnly.length);
ok('T2-4 같은 번호는 한 번만 센다',
  A.collectRefs('【이미지 7】 어쩌고 【이미지 7】').length === 1);

// ── T3. 실제 저장소 원문 — 화면에 뜨는 그림 수가 줄지 않았나 ─────────────────────
console.log('\n[T3] 실제 raw 원문 훑기(실측 기준선)');
let shown = 0, dropped = 0, leftover = 0, files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_이미지') walk(p); continue; }
    if (!e.name.endsWith('.txt')) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!/<img id=|【이미지판독/.test(src)) continue;
    files++;
    const out = A.cleanBody(src);
    leftover += (out.match(/<img\b/gi) || []).length;
    const imgDir = path.join(dir, '_이미지');
    const have = fs.existsSync(imgDir) ? new Set(fs.readdirSync(imgDir)) : new Set();
    const nums = new Set([...out.matchAll(/【이미지\s*(\d+)】/g)].map(m => m[1]));
    for (const n of nums) (have.has(n + '.png') ? shown++ : dropped++);
  }
})(RAW);
console.log(`     (파일 ${files}개 · 화면에 뜨는 그림 ${shown}장 · 파일이 없어 지우는 자리 ${dropped}개)`);
// 기준선은 2026-08-18 실측(파일 193 · 뜨는 그림 409). 예전 동작(판독 마커만 인정)은 328장이었다.
ok('T3-1 ★화면에 뜨는 그림이 예전(328장)보다 늘었다', shown >= 409, shown);
ok('T3-2 원문에 img 태그 찌꺼기가 남지 않는다', leftover === 0, leftover);
ok('T3-3 마커가 있는 파일 수가 유지된다', files >= 193, files);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
