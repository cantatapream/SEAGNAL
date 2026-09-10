/**
 * ============================================================================
 * 파일명: services/legal_wiki_brief.js
 * 역할: 관리자가 개정을 **승인한 뒤**, 그 개정을 위키에 반영하려면 무엇을 어디서 고쳐야 하는지를
 *       한 덩어리 글로 만들어 준다. 관리자는 그 글만 복사해 AI 에게 붙여 넣으면 된다.
 * ============================================================================
 *
 * [설명 — 왜 있나 (사용자 확정 2026-09-10)]
 * 승인해도 원문 재수집·위키 수정은 자동으로 되지 않는다(서버는 git 을 못 쓰고, 배포하면 raw·wiki 가
 * 이미지 상태로 돌아간다 — `_amendments/README.md`). 그래서 사람이 작업 세션에 일을 넘겨야 하는데,
 * 그때마다 "무엇이 바뀌었고 어느 페이지를 봐야 하는지"를 사람이 다시 찾아 적는 것은 낭비이고 빠뜨리기 쉽다.
 * 이 파일이 그 인계문을 **큐 데이터에서 그대로** 만든다 — 지어내는 내용은 하나도 없다.
 *
 * [무엇을 담나]
 *  1. 무엇이 바뀌었나 — 바뀐 조문마다 **개정 전 원문 → 개정 후 원문**(큐가 이미 갖고 있다), 신설 표시
 *  2. 어느 위키를 봐야 하나 — 그 법을 다루거나 인용하는 페이지 중, **바뀐 조문 번호가 실제로 적힌 쪽**을 먼저
 *  3. 무엇을 해야 하나 — 시행 전이면 시행일 마커(§10), 이미 시행 중이면 본문 직접 수정. 검사·커밋까지.
 *
 * [일괄본(buildBulkWikiBrief) 이 단건과 다른 점 — 2026-09-10 사용자 요청으로 신설]
 * 단건과 **같은 문장·같은 규칙**을 쓰되 셋만 다르다: ①맨 앞에 「한눈에 보기」 표 ②「해야 할 일」·「지키는
 * 규칙」은 건마다 반복하지 않고 문서 끝에 한 번만 ③재수집은 id 를 하나씩 주는 대신 `--all-approved` 한 줄.
 * 바뀐 조문 정보가 없는 건(신규 고시 발견 등 — 비교할 옛 원문이 아예 없다)은 상세 절 없이 목록으로만 모은다.
 * 타법 인용 페이지 목록은 일괄본에서만 앞 20쪽으로 줄이고, **줄였다는 사실과 전부 보는 방법을 그 자리에 적는다.**
 *
 * [연계]
 * - routes/legal.js  → GET /api/legal/amendments/:id/wiki-brief (단건)
 * - routes/legal.js  → GET /api/legal/amendments/wiki-brief-all (승인분 전 건을 한 덩어리로 — 2026-09-10 신설)
 * - services/legal_retriever.js → loadIndex(어느 페이지가 그 법을 다루나) · readPage(조문 번호가 적혔나)
 * - services/legal_amendment_scanner.js → 큐 항목(법령명·layer·시행일자·changed_articles)
 * [로드 순서] 번들 없음(서버). routes/legal.js 가 require 시점에 함께 로드한다.
 * ============================================================================
 */
'use strict';
const legalRetriever = require('./legal_retriever');

/** 조문 번호를 사람이 읽는 이름으로. 예: articleLabel('54','2') → '제54조의2' */
function articleLabel(no, ga) {
  const g = String(ga || '').replace(/^0+$/, '');
  return '제' + String(no || '') + '조' + (g ? '의' + g : '');
}

/** `20260911` → `2026-09-11`. 8자리가 아니면 그대로 돌려준다. */
function ymd(v) {
  const s = String(v || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
}

/** 공백을 지운 비교용 이름(법령명은 표기 공백이 들쭉날쭉하다). */
function flat(s) { return String(s || '').replace(/\s+/g, ''); }

/**
 * 근거 조문 표의 한 칸(`제22~30조`·`제27조·제29조`·`제54조의2` 처럼 여러 꼴)이 **우리가 찾는 조**를 담는가.
 * 예: articleCellHas('제22~30조', '28', '') → true · articleCellHas('제27조·제29조', '28', '') → false
 * @param {string} cell - 표의 조문 칸 문자열
 * @param {string} no - 조문번호  @param {string} ga - 조문가지번호(없으면 '')
 * @returns {boolean}
 * [연계] ← candidatePages. 범위(`제A~B조`)는 가지번호 없는 조에만 적용한다 — `제54조의2` 가 범위에
 *   들어가는지는 문자열만으로 확정할 수 없어 **넣지 않는다**(없는 근거를 만들지 않는다).
 */
function articleCellHas(cell, no, ga) {
  const s = String(cell || '');
  const n = parseInt(no, 10);
  const g = String(ga || '').replace(/^0+$/, '');
  if (!n) return false;
  if (s.indexOf(articleLabel(no, ga)) >= 0) return true;          // 그대로 적힌 경우
  if (g) return false;                                            // 가지번호 있는 조는 범위 해석 안 한다
  let m;
  const range = /제\s*(\d+)\s*[~∼-]\s*(\d+)\s*조/g;
  while ((m = range.exec(s))) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a && b && n >= Math.min(a, b) && n <= Math.max(a, b)) return true;
  }
  return false;
}

/**
 * 본문 서술에서 **그 법 이름 가까이에** 그 조가 적혀 있나(표가 아니라 문장에서 언급한 자리).
 * 예: bodyMentions('…「어선원 및 어선 재해보상보험법」 제28조에 따라…', '어선원 및 어선 재해보상보험법', '제28조') → true
 * @param {string} body - 위키 본문  @param {string} lawName - 법령명  @param {string} label - `제28조` 꼴
 * @returns {boolean}
 * [연계] ← candidatePages.
 *   ★법 이름을 함께 보지 않으면 **다른 법의 같은 번호 조문**까지 잡힌다(2026-09-10 실측: `제2조` 하나로
 *     낚시관리법·선원법 등 43쪽이 딸려 왔다). 그래서 앞 200자 안에 법 이름이 있을 때만 인정한다.
 */
function bodyMentions(body, lawName, label) {
  const t = flat(body);
  const want = flat(lawName);
  const lab = flat(label);
  if (!want || !lab) return false;
  let i = t.indexOf(lab);
  while (i >= 0) {
    if (t.lastIndexOf(want, i) >= 0 && i - t.lastIndexOf(want, i) <= 200) return true;
    i = t.indexOf(lab, i + 1);
  }
  return false;
}

/**
 * 그 법의 개정이 닿을 수 있는 위키 페이지를 고른다.
 * 예: candidatePages('어선원 및 어선 재해보상보험법', [{no:'28', ga:'', label:'제28조'}])
 *     → [{file, kind, law, status, mine, hits:['제28조'], where:'근거표'}, …]
 * @param {string} lawName - 법령명(큐의 `법령명`)
 * @param {Array<{no:string, ga:string, label:string}>} arts - 바뀐 조문들
 * @returns {Array<object>} 조문까지 맞은 쪽이 앞, 그다음 그 법 소속 페이지, 그다음 인용 페이지
 * [연계] ← buildWikiBrief. → legal_retriever.loadIndex·readPage·extractCitationChain.
 *   판정 두 갈래: ①「## 근거 조문」 표에서 **법령 칸이 이 법이고 조문 칸이 그 조**인 행이 있다(가장 확실)
 *   ②본문 문장에서 법 이름 가까이 그 조가 적혔다. 어느 쪽으로 걸렸는지 `where` 에 남긴다.
 */
function candidatePages(lawName, arts) {
  const want = flat(lawName);
  const pages = (legalRetriever.loadIndex().pages || []);
  const out = [];
  for (const p of pages) {
    const mine = flat(p.law) === want;
    const cites = (p.cited || []).some((c) => flat(c) === want);
    if (!mine && !cites) continue;
    let hits = [], where = '';
    if (arts.length) {
      let body = '';
      try { body = (legalRetriever.readPage(p.kind, p.file) || {}).body || ''; } catch (_) { body = ''; }
      let rows = [];
      try { rows = legalRetriever.extractCitationChain(body) || []; } catch (_) { rows = []; }
      const mineRows = rows.filter((r) => flat(r.law) === want);
      const byTable = arts.filter((a) => mineRows.some((r) => articleCellHas(r.article, a.no, a.ga)));
      const byBody = arts.filter((a) => byTable.indexOf(a) < 0 && bodyMentions(body, lawName, a.label));
      hits = byTable.concat(byBody).map((a) => a.label);
      where = byTable.length ? (byBody.length ? '근거표+본문' : '근거표') : (byBody.length ? '본문' : '');
    }
    out.push({ file: p.file, kind: p.kind, law: p.law || '', status: p.status || '', mine, hits, where });
  }
  out.sort((a, b) => (b.hits.length - a.hits.length)
    || ((b.where === '근거표' || b.where === '근거표+본문' ? 1 : 0) - (a.where === '근거표' || a.where === '근거표+본문' ? 1 : 0))
    || (Number(b.mine) - Number(a.mine))
    || String(a.file).localeCompare(String(b.file), 'ko'));
  return out;
}

/** 위키 폴더 이름(kind → 폴더). index.json 의 kind 를 실제 경로로 되돌린다. */
const KIND_DIR = { concept: 'concepts', statute: 'statutes', comparison: 'comparisons', annex: 'annexes', activity: 'activities' };

/**
 * 승인된 개정 1건을 **AI 에게 그대로 붙여 넣을 수 있는 인계문**으로 만든다.
 * 예: buildWikiBrief(queueItem, '20260910').text → '# 위키 반영 요청 — 어선원 및 어선 재해보상보험법 …'
 * @param {object} am - 관리자 큐 항목 1건(legal_amendments_queue.jsonl 의 한 줄)
 * @param {string} today - `YYYYMMDD`(시행 전인지 판단용)
 * @returns {{ok:boolean, text:string, pages:Array<object>, error?:string}}
 * [연계] ← routes/legal.js GET /api/legal/amendments/:id/wiki-brief.
 *   ★큐에 없는 것은 쓰지 않는다 — 본문이 비어 있으면 "받지 못했다"고 적는다(지어내지 않는다).
 */
/**
 * 큐 항목 1건에서 자주 쓰는 값을 한 번에 꺼낸다(단건 인계문·일괄 인계문이 같은 값을 보게).
 * @param {object} am @param {string} today - `YYYYMMDD`
 * @returns {{cur:object, lawName:string, layer:string, eff:string, future:boolean, arts:Array, hasText:boolean}}
 */
function amFacts(am, today) {
  const cur = am.현재 || {};
  const eff = String(cur.시행일자 || '');
  const arts = am.changed_articles || [];
  return {
    cur,
    lawName: am.법령명 || am.law || '',
    layer: am.layer || '법률',
    eff,
    future: /^\d{8}$/.test(eff) && eff > String(today || ''),
    arts,
    hasText: arts.some((a) => a.새본문 || a.옛본문),
  };
}

/**
 * "무엇이 바뀌었나" 절의 본문 줄을 만든다 — 바뀐 조문마다 개정 전/후 원문을 그대로 옮긴다.
 * 큐에 없는 것은 지어내지 않고 "받지 못했다"고 적는다.
 * @param {object} am @param {object} f - amFacts 결과 @param {number} depth - 조문 제목의 `#` 개수
 * @returns {Array<string>}
 * [연계] ← buildWikiBrief · buildBulkWikiBrief(둘이 같은 글을 쓰게 하려고 뽑아 뒀다).
 */
function changeLines(am, f, depth) {
  const h = '#'.repeat(depth);
  const cur = f.cur;
  const L = [];
  L.push(`- 법령: **${f.lawName}** (${f.layer})`);
  if (cur.공포번호 || cur.공포일자) L.push(`- 공포: ${[cur.공포번호 && `제${cur.공포번호}호`, ymd(cur.공포일자)].filter(Boolean).join(' · ')}`);
  L.push(`- 시행일: **${ymd(f.eff) || '미상'}**${f.future ? ' — 아직 시행 전이다' : ' — 이미 시행 중이다'}`);
  if (cur.MST) L.push(`- 원문 확인: https://www.law.go.kr/lsInfoP.do?lsiSeq=${cur.MST}${f.eff ? '&efYd=' + f.eff : ''}`);
  L.push(`- 개정검토 큐 id: \`${am.id}\``);
  L.push('');
  if (!f.arts.length) {
    L.push('> ⚠ 이 항목에는 **바뀐 조문 목록이 없다.** 관리자 화면에서 「지금 스캔」을 다시 돌려 조문 정보를 받은 뒤 이 글을 다시 뽑아라.');
    L.push('');
  }
  for (const a of f.arts) {
    const lab = articleLabel(a.조문번호, a.조문가지번호);
    L.push(`${h} ${lab}${a.조문제목 ? `(${a.조문제목})` : ''}${a.신설 ? ' — **신설**' : (a.조문제개정유형 ? ` — ${a.조문제개정유형}` : '')}${a.조문시행일자 ? ` · 시행 ${ymd(a.조문시행일자)}` : ''}`);
    L.push('');
    L.push('**개정 전**');
    L.push('```');
    L.push(a.신설 ? '(우리가 가진 원문에 이 조가 없다 — 새로 만들어지는 조문으로 본다. 우리 원문이 낡아서 그렇게 보일 수도 있으니 raw 의 시행일을 함께 확인할 것.)'
      : (a.옛본문 || '(우리 원문에서 이 조를 찾지 못했다.)'));
    L.push('```');
    L.push('');
    L.push('**개정 후**');
    L.push('```');
    L.push(a.새본문 || '(새 본문을 받지 못했다 — 「지금 스캔」을 다시 돌린 뒤 이 글을 다시 뽑아라.)');
    L.push('```');
    L.push('');
  }
  return L;
}

/**
 * "어느 위키를 봐야 하나" 절의 본문 줄을 만든다.
 * @param {object} f - amFacts 결과 @returns {{lines:Array<string>, pages:Array<object>}}
 * [연계] ← buildWikiBrief · buildBulkWikiBrief. → candidatePages.
 */
function pageLines(f, citeCap) {
  const artKeys = f.arts.map((a) => ({ no: String(a.조문번호 || ''), ga: String(a.조문가지번호 || ''), label: articleLabel(a.조문번호, a.조문가지번호) }));
  const pages = candidatePages(f.lawName, artKeys);
  const hit = pages.filter((p) => p.hits.length);
  const rest = pages.filter((p) => !p.hits.length);
  const L = [];
  if (hit.length) {
    L.push('**바뀐 조문이 실제로 적힌 페이지 — 여기부터 본다.** `근거표` = 「## 근거 조문」 표에 그 법·그 조로 적힌 행이 있음(가장 확실), `본문` = 문장에서 그 법 이름 가까이 언급됨.');
    L.push('');
    for (const p of hit) L.push(`- \`wiki/${KIND_DIR[p.kind] || p.kind}/${p.file}.md\` — ${p.hits.join('·')}${p.where ? ` (${p.where})` : ''}${p.status ? ` · status: ${p.status}` : ''}`);
    L.push('');
  } else {
    L.push('바뀐 조문이 적힌 페이지를 **찾지 못했다.** 조문 번호를 안 적고 내용만 서술한 자리가 있을 수 있으니 아래 목록을 훑어라.');
    L.push('');
  }
  if (rest.length) {
    const mineRest = rest.filter((p) => p.mine);
    const citeRest = rest.filter((p) => !p.mine);
    if (mineRest.length) {
      L.push(`**그 법의 다른 페이지 ${mineRest.length}쪽** — 조문 번호는 안 보이지만 내용이 걸릴 수 있다.`);
      L.push('');
      for (const p of mineRest) L.push(`- \`wiki/${KIND_DIR[p.kind] || p.kind}/${p.file}.md\`${p.status ? ` (status: ${p.status})` : ''}`);
      L.push('');
    }
    if (citeRest.length) {
      // 일괄 인계문에서는 이 목록이 건마다 수십 쪽씩 붙어 글이 통째로 못 쓸 만큼 길어진다.
      // 그래서 **일괄일 때만** 앞쪽 몇 쪽으로 줄이되, 줄였다는 사실과 전부 보는 방법을 함께 적는다
      // (조용히 자르지 않는다 — 자른 줄 모르면 "다 봤다"고 착각하게 된다).
      const cap = citeCap > 0 && citeRest.length > citeCap ? citeCap : 0;
      const shown = cap ? citeRest.slice(0, cap) : citeRest;
      L.push(`**그 법을 타법으로 인용하는 페이지 ${citeRest.length}쪽** — 인용 문구가 옛 내용이면 함께 고친다.`);
      L.push('');
      for (const p of shown) L.push(`- \`wiki/${KIND_DIR[p.kind] || p.kind}/${p.file}.md\` (${p.law})`);
      if (cap) L.push(`- …그리고 ${citeRest.length - cap}쪽 더 — 글이 너무 길어져 여기서는 앞 ${cap}쪽만 적었다. **전부 보려면 이 건의 「위키 반영 지시문 만들기」(개별)를 눌러라.**`);
      L.push('');
    }
  }
  return { lines: L, pages };
}

function buildWikiBrief(am, today) {
  if (!am) return { ok: false, text: '', pages: [], error: '항목을 찾지 못했습니다.' };
  const f = amFacts(am, today);
  const lawName = f.lawName, layer = f.layer, eff = f.eff, future = f.future;
  const pl = pageLines(f);
  const pages = pl.pages;

  const L = [];
  L.push(`# 위키 반영 요청 — ${lawName} ${layer} (시행 ${ymd(eff) || '미상'})`);
  L.push('');
  L.push('SEAGNAL 해양법령 위키(나리야)의 개정 반영 작업이다. 아래 개정은 **관리자가 이미 승인**했다.');
  L.push('작업 규칙은 저장소의 `local_server/knowledge/legal/_SCHEMA.md` 를 따른다(특히 원문 발췌는 복붙, 근거 조문 표 규약, §10 시행일 마커).');
  L.push('');
  L.push('## 1. 무엇이 바뀌었나');
  L.push('');
  for (const ln of changeLines(am, f, 3)) L.push(ln);
  L.push('## 2. 어느 위키를 봐야 하나');
  L.push('');
  for (const ln of pl.lines) L.push(ln);
  L.push('## 3. 해야 할 일');
  L.push('');
  L.push('1. **원문을 먼저 받는다.** 저장소 루트에서:');
  L.push('   ```');
  L.push(`   python3 local_server/knowledge/legal/_dashboard/loop/collect_pending_law.py ${am.id}`);
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/collect_pending_law.py --verify');
  L.push('   ```');
  L.push('   (승인 상태는 실서비스에 있고 작업 컴퓨터 사본은 뒤처질 수 있다 — 그래서 id 를 직접 준다.)');
  L.push('2. **위 2번 목록의 페이지를 하나씩 열어**, 위 1번의 개정 전/후를 대조해 고칠 자리를 찾는다.');
  L.push('   근거 조문 표의 **법령 칸·조문 칸은 게이트가 그 칸으로 원문을 여는 자리**라 규약대로 적는다.');
  if (future) {
    L.push(`3. **아직 시행 전이므로 시행일 마커를 쓴다**(\`_SCHEMA.md\` §10). 옛 서술은 \`<!--시행전 ${eff}-->…<!--/시행전-->\`,`);
    L.push(`   새 서술은 \`<!--시행 ${eff}-->…<!--/시행-->\`. 표 칸 안에서는 **한 줄 안에서 열고 닫는 인라인형만** 쓴다.`);
    L.push('   ⚠근거 조문 표의 **법령 칸·조문 칸에는 마커를 넣지 않는다.** 조문 번호 자체가 바뀌는 개정은 마커로 표현할 수 없다.');
    L.push(`   ⚠**승인 게이트**: 이 개정은 승인돼 있으므로, 마커를 넣어 두면 ${ymd(eff)}부터 챗봇이 자동으로 새 서술을 낸다.`);
  } else {
    L.push('3. **이미 시행 중이므로 본문을 직접 고친다**(마커를 쓰지 않는다). 옛 서술을 새 서술로 바꾼다.');
  }
  L.push('4. 고친 페이지마다 「## 변경 이력」 표 끝에 한 줄 추가한다(무엇을 왜 고쳤는지, 근거 조문).');
  L.push('5. **검사**를 돌린다. 저장소 루트에서:');
  L.push('   ```');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/lint_stage_markers.py');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/lint_index.py && python3 local_server/knowledge/legal/_dashboard/loop/lint_build.py');
  L.push('   bash scripts/refactor/verify_all.sh');
  L.push('   ```');
  L.push('   **기준선 대비 나빠진 문항이 0** 이어야 한다. 나빠졌으면 커밋하지 말고 원인을 찾는다.');
  L.push('6. 고친 파일 경로를 **개별 지정해** 커밋한다(`git add -A` 금지). 문서·색인 재생성물을 **같은 커밋**에 담는다.');
  L.push('');
  L.push('## 4. 지키는 규칙');
  L.push('');
  L.push('- **추측 금지.** 원문에 없는 것을 지어내지 않는다. 못 찾았으면 "못 찾았다"고 적는다.');
  L.push('- **원문 발췌는 복붙.** 위 1번의 「개정 후」 본문을 손으로 고쳐 쓰지 않는다.');
  L.push('- 원문이 정하지 않은 것(해석 다툼)은 단정하지 말고 `⚠REVIEW` 로 남긴다.');
  L.push('- 시행일이 지난 뒤에는 `_dashboard/loop/fold_effective.py` 가 마커를 평문으로 접는다(그때 조문 번호 재편은 사람이 표를 고친다).');

  return { ok: true, text: L.join('\n'), pages };
}


/**
 * 승인한 개정 **여러 건을 한 덩어리 인계문**으로 묶는다(사용자 확정 2026-09-10 — "일괄 승인하면
 * 그 전체 내역에 대해서 각 건에 대해서 어떤 내용의 위키를 보강해야한다는 전체 내용이 포함되도록
 * 일괄 승인한 전체 내용 위키 반영 지시문이 만들어 져야 할 것 같은데? 개별 승인과는 별개로.").
 *
 * 단건 인계문(buildWikiBrief)과 **같은 문장·같은 규칙**을 쓴다 — 바뀐 부분은 셋뿐이다:
 *   ①맨 앞에 「한눈에 보기」 표를 둬 몇 건이 어떤 상태인지 먼저 보인다
 *   ②「해야 할 일」·「지키는 규칙」은 건마다 반복하지 않고 **문서 끝에 한 번만** 둔다
 *   ③원문 재수집은 id 를 하나씩 주는 대신 `--all-approved` 한 줄로 끝낸다
 *
 * **바뀐 조문 정보가 없는 건**(신규 고시 발견 등 — 비교할 옛 원문이 아예 없는 것)은 상세 절을
 * 만들지 않고 뒤쪽에 목록으로만 모은다. 그런 건에 개정 전/후 칸을 만들어 두면 빈 칸만 늘어나
 * 진짜 볼 것을 가린다.
 *
 * @param {Array<object>} list - 큐 항목들(순서 그대로 쓴다)
 * @param {string} today - `YYYYMMDD`
 * @returns {{ok:boolean, text:string, count:number, detailed:number, listed:number, pages:number, error?:string}}
 * [연계] ← routes/legal.js GET /api/legal/amendments/wiki-brief-all.
 */
function buildBulkWikiBrief(list, today) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return { ok: false, text: '', count: 0, detailed: 0, listed: 0, pages: 0, error: '묶을 항목이 없습니다.' };

  // 조문 정보가 있는 건(상세를 만든다)과 없는 건(목록으로만 둔다)을 가른다.
  const facts = rows.map((am) => ({ am, f: amFacts(am, today) }));
  const detail = facts.filter((x) => x.f.arts.length);
  const brief = facts.filter((x) => !x.f.arts.length);
  const anyFuture = detail.some((x) => x.f.future);

  const L = [];
  L.push(`# 위키 반영 요청 — 일괄 승인분 ${rows.length}건`);
  L.push('');
  L.push('SEAGNAL 해양법령 위키(나리야)의 개정 반영 작업이다. 아래 개정은 **관리자가 한 번에 승인**했다.');
  L.push('작업 규칙은 저장소의 `local_server/knowledge/legal/_SCHEMA.md` 를 따른다(특히 원문 발췌는 복붙, 근거 조문 표 규약, §10 시행일 마커).');
  L.push('');
  L.push('> ⚠ **이 글은 길다. 건별로 나눠서 처리해도 된다** — 아래 「한눈에 보기」의 순서대로 하나씩 끝내고 다음으로 넘어가면 된다.');
  L.push('> 한 번에 다 고치려다 놓치는 것보다, 한 건씩 끝내고 검사를 돌리는 편이 안전하다.');
  L.push('');

  L.push('## 0. 한눈에 보기');
  L.push('');
  L.push(`- 승인 ${rows.length}건 — 그중 **바뀐 조문을 아는 것 ${detail.length}건**(아래 1번에서 건별로 다룬다), 조문 정보가 없는 것 ${brief.length}건(아래 2번 목록).`);
  const noText = detail.filter((x) => !x.f.hasText).length;
  if (noText) L.push(`- ⚠ 조문 목록은 있는데 **개정 전/후 본문이 안 담긴 건이 ${noText}건** 있다 — 본문을 받아 오기 전에 감지된 것이다. 관리자 화면에서 「지금 스캔」을 다시 돌린 뒤 이 글을 다시 뽑으면 채워진다.`);
  L.push('');
  L.push('| # | 법령 | 계층 | 시행일 | 바뀐 조문 | 개정 전/후 본문 | 큐 id |');
  L.push('|---|---|---|---|---|---|---|');
  detail.forEach((x, i) => {
    L.push(`| ${i + 1} | ${x.f.lawName} | ${x.f.layer} | ${ymd(x.f.eff) || '미상'}${x.f.future ? ' (시행 전)' : ''} | ${x.f.arts.length}개 | ${x.f.hasText ? '있음' : '**없음**'} | \`${x.am.id}\` |`);
  });
  L.push('');

  L.push('## 1. 건별 — 무엇이 바뀌었고 어느 위키를 봐야 하나');
  L.push('');
  let pageCount = 0;
  detail.forEach((x, i) => {
    L.push(`### ${i + 1}) ${x.f.lawName} ${x.f.layer} (시행 ${ymd(x.f.eff) || '미상'})`);
    L.push('');
    L.push(`#### ${i + 1}-1. 무엇이 바뀌었나`);
    L.push('');
    for (const ln of changeLines(x.am, x.f, 5)) L.push(ln);
    const pl = pageLines(x.f, 20);
    pageCount += pl.pages.length;
    L.push(`#### ${i + 1}-2. 어느 위키를 봐야 하나`);
    L.push('');
    for (const ln of pl.lines) L.push(ln);
  });

  if (brief.length) {
    L.push(`## 2. 조문 정보가 없는 ${brief.length}건 — 무엇인지부터 판단한다`);
    L.push('');
    L.push('아래는 **비교할 옛 원문이 없는 것들**이다. 대부분 "새로 발령된 고시를 발견"한 경우라 개정 전/후를 만들 수 없다.');
    L.push('먼저 이 고시가 우리 74법과 실제로 관련이 있는지 판단하고, 관련이 있으면 원문을 수집한 뒤 관련 법 위키에 반영한다.');
    L.push('');
    L.push('| # | 법령·고시 | 계층 | 시행일 | 본문이 인용한 우리 법 | 큐 id |');
    L.push('|---|---|---|---|---|---|');
    brief.forEach((x, i) => {
      const rel = (x.am.related_laws || []).map((r) => r.name || r.slug || '').filter(Boolean);
      L.push(`| ${i + 1} | ${x.f.lawName} | ${x.f.layer} | ${ymd(x.f.eff) || '미상'} | ${rel.length ? rel.join(' · ') : '(없음)'} | \`${x.am.id}\` |`);
    });
    L.push('');
  }

  const secDo = brief.length ? 3 : 2;
  L.push(`## ${secDo}. 해야 할 일 (전 건 공통)`);
  L.push('');
  L.push('1. **원문을 먼저 받는다.** 승인된 건을 한 번에 받는다 — 저장소 루트에서:');
  L.push('   ```');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/collect_pending_law.py --all-approved');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/collect_pending_law.py --verify');
  L.push('   ```');
  L.push('   승인 상태는 실서비스에 있고 작업 컴퓨터 사본은 뒤처질 수 있다 — `--all-approved` 가 0건을 잡으면');
  L.push('   위 표의 큐 id 를 하나씩 인자로 줘서 받는다(`collect_pending_law.py <id>`).');
  L.push(`2. **위 1번의 건별 위키 목록을 하나씩 열어**, 그 건의 개정 전/후를 대조해 고칠 자리를 찾는다.`);
  L.push('   근거 조문 표의 **법령 칸·조문 칸은 게이트가 그 칸으로 원문을 여는 자리**라 규약대로 적는다.');
  if (anyFuture) {
    L.push('3. **아직 시행 전인 건은 시행일 마커를 쓴다**(`_SCHEMA.md` §10). 옛 서술은 `<!--시행전 YYYYMMDD-->…<!--/시행전-->`,');
    L.push('   새 서술은 `<!--시행 YYYYMMDD-->…<!--/시행-->` — 날짜는 **그 건의 시행일**을 쓴다(위 표 참조).');
    L.push('   표 칸 안에서는 **한 줄 안에서 열고 닫는 인라인형만** 쓴다.');
    L.push('   ⚠근거 조문 표의 **법령 칸·조문 칸에는 마커를 넣지 않는다.** 조문 번호 자체가 바뀌는 개정은 마커로 표현할 수 없다.');
    L.push('   ⚠**승인 게이트**: 이 건들은 승인돼 있으므로, 마커를 넣어 두면 각 시행일부터 챗봇이 자동으로 새 서술을 낸다.');
    L.push('   **이미 시행 중인 건은 마커를 쓰지 않고 본문을 직접 고친다.**');
  } else {
    L.push('3. **전부 이미 시행 중이므로 본문을 직접 고친다**(마커를 쓰지 않는다). 옛 서술을 새 서술로 바꾼다.');
  }
  L.push('4. 고친 페이지마다 「## 변경 이력」 표 끝에 한 줄 추가한다(무엇을 왜 고쳤는지, 근거 조문).');
  L.push('5. **검사**를 돌린다. 저장소 루트에서:');
  L.push('   ```');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/lint_stage_markers.py');
  L.push('   python3 local_server/knowledge/legal/_dashboard/loop/lint_index.py && python3 local_server/knowledge/legal/_dashboard/loop/lint_build.py');
  L.push('   bash scripts/refactor/verify_all.sh');
  L.push('   ```');
  L.push('   **기준선 대비 나빠진 문항이 0** 이어야 한다. 나빠졌으면 커밋하지 말고 원인을 찾는다.');
  L.push('6. 고친 파일 경로를 **개별 지정해** 커밋한다(`git add -A` 금지). 문서·색인 재생성물을 **같은 커밋**에 담는다.');
  L.push('   건이 많으므로 **법마다 한 커밋**으로 나누는 편이 나중에 되짚기 쉽다.');
  L.push('');
  L.push(`## ${secDo + 1}. 지키는 규칙`);
  L.push('');
  L.push('- **추측 금지.** 원문에 없는 것을 지어내지 않는다. 못 찾았으면 "못 찾았다"고 적는다.');
  L.push('- **원문 발췌는 복붙.** 위 1번의 「개정 후」 본문을 손으로 고쳐 쓰지 않는다.');
  L.push('- 원문이 정하지 않은 것(해석 다툼)은 단정하지 말고 `⚠REVIEW` 로 남긴다.');
  L.push('- 시행일이 지난 뒤에는 `_dashboard/loop/fold_effective.py` 가 마커를 평문으로 접는다(그때 조문 번호 재편은 사람이 표를 고친다).');
  L.push('- **한 건 끝낼 때마다 검사를 돌린다.** 여러 건을 몰아서 고친 뒤 한꺼번에 돌리면 어느 건이 숫자를 떨어뜨렸는지 못 가른다.');

  return { ok: true, text: L.join('\n'), count: rows.length, detailed: detail.length, listed: brief.length, pages: pageCount };
}

module.exports = { buildWikiBrief, buildBulkWikiBrief, candidatePages, articleLabel };
