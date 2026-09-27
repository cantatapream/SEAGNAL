/**
 * ============================================================================
 * 파일명: _dashboard/loop/l8_answer_quality.js
 * 역할  : ★게이트가 아니다 — **조사용 탐침**(일감 L-8 「답변 문장 품질」).
 * ============================================================================
 *
 * [왜 있나 — 일감 L-8 · Q-11(사용자 확정: 15문항)]
 * 지금까지의 라이브 탐침(`live_probe.js`·`live_article_probe.js`)은 **「무엇을 찾아 무엇을 건네는가」**
 * 까지만 잰다. 키가 없어도 되는 구간이다. 그러나 **답변 문장 자체**가 규약대로 나오는지는
 * 제미나이가 실제로 글을 써야 알 수 있고, 이 작업 컨테이너에는 키가 없다.
 * ⇒ **운영 서버에 묻는다.** 운영(Fly.io)에는 `GEMINI_API_KEY_26_8` 이 있다(L-8 칸 기록).
 *   `/api/health` 로 먼저 살아 있는지 보고 시작한다(돈이 안 드는 확인).
 *
 * [★채점표를 내가 만들지 않는다 — 프롬프트가 요구하는 문구를 그대로 쓴다]
 * 검사 항목은 전부 `legal_retriever.ANSWER_RULES_BODY`(모델에게 실제로 주는 규약)에서 따왔다.
 * 내가 "이랬으면 좋겠다"고 생각한 것은 하나도 넣지 않았다 — 아래 `CHECKS` 의 `근거` 칸에
 * 규약 몇 번인지 적어 두었다. 규약이 바뀌면 이 표도 같이 바뀌어야 한다(L-392).
 *
 * [★묻는 법도 내가 만들지 않는다]
 * 실제 앱과 같은 규약(되묻기 선택지의 `ctx` 처리 등)은 `ask_live.js` 가 이미 갖고 있다.
 * 그래서 이 도구는 **그 스크립트를 그대로 부른다**(제 사본을 만들면 앱과 갈린다 — L-136).
 *
 * [★문항 고르는 규칙을 밝힌다]
 * Q-11 은 **개수(15)만** 확정했고 어느 문항인지는 아무 데도 없다. 그래서 고르는 규칙을 적는다:
 *   골든 문제집을 파일 순서 그대로 두고 **고른 간격으로 15개**를 집는다(`floor(i*N/15)`).
 *   ⚠**내가 좋아 보이는 문항을 집지 않는다** — 그러면 다음 회차와 견줄 수 없고, 잘 되는 것만 고른
 *   셈이 된다(G-34 의 뜻). 고른 15문항은 결과 파일에 **그대로 적어** 다음 회차가 같은 것을 묻게 한다.
 *
 * [쓰는 법] node .../l8_answer_quality.js [--limit N] [--out 경로] [--dry]
 *   --dry : 고른 문항만 찍고 **묻지 않는다**(돈이 안 든다).
 * [연계] 묻는 자 `ask_live.js` · 채점 함수 `services/legal_retriever.js` ·
 *        결과 `_dashboard/l8_answer_quality_<돌린날>.json` · 배경 `00_WORKLIST.md` L-8
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../../../../services/legal_retriever.js');

const HERE = __dirname;
const LEGAL = path.resolve(HERE, '..', '..');
const QFILE = path.join(HERE, 'pinned', 'golden_questions.json');
const ASK = path.join(HERE, 'ask_live.js');
// ★선택 카드를 몇 장까지 따라가나. **되묻기 상한 5 가 곧 카드 수가 아니다** — 답에 이르기 전에
//   나오는 카드는 여러 단계에서 나온다(실측으로 세 번 틀린 뒤 얻은 값이다, 2026-09-25):
//     · 이해확인 `UNDERSTAND_MAX_ROUNDS = 3`  — 「네, 맞아요 / 아니요…」. **되묻기 카운터를 안 올린다.**
//     · 되묻기  `CLARIFY_MAX_ROUNDS   = 5`  — `_CHATBOT.md` 6-1(2026-08-21 사용자 확정)
//     · 그 밖에 프로필확인·구역트리·용어풀이 카드가 더 붙을 수 있다
//   그래서 3+5 에 여유 2 를 더해 10 으로 둔다. 4 로 두었을 때 2문항, 5 로 두었을 때 1문항이
//   「답까지 못 갔다」로 **잘못** 세어졌다 — 그 문항들은 앱이 규약을 지키고 있었다.
const MAX_PICK = 10;
const RUN_DAY = new Date().toISOString().slice(0, 10);          // UTC — 저장소 선례
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const OUT = arg('--out') || path.join(LEGAL, '_dashboard', `l8_answer_quality_${RUN_DAY}.json`);
const WANT = Number(arg('--limit')) > 0 ? Number(arg('--limit')) : 15;
// ★--only 2,3,9 — 집은 15문항 중 **그 번호만** 다시 묻는다(이미 답이 나온 문항에 돈을 또 쓰지 않는다).
const ONLY = String(arg('--only') || '').split(',').map((x) => Number(x.trim()))
  .filter((x) => x > 0);
// ★--merge a.json,b.json — 여러 차례 물은 결과를 **문항번호로** 합친다(같은 번호는
//   채점된 줄이 이기고, 둘 다 채점됐으면 나중 파일이 이긴다). 이미 답이 나온 문항에
//   돈을 또 쓰지 않고 최종 보고서를 만들기 위한 것이다.
const MERGE = String(arg('--merge') || '').split(',').map((x) => x.trim()).filter(Boolean);
// ★--regrade <report.json> — **묻지 않고** 저장된 답변 문장을 오늘의 자로 다시 채점한다.
//   자를 고쳤을 때 돈을 또 쓰지 않기 위한 것이다(오늘 자를 네 번 고쳤다).
const REGRADE = String(arg('--regrade') || '').trim();
const DRY = argv.includes('--dry');

/** 이모지(그림문자) — 규약 8 이 금지한다. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
/**
 * 가리키는 말 — 규약 7 이 금지한다.
 * ★규약 원문(`ANSWER_RULES_BODY` 규약 7)이 이름 지어 막는 말은 네 가지다 —
 *   「같은 법」·「동법」·「같은 조」·「이 법」. (「같은 항」은 같은 갈래라 함께 본다.)
 * ⚠**「본법」은 규약에 없는 말인데 내가 넣었다가 「수산업ㆍ어촌 발전 기**본법**」을 잡았다**
 *   (2026-09-25 L-8 측정). 규약에 없는 말은 자에도 없어야 한다 — 빼냈다.
 * ⚠**앞에 한글이 붙은 자리는 세지 않는다**(`(?<![가-힣])`) — 「노**동법**」·「노**동조**합」처럼
 *   법령 이름 안에 우연히 들어 있는 토막, 그리고 「선박**이 법**에」처럼 주격조사 뒤의 토막을
 *   가리키는 말로 잡지 않기 위한 것이다. 규약이 막는 것은 **말**이지 글자 배열이 아니다.
 */
const DEICTIC = /(?<![가-힣])(같은 법|같은 조|같은 항|동법|동조|이 법)/;

/**
 * 답변 한 편을 규약으로 채점한다. **판정 기준은 전부 ANSWER_RULES_BODY 에서 따왔다.**
 * @param {object} done - 운영 서버 `done` 페이로드(answer·sources·citationChain·clarify …)
 * @returns {Array<{항목:string,근거:string,통과:boolean,메모:string}>}
 */
function grade(done) {
  const a = String((done && done.answer) || '');
  const out = [];
  const put = (항목, 근거, 통과, 메모) => out.push({ 항목, 근거, 통과: !!통과, 메모: 메모 || '' });

  put('답변이 비어 있지 않다', '—', a.trim().length > 0, `${a.length}자`);

  // 규약 6 — 본문 첫 문장을 "쉽게 말하면 ~" 으로 연다.
  const first = a.trim().split('\n').find((l) => l.trim()) || '';
  put('첫 문장이 「쉽게 말하면」으로 열린다', '규약 6', /^\s*\**\s*쉽게 말하면/.test(first), first.slice(0, 40));

  // 규약 7 — 「법령명」 제N조 꼴이 있어야 한다(그것이 원문을 여는 유일한 통로다).
  const cites = R.extractAnswerCitations(a) || [];
  put('「법령명」+조문번호 인용이 있다', '규약 7', cites.length > 0, `${cites.length}건`);

  // 규약 7 — 가리키는 말 금지.
  const dm = a.match(DEICTIC);
  put('가리키는 말(같은 법·동법…)을 안 쓴다', '규약 7', !dm, dm ? `"${dm[0]}"` : '');

  // 규약 7 — 인용한 법이 우리가 실제로 가진 법인가(생산 함수가 판정한다).
  let miss = [];
  try { miss = R.missingAnswerCitations(a, done) || []; } catch (e) { miss = []; }
  put('인용한 조문이 근거자료에 있다', '규약 2·7', miss.length === 0,
    miss.length ? JSON.stringify(miss).slice(0, 120) : '');

  // 규약 8 — 표·이모지 금지.
  put('표(|…|)를 안 쓴다', '규약 8', !/\n\s*\|.*\|/.test(a), '');
  const em = a.match(EMOJI);
  put('이모지를 안 쓴다', '규약 8', !em, em ? em[0] : '');

  // 규약 7 후단 — 면책·기준일·연락처 각주는 화면이 붙인다. 답변에 넣지 않는다.
  put('「참고용입니다」를 답변에 넣지 않는다', '규약 7', !/참고용입니다/.test(a), '');

  // 규약 3 — 횟수 구간이 근거에 없으면 「2차 이후도…」 마무리를 붙이지 않는다.
  const tail = /2차 이후도[^\n]*물어보세요/.test(a);
  const body = (done.sources || []).map((s) => JSON.stringify(s)).join(' ') +
    (done.citationChain || []).map((c) => JSON.stringify(c)).join(' ');
  const hasTiers = /1차|2차|3차/.test(body);
  put('「2차 이후도…」 마무리는 근거에 횟수가 있을 때만', '규약 3', !tail || hasTiers,
    tail ? (hasTiers ? '붙였고 근거에 횟수 있다' : '★붙였는데 근거에 횟수가 없다') : '안 붙였다');

  // 규약 4 — 답변 단계에서는 되묻지 않는다(물음표로 끝나지 않는다).
  const last = a.trim().split('\n').filter((l) => l.trim()).pop() || '';
  put('답변을 물음으로 끝내지 않는다', '규약 4', !/[?？]\s*$/.test(last), last.slice(-40));

  return out;
}

function askOnce(q, statePath) {
  execFileSync('node', [ASK, '--state', statePath, 'start', q],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
function pickOption(statePath, n) {
  execFileSync('node', [ASK, '--state', statePath, 'pick', String(n)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// 저장된 답변 문장을 **다시 채점한다** — 묻지 않는다(돈이 들지 않는다).
// ⚠한 줄은 다시 못 잰다: 「인용한 조문이 근거자료에 있다」는 응답 원본(`done`)이 있어야
//   생산 함수 `missingAnswerCitations` 를 부를 수 있다. 원본이 없는 줄은 **옛 판정을 그대로
//   두고 그렇다고 적는다** — 조용히 통과로 만들지 않는다.
function doRegrade(qs) {
  const d = JSON.parse(fs.readFileSync(REGRADE, 'utf8'));
  const 원본없음 = [];
  const rows = (d.rows || []).map((r) => {
    if (!r.answer) return r;
    const old = (r.채점 || []).find((c) => c.항목 === '인용한 조문이 근거자료에 있다');
    const done = r.done || { answer: r.answer, sources: [], citationChain: [] };
    const fresh = grade(done);
    if (!r.done && old) {
      const i = fresh.findIndex((c) => c.항목 === old.항목);
      if (i >= 0) fresh[i] = Object.assign({}, old, { 메모: (old.메모 || '') + ' [응답 원본이 없어 옛 판정 그대로]' });
      원본없음.push(r.no);
    }
    return Object.assign({}, r, { 채점: fresh,
      통과: fresh.filter((c) => c.통과).length, 떨어짐: fresh.filter((c) => !c.통과).length });
  });
  console.log(`다시 채점했다 — 문항 ${rows.length}개 · 응답 원본이 없어 한 줄을 옛 판정으로 둔 문항: `
    + (원본없음.length ? 원본없음.join(',') : '없음'));
  writeReport(qs, rows, d.합친_측정 || null);
}

// 여러 차례의 측정을 문항번호로 합친다 — **채점된 줄이 안 된 줄을 이긴다.**
// (왜 필요한가: 1차 측정은 되묻기를 한 번만 따라가 9문항이 답까지 못 갔다. 그 9문항만
//  다시 물었으므로, 최종 보고서는 두 측정을 합쳐야 15문항 전체가 된다 — L-382 갈래⑥.)
function doMerge(qs) {
  const byNo = new Map();
  for (const f of MERGE) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of (d.rows || [])) {
      const prev = byNo.get(r.no);
      const graded = (r.채점 || []).length > 0;
      const prevGraded = !!(prev && (prev.채점 || []).length > 0);
      if (!prev || graded || !prevGraded) {
        byNo.set(r.no, Object.assign({}, r, { 어느_측정: path.basename(f) }));
      }
    }
  }
  const rows = [...byNo.keys()].sort((x, y) => x - y).map((n) => byNo.get(n));
  console.log(`합쳤다 — 측정 ${MERGE.length}개 · 문항 ${rows.length}개`);
  writeReport(qs, rows, MERGE.map((f) => path.basename(f)));
}

function writeReport(qs, rows, merged) {
  const tally = {};
  for (const r of rows) for (const c of (r.채점 || [])) {
    tally[c.항목] = tally[c.항목] || { 통과: 0, 떨어짐: 0 };
    tally[c.항목][c.통과 ? '통과' : '떨어짐']++;
  }
  const rep = {
    생성: new Date().toISOString(), 자: 'l8_answer_quality.js',
    '어디에 물었나': 'https://seagnal-server.fly.dev/api/legal/ask (운영 — 키가 있는 곳)',
    '문항 고른 규칙': `골든 ${qs.length}문항을 파일 순서 그대로 두고 floor(i*N/${WANT}) 로 고른 간격 집기`,
    되묻기_상한: MAX_PICK,
    문항수: rows.length, 오류: rows.filter((r) => r.오류).length,
    되묻기가_난_문항: rows.filter((r) => r.되묻기).length,
    답까지_못_간_문항: rows.filter((r) => r.답까지_못_갔다).length,
    채점한_문항: rows.filter((r) => (r.채점 || []).length).length,
    항목별: tally, rows,
  };
  if (merged) rep.합친_측정 = merged;
  fs.writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
  console.log('\n■ 규약 항목별 (통과/떨어짐)');
  for (const k of Object.keys(tally)) console.log(`  ${tally[k].통과}/${tally[k].통과 + tally[k].떨어짐}  ${k}`);
  console.log(`\n되묻기가 난 문항 ${rep.되묻기가_난_문항} · 답까지 못 간 문항 ${rep.답까지_못_간_문항}`
    + ` · 실제로 채점한 문항 ${rep.채점한_문항} · 오류 ${rep.오류}`);
  console.log('결과:', OUT);
}

(function main() {
  const qs = (JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || []);
  // ★고른 간격으로 집는다 — 내가 좋아 보이는 것을 집지 않는다(위 머리말).
  const picked = [];
  for (let i = 0; i < WANT; i++) {
    const q = qs[Math.floor((i * qs.length) / WANT)];
    if (q) picked.push(q);
  }
  if (REGRADE) { doRegrade(qs); return; }
  if (MERGE.length) { doMerge(qs); return; }
  console.log(`골든 ${qs.length}문항에서 고른 간격으로 ${picked.length}문항을 집었다`);
  picked.forEach((q, i) => console.log(`  ${String(i + 1).padStart(2)}. ${String(q.question).slice(0, 62)}`));
  if (ONLY.length) {
    console.log(`  --only ${ONLY.join(',')} — 이 번호만 다시 묻는다(나머지는 건너뛴다).`);
  }
  if (DRY) { console.log('\n--dry — 묻지 않고 끝낸다(돈이 안 든다).'); return; }

  // ★묻기 전에 **돈이 안 드는 확인**부터 — 운영 서버가 살아 있나. 죽었으면 여기서 멈춘다
  //   (죽은 서버에 15번 물어 봐야 신호 0 이고, 실패를 「품질 문제」로 오독하게 된다).
  try {
    const h = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
      'https://seagnal-server.fly.dev/api/health', '--max-time', '45'], { encoding: 'utf8' }).trim();
    if (h !== '200') { console.error(`운영 서버 /api/health → ${h} — 여기서 멈춘다.`); process.exit(1); }
    console.log('운영 서버 살아 있다(/api/health 200) — 묻기 시작한다.');
  } catch (e) {
    console.error('운영 서버 확인 실패 —', String((e && e.message) || e).slice(0, 120));
    process.exit(1);
  }

  const rows = [];
  const tmp = path.join(require('os').tmpdir(), `l8_state_${process.pid}.json`);
  for (let i = 0; i < picked.length; i++) {
    const q = picked[i];
    if (ONLY.length && !ONLY.includes(i + 1)) continue;        // --only 로 걸러진 문항
    process.stderr.write(`  [${i + 1}/${picked.length}] 묻는다…\n`);
    const rec = { no: i + 1, question: q.question, expect_law: q.expect_law || '' };
    try {
      let s = askOnce(q.question, tmp);
      rec.되묻기 = !!(s.last && s.last.clarify);
      // ★되묻기는 **한 번으로 끝나지 않는다**(2026-09-25 1차 측정이 여기서 틀렸다).
      //   `ask_live.js` 는 되묻기 응답도 `lastDone` 에 넣으므로, 한 번만 고르고 채점하면
      //   「답이 아예 안 나온 줄」이 「규약 6·7 위반」으로 세어진다. 답이 나올 때까지 고른다.
      rec.되묻기_횟수 = 0;
      rec.고른_선택지 = [];
      rec.되묻기_선택지 = [];
      while (s.last && s.last.clarify && rec.되묻기_횟수 < MAX_PICK) {
        const opts = (s.last.clarify.options) || [];
        rec.되묻기_선택지.push(opts.map((o) => o.label).slice(0, 6));
        const n = opts.findIndex((o) => o.act !== 'ask');
        if (n < 0) break;                       // 고를 것이 없으면 여기서 멈춘다
        s = pickOption(tmp, n);
        rec.고른_선택지.push(opts[n].label);
        rec.되묻기_횟수++;
      }
      const done = s.lastDone || {};
      rec.answer = String(done.answer || '');
      rec.근거쪽 = (done.sources || []).length;
      rec.근거조문행 = (done.citationChain || []).length;
      // ★아직 되묻기로 끝났으면 **답이 아니다** — 규약으로 재지 않고 따로 센다(자를 속이지 않는다).
      rec.답까지_못_갔다 = !!(s.last && s.last.clarify);
      if (rec.답까지_못_갔다) {
        rec.채점 = [];
        rec.통과 = 0;
        rec.떨어짐 = 0;
      } else {
        rec.채점 = grade(done);
        rec.통과 = rec.채점.filter((c) => c.통과).length;
        rec.떨어짐 = rec.채점.filter((c) => !c.통과).length;
        // ★응답 원본을 남긴다 — 자를 고쳤을 때 **돈을 다시 쓰지 않고** 다시 채점하기 위한 것이다
        //   (오늘 자를 세 번 고쳤고, 그때마다 다시 물어야 했다).
        rec.done = { answer: done.answer || '', sources: done.sources || [],
          citationChain: done.citationChain || [] };
      }
    } catch (e) {
      rec.오류 = String((e && e.message) || e).slice(0, 200);
    }
    rows.push(rec);
  }
  try { fs.unlinkSync(tmp); } catch (_) {}

  writeReport(qs, rows, null);
})();
