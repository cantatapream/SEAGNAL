/**
 * regrade.js — 저장해 둔 라이브 검증 결과를 **규칙으로 다시 채점**한다(AI 안 씀, 비용 0).
 *
 * [왜 있나] 2026-08-20. 7차 라이브 검증에서 정답률이 69.2% → 69.2%로 그대로였는데, 살아남 6건·
 * 깨짐 6건이 정확히 맞물렸다. 세 라운드(5·6·7차)를 대조해 보니 62문항 중 **26건(42%)이 한 번
 * 이상 판정이 뒤집혔고**, 그 사이 배포된 것은 채점 기준 정정 3건뿐이었다. 즉 이 측정으로는
 * **17%p 미만의 변화가 개선인지 우연인지 구분되지 않는다.**
 * 흔들림의 출처가 둘인데, 그중 하나는 **채점자**다 — 판정을 AI 에이전트가 답변을 읽고 내린다.
 * 같은 상황을 6차는 confirmed, 7차는 missing_evidence 로 봤다(수산자원관리법). 그 절반을
 * 없애려고, 사람도 기계도 같은 답을 내는 규칙으로 다시 채점한다.
 *
 * [무엇을 재나] 감사관이 적어 둔 기대 근거(`expected`)에서 **조문 표기만** 뽑아, 그 라운드의
 * 실제 인용 체인(`chain`)에 들어 있는지 글자로 대조한다.
 *   - full    : 기대 조문이 **전부** 체인에 있다
 *   - partial : 일부만 있다
 *   - none    : 하나도 없다
 *   - n/a     : 기대값에서 조문 표기를 뽑을 수 없다(서술형 기대값 — 규칙으로 못 잰다)
 *
 * ⚠⚠ **이 채점은 AI 판정을 대체하지 않는다.** 여기서 보는 것은 **근거 목록(citationChain)뿐**이고,
 *   답변 본문이 맞았는지는 보지 않는다. 라이브 검증에서 자주 나온 "본문은 맞는데 체인이 비었다"는
 *   여기서도 none 으로 잡히지만, 반대로 본문이 틀렸는데 체인만 맞은 경우는 full 로 잡힌다.
 *   그래서 이 값은 **"근거를 제대로 달았는가"** 의 지표이지 "답이 맞았는가"가 아니다.
 *   대신 **같은 입력에 언제나 같은 값**이 나와, 라운드끼리 대조할 때 흔들리지 않는다.
 *
 * [쓰는 법]  node regrade.js            → 5·6·7차를 같은 자로 재채점하고 나란히 비교
 *            node regrade.js --detail   → 라운드 사이에 판정이 바뀐 문항을 이름으로 찍는다
 *
 * [연계] ← pinned/live_r22_pass{5,6,7}.json(각 라운드가 남긴 법별 결과). ⚠읽기 전용.
 */
const fs = require('fs');
const R = require(require('path').resolve(__dirname, '../../../../services/legal_retriever.js'));
const DIR = path.resolve(__dirname, './pinned');
const ROUNDS = [5, 6, 7];

// 동그라미 숫자(①~⑳)는 위키·감사파일이 "항"을 적는 또 하나의 표기다 — 같은 뜻으로 펴 준다.
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function normalize(s) {
  let t = String(s || '');
  t = t.replace(new RegExp('[' + CIRCLED + ']', 'g'), c => '제' + (CIRCLED.indexOf(c) + 1) + '항');
  return t.replace(/\s+/g, '');
}
// 기대값 문장에서 **조문 표기만** 뽑는다. 서술은 버린다(지어내지 않는다 — 적혀 있는 것만).
const TOKEN_RE = /제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?|별표\s*\d+(?:의\d+)?|별지\s*제\s*\d+호(?:의\d+)?\s*서식|별지\s*제\s*\d+호/g;
function tokensOf(expected) {
  const flat = normalize(expected);
  const raw = flat.match(TOKEN_RE) || [];
  // 같은 조를 가리키는 표기가 여럿이면 **가장 좁게 짚은 것**만 남긴다(제15조 와 제15조제2항 → 뒤엣것).
  const out = [];
  for (const t of raw) {
    if (raw.some(o => o !== t && o.startsWith(t))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
// 체인에 그 조문이 있는가. 항·호까지 적힌 기대값은 **조까지만** 적힌 체인도 맞은 것으로 본다 —
// 위키 근거 표가 조까지만 짚는 경우가 흔해서, 항·호 불일치로 떨어뜨리면 실제보다 나쁘게 나온다.
function hit(token, chainFlat) {
  if (chainFlat.includes(token)) return true;
  const jo = /^제\d+조(?:의\d+)?/.exec(token);
  return !!(jo && token !== jo[0] && chainFlat.includes(jo[0]));
}
// ★인용 체인의 **묶음 표기를 챗봇과 같은 방식으로 펴서** 함께 본다(2026-08-20 검산에서 발견).
//   체인에 `별표2·5·6·8·9` 로 실린 것을 글자 그대로만 찾으면 별표5 를 못 봐서, 실제로는 맞은
//   문항을 오답으로 센다 — 연안관리법 수중조사 문항이 6·7차 모두 confirmed 이고 체인에도
//   별표5 가 들어 있는데 이 채점기만 none 으로 세고 있었다. 그 탓에 정답률이 과소평가되고
//   결손 목록에도 가짜가 섞였다. 챗봇이 쓰는 articleEnumTokens 를 그대로 불러 같은 눈으로 본다.
function chainText(rows) {
  const raw = (rows || []).join(' | ');
  const expanded = (rows || []).flatMap(r => R.articleEnumTokens(String(r || ''))).join(' ');
  return normalize(raw + ' ' + expanded);
}
function gradeRow(row) {
  const want = tokensOf(row.expected);
  if (!want.length) return { grade: 'n/a', got: 0, want: 0 };
  const chainFlat = chainText(row.chain);
  const got = want.filter(t => hit(t, chainFlat)).length;
  return { grade: got === want.length ? 'full' : (got ? 'partial' : 'none'), got, want: want.length };
}

const data = {}, graded = {};
for (const n of ROUNDS) {
  data[n] = JSON.parse(fs.readFileSync(DIR + `live_r22_pass${n}.json`, 'utf8'));
  graded[n] = new Map(data[n].map(r => [String(r.question || '').slice(0, 60), Object.assign({ law: r.law, ai: r.outcome }, gradeRow(r))]));
}

console.log('규칙 채점 — 기대 조문이 그 라운드의 인용 체인에 실렸는가 (AI 안 씀)');
console.log('─'.repeat(72));
console.log('라운드    full   partial   none    n/a     (full 비율은 n/a 뺀 값 기준)');
for (const n of ROUNDS) {
  const g = [...graded[n].values()];
  const c = k => g.filter(x => x.grade === k).length;
  const denom = g.length - c('n/a');
  console.log(`  ${n}차     ${String(c('full')).padStart(3)}     ${String(c('partial')).padStart(3)}    ${String(c('none')).padStart(3)}    ${String(c('n/a')).padStart(3)}      ${denom ? (c('full') / denom * 100).toFixed(1) + '%' : '-'}`);
}

// AI 판정과 얼마나 어긋나나 — 두 자가 무엇을 다르게 보는지 드러낸다.
console.log('\n─ AI 판정 대 규칙 채점 (7차) ─');
{
  const g = [...graded[7].values()].filter(x => x.grade !== 'n/a');
  const tab = {};
  for (const x of g) { const k = x.ai + ' / ' + x.grade; tab[k] = (tab[k] || 0) + 1; }
  Object.entries(tab).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(30)} ${v}`));
}

// 흔들림 비교 — 같은 문항이 라운드 사이에 판정을 바꾼 횟수.
const keys = [...graded[7].keys()].filter(k => graded[5].has(k) && graded[6].has(k));
const flipAI = keys.filter(k => !(graded[5].get(k).ai === graded[6].get(k).ai && graded[6].get(k).ai === graded[7].get(k).ai)).length;
const rk = keys.filter(k => ROUNDS.every(n => graded[n].get(k).grade !== 'n/a'));
const flipRule = rk.filter(k => !(graded[5].get(k).grade === graded[6].get(k).grade && graded[6].get(k).grade === graded[7].get(k).grade)).length;
console.log('\n─ 흔들림(5·6·7차 중 한 번이라도 판정이 바뀐 문항) ─');
console.log(`  AI 판정   ${flipAI} / ${keys.length}  (${(flipAI / keys.length * 100).toFixed(0)}%)`);
console.log(`  규칙 채점 ${flipRule} / ${rk.length}  (${(flipRule / rk.length * 100).toFixed(0)}%)`);

if (process.argv.includes('--detail')) {
  console.log('\n─ 규칙 채점이 라운드 사이에 바뀐 문항 ─');
  for (const k of rk) {
    const a = ROUNDS.map(n => graded[n].get(k).grade);
    if (a[0] === a[1] && a[1] === a[2]) continue;
    console.log(`  ${a.join(' → ').padEnd(26)} ${graded[7].get(k).law.slice(0, 24)} | ${k.slice(0, 40)}`);
  }
}
