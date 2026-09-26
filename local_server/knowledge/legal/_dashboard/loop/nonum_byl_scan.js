#!/usr/bin/env node
/**
 * 3-67 ⓐ — **「원문에 번호가 없는데 우리 파일 이름은 번호를 달고 있는」 별표를 전수로 센다.**
 *
 * [왜 있나] 제공처 API 가 `별표번호: "0000"`(원문에 번호가 없다)을 주는 별표가 있다.
 *   `admrul_fill_annex.py` 가 그때 **`1` 을 지어내** 파일 이름에 박고 있었다(2026-09-26 고침).
 *   이미 만들어진 파일이 몇 개인지 **짐작하지 않고 세기 위한 자**다.
 *
 * [판정은 생산 함수가 한다] `article_text.bylDeclLine()` 으로 선언줄을 뽑고
 *   `parseBylDecl()` 로 번호를 판다 — 규칙을 여기 다시 적지 않는다(L-136).
 *
 * [★두 가지를 반드시 가른다] 2026-09-26 에 이 자가 두 번 틀렸다:
 *   ①「0건」 — 우리가 쓴 머리줄(`[문서이름] 별표1 — …`)을 원문 선언줄로 착각했다.
 *   ②「308건」 — `[별지 1]`·`[별지5]`·`[별지 제3-2호서식]` 처럼 **번호가 있는데 파서가
 *     못 판 것**을 섞어 세었다. 그래서 「괄호 안에 숫자가 **아예 없나**」로 가른다.
 *   → 참값 **107건**(2026-09-26 실측, 별표 파일 8,268개 전수).
 *
 * [따로 나오는 수] `파서가못판다` = 괄호에 숫자가 있는데 `parseBylDecl` 이 못 판 것(174건).
 *   이것은 3-67 이 아니라 **파서의 구멍**이다 — 수를 여기 남겨 다음 회차가 본다.
 *
 * 사용법: node nonum_byl_scan.js            (읽기만 한다 · 고치지 않는다)
 */
const fs = require('fs'), path = require('path');
const A = require(path.resolve(__dirname, '..', '..', '..', '..', 'services', 'article_text.js'));
const RAW = path.resolve(__dirname, '..', '..', 'raw');
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.txt$/.test(e.name) && /[\\/]별표[\\/]/.test(p)) out.push(p);
  }
  return out;
}
const 이름번호 = /_(별표|별지|서식)([0-9]+(?:의[0-9]+)?)\.txt$/;
const 이름0 = /_(별표|별지|서식)0\.txt$/;
const 진짜무번호 = [], 파서가못판다 = [], 이름은0 = [], 괄호가없다 = [];
for (const p of walk(RAW, [])) {
  const t = fs.readFileSync(p, 'utf8');
  const decl = A.bylDeclLine(t);
  if (!decl) continue;
  const d = A.parseBylDecl(decl);
  if (d && d.num) continue;                                  // 제대로 판 것
  const base = path.basename(p);
  if (이름0.test(base)) { 이름은0.push(base); continue; }
  const at = decl.search(/[[〔【]/);
  const inner = at >= 0 ? decl.slice(at) : '';
  const 숫자있나 = /[0-9]/.test(inner);
  const nm = 이름번호.exec(base);
  const rec = { 파일: base, 선언괄호: inner.slice(0, 40), 이름번호: nm ? nm[2] : '(없음)' };
  if (숫자있나) { 파서가못판다.push(rec); continue; }
  // ★괄호가 **아예 없는** 선언줄은 우리가 쓴 머리줄(`[문서이름] 별표1 — 별표 1 ~ 별표 4`)이
  //   잡힌 것이다(조례 linkOnly). 그 번호는 **제공처 목록에서 온 것**이라 지어낸 것이 아니다.
  if (!inner.trim()) { 괄호가없다.push(rec); continue; }
  if (nm) 진짜무번호.push(rec);                                // 원문에 번호 없음 + 이름은 번호를 달았다
}
console.log('이름이 이미 0:', 이름은0.length);
console.log('선언줄에 괄호가 없다(조례 linkOnly — 번호는 제공처 목록에서 왔다):', 괄호가없다.length);
console.log('★원문 괄호에 숫자가 아예 없는데 우리 이름은 번호를 달았다:', 진짜무번호.length);
for (const r of 진짜무번호) console.log('   ', r.파일, '| 선언괄호:', r.선언괄호, '| 이름이 주장하는 번호:', r.이름번호);
console.log('\n⚠따로 볼 것 — 괄호에 숫자가 있는데 parseBylDecl 이 번호를 못 판다:', 파서가못판다.length);
const 꼴 = {};
for (const r of 파서가못판다) { const k = r.선언괄호.replace(/[0-9]+/g, 'N').slice(0, 24); 꼴[k] = (꼴[k] || 0) + 1; }
for (const k of Object.keys(꼴).sort((a, b) => 꼴[b] - 꼴[a]).slice(0, 12)) console.log('   ', 꼴[k], '건 ·', k);
const OUT = path.resolve(__dirname, '..', `nonum_byl_scan_${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(OUT,
  JSON.stringify({ 이름은0: 이름은0.length, 괄호가없다: 괄호가없다.length,
    지어낸번호: 진짜무번호.length, 파서가_못_판다: 파서가못판다.length,
    진짜무번호, 파서가못판다, 괄호가없다_목록: 괄호가없다 }, null, 1));
console.log('결과:', OUT);
