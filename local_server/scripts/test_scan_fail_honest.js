/**
 * test_scan_fail_honest.js — ★점검이 **하나도 확인하지 못했을 때** 「이상 없음」 으로 보이지 않는지를 고정한다. (3-80)
 *
 * [왜 있나] 2026-10-06 사장님 화면 — 운영 서버의 원문신선도 방이 「마지막 점검 10.04 · 848건 대조 ·
 * 낡은 원문 0건 · 응답없음 848건」 아래에 「✅ 낡은 원문이 없습니다」 라고 적었다. law.go.kr 조회가 **전부**
 * 실패했는데 ok:true 였고, 실패한 까닭(예외 문구)도 버려져 무엇이 막혔는지 알 수 없었다.
 * 같은 결이 셋 더 있었다: 매일 개정감지(`detect_law_changes.py`)는 광역질의가 실패하면 빈 목록 =
 * 「개정 없음」 으로 끝났고, 원문결손(`mok_audit`)도 전부 응답없음이면 ok:true 였다. 「원문결손」 배지는
 * 화면이 통계 칸을 옮겨 담을 때 빠뜨려 늘 `undefined` 였다.
 *
 * [무엇을 고정하나 — 망 없이 돈다]
 *  F1 신선도: 한 점검이 전부 응답없음이면 그 부분은 **실패**(까닭을 붙여) · 일부만이면 실패 아님
 *  F2 점검 자(law_fresh·ordin_fresh·admrul_fresh)가 실패 까닭을 보고서 `fail_reasons` 에 싣는다 · 열쇠(OC) 값은 가린다
 *  F3 개정감지: law.go.kr 이 한 번도 답하지 않으면 **종료코드 2**로 죽고 큐 파일을 건드리지 않는다
 *  F4 화면: 옛 상태 파일(ok:true · 전부 응답없음)도 실패 상자로 보이고 「낡은 원문이 없습니다」 를 쓰지 않는다 ·
 *     「원문결손」 배지가 통계 칸을 받는다
 *  F5 원문결손·개정감지·신선도 서버: 전부 실패면 실패로 적고 관리자에게 알린다
 *  F6 운영 이미지(Dockerfile)가 파이썬 인증서 저장소를 깔고, 비면 빌드를 멈춘다 — 검증을 끄는 우회는 없다 (3-81)
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → services/admrul_fresh_scanner.js(partFailure) · services/mok_audit_scanner.js · services/legal_amendment_scanner.js
 *          · _dashboard/loop/_fail_reasons.py · law_fresh.py · ordin_fresh.py · admrul_fresh.py · detect_law_changes.py
 *          · client/js/ai-chat/ai_chat.js(freshLastHTML · adminStatsCache)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const S = require('../services/admrul_fresh_scanner.js');
const LOOP = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop');
const SRV = path.join(__dirname, '..', 'services');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600));
  }
}

console.log('\n── 신선도: 하나도 확인 못 한 점검은 실패다 ──');
const f1 = S.partFailure({ checked: 653, unknown: 653, fail_reasons: [{ why: 'URLError: <urlopen error timed out>', n: 1959 }] });
ok('F1 전부 응답없음 → 실패(까닭이 붙는다)', /653건을 하나도 확인하지 못했다/.test(f1 || '') && /URLError/.test(f1 || ''), f1);
ok('F1 일부만 응답없음 → 실패 아님', S.partFailure({ checked: 653, unknown: 12 }) === null);
ok('F1 까닭이 없어도 실패로 친다(까닭 없음이라 적는다)', /까닭은 기록되지 않았다/.test(S.partFailure({ checked: 5, unknown: 5 }) || ''));
const scSrc = fs.readFileSync(path.join(SRV, 'admrul_fresh_scanner.js'), 'utf8');
ok('F1 runFreshnessScan 이 그 부분을 오류로 세고 「이상 없음」 숫자에 섞지 않는다',
  /const failWhy = partFailure\(rep\);\s*if \(failWhy\) \{\s*errors\.push/.test(scSrc));

console.log('\n── 점검 자가 실패 까닭을 싣는다 ──');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-fail-'));
const PY = String.raw`
import json, sys, urllib.request, time
sys.path.insert(0, sys.argv[1])
time.sleep = lambda *_: None
class Boom(Exception): pass
def bad(*a, **k): raise ConnectionResetError(104, 'Connection reset by peer')
urllib.request.urlopen = bad
import _fail_reasons, law_fresh, ordin_fresh
r1 = law_fresh.api('https://www.law.go.kr/DRF/lawSearch.do?OC=secret123&target=eflaw')
r2 = ordin_fresh.api('https://www.law.go.kr/DRF/lawSearch.do?OC=secret123&target=ordin')
class Html:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return '<html><body>사용자 정보 검증에 실패하였습니다 OC=secret123</body></html>'.encode()
urllib.request.urlopen = lambda *a, **k: Html()
r3 = law_fresh.api('https://x')
print(json.dumps({'r': [r1, r2, r3], 'top': _fail_reasons.top()}, ensure_ascii=False))
`;
const r = spawnSync('python3', ['-c', PY, LOOP], { encoding: 'utf8' });
let o = {};
try { o = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (_) { ok('F2 시험이 돌았다', false, r.stderr || r.stdout); }
const whys = (o.top || []).map((x) => x.why).join(' | ');
ok('F2 망 실패는 None(「없다」가 아니라 「모른다」)', JSON.stringify(o.r) === '[null,null,null]', o.r);
ok('F2 예외 까닭을 센다(ConnectionResetError)', /ConnectionResetError/.test(whys), whys);
ok('F2 JSON 이 아닌 응답은 첫 글자를 까닭으로(「사용자 정보 검증에 실패」)', /JSON 이 아닌 응답: 사용자 정보 검증에 실패/.test(whys), whys);
ok('F2 열쇠(OC) 값은 보고서에 남기지 않는다', !/secret123/.test(whys), whys);
for (const f of ['law_fresh.py', 'ordin_fresh.py', 'admrul_fresh.py']) {
  ok(`F2 ${f} 보고서에 fail_reasons 칸`, /'fail_reasons': _fail_reasons\.top\(\)/.test(fs.readFileSync(path.join(LOOP, f), 'utf8')));
}

console.log('\n── 개정감지: 한 번도 답이 없으면 실패로 죽는다 ──');
const out = path.join(tmp, 'queue.json');
const PY2 = String.raw`
import sys, runpy, urllib.request, time
sys.path.insert(0, sys.argv[1])
time.sleep = lambda *_: None
def bad(*a, **k): raise TimeoutError('timed out')
urllib.request.urlopen = bad
sys.argv = ['detect_law_changes.py', '--days', '1', '--out', sys.argv[2]]
runpy.run_path(sys.argv[0] if False else __import__('os').path.join(sys.path[0], 'detect_law_changes.py'), run_name='__main__')
`;
const r2 = spawnSync('python3', ['-c', PY2, LOOP, out], { encoding: 'utf8', timeout: 300000 });
ok('F3 종료코드 2', r2.status === 2, { status: r2.status, err: (r2.stderr || '').slice(-300) });
ok('F3 까닭을 말한다(TimeoutError)', /한 번도 답하지 않았다/.test(r2.stderr || '') && /TimeoutError/.test(r2.stderr || ''), (r2.stderr || '').slice(-300));
ok('F3 큐 파일을 건드리지 않는다(「개정 없음」 판을 쌓지 않는다)', !fs.existsSync(out));

console.log('\n── 화면 ──');
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
ok('F4 옛 상태 파일(ok:true·전부 응답없음)을 실패로 바꿔 보인다', /if \(last && last\.ok && freshNothingVerified\(last\)\)/.test(ui));
ok('F4 그때 「낡은 원문이 없습니다」를 쓰지 않는다', /data\.last && data\.last\.ok && !freshNothingVerified\(data\.last\)/.test(ui));
ok('F4 「원문결손」 배지가 통계 칸(mokAudit)을 받는다', /adminStatsCache = \{[^}]*mokAudit: data\.mokAudit/.test(ui));
// 화면 함수를 실제로 불러 본다 — freshNothingVerified 정의를 떼어 와 돌린다
const m = ui.match(/function freshNothingVerified\(last\) \{[\s\S]*?\n  \}/);
const fnv = m ? new Function(m[0] + '; return freshNothingVerified;')() : null;
ok('F4 판정: 848/848 → 확인 못 함 · 848/12 → 아님', fnv && fnv({ checked: 848, unknown: 848 }) === true && fnv({ checked: 848, unknown: 12 }) === false);

console.log('\n── 서버: 실패를 적고 알린다 ──');
const mok = fs.readFileSync(path.join(SRV, 'mok_audit_scanner.js'), 'utf8');
const amd = fs.readFileSync(path.join(SRV, 'legal_amendment_scanner.js'), 'utf8');
ok('F5 원문결손: 조문 목 전부 응답없음 → 오류', /건을 하나도 확인하지 못했다\(응답없음/.test(mok));
ok('F5 원문결손: 고시 별표 조회 전부 실패 → 오류', /조회가 모두 실패했다/.test(mok));
ok('F5 원문결손·신선도·개정감지가 실패를 관리자에게 알린다',
  /type: 'mok_audit_failed'/.test(mok) && /type: 'admrul_fresh_failed'/.test(scSrc) && /type: 'amendment_scan_failed'/.test(amd));

console.log('\n── 운영 이미지: 파이썬 인증서 저장소 (3-81) ──');
const dk = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
ok('F6 운영 이미지가 ca-certificates 를 깐다(node:20-slim 은 지운다 — 파이썬이 law.go.kr 을 못 열었다)',
  /apt-get install[^\n]*python3[^\n]*ca-certificates/.test(dk));
ok('F6 저장소가 비면 빌드를 멈춘다(cert_store_stats 단언)', /cert_store_stats\(\)\['x509_ca'\][\s\S]{0,80}assert n > 50/.test(dk));
ok('F6 검증을 끄는 우회가 없다', !/CERT_NONE|check_hostname\s*=\s*False|_create_unverified_context|PYTHONHTTPSVERIFY=0/.test(dk));
ok('F6 개정감지 실패 푸시가 까닭을 한 번만 싣는다', /split\('까닭:'\)\.pop\(\)/.test(amd));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
