/**
 * repeat_probe.js — **같은 질문을 여러 번** 던져 응답이 어디서 갈리는지 본다(비결정성 진단).
 *
 * [왜 있나] 22차 라이브 검증에서 같은 질문·같은 선택 경로인데 결과가 달랐다
 * (폐기물관리법: 2차 정확 → 3차 빈 답변 → 4차 다시 정확). 측정에 잡음이 섞이는 것보다
 * 나쁜 것은 **사용자가 같은 질문을 두 번 하면 다른 답을 받는다**는 점이다.
 *
 * [무엇을 격리하나] 첫 턴만 반복해 던진다. 첫 응답에서 갈리면 원인은 **되묻기 판단**이고,
 * 첫 응답은 늘 같은데 뒤가 갈리면 원인은 **답변 합성**이다. 한 번에 하나씩만 본다.
 *
 * [쓰는 법]
 *   node repeat_probe.js "<질문>" [횟수]      기본 6회
 *
 * [연계] → https://seagnal-server.fly.dev/api/legal/ask (읽기 전용, 위키·raw 안 건드림).
 *        ⚠호출 1회 = 약 46원. 횟수를 함부로 올리지 말 것.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const API = 'https://seagnal-server.fly.dev/api/legal/ask';
const TMP = '/tmp/_repeat_probe_body.json';

const q = process.argv[2];
const n = Math.min(12, Math.max(2, parseInt(process.argv[3], 10) || 6));
if (!q) { console.error('질문을 인자로 주세요'); process.exit(2); }

function ask(query) {
  fs.writeFileSync(TMP, JSON.stringify({ query }));
  const txt = execFileSync('curl', ['-s', '-X', 'POST', API,
    '-H', 'Content-Type: application/json', '--data-binary', '@' + TMP, '--max-time', '240'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = txt.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(lines[i]); if (o && o.type === 'done') return o; } catch (_) {}
  }
  return { _bad: txt.slice(-200) };
}

const rows = [];
console.log(`질문: ${q}`);
console.log(`${n}회 반복 (약 ${(n * 46).toLocaleString()}원)\n`);
for (let i = 1; i <= n; i++) {
  let d;
  try { d = ask(q); } catch (e) { d = { _bad: e.message }; }
  const r = {
    n: i,
    bad: !!d._bad,
    clarify: d.clarify ? d.clarify.question : null,
    opts: d.clarify ? (d.clarify.options || []).map(o => o.label).join('|') : null,
    ansLen: (d.answer || '').length,
    chain: (d.citationChain || []).length,
    srcs: (d.sources || []).length,
  };
  rows.push(r);
  console.log(`  ${i}. ${r.bad ? '요청 실패' :
    (r.clarify ? '되묻기 · ' + r.clarify.slice(0, 40) : '답변 · ' + r.ansLen + '자 · 근거 ' + r.chain + '건')}`);
}

const key = r => r.bad ? 'BAD' : (r.clarify ? 'C:' + r.clarify : 'A');
const groups = {};
rows.forEach(r => { const k = key(r); (groups[k] = groups[k] || []).push(r.n); });
console.log('\n── 갈래 ──');
Object.entries(groups).forEach(([k, v]) => {
  const label = k === 'BAD' ? '요청 실패' : k === 'A' ? '되묻기 없이 바로 답변' : '되묻기: ' + k.slice(2, 62);
  console.log(`  ${String(v.length).padStart(2)}회  ${label}   (회차 ${v.join(',')})`);
});
console.log(`\n서로 다른 갈래 ${Object.keys(groups).length}개 / ${n}회`);
console.log(Object.keys(groups).length === 1
  ? '→ 첫 턴은 일정하다. 갈림은 그 뒤(답변 합성·이후 되묻기)에 있다.'
  : '→ 첫 턴부터 갈린다. 원인은 되묻기 판단 단계다.');
