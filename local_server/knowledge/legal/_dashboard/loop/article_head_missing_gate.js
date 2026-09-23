#!/usr/bin/env node
/**
 * V5-31 — 본문에 조문이 있는데 **`[제N조]` 머리줄이 하나도 없는 원문** (2026-09-23 신설, G-27)
 *
 * [★왜 아무도 못 봤나] V5-17(`unreachable_article_guard.py`)은 *"파일에는 있는데 챗봇이
 *   못 읽는 조문"* 을 본다. 그런데 그것은 `[제N조]` **머리줄을 찾아서** 견준다 —
 *   **머리줄이 아예 없는 파일은 원리적으로 못 본다.** 찾을 것이 없으니 0 으로 나온다.
 *   뿌리 사슬 ⑤ 그대로 — 게이트가 묻지 않는 물음은 영영 답이 없다.
 *
 * [무엇이었나 — 2026-09-23 실측] `raw/_자치법규` 176개 중 **19개**가 그렇다.
 *   ⚠등록부(G-27)는 **22개**라고 적었는데, 그중 **3개는 `[조례 별표]`** 로
 *   **별표에는 조 머리줄이 없는 것이 정상**이다. 뭉쳐 세면 3을 결함으로 잘못 센다.
 *   · 19개 **전부** 본문에 평문 `제N조` 가 있다(119회 ~ 5회).
 *   · 그중 **10개를 위키가 이름으로 짚는다** — 눌러도 조가 안 열린다.
 *   · 2개는 `0` 이 여섯 자 넘게 이어진다(경상북도 자연유산·문화유산 조례) — 수집이 깨졌다.
 *
 * [★왜 `_자치법규` 까지만 보나 — 범위를 넓히려다 두 번 틀렸다]
 *   처음엔 `raw/` 전체를 쓸어 **2,612개**가 나왔다(행정규칙·`_이미지` OCR·부칙까지 물었다).
 *   V5-17 의 제외 목록에 맞추니 **129개**. 그것도 갈라 보니 **부칙 변형 17+·타법인용 4·
 *   종전조문 스냅샷·수집확인 메모**가 대부분이었다 — **전부 `[제N조]` 를 가질 자리가 아니다.**
 *   범위를 더 넓히려면 「어떤 파일이 조 머리줄을 가져야 하는가」를 **먼저 정해야 한다**.
 *   그것을 안 정한 채 넓히면 게이트가 2,612개를 결함이라 외치고, **아무도 안 듣게 된다**(④).
 *   그래서 **내가 실제로 재고 확인한 `_자치법규` 본문**만 본다. 넓히는 것은 3-43 에서 한다.
 *
 * [무엇을 재나] 기준선(19)보다 **늘면 실패**한다. 고치는 길은 **다시 받는 것**이다 —
 *   `raw/` 는 불변이라 머리줄을 손으로 끼워 넣지 않는다(3-43).
 *
 * ★정정(2026-09-23, 3-43 완료) — **위 19 는 이제 0 이다.** 옛 서술은 지우지 않는다.
 *   `ordin_recollect.py` 로 19개를 **다시 받아** 운영 변환기(`ordin_to_folder.convert`)에 태웠다.
 *   기준선은 **0 으로 다시 구웠다** — 이제 **하나라도 생기면 실패**한다.
 *   ⚠그때 한 가지를 하마터면 지울 뻔했다: 둘은 조문 뒤에 **사람이 손으로 옮겨 적은 것**
 *   (울릉군 별표1 hwp→html 전사 16줄 · 제주 사무전결처리규칙 별표2 엑셀 대조 메모 6줄)을
 *   달고 있었다. **다시 받아도 안 나오는 것**이라, 받은 것으로 통째로 덮었으면 잃었다.
 *   → 다시 받는 도구는 **조문 뒤 손일을 글자 그대로 옮겨 붙인다.**
 *
 * ★★정정(2026-09-23, 3-47) — **범위를 정했다. 이제 `raw/` 전부를 본다.**
 *   위 [왜 `_자치법규` 까지만 보나] 는 *"넓히려면 「어떤 파일이 조 머리줄을 가져야 하는가」를
 *   먼저 정해야 한다"* 로 끝났다. **그 규약을 `_counting.js` 에 적었다**(3-47).
 *     **가져야 한다**  : `<법>/` 바로 아래 계층 본문(`법률·시행령·시행규칙·대통령령.txt`)
 *     **가지면 안 된다**: `별표/` · `행정규칙/` · `_이미지/` · `_원본첨부/` · `_구판/` · `_대기/` · `부칙*.txt`
 *     **아직 안 정했다**: `*_발췌.txt`(→3-3) · `조약*.txt`(→3-45) · 조 하나만 떼어 둔 단편
 *       ⚠**안 정한 것을 결함으로 세지 않는다**(G-34).
 *   ⇒ 이 게이트는 이제 **세는 일을 스스로 하지 않는다.** `_counting.js` 의
 *     `countArticleHeadMissing({scope})` 를 **부른다**(L-136 — 자를 둘로 만들지 않는다).
 *   ⇒ 기준선도 **범위별로 둘**이다: 자치법규 **0** · 계층본문 **12**.
 *     ⚠12 는 **늘어난 것이 아니라 처음 본 것**이다 — 범위가 넓어졌다. 둘 다 늘면 실패한다.
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
// ★범위 = `raw/_자치법규` **본문**만. 아래 [왜 여기까지만 보나] 참조.
const SCOPE = path.join(RAW, '_자치법규');
const BASE = path.join(__dirname, 'baseline', 'article_head_missing.json');
const HEAD = /^\[제\d+조/m;
const PLAIN = /제\d+조/g;

const C = require('./_counting.js');

// ★세는 일은 `_counting.js` 가 한다. 여기서 또 세지 않는다(⑥).
//   옛 `find()` 는 지우지 않고 **이름을 바꿔 남긴다** — 무엇이 달라졌는지 보이게.
function find() {
    return C.countArticleHeadMissing({ scope: '자치법규' }).rows;
}

function findAll() {
    return C.countArticleHeadMissing({ scope: '계층본문' }).rows;
}

function main() {
    const ordin = find();
    const all = findAll();
    const watch = { 자치법규: ordin.length, 계층본문: all.length };
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify(watch, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(watch));
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    // 옛 기준선(`머리줄없음` 한 칸)도 읽는다 — 옛 것을 지우지 않는다.
    if (base.자치법규 === undefined && base.머리줄없음 !== undefined) {
        base = { 자치법규: base.머리줄없음, 계층본문: base.머리줄없음 };
    }
    console.log(`  조 머리줄(**[제N조]**)을 **가져야 하는데 없는** 계층 본문 — 규약은 3-47(\`_counting.js\`)`);
    console.log(`    · 자치법규 ${ordin.length}개 (기준선 ${base.자치법규})`);
    console.log(`    · 계층본문 전체 ${all.length}개 (기준선 ${base.계층본문})  ← \`raw/\` 전부`);
    console.log('     ⚠V5-17 은 머리줄을 **찾아서** 견주므로 이 파일들을 **원리적으로 못 본다**(뿌리 사슬 ⑤).');
    for (const r of all.slice(0, 6)) console.log(`     · ${r.파일}  (평문 제N조 ${r.평문조}회${r.깨짐 ? ' · 0000 있음' : ''})`);
    if (all.length > 6) console.log(`     … 그 밖 ${all.length - 6}개`);
    const worse = Object.keys(watch).filter((k) => watch[k] > base[k]);
    if (worse.length) {
        console.log(`  ❌ 늘었다: ${worse.map((k) => `${k} ${base[k]}→${watch[k]}`).join(' · ')}`);
        console.log('     → 수집기가 원시 API 글을 그대로 담았다. **다시 받는다**(raw 는 불변 — 머리줄을 손으로 끼우지 않는다).');
        return 1;
    }
    const better = Object.keys(watch).filter((k) => watch[k] < base[k]);
    console.log(better.length
        ? `  ✅ 줄었다: ${better.map((k) => `${k} ${base[k]}→${watch[k]}`).join(' · ')} — \`--update\` 로 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다 (계층 본문 12개를 다시 받는 것은 3-51)');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { find, findAll };
