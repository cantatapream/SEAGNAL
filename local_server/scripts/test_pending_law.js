/**
 * test_pending_law.js — 예고본 사전수집·시행일 자동 전환(H-29 트랙 C)을 고정한다.
 *
 * [왜 있나] 개정 법령은 공포 뒤 시행까지 유예가 있다. 예고본을 `_대기/<시행일>/` 에 미리 받아 두고 위키에
 * 옛·새 서술을 마커로 둘 다 적어 두면, 런타임이 **읽을 때 오늘(KST) 날짜로 한쪽을 고른다** — 시행일에
 * 서버가 파일을 고치지 않는다. 설계·상태변화 표: `knowledge/legal/_dashboard/H29_stage_design.md` §5.
 *
 * [고정하는 것 — 표 §5 와 1:1]
 *   T-date-1  오늘 계산이 순수함수(UTC+9 직접 더함, TZ 무관)·주입 가능          (④⑧)
 *   T-raw-1~4 지도에서 `date<=today` 최신 하나만, 층별 독립                      (①⑤)
 *   T-wiki-1~4 인라인·블록 마커 접기, 표가 끊기지 않음, 자정 캐시                  (⑪)
 *   T-collect-1~3 수집기가 현행과 같은 꼴 + 부칙, 같은 날짜 새 MST 는 대체, 시행일자 불일치는 저장 안 함 (①′⑥⑬)
 *   T-verify-1~3 연기·철회·dismissed 를 ❌ 로 잡는다                              (②③⑨)
 *   T-status-1 사서가 마커를 안 넣은 대기본을 ⚠ 로 찍는다                        (⑦)
 *   T-fold-1~2 fold_effective 의 파이썬 접기 == JS 접기 · 현행과 같은 MST 면 대기본만 지운다 (⑩)
 *   T-popup-1  실제 수집한 어선원법 대기본으로 조문 팝업이 날짜에 따라 갈린다(githubRaw 를 로컬 파일로 대체)
 *
 * [주의] 시각 의존 금지 — 모든 날짜는 setTodayForTest·--today 로 주입한다. 네트워크 없음(--from-json).
 * [연계] ← services/effective_date.js · services/article_text.js · services/legal_retriever.js
 *        ← _dashboard/loop/collect_pending_law.py · fold_effective.py
 *        ← scripts/refactor/verify_all.sh SUITES
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const E = require('../services/effective_date.js');
const githubRaw = require('../services/github_raw.js');
const A = require('../services/article_text.js');
const R = require('../services/legal_retriever.js');

const LEGAL = path.resolve(__dirname, '../knowledge/legal');
const LOOP = path.join(LEGAL, '_dashboard', 'loop');
const FIX = path.join(__dirname, 'data', 'pending_law_fixture.json');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 임시 트리(테스트 전용 LEGAL) — 실제 raw·위키·큐는 건드리지 않는다 ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nrya-pending-'));
const TLEGAL = path.join(TMP, 'local_server', 'knowledge', 'legal');
const TRAW = path.join(TLEGAL, 'raw', '06_선원노동', '어선원및어선재해보상보험법');
fs.mkdirSync(TRAW, { recursive: true });
fs.mkdirSync(path.join(TLEGAL, '_dashboard'), { recursive: true });
fs.mkdirSync(path.join(TLEGAL, 'wiki', 'concepts'), { recursive: true });
fs.writeFileSync(path.join(TRAW, '_meta.json'), JSON.stringify({
  법령명: '어선원 및 어선 재해보상보험법', 시행일: '20240724',
  families: { 법률: { MST: '259243', 파일: '법률.json', 법령ID: '009486' }, 시행령: { MST: '273825', 파일: '시행령.json' } },
}, null, 2));
fs.writeFileSync(path.join(TRAW, '법률.txt'), '[제1조] 목적 (시행 20240724 · 일부개정)\n현행 본문\n\n부칙\n\n부칙 <제1호,2024.1.1>\n');
const QUEUE = path.join(TLEGAL, '_dashboard', 'law_change_queue.json');
const ITEM = (id, mst, ef, status) => ({
  id, kind: 'law_pending', layer: '법률', status,
  law: { slug: '어선원및어선재해보상보험법', name: '어선원 및 어선 재해보상보험법', raw: '/x/raw/06_선원노동/어선원및어선재해보상보험법' },
  after: { MST: mst }, 시행일자: ef, changed_articles: [{ 조문번호: '28' }],
});
fs.writeFileSync(QUEUE, JSON.stringify({ items: [ITEM('q1', '283875', '20260911', 'approved'), ITEM('q2', '999999', '20260911', 'approved'), ITEM('q3', '283875', '20261001', 'dismissed')] }));
const fixture = JSON.parse(fs.readFileSync(FIX, 'utf8'));   // 어선원법 예고본 API 응답 축약본(기본정보·조문 3개·부칙 1개)
const env = Object.assign({}, process.env, { NRYA_LEGAL_DIR: TLEGAL, NRYA_REPO_DIR: TMP });
const py = (script, args, fx) => execFileSync('python3', [path.join(LOOP, script), ...args, ...(fx ? ['--from-json', fx] : [])], { env, encoding: 'utf8' });
const FIXJ = path.join(TMP, 'fx.json');
fs.writeFileSync(FIXJ, JSON.stringify(fixture));

console.log('── T-date 오늘(KST) 계산 ──');
{
  // 2026-09-10 15:30 UTC = 2026-09-11 00:30 KST → 날짜가 넘어가야 한다(TZ 환경변수와 무관).
  ok('T-date-1 UTC 15:30 이 KST 다음날이다', E.todayKST(Date.UTC(2026, 8, 10, 15, 30)) === '20260911');
  ok('T-date-1 UTC 14:59 는 아직 같은 날', E.todayKST(Date.UTC(2026, 8, 10, 14, 59)) === '20260910');
  E.setTodayForTest('20260101');
  ok('T-date-1 주입값이 우선한다', E.todayKST() === '20260101');
  E.setTodayForTest(null);
}

console.log('── T-raw 대기본 고르기(지도) ──');
{
  const base = 'local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법';
  const idx = { [base]: [
    { date: '20260911', files: ['법률.txt'] }, { date: '20261001', files: ['법률.txt', '시행령.txt'] },
  ] };
  ok('T-raw-1 시행일 전에는 null(현행)', E.stagedRawPath(base, '법률.txt', '20260910', idx) === null);
  ok('T-raw-2 시행일 당일부터 그 판', E.stagedRawPath(base, '법률.txt', '20260911', idx) === base + '/_대기/20260911/법률.txt');
  ok('T-raw-3 두 판이 지났으면 최신 하나(뒤 판이 앞 판을 포함 — 설계 F6)', E.stagedRawPath(base, '법률.txt', '20261001', idx) === base + '/_대기/20261001/법률.txt');
  ok('T-raw-4 층별 독립 — 시행령은 그 층의 대기본이 있는 날부터만', E.stagedRawPath(base, '시행령.txt', '20260911', idx) === null
    && E.stagedRawPath(base, '시행령.txt', '20261001', idx) === base + '/_대기/20261001/시행령.txt');
  ok('T-raw-4 지도에 없는 법은 null', E.stagedRawPath('local_server/knowledge/legal/raw/x/y', '법률.txt', '20261231', idx) === null);
}

console.log('── T-wiki 마커 접기 ──');
const WIKI_FX = [
  '## 요지', '옛 문장 그대로.',
  '<!--시행전 20260918-->', '- 원상회복 명령은 시장이 한다(옛)', '<!--/시행전-->',
  '<!--시행 20260918-->', '- 원상회복 명령은 시·도지사가 한다(새)', '<!--/시행-->',
  '## 근거 조문', '| 법령 | 조문 | 요지 |', '|---|---|---|',
  '| 공유수면법 | 제21조 | <!--시행전 20260918-->옛 요지<!--/시행전--><!--시행 20260918-->새 요지<!--/시행--> |',
  '| 공유수면법 | 제54조 | 그대로 |',
].join('\n');
{
  const before = E.applyStageMarkers(WIKI_FX, '20260917');
  const after = E.applyStageMarkers(WIKI_FX, '20260918');
  ok('T-wiki-1 시행 전: 옛 서술만', before.includes('(옛)') && !before.includes('(새)') && before.includes('| 옛 요지 |') && !before.includes('새 요지'));
  ok('T-wiki-2 시행 당일부터: 새 서술만', after.includes('(새)') && !after.includes('(옛)') && after.includes('| 새 요지 |') && !after.includes('옛 요지'));
  ok('T-wiki-2 마커 자체는 남지 않는다', !/<!--/.test(before) && !/<!--/.test(after));
  const chain = R.extractCitationChain(after);
  ok('T-wiki-3 표가 끊기지 않는다(마커 행 뒤 제54조 행이 살아 있다)', chain.some(r => r.article === '제54조') && chain.some(r => r.article === '제21조' && /새 요지/.test(r.gist || JSON.stringify(r))));
  ok('T-wiki-3 마커 없는 본문은 그대로', E.applyStageMarkers('a\nb', '20260101') === 'a\nb');
}
{
  // T-wiki-4 readPage 캐시가 자정을 넘긴다 — 위키 폴더에 잠깐 페이지를 만들어 읽고 곧 지운다.
  //   ⚠wiki/ 는 다른 트랙 소유라 파일을 남기지 않는다(finally 에서 삭제). 이름은 충돌 없게 pid 를 붙인다.
  const tmpName = `_zz_test_pending_${process.pid}`;
  const fp = path.join(LEGAL, 'wiki', 'concepts', tmpName + '.md');
  try {
    fs.writeFileSync(fp, '---\nstatus: draft\n---\n' + WIKI_FX);
    E.setTodayForTest('20260917');
    const b1 = R.readPage('concept', tmpName).body;
    E.setTodayForTest('20260918');
    const b2 = R.readPage('concept', tmpName).body;
    ok('T-wiki-4 같은 파일(mtime 동일)이라도 날짜가 바뀌면 다른 본문', b1.includes('(옛)') && b2.includes('(새)') && !b2.includes('(옛)'));
  } finally {
    E.setTodayForTest(null);
    try { fs.unlinkSync(fp); } catch (_) { /* 없으면 그만 */ }
  }
}

console.log('── T-collect 수집기(오프라인, 임시 트리) ──');
{
  const out = py('collect_pending_law.py', ['q1'], FIXJ);
  const staged = path.join(TRAW, '_대기', '20260911', '법률.txt');
  const txt = fs.existsSync(staged) ? fs.readFileSync(staged, 'utf8') : '';
  ok('T-collect-1 대기본이 현행과 같은 꼴(조 머리 + 시행일)', /^\[제28조\] 장례비 \(시행 20260911 · 일부개정\)$/m.test(txt), out.slice(-200));
  ok('T-collect-1 부칙이 붙는다(경과규정 보존)', /\n부칙\n\n부칙 </.test(txt));
  const meta = JSON.parse(fs.readFileSync(path.join(TRAW, '_대기', '20260911', '_meta.json'), 'utf8'));
  ok('T-collect-1 _meta.json 에 MST·changed_articles·queue_id', meta.families.법률.MST === '283875' && meta.families.법률.queue_id === 'q1' && meta.families.법률.changed_articles.length === 1);
  const idx = JSON.parse(fs.readFileSync(path.join(TLEGAL, '_dashboard', 'pending_index.json'), 'utf8'));
  const key = 'local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법';
  ok('T-collect-1 지도 키가 rawPathOf 값과 같은 꼴이고 항목이 맞다', Array.isArray(idx[key]) && idx[key][0].date === '20260911' && idx[key][0].mst['법률.txt'] === '283875');
  // ①′ 같은 시행일에 새 MST → 대체. 픽스처는 MST 283875 응답이라 큐 q2(999999)로 부르면 응답 MST 와 다르지만
  //    수집기는 응답의 시행일자만 대조한다 — 대체 로그와 _meta MST 갱신을 본다.
  const out2 = py('collect_pending_law.py', ['q2'], FIXJ);
  const meta2 = JSON.parse(fs.readFileSync(path.join(TRAW, '_대기', '20260911', '_meta.json'), 'utf8'));
  ok('T-collect-2 같은 날짜 새 MST 는 덮어쓰고 "대체" 로 찍는다', /대체/.test(out2) && meta2.families.법률.MST === '999999');
  // ⑬ 응답 시행일자 ≠ 큐 시행일자 → 저장 안 함
  const q3 = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  q3.items.push(ITEM('q4', '283875', '20261111', 'approved'));
  fs.writeFileSync(QUEUE, JSON.stringify(q3));
  const out3 = py('collect_pending_law.py', ['q4'], FIXJ);
  ok('T-collect-3 응답 시행일자가 큐와 다르면 저장하지 않는다', /저장 안 함/.test(out3) && !fs.existsSync(path.join(TRAW, '_대기', '20261111')));
}

console.log('── T-verify 대기본 유효성 ──');
{
  // 지금 대기본은 MST 999999(q2) — 픽스처 재조회는 시행일자 20260911 로 유효.
  let out = '';
  try { out = py('collect_pending_law.py', ['--verify'], FIXJ); } catch (e) { out = String(e.stdout || ''); }
  ok('T-verify-0 유효한 대기본은 ✅', /✅ .*20260911/.test(out), out.slice(-300));
  // ② 연기: 픽스처 시행일자를 바꿔 재조회하면 폴더 날짜와 어긋난다.
  const fx2 = JSON.parse(JSON.stringify(fixture)); fx2.법령.기본정보.시행일자 = '20261201';
  const FIX2 = path.join(TMP, 'fx2.json'); fs.writeFileSync(FIX2, JSON.stringify(fx2));
  let code = 0; out = '';
  try { out = py('collect_pending_law.py', ['--verify'], FIX2); } catch (e) { code = e.status; out = String(e.stdout || ''); }
  ok('T-verify-1 시행일이 바뀌면 ❌(연기) + 종료코드 1', code === 1 && /❌ .*연기/.test(out), out.slice(-300));
  // ③ 철회: 빈 응답
  const FIX3 = path.join(TMP, 'fx3.json'); fs.writeFileSync(FIX3, '{}');
  code = 0; out = '';
  try { out = py('collect_pending_law.py', ['--verify'], FIX3); } catch (e) { code = e.status; out = String(e.stdout || ''); }
  ok('T-verify-2 재조회가 비면 ❌(철회 의심)', code === 1 && /철회/.test(out), out.slice(-300));
  // ⑨ dismissed: 큐 상태를 바꾼다
  const q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  q.items.find(i => i.id === 'q2').status = 'dismissed';
  fs.writeFileSync(QUEUE, JSON.stringify(q));
  code = 0; out = '';
  try { out = py('collect_pending_law.py', ['--verify', '--prune'], FIXJ); } catch (e) { code = e.status; out = String(e.stdout || ''); }
  ok('T-verify-3 큐가 dismissed 면 ❌ 이고 --prune 이 폴더를 지운다', code === 1 && /dismissed/.test(out) && !fs.existsSync(path.join(TRAW, '_대기', '20260911')), out.slice(-300));
  const idx = JSON.parse(fs.readFileSync(path.join(TLEGAL, '_dashboard', 'pending_index.json'), 'utf8'));
  ok('T-verify-3 지도도 비워진다', Object.keys(idx).length === 0);
}

console.log('── T-status 사서 준비 상태 ──');
{
  const q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  q.items.find(i => i.id === 'q2').status = 'approved';
  fs.writeFileSync(QUEUE, JSON.stringify(q));
  py('collect_pending_law.py', ['q1'], FIXJ);
  fs.writeFileSync(path.join(TLEGAL, 'wiki', 'concepts', '어선원및어선재해보상보험법__장례비.md'), '---\nstatus: draft\n---\n어선원 및 어선 재해보상보험법 제28조 장례비 …');
  let out = py('collect_pending_law.py', ['--status']);
  ok('T-status-1 마커 없는 대기본은 ⚠ 로 찍힌다', /⚠ .*시행 20260911.*마커 있는 쪽 0/.test(out), out);
  fs.appendFileSync(path.join(TLEGAL, 'wiki', 'concepts', '어선원및어선재해보상보험법__장례비.md'), '\n<!--시행전 20260911-->옛<!--/시행전--><!--시행 20260911-->새<!--/시행-->\n');
  out = py('collect_pending_law.py', ['--status']);
  ok('T-status-1 마커를 넣으면 ✅', /✅ .*마커 있는 쪽 1/.test(out), out);
}

console.log('── T-fold 시행일 뒤 정리 ──');
{
  // T-fold-1 파이썬 접기 == JS 접기(모든 마커가 오늘 이전일 때). 아직 시행 전인 마커는 파이썬이 보존한다.
  const fxDir = path.join(TMP, 'foldfx'); fs.mkdirSync(fxDir, { recursive: true });
  const pyFold = (body, today) => execFileSync('python3', ['-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(LOOP)}); import fold_effective as f; sys.stdout.write(f.fold_markers(open(sys.argv[1], encoding='utf-8').read(), sys.argv[2]))`,
    (() => { const p = path.join(fxDir, 'b.md'); fs.writeFileSync(p, body); return p; })(), today], { env, encoding: 'utf8' });
  ok('T-fold-1 파이썬 접기 == JS 접기(20260918)', pyFold(WIKI_FX, '20260918') === E.applyStageMarkers(WIKI_FX, '20260918'));
  ok('T-fold-1 파이썬 접기 == JS 접기(20261231, 인라인·블록 둘 다)', pyFold(WIKI_FX, '20261231') === E.applyStageMarkers(WIKI_FX, '20261231'));
  const future = '<!--시행전 20270101-->옛<!--/시행전--><!--시행 20270101-->새<!--/시행-->\n<!--시행 20260918-->\n지난 것\n<!--/시행-->';
  const pf = pyFold(future, '20260918');
  ok('T-fold-1 시행 전 마커는 파이썬이 그대로 보존(런타임이 계속 고른다)', pf.includes('<!--시행전 20270101-->옛<!--/시행전-->') && pf.includes('지난 것') && !pf.includes('<!--시행 20260918-->'));
  // T-fold-2 raw 승격: 현행 MST 259243 ≠ 대기본 283875 → 승격 + _legacy 보관 + _meta 갱신
  const out = py('fold_effective.py', ['--today', '20260911']);
  const cur = fs.readFileSync(path.join(TRAW, '법률.txt'), 'utf8');
  const meta = JSON.parse(fs.readFileSync(path.join(TRAW, '_meta.json'), 'utf8'));
  const legacy = fs.readdirSync(path.join(TLEGAL, '_legacy', 'raw', '06_선원노동', '어선원및어선재해보상보험법'));
  ok('T-fold-2 대기본이 현행이 된다', /\(시행 20260911/.test(cur), out.slice(-300));
  ok('T-fold-2 옛 현행은 _legacy/raw 로(삭제 아님)', legacy.some(f => /^법률_시행20240724_MST259243\.txt$/.test(f)), legacy.join(','));
  ok('T-fold-2 _meta.json MST·시행일 갱신 + 기록', meta.families.법률.MST === '283875' && meta.시행일 === '20260911' && /fold_effective/.test(meta.예고본승격 || ''));
  ok('T-fold-2 _대기 폴더와 지도가 비워진다', !fs.existsSync(path.join(TRAW, '_대기', '20260911'))
    && Object.keys(JSON.parse(fs.readFileSync(path.join(TLEGAL, '_dashboard', 'pending_index.json'), 'utf8'))).length === 0);
  const wiki = fs.readFileSync(path.join(TLEGAL, 'wiki', 'concepts', '어선원및어선재해보상보험법__장례비.md'), 'utf8');
  ok('T-fold-2 위키 마커가 접히고 변경 이력이 붙는다', /\n새\n/.test(wiki) && !/옛/.test(wiki) && /변경 이력[\s\S]*fold_effective\.py/.test(wiki));
  // ⑩ 현행이 이미 같은 MST(트랙 D 가 먼저 재수집) → 대기본만 지운다
  py('collect_pending_law.py', ['q1', '--force'], FIXJ);
  const out2 = py('fold_effective.py', ['--today', '20260911', '--raw-only']);
  ok('T-fold-2 현행 MST 가 이미 같으면 대기본만 지우고 현행은 손대지 않는다', /↩/.test(out2) && !fs.existsSync(path.join(TRAW, '_대기', '20260911')) && fs.readFileSync(path.join(TRAW, '법률.txt'), 'utf8') === cur, out2.slice(-300));
  // 시행 전이면 아무것도 안 한다
  py('collect_pending_law.py', ['q1', '--force'], FIXJ);
  const out3 = py('fold_effective.py', ['--today', '20260910']);
  ok('T-fold-2 시행 전에는 손대지 않는다', fs.existsSync(path.join(TRAW, '_대기', '20260911', '법률.txt')) && /승격 raw 0층/.test(out3));
}

console.log('── T-popup 실제 대기본으로 조문 팝업 전환(githubRaw → 로컬 파일) ──');
{
  const REPO = path.resolve(__dirname, '../..');
  const realStaged = path.join(LEGAL, 'raw', '06_선원노동', '어선원및어선재해보상보험법', '_대기', '20260911', '법률.txt');
  const realIndex = E.loadPendingIndex();
  const key = 'local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법';
  if (!fs.existsSync(realStaged) || !(realIndex[key] || []).some(e => e.date === '20260911')) {
    console.log('  ⏭️  실데이터 대기본(어선원법 20260911)이 없어 건너뜀 — collect_pending_law.py chg_20260810_5373b9');
  } else {
    const orig = { hasToken: githubRaw.hasToken, fetchText: githubRaw.fetchText, listDir: githubRaw.listDir };
    const fetched = [];
    githubRaw.hasToken = () => true;
    githubRaw.listDir = async () => [];
    githubRaw.fetchText = async (p) => { fetched.push(p); try { return fs.readFileSync(path.join(REPO, p), 'utf8'); } catch (_) { return null; } };
    (async () => {
      try {
        E.setTodayForTest('20260910');
        const before = await A.loadArticle({ law: '어선원 및 어선 재해보상보험법', article: '제28조', tier: 'law' });
        E.setTodayForTest('20260911');
        const after = await A.loadArticle({ law: '어선원 및 어선 재해보상보험법', article: '제28조', tier: 'law' });
        ok('T-popup-1 시행 전날: 현행 파일(시행 20240724)', before.ok && before.effectiveDate === '2024-07-24', JSON.stringify(before).slice(0, 200));
        ok('T-popup-1 시행 당일: 대기본(시행 20260911)', after.ok && after.effectiveDate === '2026-09-11', JSON.stringify(after).slice(0, 200));
        ok('T-popup-1 읽은 경로가 _대기/20260911/법률.txt', fetched.some(p => p.endsWith('/_대기/20260911/법률.txt')));
        ok('T-popup-1 대기본 조문 본문이 현행과 다르다(개정 조문)', JSON.stringify(after.paragraphs) !== JSON.stringify(before.paragraphs));
        // 대기본은 호 머리가 `1. `(한 칸)으로 온다(현행 파일 다수는 `1.  ` 두 칸) — 파서가 둘 다 받는지 실제 조로 본다.
        const def = await A.loadArticle({ law: '어선원 및 어선 재해보상보험법', article: '제2조①1호', tier: 'law' });
        ok('T-popup-2 대기본의 호(1. 2. …)가 쪼개지고 인용 호가 강조된다', def.ok && def.effectiveDate === '2026-09-11'
          && def.paragraphs.some(p => p.items && p.items.some(it => it.label === '1' && it.hit)), JSON.stringify(def).slice(0, 300));
      } finally {
        E.setTodayForTest(null);
        Object.assign(githubRaw, orig);
        fs.rmSync(TMP, { recursive: true, force: true });
        console.log(`\n${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
      }
    })();
  }
}
if (!fs.existsSync(path.join(LEGAL, 'raw', '06_선원노동', '어선원및어선재해보상보험법', '_대기', '20260911', '법률.txt'))) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
