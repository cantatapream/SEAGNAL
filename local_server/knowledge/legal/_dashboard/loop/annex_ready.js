/**
 * V5-11 별표 도달성 — 위키가 짚은 **고시 별표·별지**를 눌렀을 때 실제로 원문이 열리나.
 *
 * 왜 만드나 (2026-08-31):
 *   `link_ready.js`(V5-8)는 **조문 칸에 조(條)가 있는 줄**만 본다. 조문 칸이 `별표1`·`별지 제3호서식`
 *   뿐인 줄 1,022건은 "조문 칸이 아님"으로 빼 놓는다. 그래서 오늘 고시 별표 863건을 새로 채웠는데도
 *   **몇 건이나 열리게 됐는지 잴 방법이 없었다.** 저장한 것을 검사하는 게이트는 있어도
 *   "이 종류의 근거가 닿는가"를 보는 게이트가 없었던 것이다(품질 4축 ③ 도달의 구멍).
 *
 * 무엇을 하나 — 판정은 **생산 코드의 함수를 그대로 쓴다**(L-136: 판정을 두 번 구현하면 어긋난다)
 *   근거 조문 표의 줄 중 ①법령 칸이 고시(행정규칙)이고 ②조문 칸이 별표·별지를 짚은 줄을 골라,
 *   `article_text.js` 가 실제로 하는 순서 그대로 찾아본다.
 *     ⓐ 그 고시 파일 뒤에 이어붙은 별표 블록  → `extractAttachments()`
 *     ⓑ 없으면 `<법>/별표/` 안의 파일         → `parseBylFile()` 로 임자·번호 대조
 *        (후보 고르는 방식도 생산과 같다 — 이름이 그 고시 것으로 보이는 파일을 먼저,
 *         하나도 없으면 앞 8개)
 *
 * 판정 칸
 *   ✅ 열린다            원문(표)이 손에 있고 번호까지 맞는다
 *   ❌ 그 별표가 없다     고시는 찾았는데 그 번호의 별표가 없다 (수집 공백 또는 번호 오기)
 *   ⚠ 고시를 못 고름     위키 이름과 파일 이름이 어긋나거나 그 고시를 아직 안 받았다
 *   ⚠ 원문 폴더를 못 찾음 법령 칸으로 법 폴더를 못 찾았다
 *
 * 사용법: node annex_ready.js [--examples] [--base <파일>] [--gate] [--save <파일>]
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const A = require('/home/user/SEAGNAL/local_server/services/article_text.js');

const REPO = path.resolve(__dirname, '../../../../..');
const LEGAL = path.resolve(__dirname, '../..');
const WIKI = path.join(LEGAL, 'wiki');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const squash = s => String(s || '').replace(/[\s「」『』()（）·ㆍ・,.\-_]/g, '');

/** 페이지 → 그 페이지의 법(baseLaw). link_ready 와 같은 재료(index.json)를 쓴다. */
function buildBaseLawMap() {
  const m = new Map();
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'index.json'), 'utf8'));
    for (const p of (idx.pages || idx || [])) {
      if (p && p.file) m.set(String(p.file), String(p.law || ''));
    }
  } catch (_) { /* 없으면 frontmatter 로 떨어진다 */ }
  return m;
}

/** 조문 칸에서 별표·별지 열쇠를 뽑는다. `parseBylFile` 이 만드는 열쇠와 같은 꼴로 맞춘다. */
function bylKeys(article) {
  const out = new Set();
  const re = /(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)/g;
  let m;
  while ((m = re.exec(String(article || ''))) !== null) {
    out.add((m[1] === '별표' ? '별표' : '서식') + m[2]);
  }
  return [...out];
}

/** 그 법 폴더의 행정규칙 중 이 고시 파일을 고른다(생산의 pickNoticeFile 을 그대로 쓴다). */
function noticeFile(baseRel, law) {
  const nd = path.join(REPO, baseRel, '행정규칙');
  const picked = fs.existsSync(nd) && A.pickNoticeFile(
    fs.readdirSync(nd, { withFileTypes: true })
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })), law);
  if (picked) return path.join(nd, picked);
  // 자기 법 폴더에 없으면 저장소 전체 고시 지도를 본다 — 생산과 같은 순서(L-136, 2026-08-31 신설).
  const g = A.pickNoticeGlobal && A.pickNoticeGlobal(law);
  return g ? path.join(REPO, g) : null;
}

/** 그 고시의 별표 열쇠 집합 — 생산과 같은 두 경로(파일 안 블록 → `별표/` 파일)로 모은다. */
const cache = new Map();
function keysOf(baseRel, noticePath, law, need) {
  const ck = baseRel + '|' + (noticePath || '') + '|' + law + '|' + (need || []).join(',');
  if (cache.has(ck)) return cache.get(ck);
  const keys = new Set();
  if (noticePath && fs.existsSync(noticePath)) {
    for (const a of A.extractAttachments(fs.readFileSync(noticePath, 'utf8'))) keys.add(a.key);
  }
  // ★별표는 **그 고시가 실제로 있는 법 폴더**에서 찾는다 — 생산과 같다(2026-08-31).
  //   전역 고시 지도로 남의 법 폴더에서 고시를 찾아왔으면 별표도 그 폴더에 있다.
  const bd = noticePath
    ? path.join(path.dirname(path.dirname(noticePath)), '별표')
    : path.join(REPO, baseRel, '별표');
  if (fs.existsSync(bd)) {
    const all = fs.readdirSync(bd)
      .filter(n => /\.txt$/i.test(n) && !/^(법률|시행령|시행규칙)_/.test(n));
    const want = squash(String(law || '').replace(/[（(][^)）]*[)）]/g, ''));
    // 생산과 같은 규칙(article_text.js) — `고시「…」` 처럼 종류 이름표가 앞에 붙은 칸도 본다.
    const wants = [want, want.replace(/^(고시|훈령|예규|행정규칙)/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
    const mine = wants.length ? all.filter(n => wants.some(w => squash(n).startsWith(w))) : [];
    // 생산과 같은 규칙 — 찾는 번호가 파일명에 든 것을 맨 앞으로 보낸 뒤 8개를 본다
    // (한 고시가 별표를 83개 가진 경우가 있어, 이름만으로 좁히면 정작 찾는 번호가 잘린다).
    // 열쇠 `서식5` 는 파일 이름에 `별지5` 로 적힌다 — 생산과 같은 짝짓기(article_text.js need).
    const need0 = need || [];
    const needAll = need0.concat(need0.filter(k => k.indexOf('서식') === 0).map(k => '별지' + k.slice(2)));
    const hasKey = n => needAll.some(k => new RegExp('(^|[^0-9A-Za-z가-힣])' + k + '([^0-9]|$)').test(n));
    const pool = mine.length ? mine : all;
    for (const n of pool.slice().sort((a, b) => (hasKey(b) ? 1 : 0) - (hasKey(a) ? 1 : 0)).slice(0, 8)) {
      let parsed;
      try { parsed = A.parseBylFile(fs.readFileSync(path.join(bd, n), 'utf8')); } catch (_) { continue; }
      if (want && !wants.some(w => squash(parsed.owner).includes(w))) continue;   // 임자 확인 — 생산과 같다
      for (const e of parsed.entries) keys.add(e.key);
    }
  }
  cache.set(ck, keys);
  return keys;
}

const now = { rows: 0, ok: 0, no_key: 0, no_notice: 0, no_base: 0 };
const ex = { no_key: [], no_notice: [], no_base: [] };
const BASE_LAW = buildBaseLawMap();

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
      if (String(row.tier || '') !== 'notice') continue;      // 고시(행정규칙) 줄만 본다
      const keys = bylKeys(row.article);
      if (!keys.length) continue;                             // 별표·별지를 안 짚은 줄은 V5-8 소관
      now.rows++;
      const law = String(row.law || '');
      let baseRel = A.resolveBase(law, baseLaw, 'notice');
      // 이름이 우리가 가진 고시면 그 고시가 있는 법 폴더를 쓴다 — 생산과 같은 순서(L-136).
      if (!baseRel) {
        const g0 = A.pickNoticeGlobal && A.pickNoticeGlobal(law);
        if (g0) baseRel = g0.replace(/\/행정규칙\/[^/]+$/, '');
      }
      if (!baseRel) {
        now.no_base++;
        if (ex.no_base.length < 200) ex.no_base.push(`${dir}/${f}  |  ${law.slice(0, 36)}  |  ${String(row.article).slice(0, 20)}`);
        continue;
      }
      const np = noticeFile(baseRel, law);
      const have = keysOf(baseRel, np, law, keys);
      if (!np && !have.size) {
        now.no_notice++;
        if (ex.no_notice.length < 200) ex.no_notice.push(`${dir}/${f}  |  ${law.slice(0, 40)}`);
        continue;
      }
      const miss = keys.filter(k => !have.has(k));
      if (!miss.length) { now.ok++; continue; }
      now.no_key++;
      if (ex.no_key.length < 200) ex.no_key.push(`${dir}/${f}  |  ${law.slice(0, 30)}  |  없는 것: ${miss.join('·')}`);
    }
  }
}

let base = null;
const bp = arg('--base');
if (bp && fs.existsSync(bp)) { try { base = JSON.parse(fs.readFileSync(bp, 'utf8')); } catch (_) {} }
const d = k => base && typeof base[k] === 'number'
  ? (now[k] - base[k] > 0 ? `  (+${now[k] - base[k]})` : now[k] - base[k] < 0 ? `  (${now[k] - base[k]})` : '') : '';
const pct = x => now.rows ? (x * 100 / now.rows).toFixed(1) : '0.0';

console.log(`고시 별표·별지를 짚은 근거 줄 ${now.rows.toLocaleString()}개\n`);
console.log(`  ✅ 눌러서 열린다        ${String(now.ok).padStart(6)}  (${pct(now.ok)}%)${d('ok')}`);
console.log(`  ❌ 그 별표가 없다       ${String(now.no_key).padStart(6)}${d('no_key')}   (수집 공백이거나 번호 오기)`);
console.log(`  ⚠ 고시를 못 고름       ${String(now.no_notice).padStart(6)}${d('no_notice')}   (미수집이거나 위키 이름과 파일 이름이 어긋남)`);
console.log(`  ⚠ 원문 폴더를 못 찾음  ${String(now.no_base).padStart(6)}${d('no_base')}`);

if (argv.includes('--examples')) {
  for (const [k, t] of [['no_key', '그 별표가 없다'], ['no_notice', '고시를 못 고름'], ['no_base', '원문 폴더를 못 찾음']]) {
    if (!ex[k].length) continue;
    console.log(`\n[${t}] 앞 20건`);
    for (const l of ex[k].slice(0, 20)) console.log('   · ' + l);
  }
}
if (arg('--save')) {
  fs.writeFileSync(arg('--save'), JSON.stringify(now, null, 1));
  console.log(`\n스냅샷 저장: ${arg('--save')}`);
}
if (argv.includes('--gate')) {
  if (!base) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); process.exit(0); }
  const worse = now.ok < base.ok;
  console.log(worse
    ? `\n  ❌ 열리는 줄이 줄었다 ${base.ok} → ${now.ok}`
    : `\n  ✅ 열리는 줄 ${now.ok}건 — 기준선(${base.ok}) 이상`);
  process.exit(worse ? 1 : 0);
}
