/**
 * test_collect_approved.js — ★관리자가 승인한 개정은 **법령이든 행정규칙이든** 한 명령으로 받는다. (3-82)
 *
 * [왜 있나] 2026-10-07 사장님 질문 「스캔이 돌 때 행정규칙도 관련성이 있는 규칙이라면 함께 수집되어야 할 것 같은데?」.
 * 인계문이 시키던 `collect_pending_law.py --all-approved` 는 **시행예정 법령(law_pending)만** 받고
 * 행정규칙 개정·새 고시·시행 중 법령 개정은 `⏭️ 대상 아님` 으로 건너뛰었다. 그리고 작업 세션은
 * 운영 서버의 큐를 못 봐서 승인분을 알 길도 없었다. 이제 인계문 끝의 **수집 목록**을
 * `collect_approved.py --from-brief` 가 읽고 종류마다 이미 있는 자를 부른다.
 *
 * [무엇을 고정하나 — 망 없이, 임시 트리에서]
 *  C1 인계문(단건·일괄)에 수집 목록이 실리고, 파이썬이 그대로 읽는다 · 본문은 싣지 않는다 · 승인 안 된 건은 빠진다
 *  C2 시행예정 법령 → `_대기/<시행일>/` 예고본(현행은 안 건드린다)
 *  C3 가진 고시의 새 판 → 같은 판번호 파일을 새 판으로(머리글 ID 갈아끼움) · 사람 손 흔적이 사라지면 보류 · 시행 전이면 보류
 *  C4 새 고시 → 관련 법이 하나면 그 법 `행정규칙/` 에 · 둘 이상이면 고르지 않는다(G-34) → `--place` 로 정하면 받는다 ·
 *     같은 제목 파일이 있으면 보류 · 두 번 돌려도 같은 파일을 두 번 만들지 않는다
 *  C5 시행 중 법령 → `recollect_tier.do_one` 에 넘긴다(15_관련타부처면 other) · 이름·부처만 바뀐 건은 「받을 원문 없음」
 *  C6 옛 자 `collect_pending_law.py --all-approved` 는 자기가 안 받는 승인분이 있으면 그렇다고 말한다
 *  C7 (3-89) 머리글에만 있는 표시는 잃지 않으므로 보류하지 않는다 · 옛 번호가 구판 보존본에만 있으면 「이미 현행」
 *     · 고시 본문을 받을 때 부칙도 같은 응답에서 받는다 · 소관부처는 집합으로 견준다(공동소관 오탐)
 *  C8 (3-89) 고시를 받거나 갈아끼우면 `<법>/별표/` 파일도 그 판으로 맞춘다(챗봇은 별표를 거기서 읽는다)
 *     · 사람 전사본은 덮지 않는다 · 새 판에 없는 파일은 지우지 않는다 · `[별지 제3호의2서식]` 은 별지3의2
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → _dashboard/loop/collect_approved.py · admrul_recollect_stale.py(refresh_file) · collect_pending_law.py
 *          · services/legal_wiki_brief.js(collectManifest)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const W = require('../services/legal_wiki_brief.js');
const LOOP = path.resolve(__dirname, '../knowledge/legal/_dashboard/loop');
const FIX = path.join(__dirname, 'data', 'pending_law_fixture.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 700));
  }
}

// ── 임시 트리 ────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-approved-'));
const TLEGAL = path.join(TMP, 'local_server', 'knowledge', 'legal');
const REL = (p) => path.relative(TMP, p).split(path.sep).join('/');
const lawA = path.join(TLEGAL, 'raw', '03_해상교통안전', '법A');
const lawB = path.join(TLEGAL, 'raw', '03_해상교통안전', '법B');
const lawP = path.join(TLEGAL, 'raw', '06_선원노동', '어선원및어선재해보상보험법');
const lawC = path.join(TLEGAL, 'raw', '15_관련타부처', '법C');
for (const d of [path.join(lawA, '행정규칙'), path.join(lawB, '행정규칙'), lawP, lawC, path.join(TLEGAL, '_dashboard')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(lawA, '_meta.json'), JSON.stringify({ 법령명: '법A', families: {} }));
fs.writeFileSync(path.join(lawB, '_meta.json'), JSON.stringify({ 법령명: '법B', families: {} }));
fs.writeFileSync(path.join(lawC, '_meta.json'), JSON.stringify({ 법령명: '법C', families: { 시행령: { MST: '800', 법령ID: '1' } } }));
fs.writeFileSync(path.join(lawP, '_meta.json'), JSON.stringify({ 법령명: '어선원 및 어선 재해보상보험법', families: { 법률: { MST: '259243', 법령ID: '009486' } } }));
fs.writeFileSync(path.join(lawC, '시행령.txt'), '[제1조] 목적 (시행 20260820 · 일부개정)\n본문\n');
const P_LAW = '[제1조] 목적 (시행 20240724 · 일부개정)\n현행 본문\n';
fs.writeFileSync(path.join(lawP, '법률.txt'), P_LAW);
const A1 = path.join(lawA, '행정규칙', '고시가.txt');
const A2 = path.join(lawA, '행정규칙', '고시나.txt');
const A3 = path.join(lawA, '행정규칙', '같은이름고시.txt');
fs.writeFileSync(A1, '[고시/행정규칙] 고시가\nID:111 · 소관: 해양수산부\n\n' + '옛 본문 '.repeat(30) + '\n');
fs.writeFileSync(A2, '[고시/행정규칙] 고시나\nID:121 · 소관: 해양수산부\n\n' + '옛 본문 '.repeat(30) + '\n【이미지판독】 사람이 옮겨 적은 표\n');
fs.writeFileSync(A3, '[고시/행정규칙] 같은이름고시\nID:131 · 소관: 부산청\n\n' + '본문 '.repeat(30) + '\n');
fs.writeFileSync(path.join(TLEGAL, '_dashboard', 'law_raw_paths.json'), JSON.stringify({
  법A: REL(lawA), 법B: REL(lawB), 법C: REL(lawC), 어선원및어선재해보상보험법: REL(lawP),
}));
const A4 = path.join(lawA, '행정규칙', '묶음고시_관할서.txt');
fs.writeFileSync(A4, '[고시/행정규칙] 묶음고시\n\n(가서) admrul 2100000000141\n' + '가 '.repeat(30) + '\n(나서) admrul 2100000000142\n' + '나 '.repeat(30) + '\n');
// (3-89) 머리글 배너에만 ⚠REVIEW 가 있는 파일 — 머리글은 남으므로 「사람작업 소실」 이 아니다
const A5 = path.join(lawA, '행정규칙', '고시다.txt');
fs.writeFileSync(A5, '[고시/행정규칙] 고시다\nID:151 · 소관: 해양수산부\n⚠REVIEW / 출처: 옛 재수집 배너\n\n' + '옛 본문 '.repeat(30) + '\n');
// (3-89) 일부러 남긴 구판 보존본(옛 번호 161)과 이미 새 번호(162)로 바뀐 현행본
const A6 = path.join(lawA, '행정규칙', '보존고시_2026-1호_구판전사.txt');
const A7 = path.join(lawA, '행정규칙', '보존고시.txt');
fs.writeFileSync(A6, '[고시/행정규칙] 보존고시 — 구판 전사본(보존)\nID:161 · 소관: 원주청\n\n' + '구판 '.repeat(30) + '\n');
fs.writeFileSync(A7, '[고시/행정규칙] 보존고시\nID:162 · 소관: 원주청\n\n' + '현행 '.repeat(30) + '\n');
const before = { A6: fs.readFileSync(A6, 'utf8'), A1: fs.readFileSync(A1, 'utf8'), A2: fs.readFileSync(A2, 'utf8') };

// ── 관리자 큐 항목(운영 서버의 legal_amendments_queue.jsonl 꼴 — toLegacyEntry) ──
const E = (id, kind, o) => Object.assign({ id, kind_code: kind, layer: '행정규칙', law: '법A', status: 'approved', 이전: {}, 현재: {}, related_laws: [], changed_articles: [] }, o);
const rows = [
  E('q1', 'law_pending', { layer: '법률', law: '어선원및어선재해보상보험법', 법령명: '어선원 및 어선 재해보상보험법',
    현재: { MST: '283875', 시행일자: '20260911' }, changed_articles: [{ 조문번호: '28', 조문가지번호: '', 옛본문: '긴 옛 본문 ㄱ', 새본문: '긴 새 본문 ㄴ' }] }),
  // ★시행일이 지났고 현행이 이미 그 판(MST 259243)이면 다시 대기로 받지 않는다(3-89 — 어제 처리한 44건이 오늘 113건 안에 다시 실렸다).
  E('q2', 'law_pending', { layer: '법률', law: '어선원및어선재해보상보험법', 법령명: '어선원 및 어선 재해보상보험법',
    현재: { MST: '259243', 시행일자: '20240724' } }),
  E('a1', 'admrul_amended', { 법령명: '고시가', 이전: { ID: '111', 법령명: '고시가' }, 현재: { ID: '112', 시행일자: '20260805', 발령일자: '20260805' } }),
  E('a2', 'admrul_amended', { 법령명: '고시나', 이전: { ID: '121', 법령명: '고시나' }, 현재: { ID: '122', 시행일자: '20260805' } }),
  E('a3', 'admrul_amended', { 법령명: '고시가', 이전: { ID: '111', 법령명: '고시가' }, 현재: { ID: '113', 시행일자: '20261231' } }),
  E('a5', 'admrul_amended', { 법령명: '고시다', 이전: { ID: '151', 법령명: '고시다' }, 현재: { ID: '152', 시행일자: '20260805' } }),
  E('a6', 'admrul_amended', { 법령명: '보존고시', 이전: { ID: '161', 법령명: '보존고시' }, 현재: { ID: '162', 시행일자: '20260805' } }),
  E('a4', 'admrul_amended', { 법령명: '묶음고시', 이전: { ID: '2100000000141', 법령명: '묶음고시' }, 현재: { ID: '2100000000149', 시행일자: '20260805' } }),
  E('n1', 'admrul_unknown_new', { law: '', 법령명: '새고시', 현재: { ID: '333', 시행일자: '20260806' }, related_laws: [{ slug: '법A', name: '법A' }] }),
  E('n2', 'admrul_unknown_new', { law: '', 법령명: '둘고시', 현재: { ID: '555', 시행일자: '20260806' }, related_laws: [{ slug: '법A' }, { slug: '법B' }] }),
  E('n3', 'admrul_unknown_new', { law: '', 법령명: '같은이름고시', 현재: { ID: '444', 시행일자: '20260806' }, related_laws: [{ slug: '법A' }] }),
  E('m1', 'law_amended', { layer: '시행령', law: '법C', 법령명: '법C', 이전: { MST: '800' }, 현재: { MST: '900', 시행일자: '20260820' } }),
  E('m2', 'law_amended', { layer: '시행령', law: '법C', 법령명: '법C', 이전: { MST: '700' }, 현재: { MST: '750', 시행일자: '20260101' } }),
  E('d1', 'law_dept_changed', { layer: '법률', law: '법A', 법령명: '법A' }),
  E('p1', 'admrul_unknown_new', { status: 'pending', 법령명: '승인안된고시', 현재: { ID: '777' }, related_laws: [{ slug: '법A' }] }),
];

console.log('\n── C1 인계문의 수집 목록 ──');
const bulk = W.buildBulkWikiBrief(rows, '20261007');
const one = W.buildWikiBrief(rows[0], '20261007');
const BRIEF = path.join(TMP, 'brief.md');
fs.writeFileSync(BRIEF, bulk.text);
const man = (bulk.text.match(/<!-- collect-manifest:start -->([\s\S]*?)<!-- collect-manifest:end -->/) || [])[1] || '';
ok('C1 일괄 인계문 끝에 수집 목록이 실린다', /"items":\[/.test(man) && /"id":"n2"/.test(man), bulk.text.slice(-500));
ok('C1 단건 인계문에도 그 건 하나의 수집 목록', /collect-manifest:start[\s\S]*"id":"q1"[\s\S]*collect-manifest:end/.test(one.text));
ok('C1 수집 목록에는 조문 본문을 싣지 않는다(글이 길어진다 — 위쪽에 이미 있다)', man && !/긴 새 본문/.test(man) && /"조문번호":"28"/.test(man));
ok('C1 1단계 명령이 collect_approved.py --from-brief 다', bulk.text.includes('collect_approved.py --from-brief'));

// ── 파이썬 쪽 — 망 대신 가짜 응답, 실제 기록 폴더 대신 빈 기록 ──
const PY = String.raw`
import json, os, sys
sys.path.insert(0, sys.argv[1])
TL, TMP, BRIEF, FIX = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
os.environ['COLLECT_TODAY'] = '20261007'
import collect_approved as CA, _admrul_id, collect_pending_law as CPL, admrul_recollect_stale as ARS, recollect_tier as RT
CA.LEGAL, CA.REPO = TL, TMP
CA.PATHS = os.path.join(TL, '_dashboard', 'law_raw_paths.json'); CA._PATHS = None
CA.OUT = os.path.join(TMP, 'report.json')
CA.Touched = lambda name: CPL._NullTouched()
_admrul_id.RAW = os.path.join(TL, 'raw'); _admrul_id.LEGAL = TL; _admrul_id._REC = {}; _admrul_id._REC_TAIL = {}
CA.time.sleep = lambda *_: None
fx = json.load(open(FIX, encoding='utf-8'))
CPL.fetch_eflaw = lambda mst, ef, from_json=None: fx
INFO = {'발령일자': '20260805', '시행일자': '20260805', '제개정구분명': '일부개정', '발령번호': '제7호', '소관부처명': '해양수산부'}
BODY = {'112': '새 판 본문 ' * 40, '152': '새 판 본문 ' * 40, '122': '새 판 본문 ' * 40, '333': '새 고시 본문 ' * 10, '555': '둘 고시 본문 ' * 10}
calls = []
def fb(serial, tries=4):
    calls.append(serial)
    return (BODY.get(serial), dict(INFO, 행정규칙명={'333': '새고시', '555': '둘고시'}.get(serial, ''))) if serial in BODY else (None, {})
ARS.fetch_body = fb
tier = []
def do_one(slug, t, mst, ef, touched, dry, allow, held_mst=None, other=False):
    tier.append({'slug': slug, 'tier': t, 'mst': mst, 'ef': ef, 'held': held_mst, 'other': other})
    return {'slug': slug, 'tier': t, 'status': '갱신'}
RT.do_one = do_one
annex = []
CA.FA.refresh_annex = lambda paths, dry=False, touched=None: (annex.extend(os.path.basename(x) for x in paths), {'다시썼다': ['x']})[1]
out = {}
out['code1'] = CA.main(['--from-brief', BRIEF])
out['r1'] = json.load(open(CA.OUT, encoding='utf-8'))['results']
out['n2_after1'] = [os.path.exists(os.path.join(TL, 'raw', '03_해상교통안전', d, '행정규칙', '둘고시.txt')) for d in ('법A', '법B')]
out['code2'] = CA.main(['--from-brief', BRIEF, '--place', 'n2=법B'])
out['r2'] = json.load(open(CA.OUT, encoding='utf-8'))['results']
out['tier'] = tier
out['calls'] = calls
out['annex'] = annex
print('@@' + json.dumps(out, ensure_ascii=False))
`;
const r = spawnSync('python3', ['-c', PY, LOOP, TLEGAL, TMP, BRIEF, FIX], {
  encoding: 'utf8', env: Object.assign({}, process.env, { NRYA_LEGAL_DIR: TLEGAL, NRYA_REPO_DIR: TMP }),
});
let o = {};
try { o = JSON.parse((r.stdout.split('\n').find((l) => l.startsWith('@@')) || '@@{}').slice(2)); } catch (e) { /* 아래에서 실패로 보인다 */ }
if (!o.r1) { ok('파이썬 시험이 돌았다', false, (r.stderr || '') + (r.stdout || '').slice(-800)); }
const by = (list, id) => (list || []).find((x) => x.id === id) || {};
const R1 = o.r1 || [], R2 = o.r2 || [];
ok('C1 승인 안 된 건(p1)은 받지 않는다', !by(R1, 'p1').id && R1.length === 14, R1.map((x) => x.id));

console.log('\n── C2 시행예정 법령 ──');
const staged = path.join(lawP, '_대기', '20260911', '법률.txt');
ok('C2 예고본을 _대기/20260911/법률.txt 에 둔다', by(R1, 'q1').status === '수집' && fs.existsSync(staged), by(R1, 'q1'));
ok('C2 현행 법률.txt 는 그대로', fs.readFileSync(path.join(lawP, '법률.txt'), 'utf8') === P_LAW);
ok('C2 두 번째는 「이미 있음」', by(R2, 'q1').status === '이미 있음', by(R2, 'q1'));
ok('C2 시행일이 지났고 현행이 그 판이면 「이미 현행」 — _대기/ 를 다시 만들지 않는다(3-89)',
  by(R1, 'q2').status === '이미 현행' && !fs.existsSync(path.join(lawP, '_대기', '20240724')), by(R1, 'q2'));

console.log('\n── C3 가진 고시의 새 판 ──');
const a1now = fs.readFileSync(A1, 'utf8');
ok('C3 같은 판번호 파일을 새 판으로 갈아끼운다(머리글 ID 111→112 · 본문)', by(R1, 'a1').status === '수집' && /^ID:112/m.test(a1now) && /새 판 본문/.test(a1now) && !/옛 본문/.test(a1now), by(R1, 'a1'));
ok('C3 머리글에 발령·현행화 줄을 남긴다', /발령: 일부개정 제7호 · 발령일자 20260805/.test(a1now) && /현행화: .*구ID 111 → 현행 112/.test(a1now), a1now.slice(0, 300));
ok('C3 사람 손 흔적(【이미지판독】)이 새 판에 없으면 덮지 않는다', /^보류\(사람작업 소실/.test(by(R1, 'a2').status) && fs.readFileSync(A2, 'utf8') === before.A2, by(R1, 'a2'));
ok('C3 시행 전(20261231)이면 받지 않는다', /^보류\(시행 전 20261231/.test(by(R1, 'a3').status) && (o.calls || []).indexOf('113') < 0, by(R1, 'a3'));
ok('C3 여러 고시를 묶은 파일은 통째로 덮지 않는다(나머지 관서 것이 사라진다)', /^보류\(여러 고시를 묶은 파일/.test(by(R1, 'a4').status)
  && /admrul 2100000000142/.test(fs.readFileSync(A4, 'utf8')) && (o.calls || []).indexOf('2100000000149') < 0, by(R1, 'a4'));
ok('C3 두 번째는 「이미 현행」(다시 받지 않는다)', by(R2, 'a1').status === '이미 현행', by(R2, 'a1'));

console.log('\n── C4 새 고시 ──');
const n1f = path.join(lawA, '행정규칙', '새고시.txt');
const n1txt = fs.existsSync(n1f) ? fs.readFileSync(n1f, 'utf8') : '';
ok('C4 관련 법이 하나면 그 법 행정규칙/ 에 새 파일(머리글 ID:333)', by(R1, 'n1').status === '수집' && /^ID:333/m.test(n1txt) && /관리자 승인\(개정검토 n1\)/.test(n1txt), by(R1, 'n1'));
ok('C4 관련 법이 둘이면 고르지 않는다(G-34) — --place 를 알려 준다', /^보류\(관련 법 2개.*--place n2=/.test(by(R1, 'n2').status)
  && JSON.stringify(o.n2_after1) === '[false,false]', [by(R1, 'n2'), o.n2_after1]);
ok('C4 --place n2=법B 로 정하면 그 법 폴더에 받는다', by(R2, 'n2').status === '수집' && fs.existsSync(path.join(lawB, '행정규칙', '둘고시.txt')), by(R2, 'n2'));
ok('C4 같은 제목 파일이 있으면 보류(새 판인지 다른 관서 것인지 사람이 본다)', /^보류\(같은 제목 파일/.test(by(R1, 'n3').status), by(R1, 'n3'));
ok('C4 두 번째는 「이미 있음」 — 같은 고시를 두 번 만들지 않는다', by(R2, 'n1').status === '이미 있음'
  && fs.readdirSync(path.join(lawA, '행정규칙')).filter((f) => /새고시/.test(f)).length === 1, by(R2, 'n1'));

console.log('\n── C5 시행 중 법령 · 이름/부처만 바뀐 건 ──');
const t0 = (o.tier || [])[0] || {};
ok('C5 시행 중 법령은 recollect_tier.do_one 에 넘긴다(새 MST·시행일·옛 MST)', by(R1, 'm1').status === '수집' && t0.slug === '법C' && t0.tier === '시행령' && t0.mst === '900' && t0.ef === '20260820' && t0.held === '800', o.tier);
ok('C5 15_관련타부처 법이면 other=True', t0.other === true, t0);
ok('C5 우리 사본이 큐보다 뒤 판이면(MST 800·시행 20260820 > 큐 750·20260101) 「이미 현행(더 새 판)」 — 넘기지 않는다',
  /^이미 현행\(우리 사본이 더 새 판/.test(by(R1, 'm2').status) && (o.tier || []).every((t) => t.mst !== '750'), by(R1, 'm2'));
ok('C5 소관부처 변경은 「받을 원문 없음」', /^받을 원문 없음/.test(by(R1, 'd1').status), by(R1, 'd1'));
ok('C5 실패가 없으면 종료코드 0', o.code1 === 0 && o.code2 === 0, [o.code1, o.code2]);

console.log('\n── C6 옛 자가 침묵하지 않는다 ──');
const Q = path.join(TLEGAL, '_dashboard', 'law_change_queue.json');
fs.writeFileSync(Q, JSON.stringify({ items: [{ id: 'x1', kind: 'admrul_amended', status: 'approved' }, { id: 'x2', kind: 'law_amended', status: 'approved' }] }));
const r6 = spawnSync('python3', [path.join(LOOP, 'collect_pending_law.py'), '--all-approved'], {
  encoding: 'utf8', env: Object.assign({}, process.env, { NRYA_LEGAL_DIR: TLEGAL, NRYA_REPO_DIR: TMP }),
});
ok('C6 collect_pending_law.py --all-approved 가 「2건은 이 자가 받지 않는다 — collect_approved.py」 라고 말한다',
  /승인분 중 2건은 시행예정 법령이 아니라 이 자가 받지 않는다/.test(r6.stdout || ''), (r6.stdout || '') + (r6.stderr || ''));
const OLD = path.join(TMP, 'old_brief.md');
fs.writeFileSync(OLD, '# 위키 반영 요청 — 일괄 승인분 2건\n\n1. collect_pending_law.py --all-approved\n');
const r7 = spawnSync('python3', [path.join(LOOP, 'collect_approved.py'), '--from-brief', OLD], { encoding: 'utf8' });
ok('C6 수집 목록이 없는 옛 인계문이면 다시 뽑으라고 말하고 종료코드 2', r7.status === 2 && /다시 뽑아라/.test(r7.stdout || ''), r7.stdout);

console.log('\n── C7 (3-89) 머리글 표시 · 구판 보존본 · 부칙 · 공동소관 ──');
const a5now = fs.readFileSync(A5, 'utf8');
ok('C7 머리글 배너에만 있는 ⚠REVIEW 는 남으므로 보류하지 않고 갱신한다', by(R1, 'a5').status === '수집' && /^ID:152/m.test(a5now) && /⚠REVIEW \/ 출처: 옛 재수집 배너/.test(a5now), by(R1, 'a5'));
ok('C7 옛 번호가 구판 보존본에만 있고 현행본이 이미 새 번호면 「이미 현행」 — 보존본은 그대로',
  by(R1, 'a6').status === '이미 현행' && fs.readFileSync(A6, 'utf8') === before.A6 && (o.calls || []).indexOf('162') < 0, by(R1, 'a6'));
const PY7 = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
import admrul_recollect_stale as ARS, detect_law_changes as D
resp = {'AdmRulService': {'행정규칙기본정보': {'발령일자': '20260928'}, '조문내용': ['제1조(목적) 본문'],
        '부칙': {'부칙내용': ['부칙 <제1호, 2020. 1. 1.>이 고시는 발령한 날부터 시행한다.', '부칙 <제2호, 2026. 9. 28.>이 고시는 발령한 날부터 시행한다.']}}}
ARS.curl = lambda url: json.dumps(resp, ensure_ascii=False)
body, info = ARS._fetch_once('9')
resp['AdmRulService'].pop('부칙')
body2, _ = ARS._fetch_once('9')
print('@@' + json.dumps({'body': body, 'body2': body2,
  'same': D._dept_set('농림축산식품부') <= D._dept_set('농림축산식품부,식품의약품안전처,해양수산부'),
  'moved': D._dept_set('농림축산식품부') <= D._dept_set('해양수산부')}, ensure_ascii=False))
`;
const r8 = spawnSync('python3', ['-c', PY7, LOOP], { encoding: 'utf8' });
let o8 = {};
try { o8 = JSON.parse((r8.stdout.split('\n').find((l) => l.startsWith('@@')) || '@@{}').slice(2)); } catch (e) { /* 아래 실패 */ }
ok('C7 고시 본문을 받을 때 부칙도 같은 응답에서 [부칙] 으로 붙인다(갱신 때 부칙이 지워지던 것)',
  /제1조\(목적\) 본문\n\n\[부칙\]\n부칙 <제1호[^\n]*\n부칙 <제2호/.test(o8.body || ''), (o8.body || '') + (r8.stderr || ''));
ok('C7 응답에 부칙이 없으면 [부칙] 을 지어 붙이지 않는다', o8.body2 === '제1조(목적) 본문', o8.body2);
ok('C7 공동소관 목록에 기준선 부처가 들어 있으면 이관이 아니다 · 빠지면 이관', o8.same === true && o8.moved === false, o8);

console.log('\n── C8 (3-89) 고시 별표 파일도 그 판으로 ──');
ok('C8 갈아끼운 고시(고시가)·새 고시(새고시)의 별표를 맞추라고 부른다 · 보류된 것(고시나)은 안 부른다',
  (o.annex || []).includes('고시가.txt') && (o.annex || []).includes('새고시.txt') && !(o.annex || []).includes('고시나.txt')
  && /별표: 다시썼다 1/.test(by(R1, 'a1').note || ''), [o.annex, by(R1, 'a1').note]);
const BY = path.join(lawA, '별표');
fs.mkdirSync(BY, { recursive: true });
const G = path.join(lawA, '행정규칙', '별표고시.txt');
fs.writeFileSync(G, '[고시/행정규칙] 별표고시\nID:902 · 소관: 해양수산부\n\n본문\n');
const F1 = path.join(BY, '별표고시_별표1.txt'), F2 = path.join(BY, '별표고시_별표2.txt'), F9 = path.join(BY, '별표고시_별표9.txt');
fs.writeFileSync(F1, '[별표고시] 별표1 — 옛 제목\n출처: 국가법령정보센터 행정규칙 API target=admrul ID=901 (수집 2026-08-31)\n\n옛 표\n');
fs.writeFileSync(F2, '[별표고시] 별표2 — 사람 전사\n출처: 첨부 HWP 를 사람이 옮김\n\n사람 표\n');
fs.writeFileSync(F9, '[별표고시] 별표9 — 옛 판에만\n출처: 국가법령정보센터 행정규칙 API target=admrul ID=901\n\n옛\n');
const PY8 = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
import admrul_fill_annex as FA
from collect_pending_law import _NullTouched
units = [{'별표구분': '별표', '별표번호': '0001', '별표키': '000100', '별표제목': '새 제목', '별표내용': '[별표 1]\n새 표'},
         {'별표구분': '별표', '별표번호': '0002', '별표키': '000200', '별표제목': '새 둘', '별표내용': '[별표 2]\n새 둘'},
         {'별표구분': '별지', '별표번호': '0003', '별표가지번호': '02', '별표키': '000302', '별표제목': '감리 조서', '별표내용': '[별지 제3호의2서식]\n칸'}]
FA.api = lambda url, tries=4: {'AdmRulService': {'별표': {'별표단위': units}}}
r = FA.refresh_annex([sys.argv[2]], False, _NullTouched())
print('@@' + json.dumps({k: [x.split('/')[-1] for x in v] for k, v in r.items()}, ensure_ascii=False))
`;
const r9 = spawnSync('python3', ['-c', PY8, LOOP, G], { encoding: 'utf8' });
let o9 = {};
try { o9 = JSON.parse((r9.stdout.split('\n').find((l) => l.startsWith('@@')) || '@@{}').slice(2)); } catch (e) { /* 아래 실패 */ }
const f1now = fs.existsSync(F1) ? fs.readFileSync(F1, 'utf8') : '';
ok('C8 옛 판 API 수집본은 새 판으로 다시 쓴다(ID 902 · 새 표)', (o9['다시썼다'] || []).includes('별표고시_별표1.txt') && /ID=902/.test(f1now) && /새 표/.test(f1now) && !/옛 표/.test(f1now), [o9, r9.stderr]);
ok('C8 사람 전사본(출처가 API 가 아님)은 덮지 않는다', (o9['사람전사_그대로'] || []).includes('별표고시_별표2.txt') && /사람 표/.test(fs.readFileSync(F2, 'utf8')), o9);
ok('C8 새 판에 없는 별표 파일은 지우지 않고 알린다', (o9['새판에없음'] || []).includes('별표고시_별표9.txt') && fs.existsSync(F9), o9);
ok('C8 `[별지 제3호의2서식]` 은 별지3의2 로 쓴다(3호와 겹쳐 사라지지 않게)', (o9['새로썼다'] || []).includes('별표고시_별지3의2.txt') && fs.existsSync(path.join(BY, '별표고시_별지3의2.txt')), o9);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
