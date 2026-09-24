/**
 * ============================================================================
 * 파일명: _dashboard/loop/promote_guard.js
 * 역할: **이번 가지(branch)에서 `draft` → `canonical` 로 올린 쪽**만 골라,
 *       `_SCHEMA.md` §5-D 의 승급 요건을 실제로 밟았는지 **기계로** 막는다.
 * ============================================================================
 *
 * [왜 있나 — C-3, 2026-09-20]
 * §5-D 는 승급 절차를 글로 정해 뒀지만 **지키는지 보는 장치가 없었다.** 그래서
 * 딱지만 떼면 틀린 수치가 "검토완료"로 둔갑한다. 실제로 났다 —
 * 「항만운송사업법__부두운영회사」의 배점표가 **어느 판과도 맞지 않는 수치**를 담은 채
 * ⓐ(=[미확인] 0줄)는 통과하는 상태였다(§5-D ⓑ-1). 2026-09-20 실측으로 **draft 152쪽 중
 * 136쪽이 [미확인] 0줄**이라, ⓐ 만 보고 일괄 승급하면 그런 쪽이 통째로 올라간다.
 *
 * [무엇을 보나 — 새로 canonical 이 된 쪽에 한정한다]
 * 이미 canonical 인 366쪽을 소급해서 보지 않는다. 그러면 첫날부터 수백 건이 떠서
 * 아무도 안 보게 된다(게이트가 죽는 흔한 길). **이번에 올린 것만** 본다.
 *
 * ⚠★**정정(2026-09-23, G-3) — 이 판단은 셋 중 하나에만 맞았다.**
 *   "수백 건이 뜬다"가 정말인지 오늘 전수로 재 봤다(canonical **1,112쪽** — 위 366 은 낡았다):
 *       ⓐ-1 가려지는 줄 0        →   **8쪽** (그것도 각 1줄)
 *       ⓐ-2 OCR·판독 신호        →   341쪽
 *       ⓑ  재점검 2회 기록       → **1,068쪽**   ← "수백 건"은 **여기** 이야기였다
 *   ⓑ 는 2026-09-20 에 만든 형식이라 그 전 쪽에 있을 리가 없다 — 소급하면 게이트가 죽는 게 맞다.
 *   그러나 **ⓐ-1 은 소급해도 8건뿐**이고, 지금은 **아무도 안 보고 있다.**
 *   → 아래 §소급 ⓐ-1 을 켠다. **기준선 8, 늘면 실패.** ⓐ-2·ⓑ 는 그대로 소급하지 않는다.
 *   ⓐ-1  `markUnresolvedReview()` 가 그 쪽에서 가리는 줄이 0개인가 (운영 함수를 그대로 부른다)
 *   ⓐ-2  판독ㆍOCRㆍ출처미확인 신호가 없는가
 *   ⓑ    숫자로 된 법적 효과가 있으면, 「변경 이력」에 **두 번의 재점검 기록**이 있는가
 *
 * [ⓑ 기록 형식 — 이 게이트가 읽을 수 있게 정한다(2026-09-20 신설)]
 * 승급한 쪽의 「변경 이력」에 **한 줄**로 아래 셋을 모두 담는다.
 *   ① `§5-D ⓑ` 라는 글자          ← 이 줄이 재점검 기록임을 밝힌다
 *   ② `1차` 와 `2차`               ← 서로 다른 두 번을 했음을 밝힌다
 *   ③ `raw/` 로 시작하는 경로       ← 무엇과 대조했는지 밝힌다(§5-D ⓒ ①)
 * 예) `| 2026-09-20 | §5-D ⓑ 재점검 — 1차 기계대조(grep, raw/05_수산어업/…/법률.txt 제40조)
 *      2차 다른 눈의 읽기(조ㆍ항ㆍ호 귀속 확인, 사서B). 승급. | … |`
 * ⚠기록줄에 `REVIEW` 라는 낱말을 쓰면 안 된다 — §5-D ⓒ 의 경고대로 그 줄이 통째로
 *   [미확인]으로 밀려난다. 이 게이트도 그것을 함께 잡는다.
 *
 * [쓰는 법]
 *   node _dashboard/loop/promote_guard.js            → 사람이 읽는 표
 *   node _dashboard/loop/promote_guard.js --gate     → 위반이 있으면 종료코드 1
 *   node _dashboard/loop/promote_guard.js --base <ref>  → 비교 기준을 직접 준다
 *   기본 기준: `origin/main` 과의 merge-base. 없으면 `HEAD`(=아직 커밋 안 한 변경만 본다).
 *
 * [한계 — 반드시 알고 쓸 것]
 * 이 게이트는 **"두 번 봤다고 적었는가"** 를 본다. **정말 두 번 봤는지는 못 본다.**
 * 거짓으로 적으면 통과한다. 그래도 두는 이유는, 지금은 **적는 자리조차 없어서**
 * 아무 기록 없이 딱지만 떼는 것이 가능하기 때문이다. 기록을 강제하면 최소한
 * **나중에 누가 무엇을 안 봤는지 추적할 수 있다**(§5-D ⓒ 와 같은 취지).
 *
 * [연계]
 * - services/legal_retriever.js → markUnresolvedReview (운영 코드 그대로 부른다, L-136)
 * - _SCHEMA.md §5-D — 이 게이트가 강제하는 규칙 본문
 * - scripts/refactor/verify_all.sh V5-13
 * [로드 순서] 번들 없음(점검 스크립트).
 * ============================================================================
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const MARK = '[미확인 — 아래는 사람 검토가 끝나지 않은 내용이다.';
const REPO = path.resolve(__dirname, '../../../../..');
const WIKI = 'local_server/knowledge/legal/wiki';

const argv = process.argv.slice(2);
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

/** ⓑ 대상 — 숫자로 된 법적 효과를 나타내는 표현(§5-D ⓑ "대상 낱말"). 애매하면 대상으로 본다. */
const NUM_WORDS = /징역|금고|벌금|과태료|과징금|몰수|추징|영업정지|정지일수|만원|억원|[0-9]\s*원\b|[0-9]\s*년|[0-9]\s*개?월|[0-9]\s*일|[0-9]\s*시간|이내|이상|이하|미만|초과|[0-9]\s*톤|[0-9]\s*미터|[0-9]\s*노트|킬로그램|퍼센트|[0-9]\s*%|분의/;
/** ⓐ-2 — 판독·OCR·출처미확인 신호 */
const OCR_WORDS = /이미지판독|OCR|판독 불가|출처미확인|원본이미지/;

function sh(cmd) { return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
/**
 * 파일 목록은 반드시 `-z`(NUL 구분)로 받는다.
 * ⚠git 은 한글처럼 ASCII 가 아닌 경로를 기본적으로 **큰따옴표로 감싸고 \352\260\257 꼴로 이스케이프**해
 *   돌려준다. 그대로 `endsWith('.md')` 로 거르면 **한 건도 안 걸려 조용히 0쪽이 된다**
 *   (2026-09-20 이 게이트를 만들며 실제로 겪었다 — 31쪽이 바뀌었는데 0쪽으로 나왔다).
 *   이 저장소는 위키 파일 이름이 전부 한글이라 이 함정이 **항상** 밟힌다.
 */
function shFiles(cmd) {
  // ⚠`-z` 는 **`--` 앞에** 와야 한다. 뒤에 붙이면 git 이 그것을 경로로 읽어 결과가 빈다
  //   (2026-09-20 여기서도 한 번 밟았다).
  return sh(cmd).split('\0').filter(Boolean);
}
function statusOf(text) { const m = /^---\n([\s\S]*?)\n---/.exec(text || ''); if (!m) return ''; const s = /^status:\s*(\S+)/m.exec(m[1]); return s ? s[1] : ''; }

function baseRef() {
  const given = argOf('--base');
  if (given) return given;
  for (const r of ['origin/main', 'origin/master']) {
    try { return sh(`git merge-base HEAD ${r}`).trim(); } catch (_) { /* 없으면 다음 */ }
  }
  return 'HEAD';
}

const BASE = baseRef();
let changed = [];
try {
  changed = shFiles(`git diff --name-only -z ${BASE} -- ${WIKI}`)
    .filter(f => f.endsWith('.md') && !f.endsWith('_backbone.md'));
} catch (e) {
  console.log('  ⏭️  git diff 를 못 했다(저장소가 아니거나 기준이 없다) — 건너뛴다:', e.message.slice(0, 60));
  process.exit(0);
}

const promoted = [];
for (const f of changed) {
  let before = '';
  // ★2026-09-24 — 경로를 **따옴표로 감싼다.** 종전엔 맨 경로를 셸에 넘겨서
  //   `선박평형수(船舶平衡水)관리법__…md` 처럼 **괄호가 든 이름**이 셸 문법으로 깨졌고,
  //   `catch` 가 그것을 **「새 파일」로 읽어** 이미 canonical 인 쪽을 「이번에 올린 쪽」으로 셌다
  //   (실측 3쪽 — 전부 main 에 이미 있던 쪽이다). 「없다」가 아니라 **「못 읽었다」였다.**
  try { before = sh(`git show ${BASE}:'${f.replace(/'/g, `'\\''`)}'`); } catch (_) { before = ''; }
  let now = '';
  try { now = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (_) { continue; }  // 지워진 파일
  const b = statusOf(before), n = statusOf(now);
  if (n === 'canonical' && b !== 'canonical') promoted.push({ f, before: b || '(새 파일)', now, b });
}

console.log(`기준 ${BASE.slice(0, 12)} 대비 위키 변경 ${changed.length}쪽 · 그중 canonical 로 올린 쪽 ${promoted.length}쪽`);

const bad = [];
for (const p of promoted) {
  const body = p.now.replace(/^---\n[\s\S]*?\n---\n/, '');
  const masked = R.markUnresolvedReview(body).split('\n').filter(l => l.includes(MARK)).length;
  const ocr = OCR_WORDS.test(body);
  const needsB = NUM_WORDS.test(body);
  // ⓑ 기록줄 — 「변경 이력」 어디든 한 줄에 셋이 다 있으면 된다
  const bLine = body.split('\n').find(l =>
    l.includes('§5-D') && /ⓑ/.test(l) && l.includes('1차') && l.includes('2차') && /raw\//.test(l));
  const bLineHasReview = bLine ? /REVIEW/.test(bLine) : false;

  const why = [];
  if (masked) why.push(`ⓐ-1 가려지는 줄 ${masked}개 (0이어야 한다)`);
  if (ocr) why.push('ⓐ-2 판독ㆍOCRㆍ출처미확인 신호가 있다 — 비전 재검증 경로로 보낼 것');
  if (needsB && !bLine) why.push('ⓑ 숫자로 된 법적 효과가 있는데 「변경 이력」에 재점검 기록줄이 없다 (`§5-D ⓑ` + `1차` + `2차` + `raw/경로` 한 줄)');
  if (bLineHasReview) why.push('ⓒ 재점검 기록줄에 `REVIEW` 라는 낱말이 있다 — 그 줄이 통째로 [미확인]으로 밀린다');
  if (why.length) bad.push({ f: p.f, before: p.before, why });
}

if (!promoted.length) {
  console.log('  ✅ 이번에 올린 쪽이 없다 — 볼 것 없음');
} else if (!bad.length) {
  console.log(`  ✅ 올린 ${promoted.length}쪽 모두 §5-D 요건을 적어 두었다`);
  promoted.forEach(p => console.log(`      · ${p.f.replace(WIKI + '/', '')}  (${p.before} → canonical)`));
} else {
  console.log(`  ❌ §5-D 요건을 못 갖춘 승급 ${bad.length}쪽`);
  for (const x of bad) {
    console.log(`\n      ${x.f.replace(WIKI + '/', '')}   (${x.before} → canonical)`);
    x.why.forEach(w => console.log(`        - ${w}`));
  }
  console.log('\n  고치는 법: 그 쪽을 draft 로 되돌리거나, §5-D ⓑ 의 두 번을 실제로 거친 뒤');
  console.log('            「변경 이력」에 기록줄을 남긴다(이 파일 머리말의 예시 참고).');
}

// ── ★소급 ⓐ-1 — 이미 canonical 인 쪽에서 **가려지는 줄이 생기지 않았나** (2026-09-23, G-3) ──
//   ⓐ-1 만 소급한다(까닭은 머리말). 운영 함수 `markUnresolvedReview()` 를 그대로 부른다(L-136).
//   ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).
const BASE_A1 = path.join(__dirname, 'baseline', 'promote_a1.json');
const allMd = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) w(q);
    else if (e.name.endsWith('.md')) allMd.push(q);
  }
})(WIKI);
const a1bad = [];
for (const f of allMd) {
  const t = fs.readFileSync(f, 'utf8');
  if (!/^status:\s*canonical/m.test(t)) continue;
  const body = t.replace(/^---\n[\s\S]*?\n---\n/, '');
  const n = R.markUnresolvedReview(body).split('\n').filter(l => l.includes(MARK)).length;
  if (n > 0) a1bad.push({ f: f.replace(WIKI + '/', ''), n });
}
if (argv.includes('--update-a1')) {
  fs.writeFileSync(BASE_A1, JSON.stringify({ '소급a1': a1bad.length }, null, 2) + '\n');
  console.log(`  [소급 ⓐ-1] 기준선을 다시 구웠다: ${a1bad.length}`);
} else {
  let baseA1 = null;
  try { baseA1 = JSON.parse(fs.readFileSync(BASE_A1, 'utf8')); } catch (_) {}
  console.log(`\n  [소급 ⓐ-1] 이미 canonical 인 쪽 중 **[미확인]으로 가려지는 줄이 있는** 쪽 ${a1bad.length}` +
              (baseA1 ? ` (기준선 ${baseA1['소급a1']})` : ' ⚠기준선 없음 — `--update-a1` 로 한 번 구워야 한다'));
  for (const x of a1bad.slice(0, 8)) console.log(`      · ${x.f}  (${x.n}줄)`);
  if (baseA1 && a1bad.length > baseA1['소급a1']) {
    console.log(`  ❌ [소급 ⓐ-1] 늘었다: ${baseA1['소급a1']} → ${a1bad.length}`);
    console.log('     → canonical 인 쪽에 [미확인] 줄이 새로 생겼다. 그 줄을 해소하거나 draft 로 되돌린다.');
    console.log('     ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).');
    if (argv.includes('--gate')) process.exit(1);
  } else if (baseA1 && a1bad.length < baseA1['소급a1']) {
    console.log(`  ✅ [소급 ⓐ-1] 줄었다: ${baseA1['소급a1']} → ${a1bad.length} — \`--update-a1\` 로 잠근다`);
  } else if (baseA1) {
    console.log('  ✅ [소급 ⓐ-1] 기준선 그대로 — 늘지 않았다');
  }
}

if (argv.includes('--gate') && bad.length) process.exit(1);
