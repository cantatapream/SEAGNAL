#!/usr/bin/env node
/**
 * 3-69 — 「원문 그대로」를 선언했지만 `raw 원문:` 경로가 없는 쪽에 **증명된 경우에만** 경로를 적는다 (2026-09-28)
 *
 * [왜] V5-55(`verbatim_coverage.js`)는 `raw 원문:` 라벨이 있어야 견준다. 선언한 210쪽 중 156쪽이 라벨이 없어
 *   「원문 그대로」가 **증명도 반증도 안 되는 말**로 남아 있었다. 실측해 보니 그중 71쪽은 다른 꼴
 *   (`raw: \`raw/…\``·`## 출처` 줄)로 **열리는 경로를 이미 적고 있었다** — 라벨 꼴이 달라 자가 못 읽었다.
 *   ⚠그러나 쪽에 적힌 경로가 모두 「이 쪽의 원문」은 아니다(예: 「별표14 는 다른 파일에 따로 보관」).
 *   그래서 **경로를 옮겨 적기만 하지 않고 증명한다.**
 *
 * [증명 — 추측 금지(G-34)]
 *   후보 = ①쪽에 적힌 열리는 raw 경로 ②쪽 이름(법·계층·별표 번호)으로 찾은 별표 파일.
 *   후보마다 V5-55 와 **같은 자**(`verbatim_coverage.js` 의 눕·낱말 — L-136)로
 *   「원문의 서로 다른 낱말 중 몇 %가 이 쪽에 남아 있나」를 잰다.
 *   · **95% 이상인 후보가 딱 하나**일 때만 적는다(둘 이상이면 쪽에 적힌 쪽을 고르고, 그래도 둘이면 안 적는다).
 *   · 95% 미만이면 **안 적는다** — 원문이 아닐 수도, 요약일 수도 있다. 사람 확인 목록으로 돌린다.
 *   · 원문 낱말이 20개 미만인 후보는 증명력이 없어 뺀다.
 *   ⇒ 적은 쪽은 V5-55 에서 모두 「95% 이상」으로 들어간다 — **게이트의 뜻이 바뀌지 않는다**(95미만 수는 그대로).
 *
 * [쓰는 자리] `요약 금지` 선언 줄 바로 아래에
 *   `> raw 원문: \`raw/…txt\` (2026-09-28 기계가 되찾음 · 원문 낱말 NN% 남음)` 한 줄.
 *   기존 글은 한 글자도 안 바꾼다. 고친 파일은 `_dashboard/touched/` 에 기록한다(되돌리기 가능).
 *
 * 사용법
 *   node verbatim_raw_link.js            쓰지 않고 판정만 보인다
 *   node verbatim_raw_link.js --apply    95% 이상·유일한 것만 적는다
 *   node verbatim_raw_link.js --json <파일>  판정 전부를 파일로(사람 확인 목록의 재료)
 *
 * [연계] ← `verbatim_coverage.js`(같은 자) · → V5-55 기준선 · WORKLIST `3-69`
 */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./verbatim_coverage.js');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki');
const RAW = path.join(LEGAL, 'raw');
const REPO = path.resolve(LEGAL, '..', '..', '..');
const RULE = /요약[·ㆍ]?\s*재?해석?\s*금지|요약\s*금지|그대로\s*보존/;
const RAWRE = /^[ \t]*>?[ \t]*(?:★)?[ \t]*raw[ \t]*원문[ \t]*[::][ \t]*`?(raw\/[^`\s]+\.txt)`?/gm;
const ANY = /(raw\/[^`\s)|,'"]+\.txt)/g;
const 문턱 = 0.95;
const 최소낱말 = 20;

// 법 이름 → raw 안의 그 법 폴더들
const 법폴더 = new Map();
for (const 분야 of fs.readdirSync(RAW, { withFileTypes: true })) {
  if (!분야.isDirectory()) continue;
  for (const 법 of fs.readdirSync(path.join(RAW, 분야.name), { withFileTypes: true })) {
    if (!법.isDirectory()) continue;
    const arr = 법폴더.get(법.name) || [];
    arr.push(path.join(RAW, 분야.name, 법.name));
    법폴더.set(법.name, arr);
  }
}

/** 쪽 이름으로 별표 파일 후보를 찾는다: `<법>__<계층>_별표<N>_…md` → `<법>/별표/<계층>_별표<N>.txt` */
function 이름후보(파일) {
  const m = 파일.replace(/\.md$/, '').match(/^(.+?)__(.+)$/);
  if (!m) return [];
  const [, 법, 나머지] = m;
  const 폴더들 = 법폴더.get(법) || [];
  const 번호 = (나머지.match(/별표(\d+(?:의\d+)?)/) || [])[1];
  if (!번호) return [];
  const 계층 = (나머지.match(/^(시행령|시행규칙|법률|행정규칙_[^_]+|[^_]+고시)/) || [])[1] || '';
  const out = [];
  for (const d of 폴더들) {
    const bd = path.join(d, '별표');
    if (!fs.existsSync(bd)) continue;
    for (const f of fs.readdirSync(bd)) {
      if (!f.endsWith('.txt')) continue;
      if (!new RegExp('별표' + 번호.replace(/[()]/g, '') + '(?![0-9의])').test(f)) continue;
      if (계층 && !f.startsWith(계층.replace(/^행정규칙_/, '행정규칙_'))) continue;
      out.push(path.relative(LEGAL, path.join(bd, f)));
    }
  }
  return out;
}

function 덮임(rawRel, 위키눕) {
  const t = fs.readFileSync(path.join(LEGAL, rawRel), 'utf8');
  const ws = [...new Set(V.낱말(t))];
  if (ws.length < 최소낱말) return null;
  const 없 = ws.filter((w) => !위키눕.includes(w));
  return { 덮임: 1 - 없.length / ws.length, 낱말: ws.length, 보기: 없.slice(0, 8) };
}

function 판정() {
  const 결과 = [];
  const 걷 = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { 걷(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const t = fs.readFileSync(p, 'utf8');
      if (!RULE.test(t)) continue;
      RAWRE.lastIndex = 0;
      if ([...t.matchAll(RAWRE)].length) continue;               // 이미 라벨이 있다
      const 적힌 = [...new Set([...t.matchAll(ANY)].map((m) => m[1]))].filter((x) => fs.existsSync(path.join(LEGAL, x)));
      const 추론 = 이름후보(e.name).filter((x) => !적힌.includes(x));
      const 위키눕 = V.눕(t);
      const 후보 = [];
      for (const [x, 출처] of [...적힌.map((x) => [x, '쪽에 적힘']), ...추론.map((x) => [x, '이름 추론'])]) {
        const c = 덮임(x, 위키눕);
        if (c) 후보.push({ 경로: x, 출처, ...c });
      }
      후보.sort((a, b) => b.덮임 - a.덮임);
      const 통과 = 후보.filter((c) => c.덮임 >= 문턱);
      let 고름 = null, 까닭;
      // 한 쪽이 별표 여럿을 담으면(`별표5_6_7_8`·`별표1-13`·`별표15_15의2`) 원문도 여럿이다 — 하나만 적으면
      //   절반만 증명한 것이 된다. 자동으로 하지 않고 사람 확인으로 돌린다.
      const 여러별표 = /별표\d+(?:의\d+)?[_-]\d/.test(e.name);
      if (여러별표) 까닭 = '한 쪽에 별표가 여럿 — 원문도 여럿이라 하나만 적지 않는다';
      else if (!후보.length) 까닭 = 적힌.length || 추론.length ? '후보가 너무 짧다(원문 낱말 20개 미만)' : '후보가 없다';
      else if (!통과.length) 까닭 = `가장 높은 후보도 ${(100 * 후보[0].덮임).toFixed(0)}% — 원문이 아니거나 요약일 수 있다`;
      else if (통과.length === 1) 고름 = 통과[0];
      else {
        const 적힌통과 = 통과.filter((c) => c.출처 === '쪽에 적힘');
        if (적힌통과.length === 1) 고름 = 적힌통과[0];
        else 까닭 = `95% 넘는 후보가 ${통과.length}개 — 하나를 고르지 않는다`;
      }
      결과.push({ 쪽: path.relative(WIKI, p), 절대: p, 고름, 까닭, 후보: 후보.slice(0, 4).map(({ 보기, ...r }) => ({ ...r, 덮임: +r.덮임.toFixed(3), 보기 })) });
    }
  };
  걷(WIKI);
  return 결과;
}

function 적기(r) {
  const t = fs.readFileSync(r.절대, 'utf8');
  const ls = t.split('\n');
  const i = ls.findIndex((l) => RULE.test(l));
  if (i < 0) return false;
  const 줄 = `> raw 원문: \`${r.고름.경로}\` (2026-09-28 기계가 되찾음 · 원문 낱말 ${(100 * r.고름.덮임).toFixed(0)}% 남음 — verbatim_raw_link.js)`;
  ls.splice(i + 1, 0, 줄);
  fs.writeFileSync(r.절대, ls.join('\n'));
  return true;
}

if (require.main === module) {
  const 결과 = 판정();
  const 고른 = 결과.filter((r) => r.고름);
  const 적힘에서 = 고른.filter((r) => r.고름.출처 === '쪽에 적힘').length;
  console.log(`라벨 없는 「원문 그대로」 쪽 ${결과.length}개`);
  console.log(`  ✅ 증명됨(95% 이상 · 유일)  ${고른.length}  (쪽에 적힌 경로 ${적힘에서} · 이름 추론 ${고른.length - 적힘에서})`);
  const 갈래 = {};
  for (const r of 결과.filter((x) => !x.고름)) { const k = r.까닭.replace(/\d+%/, 'N%').replace(/\d+개/, 'N개'); 갈래[k] = (갈래[k] || 0) + 1; }
  for (const [k, n] of Object.entries(갈래)) console.log(`  ⬜ ${String(n).padStart(3)}  ${k}`);
  const ji = process.argv.indexOf('--json');
  if (ji > 0) {
    fs.writeFileSync(process.argv[ji + 1], JSON.stringify(결과.map(({ 절대, ...r }) => r), null, 1) + '\n');
    console.log(`\n판정 전부 → ${process.argv[ji + 1]}`);
  }
  if (process.argv.includes('--apply')) {
    const 고친 = [];
    for (const r of 고른) if (적기(r)) 고친.push(path.relative(REPO, r.절대));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const out = path.join(LEGAL, '_dashboard', 'touched', `verbatim_raw_link_${stamp}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ script: 'verbatim_raw_link', stamp, files: 고친 }, null, 1));
    console.log(`\n✅ ${고친.length}쪽에 적었다 · 기록 ${path.relative(REPO, out)}`);
  }
}

module.exports = { 판정 };
