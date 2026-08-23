/**
 * cite_row.js — 근거 조문 표의 행을 **쓰기 시점에** 규격대로 만들어 준다(H-47 ②).
 *
 * 무엇을 하나: 사서는 "어느 법, 몇 조"만 알려준다. 이 도구가
 *   ① 법령 이름을 정식 명칭으로 채우고(계층까지 — "시행규칙" 한 낱말이면 어느 법인지 특정 안 돼 탈락한다)
 *   ② 조문 표기를 표준꼴로 고치고
 *   ③ **그 조문이 원문에 실제로 있는지 확인하고**(없으면 만들어 주지 않는다 — 지어내기 방지)
 *   ④ 시행일과 조 제목을 원문에서 그대로 떠오고(다듬지 않는다 — L-148)
 *   ⑤ 그 페이지 표의 칸 수·순서에 맞춰 행을 뱉고
 *   ⑥ ★**챗봇이 그 행을 실제로 꺼낼 수 있는지 넣기 전에 증명한다**
 *      (생산 함수 extractCitationChain → filterCitationChainByAnswer 를 그대로 태워 본다).
 *
 * [왜 필요한가] 규격은 _SCHEMA §8-A 에 있고 판정 코드도 V5-2/3/5/6/7 에 있지만, 전부 **쓰고 난 뒤**
 * 잡는 사후 검사다. 사서가 규격을 외워 손으로 지키다 틀리면, 다음 게이트가 돌 때까지 그 행은 죽어 있다.
 * 실제로 고정 문제집 라벨 확인에서 나온 오류 1위가 "계층 누락"(같은 조문번호가 법률·시행령·시행규칙에
 * 다 있는데 법률로만 적음)이었다. 사후 검사를 **사전 생성**으로 옮기는 일이라 싸다.
 *
 * [쓰는 법]
 *   node cite_row.js --page <위키 md 경로> --law "해운법 시행규칙" --arts "제10조의3,제10조의4"
 *       → 붙여 넣을 행을 찍어 준다(파일은 안 건드림)
 *   node cite_row.js ... --apply          → 그 페이지의 `## 근거 조문` 표 끝에 실제로 넣는다
 *   node cite_row.js ... --gist "요지"     → 요지 칸을 직접 쓴다(기본값은 원문의 조 제목 복붙)
 *
 * [연계] ← raw/<분야>/<법>/{법률,시행령,시행규칙}.txt·행정규칙/*.txt (원문 존재·시행일·조 제목)
 *        ← services/legal_retriever.js (extractCitationChain·filterCitationChainByAnswer — **챗봇이
 *          쓰는 그 함수를 그대로 태운다.** 따로 구현하면 검사와 코드가 어긋난다 — L-136)
 *        → wiki 아래 md 의 '## 근거 조문' 표 (--apply 일 때만 씀)
 * [로드 순서] 단독 실행 CLI.
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const die = m => { console.error('✖ ' + m); process.exit(1); };

/* ── ① 법령 이름 → 원문 파일 ───────────────────────────────────────────────── */

/** 이름 비교용 — 공백·낫표·별표시를 지운다. */
const flat = s => String(s || '').replace(/[「」『』*\s]/g, '');

/**
 * 법령 이름을 raw 원문 파일 하나로 정한다. 계층(시행령·시행규칙·행정규칙)까지 가른다.
 * 예: resolveLaw('해운법 시행규칙') → {dir:'raw/04_선박해운/해운법', file:'시행규칙.txt', name:'해운법 시행규칙'}
 * [연계] 여기서 못 정하면 행을 만들지 않는다 — 어느 법인지 모르는 채로 표에 넣는 것이 §6-E 결함의 뿌리다.
 */
function resolveLaw(input) {
  const s = flat(input);
  // 계층 낱말만 적은 칸은 어느 법인지 특정되지 않아 근거 목록에서 탈락한다(_SCHEMA §8-A ③).
  if (/^(시행령|시행규칙|시행규정|법|법률|이법|동법)$/.test(s))
    die(`「${input}」 만으로는 어느 법인지 정해지지 않는다. 모법 이름을 붙여 쓰라(예: "항만법 시행규칙").`);
  const tierM = /(시행규칙|시행령|시행규정)$/.exec(s);
  const tier = tierM ? tierM[1] : null;
  const base = tier ? s.slice(0, -tier.length) : s;

  const folders = [];
  for (const domain of fs.readdirSync(RAW)) {
    const dp = path.join(RAW, domain);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const law of fs.readdirSync(dp)) {
      const lp = path.join(dp, law);
      if (fs.statSync(lp).isDirectory()) folders.push({ law, dir: lp });
    }
  }
  // ⓐ 모법 폴더가 그대로 있는가(법률·시행령·시행규칙)
  let hit = folders.find(f => flat(f.law) === base);
  if (hit) {
    const file = tier ? tier + '.txt' : '법률.txt';
    let p = path.join(hit.dir, file);
    if (!fs.existsSync(p)) {
      // ★타법은 계층 파일이 `법률_발췌.txt`·`시행령_발췌.txt` 처럼 붙어 있는 곳이 있다
      //   (연결된 조문만 받아온 파일 — 수집 스크립트가 달랐다).
      //   종전에는 표준 이름이 없으면 그냥 죽어서, 사서가 이 도구를 못 쓰고 **손으로 행을 써야 했다**
      //   (2026-08-23 백로그 라운드에서 지방세특례제한법·자격기본법이 실제로 그랬다).
      //   손으로 쓰면 이 도구가 막아 주던 함정(법령 칸에 계층 낱말만·한 칸에 두 법·부칙 혼입)에 그대로 걸린다.
      //   그래서 같은 계층 이름으로 시작하는 파일을 하나 더 찾아본다. 여러 개면 가장 큰 것을 쓴다.
      const alts = fs.readdirSync(hit.dir)
        .filter(x => x.endsWith('.txt') && x.startsWith((tier || '법률') + '_'))
        .map(x => ({ x, size: fs.statSync(path.join(hit.dir, x)).size }))
        .sort((a, b) => b.size - a.size);
      if (alts.length) {
        p = path.join(hit.dir, alts[0].x);
        console.error(`  ↳ ${file} 이 없어 ${alts[0].x} 을 대신 읽는다(발췌본일 수 있다 — 그 조가 없으면 행을 안 만든다).`);
      } else {
        const have = fs.readdirSync(hit.dir).filter(x => x.endsWith('.txt')).join(', ');
        die(`「${hit.law}」 폴더에 ${file} 이 없다(있는 것: ${have || '없음'}). 계층을 잘못 적었거나 아직 수집 전이다.`);
      }
    }
    return { dir: hit.dir, path: p, name: (tier ? hit.law + ' ' + tier : hit.law) };
  }
  // ⓑ 행정규칙(고시·규칙·지침)인가 — 각 법 폴더의 행정규칙/ 아래를 이름으로 찾는다
  const cands = [];
  for (const f of folders) {
    const ad = path.join(f.dir, '행정규칙');
    if (!fs.existsSync(ad)) continue;
    for (const e of fs.readdirSync(ad)) {
      if (!e.endsWith('.txt')) continue;
      const nm = e.replace(/\.txt$/, '');
      if (flat(nm) === s || flat(nm).includes(s) || s.includes(flat(nm))) {
        cands.push({ dir: f.dir, path: path.join(ad, e), name: nm });
      }
    }
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) die(`「${input}」 로 여러 원문이 잡힌다 — 정확한 이름을 쓰라:\n   ` +
    cands.map(c => c.name).join('\n   '));
  die(`「${input}」 의 원문을 raw 에서 못 찾았다. 정식 명칭을 계층까지 정확히 쓰라(예: "해운법 시행규칙").`);
}

/* ── ② 조문 표기 정규화 + ③ 원문 존재 확인 ────────────────────────────────── */

/** `제 10 조의3 1항` 같은 입력을 `제10조의3제1항` 표준꼴로 고친다. 조문이 아니면 null. */
function normArticle(s) {
  let t = String(s || '').replace(/\s+/g, '');
  const m = /^제(\d+)조(의(\d+))?(?:제?(\d+)항)?(?:제?(\d+)호)?$/.exec(t);
  if (!m) return null;
  let out = '제' + m[1] + '조' + (m[3] ? '의' + m[3] : '');
  if (m[4]) out += '제' + m[4] + '항';
  if (m[5]) out += '제' + m[5] + '호';
  return out;
}

/**
 * 원문에서 그 조를 찾아 {제목, 시행일} 을 떠온다. raw 는 `[제10조의3] 여객선 이력관리 (시행 20260713 · …)` 꼴.
 * 못 찾으면 null — 이때는 행을 만들지 않는다(원문에 없는 것을 표에 넣지 않는다).
 */
function lookupArticle(rawPath, art) {
  const body = fs.readFileSync(rawPath, 'utf8');
  const head = /^제(\d+)조(?:의(\d+))?/.exec(art);
  const key = '[제' + head[1] + '조' + (head[2] ? '의' + head[2] : '') + ']';
  for (const line of body.split('\n')) {
    if (!line.startsWith(key)) continue;
    const rest = line.slice(key.length).trim();
    const d = /\(시행\s*(\d{4})(\d{2})(\d{2})/.exec(rest);
    return {
      title: rest.replace(/\s*\(시행[\s\S]*$/, '').trim(),
      효력: d ? `${d[1]}-${d[2]}-${d[3]}` : '—',
    };
  }
  // ★raw 가 대괄호 꼴이 아닌 파일도 있다(2026-08-23 백로그 라운드에서 사서 셋이 각각 부딪혔다).
  //   `target=public` 으로 받은 위임규정(공단 정관 등)·고시류는 `제10조(목적) 본문…` 꼴로 적힌다.
  //   종전에는 그런 파일에서 **원문에 조가 멀쩡히 있는데도 "없다"고 거부**해, 사서가 이 도구를 못 쓰고
  //   손으로 행을 써야 했다(어촌ㆍ어항법 공단 정관에서 실제로 발생, raw grep 으로 조문 존재를 확인함).
  //   손으로 쓰면 이 도구가 막아 주던 함정에 그대로 걸리므로, 두 번째 꼴도 받는다.
  //   ⚠찾는 방식만 늘린다 — 없는 조를 있다고 만들어 주지는 않는다.
  const alt = new RegExp('^제' + head[1] + '조' + (head[2] ? '의' + head[2] : '') + '\\(([^)]{1,60})\\)');
  for (const line of body.split('\n')) {
    const m = alt.exec(line.trim());
    if (!m) continue;
    const d = /\(시행\s*(\d{4})(\d{2})(\d{2})/.exec(line);
    return { title: m[1].trim(), 효력: d ? `${d[1]}-${d[2]}-${d[3]}` : '—' };
  }
  return null;
}

/* ── ⑤ 페이지 표의 칸 모양 읽기 ───────────────────────────────────────────── */

/** `## 근거 조문` 절의 표 머리글과 마지막 행 줄번호를 찾는다. */
function citeTable(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+근거\s*조문/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  let header = -1, last = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const t = lines[i].trim();
    if (!t.startsWith('|')) continue;
    if (header < 0) { header = i; continue; }
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    last = i;
  }
  if (header < 0) return null;
  const cols = lines[header].replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  return { header, cols, last: last < 0 ? header + 1 : last };
}

/* ── ⑥ 넣기 전에 "챗봇이 꺼낼 수 있는가" 증명 ─────────────────────────────── */

/**
 * 만든 행을 **생산 파서에 그대로 태워** 근거로 살아나는지 본다.
 * reach_eval.js 와 같은 방식 — 그 행에 가장 유리한 답변을 지어 주고도 안 살아나면 죽은 행이다.
 * @returns {boolean} 살아나면 true
 */
function proveReachable(cols, row, baseLaw) {
  const body = ['## 근거 조문', '', '| ' + cols.join(' | ') + ' |',
    '|' + cols.map(() => '---').join('|') + '|', row, ''].join('\n');
  const chain = R.extractCitationChain(body);
  if (!chain.length) return false;
  const r = chain[0];
  const answer = `「${r.law}」 ${r.article}에 따릅니다.`;
  return R.filterCitationChainByAnswer([Object.assign({}, r)], answer, baseLaw).length > 0;
}

/* ── 본체 ─────────────────────────────────────────────────────────────────── */

const pagePath = arg('--page') || die('--page <위키 md 경로> 가 필요하다');
if (!fs.existsSync(pagePath)) die(`페이지가 없다: ${pagePath}`);
const lawIn = arg('--law') || die('--law "정식 법령명(계층까지)" 이 필요하다');
const artsIn = arg('--arts') || die('--arts "제6조,제9조제1항" 이 필요하다');
const gist = arg('--gist');
const APPLY = argv.includes('--apply');

const law = resolveLaw(lawIn);
const src = fs.readFileSync(pagePath, 'utf8');
const lines = src.split('\n');
const tbl = citeTable(lines);
if (!tbl) die(`${path.basename(pagePath)} 에 "## 근거 조문" 표가 없다. 표부터 만들어야 한다(_SCHEMA §5).`);
const fm = /^---\n([\s\S]*?)\n---/.exec(src);
const baseLaw = fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '';

// 이미 있는 (법령, 조문) — 중복 추가 방지
const existing = new Set(R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))
  .map(r => flat(r.law) + '|' + flat(r.article)));

const made = [];
for (const one of artsIn.split(/[,，]/).map(x => x.trim()).filter(Boolean)) {
  const art = normArticle(one);
  if (!art) die(`"${one}" 은 조문 표기가 아니다. 조문 칸에는 조문만 쓴다(제6조 / 제8조의2제2항 꼴).`);
  const info = lookupArticle(law.path, art);
  if (!info) die(`「${law.name}」 원문에 ${art} 이 없다(${path.relative(LEGAL, law.path)}). ` +
    `계층을 잘못 짚었거나(법률↔시행령↔시행규칙) 아직 수집 전이다 — 표에 넣지 않는다.`);
  if (existing.has(flat(law.name) + '|' + flat(art))) {
    console.log(`  ⏭️  이미 있음: ${law.name} ${art}`);
    continue;
  }
  const cell = {
    '법령명': law.name, '법령': law.name,
    '조문': art,
    '시행일': info.효력,
    '요지': gist || info.title || '—',
  };
  const row = '| ' + tbl.cols.map(c => cell[c] !== undefined ? cell[c] : '—').join(' | ') + ' |';
  if (!proveReachable(tbl.cols, row, baseLaw)) {
    die(`만든 행이 생산 파서에서 근거로 안 살아난다(넣지 않는다):\n   ${row}\n` +
      `   → 법령 칸이 특정 가능한 이름인지, 조문 칸이 조문 표기뿐인지 확인하라.`);
  }
  made.push(row);
}

if (!made.length) { console.log('넣을 행이 없다(전부 이미 있음).'); process.exit(0); }
console.log(`\n원문 확인: ${path.relative(LEGAL, law.path)}`);
console.log(`표 칸: ${tbl.cols.join(' | ')}`);
console.log(`도달성 증명: 통과 (생산 파서가 이 행을 근거로 꺼낸다)\n`);
made.forEach(r => console.log(r));

if (!APPLY) { console.log('\n(--apply 를 붙이면 이 행들을 표 끝에 실제로 넣는다)'); process.exit(0); }
lines.splice(tbl.last + 1, 0, ...made);
fs.writeFileSync(pagePath, lines.join('\n'));
console.log(`\n✅ ${path.relative(LEGAL, pagePath)} 의 "## 근거 조문" 표에 ${made.length}행 추가`);
