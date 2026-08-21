/**
 * test_clarify_options.js — 되묻기가 "어떤 법이냐"고 물으면서 정작 1순위 법을 빼놓지 않는가.
 *
 * [왜 있나] 2026-08-19 라이브 실측. "단지관리계획은 언제까지 세워서 승인받아야 하나요?" 질문에서
 * 검색은 「배타적 경제수역 및 대륙붕에 관한 법률」을 1위로 올렸고 근거 문장(제34조의2·6개월)도
 * 자료에 실렸는데, 되묻기 선택지는 `항만법 / 마리나항만법 / 잘 모르겠어요` 로 나왔다.
 * 사용자가 정답을 고를 방법이 없어 무엇을 눌러도 답에 닿지 못했고, 직접 타이핑해도 원문 폴백으로
 * 새어 "확인되지 않습니다"로 끝났다.
 *
 * [무엇을 고정하나] ①법을 고르라는 되묻기에서 1순위 법이 빠지면 맨 앞에 넣는다 ②그렇다고 아무
 * 되묻기에나 법 이름을 끼워넣지는 않는다(톤수·행위 선택지는 그대로 둔다) ③줄임말로 이미 그 법이
 * 들어 있으면 두 번 넣지 않는다 ④모델이 낸 선택지는 하나도 지우지 않는다(누락 0).
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js ensureTopLawOption.
 */
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const labels = rows => rows.map(o => o.label);

console.log('── 1순위 법이 빠진 되묻기 ──');
{
  const out = R.ensureTopLawOption(
    '어떤 법률에 따른 단지관리계획을 말씀하시나요?',
    [{ label: '항만법', hint: '' }, { label: '마리나항만법', hint: '' }],
    ['배타적 경제수역 및 대륙붕에 관한 법률', '항만법']);
  ok('1순위 법이 맨 앞 선택지로 들어간다', out[0].label === '배타적 경제수역 및 대륙붕에 관한 법률',
    labels(out).join(' / '));
  ok('모델이 낸 선택지는 하나도 사라지지 않는다',
    labels(out).includes('항만법') && labels(out).includes('마리나항만법'), labels(out).join(' / '));
}

console.log('── 손대지 않아야 하는 경우 ──');
{
  const tonnage = R.ensureTopLawOption('선박의 총톤수가 어떻게 되나요?',
    [{ label: '5톤 미만', hint: '' }, { label: '5톤 이상', hint: '' }], ['선박법']);
  ok('법을 묻는 되묻기가 아니면 손대지 않는다', tonnage.length === 2, labels(tonnage).join(' / '));

  const nonLaw = R.ensureTopLawOption('어떤 법률 위반인가요?',
    [{ label: '조타 담당', hint: '' }, { label: '어로작업 중', hint: '' }], ['해상교통안전법']);
  ok('선택지가 법 이름 꼴이 아니면 끼워넣지 않는다', nonLaw.length === 2, labels(nonLaw).join(' / '));

  const already = R.ensureTopLawOption('어떤 법률에 따른 신고인가요?',
    [{ label: '선박입출항법', hint: '' }, { label: '선박법', hint: '' }],
    ['선박의 입항 및 출항 등에 관한 법률']);
  ok('줄임말로 이미 들어 있으면 두 번 넣지 않는다', already.length === 2, labels(already).join(' / '));

  const none = R.ensureTopLawOption('어떤 법률인가요?', [{ label: '항만법', hint: '' }], []);
  ok('후보 법이 없으면 그대로 둔다', none.length === 1, labels(none).join(' / '));
}


// ── 되묻기 라운드 상한이 직접 입력으로 답한 경우에도 동작하는가 (2026-08-20) ──
// 종전 백스톱은 질의에 붙은 구분자(' — ')로만 라운드를 셌다. 그 구분자는 선택지 버튼으로
// 답했을 때만 붙으므로, 사용자가 값을 직접 타이핑하면 카운터가 영원히 0이라 상한이 발동하지
// 않았다(해양환경관리법 위해도평가 — 총점을 이미 줬는데 세부항목을 4회까지 되물었다).
{
  const routes = require('fs').readFileSync(__dirname + '/../routes/legal.js', 'utf8');
  ok('routes 가 되묻기 횟수를 ctx 에 누적한다(clarifyRoundNext)',
    /function clarifyRoundNext\(/.test(routes));
  ok('세 갈래 되묻기 모두 카운터를 갱신한다',
    (routes.match(/n: clarifyRoundNext\(ctx\)/g) || []).length === 3);
  const src = require('fs').readFileSync(__dirname + '/../services/legal_retriever.js', 'utf8');
  ok('상한 판정이 구분자 개수와 ctx 누적값 중 큰 쪽을 쓴다',
    /const rounds = Math\.max\(byJoiner,/.test(src));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
