/**
 * test_treaty_caselaw_meta.js — §5-6 국제협약 · §5-7 판례변동 메타를 **읽는지** 고정한다.
 *
 * [왜 있나] 2026-09-22(P-15). `_CHATBOT.md` 5-6·5-7 이 2026-07-18 에 정해 둔 두 규약이
 * 위키 frontmatter(`국제협약근거`·`협약링크`·`해석주의`)에 자료까지 갖춰 놓았는데,
 * **그것을 읽는 코드가 한 줄도 없었다**(전수 grep 0건). 규칙은 있고 데이터도 있는데
 * 코드가 안 읽으면 그 규칙은 죽은 것이다(뿌리 사슬 ②). 이 스위트가 그 자리를 지킨다.
 *
 * [무엇을 고정하나]
 *  ① 협약 메타가 있는 페이지는 [근거자료] 머리에 **유래·링크·"지어내지 마라"**가 붙는다
 *  ② 협약 메타가 **없는** 페이지는 종전과 **글자 하나까지 같다**(회귀 0)
 *  ③ `해석주의` 플래그가 있으면 규약 5-7 의 참고 문구가 **자동으로** 붙는다
 *  ④ 플래그가 없으면 안 붙는다 · 이미 같은 뜻이 답에 있으면 **겹쳐 붙지 않는다**
 *  ⑤ 따옴표가 씌워진 frontmatter 값도 읽는다(실제 위키에 한 장 있다)
 *  ⑥ ★위키 **실물**에서 그 메타를 단 페이지가 실제로 읽히는지 — 문구가 아니라 파일로 확인
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js(treatyNote·
 *        caselawNoticeFor) · routes/legal.js(스트림 말미 자동 첨부) · knowledge/legal/_CHATBOT.md 5-6·5-7.
 */
const fs = require('fs');
const path = require('path');
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

const pageOf = (fm, body) => ({
  law: '선박안전법', topic: '구명설비', status: 'canonical',
  frontmatter: fm || {}, body: body || '본문입니다.',
});

console.log('── ① 협약 메타가 있으면 [근거자료] 머리에 붙는다 (5-6) ──');
{
  const blk = R.buildContextBlock([pageOf({
    updated: '2026-07-18',
    '국제협약근거': 'SOLAS(해상에서의 인명안전을 위한 국제협약) 제3장(구명설비 및 장치)',
    '협약링크': 'https://www.imo.org/solas',
  })]);
  ok('근거 협약 이름이 그대로 들어간다', blk.includes('SOLAS(해상에서의 인명안전을 위한 국제협약) 제3장'));
  ok('협약 원문 링크가 그대로 들어간다', blk.includes('https://www.imo.org/solas'));
  ok('결론은 우리 법 기준이라고 못박는다', blk.includes('우리 법 기준'));
  ok('★협약 조문을 지어내지 말라고 함께 적는다', blk.includes('지어내지 마라'));
  ok('본문은 그대로 남는다', blk.includes('본문입니다.'));
}
{
  const blk = R.buildContextBlock([pageOf({ '국제협약근거': 'UNCLOS 제111조' })]);
  ok('링크가 없어도 근거 협약만으로 붙는다', blk.includes('UNCLOS 제111조') && !blk.includes('협약 원문 링크'));
}
{
  const blk = R.buildContextBlock([pageOf({ '협약링크': 'https://cites.org/eng/disc/text.php' })]);
  ok('근거가 없고 링크만 있어도 붙는다', blk.includes('https://cites.org/eng/disc/text.php'));
}

console.log('\n── ② 메타가 없는 페이지는 종전과 글자 하나까지 같다 (회귀 0) ──');
{
  const plain = pageOf({ updated: '2026-07-18' });
  const blk = R.buildContextBlock([plain]);
  ok('협약 문단이 아예 안 붙는다', !blk.includes('국제협약을 국내법화'));
  ok('머리줄이 종전 꼴 그대로다', blk.startsWith('--- 근거1: 「선박안전법」 관련 자료 ('));
  ok('머리줄 바로 다음 줄이 본문이다(빈 줄이 끼지 않는다)',
    blk.split('\n')[1] === '본문입니다.', JSON.stringify(blk.split('\n').slice(0, 3)));
}

console.log('\n── ③ 해석주의 플래그 → 참고 문구 자동 첨부 (5-7) ──');
{
  const flagged = [pageOf({ '해석주의': '판례변동 가능 (정선명령 불응의 고의적 불응 vs 통신오류 구분)' })];
  const tail = R.caselawNoticeFor(flagged, '답변 본문입니다.');
  ok('붙일 꼬리가 만들어진다', tail.length > 0);
  ok('규약 5-7 의 문구 그대로다', tail.includes('판례·유권해석에 따라 달라질 수 있으니'));
  ok('관할 소관부서·전문가 확인 권고가 들어 있다', tail.includes('관할 소관부서·전문가 확인을 권합니다'));
  ok('빈 줄 둘로 문단을 띄운다', tail.startsWith('\n\n'));
  ok('withCaselawNotice 는 답 끝에 그대로 잇는다',
    R.withCaselawNotice('답변 본문입니다.', flagged) === '답변 본문입니다.' + tail);
}

console.log('\n── ④ 안 붙어야 할 때는 안 붙는다 ──');
{
  ok('플래그가 없으면 빈 문자열', R.caselawNoticeFor([pageOf({ updated: '2026-07-18' })], '답변') === '');
  ok('근거가 아예 없으면 빈 문자열', R.caselawNoticeFor([], '답변') === '');
  ok('contextPages 가 undefined 라도 죽지 않는다', R.caselawNoticeFor(undefined, '답변') === '');
  const flagged = [pageOf({ '해석주의': '판례변동 가능' })];
  ok('★이미 같은 뜻이 답에 있으면 겹쳐 붙지 않는다',
    R.caselawNoticeFor(flagged, '… 이 부분은 판례·유권해석에 따라 달라질 수 있습니다.') === '');
  ok('답이 비었으면 withCaselawNotice 가 그대로 돌려준다', R.withCaselawNotice('', flagged) === '');
  ok('답이 null 이면 그대로 null', R.withCaselawNotice(null, flagged) === null);
  ok('플래그 값이 빈 문자열이면 안 붙는다', R.caselawNoticeFor([pageOf({ '해석주의': '' })], '답변') === '');
}

console.log('\n── ⑤ 따옴표가 씌워진 frontmatter 값도 읽는다 ──');
{
  ok('쌍따옴표를 벗긴다', R.unquoteMeta('"CITES(멸종위기종 협약)"') === 'CITES(멸종위기종 협약)');
  ok('홑따옴표를 벗긴다', R.unquoteMeta("'값'") === '값');
  ok('안 씌워진 값은 그대로', R.unquoteMeta('SOLAS 제3장') === 'SOLAS 제3장');
  ok('한쪽만 있으면 벗기지 않는다', R.unquoteMeta('"반쪽') === '"반쪽');
  ok('undefined 는 빈 문자열', R.unquoteMeta(undefined) === '');
  const blk = R.buildContextBlock([pageOf({ '국제협약근거': '"CITES(멸종위기에 처한 야생동식물종의 국제거래에 관한 협약)"' })]);
  ok('따옴표가 [근거자료]에 새어 나오지 않는다',
    blk.includes('근거 협약: CITES(멸종위기에 처한 야생동식물종의 국제거래에 관한 협약).'), blk.slice(0, 300));
}

console.log('\n── ⑥ ★위키 실물로 확인한다 (문구가 아니라 파일로) ──');
{
  const WIKI = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.md')) files.push(fp);
    }
  })(WIKI);

  let treaty = 0, caselaw = 0, treatyRead = 0, caselawRead = 0;
  for (const fp of files) {
    const raw = fs.readFileSync(fp, 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) continue;
    const fm = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([^:]+):\s*(.*)$/);
      if (kv) fm[kv[1].trim()] = kv[2].trim();
    }
    if (fm['국제협약근거'] || fm['협약링크']) {
      treaty++;
      if (R.treatyNote(fm)) treatyRead++;
    }
    if (fm['해석주의']) {
      caselaw++;
      if (R.caselawNoticeFor([{ frontmatter: fm }], '')) caselawRead++;
    }
  }
  console.log(`  · 위키 ${files.length}장 중 — 협약 메타 ${treaty}장 · 해석주의 ${caselaw}장`);
  ok('협약 메타를 단 페이지가 위키에 실제로 있다', treaty > 0, '실측 ' + treaty);
  ok('★그 페이지가 전부 읽힌다', treaty === treatyRead, `${treatyRead}/${treaty}`);
  ok('해석주의 플래그를 단 페이지가 위키에 실제로 있다', caselaw > 0, '실측 ' + caselaw);
  ok('★그 페이지가 전부 읽힌다', caselaw === caselawRead, `${caselawRead}/${caselaw}`);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
