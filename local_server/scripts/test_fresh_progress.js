/**
 * ============================================================================
 * 파일명: scripts/test_fresh_progress.js
 * 역할: 관리자 「원문신선도」 방의 **「지금 점검」 진행 게이지**가 살아 있는지 확인한다.
 *       (초보자용: 점검 스크립트가 화면에 찍는 「[12/653] …」 같은 줄을 서버가 제대로 읽어
 *        막대를 채우는지, 화면이 그 값을 물어보는 길이 이어져 있는지를 검사한다.)
 * ============================================================================
 *
 * [왜 있나 — 2026-11-03 사장님 요청]
 *  「점검이 되었는지 안 되었는지, 지금 진행되고 있는 것인지 잘 모르겠다 — 개정검토의 지금 스캔처럼
 *   게이지가 증가했으면」. 그래서 서버가 점검 스크립트의 출력 줄을 읽어 진행률을 만든다.
 *  ⚠그 줄 모양은 **파이썬 스크립트의 print** 가 정한다. 누가 print 를 바꾸면 게이지가 조용히
 *   0% 에 멈춘다 — 그래서 아래 ②는 스크립트 원본에서 print 꼴을 직접 뽑아 맞춰 본다.
 *
 * [무엇을 검사하나]
 *  ① parseProgressLine 이 네 스크립트의 진행 줄(`[i/n] …` · `… i/n` · 「대상 N건」 · 두 번째 마디)을 읽는다
 *  ② 스크립트 원본의 print 꼴이 아직 그 모양이다(admrul_fresh · admrul_fresh_pass2 · law_fresh · ordin_fresh)
 *  ③ 진행 줄이 아닌 줄(요약·목록)은 무시한다
 *  ④ 점검 전 getScanProgress 는 「안 도는 중」 이고 막대가 0 이다
 *  ⑤ 배선: 스캐너가 stdout 을 받아 읽고, 라우트 GET /api/legal/freshness/scan-progress 가 있고,
 *     화면(ai_chat.js)이 그 주소를 물어 게이지(nryaFreshGauge)를 그린다
 *
 * [연계]
 * - services/admrul_fresh_scanner.js → parseProgressLine() · getScanProgress() · runScript()
 * - routes/legal.js → GET /api/legal/freshness/scan-progress
 * - client/js/ai-chat/ai_chat.js → startFreshGauge() · paintFreshGauge()
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_fresh_progress.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../services/admrul_fresh_scanner.js');

const ROOT = path.join(__dirname, '..', '..');
const LOOP = path.join(ROOT, 'local_server', 'knowledge', 'legal', '_dashboard', 'loop');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('① 진행 줄 읽기');
ok('P1 행정규칙·법령·2차 `[i/n] 판정 제목`',
  same(S.parseProgressLine('[12/653] 현행 위험물 선박운송 기준'), { done: 12, total: 653, label: '현행 위험물 선박운송 기준' }));
ok('P2 2차 `[i/n] ID불일치 제목`',
  same(S.parseProgressLine('[3/61] ID불일치 어선검사기준'), { done: 3, total: 61, label: 'ID불일치 어선검사기준' }));
ok('P3 조례 `   … i/n`', same(S.parseProgressLine('   … 50/416'), { done: 50, total: 416 }));
ok('P4 법령 머리 `   대상: N개 계열`', same(S.parseProgressLine('   대상: 222개 계열'), { done: 0, total: 222 }));
ok('P5 2차 머리 `2차 대조 대상 N건 (…)`',
  same(S.parseProgressLine('2차 대조 대상 61건 (이미 판정된 592건은 건너뛴다 - 같은 명령을 다시 쳐도 이어진다)'), { done: 0, total: 61 }));
ok('P6 조례 머리 `… · 대상 N건`',
  same(S.parseProgressLine('■ 조례 신선도 대조 — 우리 사본의 시행일과 현행을 맞춰 본다 (기준일 2026-11-03 KST) · 대상 416건'), { done: 0, total: 416 }));
ok('P7 두 번째 마디', same(S.parseProgressLine('■ 두 번째 마디 — 조회실패 3건을 다시 두들긴다'), { label: '조회 실패분 다시 묻는 중' }));

console.log('② 스크립트 원본의 print 꼴');
const admrul = read('local_server/knowledge/legal/_dashboard/loop/admrul_fresh.py');
const pass2 = read('local_server/knowledge/legal/_dashboard/loop/admrul_fresh_pass2.py');
const law = read('local_server/knowledge/legal/_dashboard/loop/law_fresh.py');
const ordin = read('local_server/knowledge/legal/_dashboard/loop/ordin_fresh.py');
ok('F1 admrul_fresh.py 가 `[%d/%d] %s %s` 를 찍는다', admrul.includes("print('[%d/%d] %s %s' % (i, total, verdict, t), flush=True)"));
ok('F2 admrul_fresh_pass2.py 가 `[%d/%d] …` 와 「2차 대조 대상 %d건」 을 찍는다',
  pass2.includes("print('[%d/%d] %s %s' % (i, len(todo)") && pass2.includes("'2차 대조 대상 %d건"));
ok('F3 law_fresh.py 가 `[%d/%d] %s %s` 와 「대상: %d개 계열」 을 찍는다',
  law.includes("print('[%d/%d] %s %s' % (i, len(targets), verdict, title), flush=True)") && law.includes("'   대상: %d개 계열'"));
ok('F4 ordin_fresh.py 가 `   … %d/%d` 를 5건마다 찍는다(50건마다이면 막대가 3분씩 멈춘다)',
  ordin.includes("print('   … %d/%d' % (i, len(files)), flush=True)") && ordin.includes('if i % 5 == 0 or i == len(files):'));
ok('F5 law_fresh.py·ordin_fresh.py 가 「■ 두 번째 마디」 를 찍는다',
  law.includes("'\\n■ 두 번째 마디") && ordin.includes("'■ 두 번째 마디"));
// 원본 print 꼴에 값을 넣어 만든 줄이 실제로 읽히는지(꼴과 정규식이 함께 맞아야 통과)
ok('F6 꼴에 값을 넣은 줄이 읽힌다',
  S.parseProgressLine('[%d/%d] %s %s'.replace('%d', '7').replace('%d', '222').replace('%s', '구버전').replace('%s', '선박법 시행령')).done === 7 &&
  S.parseProgressLine('   … %d/%d'.replace('%d', '5').replace('%d', '416')).total === 416);

console.log('③ 진행 줄이 아닌 줄');
ok('N1 요약줄', S.parseProgressLine('현행 600 / 구버전 3 / ★미래판보유 0 / 이름불일치 5 / 응답없음 0 (총 653) -> /x.json') === null);
ok('N2 목록줄', S.parseProgressLine('  · 어떤 고시 — 사용자 확정') === null);
ok('N3 빈 줄', S.parseProgressLine('') === null && S.parseProgressLine(undefined) === null);

console.log('④ 점검 전 상태');
const p0 = S.getScanProgress();
ok('G1 안 도는 중 · 막대 0 · 단계 4개(행정규칙 → 2차 → 법령 → 조례)',
  p0.running === false && p0.percent === 0 && same(p0.steps.map((s) => s.name), ['행정규칙', '행정규칙 2차', '법령', '조례']));

console.log('⑤ 배선');
const scanner = read('local_server/services/admrul_fresh_scanner.js');
const routes = read('local_server/routes/legal.js');
const ui = read('client/js/ai-chat/ai_chat.js');
ok('W1 스캐너가 자식 stdout 을 받아 진행 줄로 넘긴다',
  scanner.includes("stdio: ['ignore', 'pipe', 'pipe']") && scanner.includes('applyProgressLine(ln)'));
ok('W2 라우트 GET /api/legal/freshness/scan-progress 가 getScanProgress 를 준다',
  /router\.get\('\/api\/legal\/freshness\/scan-progress'[\s\S]{0,200}getScanProgress\(\)/.test(routes));
ok('W3 화면이 그 주소를 묻고 게이지 상자를 그린다',
  ui.includes("'/api/legal/freshness/scan-progress'") && ui.includes('id="nryaFreshGauge"') && ui.includes('function startFreshGauge'));
ok('W4 방을 옮기면 폴링을 멈춘다', /stopScanGauge\(\);[^\n]*\n\s*stopFreshGauge\(\);/.test(ui));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
