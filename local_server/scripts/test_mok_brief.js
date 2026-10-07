/**
 * test_mok_brief.js — ★원문결손 방의 「📋 대기 전체 지시문」 (3-83)
 *
 * [왜 있나] 2026-10-07 사장님 「원문결손 72건 … 여기에도 개정검토 탭처럼 전체 지시문 복사할 수 있도록」.
 * 대기 카드 전 건을 한 덩어리 인계문으로 만들고(services/mok_brief.js), 방 위 버튼이 그 글을
 * 개정검토와 같은 글상자에 펼친다. 같은 화면에서 본 「고시 별표: FileNotFoundError 'curl'」 도 함께 고친다.
 *
 * [무엇을 고정하나 — 망 없이]
 *  M1 머리·한눈에 보기: 대기 건수 · 종류별 수 · 표에 건마다 한 줄
 *  M2 발췌 의심(15_관련타부처 · 연결조문)을 표시하고 「정말 빠졌나」부터 보라고 적는다
 *  M3 「어디가 빈가」 는 카드처럼 10개에서 자르지 않는다 · 40개를 넘으면 자르고 **잘랐다고 적는다**
 *  M4 할 일은 종류마다 한 번만 · 닫았다 다시 뜬 까닭을 싣는다
 *  M5 끝에 건마다 판정표(카드 id 전부) · 「해당없음」도 다시 뜰 수 있다는 사실을 적는다 · 빈 목록은 ok:false
 *  M6 라우트 GET /api/legal/mok-audit/brief-all(관리자 · 대기만) · 화면 버튼이 그 글을 renderBriefBox 로 편다
 *  M7 고시 별표 점검은 curl 이 없으면 파이썬 내장으로 부른다 · 운영 이미지에 curl
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → services/mok_brief.js · routes/legal.js · client/js/ai-chat/ai_chat.js(renderMokCards)
 *          · _dashboard/loop/admrul_annex_survey.py(api) · Dockerfile
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const B = require('../services/mok_brief.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600));
  }
}

const ACT = ['① **정말 빠진 것인지 먼저 확인한다.** 발췌 …', '② 다시 받는다 — `python3 _dashboard/loop/recollect_jomun.py`', '③ `mok_audit.py`', '④ 위키'];
const items = [
  { id: 'mok_a1', title: '공직자의이해충돌방지법 법률', tier: '법률', kind: '조문 목 누락', mst: '232253', api_count: 39, raw_count: 38, missing: 1,
    spots: Array.from({ length: 12 }, (_, i) => `제2조 ${i + 1}. 자리${i + 1}`), files: ['raw/15_관련타부처/공직자의이해충돌방지법/법률.txt'], actions: ACT, status: 'pending' },
  { id: 'mok_a2', title: '농수산물유통및가격안정에관한법률 법률(법률_연결조문)', tier: '법률(법률_연결조문)', kind: '조문 목 누락', mst: '276413', api_count: 2, raw_count: 0, missing: 2,
    spots: ['제2조 9. "중도매인"'], files: ['raw/15_관련타부처/농수산물유통및가격안정에관한법률/법률_연결조문.txt'], actions: ACT, status: 'pending',
    reopen_reason: '해당없음으로 닫았는데 이번 점검에서도 누락으로 나왔습니다(1번째 재등장).' },
  { id: 'mok_a3', title: '항만운송사업법 시행령', tier: '시행령', kind: '조문 목 누락', mst: '256817', api_count: 6, raw_count: 5, missing: 1,
    spots: Array.from({ length: 45 }, (_, i) => `제2조 ${i}. 긴자리${i}`), files: ['raw/10_항만물류/항만운송사업법/시행령.txt'], actions: ACT, status: 'pending' },
  { id: 'mok_b1', title: '부산항 도선구 도선안전절차', tier: '행정규칙', kind: '고시 별표 없음', api_count: 1, raw_count: 0, files: [],
    actions: ['① 원문에 별표가 정말 있는지 확인한다', '② `admrul_fill_annex.py`'], status: 'pending' },
];
const r = B.buildMokBrief(items);
const t = r.text || '';

console.log('\n── M1 머리 · 한눈에 보기 ──');
ok('M1 대기 4건 머리', r.ok && t.startsWith('# 원문결손 처리 요청 — 대기 4건'), t.slice(0, 80));
ok('M1 종류별 수(조문 목 누락 3 · 고시 별표 없음 1)', r.kinds['조문 목 누락'] === 3 && r.kinds['고시 별표 없음'] === 1 && /조문 목 누락 3건 · 고시 별표 없음 1건/.test(t), r.kinds);
ok('M1 표에 건마다 한 줄(카드 id)', ['mok_a1', 'mok_a2', 'mok_a3', 'mok_b1'].every((id) => new RegExp('\\| `' + id + '` \\|').test(t)));
ok('M1 원본/우리 수가 표에 실린다(39개 / 38개 (1개 모자람))', /39개 \/ 38개 \(1개 모자람\)/.test(t));

console.log('\n── M2 발췌 의심 ──');
ok('M2 15_관련타부처 두 건을 발췌 의심으로 센다', r.excerpt === 2, r.excerpt);
ok('M2 연결조문 파일은 까닭에 「연결조문」', /15_관련타부처 · 연결조문/.test(t));
ok('M2 「정말 빠졌나」부터 보라고 적는다', /발췌본일 수 있는 것 2건/.test(t) && /모자란 것이 \*\*정상\*\*/.test(t));
ok('M2 15_관련타부처 밖(항만운송사업법)은 의심하지 않는다', B.excerptSuspect(items[2]) === '');

console.log('\n── M3 어디가 빈가 ──');
ok('M3 12곳은 다 싣는다(카드처럼 10에서 자르지 않는다)', /제2조 12\. 자리12/.test(t) && /제2조 11\. 자리11/.test(t));
ok('M3 45곳이면 40곳만 싣고 잘랐다고 적는다', /긴자리39/.test(t) && !/긴자리40/.test(t) && /그리고 5곳 더 — 글이 너무 길어져 앞 40곳만/.test(t));

console.log('\n── M4 할 일 · 다시 뜬 까닭 ──');
ok('M4 같은 종류의 할 일은 한 번만(3건이어도)', (t.match(/정말 빠진 것인지 먼저 확인한다/g) || []).length === 1, (t.match(/정말 빠진 것인지 먼저 확인한다/g) || []).length);
ok('M4 종류별 머리(### 조문 목 누락 3건 · ### 고시 별표 없음 1건)', /### 조문 목 누락 3건/.test(t) && /### 고시 별표 없음 1건/.test(t) && /admrul_fill_annex\.py/.test(t));
ok('M4 닫았다 다시 뜬 까닭을 싣는다', /↩ 해당없음으로 닫았는데 이번 점검에서도 누락으로/.test(t));

console.log('\n── M5 판정표 · 정직 ──');
const table = t.slice(t.indexOf('## 3. 돌려줄 것'));
ok('M5 판정표에 카드 id 4개 전부', ['mok_a1', 'mok_a2', 'mok_a3', 'mok_b1'].every((id) => table.indexOf('`' + id + '`') >= 0), table.slice(0, 600));
ok('M5 「해당없음」으로 닫아도 다시 뜰 수 있다고 적는다(reopenStillMissing)', /다음 점검에서 또 누락으로 나와 카드가 다시 뜬다/.test(t));
ok('M5 판단이 안 서면 비우라고 적는다(추측 금지)', /판정 칸을 비우고 까닭을 적는다/.test(t));
ok('M5 빈 목록은 ok:false', B.buildMokBrief([]).ok === false && B.buildMokBrief(null).ok === false);

console.log('\n── M6 라우트 · 화면 ──');
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
ok('M6 GET /api/legal/mok-audit/brief-all 이 관리자 전용이고 대기만 묶는다',
  /router\.get\('\/api\/legal\/mok-audit\/brief-all', adminAuth\.requireAdminToken/.test(routes)
  && /\(e\.status \|\| 'pending'\) === 'pending'/.test(routes.slice(routes.indexOf('mok-audit/brief-all'))));
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
const mok = ui.slice(ui.indexOf('function renderMokCards'), ui.indexOf('function loadMokList'));
ok('M6 원문결손 방 위에 「📋 대기 전체 지시문」 버튼', /id="nryaMokBriefBtn"/.test(mok) && /📋 대기 전체 지시문/.test(mok));
ok('M6 버튼이 brief-all 을 불러 개정검토와 같은 글상자(renderBriefBox)에 편다', /legalGet\('\/api\/legal\/mok-audit\/brief-all'\)/.test(mok) && /renderBriefBox\(briefBox,/.test(mok));
ok('M6 다시 누르면 접는다', /briefBox\.classList\.add\('nrya-hidden'\); return;/.test(mok));

console.log('\n── M7 고시 별표 점검 — curl 없음 ──');
const LOOP = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop');
const PY = String.raw`
import sys, json, shutil, urllib.request, time
sys.path.insert(0, sys.argv[1])
time.sleep = lambda *_: None
shutil.which = lambda name, *a, **k: None          # curl 이 없는 운영 이미지를 흉내
import subprocess
def boom(*a, **k): raise FileNotFoundError(2, "No such file or directory: 'curl'")
subprocess.run = boom
class R:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return b'{"AdmRulService": {"ok": 1}}'
urllib.request.urlopen = lambda *a, **k: R()
import admrul_annex_survey as S
print('@@' + json.dumps(S.api('https://www.law.go.kr/DRF/lawService.do?OC=x&target=admrul&ID=1')))
`;
const p = spawnSync('python3', ['-c', PY, LOOP, '--out', '/dev/null'], { encoding: 'utf8' });
const line = (p.stdout || '').split('\n').find((l) => l.startsWith('@@')) || '';
ok('M7 curl 이 없으면 죽지 않고 파이썬 내장으로 받는다', line === '@@{"AdmRulService": {"ok": 1}}', (p.stderr || '').slice(-400) + line);
const dk = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
ok('M7 운영 이미지가 curl 을 깔고 빌드에서 확인한다', /apt-get install[^\n]*ca-certificates curl/.test(dk) && /curl --version/.test(dk));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
