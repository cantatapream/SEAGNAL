/**
 * backlog_triage.js — 백로그 "확인만" 패스. **18,794건 중 실제로 손댈 수 있는 게 몇 건인지**를 센다.
 *
 * [왜 있나 — 2026-08-21, R24_PLAN 갈래 B]
 * 백로그 총계(18,794)를 그대로 작업량으로 읽으면 24차가 영영 안 온다. 그런데 그 안에는
 * **고칠 수 없는 것**이 섞여 있다 — 법 자체에 규정이 없는 것(정직 표기가 최선)·판례/법리(스코프 밖)·
 * 사람 판단(REVIEW)·원문 미수집(재수집 대상). 절 제목으로 이미 갈린 것도 있지만 **12,840건이
 * `미분류`** 로 남아 있어 총계만 커 보인다.
 *
 * [무엇을 하나 — AI 안 쓴다. 항목 본문에 **이미 적혀 있는 말**만 읽는다]
 * 감사관·사서가 그 줄에 근거를 함께 적어 두었다("§6-A 스코프 밖", "⚠REVIEW … 임의 확정 불가",
 * "원문에도 불명", "규정이 없다"). 그 표지를 그대로 세어 갈래를 매긴다.
 *
 * ⚠**이건 판정이 아니라 분류 힌트다.** 표지가 없는 줄은 `미분류`로 그냥 둔다 — 억지로 가르면
 *   오늘 배운 실수를 반복한다(L-163: 검사가 무엇을 재는지 먼저 확인한다). 그래서 결과는
 *   "고칠 수 있는 것 N건"이 아니라 **"고칠 수 없다고 스스로 밝힌 것이 N건, 나머지가 작업 후보"** 다.
 *
 * [쓰는 법]  node backlog_triage.js [--examples] [--law <법이름>]
 * [연계] ← _dashboard/backlog/<법>.md   ⚠읽기 전용 — 파일을 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIR = path.resolve(HERE, '..', 'backlog');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

/**
 * 갈래 표지 — **위에서부터 먼저 맞는 것**을 쓴다(고칠 수 없다는 표지가 우선).
 * 표지 문구는 감사관·사서가 실제로 쓴 말에서 뽑았다(표본 확인 2026-08-21).
 */
const MARKS = [
  ['스코프밖',   /스코프\s*밖|§\s*6-A|판례|법리|유권해석|다툼의\s*여지/],
  ['사람판단',   /⚠?\s*REVIEW|사람\s*확인|임의\s*확정\s*불가|사서가\s*확정할\s*수\s*없/],
  ['원문공백',   /원문에도?\s*(불명|없|침묵)|원문\s*공백|입법\s*공백|규정이?\s*없다|조문이?\s*없다|확정할\s*수\s*없다|정하는\s*조문이\s*없/],
  ['미수집',     /collection_hole|미수집|재수집|수집\s*곤란|아직\s*수집/],
  ['위키반영',   /wiki_lag|위키(가|에)?\s*(미|안|반영\s*안|명시하지\s*않|다루지\s*않|미다룸)/],
];

function classify(text) {
  for (const [name, re] of MARKS) if (re.test(text)) return name;
  return '표지없음';
}

const rows = [];
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.md'))) {
  const law = f.slice(0, -3);
  if (arg('--law') && !law.includes(arg('--law'))) continue;
  let sec = null;
  for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    const m = /^##\s+(\S+)/.exec(line);
    if (m) { sec = m[1]; continue; }
    if (!line.startsWith('- [ ]')) continue;            // 미해소만
    const s = sec || '미분류';
    rows.push({ law, sec: s, cls: s === '미분류' ? classify(line) : s, line });
  }
}

const byCls = {};
for (const r of rows) byCls[r.cls] = (byCls[r.cls] || 0) + 1;
const FIXABLE = new Set(['위키반영', '표지없음']);
const fixable = rows.filter(r => FIXABLE.has(r.cls)).length;

console.log(`\n── 백로그 확인 패스 — 미해소 ${rows.length.toLocaleString()}건 ──\n`);
console.log(`  갈래                건수      뜻`);
const order = ['위키반영', '표지없음', '원문공백', '사람판단', '스코프밖', '미수집', 'wiki_lag', 'content_gap', 'REVIEW', '원문공백', '스코프경계', 'collection_hole'];
const seen = new Set();
const desc = {
  위키반영: '원문엔 있는데 위키에 안 옮김 → **고칠 수 있다**',
  표지없음: '갈래 표지가 없다 → 사서가 열어 봐야 안다(작업 후보)',
  원문공백: '법 자체에 규정이 없다 → 정직 표기가 최선(고칠 것 아님)',
  사람판단: 'AI가 단정하면 안 되는 것 → 사람 검수 큐',
  스코프밖: '판례·법리·다툼 → 챗봇이 답할 영역이 아님',
  미수집: '원문이 아직 없다 → 재수집 대상',
  wiki_lag: '(절 제목으로 이미 갈린 것) 고칠 수 있다',
  content_gap: '(절 제목) 원문 공백',
  REVIEW: '(절 제목) 사람 판단',
  스코프경계: '(절 제목) 스코프 밖',
  collection_hole: '(절 제목) 재수집 대상',
};
for (const k of order) {
  if (seen.has(k) || !byCls[k]) continue; seen.add(k);
  console.log(`  ${k.padEnd(16)} ${String(byCls[k]).padStart(7).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}   ${desc[k] || ''}`);
}
for (const [k, v] of Object.entries(byCls)) if (!seen.has(k)) console.log(`  ${k.padEnd(16)} ${String(v).padStart(7)}   ${desc[k] || ''}`);

const cant = rows.length - fixable;
console.log(`\n  ─────────────────────────────────────────────`);
console.log(`  고칠 수 없다고 스스로 밝힌 것   ${String(cant).padStart(7).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}   (${(cant * 100 / rows.length).toFixed(1)}%)`);
console.log(`  ★작업 후보                     ${String(fixable).padStart(7).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}   (${(fixable * 100 / rows.length).toFixed(1)}%)`);

const byLaw = {};
for (const r of rows) if (FIXABLE.has(r.cls)) byLaw[r.law] = (byLaw[r.law] || 0) + 1;
const top = Object.entries(byLaw).sort((a, b) => b[1] - a[1]);
console.log(`\n  작업 후보가 많은 법 12개 (전체 ${top.length}법)`);
for (const [law, n] of top.slice(0, 12)) console.log(`    ${String(n).padStart(5)}건  ${law.slice(0, 44)}`);

if (argv.includes('--examples')) {
  console.log(`\n  '표지없음' 표본 6개 — 사서가 열어 봐야 하는 것들`);
  for (const r of rows.filter(x => x.cls === '표지없음').slice(0, 6)) {
    console.log(`\n  ■ ${r.law.slice(0, 30)}\n    ${r.line.slice(0, 240)}`);
  }
}
