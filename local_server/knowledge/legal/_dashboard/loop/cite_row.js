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
 *   node cite_row.js ... --arts "부칙 제3조"            → 부칙 조문. 같은 조번호가 여럿이면 아래처럼 골라 준다
 *   node cite_row.js ... --arts "부칙 제3조" --sup 제15009호   → 어느 부칙인지 정한다
 *   node cite_row.js ... --from 항만법                   → 같은 이름의 원문이 두 법 폴더에 있을 때 고른다
 *                                                        (기본값은 페이지 이름에서 딴 그 페이지의 법)
 *
 * [부칙을 왜 따로 받나 — 2026-08-24, 사서 여덟 명이 같은 벽에 부딪혔다]
 * 부칙은 개정할 때마다 새로 붙고 **조번호가 제1조부터 다시 시작**한다. 그래서 한 법 안에
 * `제3조` 가 본문에 하나, 부칙마다 하나씩 여러 개 있다. 종전 이 도구는
 *   ① `--arts "부칙 제3조"` 를 주면 "조문 표기가 아니다"로 거절했고,
 *   ② 사서가 우회로 `--arts "제3조"` 를 주면 **에러 없이 성공하면서 본문 제3조를 채웠다.**
 * ②가 훨씬 위험하다 — 요지도 시행일도 틀린 채로 조용히 지나간다(항로표지법에서 실제로 재현:
 * 정답은 부칙 '일반적 경과조치'인데 본문 '국가의 책무'가 들어갔다). 사서들이 원문을 손으로
 * 대조해 알아채고 --apply 를 안 해서 사고는 안 났지만, 그건 사람이 매번 대조해야만 안전하다는 뜻이다.
 * 이제 본문 조회는 **부칙 구역을 아예 보지 않고**, 부칙은 `부칙 제N조` 로만 받는다.
 *
 * ⚠**부칙 행의 시행일 칸은 비운다(`—`).** 부칙 자체의 시행일은 그 부칙 제1조가 문장으로 정하는
 *   일이 많아("공포 후 6개월이 경과한 날") 기계로 못 뽑는다. 원문 머리에 있는 것은 **공포일**이라,
 *   그걸 시행일 칸에 적으면 거짓이 된다. 공포일은 조문 칸 안(`부칙<제15009호,2017.10.31>`)에 남는다.
 *
 * [연계] ← raw/<분야>/<법>/{법률,시행령,시행규칙}.txt·행정규칙/*.txt (원문 존재·시행일·조 제목)
 *        ← services/legal_retriever.js (extractCitationChain·filterCitationChainByAnswer — **챗봇이
 *          쓰는 그 함수를 그대로 태운다.** 따로 구현하면 검사와 코드가 어긋난다 — L-136)
 *        → wiki 아래 md 의 '## 근거 조문' 표 (--apply 일 때만 씀)
 * [로드 순서] 단독 실행 CLI.
 */
const fs = require('fs');
const path = require('path');
// ★저장소 안 상대경로로 적는다 (2026-09-22, 2-21 · G-31).
//   `/home/user/SEAGNAL/...` 로 박아 두면 **이 컨테이너 한 대에서만** 돈다.
//   `verify_all.sh` 주석이 "실패하면 이걸로 고쳐라"라고 이 파일을 가리키므로,
//   그 말을 따르는 **다음 사람의 컴퓨터에서 곧바로 깨진다**(G-31 의 지연된 형태).
const R = require('../../../../services/legal_retriever.js');

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
function resolveLaw(input, prefer) {
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
    // ★법령 칸에는 **띄어쓰기까지 정식인 이름**을 쓴다(2026-08-24, 사서 보고로 고침).
    //   종전에는 폴더 이름(`해양환경보전및활용에관한법률`)을 그대로 뱉었는데, 위키 표는 전부
    //   `해양환경 보전 및 활용에 관한 법률` 꼴이다(실측: 전자 0행, 후자 59행). 그래서 사서가
    //   도구가 준 행을 매번 손으로 고쳐 넣었다 — 손이 닿는 순간 도구가 막아 주던 게 무의미해진다.
    //   정식 이름은 raw/<분야>/<법>/_meta.json 의 `법령명`(DRF 응답 그대로)에 있다.
    let official = hit.law;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(hit.dir, '_meta.json'), 'utf8'));
      if (meta['법령명'] && flat(meta['법령명']) === flat(hit.law)) official = meta['법령명'];
    } catch (e) { /* _meta.json 이 없거나 깨졌으면 폴더 이름을 그대로 쓴다 */ }
    return { dir: hit.dir, path: p, name: (tier ? official + ' ' + tier : official) };
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
  // ★이름이 **정확히 같은 것**이 있으면 그것만 쓴다(2026-08-24, 사서 보고로 발견).
  //   위 걸러내기는 부분일치도 후보로 담기 때문에, 같은 폴더에 파일명이 접두어 관계인 원문이
  //   둘 있으면 **정확한 전체 이름을 줘도** 늘 "여러 원문이 잡힌다"로 막혔다. 실측 사례:
  //     농산물우수관리인증기관지정및운영요령.txt  ·  농산물우수관리인증기관지정및운영요령_별표.txt
  //   `_별표` 처럼 뒤에 뭐가 붙은 파일이 흔해서, 이 함정은 다른 법에도 널려 있다.
  //   그래서 사서들이 도구를 못 쓰고 근거 조문 행을 손으로 만들게 됐다 — 그 도구가 하는
  //   ①원문에 그 조가 진짜 있나 ②챗봇이 꺼낼 수 있나 확인이 통째로 빠지는 셈이다(§8-A ⓪).
  //   ★같은 고시가 **두 법 폴더에 각각 수집돼 있는** 경우가 있다(2026-08-24, 항만법 사서 보고).
  //     실측: 「무역항 등의 항만시설 사용 및 사용료에 관한 규정」이 항로표지법·항만법 두 폴더에
  //     같은 ID(2100000270622)로 들어 있다(본문 3,637줄 동일, 머리말의 위임근거 표기만 다르다).
  //     이때는 **그 페이지가 속한 법의 사본**을 쓴다 — 지어내는 것이 아니라 어느 것이든 같은 원문이고,
  //     페이지의 법 폴더에 있는 사본이 그 페이지가 근거로 삼는 그것이다.
  //     그래도 안 갈리면 종전대로 거절한다. `--from <법폴더이름>` 으로 직접 정할 수도 있다.
  const narrow = list => {
    if (list.length < 2 || !prefer) return list;
    const mine = list.filter(c => flat(path.basename(c.dir)) === flat(prefer));
    if (mine.length === 1) {
      console.error(`  ↳ 같은 이름의 원문이 ${list.length}개라 이 페이지의 법(${path.basename(mine[0].dir)}) 폴더 사본을 쓴다.`);
      return mine;
    }
    return list;
  };
  // ★행정규칙도 **띄어쓰기까지 정식인 이름**을 쓴다(법률 쪽과 같은 이유·같은 실측).
  //   고시 원문 1행이 `[고시/행정규칙] 무역항 등의 항만시설 사용 및 사용료에 관한 규정` 꼴로
  //   정식 이름을 갖고 있다(750개 중 630개). 위키 표도 그 꼴을 쓴다 —
  //   실측: 파일명과 띄어쓰기만 다른 559개 고시에 대해 정식 이름 619회 · 파일명 꼴 38회.
  const officialName = c => {
    try {
      const m = /^\[고시\/행정규칙\]\s*(.+)$/.exec(fs.readFileSync(c.path, 'utf8').split('\n')[0].trim());
      if (m && flat(m[1]) === flat(c.name)) return Object.assign({}, c, { name: m[1].trim() });
    } catch (e) { /* 못 읽으면 파일명을 그대로 쓴다 */ }
    return c;
  };
  const exact = narrow(cands.filter(c => flat(c.name) === s));
  if (exact.length === 1) return officialName(exact[0]);
  if (exact.length > 1) die(`「${input}」 와 이름이 똑같은 원문이 ${exact.length}개다 — 폴더를 확인하라:\n   ` +
    exact.map(c => c.path).join('\n   ') + `\n   → --from <법폴더이름> 으로 정할 수 있다.`);
  const near = narrow(cands);
  if (near.length === 1) return officialName(near[0]);
  if (near.length > 1) die(`「${input}」 로 여러 원문이 잡힌다 — 정확한 이름을 쓰라:\n   ` +
    near.map(c => c.name).join('\n   '));
  die(`「${input}」 의 원문을 raw 에서 못 찾았다. 정식 명칭을 계층까지 정확히 쓰라(예: "해운법 시행규칙").`);
}

/* ── ② 조문 표기 정규화 + ③ 원문 존재 확인 ────────────────────────────────── */

/**
 * `제 10 조의3 1항` 같은 입력을 `제10조의3제1항` 표준꼴로 고친다. 조문이 아니면 null.
 * `부칙 제4조` 꼴도 받는다 — 앞에 `부칙 ` 을 붙인 채로 돌려준다(아래 부칙 갈래가 알아본다).
 */
function normArticle(s) {
  let t = String(s || '').replace(/\s+/g, '');
  // ★부칙 지원(2026-08-24 신설). 사서 다섯 명이 각각 같은 벽에 부딪혀 보고했다.
  //   종전에는 ①`부칙 제4조` 를 주면 "조문 표기가 아니다"로 거부하고
  //   ②우회로 `제4조` 를 주면 **에러 없이 통과하면서 본문 제4조를 채웠다** — 조용히 틀린
  //   조문을 넣는 쪽이라 더 위험했다(사서들이 알아채고 --apply 를 안 해서 사고는 안 났다).
  if (/^부칙/.test(t)) {
    const inner = normArticle(t.replace(/^부칙/, ''));
    return inner ? '부칙 ' + inner : null;
  }
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
/** 부칙 절 머리 — `부칙 <제19572호,2023.7.25>` · `부칙(정부조직법) <제8852호,2008.2.29>` */
const ADDENDA_HEAD = /^\s*부\s*칙\s*(?:\([^)]*\))?\s*[<〈]\s*제?([^,>〉]+?)\s*,\s*([^>〉]+)[>〉]/;
/** 부칙 구역이 시작되는 줄 — 호수가 안 붙은 맨 `부칙` 한 줄짜리 구분선도 포함한다. */
const ADDENDA_START = /^부\s*칙\s*(?:$|[(<〈])/;

/**
 * 이 법의 부칙이 실려 있을 수 있는 원문 파일들. 본체 파일 + 같은 폴더의 `부칙*.txt`.
 * 예: addendaFiles({dir:'…/수산업협동조합법', path:'…/법률.txt'}) → ['…/법률.txt', '…/부칙.txt']
 * [연계] 부칙만 따로 받아 둔 법이 23곳 있다(도선법·해상교통안전법 등). 본체만 보면 "없다"고 거절한다.
 *        ⚠계층이 다른 부칙 파일은 섞지 않는다 — `부칙_시행령.txt` 를 법률 조회에 쓰면 남의 조를 준다.
 */
function addendaFiles(law) {
  const base = path.basename(law.path);
  const tierM = /^(시행규칙|시행령|시행규정|법률)/.exec(base);
  const out = [law.path];
  // ★행정규칙(고시·훈령)은 자기 파일만 본다(2026-08-24, 시험 중 발견).
  //   종전 코드는 계층을 못 가리면 '법률'로 쳐서, 군산해양경찰서 고시의 부칙을 물었더니
  //   같은 폴더 위의 **해상교통안전법 부칙_법률.txt** 를 뒤져 남의 법 부칙을 내밀었다.
  if (!tierM || path.dirname(law.path) !== law.dir) return out;
  const tier = tierM[1] === '시행규정' ? '시행규칙' : tierM[1];
  for (const e of fs.readdirSync(law.dir)) {
    if (!/^부칙.*\.txt$/.test(e)) continue;
    const suffix = e.replace(/^부칙/, '').replace(/\.txt$/, '');
    if (suffix ? !suffix.includes(tier) : tier !== '법률') continue;
    out.push(path.join(law.dir, e));
  }
  return out;
}

/**
 * **부칙** 조문을 찾는다. 부칙은 개정 때마다 새로 붙고 **조번호가 1부터 다시 시작**하므로
 * 같은 `제2조` 가 여러 개 있을 수 있다 — 그래서 어느 부칙인지(호수·공포일)까지 함께 돌려준다.
 * 예: lookupAddenda(['…/법률.txt'], '제3조')
 *       → [{호:'제15009호', 일자:'2017.10.31', title:'일반적 경과조치', 효력:'2017-10-31', file:'…'}]
 * @param {string[]} paths 볼 원문 파일들(addendaFiles 결과)
 * @param {string} art `제4조` 꼴(부칙 접두어는 뗀 것)
 * @returns {Array} 찾은 것 전부. 0개면 없는 것, 2개 이상이면 **사서가 호수를 정해야 한다**.
 * [연계] ← 본체 반복문. 여러 개일 때 **임의로 하나 고르지 않는다**(지어내기 0).
 */
function lookupAddenda(paths, art) {
  const head = /^제(\d+)조(?:의(\d+))?/.exec(art);
  const want = new RegExp('^제\\s*' + head[1] + '조' + (head[2] ? '의' + head[2] : '') +
                          '\\s*(?:\\(([^)]{1,60})\\))?(?:\\s|$)');
  const hits = [];
  for (const rp of paths) {
    let cur = null;
    for (const line of fs.readFileSync(rp, 'utf8').split('\n')) {
      const h = ADDENDA_HEAD.exec(line);
      if (h) { cur = { 호: '제' + h[1].replace(/^제/, '') + (/호$/.test(h[1]) ? '' : '호'), 일자: h[2].trim() }; continue; }
      // ★고시·훈령의 부칙은 머리에 호수·일자가 없이 `부 칙` 한 줄뿐인 경우가 많다(실측 18개 파일).
      //   그 조문도 찾아는 준다 — 다만 호수가 없으면 챗봇이 그 행을 근거로 못 꺼내므로
      //   본체에서 이유를 밝히고 거절한다(빈 호수로 죽은 행을 만들지 않는다).
      if (ADDENDA_START.test(line.trim())) { cur = { 호: null, 일자: null }; continue; }
      if (!cur) continue;                       // 부칙 절 밖(본문·머리말)은 보지 않는다
      const m = want.exec(line.trim());
      if (!m) continue;
      const d = /(\d{4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/.exec(cur.일자 || '');
      hits.push({
        호: cur.호, 일자: cur.일자 || '—', file: rp,
        title: (m[1] || line.trim().slice(0, 60)).trim(),
        // ⚠이 날짜는 **공포일**이다. 부칙 자체의 시행일은 그 부칙 제1조가 문장으로 정하는 경우가
        //   많아(예: "공포 후 6개월이 경과한 날") 기계로 못 뽑는다 — 그래서 시행일 칸은 비워 둔다.
        공포: d ? `${d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')}` : '—',
      });
    }
  }
  // 같은 부칙이 본체 파일과 `부칙*.txt` 양쪽에 다 실려 있는 법이 있다(해상교통안전법 등).
  // 같은 호수·같은 제목이면 한 건으로 친다 — 안 그러면 "6개다"라며 못 고르게 막는다.
  const seen = new Set();
  return hits.filter(h => {
    const k = (h.호 || '?') + '|' + h.title;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function lookupArticle(rawPath, art) {
  const body = fs.readFileSync(rawPath, 'utf8');
  const head = /^제(\d+)조(?:의(\d+))?/.exec(art);
  const key = '[제' + head[1] + '조' + (head[2] ? '의' + head[2] : '') + ']';
  // ★부칙 구역은 **보지 않는다**(2026-08-24, 항로표지법 사서 보고로 잡음).
  //   부칙은 개정 때마다 조번호가 1부터 다시 붙어 본문과 번호가 겹친다. 종전에는 아래 두 번째
  //   갈래(평문 `제N조(제목)` 꼴)가 파일 끝까지 훑어서, **본문에 없는 조를 부칙에서 집어 오고도
  //   에러 없이 성공**했다. 조용히 틀린 요지·시행일이 들어가는 쪽이라 사서가 원문을 직접 대조하지
  //   않으면 못 잡는다. 부칙 조문은 `--arts "부칙 제3조"` 로 따로 받는다.
  const lines = [];
  for (const line of body.split('\n')) {
    if (ADDENDA_START.test(line.trim())) break;
    lines.push(line);
  }
  for (const line of lines) {
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
  for (const line of lines) {
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
// 같은 조번호의 부칙이 여러 개일 때 어느 부칙인지 정한다. 예: --sup 제15009호
const supIn = arg('--sup');
const APPLY = argv.includes('--apply');

// 같은 이름의 원문이 두 법 폴더에 있을 때 어느 쪽을 쓸지 — 기본값은 이 페이지의 법이다.
const preferLaw = arg('--from') || path.basename(pagePath).replace(/\.md$/, '').split('__')[0];
const law = resolveLaw(lawIn, preferLaw);
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
  if (!art) die(`"${one}" 은 조문 표기가 아니다. 조문 칸에는 조문만 쓴다(제6조 / 제8조의2제2항 꼴 · 부칙은 "부칙 제3조").`);

  let artCell, 시행일, title;
  if (art.startsWith('부칙 ')) {
    // ── 부칙 갈래 ──────────────────────────────────────────────────────────
    const bare = art.slice(3);
    let hits = lookupAddenda(addendaFiles(law), bare);
    if (supIn) {
      const want = flat(supIn).replace(/^제?/, '제').replace(/호?$/, '호');
      hits = hits.filter(h => flat(h.호) === want);
      if (!hits.length) die(`「${law.name}」 부칙 ${want} 에 ${bare} 이 없다 — 호수나 조번호를 확인하라.`);
    }
    if (!hits.length) die(`「${law.name}」 원문의 부칙에 ${bare} 이 없다(찾아본 파일: ` +
      addendaFiles(law).map(f => path.relative(LEGAL, f)).join(', ') + `). 표에 넣지 않는다.`);
    if (hits.length > 1) die(`「${law.name}」 에 부칙 ${bare} 이 ${hits.length}개다 — 부칙은 개정마다 ` +
      `조번호가 1부터 다시 붙는다. 어느 부칙인지 --sup 으로 정하라:\n   ` +
      hits.map(h => (h.호 ? `--sup ${h.호}   (${h.일자}) ${h.title}`
                          : `(호수 없는 부칙 — 원문이 \`부 칙\` 한 줄뿐이라 고를 수 없다) ${h.title}`))
        .join('\n   '));
    const h = hits[0];
    if (!h.호) die(`「${law.name}」 의 부칙 머리에 호수(발령번호)가 적혀 있지 않다` +
      `(${path.relative(LEGAL, h.file)} — 원문이 \`부 칙\` 한 줄뿐이다).\n` +
      `   챗봇은 부칙 행을 **호수·공포일**로 답변과 맞추므로, 호수가 없으면 그 행은 근거로 못 뜬다.\n` +
      `   → 이 부칙은 표에 넣지 않는다. 근거로 꼭 필요하면 원문 재수집으로 발령번호를 받아야 한다.`);
    // 위키에서 가장 많이 쓰는 꼴(전 위키 16행)에 맞춘다: `부칙<제15009호,2017.10.31> 제3조`
    // ★챗봇은 부칙 행을 **조번호가 아니라 호수·공포일**로 답변과 맞춘다(legal_retriever.js).
    //   그래서 호수를 칸에 반드시 남겨야 한다 — 빠지면 그 행은 근거로 못 뜬다.
    artCell = `부칙<${h.호},${h.일자}> ${bare}`;
    // ⚠부칙 자체의 시행일은 그 부칙 제1조가 문장으로 정하는 일이 많아 기계로 못 뽑는다.
    //   공포일을 시행일 칸에 적으면 거짓이 되므로 비워 둔다(공포일은 조문 칸 안에 남는다).
    시행일 = '—';
    title = h.title;
    console.error(`  ↳ 부칙 확인: ${path.relative(LEGAL, h.file)} — ${h.호}(${h.일자}) ${bare} ${h.title}` +
      `\n     ⚠시행일 칸은 비웠다(원문 부칙 머리에는 공포일 ${h.공포} 만 있다).`);
  } else {
    const info = lookupArticle(law.path, art);
    if (!info) die(`「${law.name}」 원문에 ${art} 이 없다(${path.relative(LEGAL, law.path)}). ` +
      `계층을 잘못 짚었거나(법률↔시행령↔시행규칙) 아직 수집 전이다 — 표에 넣지 않는다.` +
      `\n   부칙 조문이라면 --arts "부칙 ${art}" 로 다시 부르라.`);
    artCell = art;
    시행일 = info.효력;
    title = info.title;
  }

  if (existing.has(flat(law.name) + '|' + flat(artCell))) {
    console.log(`  ⏭️  이미 있음: ${law.name} ${artCell}`);
    continue;
  }
  // ★표 머리글은 페이지마다 조금씩 다르다 — 낱말이 정확히 같을 때만 채우면 빈 칸이 생긴다.
  //   실측(전 위키 1,231개 표): `법령명`(640) · `법령`(579) 외에 `법령/고시`(5) · `시행일/개정일`(1) 이 있다.
  //   `법령/고시` 페이지에서는 법령 칸이 통째로 비어 도달성 증명이 실패했고(수산업법 2건 막힘),
  //   사서는 원인을 알 수 없었다. 그래서 **낱말이 들어 있는지**로 짚는다.
  const pick = c => {
    if (/조문/.test(c)) return artCell;
    if (/법령|고시/.test(c)) return law.name;
    if (/시행일|개정일/.test(c)) return 시행일;
    if (/요지/.test(c)) return gist || title || '—';
    return '—';                       // `단계` 처럼 도구가 정할 수 없는 칸은 사서가 채운다
  };
  const row = '| ' + tbl.cols.map(pick).join(' | ') + ' |';
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
