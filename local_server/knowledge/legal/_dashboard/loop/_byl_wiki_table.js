'use strict';
/**
 * _byl_wiki_table.js — ★별표 위키 문서에서 **별표 표만** 골라내는 단 한 곳. (2026-09-27)
 *
 * [왜 있나 — 사장님께 검토장을 내밀기 전에 실측으로 잡았다]
 *   `annex_rowcount_fill.js` 와 `build_rowcount_html.js` 가 **각자** 위키 표를 세고 있었고,
 *   둘 다 **파일의 표를 전부** 긁었다. 위키 별표 문서에는 별표 표 말고도
 *   `## 근거 조문` · `## 변경 이력` 표가 있어서, 보기 —
 *     국제항해선박 시행규칙 별표2:
 *        별표 표 (머리1+데이터4=5) + 근거 조문 (1+4=5) + 변경 이력 (1+1=2) = **12**
 *        ← 위키 38쪽에 `기계 셈 12행` 으로 적힌 수가 이것이다
 *        별표 표만 데이터 줄로 세면 **4** (원문 4행과 같다)
 *   38쪽 전수로 재니 적힌 값과 바른 값이 같은 것은 **0/38** 이었다.
 *   그리고 검토장은 표를 3덩이씩 보여 주어 **어느 것을 세라는지 알 수 없는 물음**이 됐다.
 *   ⇒ 세는 법을 한 곳에 두고 둘이 같이 쓴다(L-386 · 같은 규칙이 두 곳에 있으면 한 곳만 고쳐진다).
 *
 * [연계] ← `wiki/annexes/*.md` · → `annex_rowcount_fill.js` · `build_rowcount_html.js`
 *         자매: 원문 쪽을 세는 자는 `article_text.countBoxRows`(운영 코드 · L-136)
 */

// ★별표가 **아닌** 표가 실려 있는 마디들. 머리글로 가른다(위키 38쪽을 훑어 모은 목록이다).
//   ⚠막는 쪽으로만 쓴다 — 허용 목록이 아니다. 새 마디가 생겨도 별표 표를 잃지 않는다.
const 딴마디 = /^(출처|근거\s*조문|변경\s*이력|관련|바뀐\s*자리|참고|링크|메모|덧댄\s*기록)/;

/**
 * 위키 문서에서 **별표 표만** 오려 낸다.
 * @param {string} text - 위키 `.md` 전문
 * @returns {{머리글:string, 글:string, 데이터행:number}[]}
 */
function 별표표(text) {
    const out = [];
    let 머리 = '(머리글 없음)';
    let cur = [];
    const 닫기 = () => {
        if (cur.length >= 2) {
            // 맨 위 이름줄 1개와 `|---|---|` 구분줄은 항목이 아니다.
            const 데이터 = cur.filter((s) => !/^\|[\s:|-]+\|$/.test(s)).slice(1);
            out.push({ 머리글: 머리, 글: cur.join('\n'), 데이터행: 데이터.length });
        }
        cur = [];
    };
    for (const l of String(text || '').split('\n')) {
        if (/^#+\s/.test(l)) { 닫기(); 머리 = l.replace(/^#+\s*/, '').trim(); continue; }
        if (l.trim().startsWith('|')) { cur.push(l.trim()); continue; }
        닫기();
    }
    닫기();
    return out.filter((x) => !딴마디.test(x.머리글));
}

/** 그 위키 문서의 **별표 표 데이터 줄 합**. 표가 없으면 0. */
function 별표행수(text) {
    return 별표표(text).reduce((a, x) => a + x.데이터행, 0);
}

module.exports = { 별표표, 별표행수, 딴마디 };
