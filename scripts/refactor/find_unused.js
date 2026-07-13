/**
 * ============================================================================
 * 파일명: scripts/refactor/find_unused.js
 * 역할  : [데드코드 1단계 자동 검출] 미사용 후보를 수집한다 (판정 아님).
 *         - 미로드 JS: index2.html/assistant.html script 에도, 서버 require
 *           체인에도, sw.js 에도 없는 js/ 파일
 *         - 무참조 이미지: 전체 코드에서 파일명 문자열 참조 0회
 *         - 중복 파일: 내용 해시 동일 쌍
 *         결과는 후보일 뿐 — §14.3 3중 재검토 + §14.4 다중 에이전트 판정 대상.
 * 사용  : node scripts/refactor/find_unused.js
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const LS = path.join(ROOT, 'local_server');

function walk(dir, filter) {
    const out = [];
    (function rec(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (/node_modules|\.git|data\/server_logs|uploads/.test(p)) continue;
                rec(p);
            } else if (filter(p)) out.push(p);
        }
    })(dir);
    return out;
}

// 전체 텍스트 소스를 하나로 합쳐 문자열 참조 검사에 사용
const textFiles = walk(LS, (p) => /\.(js|html|json|css)$/.test(p) && !/\/data\//.test(p));
const bigText = textFiles.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
}).join('\n');

// ── 1) 미로드 JS 후보 ──
const jsFiles = walk(path.join(LS, 'js'), (p) => p.endsWith('.js'));
const unusedJs = [];
for (const f of jsFiles) {
    const base = path.basename(f);
    const rel = path.relative(LS, f); // 예: js/assistant/memory/user_memory_web.js
    // 정적 로드(경로 포함) 또는 require(파일명) 흔적 검색
    const referenced = bigText.includes(rel) ||
        new RegExp(`['"\\/]${base.replace('.', '\\.')}['"?]`).test(bigText);
    if (!referenced) unusedJs.push(rel);
}

// ── 2) 무참조 이미지 후보 ──
const imgFiles = walk(LS, (p) => /\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(p) && !/\/(uploads|screenshots)/.test(p));
const unusedImg = [];
for (const f of imgFiles) {
    const base = path.basename(f);
    if (!bigText.includes(base)) unusedImg.push(path.relative(LS, f));
}

// ── 3) 중복 파일(내용 해시 동일) ──
const hashMap = {};
for (const f of walk(LS, (p) => /\.(js|json|png|webp)$/.test(p) && !/\/(data|uploads)\//.test(p))) {
    try {
        const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        (hashMap[h] = hashMap[h] || []).push(path.relative(LS, f));
    } catch {}
}
const dups = Object.values(hashMap).filter((a) => a.length > 1);

const report = { unusedJs, unusedImg, duplicates: dups };
fs.writeFileSync(path.join(__dirname, 'baseline', 'unused_candidates.json'), JSON.stringify(report, null, 2));

console.log('[find_unused] === 미사용 후보 (판정 아님, 재검토 대상) ===');
console.log(`\n미로드 JS 후보 (${unusedJs.length}):`);
unusedJs.forEach((f) => console.log('  - ' + f));
console.log(`\n무참조 이미지 후보 (${unusedImg.length}):`);
unusedImg.slice(0, 40).forEach((f) => console.log('  - ' + f));
if (unusedImg.length > 40) console.log(`  ... 외 ${unusedImg.length - 40}개`);
console.log(`\n중복 파일 쌍 (${dups.length}):`);
dups.forEach((a) => console.log('  - ' + a.join('  ==  ')));
