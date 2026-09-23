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

function find() {
    const out = [];
    // ⚠★**범위를 V5-17 과 같게 맞춘다.** 처음엔 raw 전체를 쓸어 **2,612개**가 나왔다 —
    //   실측값 19 와 견줘 보고 바로 알았다. 쓸려 들어온 것들은 **결함이 아니다**:
    //     · `행정규칙/`  고시는 조 마커 꼴이 다르다(L-54)
    //     · `_이미지/`   OCR 글이라 머리줄이 없는 게 당연하다
    //     · `부칙.txt`   부칙은 `[제N조]` 로 안 적는다
    //     · `별표/`·`_원본첨부/`·`_구판/`·`_대기/`
    //   **범위를 안 맞추면 게이트가 2,612개를 결함이라 외친다** — 그러면 아무도 안 듣는다.
    const SKIP_DIR = new Set(['행정규칙', '별표', '_이미지', '_원본첨부']);
    const SKIP_FILE = new Set(['부칙.txt']);
    // ⚠**부칙은 조 머리줄을 안 쓴다** — 이름이 `부칙` 으로 시작하거나 `_부칙.txt` 로 끝나면 뺀다.
    const walk = (dir) => {
        const b = path.basename(dir);
        if (SKIP_DIR.has(b) || b === '_구판' || b === '_대기') return;
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.txt') || SKIP_FILE.has(e.name)) continue;
            if (e.name.startsWith('부칙') || e.name.endsWith('_부칙.txt')) continue;
            let t;
            try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
            if (HEAD.test(t)) continue;                       // 머리줄이 있으면 V5-17 소관
            const head1 = t.split('\n', 1)[0] || '';
            if (head1.includes('별표') || head1.includes('서식')) continue;  // 별표엔 조 머리줄이 없는 게 정상
            const plain = (t.match(PLAIN) || []).length;
            if (plain < 2) continue;                          // 조문이라 볼 만큼 안 나오면 대상 아님
            out.push({ 파일: path.relative(RAW, p), 평문조: plain, 깨짐: /0{6,}/.test(t) });
        }
    };
    walk(SCOPE);
    return out;
}

function main() {
    const rows = find();
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify({ 머리줄없음: rows.length }, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', rows.length);
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    const broken = rows.filter((r) => r.깨짐).length;
    console.log(`  본문에 조문이 있는데 **[제N조] 머리줄이 0인 원문** ${rows.length}개 (기준선 ${base.머리줄없음})`);
    console.log(`     · 그중 0 이 길게 이어져 **수집이 깨진 것** ${broken}개`);
    console.log('     ⚠V5-17 은 머리줄을 **찾아서** 견주므로 이 파일들을 **원리적으로 못 본다**(뿌리 사슬 ⑤).');
    for (const r of rows.slice(0, 6)) console.log(`     · ${r.파일}  (평문 제N조 ${r.평문조}회${r.깨짐 ? ' · 0000 있음' : ''})`);
    if (rows.length > 6) console.log(`     … 그 밖 ${rows.length - 6}개`);
    if (rows.length > base.머리줄없음) {
        console.log(`  ❌ 늘었다: ${base.머리줄없음} → ${rows.length}`);
        console.log('     → 수집기가 원시 API 글을 그대로 담았다. **다시 받는다**(raw 는 불변 — 머리줄을 손으로 끼우지 않는다).');
        return 1;
    }
    console.log(rows.length < base.머리줄없음
        ? `  ✅ 줄었다: ${base.머리줄없음} → ${rows.length} — \`--update\` 로 잠근다`
        : (base.머리줄없음 === 0
            ? '  ✅ 하나도 없다 — 3-43 에서 19개를 다시 받아 0 으로 잠갔다'
            : '  ✅ 기준선 그대로 — 늘지 않았다 (다시 받는 것은 3-43)'));
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { find };
