/**
 * ============================================================================
 * 파일명: _dashboard/loop/glossary_route_probe.js
 * 역할  : ★게이트가 아니다 — **조사용 탐침**이다 (일감 L-2).
 * ============================================================================
 *
 * [왜 있나 — 일감 L-2]
 * `_glossary.md` 는 구어·별칭을 위키 쪽으로 보내는 사전이다. 그런데 그 사전이
 * **실제로 사용자 질문에서 작동하는지는 아무도 넣어 본 적이 없다** — P-9a·P-9b 도
 * 코드를 읽은 추론이었다. 여기서 **별칭 전부를 실제 질문으로 넣는다.**
 *
 * [★두 칸으로 가른다 — 한 칸으로 재면 까닭을 못 본다]
 *   ① **글로서리가 잡나** — `glossaryExpand(별칭)` 이 그 줄의 쪽을 `forcedSlugs` 로 집어내나.
 *   ② **검색이 건지나**   — `search(별칭)` 의 `contextPages` 에 그 쪽이 실제로 들어오나.
 * 둘이 갈리는 곳이 고칠 자리다:
 *   · ①✅②❌ = 사전은 맞는데 **검색이 그 쪽을 못 올린다**(가리키는 쪽이 없거나 점수에 밀린다).
 *   · ①❌②✅ = 사전 없이도 **낱말만으로 닿는다**(그 줄은 사전에 없어도 된다).
 *   · ①❌②❌ = **정말 못 닿는다**. 이것만이 진짜 구멍이다.
 *
 * [production 함수를 그대로 쓴다] L-136 — `R.loadGlossary` · `R.glossaryExpand` · `R.search`.
 *   제 사본을 만들면 자와 실물이 갈린다.
 * [키가 필요 없다] 답변 경로에서 키가 막는 것은 `synthesizeAnswerStream`(답변 글쓰기) 하나뿐이다.
 *   「무엇을 찾아 무엇을 건네는가」는 키 없이 전부 잴 수 있다(live_probe.js 머리말과 같은 까닭).
 *
 * [쓰는 법] node …/glossary_route_probe.js [--limit N] [--out 경로]
 * [연계] 사전 `wiki/_glossary.md` · 배경 `00_WORKLIST.md` L-2 · 형제 `live_probe.js`
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const HERE = __dirname;
// 날짜는 **UTC 기준**으로 적는다 — 이 저장소의 선례가 그렇다(`live_probe_2026-09-22.json` 의
// 생성 시각이 `2026-09-22T15:42Z`(KST 로는 9/23 00:42)인데 파일 이름은 9-22 다).
const RUN_DAY = new Date().toISOString().slice(0, 10);
const OUT = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : path.join(HERE, '..', `glossary_route_${RUN_DAY}.json`);
const LIMIT = process.argv.includes('--limit')
    ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;

/**
 * 쪽 하나의 열쇠 — **파일명**. 생산 `resolvePage()` 가 실제로 쓰는 자와 같게 맞춘 것이다.
 *
 * ★**여기서 두 번 틀렸다. 둘 다 내 자 탓이었고, 둘 다 「없다」는 허수를 냈다.**
 *   ① 처음에는 사전의 `statutes/섬발전촉진법` 을 색인의 `섬발전촉진법` 과 그대로 견줬다 →
 *      멀쩡한 쪽 5개(섬발전촉진법·마리나항만법·유선및도선사업법·해사안전기본법·해상교통안전법)를
 *      「색인에 없다 10건」으로 셌다. → 접두 떼기를 **생산 규칙 `R.normalizeSlug`** 에 맡겨 고쳤다.
 *   ② 그래도 4건이 남았다. 사전의 `activity_해루질` 은 `normalizeSlug` 로 `concept:activity_해루질`
 *      이 되는데 색인의 그 쪽은 **kind 가 `activity`** 다. 생산 `resolvePage()` 는 바로 이 경우를 위해
 *      **kind 를 `comparison`·`annex`·`activity` 로 갈아가며 같은 파일명을 다시 찾는** 폴백을 갖고 있다.
 *      그래서 **kind 를 열쇠에 넣지 않는다** — 생산이 실제로 그렇게 찾기 때문이다.
 *   ⇒ 교훈은 하나다: 「없다」가 나오면 **먼저 내 자를 의심한다.**
 */
function keyOfPage(p) {
    return String(p.file || '').replace(/\.md$/, '');
}
/** 사전이 적은 슬러그(`statutes/…`·`법__주제|보임말`) → 같은 파일명 열쇠. */
function keyOfSlug(raw) {
    return R.normalizeSlug(raw).file;
}

(async function main() {
    const rows = R.loadGlossary();
    // 별칭 하나가 곧 질문 한 개다. 사전 한 줄에 별칭이 여러 개이므로 (별칭, 그 줄의 쪽) 짝으로 편다.
    const cases = [];
    for (const row of rows) {
        for (const t of (row.terms || [])) {
            const term = String(t || '').trim();
            if (term) cases.push({ term, want: (row.slugs || []).map(String) });
        }
    }
    const list = LIMIT > 0 ? cases.slice(0, LIMIT) : cases;

    const res = [];
    const tally = { '①✅②✅': 0, '①✅②❌': 0, '①❌②✅': 0, '①❌②❌': 0, '가리키는 쪽이 색인에 없다': 0 };
    const known = new Set((R.loadIndex().pages || []).map(keyOfPage));
    let n = 0;
    for (const c of list) {
        n++;
        if (n % 100 === 0) process.stderr.write(`  ...${n}/${list.length}\n`);
        const rec = { term: c.term, want: c.want };
        try {
            const g = R.glossaryExpand(c.term);
            const forced = (g.forcedSlugs || []).map(String);
            rec.glossary = c.want.some((w) => forced.includes(w));

            const r = await R.search(c.term);
            const got = (r.contextPages || []).map(keyOfPage);
            const wantKeys = c.want.map(keyOfSlug);
            rec.searchHit = wantKeys.some((w) => got.includes(w));
            rec.rank = (function () {
                for (let i = 0; i < got.length; i++) if (wantKeys.includes(got[i])) return i + 1;
                return 0;
            })();
            rec.pages = got.length;
            // ★가리키는 쪽이 아예 색인에 없으면 ②는 영영 ❌ 다 — 그건 검색 탓이 아니다. 따로 센다.
            rec.targetMissing = !wantKeys.some((w) => known.has(w));
            if (rec.targetMissing) tally['가리키는 쪽이 색인에 없다']++;
            tally[(rec.glossary ? '①✅' : '①❌') + (rec.searchHit ? '②✅' : '②❌')]++;
        } catch (e) {
            rec.error = e.message;
        }
        res.push(rec);
    }

    const out = {
        생성: new Date().toISOString(),
        '사전 줄': rows.length,
        '별칭(질문) 수': list.length,
        '갈래': tally,
        '②에서 적중 순위 중앙값': (function () {
            const rs = res.filter((r) => r.rank > 0).map((r) => r.rank).sort((a, b) => a - b);
            return rs.length ? rs[Math.floor(rs.length / 2)] : 0;
        })(),
        rows: res,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
    console.log(`사전 ${rows.length}줄 · 별칭 ${list.length}개를 실제 질문으로 넣었다`);
    for (const k of Object.keys(tally)) console.log(`  ${k}: ${tally[k]}`);
    console.log('  ②에서 적중 순위 중앙값:', out['②에서 적중 순위 중앙값']);
    console.log('결과:', OUT);
})();
