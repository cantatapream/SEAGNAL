'use strict';
/**
 * ai_trial_rescore.js — 이미 받은 AI 답(시험 결과 파일 부록의 원본 JSON)을 다시 부르지 않고, 지금 규칙·검산으로 다시 채점한다(분석용, 2026-11-15).
 * 왜: 규칙 빈틈(관할 범위·자식 목록·「위 구역」·새 표현·육상)을 고친 뒤 같은 AI 답으로 판정이 어떻게 바뀌는지 본다 — AI 호출 비용 0.
 * 실행: node ai_trial_rescore.js <결과.md> [<새 보고서.md>]   (2차는 SAMPLE=ai_trial_sample_2.json 를 앞에 붙인다)
 * [연계] ← 사람이 실행 / → ai_trial_sample.json · services/bulletin_ai_trial(checkOne·reportMarkdown)
 */
const fs = require('fs'), path = require('path');
const T = require('../../services/bulletin_ai_trial');
const [src, dst] = process.argv.slice(2);
const md = fs.readFileSync(src, 'utf8');
const recs = Object.fromEntries(md.split('```jsonl')[1].split('```')[0].trim().split('\n').map((l) => JSON.parse(l)).map((b) => [b.id, b.rec]));
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, process.env.SAMPLE || 'ai_trial_sample.json'), 'utf8'));
const rows = sample.map((item) => ({ item, rec: recs[item.id] || null }));
const done = rows.filter((x) => x.rec && x.rec.ok).length;
const two = /_2\.json$/.test(process.env.SAMPLE || '');
const out = T.reportMarkdown(rows, { label: two ? T.TRIALS['2'].label : T.TRIALS['1'].label, provider: two ? 'claude2' : 'chatgpt', status: 'done', total: rows.length, done, failed: rows.length - done, stopReason: '다시 채점(같은 AI 답, ' + new Date().toISOString().slice(0, 10) + ')' });
if (dst) fs.writeFileSync(dst, out);
console.log(out.split('## 건별')[0]);
