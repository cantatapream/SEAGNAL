/**
 * search_eval.js — 검색이 **그 질문의 법을 후보로 올리는가**를 고정 질문 65개로 채점한다(AI 안 씀, 비용 0).
 *
 * [왜 있나] 2026-08-18 라이브 검증에서 "엉뚱한 법으로 새어감"(B유형)이 나왔다. 검색 점수는 랭킹이라
 * 한 곳을 손대면 지금 잘 되던 질문이 조용히 망가진다 — 눈대중으로 고치면 안 된다. 그래서 고치기 전에
 * 채점판을 먼저 만든다. 챗봇 API 를 부르지 않고 `search()` 만 돌리므로 **돈이 들지 않는다.**
 *
 * [무엇을 재나] 질문마다 "그 질문이 속한 법"이 후보(contextPages)에 들어오는가, 몇 번째인가.
 *   - hit   : 후보에 들어옴
 *   - top3  : 3위 안
 *   - miss  : 후보에 아예 없음  ← B유형이 여기 잡힌다
 * 점수 방식을 바꾸기 **전후로 같은 65문항을 돌려** 좋아졌는지/망가졌는지 숫자로 본다.
 *
 * [쓰는 법]
 *   node search_eval.js                  → 지금 상태 채점
 *   node search_eval.js --save <파일>     → 기준선 저장
 *   node search_eval.js --base <파일>     → 기준선과 비교(좋아진 질문·망가진 질문을 이름으로 찍는다)
 *
 * [연계] ← pinned/r22_questions.json(라이브 검증에서 실제로 물은 문항). → services/legal_retriever.js search().
 *        ⚠읽기 전용.
 */
const fs = require('fs');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const PINNED = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/r22_questions.json';

const norm = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : ''; };
// `--clean`: 감사 내부 표기를 벗긴 정제판(question_clean)으로 잰다. 원문과 나란히 재보면
// "우리가 만든 잡음이 점수를 얼마나 흐렸는지"가 그대로 드러난다(2026-08-19, 65건 중 36건 오염).
const USE_CLEAN = process.argv.includes('--clean');

(async () => {
  const pins = JSON.parse(fs.readFileSync(PINNED, 'utf8'));
  const rows = [];
  for (const p of pins) {
    let laws = [];
    try {
      const { contextPages } = await R.search((USE_CLEAN && p.question_clean ? p.question_clean : p.question), { canonicalOnly: true });
      laws = [...new Set(contextPages.map(c => norm(c.law)))];
    } catch (e) { rows.push({ law: p.law, rank: -2, err: e.message }); continue; }
    rows.push({ law: p.law, rank: laws.indexOf(norm(p.law)) });   // -1 = 후보에 없음
  }
  const hit = rows.filter(r => r.rank >= 0).length;
  const top3 = rows.filter(r => r.rank >= 0 && r.rank < 3).length;
  const miss = rows.filter(r => r.rank === -1).length;
  const err = rows.filter(r => r.rank === -2).length;
  const now = { total: rows.length, hit, top3, miss, err, per: {} };
  rows.forEach(r => { now.per[r.law] = r.rank; });

  const basePath = arg('--base');
  let base = null;
  if (basePath) { try { base = JSON.parse(fs.readFileSync(basePath, 'utf8')); } catch (_) {} }

  const pct = n => (n / rows.length * 100).toFixed(1) + '%';
  const d = k => base ? ` (${now[k] - base[k] >= 0 ? '+' : ''}${now[k] - base[k]})` : '';
  console.log(`고정 질문 ${rows.length}개로 채점`);
  console.log('─'.repeat(60));
  console.log(`후보에 들어옴(hit)   ${String(hit).padStart(3)}  ${pct(hit)}${d('hit')}`);
  console.log(`3위 안(top3)        ${String(top3).padStart(3)}  ${pct(top3)}${d('top3')}`);
  console.log(`후보에 없음(miss)    ${String(miss).padStart(3)}  ${pct(miss)}${d('miss')}   ← B유형`);
  if (err) console.log(`오류                ${err}`);

  if (base && base.per) {
    const better = [], worse = [];
    for (const [law, rank] of Object.entries(now.per)) {
      const was = base.per[law];
      if (typeof was !== 'number') continue;
      if (was === -1 && rank >= 0) better.push(`${law} (없음 → ${rank + 1}위)`);
      else if (was >= 0 && rank === -1) worse.push(`${law} (${was + 1}위 → 없음)`);
      else if (rank >= 0 && was >= 0 && rank < was - 1) better.push(`${law} (${was + 1}위 → ${rank + 1}위)`);
      else if (rank >= 0 && was >= 0 && rank > was + 1) worse.push(`${law} (${was + 1}위 → ${rank + 1}위)`);
    }
    console.log(`\n좋아진 질문 ${better.length}건`); better.slice(0, 12).forEach(x => console.log('  + ' + x));
    console.log(`망가진 질문 ${worse.length}건  ← 0이어야 한다`); worse.slice(0, 12).forEach(x => console.log('  - ' + x));
  }
  if (arg('--save')) { fs.writeFileSync(arg('--save'), JSON.stringify(now, null, 1)); console.log(`\n스냅샷 저장: ${arg('--save')}`); }
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
