/**
 * _meta_schema.js — ★**꼬리표 사전** (2-2, 2026-09-23). 뿌리 사슬 ①의 해법.
 *
 * [왜 있나]
 * `_SCHEMA §1` 이 요구한 8키를 다 갖춘 `_meta.json` 은 **516개 중 0개**였다(0-3).
 * 규칙은 있는데 **코드가 안 읽으니** 아무도 지키지 않았다 — 뿌리 사슬 ① 그대로다.
 *
 * [먼저 쟀다 — 2026-09-23 전수 516개]
 *   키가 **128가지**. 그중 **88가지는 아무 실행 코드도 안 읽는다**(작업 메모가 섞인 것).
 *   코드가 읽는 것은 37가지뿐이고, 가장 많이 읽히는 것은 `families`(35파일)다.
 *
 * ┌ ★가장 중요한 실측 — **합치려다 틀릴 뻔했다** ─────────────────────────┐
 * │ 판번호로 보이는 이름이 11가지라 "하나로 합치자"가 첫 설계였다.        │
 * │ 값을 맞대어 보니 **전부 다른 값**이었다:                              │
 * │                                                                      │
 * │   법령ID ↔ 법령일련번호(MST)   15쌍 · 같은 값 0                      │
 * │   법령ID ↔ 법령일련번호(법률)   15쌍 · 같은 값 0                      │
 * │   조약일련번호 ↔ 조약번호       10쌍 · 같은 값 0                      │
 * │                                                                      │
 * │ **같은 것의 다른 이름이 아니라 서로 다른 것**이었다. 저장소 코드가     │
 * │ 이미 그렇게 적어 두었다 — `law_fresh.py:14`:                          │
 * │   *"families 에 계열별 **MST(그 판 고유번호)** 와 **법령ID** 가 적혀  │
 * │     있다. `lawSearch.do?target=eflaw&LID=<법령ID>` 로 판 목록을 받아  │
 * │     우리 MST 와 비교한다."*                                           │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 *   ┌ 뜻 ─────────────────────────────────────────────────────────────┐
 *   │ 법령ID   **법 자체**를 가리키는 번호(LID). 판이 바뀌어도 안 변한다. │
 *   │ MST      **그 판(버전)** 을 가리키는 번호. 계층마다 다르다.        │
 *   │          ⚠둘은 **달라야 정상**이다. 같으면 오히려 이상하다.        │
 *   │ 계층      법률 · 시행령 · 시행규칙 … (`families` 의 열쇠)          │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * [그래서 제자리는 스칼라가 아니다]
 *   한 폴더에 법률·시행령·시행규칙이 함께 있으므로 **판번호는 계층마다 하나**다.
 *   스칼라 한 칸에 우겨넣으려다 이름이 11가지로 갈린 것이다.
 *   정규 자리는 이미 있다 — `families.<계층>.{ MST, 법령ID, 파일 }`
 *   (families 항목 692개 중 파일 648 · MST 644 · 법령ID 232).
 *
 * [2026-09-23 실측 — 판번호가 어디에 있나 (516개)]
 *   families 안에만        320
 *   최상위에만(흩어진 것)    74     ← 제자리를 벗어난 것
 *   둘 다                   34     ← 어긋날 수 있는 것
 *   ★아무 데도 없다         88  (17.1%)  ← 진짜 결손
 *
 * ⚠**이 파일은 아무것도 안 고친다.** 흩어진 것을 **조용히 합치지 않는다** —
 *   `strays` 로 따로 돌려주고, families 와 어긋나면 `conflicts` 로 알린다.
 *   합치는 것은 사람이 보고 정할 일이다(G-34 — 봐주는 쪽이야말로 근거가 있어야 한다).
 *
 * [연계] ← 2-3(V5-18, 이 정의를 읽는 게이트) · local_server/scripts/test_meta_schema.js
 *        → law_fresh.py · admrul_fresh.py · collect.py (families 를 쓰는 쪽)
 *        → _SCHEMA §1 · 00_WORKLIST 2-2 · 0-3
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAW_ROOT = path.resolve(__dirname, '../../raw');

/** 판번호가 최상위에 흩어져 적힌 이름들 — **옛 자리**다. 값이 서로 달라 합치지 않는다. */
const STRAY_ID_KEYS = [
    '법령ID', 'MST', '법령일련번호', '법령일련번호(MST)', '법령일련번호(법률)',
    '법령일련번호(시행령)', '법령일련번호(시행규칙)',
    '조약일련번호', '조약번호', '행정규칙ID', '행정규칙일련번호',
];

/** `families.<계층>` 안에서 판번호를 담는 이름 (실측: MST 644 · 법령ID 232). */
const FAM_ID_KEYS = ['MST', '법령ID'];

/**
 * 계층 이름을 최상위 별칭에서 읽어낸다.
 * `법령일련번호(시행령)` → `시행령`. 괄호가 없으면 계층을 모른다(null).
 */
function layerOfStray(key) {
    const m = /^법령일련번호\((.+)\)$/.exec(key);
    if (m) return m[1] === 'MST' ? null : m[1];   // `(MST)` 는 계층이 아니라 꼴 표기다
    return null;
}

/** 이 저장소의 모든 `_meta.json` 경로. */
function metaFiles(root) {
    const base = root || RAW_ROOT;
    const out = [];
    (function walk(dir) {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name === '_meta.json') out.push(p);
        }
    })(base);
    out.sort();
    return out;
}

/**
 * 꼬리표 하나를 **정규 꼴로 읽는다**. 고치지 않는다 — 있는 그대로 갈라 보여 줄 뿐이다.
 *
 * @returns {{
 *   file: string, ok: boolean, error: string|null, raw: object,
 *   families: object,     // 계층 → { MST, 법령ID, 파일, … } (원본 그대로)
 *   strays: object,       // 최상위에 흩어진 판번호 이름 → 값
 *   conflicts: string[],  // families 와 최상위가 같은 계층을 다르게 말하는 자리
 *   hasId: boolean        // 판번호가 families 안에 하나라도 있나
 * }}
 */
function readMeta(file) {
    const out = {
        file, ok: false, error: null, raw: {},
        families: {}, strays: {}, conflicts: [], hasId: false,
    };
    let d;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { out.error = '읽지 못했다: ' + ((e && e.message) || String(e)); return out; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
        out.error = '최상위가 객체가 아니다: ' + (Array.isArray(d) ? 'array' : typeof d);
        return out;
    }
    out.ok = true;
    out.raw = d;

    const fam = d.families;
    if (fam && typeof fam === 'object' && !Array.isArray(fam)) {
        for (const [layer, v] of Object.entries(fam)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                out.families[layer] = v;
                if (FAM_ID_KEYS.some((k) => v[k] != null && v[k] !== '')) out.hasId = true;
            }
        }
    }
    for (const k of STRAY_ID_KEYS) {
        if (d[k] == null || d[k] === '') continue;
        out.strays[k] = d[k];
        // 계층을 알 수 있는 것만 families 와 맞대어 본다 — 모르는 것은 **추측하지 않는다**.
        const layer = layerOfStray(k);
        if (layer && out.families[layer]) {
            const mine = String(out.families[layer].MST == null ? '' : out.families[layer].MST).trim();
            const theirs = String(d[k]).trim();
            if (mine && theirs && mine !== theirs) {
                out.conflicts.push(`${layer}: families.MST=${mine} ↔ 최상위 ${k}=${theirs}`);
            }
        }
    }
    return out;
}

/**
 * 전수를 세어 **판번호가 어디에 있는지** 네 갈래로 가른다.
 * ⚠숫자를 말할 때는 **뜻과 범위를 함께** 말한다(2-6 의 규약).
 */
function census(root) {
    const files = metaFiles(root);
    const r = {
        total: files.length,
        unreadable: 0,
        famOnly: 0, strayOnly: 0, both: 0, none: 0,
        conflictFiles: 0, conflicts: [],
        label: '뜻: 그 판을 가리키는 번호(MST)가 제자리(`families.<계층>`)에 있나 · '
             + '범위: raw/ 전체 `_meta.json`',
    };
    for (const f of files) {
        const m = readMeta(f);
        if (!m.ok) { r.unreadable++; continue; }
        const stray = Object.keys(m.strays).length > 0;
        if (m.hasId && stray) r.both++;
        else if (m.hasId) r.famOnly++;
        else if (stray) r.strayOnly++;
        else r.none++;
        if (m.conflicts.length) {
            r.conflictFiles++;
            r.conflicts.push({ file: path.relative(root || RAW_ROOT, f), why: m.conflicts });
        }
    }
    return r;
}

module.exports = {
    RAW_ROOT, STRAY_ID_KEYS, FAM_ID_KEYS,
    layerOfStray, metaFiles, readMeta, census,
};
