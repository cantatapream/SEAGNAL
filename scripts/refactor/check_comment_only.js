/**
 * ============================================================================
 * 파일명: scripts/refactor/check_comment_only.js
 * 역할  : [STEP 6 안전장치] 지정 커밋 범위에서 변경된 .js 파일이 "주석만
 *         바뀌었는지" 검사한다. 각 파일의 코드(주석·공백 제거)가 이전과
 *         100% 동일해야 통과 — 주석 정비가 로직을 건드리지 않았음을 보증.
 * 사용  : node scripts/refactor/check_comment_only.js [기준커밋]  (기본 HEAD~1)
 * ============================================================================
 */
const { execSync } = require('child_process');

const BASE = process.argv[2] || 'HEAD~1';

// JS 소스에서 주석·공백을 제거해 "코드 실체"만 남긴다 (문자열 내 // 는 대충 보존)
function stripComments(src) {
    let out = '';
    let i = 0, inStr = null, inLine = false, inBlock = false;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (inLine) { if (c === '\n') { inLine = false; out += c; } i++; continue; }
        if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2; } else i++; continue; }
        if (inStr) {
            out += c;
            if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
            if (c === inStr) inStr = null;
            i++; continue;
        }
        if (c === '/' && n === '/') { inLine = true; i += 2; continue; }
        if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
        out += c; i++;
    }
    // 공백 정규화
    return out.replace(/\s+/g, ' ').trim();
}

const changed = execSync(`git diff --name-only ${BASE}..HEAD -- '*.js'`).toString().trim().split('\n').filter(Boolean);
let fail = 0;
for (const f of changed) {
    let before = '';
    try { before = execSync(`git show ${BASE}:${f}`).toString(); } catch { continue; } // 신규 파일은 스킵
    const after = execSync(`git show HEAD:${f}`).toString();
    if (stripComments(before) !== stripComments(after)) {
        console.error(`  ❌ 코드 변경 감지(주석 외): ${f}`);
        fail++;
    } else {
        console.log(`  ✅ 주석만 변경: ${f}`);
    }
}
console.log(`\n[check_comment_only] 검사 ${changed.length}개 중 위반 ${fail}개`);
process.exit(fail ? 1 : 0);
