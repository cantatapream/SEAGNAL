/**
 * test_byl_decl.js — 별표 파일 **선언줄** 판독(`bylDeclLine`·`parseBylDecl`·`hasBylBody`).
 *
 * [왜 있나] 2026-09-22(2-7 · P-3). 계층 접두가 없는 별표 파일(`별표/별표1.txt`)이 정말 그
 * 계층의 그 번호인지는 **파일 안 선언줄**로만 알 수 있다. 종전 판독은 정규식 하나로
 *   ①`■` 로 시작 ②계층이 `시행규칙|시행령` ③그 낱말 바로 뒤가 여는 괄호
 * 를 동시에 요구해서, 실측 2,032개 중 331개가 걸리지 않았다. 그중 가장 큰 갈래가
 * **계층 낱말이 아예 없는 것**(88개) — 「선박에서의 오염방지에 관한 규칙」처럼 그 문서
 * 자신이 법률 자리인 경우다. 그 법은 `tier:1` 인데 별표 **90개 중 0개**가 열렸다.
 *
 * [무엇을 고정하나]
 *  ① 계층 낱말이 있으면 그 계층, 없으면 **법률**(그 문서 자신)로 읽는다
 *  ② 낫표·오타·연속공백이 끼어도 계층 낱말만 있으면 읽는다
 *  ③ `■` 없이 맨몸 괄호로 오는 선언줄도 읽는다 (머리 몇 줄까지만)
 *  ④ ★번호 대조는 **그대로 엄격하다** — 파일명 번호와 내용 번호가 다르면 거부한다
 *     (이 가드를 잃으면 다른 별표를 그 번호인 것처럼 보여준다 = 환각 0 위반)
 *  ⑤ `[별표 7] 삭제` 한 줄뿐인 파일은 "본문이 있다"고 하지 않는다 — 맨몸 괄호 꼴도 마찬가지
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/article_text.js resolveRefs ③.
 */
const A = require('../services/article_text.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const decl = t => A.parseBylDecl(A.bylDeclLine(t));

console.log('── ① 계층 낱말 읽기 ──');
ok('시행령을 시행령으로', decl('제목\n\n■ 항만법 시행령 [별표 6]\n표')?.tier === '시행령');
ok('시행규칙을 시행규칙으로', decl('제목\n\n■ 항만운송사업법 시행규칙 [별지 제16호의2서식]\n표')?.tier === '시행규칙');
ok('★계층 낱말이 없으면 법률(그 문서 자신)',
  decl('제목\n\n■ 선박에서의 오염방지에 관한 규칙 [별표 1]\n표')?.tier === '법률');
ok('법 이름이 「…법률」로 끝나도 법률', decl('제목\n\n■ 관세법 [별표]\n표\n') === null ||
  decl('제목\n\n■ 관세법 [별표 1]\n표')?.tier === '법률');

console.log('── ② 지저분한 선언줄 ──');
ok('낫표 안의 계층도 읽는다',
  decl('제목\n\n■ 「국가기술자격법 시행규칙」 [별지 제1호의2서식]\n표')?.tier === '시행규칙');
ok('연속 공백이 있어도 읽는다',
  decl('제목\n\n■ 선박에서의 오염방지에   관한 규칙  [별표 1] <개정 2025. 8. 12.>\n표')?.num === '1');
ok('`시행규칙칙` 오타도 시행규칙으로',
  decl('제목\n\n■ 공간정보의 구축 및 관리 등에 관한 법률 시행규칙칙 [별지 제19호서식]\n표')?.tier === '시행규칙');
ok('★계층 낱말은 시행규칙을 먼저 본다(시행령이 앞서 나와도)',
  decl('제목\n\n■ 「○○법 시행령」에 따른 ○○법 시행규칙 [별표 1]\n표')?.tier === '시행규칙');

console.log('── ③ ■ 없는 맨몸 선언줄 ──');
ok('맨몸 괄호줄도 선언으로 읽는다',
  decl('해양오염방지검사증서추록\n\n[별지 제10호서식]    (제1쪽)\n표')?.num === '10');
ok('머리에서 멀리 떨어진 괄호는 선언으로 안 본다(본문 인용 오인 방지)',
  decl('제목\n1\n2\n3\n4\n5\n6\n[별표 3] 이건 본문 안 인용이다') === null);

console.log('── ④ 번호 대조는 그대로 엄격하다 ──');
const T = '제목\n\n■ 항만법 시행령 [별표 1의2]\n표';
ok('번호가 같아야 통과', A.bylDeclMatches(T, '시행령', { type: '별표', num: '1의2' }) === true);
ok('★가지번호를 본번호로 봐주지 않는다', A.bylDeclMatches(T, '시행령', { type: '별표', num: '1' }) === false);
ok('계층이 다르면 거부', A.bylDeclMatches(T, '시행규칙', { type: '별표', num: '1의2' }) === false);
ok('★계층 낱말 없는 선언줄은 시행령 요청에 안 걸린다',
  A.bylDeclMatches('제목\n\n■ 관세법 [별표 1]\n표', '시행령', { type: '별표', num: '1' }) === false);
ok('그 선언줄은 법률 요청에는 걸린다',
  A.bylDeclMatches('제목\n\n■ 관세법 [별표 1]\n표', '법률', { type: '별표', num: '1' }) === true);
ok('종류(별표↔서식)가 다르면 거부',
  A.bylDeclMatches(T, '시행령', { type: '서식', num: '1의2' }) === false);

console.log('── ⑤ 본문 없는 파일은 "원문 있음"이 아니다 ──');
ok('■ 꼴 삭제 별표', A.hasBylBody('삭제\n\n■ 도선법 시행규칙 [별표 7] 삭제\n') === false);
ok('★맨몸 괄호 꼴 삭제 서식', A.hasBylBody('삭제 &lt;2014.12.29.&gt;\n\n[별지 제11호서식] 삭제  \n') === false);
ok('본문이 있으면 true', A.hasBylBody('제목\n\n■ 항만법 시행령 [별표 6]\n┏━━┓\n│표│\n') === true);

console.log('── ⑥ 고시 안 별표 블록 머리줄 (extractAttachments · 2-7b) ──');
// DOC_TAIL_RE 뒤부터 블록을 센다 — 고시 본문이 먼저 오고 그 뒤에 별표가 이어붙는 꼴을 흉내낸다.
const NOTICE = [
  '제1조(목적) 이 고시는 …',
  '부칙',
  '이 고시는 2026-01-01부터 시행한다.',
  '',
  '[별지 제8호서식]',
  '정비점검 기록부',
  '',
  '[별지 제8호의2서식]',
  '정비점검 기록부(2)',
  '',
  '<별표 3>',
  '화살괄호로 적힌 별표',
  '',
  '【별지 제1호의 1 서식】',
  '사이에 공백이 낀 꼴',
].join('\n');
const atts = A.extractAttachments(NOTICE);
const keys = atts.map(a => a.key);
ok('★`제8호의2서식` 을 서식8 과 따로 잡는다', keys.includes('서식8') && keys.includes('서식8의2'),
  '잡힌 것: ' + keys.join(' · '));
ok('★서식8 본문에 서식8의2 가 딸려 들어가지 않는다',
  !(atts.find(a => a.key === '서식8') || {}).body.includes('정비점검 기록부(2)'));
ok('★화살괄호 <별표 3> 도 머리줄로 본다 (L-299)', keys.includes('별표3'));
ok('`제1호의 1 서식` 처럼 공백이 껴도 읽는다', keys.includes('서식1의1'), '잡힌 것: ' + keys.join(' · '));

console.log('── ⑦ 별표 파일 번호 판독 (parseBylFile · 2-8 · P-6) ──');
// ★첫 줄이 「번호」가 아니라 「안내 메모」인 파일이 있다. 첫 줄만 믿으면 두 방향으로 틀린다.
const MOVED = [
  '[별표 11의2]로 이동 <2014.11.20.>',
  '',
  '■ 국가기술자격법 시행규칙 [별표 3] [별표 11의2]로 이동',
].join('\n');
const mv = A.parseBylFile(MOVED);
ok('★「[별표 11의2]로 이동」 을 번호로 읽지 않는다',
  mv.entries.length === 1 && mv.entries[0].key === '별표3',
  '읽은 것: ' + mv.entries.map(e => e.key).join('·'));
ok('★그 파일은 **원문을 가진 척하지 않는다**(본문이 선언줄뿐이면 빈 본문)',
  (mv.entries[0] || {}).body === '', '본문 길이: ' + ((mv.entries[0] || {}).body || '').length);

const BRANCH = [
  '[행정규칙] 중앙연안관리심의회 운영규정 — 별지 제1호의2서식',
  '',
  '■ 중앙연안관리심의회 운영규정 [별지 제1호의2서식]',
  '┏━━┓',
  '│표│',
].join('\n');
ok('★`제1호의2서식`(호 뒤 가지번호)을 `서식1` 로 뭉개지 않는다',
  A.parseBylFile(BRANCH).entries.some(e => e.key === '서식1의2'),
  '읽은 것: ' + A.parseBylFile(BRANCH).entries.map(e => e.key).join('·'));

const MULTI = [
  '[○○고시] 별표1·2·3 — 묶음',
  '',
  '표 내용이 길게 이어진다. 이 줄은 40자를 넘기기 위한 것이다. 계속 이어진다.',
].join('\n');
const mu = A.parseBylFile(MULTI).entries.map(e => e.key);
ok('첫 줄이 여러 번호를 담으면 그대로 다 남긴다(선언줄이 없을 때)',
  mu.includes('별표1') && mu.includes('별표2') && mu.includes('별표3'), '읽은 것: ' + mu.join('·'));

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
