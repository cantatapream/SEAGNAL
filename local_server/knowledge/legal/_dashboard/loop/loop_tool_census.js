#!/usr/bin/env node
/**
 * loop/ 의 자들이 **누구에게 불리는가**를 센다. (G-15 · 뿌리 사슬 ④)
 *
 * [왜] 조사에서 나온 ④는 *"게이트를 부르는 것이 없으면 게이트도 죽는다"* 였다.
 *   같은 일이 **도구 한 자루 단위**로도 일어난다 — 만들어 놓고 아무도 안 부르면,
 *   그 자는 있는 줄도 모르게 되고 **다음 사람이 같은 자를 또 만든다.**
 *   ★2026-09-24 실측에서 **오늘 내가 만든 자 둘**(`build_rowcount_html.js`·
 *   `review_mark_census.py`)이 벌써 「아무데서도 안 짚히는 것」에 들어 있었다.
 *
 * [세는 법 — 네 갈래]
 *   게이트  `scripts/refactor/verify_all.sh` 가 이름을 부른다 — 매번 돈다
 *   코드    다른 `.js`/`.py`/`.sh`/`.yml` 이 부른다 — 누군가의 한 토막이다
 *   글만    `.md`/`.json` 에만 이름이 있다 — 기록은 남았으나 **자동으로 돌지는 않는다**
 *   없음    ★**아무데서도 안 짚힌다** — 있는 줄도 모른다. 이것만 게이트가 막는다
 *
 * ⚠**「글만」을 결함으로 세지 않는다.** 일회성 수리 도구는 글로 남는 것이 정상이다.
 *   기계가 고르지 않는다(G-34) — 게이트에 걸지 말지는 사람이 정한다.
 *
 * 쓰는 법:
 *   node loop_tool_census.js            갈래별 수 (+ --list 로 표본)
 *   node loop_tool_census.js --index    README 의 「자 목록」 구역을 다시 쓴다
 *   node loop_tool_census.js --gate     「없음」이 기준선보다 늘면 1 로 죽는다 (V5-45)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../../../..');
const GATE = path.join(ROOT, 'scripts/refactor/verify_all.sh');
const README = path.join(HERE, 'README.md');
const BASE = path.join(HERE, 'baseline/loop_tools.json');
const BEG = '<!-- 자목록:자동 -->';
const END = '<!-- /자목록 -->';

const SENSES = {
  게이트: 'verify_all.sh 가 이름을 부른다 — 매번 돈다',
  코드: '다른 코드(.js/.py/.sh/.yml)가 부른다',
  글만: '.md/.json 에만 이름이 있다 — 자동으로 돌지는 않는다',
  없음: '★아무데서도 안 짚힌다 — 있는 줄도 모른다',
};

function tools() {
  return fs.readdirSync(HERE)
    .filter(f => (f.endsWith('.js') || f.endsWith('.py')) && !f.startsWith('_'))
    .sort();
}

/** 그 자의 머리말 한 줄 — 없으면 정직하게 「머리말 없음」. */
/**
 * 그 자의 머리말 한 줄 — **주석·독스트링만** 본다.
 * ⚠코드 줄을 머리말로 내주면 안 된다. 첫 판이 그래서 `#!/usr/bin/env python3` 을,
 *   둘째 판이 `q=urllib.parse.quote(kw)` 를 「무엇을 하는 자인가」로 내놓았다.
 *   ★**머리말이 없으면 없다고 말해야** 그 자에 머리말을 달러 갈 수 있다(L-382 의 꼴).
 */
function purpose(f) {
  const head = fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').slice(0, 16);
  let inDoc = false;
  for (const raw of head) {
    const t = raw.trim();
    if (/^#!/.test(t)) continue;
    if (/^(#\s*)?-\*-/.test(t)) continue;
    const isDocEdge = /^("""|\'\'\')/.test(t);
    if (isDocEdge) { inDoc = !inDoc; }
    const isComment = /^(#|\/\/|\/\*|\*)/.test(t) || inDoc || isDocEdge;
    if (!isComment) continue;                       // ★코드 줄은 머리말이 아니다
    const l = t.replace(/^[\s#*/'"]+|[\s*/'"]+$/g, '');
    if (l.length < 12) continue;
    if (/^(파일명\s*:|역할\s*:|=====)/.test(l)) continue;
    if (/^[a-z_0-9]+\.(js|py)\s*[—-]\s*/.test(l)) return l.replace(/^[a-z_0-9]+\.(js|py)\s*[—-]\s*/, '');
    return l;
  }
  return '(머리말 없음 — 무엇을 하는 자인지 안 적혀 있다)';
}

function census() {
  const list = tools();
  const gate = fs.existsSync(GATE) ? fs.readFileSync(GATE, 'utf8') : '';
  // ⚠`git ls-files` 는 이 저장소에서 기본 버퍼(1MB)를 넘겨 ENOBUFS 로 죽는다 — 넉넉히 준다.
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n').filter(f => /\.(js|py|sh|yml|md|json)$/.test(f));
  const text = new Map();
  for (const f of files) {
    try { text.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (_e) { /* 못 읽는 파일은 없는 셈 */ }
  }
  const rows = [];
  for (const t of list) {
    const hits = [];
    for (const [f, txt] of text) {
      if (f.endsWith('/' + t)) continue;                       // 자기 자신
      if (f === 'scripts/refactor/verify_all.sh') continue;     // 게이트는 따로 본다
      if (txt.includes(t)) hits.push(f);
    }
    const 갈래 = gate.includes(t) ? '게이트'
      : hits.some(f => /\.(js|py|sh|yml)$/.test(f)) ? '코드'
        : hits.length ? '글만' : '없음';
    rows.push({ 자: t, 갈래, 짚는곳: hits.length, 머리말: purpose(t) });
  }
  return rows;
}

function main() {
  const rows = census();
  const c = {};
  for (const k of Object.keys(SENSES)) c[k] = rows.filter(r => r.갈래 === k).length;
  const 없음 = rows.filter(r => r.갈래 === '없음');
  const 머리말없음 = rows.filter(r => r.머리말.startsWith('(머리말 없음'));

  if (process.argv.includes('--index')) {
    const lines = ['### 자 목록 — 누가 부르나 (기계가 씀 · `loop_tool_census.js --index`)', '',
      `자 **${rows.length}자루** · ` + Object.keys(SENSES).map(k => `${k} **${c[k]}**`).join(' · '), '',
      '| 자 | 누가 부르나 | 무엇을 하는 자인가 |', '|---|---|---|'];
    for (const r of rows.filter(x => x.갈래 !== '게이트').sort((a, b) => a.자.localeCompare(b.자))) {
      lines.push(`| \`${r.자}\` | ${r.갈래} | ${r.머리말.replace(/\|/g, '·').slice(0, 110)} |`);
    }
    lines.push('', '> 게이트가 부르는 자는 `verify_all.sh` 에서 바로 보이므로 이 표에 넣지 않는다.');
    let md = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : '# loop 도구\n';
    const block = BEG + '\n' + lines.join('\n') + '\n' + END;
    md = (md.includes(BEG) && md.includes(END))
      ? md.slice(0, md.indexOf(BEG)) + block + md.slice(md.indexOf(END) + END.length)
      : md.replace(/\s*$/, '\n\n') + block + '\n';
    fs.writeFileSync(README, md);
    console.log(`✅ README 의 자 목록을 다시 썼다 — ${rows.length}자루`);
    return 0;
  }

  console.log(`loop 자 ${rows.length}자루`);
  for (const k of Object.keys(SENSES)) console.log(`  ${k.padEnd(4)} ${String(c[k]).padStart(4)}   ${SENSES[k]}`);
  console.log(`  ⚠머리말이 없는 자 ${머리말없음.length} — 무엇을 하는지 안 적혀 있다`);
  if (process.argv.includes('--list')) {
    for (const r of 없음) console.log(`   [없음] ${r.자} — ${r.머리말.slice(0, 70)}`);
    for (const r of 머리말없음) console.log(`   [머리말없음] ${r.자}`);
  }

  if (process.argv.includes('--gate')) {
    let base = { 없음: 0 };
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_e) { /* 없으면 0 으로 본다 */ }
    if (c.없음 > base.없음) {
      console.log(`✘ V5-45: **아무데서도 안 짚히는 자**가 늘었다 ${base.없음} → ${c.없음}`);
      for (const r of 없음) console.log(`     ${r.자} — ${r.머리말.slice(0, 60)}`);
      console.log('   → 게이트에 걸든지, README 자 목록에 적든지 한다:');
      console.log('     node loop_tool_census.js --index');
      return 1;
    }
    console.log(`✅ V5-45 안 짚히는 자 ${c.없음} (기준선 ${base.없음}) · 게이트 ${c.게이트} · 코드 ${c.코드} · 글만 ${c.글만}`);
    return 0;
  }
  return 0;
}
process.exit(main());
