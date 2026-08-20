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

const files = fs.readdirSync(AUDIT).filter(f => f.endsWith('.md') && f !== '_횡단.md');
const only = arg('--law');
const rows = [];
for (const f of files) {
  const slug = f.slice(0, -3);
  if (only && slug !== only) continue;
  const lines = fs.readFileSync(path.join(AUDIT, f), 'utf8').split('\n');
  const seen = new Map();
  let curRound = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^#{2,3}\s*R(\d{1,2})\b/.exec(line);
    if (h) curRound = Number(h[1]);
    if (!OPEN_RE.test(line)) continue;
    if (DONE_RE.test(line) && !KEEP_RE.test(line)) continue;
    if (line.length < 25) continue;                 // 표 구분선·머리글 같은 부스러기
    const k = keyOf(line);
    if (!k || seen.has(k)) { const p = seen.get(k); if (p) p.last = Math.max(p.last, roundOf(line) || curRound); continue; }
    const r = roundOf(line) || curRound;
    seen.set(k, { line, first: r, last: r, cat: classify(line) });
  }
  rows.push({ slug, items: [...seen.values()] });
}

rows.sort((a, b) => b.items.length - a.items.length);
const total = rows.reduce((s, r) => s + r.items.length, 0);
const byCat = {};
rows.forEach(r => r.items.forEach(i => { byCat[i.cat] = (byCat[i.cat] || 0) + 1; }));

console.log(`감사 파일 ${rows.length}개에서 뽑은 **미해소 thin·missing** : ${total.toLocaleString()}건\n`);
for (const c of ORDER) if (byCat[c]) console.log(`  ${String(byCat[c]).padStart(5)}  ${c.padEnd(16)} ${LABEL[c]}`);
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
    md += `> ⚠기계가 줄 단위로 골랐으므로 이미 고쳐졌는데 표기가 안 바뀐 것이 섞일 수 있다 —\n`;
    md += `>   고치기 전에 위키 현재 상태를 먼저 확인한다(그 확인 자체가 이 목록의 값을 올린다).\n\n`;
    for (const c of ORDER) {
      if (!g[c]) continue;
      md += `## ${c} (${g[c].length}건) — ${LABEL[c]}\n\n`;
      g[c].sort((a, b) => a.first - b.first);
      for (const i of g[c]) {
        const age = i.first ? `R${i.first}${i.last > i.first ? `~R${i.last}` : ''}` : '라운드미상';
        md += `- [ ] (${age}) ${i.line.replace(/\n/g, ' ')}\n`;
      }
      md += '\n';
    }
    fs.writeFileSync(path.join(OUT, `${r.slug}.md`), md);
  }
  console.log(`\n저장: ${path.relative(LEGAL, OUT)}/ (${rows.filter(r => r.items.length).length}개 파일)`);
}
