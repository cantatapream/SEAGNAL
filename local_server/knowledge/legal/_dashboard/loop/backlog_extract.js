/**
 * backlog_extract.js — 감사 파일에서 **아직 안 고쳐진 thin·missing 만** 뽑아 법별 백로그 파일로 분리한다.
 * AI 를 부르지 않는다(비용 0).
 *
 * [왜 있나 — H-43]
 * 감사는 매 라운드 결함을 찾는데 옛 항목은 계속 밀린다. 범위에서 빠진 것이 아니라 **감사 파일이
 * 너무 커서**다 — `_dashboard/audit/` 전체 28만 줄, 큰 파일은 한 법에 6,000줄이 넘는다(선원법
 * 6,314 · 해상교통안전법 6,277). 통합수정 사서가 그걸 다 읽고 옛 항목까지 되짚기는 현실적으로
 * 어려워, 매 라운드 최신 구간만 처리되고 백로그는 쌓인다("다음 통합수정 우선순위 재상신 9회째").
 * 그래서 **고칠 것만 든 짧은 목록**을 따로 만들어 준다.
 *
 * [어떻게 고르나]
 * `⚠thin`·`❌missing` 이 적힌 줄 중, 같은 줄에 **해소 표시**(✅·해소·해결·완료·full 전환 등)가
 * 없는 것만 남긴다. 법마다 표 형식이 제각각이라 컬럼을 파싱하지 않고 **줄 단위**로 본다 —
 * 정확도를 위해 애매한 것은 버리지 말고 `미분류`로 남겨 사람(사서)이 판단하게 한다.
 *
 * [분류] 줄에 이미 붙어 있는 꼬리표로 가른다:
 *   wiki_lag(원문엔 있는데 위키 미반영, **고칠 수 있음**) / content_gap(원문 자체 공백) /
 *   REVIEW(사람 판단) / collection_hole(수집) / 미분류
 *
 * [쓰는 법]
 *   node backlog_extract.js               → 법별 건수만 요약
 *   node backlog_extract.js --write       → `_dashboard/backlog/<법>.md` 생성
 *   node backlog_extract.js --law <이름>   → 한 법만
 *
 * [연계] ← _dashboard/audit/<법>.md(읽기 전용) · → _dashboard/backlog/<법>.md
 *        ⚠감사 파일을 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const AUDIT = path.join(LEGAL, '_dashboard', 'audit');
const OUT = path.join(LEGAL, '_dashboard', 'backlog');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

// 판정 표기(법마다 이모지 유무가 달라 둘 다 받는다)
const OPEN_RE = /⚠\s*thin|❌\s*missing|\bstill_missing\b/;
// 같은 줄에 이것이 있으면 **이미 끝난 것**으로 본다.
const DONE_RE = /✅|해소|해결(?!\s*안)|완료|full\s*(?:로)?\s*(?:전환|재평가|승격|확인)|→\s*✅|더 이상|제거|종료/;
// 애매하게 "유지"라고만 적힌 것은 열린 항목이다(해소가 아니다).
const KEEP_RE = /유지|불변|무변경|이월|잔존|연속|여전히|carry/;
// ★부정형 먼저 지운다(2026-08-20 — 진짜 미해소 516건이 통째로 사라지고 있었다).
//   `미해결`·`미해소` 안에 `해결`·`해소` 가 들어 있어 DONE_RE 가 그대로 물었다. 그러면
//   "여전히 미해결"이라고 적힌 줄이 **해소된 것으로 판정돼 목록에서 빠진다** — 빠진 것은
//   눈에 안 보이므로 이 오류는 스스로 드러나지 않는다. 대조 전에 부정형을 지워 버린다.
const NEG_DONE_RE = /미\s*해소|미\s*해결|미\s*완료|미\s*처리|해소되지\s*않|해결되지\s*않|해소\s*안\s*됨|해결\s*안\s*됨/g;
/**
 * 이 줄이 "끝난 항목"이라고 말하고 있나.
 * ⓐ 부정형(`미해결`)을 지운 뒤에 해소 표기가 남아야 한다.
 * ⓑ `유지`·`불변`·`연속` 같은 말이 있으면 보통 열린 항목이다. **다만 `✅` 가 그 말보다
 *    뒤에 오면 해소가 맞다** — `| E121 | … | ❌missing(3라운드 연속) | **✅full** |` 처럼
 *    앞 칸이 과거 이력을 적고 뒤 칸이 이번 판정을 적는 표가 흔하다. 이 경우를 못 걸러
 *    이미 ✅full 로 뒤집힌 항목 143건이 미해소로 남아 있었다(사서 보고 → 확인).
 */
function isClosed(line) {
  if (!DONE_RE.test(line.replace(NEG_DONE_RE, ''))) return false;
  if (!KEEP_RE.test(line)) return true;
  const tick = line.lastIndexOf('\u2705');
  if (tick < 0) return false;
  let lastKeep = -1, m;
  const re = new RegExp(KEEP_RE.source, 'g');
  while ((m = re.exec(line)) !== null) lastKeep = m.index + m[0].length;
  return tick > lastKeep;
}

function classify(line) {
  // 꼬리표가 붙어 있으면 그대로 쓴다.
  if (/wiki_lag/.test(line)) return 'wiki_lag';
  if (/content_gap/.test(line)) return 'content_gap';
  if (/collection_hole|uncollected|structural|genuine/.test(line)) return 'collection_hole';
  if (/\bREVIEW\b/.test(line)) return 'REVIEW';
  // 꼬리표가 없는 요약 행(법마다 형식이 달라 대부분 여기 온다) — 적힌 말로 가른다.
  if (/스코프|소관\s*(?:이\s*)?아님|범위\s*밖|타법\s*소관|세법|판례|법리\s*해석/.test(line)) return '스코프경계';
  if (/원문에\s*(?:는\s*)?없|규정\s*(?:자체\s*)?없|명문\s*(?:규정\s*)?없|입법\s*공백|조문\s*(?:자체\s*)?없|미제정/.test(line)) return '원문공백';
  return '미분류';
}
const LABEL = {
  wiki_lag: '원문엔 있는데 위키에 안 옮김 — **고칠 수 있음**',
  content_gap: '원문 자체에 규정 없음 — 정직 표기가 최선',
  collection_hole: '수집 관련 — 조회 기록 확인 필요(§6-B-1 ⓑ)',
  REVIEW: '사람 판단 필요',
  스코프경계: '이 법 소관이 아님 — 안내 문구가 닿는 자리에 있는지만 본다(§6-B-1 ⓐ)',
  원문공백: '원문 자체에 규정 없음(요약 행 표현으로 판정) — 조회 기록 확인 후 확정 공백으로',
  미분류: '사서가 유형을 갈라야 함',
};
const ORDER = ['wiki_lag', '미분류', 'collection_hole', '원문공백', 'content_gap', '스코프경계', 'REVIEW'];

/** 한 줄에서 라운드 표기(R23·23R·23라운드)를 찾아 숫자로. 없으면 0. */
function roundOf(line) {
  const m = /\bR(\d{1,2})\b|\b(\d{1,2})\s*R\b|(\d{1,2})\s*라운드/.exec(line);
  return m ? Number(m[1] || m[2] || m[3]) : 0;
}
/**
 * 중복 판정용 열쇠.
 * ⚠2026-08-20 실측 보정: 처음엔 줄 전체를 열쇠로 썼는데, **같은 항목이 라운드마다 표현만 조금
 *   바뀌어 다시 적히므로** 전부 다른 것으로 세어 38,566건이 나왔다 — 23차 감사 자체 집계
 *   (thin 5,409 + missing 5,366 = 10,775)의 3.6배다. 감사 요약 행은 대개
 *   `| 항목이름 | 출처 | ❌missing | 9회 | [[페이지]] |` 꼴이라 **첫 칸(항목 이름)** 이 그 항목의
 *   정체다. 표 행이면 첫 칸으로, 아니면 문장 앞머리로 잡는다.
 */
function keyOf(line) {
  let core = line;
  if (line.startsWith('|')) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // 첫 칸이 번호(#12·R13)뿐이면 그다음 칸이 항목 이름이다.
    core = (cells[0] && !/^[#R]?\d+$/.test(cells[0].replace(/[#\s]/g, ''))) ? cells[0] : (cells[1] || cells[0] || '');
  }
  return core.replace(/[|`*_#>\s]/g, '').replace(/[⚠❌✅📛]/g, '')
    .replace(/^\d+/, '').slice(0, 60);
}

/**
 * ★집계·헤더 줄 걸러내기(2026-08-20 신설 — 사서 두 명이 독립적으로 보고).
 * 감사 파일에는 `| ⚠ thin | 86 | 22R 회귀 | ` 같은 **판정별 총계 행**과 `### G19. still_missing (6문항)`
 * 같은 절 헤더, `**§1 소계(29건)**: …` 같은 소계 줄이 섞여 있다. 이 줄들에도 `⚠thin`·`❌missing` 이
 * 적혀 있어 그대로 항목으로 뽑히는데, **가리키는 페이지도 조문도 없어 사서가 대조할 수가 없다.**
 * 실측 260건(전체의 1.1%). 지우는 규칙은 **좁게** 잡는다 — 진짜 항목을 지우는 쪽이 훨씬 나쁘다:
 *   ⓐ 절 헤더(`###`로 시작)  ⓑ 앞머리에 소계·합계·총계·집계가 있고 숫자가 있는 줄
 *   ⓒ 표 행인데 **판정 낱말만 든 칸**이 있고, **그 칸 뒤에** 순수 숫자 칸이 오고,
 *      물음표가 없고, 어느 칸도 한글 12자를 넘지 않는 것(= 서술이 없다)
 * ⓒ의 "판정 칸 뒤"가 핵심이다. 진짜 항목 행은 `| 248 | 협회 회비는…? | ❌missing | … |` 처럼
 * 숫자(문항번호)가 판정 **앞**에 온다. 이 조건을 빼면 진짜 항목 5,000건이 함께 지워졌다(실측).
 */
const NUM_CELL = /^\**\s*(?:약\s*)?\d+(?:\([^)]*\))?\s*\**$/;
const VERDICT_CELL = /^\**\s*(?:⚠|❌)?\s*(?:thin|missing|still_missing)\s*(?:\([^)]*\))?\s*\**$/;
function isNoise(line) {
  if (/^#{2,6}\s/.test(line)) return true;
  if (/(소계|합계|총계|집계)/.test(line.slice(0, 40)) && /\d/.test(line)) return true;
  if (!line.startsWith('|')) return false;
  const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const vi = cells.findIndex(c => VERDICT_CELL.test(c));
  if (vi < 0) return false;
  if (!cells.slice(vi + 1).some(c => NUM_CELL.test(c))) return false;
  if (line.includes('?')) return false;
  return cells.every(c => (c.match(/[가-힣]/g) || []).length < 12);
}

const files = fs.readdirSync(AUDIT).filter(f => f.endsWith('.md') && f !== '_횡단.md');
const only = arg('--law');
const rows = [];
for (const f of files) {
  const slug = f.slice(0, -3);
  if (only && slug !== only) continue;
  const lines = fs.readFileSync(path.join(AUDIT, f), 'utf8').split('\n');
  // ★감사 파일은 **덧붙이는 기록**이다 — 옛 라운드 줄은 그대로 남고 나중 라운드가 그 아래에
  //   "해소 확인"을 적는다. 그래서 "같은 줄에 해소 표시가 있나"만 보면, **나중에 고쳐진 것도
  //   옛 줄 때문에 미해소로 잡힌다.** 그 항목의 **마지막 언급**이 무엇이라 말하는지로 판정한다
  //   (2026-08-20 실측 보정 — 이 보정 전에는 한 라운드 집계의 2.4배가 나왔다).
  const seen = new Map();
  let curRound = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^#{2,3}\s*R(\d{1,2})\b/.exec(line);
    if (h) curRound = Number(h[1]);
    if (line.length < 25) continue;                 // 표 구분선·머리글 같은 부스러기
    if (isNoise(line)) continue;                    // 집계 총계 행·절 헤더·소계 줄
    const opened = OPEN_RE.test(line);
    const closed = isClosed(line);
    if (!opened && !closed) continue;               // 이 항목 얘기가 아니다
    const k = keyOf(line);
    if (!k) continue;
    const r = roundOf(line) || curRound;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, { line, first: r, last: r, cat: classify(line), open: opened && !closed }); continue; }
    // 같은 항목의 더 나중 언급이면 상태를 갈아끼운다(같은 라운드면 뒤에 적힌 줄이 최신이다).
    if (r >= prev.last) {
      prev.last = r;
      prev.open = opened && !closed;
      if (prev.open) { prev.line = line; prev.cat = classify(line); }
    }
  }
  for (const [k, v] of seen) if (!v.open) seen.delete(k);
  rows.push({ slug, items: [...seen.values()] });
}

// ★위키 현재 상태와 대조한다(2026-08-20 신설 → 같은 날 **범위를 좁혀 다시 씀**).
//   처음 만든 규칙은 "항목이 짚은 조문 번호가 그 법 위키 어딘가에 있으면 `이미반영?`"이었다.
//   8,862건이 그리로 갔는데, **그중 1,353건은 감사관이 바로 그 줄에 "위키에 없음"이라고
//   적어 둔 항목**이었다 — 기계가 사람 관찰을 덮어썼다. 원인은 규칙이 너무 헐거운 것이다:
//   「제6조」는 어느 법 위키에도 나오므로 아무것도 가르지 못한다. 낱말 겹침(3글자 n-gram)으로
//   조여 봐도 마찬가지였다 — **감사 항목은 "무엇이 없는지"를 위키의 말로 적기 때문에**,
//   글자가 겹친다는 사실이 "이미 반영됐다"는 뜻이 되지 못한다. 그래서 그 갈래를 버린다.
//   "이미 고쳐졌나"는 기계가 못 정한다 — 사서가 위키를 읽고 판단할 일이다(파일 머리말에 그렇게 적었다).
//
//   대신 **반대 방향만** 남긴다. 이건 논리적으로 성립한다:
//     항목이 짚은 조문 번호가 그 법 위키에 **하나도 없으면**, 그 항목은 확실히 안 고쳐졌다.
//   이 표시는 버리는 데 쓰지 않고 **먼저 볼 것을 고르는 데**만 쓴다.
const WIKI = path.join(LEGAL, 'wiki');
const wikiCache = new Map();
function wikiTextOf(slug) {
  if (wikiCache.has(slug)) return wikiCache.get(slug);
  let t = '';
  for (const kind of ['concepts', 'statutes', 'annexes']) {
    const d = path.join(WIKI, kind);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f === slug + '.md' || f.startsWith(slug + '__')) t += fs.readFileSync(path.join(d, f), 'utf8');
    }
  }
  wikiCache.set(slug, t);
  return t;
}
const ART_RE = /제\s*\d+조(?:의\d+)?|별표\s*\d+(?:의\d+)?|별지\s*제\s*\d+호/g;
let certainlyOpen = 0;
for (const r of rows) {
  // ⚠**양쪽을 같은 방식으로 눌러서 비교한다**(2026-08-20 오탐으로 발견).
  //   항목 쪽 토큰만 공백을 지우고 위키 원문은 그대로 두면, 위키의 `별지 제10호서식` 이
  //   `별지제10호` 와 안 맞아 "위키에 없다"가 된다. 실제로 무인도서법 3건이 그렇게 잘못 찍혔다
  //   (본문에 토씨까지 그대로 있는데 마커가 붙었다). 정규화는 **비교하는 두 쪽 모두**에 건다.
  const text = wikiTextOf(r.slug).replace(/\s+/g, '');
  if (!text) continue;
  for (const it of r.items) {
    const arts = [...new Set((it.line.match(ART_RE) || []).map(a => a.replace(/\s+/g, '')))];
    if (!arts.length) continue;
    // ★`every` 다 — `some` 이 아니다. "확실히 미해소"라고 말할 수 있는 것은 짚은 조문이
    //   **하나도** 위키에 없을 때뿐이다. 하나만 빠져도 마커를 붙이면 그 단언이 성립하지 않는다.
    if (arts.every(a => !text.includes(a))) { it.absent = true; certainlyOpen++; }
  }
}

rows.sort((a, b) => b.items.length - a.items.length);
const total = rows.reduce((s, r) => s + r.items.length, 0);
const byCat = {};
rows.forEach(r => r.items.forEach(i => { byCat[i.cat] = (byCat[i.cat] || 0) + 1; }));

console.log(`감사 파일 ${rows.length}개에서 뽑은 **미해소 thin·missing** : ${total.toLocaleString()}건\n`);
for (const c of ORDER) if (byCat[c]) console.log(`  ${String(byCat[c]).padStart(5)}  ${c.padEnd(16)} ${LABEL[c]}`);
console.log(`\n  그중 ${certainlyOpen.toLocaleString()}건은 **짚은 조문이 그 법 위키에 아예 없다** = 확실히 미해소(먼저 볼 것).`);
console.log('\n건수 상위 12개 법:');
rows.slice(0, 12).forEach(r => {
  const lag = r.items.filter(i => i.cat === 'wiki_lag').length;
  console.log(`  ${String(r.items.length).padStart(4)}건 (그중 고칠 수 있음 ${String(lag).padStart(3)})  ${r.slug}`);
});

if (argv.includes('--write')) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const r of rows) {
    if (!r.items.length) continue;
    const g = {};
    r.items.forEach(i => { (g[i.cat] = g[i.cat] || []).push(i); });
    let md = `# ${r.slug} — 미해소 백로그 (기계 추출, ${r.items.length}건)\n\n`;
    md += '> `_dashboard/audit/' + r.slug + '.md` 에서 **해소 표시가 없는 `⚠thin`·`❌missing` 줄만** 뽑았다.\n';
    md += `> 감사 파일을 통독하지 말고 **이 목록만** 보고 고치면 된다(H-43).\n`;
    md += `> ⚠기계가 줄 단위로 골랐으므로 **이미 고쳐졌는데 표기만 안 바뀐 것이 섞여 있다.**\n`;
    md += `>   "이미 고쳐졌나"는 기계가 못 가른다(2026-08-20 시도했다 실패 — backlog_extract.js 주석 참조).\n`;
    md += `>   그러니 각 항목은 **위키 현재 상태를 먼저 확인**하고, 이미 해소됐으면 고치지 말고\n`;
    md += `>   \`- [x]\` 로 바꾸며 근거를 \`(확인: <파일>:<줄>)\` 로 적는다. 안 됐으면 그때 고친다.\n`;
    md += `>   \`⟨짚은 조문이 위키에 없음⟩\` 표시가 붙은 항목은 확인 없이도 미해소가 확실하다 — 먼저 본다.\n\n`;
    for (const c of ORDER) {
      if (!g[c]) continue;
      md += `## ${c} (${g[c].length}건) — ${LABEL[c]}\n\n`;
      g[c].sort((a, b) => a.first - b.first);
      for (const i of g[c]) {
        const age = i.first ? `R${i.first}${i.last > i.first ? `~R${i.last}` : ''}` : '라운드미상';
        const mark = i.absent ? ' ⟨짚은 조문이 위키에 없음 — 확실히 미해소⟩' : '';
        md += `- [ ] (${age}) ${i.line.replace(/\n/g, ' ')}${mark}\n`;
      }
      md += '\n';
    }
    fs.writeFileSync(path.join(OUT, `${r.slug}.md`), md);
  }
  console.log(`\n저장: ${path.relative(LEGAL, OUT)}/ (${rows.filter(r => r.items.length).length}개 파일)`);
}
