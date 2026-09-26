/**
 * ============================================================================
 * 파일명: _dashboard/loop/live_probe.js
 * 역할  : ★게이트가 아니다 — **조사용 탐침**이다.
 * ============================================================================
 *
 * [왜 있나 — 2026-09-22, 일감 L-1·L-4·L-5·L-6]
 * 이 라운드에서 찾은 「사용자 피해」 P-* 19건은 **전부 코드를 읽고 추론한 것**이지
 * "실제로 물어보니 그랬다"가 아니다. 독립 4벌(D·E·F·G) 중 아무도 챗봇에 질문을
 * 넣어 보지 못했다(그때는 Gemini 키가 없으면 안 되는 줄 알았다).
 *
 * 그런데 답변 경로에서 Gemini 를 부르는 6군데 중 **키가 없으면 멈추는 것은
 * `synthesizeAnswerStream`(최종 답변 글쓰기) 하나뿐**이다(`legal_retriever.js:3142`).
 * 그 함수는 `contextPages` 를 받아 글만 쓴다 — 검색·근거 선정·근거 조문 표·
 * 서식·별표·연락처는 **전부 그 앞에서** 끝난다.
 * ⇒ **「무엇을 찾아 무엇을 건네는가」는 키 없이 전부 잴 수 있다.**
 *
 * [무엇을 재나] 골든 291문항을 `R.search()` 에 실제로 넣고 문항마다 기록한다.
 *   · L-4  근거 조문 행에 소관부서 연락처가 붙는 비율 (P-12)
 *   · L-5  `buildContextBlock` 이 LLM 에 넘기는 글자 수 (P-19 — 상한이 없다)
 *   · L-6  확정 오기 5건이 실린 쪽이 실제로 근거로 뽑히나 (P-1·P-2)
 *   · 덤   canonical/draft 섞임, 글로서리가 라우팅에 실제로 기여했나
 *
 * [★L-1 은 여기서 재지 않는다 — 이미 재고 있는 것이 있다]
 * 처음에 "기대한 법(`expect_law`)의 쪽이 근거에 몇 위로 들어왔나"를 재려다 **자가 틀렸다.**
 *   ① `expect_law` 에 낫표와 계층이 붙는다 — `「공유수면 관리 및 매립에 관한 법률 시행령」`.
 *      위키 쪽 슬러그는 기준법 이름(`공유수면관리및매립에관한법률__…`)이라 문자열로는 안 맞는다.
 *   ② `습지보전법` 처럼 **타법**을 기대하는 문항이 있다. 그 법의 쪽이 없는 것이 정상이고,
 *      답은 갯벌법 쪽이 그 조를 인용해서 낸다.
 * 8문항 표본에서 "기대 법이 아예 없음 5건"이라는 **허수**가 나왔고, 열어 보니 전부 위 두 경우였다.
 * 올바른 물음은 *"그 기대 근거 **행**을 가진 쪽이 검색 후보에 들어왔나"* 이고,
 * 그것은 **V5-7 `golden_eval.js` 가 이미 운영 색인으로 재고 있다**(2026-09-22 실측:
 * 291문항 중 `search` 13건 4.7% — 행은 위키에 있는데 그 쪽이 후보에 안 옴).
 * 여기서 다시 세면 자가 하나 더 늘 뿐이다(§0-E 규칙 5 · L-303).
 *
 * [왜 게이트가 아닌가] 기준선이 없다. 이 탐침은 **처음으로 숫자를 만드는 쪽**이고,
 * 그 숫자로 무엇을 게이트에 걸지 정하는 것이 다음 단계다. 지금 verify_all 에
 * 등록하면 기준선 없는 검사가 하나 더 느는 것뿐이다(G-15 — 191개 중 23개만 불린다).
 *
 * [쓰는 법] node local_server/knowledge/legal/_dashboard/loop/live_probe.js [문항수]
 * [연계] 결과 `_dashboard/live_probe_<돌린날>.json`(회차마다 따로 남는다) ·
 *        문항 `_dashboard/loop/pinned/golden_questions.json` ·
 *        배경 `_dashboard/d_standard_2026-09-22/00_WORKLIST.md` L단계
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const HERE = __dirname;
const QFILE = path.join(HERE, 'pinned', 'golden_questions.json');
// ★파일 이름은 **돌린 날짜**로 짓는다 (2026-09-25 고침)
//   [무슨 일이 있었나] 여기에 `live_probe_2026-09-22.json` 이 박여 있어서, 오늘 다시 돌리자
//   **9/22 측정 기록이 그 자리에서 덮였다.** 깃에 그 판이 있어 되살렸지만(`git show HEAD:…`),
//   기록을 재는 도구가 기록을 지우는 꼴이었다. 앞으로는 회차마다 따로 남는다.
//   `--out <경로>` 로 자리를 지정할 수도 있다.
// 날짜는 **UTC 기준**으로 적는다 — 이 저장소의 선례가 그렇다(`live_probe_2026-09-22.json` 의
// 생성 시각이 `2026-09-22T15:42Z`(KST 로는 9/23 00:42)인데 파일 이름은 9-22 다).
const RUN_DAY = new Date().toISOString().slice(0, 10);
const OUT = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : path.join(HERE, '..', `live_probe_${RUN_DAY}.json`);

// P-1·P-2 로 확정한 오기가 든 쪽 — 실제로 근거로 뽑히는지 본다(L-6).
// ⚠쪽 식별자는 `p.file` 이고 **폴더 접두사가 없다**(`수산업협동조합법__합병_…`).
//   처음에 `concepts/…`·`annexes/…` 를 붙여 두었다가 12개 겨냥 질문에서 전부 "없음"이라는
//   허수를 냈다. 실제로는 수협법 쪽이 **1위**로 들어와 있었다. 접두사를 뺀다.
const SUSPECT = [
  '선박안전법__행정규칙_위험물선박운송기준_별표21_냉동컨테이너의냉동능력등',
  '수산업협동조합법__합병_분할_해산_청산',
  '선박안전법__형식승인및검정',
  '선박안전법__특수선박구조기준',
  '마리나항만의조성및관리등에관한법률__마리나업등록',
];

const slugOf = (p) => String(p.file || p.slug || p.id || '').replace(/\.md$/, '');

(async () => {
  const limit = Number(process.argv[2] || 0);
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || [];
  const list = limit > 0 ? qs.slice(0, limit) : qs;
  const rows = [];
  let n = 0;

  for (const q of list) {
    n++;
    if (n % 25 === 0) process.stderr.write(`  ...${n}/${list.length}\n`);
    const rec = { q: q.question, expect_law: q.expect_law || '', expect_article: q.expect_article || '' };
    try {
      const g = R.glossaryExpand(q.question);
      rec.glossary_forced = (g.forcedSlugs || []).length;

      const r = await R.search(q.question);
      const cp = r.contextPages || [];
      rec.pages = cp.length;
      rec.chars = R.buildContextBlock(cp).length;          // L-5 · P-19

      const slugs = cp.map(slugOf);
      rec.status = { canonical: 0, draft: 0, other: 0 };
      cp.forEach((p) => {
        const s = p.status === 'canonical' ? 'canonical' : (p.status === 'draft' ? 'draft' : 'other');
        rec.status[s]++;
      });

      // L-6 — 오기 쪽이 근거로 뽑혔나
      rec.suspect_hit = SUSPECT.filter((s) => slugs.includes(s));

      // L-4 — 근거 조문 행에 연락처가 붙나 (상위 5쪽만 — 전수는 너무 무겁다)
      let rowsTotal = 0, rowsContact = 0;
      for (const p of cp.slice(0, 5)) {
        const body = p.body || p.text || '';
        if (!body) continue;
        for (const c of R.extractCitationChain(body)) {
          rowsTotal++;
          if (R.lookupContact(c.law)) rowsContact++;
        }
      }
      rec.chain_rows = rowsTotal;
      rec.chain_contact = rowsContact;
    } catch (e) {
      rec.error = String(e && e.message || e).slice(0, 200);
    }
    rows.push(rec);
  }

  const ok = rows.filter((r) => !r.error);
  const sum = (f) => ok.reduce((a, r) => a + (f(r) || 0), 0);
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '—');
  const chars = ok.map((r) => r.chars).sort((a, b) => a - b);
  const q50 = chars[Math.floor(chars.length * 0.5)] || 0;
  const q90 = chars[Math.floor(chars.length * 0.9)] || 0;

  const report = {
    생성: new Date().toISOString(),
    문항: rows.length,
    오류: rows.length - ok.length,
    'L-1': 'V5-7 이 잰다 — 291문항 중 search 실패 13건(4.7%). 여기서 다시 세지 않는다',
    'L-4 근거 행': sum((r) => r.chain_rows),
    'L-4 연락처 붙은 행': sum((r) => r.chain_contact),
    'L-4 연락처 비율': pct(sum((r) => r.chain_contact), sum((r) => r.chain_rows)),
    'L-5 근거자료 글자 평균': Math.round(sum((r) => r.chars) / (ok.length || 1)),
    'L-5 중앙값': q50,
    'L-5 상위 10%': q90,
    'L-5 최대': chars[chars.length - 1] || 0,
    'L-5 쪽수 평균': Math.round(sum((r) => r.pages) / (ok.length || 1)),
    'L-6 오기 쪽이 근거로 뽑힌 문항': ok.filter((r) => (r.suspect_hit || []).length).length,
    'draft 가 섞인 문항': ok.filter((r) => r.status && r.status.draft > 0).length,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');

  for (const [k, v] of Object.entries(report)) {
    if (k === 'rows') continue;
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
  console.log(`\n  → ${path.relative(process.cwd(), OUT)}`);
})();
