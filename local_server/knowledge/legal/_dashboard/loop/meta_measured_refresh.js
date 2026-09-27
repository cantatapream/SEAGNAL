#!/usr/bin/env node
/**
 * V5-41 의 짝 — **「실측」 칸을 다시 재어 새 날짜로 적는다.** (2026-09-24 신설)
 *
 * [무엇이 문제였나]
 *   `_meta.json` 의 `실측_YYYY-MM-DD` 칸은 스스로 *"이 폴더에 지금 실제로 들어 있는 것…
 *   **판단은 이 칸을 근거로 한다**"* 고 적어 두었다. 그런데 **아무도 다시 재지 않았다.**
 *   2026-09-24 첫 측정: 적힌 파일 695개 중 **조문수가 다른 것 303 · 바이트가 다른 것 72.**
 *
 * [왜 「고친다」가 아니라 「새로 적는다」인가]
 *   저장소 규약은 **옛 서술을 지우지 않는다.** 그런데 이 칸은 **키에 날짜가 있다** —
 *   그래서 새 칸(`실측_2026-09-24`)을 더하면 옛 칸은 **그날의 기록으로 그대로 남는다.**
 *   게이트(V5-41)는 **가장 새 칸만** 본다. 지우지 않고도 최신을 유지하는 길이다.
 *
 * [★값이 달라진 까닭을 같이 적는다 — 숫자만 갈아 끼우지 않는다]
 *   ⓐ 파일이 바뀌었다(바이트도 다르다) → `왜: 파일이 바뀌었다`
 *   ⓑ 파일은 그대로인데 조문수만 다르다 → `왜: 자가 좋아졌다` — 실제로 조약 파일들이
 *      **글자 하나 안 바뀌었는데** 0 → 2·4 가 됐다(2026-09-24 조약 조문꼴 꼴④ 추가, 3-51).
 *      이 구분을 안 적으면 다음 사람이 **파일이 바뀐 줄 안다.**
 *
 * [세는 법] `article_text.listArticleNumbers` — 챗봇이 쓰는 그 함수(L-136).
 * [연계] → `meta_measured_gate.js`(V5-41) 가 이 칸을 검사한다
 * 사용법: node meta_measured_refresh.js [--apply] [--only <폴더조각>]
 *
 * ★`--only <폴더조각>` (2026-09-25 보탬) — **그 조각이 든 폴더만** 다시 쓴다.
 *   왜 필요했나: `park_future_article.py` 로 raw 한 파일을 고치자 `V5-41` 이 그 파일 하나를
 *   빨간불로 잡았다(바이트·조문수). 그런데 `--apply` 를 그냥 돌리면 **335 폴더**가 함께
 *   다시 써진다 — 내 손질과 무관한 것까지 한 커밋에 섞인다(외과수술식 변경을 깬다).
 *   그래서 「한 폴더만 다시 쓰는 문」을 냈다. **손으로 고치는 문이 아니다** —
 *   여전히 이 자가 `article_text.listArticleNumbers` 로 재서 쓴다(L-136).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const TODAY = '2026-09-24';
const NEWKEY = `실측_${TODAY}`;
const RULER = 'article_text.listArticleNumbers (2026-09-24 판 — 조약 조문꼴 꼴④ 포함)';

function latestKey(meta) {
    const ks = Object.keys(meta).filter((k) => /^실측_/.test(k) && meta[k] && meta[k]['파일'] && k !== NEWKEY);
    return ks.length ? ks.sort()[ks.length - 1] : null;
}

function main() {
    let folders = 0, touchedFiles = 0, changed = 0, sameOnly = 0;
    const why = { 파일이바뀌었다: 0, 자가좋아졌다: 0, 둘다: 0 };
    const paths = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== '_대기') walk(p); continue; }
            if (e.name !== '_meta.json') continue;
            // ★`--only` 는 **폴더 경로에 그 조각이 든 것만** 본다(저장소 상대경로로 견준다).
            if (ONLY && !path.relative(RAW, d).split(path.sep).join('/').includes(ONLY)) continue;
            let meta;
            try { meta = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
            const old = latestKey(meta);
            if (!old) continue;
            folders++;
            const prev = meta[old];
            const files = {};
            let anyDiff = false;
            for (const [fn, v] of Object.entries(prev['파일'])) {
                const fp = path.join(d, fn);
                if (!fs.existsSync(fp)) {
                    files[fn] = { 없어졌다: true, '옛 기록': v };
                    anyDiff = true; continue;
                }
                const t = fs.readFileSync(fp, 'utf8');
                const by = Buffer.byteLength(t);
                const nums = AT.listArticleNumbers(t);
                const byDiff = typeof v['바이트'] === 'number' && v['바이트'] !== by;
                const arDiff = typeof v['조문수'] === 'number' && v['조문수'] !== nums.length;
                const row = { 바이트: by, 조문수: nums.length, 조문: nums.join('·') };
                if (byDiff || arDiff) {
                    anyDiff = true;
                    row['옛 값'] = { 바이트: v['바이트'], 조문수: v['조문수'], 잰날: old.replace('실측_', '') };
                    row['왜 달라졌나'] = byDiff && arDiff
                        ? (why.둘다++, '파일이 바뀌었다(바이트도 조문수도 다르다)')
                        : byDiff
                            ? (why.파일이바뀌었다++, '파일이 바뀌었다(조문수는 같다)')
                            : (why.자가좋아졌다++, '★파일은 그대로인데 조문수만 다르다 — **세는 자가 좋아진 것**이다. '
                                + '2026-09-24 에 조약 조문꼴(꼴④)과 머리말 처리를 고쳤다(3-51·V5-37).');
                }
                files[fn] = row;
                touchedFiles++;
            }
            if (!anyDiff) { sameOnly++; continue; }
            changed++;
            if (APPLY) {
                meta[NEWKEY] = {
                    설명: prev['설명'] || '이 폴더에 지금 실제로 들어 있는 것을 기계로 세어 적은 값이다.',
                    주의: prev['주의'] || '',
                    '센 법': RULER,
                    '앞 기록': old + ' (지우지 않는다 — 그날의 기록이다)',
                    파일: files,
                };
                fs.writeFileSync(p, JSON.stringify(meta, null, 1) + '\n', 'utf8');
                paths.push(p);
            }
        }
    })(RAW);
    console.log(`  「실측」 칸이 있는 폴더 ${folders}개`);
    console.log(`    ${APPLY ? '새로 적었다' : '새로 적을 것'}  ${String(changed).padStart(4)}   값이 달라진 폴더`);
    console.log(`    ·  그대로다        ${String(sameOnly).padStart(4)}   손대지 않는다`);
    console.log('    왜 달라졌나 — 파일이바뀌었다 %d · 둘다 %d · ★자가좋아졌다 %d',
        why.파일이바뀌었다, why.둘다, why.자가좋아졌다);
    if (!APPLY) console.log('\n  (미리보기다. 적용하려면 --apply)');
    else console.log(`\n  고친 _meta.json ${paths.length}개`);
    return 0;
}

if (require.main === module) process.exit(main());
