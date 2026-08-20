/**
 * defect_triage.js — 남은 결손의 **원인을 자동으로 가른다**(AI 안 씀, 비용 0).
 *
 * [왜 있나] 2026-08-20. 라이브 검증에서 근거를 못 댄 문항이 남았는데, 그때마다 "위키에 없나?
 * 표에 없나? 검색이 못 가나?"를 손으로 확인하느라 오래 걸렸고, 확인 없이 짐작해 틀린 적도 있다
 * (L-123: 유형4로 분류한 19건이 전부 위키에 이미 있었다). 그 확인을 기계가 하게 한다.
 *
 * [무엇을 보나] 문항마다 기대 근거에서 조문 표기를 뽑아 네 가지를 차례로 묻는다.
 *   ① 그 조문이 **위키 어딘가에** 있나            → 없으면 `수집필요`
 *   ② 어느 페이지의 **근거 조문 표**에 행으로 있나  → 없으면 `표보강`
 *   ③ 검색이 그 페이지를 **후보로 올리나**          → 못 올리면 `라우팅`
 *   ④ 모델에게 가는 **자료에 실리나**              → 안 실리면 `발췌`
 *   ⑤ 넷 다 통과인데 라이브에서 근거를 못 댔다면    → `대조코드`(답변↔근거 대조 단계)
 *
 * ⚠③④는 **AI 검색어 확장이 빠진 상태**로 잰다(이 컨테이너에 Gemini 키가 없다 — L-130).
 *   운영에서는 순위가 달라질 수 있으므로, 여기서 "라우팅 이상 없음"이 곧 운영에서도 그렇다는 뜻은
 *   아니다. `NRYA_FAKE_AI_TERMS` 로 확장어를 주입해 다시 돌려 보는 것이 짝이 되는 확인이다.
 * ⚠기대 근거 자체가 틀린 경우(L-129)는 기계가 못 가린다 — ①에서 `수집필요`로 나오면 raw 원문과
 *   대조해 어느 쪽이 틀렸는지 사람이 확인해야 한다.
 *
 * [쓰는 법]  node defect_triage.js <결손목록.json>   (live_r22_pass*.json 과 같은 모양)
 *
 * [연계] ← pinned/live_r22_pass*.json · pinned/page_labels.json(정답 페이지를 붙인 문항은 그것을 쓴다).
 *        → services/legal_retriever.js search()·buildContextBlock(). ⚠읽기 전용.
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const WIKI = '/home/user/SEAGNAL/local_server/knowledge/legal/wiki';
const DIR = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/';

const C = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const norm = s => String(s || '').replace(new RegExp('[' + C + ']', 'g'), c => '제' + (C.indexOf(c) + 1) + '항').replace(/\s+/g, '');
const TOKEN_RE = /제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?|별표\s*\d+(?:의\d+)?|별지\s*제\s*\d+호(?:의\d+)?\s*서식|별지\s*제\s*\d+호/g;
// ★공백을 **지우기 전에** 뽑는다(2026-08-20 검산에서 발견). 먼저 지우면 `별표4 1호` 가
//   `별표41` 이라는 있지도 않은 표기가 된다 — 그러면 위키 어디에도 없다고 나와 엉뚱하게
//   "표보강"으로 분류된다(원산지표시법 문항에서 실제로 그랬다).
function tokensOf(expected) {
  const soft = String(expected || '').replace(new RegExp('[' + C + ']', 'g'), c => '제' + (C.indexOf(c) + 1) + '항').replace(/\s+/g, ' ');
  const raw = (soft.match(TOKEN_RE) || []).map(t => t.replace(/\s+/g, ''));
  const out = [];
  for (const t of raw) { if (raw.some(o => o !== t && o.startsWith(t))) continue; if (!out.includes(t)) out.push(t); }
  return out;
}
// 표기 대조 — 기대값이 항·호까지 짚었어도 **조까지만** 적힌 표기를 맞은 것으로 본다.
// 위키 근거 표는 조까지만 짚는 일이 흔하고, 항·호는 답변에서 채워진다(regrade 와 같은 눈금).
function hasArticle(hay, token) {
  if (hay.includes(token)) return true;
  const jo = /^제\d+조(?:의\d+)?/.exec(token);
  return !!(jo && hay.includes(jo[0]));
}

// 위키 전체를 한 번만 읽어 둔다(페이지별 본문·근거표).
const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) {
      const txt = fs.readFileSync(p, 'utf8');
      const tab = [];
      let inT = false;
      for (const line of txt.split('\n')) {
        const t = line.trim();
        if (/^##[^#]*근거 조문/.test(t)) { inT = true; continue; }
        if (inT && /^##[^#]/.test(t)) { inT = false; continue; }
        if (inT && t.startsWith('|')) tab.push(t);
      }
      // 조문 칸만 따로 모아 둔다 — 묶음 표기를 펴려면 칸 단위여야 한다(표 전체를 통째로 펴면
      // 다른 칸의 숫자까지 섞여 없는 조문을 만들어 낸다).
      const cells = [];
      for (const line of tab) {
        const c = line.split('|').map(x => x.trim());
        if (c.length >= 4) cells.push(c[3] || '', c[2] || '');
      }
      pages.push({ file: p, name: path.basename(p, '.md'), body: norm(txt), table: norm(tab.join('\n')), tableCells: cells.filter(Boolean) });
    }
  }
})(WIKI);

(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const labels = JSON.parse(fs.readFileSync(DIR + 'page_labels.json', 'utf8')).labels;
  const wantPages = new Map(labels.map(l => [l.question, l.pages]));
  const out = [];
  for (const r of rows) {
    const want = tokensOf(r.expected);
    if (!want.length) { out.push({ law: r.law, q: r.question, cause: '기대값서술형', detail: '기대값에서 조문 표기를 못 뽑는다' }); continue; }
    // ① 위키 어딘가에 있나 — 기대 조문을 **가장 많이** 담은 페이지를 찾는다.
    //   ★후보를 **그 문항의 법으로 한정**한다(2026-08-20). 처음엔 위키 전체에서 골랐더니
    //     `제12조`·`제5조` 같은 흔한 조문 번호 때문에 전혀 무관한 페이지가 뽑혔다
    //     (연안관리법 수중조사 문항에 국제항해선박 별표5가 뽑히는 식). 조문 번호만 세고
    //     법 이름을 안 보면 이 도구는 아무 말이나 한다 — L-132 의 검산 규칙을 또 어겼다.
    //   ⓐ 사람이 붙여 둔 정답 페이지(page_labels)가 있으면 그것만 본다.
    //   ⓑ 없으면 그 법 이름이 파일명에 들어간 페이지로 좁힌다.
    const labeled = (wantPages.get(r.question) || []).map(x => norm(x));
    const lawKey = norm(String(r.law || '')).replace(/[「」]/g, '');
    let pool = pages;
    if (labeled.length) pool = pages.filter(p => labeled.includes(norm(p.name)));
    else if (lawKey.length >= 4) {
      const head = lawKey.slice(0, Math.min(10, lawKey.length));
      pool = pages.filter(p => norm(p.name).startsWith(head) || norm(p.name).includes(head));
    }
    if (!pool.length) pool = pages;
    let best = null, bestHit = 0;
    for (const p of pool) {
      const h = want.filter(t => p.body.includes(t)).length;
      if (h > bestHit) { bestHit = h; best = p; }
    }
    if (!bestHit) { out.push({ law: r.law, q: r.question, cause: '수집필요/기대값오류', detail: `기대 조문(${want.join(',')})이 위키 어디에도 없다 — raw 원문과 대조 필요` }); continue; }
    // ② 그 페이지의 근거 조문 표에 있나
    //   ★조문 칸의 묶음 표기를 **챗봇과 같은 방식으로 펴서** 본다(2026-08-20 검산에서 발견).
    //     글자 그대로 찾으면 `별표2·5·6·8·9` 안의 별표5 를 못 봐서, 표에 멀쩡히 있는 행을
    //     "없다"고 분류한다(연안관리법 문항에서 실제로 그랬다). 챗봇이 쓰는 articleEnumTokens
    //     를 그대로 불러 같은 눈으로 본다.
    const tableExpanded = best.table + ' ' + (best.tableCells || []).flatMap(c => R.articleEnumTokens(c)).join(' ');
    //   ★대조는 **regrade 와 같은 눈금**으로 한다(2026-08-20 검산에서 발견). 위키 표는 조까지만
    //     짚는 경우가 흔하고(`제9조(별표3)`), 범위로 적기도 한다(`제114조제8~11호`). 기대값이
    //     항·호까지 짚었다고 표에 그 글자가 그대로 있어야 한다고 보면, 멀쩡한 표를 "없다"고
    //     분류한다 — 섬 발전 촉진법·해상교통안전법에서 실제로 그랬다.
    const inTable = want.filter(t => hasArticle(tableExpanded, t)).length;
    if (!inTable) { out.push({ law: r.law, q: r.question, cause: '표보강', detail: `${best.name} 본문엔 있으나 근거 조문 표에 없다(${want.join(',')})` }); continue; }
    // ③ 검색이 그 페이지를 후보로 올리나 ④ 자료에 실리나
    const q = r.question;
    let rank = -1, inCtx = false;
    try {
      const { contextPages } = await R.search(q, { canonicalOnly: true });
      const ids = contextPages.map(c => norm(String(c.law) + '__' + String(c.topic || '')));
      const target = norm(best.name);
      rank = ids.indexOf(target);
      const blk = norm(R.buildContextBlock(contextPages));
      inCtx = want.some(t => blk.includes(t));
    } catch (e) { /* 검색 실패는 아래에서 라우팅으로 본다 */ }
    if (rank < 0) { out.push({ law: r.law, q, cause: '라우팅', detail: `표에도 있는데 검색이 ${best.name} 을 후보로 못 올린다` }); continue; }
    if (!inCtx) { out.push({ law: r.law, q, cause: '발췌', detail: `${best.name} 이 ${rank + 1}위로 들어오는데 기대 조문이 자료에 안 실린다` }); continue; }
    out.push({ law: r.law, q, cause: '대조코드', detail: `${best.name} ${rank + 1}위·자료에도 실림 — 답변↔근거 대조 단계에서 떨어진다` });
  }
  const by = {};
  for (const o of out) (by[o.cause] = by[o.cause] || []).push(o);
  console.log(`결손 ${out.length}건의 원인 분류 (AI 안 씀)`);
  console.log('─'.repeat(70));
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n■ ${k}  ${v.length}건`);
    for (const o of v) {
      console.log(`   · ${String(o.law).slice(0, 26)}`);
      console.log(`     ${String(o.q).slice(0, 50)}`);
      console.log(`     → ${o.detail}`);
    }
  }
  const save = process.argv[3];
  if (save) { fs.writeFileSync(save, JSON.stringify(out, null, 1)); console.log('\n저장: ' + save); }
})();
