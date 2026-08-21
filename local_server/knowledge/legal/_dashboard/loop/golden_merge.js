/**
 * golden_merge.js — 사서(에이전트)들이 확인한 라벨을 고정 문제집에 합친다.
 *
 * 무엇을 하나: `pinned/golden_verify/<법>.json`(법마다 한 파일, 사서가 원문·위키로 확인한 결과)을
 * 모아 `pinned/golden_questions.json` 의 각 문항에 되먹인다. 고친 기대근거(expect_law/expect_article),
 * 확인여부(verified), 되묻기 제외(skip), 문항 자체를 버림(drop)을 반영한다.
 * drop 된 문항은 문제집에서 빼고 `_버린문항` 에 사유와 함께 남긴다(왜 뺐는지 추적하려고).
 *
 * [연계]
 *   ← pinned/golden_verify/*.json (golden_verify.js 가 만든 사서 확인 결과)
 *   ↔ pinned/golden_questions.json (읽고 다시 씀)
 *   → golden_eval.js (verified:true 인 문항만 채점)
 * [로드 순서] 단독 실행 스크립트. `node golden_merge.js [--dry]`
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const QFILE = path.join(HERE, 'pinned', 'golden_questions.json');
const VDIR = path.join(HERE, 'pinned', 'golden_verify');
const DRY = process.argv.includes('--dry');

/** 문항 대조용 키 — 사서가 ❌·따옴표·"— 없음" 같은 장식을 떼고 적은 경우가 있어 글자만 남긴다. */
function key(s) { return String(s || '').replace(/[^0-9A-Za-z가-힣]/g, ''); }

const doc = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
const qs = doc.questions || [];

// 사서 결과를 (법, 문항) 으로 모은다.
const vs = [];
for (const f of fs.readdirSync(VDIR).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(VDIR, f), 'utf8'));
  const items = d.questions || (Array.isArray(d) ? d : []);
  for (const it of items) vs.push({ law: it.law || d.law || f.slice(0, -5), it });
}

let hit = 0, miss = 0, dropped = 0, skipped = 0, ok = 0;
const kept = [], drops = [];
for (const q of qs) {
  const qk = key(q.question);
  const m = vs.find(v => key(v.law) === key(q.law) &&
    (key(v.it.question) === qk || qk.includes(key(v.it.question)) || key(v.it.question).includes(qk)));
  if (!m) { miss++; kept.push(q); continue; }
  hit++;
  const it = m.it;
  if (it.drop) { dropped++; drops.push({ law: q.law, question: q.question, 사유: it.note || it.reason || '' }); continue; }
  if (it.expect_law) q.expect_law = it.expect_law;
  if (it.expect_article) q.expect_article = it.expect_article;
  if (it.note) q.note = it.note;
  if (typeof it.in_wiki === 'boolean') q.in_wiki = it.in_wiki;
  if (it.skip) { q.skip = true; skipped++; }
  q.verified = it.verified !== false && !it.skip;
  if (q.verified) ok++;
  kept.push(q);
}

doc.questions = kept;
if (drops.length) doc._버린문항 = drops;
console.log(`사서 결과 ${vs.length}건 · 대조됨 ${hit} · 못 찾음 ${miss}`);
console.log(`채점 대상(verified) ${ok} · 되묻기 제외(skip) ${skipped} · 버림 ${dropped} · 남은 문항 ${kept.length}`);
if (DRY) { console.log('(--dry: 파일을 쓰지 않음)'); process.exit(0); }
fs.writeFileSync(QFILE, JSON.stringify(doc, null, 1));
console.log(`저장: ${QFILE}`);
