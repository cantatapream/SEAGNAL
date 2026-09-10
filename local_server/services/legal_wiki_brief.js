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
 * [연계]
 * - routes/legal.js  → GET /api/legal/amendments/:id/wiki-brief
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
function buildWikiBrief(am, today) {
  if (!am) return { ok: false, text: '', pages: [], error: '항목을 찾지 못했습니다.' };
  const cur = am.현재 || {};
  const lawName = am.법령명 || am.law || '';
  const layer = am.layer || '법률';
  const eff = String(cur.시행일자 || '');
  const future = /^\d{8}$/.test(eff) && eff > String(today || '');
  const arts = am.changed_articles || [];
  const artKeys = arts.map((a) => ({ no: String(a.조문번호 || ''), ga: String(a.조문가지번호 || ''), label: articleLabel(a.조문번호, a.조문가지번호) }));
  const pages = candidatePages(lawName, artKeys);
  const hit = pages.filter((p) => p.hits.length);
  const rest = pages.filter((p) => !p.hits.length);

  const L = [];
  L.push(`# 위키 반영 요청 — ${lawName} ${layer} (시행 ${ymd(eff) || '미상'})`);
  L.push('');
  L.push('SEAGNAL 해양법령 위키(나리야)의 개정 반영 작업이다. 아래 개정은 **관리자가 이미 승인**했다.');
  L.push('작업 규칙은 저장소의 `local_server/knowledge/legal/_SCHEMA.md` 를 따른다(특히 원문 발췌는 복붙, 근거 조문 표 규약, §10 시행일 마커).');
  L.push('');
  L.push('## 1. 무엇이 바뀌었나');
  L.push('');
  L.push(`- 법령: **${lawName}** (${layer})`);
  if (cur.공포번호 || cur.공포일자) L.push(`- 공포: ${[cur.공포번호 && `제${cur.공포번호}호`, ymd(cur.공포일자)].filter(Boolean).join(' · ')}`);
  L.push(`- 시행일: **${ymd(eff) || '미상'}**${future ? ' — 아직 시행 전이다' : ' — 이미 시행 중이다'}`);
  if (cur.MST) L.push(`- 원문 확인: https://www.law.go.kr/lsInfoP.do?lsiSeq=${cur.MST}${eff ? '&efYd=' + eff : ''}`);
  L.push(`- 개정검토 큐 id: \`${am.id}\``);
  L.push('');
  if (!arts.length) {
    L.push('> ⚠ 이 항목에는 **바뀐 조문 목록이 없다.** 관리자 화면에서 「지금 스캔」을 다시 돌려 조문 정보를 받은 뒤 이 글을 다시 뽑아라.');
    L.push('');
  }
  for (const a of arts) {
    const lab = articleLabel(a.조문번호, a.조문가지번호);
    L.push(`### ${lab}${a.조문제목 ? `(${a.조문제목})` : ''}${a.신설 ? ' — **신설**' : (a.조문제개정유형 ? ` — ${a.조문제개정유형}` : '')}${a.조문시행일자 ? ` · 시행 ${ymd(a.조문시행일자)}` : ''}`);
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

  L.push('## 2. 어느 위키를 봐야 하나');
  L.push('');
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
      L.push(`**그 법을 타법으로 인용하는 페이지 ${citeRest.length}쪽** — 인용 문구가 옛 내용이면 함께 고친다.`);
      L.push('');
      for (const p of citeRest) L.push(`- \`wiki/${KIND_DIR[p.kind] || p.kind}/${p.file}.md\` (${p.law})`);
      L.push('');
    }
  }

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

module.exports = { buildWikiBrief, candidatePages, articleLabel };
