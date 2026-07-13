/**
 * ============================================================================
 * 파일명: scripts/refactor/gen_readme.js
 * 역할  : [문서 생성 보조] 각 기능 폴더의 JS 파일 헤더에서 '역할:' 줄과
 *         최상위 함수 목록을 추출해, 폴더 README.md 초안을 생성한다.
 *         (초안일 뿐 — 사람/AI 검수로 데이터 흐름·주의사항을 보강한다: §9)
 * 사용  : node scripts/refactor/gen_readme.js [--write]
 *         --write 없으면 미리보기만, 있으면 각 폴더에 README.md 기록
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'client', 'js');
const WRITE = process.argv.includes('--write');

function roleOf(file) {
    const head = fs.readFileSync(file, 'utf8').split('\n').slice(0, 25);
    for (const l of head) {
        const m = l.match(/역할\s*[:：]\s*(.+)/);
        if (m) return m[1].trim().replace(/\*\/\s*$/, '').trim();
    }
    return '(역할 헤더 없음 — STEP 6 에서 작성 필요)';
}
function funcsOf(file) {
    const src = fs.readFileSync(file, 'utf8');
    const names = new Set();
    const re = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
    let m; while ((m = re.exec(src))) names.add(m[1]);
    const re2 = /^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/gm;
    while ((m = re2.exec(src))) names.add(m[1]);
    return [...names];
}

function listDirs(dir) {
    const out = [];
    (function rec(d) {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        const jsHere = entries.filter((e) => e.isFile() && e.name.endsWith('.js'));
        if (jsHere.length) out.push({ dir: d, files: jsHere.map((e) => path.join(d, e.name)) });
        for (const e of entries) if (e.isDirectory()) rec(path.join(d, e.name));
    })(dir);
    return out;
}

let count = 0;
for (const { dir, files } of listDirs(JS)) {
    const rel = path.relative(ROOT, dir);
    let md = `# ${path.basename(dir)}  \`${rel}/\`\n\n`;
    md += `> 이 폴더의 파일별 상세 설명은 각 \`<파일명>.guide.md\` 참고 (단일 파일이면 이 문서에 통합).\n> 이 초안은 파일 헤더의 \`역할:\` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.\n\n`;
    md += `## 파일 구성\n\n| 파일 | 역할 | 주요 함수 |\n|------|------|-----------|\n`;
    for (const f of files.sort()) {
        const fns = funcsOf(f).slice(0, 6);
        md += `| \`${path.basename(f)}\` | ${roleOf(f)} | ${fns.map((x) => '`' + x + '`').join(', ') || '—'} |\n`;
    }
    md += `\n## 로드 순서\n\nindex.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).\n`;
    if (WRITE) fs.writeFileSync(path.join(dir, 'README.md'), md);
    else console.log(`\n===== ${rel}/README.md =====\n` + md);
    count++;
}
console.log(`\n[gen_readme] ${WRITE ? '기록' : '미리보기'} 완료 — ${count}개 폴더`);
