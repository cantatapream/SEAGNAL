/**
 * V5-21b 법률계열 별표 도달성 — 위키가 짚은 **법률·시행령·시행규칙 별표**를 눌렀을 때 열리나. (2-10)
 *
 * [왜 또 만드나 — 이미 자가 둘 있는데]
 *   `V5-11 annex_ready.js`   **고시** 별표를 짚은 근거 **줄**이 열리나 (줄 단위 · 329줄)
 *   `V5-21a byl_bare_ready.js` 계층 접두 없는 별표 **파일**이 열쇠를 갖췄나 (파일 단위 · 2,032개)
 *   ★비어 있는 칸이 **「법률계열 별표를 짚은 줄」** 이었다. 파일이 성한 것과
 *   **위키가 짚은 그 번호가 열리는 것**은 다른 물음이다(2-6b ⑤ 에서 배운 것 — 자를 늘리지 말고
 *   물음마다 이름을 준다. 여기서는 **물음이 정말 비어 있어서** 자를 하나 더 세운다).
 *
 * [판정은 생산 코드 그대로 — 규칙을 다시 적지 않는다 (L-136)]
 *   `resolveRefs()` ③ 이 하는 순서를 **그 함수가 쓰는 자들로** 따라간다:
 *     ⓐ `<법>/별표/<계층>_별표N.txt` 가 있고 **본문이 있나**      → `hasBylBody`
 *     ⓑ 없으면 `<법>/별표/별표N.txt` 의 **선언줄이 그 계층·번호와 맞고** 본문이 있나
 *                                                              → `bylDeclMatches` + `hasBylBody`
 *   계층 접두는 생산 상수 `TIER_BYL_PREFIX` 를 **내보내 받아 쓴다**(따로 적으면 어긋난다).
 *
 * [판정 칸]
 *   ✅ 열린다          원문(표)이 손에 있다
 *   ❌ 그 별표가 없다   법 폴더는 찾았는데 그 번호 파일이 없거나 **본문이 비었다**
 *   ⚠ 선언이 어긋난다  맨몸 파일은 있는데 선언줄의 계층·번호가 안 맞는다(넘겨짚지 않는다)
 *   ⚠ 원문 폴더를 못 찾음
 *
 * 사용법: node byl_line_ready.js [--examples] [--base <파일>] [--gate] [--save <파일>]
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');
const A = require('../../../../services/article_text.js');

const REPO = path.resolve(__dirname, '../../../../..');
const LEGAL = path.resolve(__dirname, '../..');
const WIKI = path.join(LEGAL, 'wiki');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

function buildBaseLawMap() {
  const m = new Map();
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'index.json'), 'utf8'));
    for (const p of (idx.pages || idx || [])) if (p && p.file) m.set(String(p.file), String(p.law || ''));
  } catch (_e) { /* 없으면 frontmatter 로 떨어진다 */ }
  return m;
}

/** 조문 칸에서 별표·별지 열쇠 — `annex_ready.js` 와 **같은 꼴**로 맞춘다. */
function bylKeys(article) {
  const out = new Set();
  const re = /(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)/g;
  let m;
  while ((m = re.exec(String(article || ''))) !== null) out.add((m[1] === '별표' ? '별표' : '서식') + m[2]);
  return [...out];
}

const now = { rows: 0, ok: 0, no_file: 0, decl_mismatch: 0, no_base: 0 };
const ex = { no_file: [], decl_mismatch: [], no_base: [] };
const BASE_LAW = buildBaseLawMap();
const PREFIX = A.TIER_BYL_PREFIX;          // ★생산 상수를 그대로 받는다

for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
  const D = path.join(WIKI, dir);
  if (!fs.existsSync(D)) continue;
  for (const f of fs.readdirSync(D)) {
    if (!f.endsWith('.md')) continue;
    const src = fs.readFileSync(path.join(D, f), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(src);
    const baseLaw = BASE_LAW.get(f.replace(/\.md$/, ''))
      || (fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '');
    for (const row of R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))) {
      const prefix = PREFIX[String(row.tier || '')];
      if (!prefix) continue;                                  // 고시 줄은 V5-11 소관
      const keys = bylKeys(row.article);
      if (!keys.length) continue;                             // 별표를 안 짚은 줄은 V5-8 소관
      now.rows++;
      const baseRel = A.resolveBase(String(row.law || ''), baseLaw, String(row.tier || ''));
      if (!baseRel) {
        now.no_base++;
        if (ex.no_base.length < 200) ex.no_base.push(`${dir}/${f}  |  ${String(row.law).slice(0, 36)}`);
        continue;
      }
      const bd = path.join(REPO, baseRel, '별표');
      let bad = null, mismatch = null;
      for (const key of keys) {
        const k = A.splitRefKey(key);
        if (!k) continue;
        const owned = path.join(bd, `${prefix}_${k.type}${k.num}.txt`);
        if (fs.existsSync(owned) && A.hasBylBody(fs.readFileSync(owned, 'utf8'))) continue;   // ⓐ
        const bare = path.join(bd, `${k.type}${k.num}.txt`);
        if (fs.existsSync(bare)) {                                                            // ⓑ
          const t = fs.readFileSync(bare, 'utf8');
          if (A.bylDeclMatches(t, prefix, k) && A.hasBylBody(t)) continue;
          mismatch = mismatch || `${key}`;
          continue;
        }
        bad = bad || `${key}`;
      }
      if (bad) {
        now.no_file++;
        if (ex.no_file.length < 200) ex.no_file.push(`${dir}/${f}  |  ${prefix} ${bad}  |  ${baseRel.split('/').slice(-1)[0]}`);
      } else if (mismatch) {
        now.decl_mismatch++;
        if (ex.decl_mismatch.length < 200) ex.decl_mismatch.push(`${dir}/${f}  |  ${prefix} ${mismatch}`);
      } else now.ok++;
    }
  }
}

let base = null;
const bp = arg('--base');
if (bp && fs.existsSync(bp)) { try { base = JSON.parse(fs.readFileSync(bp, 'utf8')); } catch (_e) { /* 없으면 견주지 않는다 */ } }
const d = k => (base && typeof base[k] === 'number'
  ? (now[k] - base[k] > 0 ? `  (+${now[k] - base[k]})` : now[k] - base[k] < 0 ? `  (${now[k] - base[k]})` : '') : '');
const pct = x => (now.rows ? (x * 100 / now.rows).toFixed(1) : '0.0');

console.log(`법률계열 별표·별지를 짚은 근거 줄 ${now.rows.toLocaleString()}개\n`);
console.log(`  ✅ 눌러서 열린다        ${String(now.ok).padStart(6)}  (${pct(now.ok)}%)${d('ok')}`);
console.log(`  ❌ 그 별표가 없다       ${String(now.no_file).padStart(6)}${d('no_file')}   (파일이 없거나 본문이 비었다)`);
console.log(`  ⚠ 선언이 어긋난다      ${String(now.decl_mismatch).padStart(6)}${d('decl_mismatch')}   (맨몸 파일의 계층·번호가 안 맞아 넘겨짚지 않는다)`);
console.log(`  ⚠ 원문 폴더를 못 찾음  ${String(now.no_base).padStart(6)}${d('no_base')}`);

if (argv.includes('--examples')) {
  for (const [k, t] of [['no_file', '그 별표가 없다'], ['decl_mismatch', '선언이 어긋난다'], ['no_base', '원문 폴더를 못 찾음']]) {
    if (!ex[k].length) continue;
    console.log(`\n[${t}] 앞 20건`);
    for (const l of ex[k].slice(0, 20)) console.log('   · ' + l);
  }
}
if (arg('--save')) { fs.writeFileSync(arg('--save'), JSON.stringify(now, null, 1)); console.log(`\n스냅샷 저장: ${arg('--save')}`); }
if (argv.includes('--gate')) {
  if (!base) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); process.exit(0); }
  const worse = now.ok < base.ok;
  console.log(worse ? `\n  ❌ 열리는 줄이 줄었다 ${base.ok} → ${now.ok}` : `\n  ✅ 열리는 줄 ${now.ok}건 — 기준선(${base.ok}) 이상`);
  process.exit(worse ? 1 : 0);
}
