/**
 * test_ordin_fresh.js — ★조례(자치법규)도 주간 원문 신선도 점검에 들어가 있는지를 고정한다. (3-78)
 *
 * [왜 있나] 2026-10-06 실측. 매일 개정감지(`detect_law_changes.py`)는 법령·행정규칙만, 매주 신선도 점검
 * (`admrul_fresh_scanner.js`)도 행정규칙·법령만 봤다 — **조례를 묻는 정기 점검이 하나도 없었다.**
 * 조례 416건을 현행과 견주니 12건이 옛 판, 2건은 이름이 바뀌어 있었다. 그 구멍이 다시 열리지 않게 잠근다.
 *
 * [무엇을 고정하나 — 망 없이 돈다]
 *  O1 주간 점검이 조례 점검(`ordin_fresh.py`)을 세 번째로 돌린다 · 그 파일이 있다
 *  O2 조례 구버전 카드: 「원문 구버전(조례)」 · 할 일이 `ordin_recollect.py --from-report` · 우리 시행일(file_eff)을 싣는다
 *  O3 조례 이름바뀜 카드: 할 일에 `--renamed` 와 「정말 같은 조례인지」 확인이 먼저 온다
 *  O4 판정(가짜 검색으로): 같은 날 → 현행 / 현행이 늦다 → 구버전 / 시행예정 → 현행+pending /
 *     같은 이름 두 지자체 → 우리 지자체로 가른다 / 못 가르면 「여럿」 / 이름이 없고 같은 지자체 후보 → 이름바뀜의심 /
 *     다른 군 후보는 잇지 않는다 → 이름불일치 / 망 실패 → 조회실패(「이상 없음」이 아니다)
 *  O5 머리말 두 꼴(`시행 N` · `시행일자: N` + MST)을 다 읽는다
 *  O6 다시 받기(`--from-report`)가 후보 둘 이상인 이름바뀜은 **고르지 않고**(G-34), 사람 손일이 있는 파일과
 *     **시행일이 아직 안 온 판**은 **쓰지 않는다**
 *  O7 관리자 카드가 조례를 일련번호가 아니라 시행일로 보여 준다
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → services/admrul_fresh_scanner.js · knowledge/legal/_dashboard/loop/ordin_fresh.py · ordin_recollect.py
 *          · client/js/ai-chat/ai_chat.js(freshnessCardHTML)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const S = require('../services/admrul_fresh_scanner.js');
const LOOP = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600));
  }
}

console.log('\n── 주간 점검 배선 ──');
const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'admrul_fresh_scanner.js'), 'utf8');
ok('O1 점검 목록에 조례가 있다', /\{ name: '조례', script: ORDIN_SCRIPT, out: ORDIN_REPORT_FILE \}/.test(src));
ok('O1 조례 점검 파일이 있다', fs.existsSync(S.ORDIN_SCRIPT), S.ORDIN_SCRIPT);
ok('O1 보고서는 볼륨(local_server/data)에 쓴다', /local_server[\\/]data[\\/]ordin_fresh_report\.json$/.test(S.ORDIN_REPORT_FILE), S.ORDIN_REPORT_FILE);

const stale = S.toQueueEntry({ title: '부산광역시 수상레저활동 안전관리 조례', tier: '조례',
  slug: '부산광역시/부산광역시수상레저활동안전관리조례', verdict: '구버전', file_eff: '20240925',
  current: { serial: '2140000', issued: '20260923', no: '7600', state: '부산광역시' }, files: ['raw/_자치법규/x/법률.txt'] });
ok('O2 카드 종류가 「원문 구버전(조례)」', stale.kind === '원문 구버전(조례)', stale.kind);
ok('O2 할 일이 ordin_recollect --from-report 로 다시 받기', /ordin_recollect\.py --from-report \.\.\/\.\.\/data\/ordin_fresh_report\.json --only 부산광역시\/부산광역시수상레저활동안전관리조례/.test(stale.actions[0]), stale.actions[0]);
ok('O2 행정규칙 재수집 도구를 안내하지 않는다', !stale.actions.join(' ').includes('admrul_recollect_stale'));
ok('O2 우리 시행일을 카드에 싣는다', stale.file_eff === '20240925');
const ren = S.toQueueEntry({ title: '전라남도 수산부산물 관리 및 재활용 촉진 조례', tier: '조례', slug: '전남광주통합특별시/x',
  verdict: '이름바뀜의심', rename_candidates: [{ name: '전남광주통합특별시 수산부산물 관리 및 재활용 촉진 조례', serial: '2137379', issued: '20260701', org: '전남광주통합특별시' }] });
ok('O3 이름바뀜 카드: 같은 조례인지 확인이 먼저', /정말 같은 조례인지/.test(ren.actions[0]) && ren.kind === '이름 바뀜 의심(조례)', ren.actions[0]);
ok('O3 이름바뀜 카드: --renamed 로 받는다', /--renamed`/.test(ren.actions[1]), ren.actions[1]);

console.log('\n── 판정(가짜 검색 · 망 없음) ──');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordin-fresh-'));
const PY = String.raw`
import json, os, sys
sys.path.insert(0, sys.argv[1]); tmp = sys.argv[2]
import ordin_fresh as F
F.ROOT = tmp; F.ORDIN = os.path.join(tmp, 'raw', '_자치법규')
def mk(rel, head):
    p = os.path.join(F.ORDIN, rel, '법률.txt'); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(head + '\n\n[제1조] 목적\n본문\n'); return p
R = lambda name, org, d, s='1': {'자치법규명': name, '지자체기관명': org, '시행일자': d, '자치법규일련번호': s, '공포번호': '9'}
DB = {}
def fake(q):
    if q == '망끊김 조례': return None
    return DB.get(q, [])
F.search = fake
out = {}
p = mk('부산광역시/가', '[조례] 부산광역시 가 조례\n지자체: 부산광역시 · 시행 20240925 · 공포번호 1')
DB['부산광역시 가 조례'] = [R('부산광역시 가 조례', '부산광역시', '20240925')]
out['same'] = F.judge_one(p, '20261006')['verdict']
DB['부산광역시 가 조례'] = [R('부산광역시 가 조례', '부산광역시', '20260923', '77')]
r = F.judge_one(p, '20261006'); out['newer'] = [r['verdict'], r['current']['serial'], r['file_eff']]
DB['부산광역시 가 조례'] = [R('부산광역시 가 조례', '부산광역시', '20261231')]
r = F.judge_one(p, '20261006'); out['future'] = [r['verdict'], len(r['pending'])]
p2 = mk('강원특별자치도/고성군나', '[조례] 고성군 나 조례\n지자체: 강원특별자치도 고성군 · 시행 20250912 · 분야')
DB['고성군 나 조례'] = [R('고성군 나 조례', '경상남도 고성군', '20191230'), R('고성군 나 조례', '강원특별자치도 고성군', '20250912')]
out['two_place'] = F.judge_one(p2, '20261006')['verdict']
p3 = mk('전남광주통합특별시/다', '[조례] 고성군 나 조례\n지자체: 전남광주통합특별시 · 시행 20250912 · 분야')
out['ambig'] = F.judge_one(p3, '20261006')['verdict']
p4 = mk('전남광주통합특별시/전라남도라', '[조례] 전라남도 라 조례\n지자체: (구)전라남도 · 시행 20230228 · 분야')
DB['라 조례'] = [R('전남광주통합특별시 라 조례', '전남광주통합특별시', '20260701', '2137379'), R('부산광역시 라 조례', '부산광역시', '20250521')]
r = F.judge_one(p4, '20261006'); out['renamed'] = [r['verdict'], [c['serial'] for c in r.get('rename_candidates', [])]]
F.HELD['전남광주통합특별시라조례'] = 'raw/_자치법규/전남광주통합특별시/전남광주통합특별시라조례/법률.txt'
r = F.judge_one(p4, '20261006'); out['held'] = [r['verdict'], r.get('superseded_by', '')]
F.HELD.clear()
p5 = mk('강원특별자치도/고성군마', '[조례] 고성군 마 조례\n지자체: 강원특별자치도 고성군 · 시행 20250912 · 분야')
DB['마 조례'] = [R('양양군 마 조례', '강원특별자치도 양양군', '20260101')]
out['other_gun'] = F.judge_one(p5, '20261006')['verdict']
p6 = mk('부산광역시/망', '[조례] 망끊김 조례\n지자체: 부산광역시 · 시행 20240925')
out['net'] = F.judge_one(p6, '20261006')['verdict']
p7 = mk('경상남도/바', '[자치법규] 경상남도 바 조례\n지자체: 경상남도 · 자치법규일련번호(MST): 1698231 · 시행일자: 20220414 · 종류: C0001')
out['head2'] = list(F.read_head(p7))
print(json.dumps(out, ensure_ascii=False))
`;
const r = spawnSync('python3', ['-c', PY, LOOP, tmp], { encoding: 'utf8' });
let o = {};
try { o = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (_) { ok('O4 판정 시험이 돌았다', false, r.stderr || r.stdout); }
ok('O4 같은 시행일 → 현행', o.same === '현행', o.same);
ok('O4 현행이 늦다 → 구버전(현행 일련·우리 시행일을 싣는다)', JSON.stringify(o.newer) === JSON.stringify(['구버전', '77', '20240925']), o.newer);
ok('O4 현행이 시행예정 → 결함 아님(현행 + 예고)', JSON.stringify(o.future) === JSON.stringify(['현행', 1]), o.future);
ok('O4 같은 이름 두 지자체 → 우리 지자체 것과 견준다', o.two_place === '현행', o.two_place);
ok('O4 우리 지자체로 못 가르면 「여럿」(고르지 않는다)', o.ambig === '여럿', o.ambig);
ok('O4 이름이 없고 같은 지자체에 후보 → 이름바뀜의심(후보는 그 지자체 것만)', JSON.stringify(o.renamed) === JSON.stringify(['이름바뀜의심', ['2137379']]), o.renamed);
ok('O4 새 이름 조례를 이미 갖고 있으면 「대체됨」을 적는다(다시 받으면 두 벌)', JSON.stringify(o.held) === JSON.stringify(['이름바뀜의심', 'raw/_자치법규/전남광주통합특별시/전남광주통합특별시라조례/법률.txt']), o.held);
ok('O4 다른 군의 비슷한 이름은 잇지 않는다 → 이름불일치', o.other_gun === '이름불일치', o.other_gun);
ok('O4 망 실패 → 조회실패(이상 없음이 아니다)', o.net === '조회실패', o.net);
ok('O5 「시행일자: N」 꼴과 MST 도 읽는다', JSON.stringify(o.head2) === JSON.stringify(['경상남도 바 조례', '경상남도', '20220414', '1698231']), o.head2);

console.log('\n── 다시 받기(--from-report) 안전장치 ──');
const leg = path.join(tmp, 'legal'); const rawRel = 'raw/_자치법규/전남광주통합특별시/가/법률.txt';
const PY2 = String.raw`
import json, os, sys
sys.path.insert(0, sys.argv[1]); tmp = sys.argv[2]
import ordin_recollect as OR
import coastal_ordin_collect as CC
def fake_get(serial):
    if serial == '8':
        return {'자치법규기본정보': {'시행일자': '29991231', '자치법규명': '다'}, '조문': {'조': []}}
    raise SystemExit('망을 부르면 안 된다 — 막혀야 한다')
CC.본문받기 = fake_get
OR.LEGAL = tmp
os.makedirs(os.path.join(tmp, 'raw/_자치법규/전남광주통합특별시/가'), exist_ok=True)
os.makedirs(os.path.join(tmp, 'raw/_자치법규/부산광역시/나'), exist_ok=True)
os.makedirs(os.path.join(tmp, 'raw/_자치법규/부산광역시/다'), exist_ok=True)
open(os.path.join(tmp, 'raw/_자치법규/부산광역시/다/법률.txt'), 'w').write('[조례] 다\n지자체: x · 시행 20200101\n\n[제1조] 목적\n본문\n')
open(os.path.join(tmp, 'raw/_자치법규/전남광주통합특별시/가/법률.txt'), 'w').write('[조례] 가\n지자체: x · 시행 20200101\n\n[제1조] 목적\n본문\n')
open(os.path.join(tmp, 'raw/_자치법규/부산광역시/나/법률.txt'), 'w').write('[조례] 나\n지자체: x · 시행 20200101\n\n[제1조] 목적\n본문\n⚠REVIEW 사용자 확인(2026-08-01): 별표 손으로 옮김\n')
rep = {'basis_date': '20261006', 'rows': [
  {'slug': '전남광주통합특별시/가', 'verdict': '이름바뀜의심', 'files': ['raw/_자치법규/전남광주통합특별시/가/법률.txt'],
   'rename_candidates': [{'serial': '1'}, {'serial': '2'}]},
  {'slug': '부산광역시/나', 'verdict': '구버전', 'files': ['raw/_자치법규/부산광역시/나/법률.txt'], 'current': {'serial': '9'}},
  {'slug': '전남광주통합특별시/라', 'verdict': '이름바뀜의심', 'files': ['raw/_자치법규/전남광주통합특별시/가/법률.txt'],
   'rename_candidates': [{'serial': '5', 'held_as': 'raw/_자치법규/전남광주통합특별시/새/법률.txt'}]},
  {'slug': '부산광역시/다', 'verdict': '구버전', 'files': ['raw/_자치법규/부산광역시/다/법률.txt'], 'current': {'serial': '8'}}]}
rp = os.path.join(tmp, 'rep.json'); json.dump(rep, open(rp, 'w'), ensure_ascii=False)
code = OR.refresh_from_report(rp, True, renamed=True)
print('@@' + json.dumps({'code': code, 'b': open(os.path.join(tmp, 'raw/_자치법규/부산광역시/나/법률.txt')).read(),
                         'c': open(os.path.join(tmp, 'raw/_자치법규/부산광역시/다/법률.txt')).read()}, ensure_ascii=False))
`;
fs.mkdirSync(leg, { recursive: true });
const r2 = spawnSync('python3', ['-c', PY2, LOOP, leg], { encoding: 'utf8', cwd: tmp });
const out2 = r2.stdout || '';
let o2 = {};
try { o2 = JSON.parse(out2.split('@@').pop()); } catch (_) { ok('O6 다시 받기 시험이 돌았다', false, (r2.stderr || '') + out2); }
ok('O6 이름 후보가 둘이면 고르지 않는다(G-34)', /후보가 2개 — 고르지 않는다/.test(out2), out2);
ok('O6 새 이름 조례를 이미 갖고 있으면 옛 사본에 덮어쓰지 않는다', /새 이름 조례가 이미 있다 — 덮어쓰지 않는다/.test(out2), out2);
ok('O6 사람 손일이 있는 파일은 쓰지 않는다', /사람 손일 \d+줄 — 덮어쓰지 않는다/.test(out2) && (o2.b || '').includes('⚠REVIEW'), out2);
ok('O6 받은 판이 시행 전이면 쓰지 않는다(시행예정 판을 현행처럼 넣지 않는다)', /시행일 29991231 이 아직 안 왔다 — 쓰지 않는다/.test(out2) && (o2.c || '').includes('시행 20200101'), out2);
ok('O6 막힌 것이 있으면 종료코드 1', o2.code === 1, o2.code);
void rawRel;

console.log('\n── 관리자 카드 ──');
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
ok('O7 조례 카드는 시행일로 견준다', /var isOrdin = tier\.indexOf\('조례'\) === 0;/.test(ui) && ui.includes("'우리 파일 시행일 <b>' + esc(it.file_eff || '?') + '</b> → 현행 시행일 <b>'"));
ok('O7 조례 카드 링크는 자치법규 쪽', ui.includes("'https://www.law.go.kr/자치법규/' + encodeURIComponent(it.title || '')"));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
