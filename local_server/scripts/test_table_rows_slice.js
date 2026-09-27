/**
 * test_table_rows_slice.js — 큰 표를 가진 별표 쪽이 근거자료에 **질문과 맞는 행으로** 실리는지 고정한다.
 *
 * [왜 있나] 2026-09-27(WORKLIST 3-70 · 골든 15). 「인천항 관제구역 정확한 경계 좌표가 어디인가요?」는
 * 어느 AI 로 물어도 「확인되지 않습니다」였다. 까닭은 AI 가 아니라 **근거자료**였다 — 정답 쪽
 * (관제 고시 별표1, 본문 143,990자 · 절 2개)은 후보 5위로 뽑혔지만 `sliceRelevant` 의 [C] 경로가
 * **앞 500자 미리보기**만 실어, 인천항 좌표(표 한가운데)는 어떤 질문으로도 모델에게 가지 못했다.
 * 같은 병의 더 넓은 꼴: 첫 `## ` 앞 글(별표 쪽은 표 전체)을 `intro.slice(0, 예산)` 으로
 * **앞에서부터** 잘랐다 — 항만법 시행령 별표1(표 50,954자)은 절이 3개라 [C] 에도 안 걸리고 여기로 샜다.
 *
 * [무엇을 고정하나]
 *  ① 관제 별표1 + 실제 질의어 + 실제 예산(5위 2,976자) → **인천항 좌표 01번부터 끝 번호까지 실린다**
 *  ② 머리(제목·표 앞 글·열 제목)는 점수 후보가 아니다 — 쪽 제목은 늘 맨 앞에, 표 앞 글·열 제목은 맞는 행 뒤에
 *     남는 자리에만 · 「관제」만 맞은 행(평택항 0.05점)은 맞는 행보다 먼저 안 들어온다
 *  ③ ★**글자는 원문 그대로** — 선·겹친 빈칸만 줄인다(줄인 행에서 선·빈칸을 빼면 원문 행과 한 글자도 안 다르다)
 *  ④ 본문이 예산을 넘지 않는다(안내문은 옛 길처럼 예산 밖) · 행이 예산보다 크면 **잘라서 넣고 잘렸다고 적는다**
 *  ④-2 남는 예산은 나머지 행을 표 순서대로 채운다 — 맞는 행을 밀어내지 않고, 옛 방식보다 덜 싣지 않는다
 *  ⑤ 안내문이 「선과 빈칸을 줄였다」·「여기 없는 행은 확인되지 않습니다」를 밝힌다
 *  ⑥ ★**표가 아니면 옛 동작 그대로** · 첫 `## ` 앞 글이 예산 안이면 옛 동작 그대로(회귀 0)
 *  ⑦ md 표(`|` 줄)도 행으로 고른다 · 맞는 행이 없으면 표 순서대로 앞에서부터
 *  ⑧ 항만법 별표1(표 50,954자) + 「부산항」 + 작은 예산(1,409자)에서도 부산항 행이 실린다
 *
 * [production 함수를 그대로 쓴다] L-136 — `sliceRelevant` 는 `search()` 가 실제로 부르는 그 함수다.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js(sliceRelevant·sliceTableRows)
 *        · _dashboard/d_standard_2026-09-22/00_WORKLIST.md 3-70 · services/codex_client.design.md §6.
 */
const fs = require('fs');
const path = require('path');
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const WIKI = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki', 'annexes');
const 몸 = (f) => fs.readFileSync(path.join(WIKI, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '');
const 선빼기 = (t) => String(t).replace(/[\s│┃├┤┬┼┴┌┐└┘─━┄┈`]/g, '');
const NOTE_MARK = '표의 선과 겹친 빈칸은 줄였습니다';
// 안내문은 예산 밖에 붙는다(옛 길 PARTIAL_NOTE·HUGE_NOTE 와 같다) — 예산은 **본문**에만 건다
const 본문 = (o) => String(o).replace(R.TABLE_ROWS_NOTE + '\n\n', '');

// ── ① ② ④ ⑤ 관제 별표1 — 골든 15 를 실제 값으로 ──
console.log('── ①②④⑤ 관제 고시 별표1 · 「인천항 관제구역 정확한 경계 좌표」 · 5위 예산 2,976자 ──');
const 관제 = 몸('선박교통관제에관한법률__고시_별표1_구역좌표및관제통신제원.md');
// search() 가 이 질문에서 실제로 넘긴 질의어(2026-09-27 실측 — Gemini 없는 환경)
const T15 = ['인천항', '관제구역', '정확한', '경계', '좌표가', '어디인가요', '관제구', '관제', '어디인가', '어디인', '어디',
  '선박교통관제에관한법률', '선박교통관제구역'];
const out15 = R.sliceRelevant(관제, T15, 2976);
const 인천행 = 관제.slice(관제.indexOf('│인천항  │인천항'), 관제.indexOf('│경인항'));
const 인천번호 = [...인천행.matchAll(/│(\d{2})\. 북위/g)].map(m => m[1]);
ok('인천항 좌표 첫 점(01. 북위 37도 05분 00초)이 실린다', out15.includes('01. 북위 37도 05분 00초'));
ok(`인천항 행의 끝 번호(${인천번호[인천번호.length - 1]})까지 실린다`,
  out15.includes(인천번호[인천번호.length - 1] + '. 북위'), `번호 ${인천번호.join(',')}`);
ok('본문이 예산을 넘지 않는다(안내문 제외)', 본문(out15).length <= 2976, `${본문(out15).length}자`);
ok('안내문이 줄였다는 것과 「확인되지 않습니다」를 밝힌다', out15.includes(NOTE_MARK) && out15.includes('확인되지 않습니다'));
ok('옛 [C] 미리보기(「맨 앞부분 미리보기뿐」)가 아니다', !out15.includes('미리보기뿐'));
ok('이 예산에서는 「관제」만 맞은 평택항 행이 안 실린다 — 맞는 행이 자리를 먼저 차지한다', !out15.includes('평택항'));
ok('쪽 제목은 점수 없이 맨 앞에 한 번 싣는다 — 어느 법 몇 번 별표인지 모델이 안다',
  out15.split('\n').filter(l => l.startsWith('# 선박교통관제에 관한 규정')).length === 1 &&
  out15.indexOf('# 선박교통관제에 관한 규정') < out15.indexOf('01. 북위 37도 05분 00초'));
ok('표 앞 설명(`>` 줄)은 맞는 행보다 먼저 자리를 차지하지 않는다(이 예산에서는 안 실린다)', !out15.includes('> 원문 그대로 보존'));

console.log('\n── ③ 글자는 원문 그대로 — 선·빈칸만 줄인다 ──');
const 줄인 = R.compactTableRow(인천행);
ok('줄인 행에서 선·빈칸을 빼면 원문 행과 한 글자도 안 다르다', 선빼기(줄인) === 선빼기(인천행),
  `${선빼기(줄인).length} vs ${선빼기(인천행).length}`);
ok('모양은 크게 줄었다(원문의 절반 미만)', 줄인.length < 인천행.length / 2, `${인천행.length} → ${줄인.length}`);

console.log('\n── ④ 행이 예산보다 크면 잘라서 넣고 잘렸다고 적는다 ──');
const 작은 = R.sliceRelevant(관제, T15, 1200);
ok('작은 예산(1,200자)에서도 인천항 좌표 첫 점이 실린다', 작은.includes('01. 북위 37도 05분 00초'));
ok('잘렸다는 표시가 붙는다', 작은.includes('이 행의 뒤쪽은 잘렸음'));
ok('그래도 본문이 예산을 넘지 않는다', 본문(작은).length <= 1200, `${본문(작은).length}자`);

console.log('\n── ④-2 남는 예산은 나머지 행으로 채운다 (맞는 행을 밀어내지 않는다) ──');
const 큰 = R.sliceRelevant(관제, T15, 10000);
ok('큰 예산(10,000자)에서도 인천항 행은 통째로 실린다', 큰.includes('01. 북위 37도 05분 00초') &&
  큰.includes(인천번호[인천번호.length - 1] + '. 북위'));
ok('남는 예산을 쓴다(9할 이상 — 옛 방식보다 덜 싣지 않는다)', 본문(큰).length >= 9000 && 본문(큰).length <= 10000, `${본문(큰).length}자`);
ok('채운 행은 표 순서대로 — 군산(첫 행)이 인천항보다 앞에 나온다', 큰.indexOf('군산') >= 0 && 큰.indexOf('군산') < 큰.indexOf('01. 북위 37도 05분 00초'));

console.log('\n── ④-3 표 앞 줄글(「일반기준」)과 쪽 제목을 잃지 않는다 — 골든 291 A/B 에서 드러난 회귀 ──');
const 생명 = 몸('해양수산생명자원의확보ㆍ관리및이용등에관한법률__시행령_별표2_과태료부과기준.md');
const 생명out = R.sliceRelevant(생명, ['분양승인이', '취소돼서', '자원을', '반납해야', '반납', '폐기해버리면', '분양승인', '분양'], 3000);
const 생명옛 = 생명.split(/\n(?=## )/)[0].slice(0, 3000);   // 옛 방식이 실었을 것
const 옛줄 = 생명옛.split('\n').map(선빼기).filter(k => k.length >= 10);
const 남음 = 옛줄.filter(k => 선빼기(생명out).includes(k)).length;
ok('옛 방식이 싣던 줄을 9할 이상 그대로 싣는다', 남음 >= 옛줄.length * 0.9, `${남음}/${옛줄.length}`);
ok('쪽 제목이 실린다', 생명out.includes('# 해양수산생명자원의 확보'));
ok('본문이 예산을 넘지 않는다', 본문(생명out).length <= 3000, `${본문(생명out).length}자`);

console.log('\n── ⑥ 표가 아니면 · 예산 안이면 옛 동작 그대로 ──');
const 줄글 = '# 제목\n\n' + '가나다라마바사 아자차카타파하. '.repeat(400) + '\n\n## 출처\n원문\n\n## 근거 조문\n제1조';
ok('줄글 intro 는 표로 안 읽힌다(null)', R.sliceTableRows(줄글.split('\n## ')[0], ['가나다'], 1000) === null);
const 옛줄글 = R.sliceRelevant(줄글, ['가나다'], 1000);
ok('줄글 intro 가 예산을 넘으면 옛처럼 앞에서부터 싣는다', 옛줄글.startsWith('# 제목') && !옛줄글.includes(NOTE_MARK));
const 해양 = 몸('해양환경보전및활용에관한법률__시행령_별표1_해양수산관련계획.md');
ok('표가 예산 안인 쪽(해양환경 별표1 · 10,000자)은 통째로 — 안 바뀐다', R.sliceRelevant(해양, ['어촌'], 10000) === 해양);

console.log('\n── ⑦ md 표도 행으로 고른다 ──');
const md = '# 별표\n\n| 구분 | 내용 |\n|---|---|\n' +
  Array.from({ length: 40 }, (_, i) => `| ${i + 1}호 | ${i === 24 ? '「어촌ㆍ어항법」 제4조에 따른 어촌ㆍ어항발전기본계획' : '다른 계획 ' + 'ㄱ'.repeat(60)} |`).join('\n') +
  '\n\n## 출처\n원문\n\n## 근거 조문\n제1조';
const mdOut = R.sliceRelevant(md, ['어촌ㆍ어항발전기본계획', '계획'], 600);
ok('맞는 행(25호)이 실린다', mdOut.includes('25호') && mdOut.includes('어촌ㆍ어항발전기본계획'));
ok('열 제목 행이 앞에 붙는다', mdOut.includes('| 구분 | 내용 |'));
ok('본문이 예산을 넘지 않는다', 본문(mdOut).length <= 600, `${본문(mdOut).length}자`);
const mdNone = R.sliceRelevant(md, ['없는낱말'], 600);
ok('맞는 행이 없으면 표 순서대로 앞에서부터(1호가 실린다)', mdNone.includes('| 1호 |') && mdNone.includes(NOTE_MARK));

console.log('\n── ⑧ 항만법 시행령 별표1 (표 50,954자 · 절 3 — [C] 에 안 걸리던 쪽) ──');
const 항만 = 몸('항만법__시행령_별표1_항만의구분명칭위치및구역.md');
const 항만out = R.sliceRelevant(항만, ['부산항', '항만구역의', '범위는', '항만구역', '항만', '범위'], 1409);
ok('작은 예산(1,409자)에서도 부산항 행이 실린다', 항만out.includes('부산항'));
ok('본문이 예산을 넘지 않는다', 본문(항만out).length <= 1409, `${본문(항만out).length}자`);

console.log(`\n${fail ? '❌' : '✅'} test_table_rows_slice — ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
