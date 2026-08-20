/**
 * xref_todo.js — `## 타법 연결` 표에는 있는데 `## 근거 조문` 표에는 없는 행을 뽑아
 * 법별 작업목록(`_dashboard/xref_todo/<법>.md`)으로 만든다. AI 를 부르지 않는다(비용 0).
 *
 * [왜 있나 — 결정 ①ⓐ(사용자 확정 2026-08-20)]
 * 챗봇은 개념 페이지의 `## 근거 조문` 표에서만 근거를 만든다(`_SCHEMA.md` §6-E).
 * `## 타법 연결` 표는 `extractGapNotices` 가 **관계 칸이 "수집곤란"인 행만** 따로 읽으므로
 * (`services/legal_retriever.js`), 나머지 행은 답변의 근거로 실릴 방법이 없다.
 * 실측: 타법 연결 표가 있는 개념 페이지 847개 · 조문을 명시한 행 3,766개 중 **3,581행(95%)** 이
 * 같은 페이지 근거 조문 표에 없다. 품질 4축으로 말하면 **④연결은 됐는데 ③도달이 안 되는 것**이다.
 *
 * [왜 옮겨도 답변이 지저분해지지 않나] 근거 조문 표의 행은 **답변이 그 법을 실제로 언급했을 때만**
 * 근거로 뜬다(`lawMentionedInAnswer`). 그러니 관련 없는 타법 행을 넣어도 그 답변에는 안 나온다.
 *
 * [쓰는 법]
 *   node xref_todo.js            → 법별 건수 요약
 *   node xref_todo.js --write    → `_dashboard/xref_todo/<법>.md` 생성
 *
 * [연계] ← wiki/concepts/*.md(읽기 전용) · → _dashboard/xref_todo/<법>.md
 *        ⚠위키를 고치지 않는다. 실제 수정은 법별 사서가 한다(xref_fix.js).
 */
const fs = require('fs');
const path = require('path');
const LEGAL = path.resolve(__dirname, '../..');
const CONCEPTS = path.join(LEGAL, 'wiki', 'concepts');
const OUT = path.join(LEGAL, '_dashboard', 'xref_todo');
const ART = /제\s*\d+조(?:의\d+)?|별표\s*\d+(?:의\d+)?|별지\s*제\s*\d+호/g;

/** 본문에서 `## <이름>` 절의 내용만 잘라낸다. 없으면 빈 문자열. */
function section(body, re) {
  // ⚠`(?=^##\s|$)` 로 잡으면 안 된다 — m 플래그에서 `$` 는 **줄 끝마다** 맞아 첫 줄에서 끊긴다
  //   (처음 그렇게 써서 0행이 나왔다). 절 단위로 쪼개서 고른다.
  const parts = body.split(/^##\s+/m);
  const head = new RegExp('^' + re);
  const hit = parts.find(p => head.test(p.trim()));
  return hit ? hit.slice(hit.indexOf('\n') + 1) : '';
}
/** 표 행만 고른다(구분선·머리글 제외). */
function tableRows(txt) {
  return txt.split('\n').map(l => l.trim()).filter(l =>
    l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l) && !/^\|\s*(법령명?|타법|관계)\s*\|/.test(l));
}

const files = fs.readdirSync(CONCEPTS).filter(f => f.endsWith('.md'));
const byLaw = new Map();
let rows = 0;
for (const f of files) {
  const slug = f.split('__')[0];
  const body = fs.readFileSync(path.join(CONCEPTS, f), 'utf8');
  const xref = section(body, '타법\\s*연결');
  if (!xref) continue;
  const cited = section(body, '근거\\s*조문').replace(/\s+/g, '');
  const todo = [];
  for (const line of tableRows(xref)) {
    if (line.includes('수집곤란')) continue;              // 이미 extractGapNotices 가 읽는다
    // ⚠셀을 `|` 로 쪼개기 전에 **위키 링크 안의 `|` 를 감춘다** — `[[슬러그|이름]]` 이 두 칸으로
    //   갈라져 법령 이름 자리에 슬러그가 들어갔다(첫 실행에서 `수산업법__어업정의허브` 로 나왔다).
    //   슬러그를 법령 칸에 적으면 그 자체가 §6-E 결함이 되므로 여기서 반드시 막는다.
    const SEP = '\u0000';
    const safe = line.replace(/\[\[[^\]]*\]\]/g, m => m.replace(/\|/g, SEP));
    const cells = safe.replace(/^\||\|$/g, '').split('|').map(c => c.split(SEP).join('|').trim());
    // ★★조문은 **첫 칸(법령·조문 칸)에서만** 뽑는다 — 줄 전체에서 뽑으면 안 된다.
    //   처음엔 `line.match(ART)` 로 줄 전체를 훑었는데, 요지 칸의 설명문에 적힌 **이 법 자기
    //   조문**('(제5조②)'·'이 법 제21조')까지 그 타법의 조문인 것처럼 딸려 들어갔다.
    //   사서 네 명이 서로 다른 법에서 같은 오류를 독립적으로 잡아냈다(2026-08-20):
    //   「국가배상법 제2조·제5조」의 제5조는 실은 해양경비법 시행령 제5조였고,
    //   「생물다양성법 제11조·제22조」의 제22조는 실은 해양수산생명자원법 자기 조문이었다.
    const head = cells[0] || '';
    if (!head) continue;
    // ★한 칸에 두 법이 들어 있으면(`「행정심판법」 제27조ㆍ「행정소송법」 제18조`) **법마다 쪼갠다.**
    //   합쳐 두면 조문이 남의 법 것으로 붙는다(§8-A ③-1: 근거 조문 표는 한 칸에 한 법).
    const marks = [...head.matchAll(/「[^」]+」|\[\[[^\]]*\]\]/g)];
    const chunks = marks.length > 1
      ? marks.map((m, i) => head.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : head.length))
      : [head];
    for (const chunk of chunks) {
      const arts = [...new Set((chunk.match(ART) || []).map(a => a.replace(/\s+/g, '')))];
      if (!arts.length) continue;                          // 조문을 안 든 갈래는 근거가 될 수 없다
      const law = (/\[\[[^|\]]*\|([^\]]+)\]\]/.exec(chunk) || /「([^」]+)」/.exec(chunk) || [, chunk])[1]
        .replace(/\[\[|\]\]/g, '').replace(/제\s*\d+.*$/, '').trim();
      if (!law) continue;
      const flat = law.replace(/\s+/g, '');
      // 이미 근거 조문 표에 그 법·조문이 함께 있으면 건너뛴다.
      if (arts.some(a => cited.includes(a)) && cited.includes(flat.slice(0, 6))) continue;
      todo.push({ page: f, law, arts, line });
    }
  }
  if (!todo.length) continue;
  rows += todo.length;
  if (!byLaw.has(slug)) byLaw.set(slug, []);
  byLaw.get(slug).push(...todo);
}

const list = [...byLaw.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`타법 연결 → 근거 조문 이관 대상: ${rows.toLocaleString()}행 · ${list.length}개 법\n`);
list.slice(0, 12).forEach(([slug, t]) => console.log(`  ${String(t.length).padStart(4)}행  ${slug}`));

if (process.argv.includes('--write')) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [slug, todo] of list) {
    const byPage = new Map();
    todo.forEach(t => { if (!byPage.has(t.page)) byPage.set(t.page, []); byPage.get(t.page).push(t); });
    let md = `# ${slug} — 타법 연결 → 근거 조문 이관 목록 (${todo.length}행)\n\n`;
    md += '> `## 타법 연결` 표에는 있는데 `## 근거 조문` 표에는 없는 행이다.\n';
    md += '> 챗봇은 `## 근거 조문` 표에서만 근거를 만들므로(`_SCHEMA.md` §6-E), 이 행들은\n';
    md += '> 위키에 이어 놓기만 하고 사용자에게는 닿지 않는다(결정 ①ⓐ, 2026-08-20).\n';
    md += '> 관계 칸이 `수집곤란`인 행은 코드가 따로 읽으므로 여기 없다.\n\n';
    for (const [page, items] of byPage) {
      md += `## ${page} (${items.length}행)\n\n`;
      items.forEach(i => { md += `- [ ] **${i.law}** ${i.arts.join('·')}\n      원본: ${i.line}\n`; });
      md += '\n';
    }
    fs.writeFileSync(path.join(OUT, `${slug}.md`), md);
  }
  console.log(`\n저장: _dashboard/xref_todo/ (${list.length}개 파일)`);
}
