/**
 * notice_ref_ready.js — ★**고시 파일이 스스로 가리키는 별표·서식을 눌러서 열 수 있나.** (P-5)
 *
 * [왜 만드나 — P-5 가 이 자를 기다리고 있었다]
 * P-5 는 *"고시가 가리키는 별표·서식 3,975종 중 ❌어느 쪽에도 없다 803(20.2%)"* 라고 적고,
 * 바로 이어 스스로 한계를 밝혀 두었다:
 *   *"803 은 **상한**이다 — 내 ③은 **파일명 접두로만** 짝지었는데 운영 코드(resolveRefs ⑤)는
 *     **머리말(owner)로도** 맞추고 `별지↔서식` 짝도 본다. 즉 실제로는 더 적다.
 *     **정확한 수는 ⑤를 그대로 부르는 자가 있어야 나온다.**"*
 * 그 자가 없어서 P-5 는 **🔍(크기를 아직 모른다)** 로 남아 있었다. 이 파일이 그 자다.
 *
 * [★V5-11 과 무엇이 다른가 — 둘을 섞으면 숫자가 헛것이 된다(뿌리 사슬 ⑥)]
 *   V5-11(`annex_ready.js`)  **위키 근거 줄**이 짚은 고시 별표를 본다 — 「사용자가 위키에서 누르는 것」
 *   이 자(P-5)              **고시 원문 스스로**가 본문에서 가리키는 별표·서식을 본다
 *                           — 「그 고시를 열어 본문을 읽는 사용자가 마주치는 것」
 *   같은 「별표 도달성」이라는 말을 쓰지만 **분모가 다르다.** 어느 쪽도 다른 쪽을 대신하지 못한다.
 *
 * [세는 법 — 생산 함수를 그대로 태운다 (L-136)]
 *   대상    `raw/<도메인>/<법>/행정규칙/*.txt` 전부
 *   가리킴  `collectRefs(본문)` — 생산이 본문에서 참조를 뽑는 그 함수
 *   판정    `resolveRefs(found, refCtx)` — 생산이 실제로 있는지 가리는 그 함수
 *           `refCtx` 는 `loadArticle()`(article_text.js:2203)이 만드는 꼴 그대로:
 *             `{ base: <법 폴더>, tier: 'notice', docText, docTitle, docDir }`
 *           ⚠`base` 는 고시일 때 **`/행정규칙/<파일>` 을 떼어 낸 폴더**다(생산이 그렇게 한다).
 *   판정 칸  생산의 `kind` 를 그대로 쓴다 — `text`(원문이 손에 있다) · `image`(스캔 이미지가 있다)
 *            · `link`(내려받기 주소만 있다) · `missing`(어디에도 없다)
 *
 * ⚠**이 자는 게이트가 아니다 — 아직은.** 처음 재는 것이라 기준선이 없다. 먼저 수를 내고,
 *   그 수가 무엇인지 사람이 한 번 보고 나서 잠근다(G-49 — 값을 모르고 기준선을 굽지 않는다).
 * ⚠`link`(주소만)를 「열린다」로 셀지는 **보는 눈에 따라 다르다.** 그래서 **가르지 않고 따로** 찍는다.
 *   묶어서 하나로 만들면 다음 사람이 어느 쪽을 센 것인지 알 수 없다(2-6 의 규약).
 *
 * 쓰는 법:
 *   node notice_ref_ready.js              세어서 표만 찍는다
 *   node notice_ref_ready.js --examples   못 찾은 것의 표본을 함께 찍는다
 *   node notice_ref_ready.js --save <파일> 기준선으로 저장한다
 *   node notice_ref_ready.js --limit N    앞 N개 고시만 (시험용)
 *
 * [연계] ← 등록부 `P-5`. → services/article_text.js(collectRefs·resolveRefs — 생산 그대로).
 *        형제: V5-11 `annex_ready.js`(위키 줄 · 고시 별표) · V5-21b `byl_line_ready.js`(위키 줄 · 법률계열).
 */
const fs = require('fs');
const path = require('path');
const A = require('../../../../services/article_text.js');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
// ★`article_text.js` 가 쓰는 저장소 기준 접두 — resolveRefs 가 `ctx.docDir` 을 이 꼴로 기대한다.
const RAW_PREFIX = 'local_server/knowledge/legal/raw/';
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

/** 행정규칙 원문 파일을 전부 모은다. 옛 판·대기·이미지·원본첨부는 뺀다(다른 게이트와 같은 범위). */
function noticeFiles() {
  const out = [];
  (function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['_구판', '_대기', '_이미지', '_원본첨부'].includes(e.name)) continue;
        walk(fp);
      } else if (e.isFile() && e.name.endsWith('.txt') && path.basename(dir) === '행정규칙') {
        out.push(fp);
      }
    }
  })(RAW);
  return out.sort();
}

/** 저장소 기준 상대경로(`local_server/knowledge/legal/raw/…`) — resolveRefs 가 이 꼴을 본다. */
const repoRel = (abs) => RAW_PREFIX + path.relative(RAW, abs).split(path.sep).join('/');

// ★못 찾은 것의 **까닭**을 가른다 — 수가 진짜여도 까닭이 섞여 있으면 할 일을 못 정한다.
//   실측으로 찾은 함정(2026-09-25): `해양용도구역관리지침` 이 `영 별표 제1호` 라고 쓴 것을
//   `collectRefs` 가 **그 고시의 `별표1`** 로 읽는다. 운영이 그러니 사용자는 실제로 못 연다 —
//   값은 진짜다. 그러나 **고칠 자리는 다르다**(그 고시의 별표를 받는 것 ≠ 시행령 별표 이름 고치기).
//   ⚠`byl_ref_gap.py` 가 이 자리에서 여섯 번 틀렸다. 그래서 여기서는 **가르기만 하고 빼지 않는다** —
//     분모는 그대로 두고 까닭만 나눈다(과교정은 미교정보다 나쁘다).
const TIER_BEFORE = /(영|법|규칙|시행령|시행규칙|법률)\s*$/;
const OTHER_LAW = /[「『][^「『」』]{2,40}[」』]\s*$/;
function causeOf(docText, r) {
  const t = String(r.text || '').trim();
  if (!t) return '까닭 못 가름';
  let i = docText.indexOf(t);
  let sawTier = false, sawOther = false, n = 0;
  while (i !== -1 && n < 40) {
    const before = docText.slice(Math.max(0, i - 24), i);
    if (TIER_BEFORE.test(before)) sawTier = true;
    if (OTHER_LAW.test(before)) sawOther = true;
    i = docText.indexOf(t, i + 1); n++;
  }
  if (sawOther) return '남의 법 별표를 가리킨다';
  if (sawTier) return '남의 계층 별표를 가리킨다 (영·법·규칙)';
  return '이 고시 제 별표인데 없다';
}

async function main() {
  const files = noticeFiles();
  const lim = Number(arg('--limit')) || 0;
  const list = lim ? files.slice(0, lim) : files;
  console.log(`행정규칙 원문 ${files.length}개${lim ? ` (앞 ${list.length}개만 본다)` : ''}`);

  const tally = { text: 0, image: 0, link: 0, missing: 0 };
  const cause = {};
  const miss = [];
  let refTotal = 0, noRef = 0;

  for (const fp of list) {
    let textBody;
    try { textBody = fs.readFileSync(fp, 'utf8'); } catch (_) { continue; }
    const found = A.collectRefs(textBody);
    if (!found.length) { noRef++; continue; }
    const docDirAbs = path.dirname(fp);                       // …/<법>/행정규칙
    const baseAbs = docDirAbs.replace(/\/행정규칙$/, '');      // …/<법>   (생산과 같다)
    const refCtx = {
      base: repoRel(baseAbs),
      tier: 'notice',
      docText: textBody,
      docTitle: path.basename(fp, '.txt'),
      docDir: repoRel(docDirAbs),
    };
    let refs;
    try {
      refs = await A.resolveRefs(found, refCtx);
    } catch (e) {
      // ⚠조용히 넘기지 않는다 — 판정을 못 한 것과 「없다」는 다르다.
      console.error(`  ⚠판정 실패 ${path.relative(RAW, fp)}: ${String(e.message || e).slice(0, 120)}`);
      continue;
    }
    for (const r of refs) {
      refTotal++;
      const k = tally[r.kind] === undefined ? 'missing' : r.kind;
      tally[k]++;
      if (r.kind === 'missing') {
        const why = causeOf(textBody, r);
        cause[why] = (cause[why] || 0) + 1;
        if (miss.length < 4000) miss.push({ 고시: path.relative(RAW, fp), 열쇠: r.key, 까닭: why });
      }
    }
  }

  const open = tally.text + tally.image;
  const pct = (n) => (refTotal ? (100 * n / refTotal).toFixed(1) : '0.0');
  console.log(`  본문이 별표·서식을 가리키지 않는 고시 ${noRef}개 (정상 — 가리킬 것이 없다)`);
  console.log(`  가리킴 ${refTotal}종`);
  console.log(`    ✅ 원문이 손에 있다        ${String(tally.text).padStart(5)}  (${pct(tally.text)}%)`);
  console.log(`    ✅ 스캔 이미지가 있다      ${String(tally.image).padStart(5)}  (${pct(tally.image)}%)`);
  console.log(`    ⚠ 내려받기 주소만 있다    ${String(tally.link).padStart(5)}  (${pct(tally.link)}%)   ← 「열린다」로 셀지는 보는 눈에 따라 다르다`);
  console.log(`    ❌ 어디에도 없다          ${String(tally.missing).padStart(5)}  (${pct(tally.missing)}%)`);
  console.log(`  ⇒ 원문·이미지로 열리는 것 ${open} / ${refTotal} = ${pct(open)}%`);

  if (tally.missing) {
    console.log('\n  ❌어디에도 없다 — **까닭별** (수를 빼지 않는다, 까닭만 나눈다)');
    for (const [k, v] of Object.entries(cause).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(5)}  ${k}`);
    }
    console.log('    ⚠「이 고시 제 별표인데 없다」만이 **받아 오면 되는 것**이다. 나머지는 가리키는 자리가 딴 데다.');
  }

  if (argv.includes('--examples') && miss.length) {
    console.log('\n  ❌어디에도 없다 — 표본 (고시마다 하나씩, 앞 20개)');
    const seen = new Set();
    for (const m of miss) {
      if (seen.has(m.고시)) continue;
      seen.add(m.고시);
      console.log(`    ${m.열쇠.padEnd(16)} ${m.고시}`);
      if (seen.size >= 20) break;
    }
    console.log(`    … 못 찾은 고시 ${new Set(miss.map((m) => m.고시)).size}개`);
  }

  const save = arg('--save');
  if (save) {
    fs.writeFileSync(save, JSON.stringify({
      잰날: new Date().toISOString().slice(0, 10),
      자: 'notice_ref_ready.js',
      뜻: '고시 원문이 본문에서 가리키는 별표·서식을 생산 함수(collectRefs·resolveRefs)로 판정한 것',
      고시수: list.length, 가리킴없는고시: noRef, 가리킴: refTotal, 칸: tally, 까닭: cause,
    }, null, 1) + '\n');
    console.log(`\n  기준선 저장: ${save}`);
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('실패:', e && e.stack || e);
  process.exit(1);
});
