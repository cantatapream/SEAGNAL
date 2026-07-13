/**
 * ============================================================================
 * 파일명: scripts/refactor/gen_architecture.js
 * 역할  : [설계도면 생성] 실제 js/ 폴더 구조와 각 파일의 역할: 헤더를 읽어
 *         저장소 루트 ARCHITECTURE.md 의 "전체 구조 도면"과 "파일 인덱스"를
 *         자동 생성한다. (§12) — 도면과 코드가 어긋나지 않게.
 * 사용  : node scripts/refactor/gen_architecture.js > ARCHITECTURE.md
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'local_server', 'js');

function roleOf(file) {
    const head = fs.readFileSync(file, 'utf8').split('\n').slice(0, 30);
    // ① "역할: ..." (콜론 스타일 — 같은 줄, 없으면 다음 줄)
    for (let i = 0; i < head.length; i++) {
        const m = head[i].match(/역할\s*[:：]\s*(.*)/);
        if (m) {
            let txt = m[1].trim();
            if (!txt) {
                for (let j = i + 1; j < head.length; j++) {
                    const t = head[j].replace(/^[\s*/]+/, '').trim();
                    if (t) { txt = t; break; }
                }
            }
            if (txt) return txt.replace(/\*\/\s*$/, '').trim().slice(0, 70);
        }
    }
    // ② "[역할] ..." 같은 줄, 또는 "[역할]" 다음 줄에 설명 (대괄호 스타일)
    for (let i = 0; i < head.length; i++) {
        const m = head[i].match(/\[역할\]\s*(.*)/);
        if (m) {
            let txt = m[1].trim();
            if (!txt) { // 다음 줄에서 설명 찾기
                for (let j = i + 1; j < head.length; j++) {
                    const t = head[j].replace(/^[\s*/]+/, '').trim();
                    if (t) { txt = t; break; }
                }
            }
            if (txt) return txt.replace(/\*\/\s*$/, '').trim().slice(0, 70);
        }
    }
    // ③ 제목 줄 "파일명.js — 설명"
    for (const l of head) {
        const m = l.match(/\.js\s*[—-]\s*(.+)/);
        if (m && m[1].trim()) return m[1].trim().replace(/\*\/\s*$/, '').trim().slice(0, 70);
    }
    return '(역할 헤더 미작성 — STEP 6 대상)';
}

// 탭/기능 그룹 한국어 라벨
const LABELS = {
    'core': '앱 구동(부트스트랩·설정·네이티브 브리지)',
    'shared': '공용 재료(유틸·UI·데이터)',
    'forecast': '[탭1] 특보 및 전망',
    'ocean-map': '[탭2] 해양종합정보',
    'marine-life': '[탭3] 해양생활',
    'notice': '[탭4] 공지사항',
    'push': '⚡ 푸시 알림', 'location-alert': '⚡ 위치기반 경보', 'typhoon': '⚡ 태풍',
    'assistant': '⚡ AI 음성비서', 'settings': '⚡ 설정', 'engagement': '⚡ 제보·설문',
    'admin': '⚡ 관리자 센터',
};

function tree(dir, prefix = '') {
    let out = '';
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.name !== 'README.md' && !e.name.endsWith('.guide.md') && !e.name.endsWith('.design.md'))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    entries.forEach((e, i) => {
        const last = i === entries.length - 1;
        const branch = last ? '└── ' : '├── ';
        if (e.isDirectory()) {
            const rel = path.relative(JS, path.join(dir, e.name));
            const top = rel.split('/')[0];
            const label = dir === JS && LABELS[e.name] ? '  ← ' + LABELS[e.name] : '';
            out += prefix + branch + e.name + '/' + label + '\n';
            out += tree(path.join(dir, e.name), prefix + (last ? '    ' : '│   '));
        } else if (e.name.endsWith('.js')) {
            out += prefix + branch + e.name + '\n';
        }
    });
    return out;
}

function indexTables(dir) {
    let out = '';
    function rec(d) {
        const files = fs.readdirSync(d, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => path.join(d, e.name));
        if (files.length) {
            out += `\n### \`${path.relative(ROOT, d)}/\`\n\n| 파일 | 역할 |\n|------|------|\n`;
            for (const f of files.sort()) out += `| \`${path.basename(f)}\` | ${roleOf(f)} |\n`;
        }
        fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory())
            .forEach((e) => rec(path.join(d, e.name)));
    }
    rec(dir);
    return out;
}

const jsCount = require('child_process').execSync(`find ${JS} -name '*.js' | wc -l`).toString().trim();

process.stdout.write(`# SEAGNAL 설계도면 (ARCHITECTURE)

> 이 문서 하나로 앱의 전체 구조·중점 원칙·각 파일의 특징을 파악할 수 있습니다.
> 자동 생성: \`node scripts/refactor/gen_architecture.js > ARCHITECTURE.md\` (구조 변경 시 재생성)
> 마지막 생성 기준: 프론트 JS ${jsCount}개 · 코드 추가·수정 규칙은 \`DEVELOPMENT_GUIDE.md\` 참고.

---

## 1. 이 앱은 무엇인가

SEAGNAL(바다날씨)은 해양 기상특보·해양종합정보·해양생활·공지를 제공하는
**하이브리드 모바일 앱**(Capacitor + 웹)입니다. 하단 4개 메인탭으로 구성됩니다:
특보 및 전망 · 해양종합정보 · 해양생활 · 공지사항.

## 2. 설계 중점 사항 (5원칙)

1. **3분리**: \`client/\`(브라우저) · \`server/\`(Node) · \`android/·ios/\`(네이티브 셸).
   ※ 현재는 client 가 \`local_server/\` 안에 있으며 STEP 7 에서 분리 예정.
2. **client 3계층**: \`core/\`(구동) · \`shared/\`(공용) · \`features/\`(기능).
   판단 — 없으면 앱이 안 뜨면 core, 여럿이 쓰면 shared, 하나의 기능이면 features.
3. **기능 폴더 = 자기완결 단위**: 코드 + README + (필요 시) guide/design 콜로케이션.
4. **문서 3종**: \`README.md\`(개요) · \`<파일>.guide.md\`(설명서) · \`<주제>.design.md\`(설계배경).
5. **주석 표준**: 파일 헤더(역할 + [연계] 4종 + 로드순서) + 함수 주석(설명+예시+연계).

## 3. 전체 구조 도면 (프론트 js/)

\`\`\`
local_server/js/
${tree(JS).trimEnd()}
\`\`\`

## 4. 전체 파일 인덱스

> "역할" 문구는 각 파일 헤더의 \`역할:\` 첫 줄과 동일 — 코드와 도면이 어긋나면 check_headers 가 잡음.
${indexTables(JS)}

## 5. 서버 구조 (요약)

- \`local_server/routes/\` (31) — Express API 라우트
- \`local_server/services/\` (35) — 서버 서비스(캐시·푸시·수집 등)
- \`local_server/advisory/\` — 특보 예측 엔진
- \`local_server/scheduler.js\` — 크롤러·수집 스케줄러
- 상세 분리(client/server, jobs/)는 STEP 7 에서 진행.

## 6. 규칙 문서

- 코드 추가·수정 규칙: \`DEVELOPMENT_GUIDE.md\` (루트)
- 리팩토링 계획 전문: \`00_docs/REFACTORING_PROPOSAL_STRUCTURE.md\`
- 데드코드 판정: \`docs/project/refactoring/DEADCODE_REPORT.md\`
- 검증 도구: \`scripts/refactor/\` (verify_all.sh 로 일괄 실행)

## 7. 갱신 규칙

파일을 추가·삭제·이동하면 이 도면을 재생성하고(§위 명령), 같은 커밋에 포함합니다.
파일 역할이 바뀌면 헤더 \`역할:\` 을 고치면 인덱스도 자동 반영됩니다.
`);
