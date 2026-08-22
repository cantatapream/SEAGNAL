/**
 * collect_eval.js — **품질 4축 ①수집** 게이트. "가져야 할 원문이 실제로 우리 손에 있나"를 센다.
 *
 * [왜 있나 — 2026-08-20 사용자 확정 H-45]
 * 사용자가 정한 품질 4축(①수집 ②형태 ③도달 ④연결) 중 **①수집만 게이트가 아예 없었다.**
 * ②는 `citation_table_scan.js`(V5-3), ③은 `reach_eval.js`(V5-5)·`golden_eval.js`(V5-7)·
 * `link_ready.js`(V5-8), ④는 `xref_check.py`(V5-2)가 본다. 수집만 아무도 안 세고 있었다.
 *
 * [사용자 원문 — 이 도구가 반드시 갈라야 하는 것]
 *   "수집이 안 되는 것은 정말 구조적으로 수집이 안 되는 건지 수집할 수 있는데 안 한 건지를 봐야 되고"
 * 그래서 결과를 **두 칸으로 나눠** 센다:
 *   · `못 얻음(구조적)`  — 지자체 개별고시·미제정 재량조항처럼 우리가 가질 수 없는 것
 *   · `안 했음(수집가능)` — 국가법령정보센터에 있는데 아직 안 가져온 것 ← **이것만 게이트가 잡는다**
 *
 * [무엇을 보나 — 전부 결정론적, AI 안 씀]
 *   ⓐ **3층 본문**   법률·시행령·시행규칙 파일이 있고 **스텁이 아닌가**(본문 줄 수)
 *   ⓑ **별표**      `별표/` 파일 수 vs `_meta.json` 의 `별표수`
 *   ⓒ **행정규칙**   `행정규칙/` 파일 중 **본문이 안 딸려온 스텁**(첨부파일에만 본문이 있는 것)
 *   ⓓ **매니페스트** `_dashboard/scope/<법>.md` §7 요약 카운트의 미수집 수(정적 백로그)
 *
 * ⚠ⓓ는 2026-07-18 시점 조사라 **그 뒤 재수집분이 반영돼 있지 않다.** 그래서 ⓓ는 게이트에 걸지
 *   않고 참고로만 찍는다 — 계기판이 옛말을 하지 않게 하려는 것이다(L-159 계열).
 *   게이트가 판정하는 것은 **지금 이 순간 raw 를 직접 세어 확인한 ⓐ~ⓒ 뿐이다.**
 *
 * [쓰는 법]
 *   node collect_eval.js                 현황 표
 *   node collect_eval.js --examples      법별 상세
 *   node collect_eval.js --save <경로>    기준선 저장
 *   node collect_eval.js --base <경로> --gate   기준선보다 나빠지면 실패(verify_all.sh V5-9)
 * [연계] ← raw/<분야>/<법>/ · _dashboard/scope/<법>.md → verify_all.sh V5-9
 *        ⚠읽기 전용.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.resolve(HERE, '..', '..');
const RAW = path.join(LEGAL, 'raw');
const SCOPE = path.join(LEGAL, '_dashboard', 'scope');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

/**
 * 본문 글자가 이만큼도 안 되면 "파일은 왔는데 알맹이가 안 딸려왔다"고 본다.
 * ⚠처음엔 **줄 수**(10줄 미만)로 쟀다가 151건이 잡혔는데, 열어 보니 **셋 다 완결된 문서**였다 —
 *   수집기가 조문 하나를 한 줄로 붙여 넣기 때문에 조가 4개인 짧은 고시는 4줄이지만 멀쩡하다.
 *   글자 수 분포를 보니 기준법 행정규칙 738개 중 **100자 미만이 3개**뿐이고 그중 2개가 0자다.
 *   짧은 지정고시(52~139자, "~를 다음과 같이 지정한다")는 원래 그 길이라 결손이 아니다.
 *   그래서 **명백히 빈 것만** 잡는다(L-163 계열 — 검사가 무엇을 재는지 먼저 확인한다).
 */
const EMPTY_CHARS = 30;
/** 짧아서 눈으로 한 번 볼 값어치는 있는 것(게이트 대상은 아니다). */
const SHORT_CHARS = 300;

/**
 * 게이트가 볼 **기준법 74개**의 raw 디렉터리를 찾는다.
 * ★기준법과 타법은 **가져야 할 깊이가 다르다**(MASTER_PLAN D절, 사용자 확정 2026-07-18):
 *   · 기준법 — 법률·시행령·시행규칙 **전문 전량** + 별표 + 위임 고시
 *   · 타법   — 원문은 보유하되 **거쳐가는 조문 + 그 조문의 별표·고시까지만**(전체 개념화 X)
 * 그래서 타법(`15_관련타부처` 483개·`_자치법규`)에 3층 본문을 요구하면 **정책상 가질 필요가 없는 것**을
 * 결손으로 세게 된다(첫 실행에서 726건이 그렇게 잡혔다). 기준법 목록의 단일 진실원천은
 * `wiki/statutes/*.md` 74개이며, 그중 4개(물환경보전법·자연유산법·출입국관리법·폐기물관리법)는
 * raw 가 `15_관련타부처` 아래에 있다(tier-2 참조법이지만 위키 허브를 가진 기준법).
 */
function lawDirs() {
  const wanted = new Set(fs.readdirSync(path.join(LEGAL, 'wiki', 'statutes'))
    .filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)));
  const out = [];
  for (const domain of fs.readdirSync(RAW)) {
    const dp = path.join(RAW, domain);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const law of fs.readdirSync(dp)) {
      if (!wanted.has(law)) continue;                    // 기준법만 — 타법은 이 게이트 대상이 아니다
      const lp = path.join(dp, law);
      if (!fs.existsSync(path.join(lp, '_meta.json'))) continue;
      // ★같은 법이 두 곳에 있으면 **조문이 많은 쪽이 본체**다. 먼저 찾은 것을 쓰면 안 된다 —
      //   `15_관련타부처` 아래 같은 이름의 **발췌본**(다른 법이 인용하는 조문만 모은 것)이 잡히면
      //   본체를 스텁으로 오판한다. 실측(2026-08-21): 해양환경관리법이 발췌본 2조문 vs 본체 133조문,
      //   섬발전촉진법·해양수산발전기본법 등도 같은 구조다. 오늘 이 함정에 두 번 빠졌다(L-164 계열).
      const arts = f => { try { return (fs.readFileSync(f, 'utf8').match(/^\[제\d+조/gm) || []).length; } catch (_) { return 0; } };
      const n = arts(path.join(lp, '법률.txt'));
      const prev = out.find(x => x.law === law);
      if (prev) { if (n > prev.arts) { prev.domain = domain; prev.dir = lp; prev.arts = n; } continue; }
      out.push({ domain, law, dir: lp, arts: n });
    }
  }
  return out;
}

/** 머리(제목·ID·소관부서)와 꼬리(출처)를 뺀 **본문 글자 수**. 수집이 됐는지는 이 값으로 판정한다. */
function bodyChars(fp) {
  let t;
  try { t = fs.readFileSync(fp, 'utf8'); } catch (_) { return -1; }
  t = t.replace(/^\[[^\]]*\][^\n]*\n/, '')
       .replace(/^(ID:|소관부서|발령|출처|시행)[^\n]*\n/gm, '')
       .replace(/\n--\n출처:[\s\S]*$/, '');
  return t.trim().length;
}

/**
 * 그 법이 **가져야 할 파일**을 `_meta.json` 의 `families` 에서 읽는다.
 * ★키 이름만 보면 안 된다 — 첫판이 그래서 세 번 틀렸다(2026-08-21, 사서 보고로 발각):
 *   ⓐ **값이 설명 문자열**인 경우가 있다. 해양경찰법 `"시행규칙": "없음 — 법령체계도상 …
 *      시행규칙 자체가 존재하지 않음"` — 키가 있다고 요구하면 **없는 법을 결손으로 센다.**
 *   ⓑ **값이 배열**인 경우가 있다. 해양경찰법은 단일 통합 시행령이 없고 위임사항별 대통령령
 *      3건으로 분산돼 파일명이 `시행령_해양경찰위원회규정.txt` 식이다 — `시행령.txt` 를 찾으면 없다.
 *   ⓒ **`_비고` 로 끝나는 키**는 계층이 아니라 메모다(`시행령_비고`).
 *   ⓓ 발췌본은 파일명이 다르다(출입국관리법 `시행령_별표1의3_발췌.txt`).
 * 그래서 **`파일` 필드를 진실원천으로** 쓴다. `.json`(수집 원본)이면 같은 이름의 `.txt` 를 본다.
 * 사용자가 정한 ①수집 축의 요건이 이것이다 — "구조적으로 못 얻는 것"과 "안 한 것"을 가른다.
 */
function expectedCore(meta) {
  const fam = (meta && meta.families) || {};
  const out = new Set();
  const push = v => {
    if (!v || typeof v !== 'object') return;
    let f = String(v['파일'] || '').trim();
    if (!f) return;
    if (f.endsWith('.json')) f = f.slice(0, -5) + '.txt';
    if (f.endsWith('.txt')) out.add(f);
  };
  for (const [k, v] of Object.entries(fam)) {
    if (/_비고$/.test(k)) continue;                       // ⓒ 메모 키
    const base = String(k).replace(/\(.*?\)/g, '').trim();
    if (!['법률', '시행령', '시행규칙'].includes(base)) continue;
    if (typeof v === 'string') continue;                  // ⓐ "없음 — …" 같은 설명 → 그 계층은 없다
    if (Array.isArray(v)) { v.forEach(push); continue; }   // ⓑ 위임사항별로 쪼개진 경우
    push(v);                                              // ⓓ 일반·발췌
  }
  return [...out];
}

/** 매니페스트 §7 요약 카운트에서 "미수집_*" 값을 읽는다(참고용). */
function manifestMissing(law) {
  const fp = path.join(SCOPE, law + '.md');
  if (!fs.existsSync(fp)) return null;
  const src = fs.readFileSync(fp, 'utf8');
  const out = {};
  for (const m of src.matchAll(/\|\s*(미수집_[^|]+?)\s*\|\s*(\d+)\s*\|/g)) out[m[1].trim()] = Number(m[2]);
  const unc = /##\s*\d+\.\s*수집곤란/.test(src);
  return { missing: out, hasUncollectableSection: unc };
}

function scan() {
  const rows = [];
  for (const { domain, law, dir } of lawDirs()) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')); } catch (_) {}
    const tier = Number(meta.tier || 0);
    const r = { law, domain, tier, coreMissing: [], coreStub: [], annexShort: 0, ruleStubs: [], manifest: manifestMissing(law) };

    // ⓐ 3층 본문 — **그 법이 실제로 가진 계층만** 요구한다(families 가 진실원천)
    r.expected = expectedCore(meta);
    for (const f of r.expected) {
      const fp = path.join(dir, f);
      if (!fs.existsSync(fp)) { r.coreMissing.push(f); continue; }
      if (bodyChars(fp) < EMPTY_CHARS) r.coreStub.push(f);
    }
    // ⓑ 별표 — _meta.json 이 말하는 수보다 파일이 적으면 그만큼 모자란 것
    const annexDir = path.join(dir, '별표');
    const have = fs.existsSync(annexDir) ? fs.readdirSync(annexDir).filter(f => f.endsWith('.txt')).length : 0;
    const want = Number(meta.별표수 || 0);
    r.annexHave = have; r.annexWant = want;
    if (want > have) r.annexShort = want - have;
    // ⓒ 행정규칙 스텁 — 파일은 왔는데 본문이 첨부에만 있는 것
    const ruleDir = path.join(dir, '행정규칙');
    r.ruleShort = [];
    if (fs.existsSync(ruleDir)) {
      for (const f of fs.readdirSync(ruleDir)) {
        if (!f.endsWith('.txt')) continue;
        const n = bodyChars(path.join(ruleDir, f));
        if (n < 0) continue;
        if (n < EMPTY_CHARS) r.ruleStubs.push(`${f}(${n}자)`);
        else if (n < SHORT_CHARS) r.ruleShort.push(`${f}(${n}자)`);
      }
      r.ruleCount = fs.readdirSync(ruleDir).filter(f => f.endsWith('.txt')).length;
    } else r.ruleCount = 0;

    r.bad = r.coreMissing.length + r.coreStub.length + r.annexShort + r.ruleStubs.length;
    rows.push(r);
  }
  return rows.sort((a, b) => b.bad - a.bad || a.law.localeCompare(b.law));
}

const rows = scan();
const sum = k => rows.reduce((s, r) => s + (Array.isArray(r[k]) ? r[k].length : (r[k] || 0)), 0);
const tot = {
  laws: rows.length,
  coreMissing: sum('coreMissing'), coreStub: sum('coreStub'),
  annexShort: sum('annexShort'), ruleStubs: sum('ruleStubs'),
};
tot.bad = tot.coreMissing + tot.coreStub + tot.annexShort + tot.ruleStubs;

console.log(`\n── ①수집 — 가져야 할 원문이 손에 있나 (기준법 ${tot.laws}개) ──`);
console.log(`  ❌ 있어야 할 계층이 없다      ${String(tot.coreMissing).padStart(5)}   그 법에 존재하는 계층(_meta.json families)인데 파일이 없음`);
console.log(`  ❌ 계층 파일이 비어 있다      ${String(tot.coreStub).padStart(5)}   파일은 있는데 본문 ${EMPTY_CHARS}자 미만`);
console.log(`  ❌ 별표가 모자란다            ${String(tot.annexShort).padStart(5)}   _meta.json 이 말하는 수보다 파일이 적음`);
console.log(`  ❌ 행정규칙이 비어 있다       ${String(tot.ruleStubs).padStart(5)}   본문이 안 딸려온 것(${EMPTY_CHARS}자 미만)`);
console.log(`  ─────────────────────────────────────`);
console.log(`  합계(수집가능한데 안 한 것)   ${String(tot.bad).padStart(5)}`);

const shortN = rows.reduce((s2, r) => s2 + (r.ruleShort ? r.ruleShort.length : 0), 0);
console.log(`\n  [참고] 짧은 행정규칙 ${shortN}건(${EMPTY_CHARS}~${SHORT_CHARS}자) — 지정고시류는 원래 짧다. 결손이 아니므로 게이트 대상 아님`);

// 참고 — 매니페스트(2026-07-18 조사)가 말하는 미수집. 게이트에는 안 건다.
const mf = rows.filter(r => r.manifest);
const mfSum = {};
for (const r of mf) for (const [k, v] of Object.entries(r.manifest.missing)) mfSum[k] = (mfSum[k] || 0) + v;
if (Object.keys(mfSum).length) {
  console.log(`\n  [참고] 범위확정 매니페스트(2026-07-18 조사, ${mf.length}법)가 적어 둔 미수집 — 그 뒤 재수집분 미반영`);
  for (const [k, v] of Object.entries(mfSum).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(24)} ${String(v).padStart(5)}`);
  console.log(`     ※ 이 숫자는 옛 조사라 게이트에 걸지 않는다 — 게이트는 지금 raw 를 직접 센 위 합계만 본다`);
}

if (argv.includes('--examples')) {
  console.log(`\n── 법별 상세(문제 있는 것만) ──`);
  for (const r of rows.filter(x => x.bad > 0)) {
    const bits = [];
    if (r.coreMissing.length) bits.push(`본문없음 ${r.coreMissing.join('·')}`);
    if (r.coreStub.length) bits.push(`본문빔 ${r.coreStub.join('·')}`);
    if (r.annexShort) bits.push(`별표 ${r.annexHave}/${r.annexWant}`);
    if (r.ruleStubs.length) bits.push(`행정규칙빔 ${r.ruleStubs.slice(0, 3).join('·')}${r.ruleStubs.length > 3 ? ` 외 ${r.ruleStubs.length - 3}` : ''}`);
    console.log(`  [${String(r.bad).padStart(3)}] ${r.law}  — ${bits.join(' / ')}`);
  }
}

if (arg('--save')) {
  fs.writeFileSync(path.resolve(HERE, arg('--save')), JSON.stringify({ tot, rows }, null, 1));
  console.log(`\n기준선 저장: ${arg('--save')}`);
}
if (argv.includes('--gate')) {
  const bp = arg('--base');
  if (!bp || !fs.existsSync(path.resolve(HERE, bp))) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); process.exit(0); }
  const base = JSON.parse(fs.readFileSync(path.resolve(HERE, bp), 'utf8'));
  const b = base.tot ? base.tot.bad : Infinity;
  if (tot.bad > b) { console.log(`\n  ❌ 수집 결손 ${tot.bad}건 — 기준선(${b})보다 늘었다`); process.exit(1); }
  console.log(`\n  ✅ 수집 결손 ${tot.bad}건 — 기준선(${b}) 이하${tot.bad < b ? `  (${tot.bad - b})` : ''}`);
}
