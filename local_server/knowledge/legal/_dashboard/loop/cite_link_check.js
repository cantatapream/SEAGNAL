#!/usr/bin/env node
/**
 * cite_link_check.js — **답변 속 조문 표기에 화면이 실제로 링크를 거나** (2026-09-26 신설, L-8b)
 *
 * [왜 있나] 나는 「「같은 법 제N조」는 법령명이 없어 **눌러도 원문이 안 열린다**」고 보고했다.
 *   근거는 **규약 7 의 설명문**이었고, **화면 코드를 한 번도 열어 보지 않았다.**
 *   이 자로 재 보니 틀렸다 — 화면 `citeHTML` 이 「같은 법」을 **앞에 밝힌 법으로 이어받는다**.
 *   실측: L-8 이 잡아 둔 답변 세 편(문항 15·2·11)에서 **링크 21건 · 포기 0**.
 *   ⇒ 규약·설계문서는 **의도**를 적은 글이고, 「지금 그렇게 돌고 있다」의 증거가 아니다(L-382 갈래⑦).
 *
 * [★정규식을 베끼지 않는다] 화면 파일에서 `NRYA_CITE_RE` **그 줄을 읽어** 쓴다.
 *   베껴 두면 그 사본이 곧 옛 규칙으로 굳는다(L-136 · 이 저장소에서 여러 번 당했다).
 *
 * [쓰는 법] node cite_link_check.js [문항번호…]      (기본 15 2 11)
 *   재료는 `_dashboard/l8_answer_quality_*.json` — L-8 이 잡아 둔 **실제 운영 답변**이다.
 * [연계] 등록표 `L-8b`·`L-8` · `loop/l8_answer_quality.js` · `client/js/ai-chat/ai_chat.js`
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'client/js/ai-chat/ai_chat.js'), 'utf8');
const m = src.match(/var NRYA_CITE_RE = (\/.*\/g);/);
if (!m) { console.error('정규식 줄을 못 찾았다'); process.exit(2); }
const RE = eval(m[1]);
const DASH = path.resolve(__dirname, '..');
const 최근 = fs.readdirSync(DASH).filter((f) => /^l8_answer_quality_.*\.json$/.test(f)).sort().pop();
if (!최근) { console.error('l8_answer_quality_*.json 이 없다 — 먼저 L-8 을 돌린다'); process.exit(2); }
console.log('재료:', 최근);
const 답 = JSON.parse(fs.readFileSync(path.join(DASH, 최근), 'utf8')).rows;
const 볼것 = process.argv.slice(2).map(Number).filter((x) => x > 0);
for (const no of (볼것.length ? 볼것 : [15, 2, 11])) {
  const r = 답.find(x => x.no === no);
  const s = String(r.answer || '');
  console.log(`\n=== 문항 ${no} ===`);
  RE.lastIndex = 0;
  let mm, cur = '', last = '', 링크 = 0, 포기 = 0, 보기 = [];
  while ((mm = RE.exec(s))) {
    if (mm[1] != null) { cur = mm[1]; last = mm[1]; continue; }          // ①「법령명」
    if (mm[2] != null) {                                                 // ②계층·가리키는 말
      const same = /같은\s*법|동\s*법/.test(mm[2]);
      const base = (same ? (last || cur) : (cur || last)).replace(/\s*(?:시행령|시행규칙)\s*$/, '');
      if (보기.length < 4) 보기.push(`②「${mm[2]}」 → 이어받은 법: ${base || '(없다 — 링크 포기)'}`);
      cur = base; continue;
    }
    if (mm[5] != null) { cur = ''; continue; }                           // ⑤문장 끝
    if (mm[3] != null || mm[4] != null) {                                // ③별표 ④조문
      if (cur) { 링크++; if (보기.length < 8) 보기.push(`  링크 O: ${(mm[3]||mm[4]).trim()} → ${cur}`); }
      else { 포기++; if (보기.length < 8) 보기.push(`  링크 X: ${(mm[3]||mm[4]).trim()} (어느 법인지 모른다)`); }
    }
  }
  console.log(`링크 걸린 조문 표기 ${링크} · 포기 ${포기}`);
  보기.forEach(x => console.log('  ', x));
}
