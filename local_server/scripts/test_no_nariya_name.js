/**
 * test_no_nariya_name.js — 옛 챗봇 이름이 화면·푸시·AI 지시문·AI 가 인용하는 위키에 다시 들어오지 않게 고정한다.
 * 실행: node local_server/scripts/test_no_nariya_name.js
 *
 * 사용자 확정(2026-11-20): 그 이름을 더 쓰지 않는다 — 부를 때는 「AI 챗봇」. (규칙·예외: CLAUDE.md 「★이름 규칙」)
 * 보는 곳: 코드 파일(화면·서버·앱·빌드 설정)과 법령 위키 본문(AI 답변에 그대로 인용된다).
 * 안 보는 곳: 문서(md)의 기록·인용, knowledge/phases 의 과거 평가 자료, 검토용 기록 html,
 *            영문 내부 이름(운영에 지장이 생겨 바꾸지 않았다).
 * 이 파일 안에도 그 이름을 통째로 적지 않는다(아래에서 조각을 이어 만든다) — 자기 자신에게 걸리지 않게.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NAME = ['나', '리', '야'].join('');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}

/** git 이 추적하는 파일 목록(한글 파일 이름도 그대로). */
function tracked(...specs) {
    const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '--', ...specs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter(Boolean);
}
/** 그 이름이 든 줄을 "파일:줄번호" 로 모은다. */
function hits(files) {
    const found = [];
    for (const f of files) {
        let text;
        try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }   // 지워진 파일(커밋 전) — 건너뛴다
        if (!text.includes(NAME)) continue;
        text.split('\n').forEach((l, i) => { if (l.includes(NAME)) found.push(f + ':' + (i + 1)); });
    }
    return found;
}

console.log('[1] 코드 파일 — 화면·서버·앱·빌드 설정');
const CODE_EXT = /\.(js|mjs|html|css|java|kt|xml|json|sh|yml|yaml|py|gradle|toml)$/;
const code = tracked('client', 'local_server/routes', 'local_server/services', 'local_server/scripts', 'local_server/config',
    'scripts', 'android', '.github', 'Dockerfile', '.gitignore', 'capacitor.config.json', 'fly.toml', 'package.json')
    .concat(tracked('local_server').filter((f) => /^local_server\/[^/]+$/.test(f)))   // local_server 바로 아래 파일(server.js·scheduler.js 등)
    .filter((f) => (CODE_EXT.test(f) || /(^|\/)(Dockerfile|\.gitignore)$/.test(f)) && !/^client\/assets\/vendor\//.test(f));
check('살필 코드 파일을 찾았다(0개면 검사가 아무것도 안 본 것이다)', code.length > 300, code.length);
const codeHits = hits(code);
check(`코드 파일에 옛 이름이 없다 (${code.length}개 파일)`, codeHits.length === 0, codeHits.slice(0, 15));

console.log('\n[2] 법령 위키 본문 — AI 답변에 그대로 인용된다');
const wiki = tracked('local_server/knowledge/legal/wiki').filter((f) => /\.md$/.test(f));
check('위키 파일을 찾았다', wiki.length > 100, wiki.length);
const wikiHits = hits(wiki);
check(`위키 본문에 옛 이름이 없다 (${wiki.length}개 파일)`, wikiHits.length === 0, wikiHits.slice(0, 15));

console.log('\n[3] AI 가 읽는 직군 지식 · 현재 규칙 문서');
const jik = tracked('local_server/knowledge/jikgun').filter((f) => /\.md$/.test(f) && !/_glossary_stt\.md$/.test(f));   // 용어 사전의 호출어 절은 "더 이상 쓰지 않음" 표시와 함께 기록으로 남겼다
check('직군 지식 문서에 옛 이름이 없다', hits(jik).length === 0, hits(jik).slice(0, 10));
const rules = ['local_server/knowledge/legal/_RULES.md', 'local_server/knowledge/legal/_CHATBOT.md', 'local_server/knowledge/legal/README.md',
    'local_server/knowledge/README.md', 'DEVELOPMENT_GUIDE.md', 'README.md', 'NOTICE.md'].filter((f) => fs.existsSync(path.join(ROOT, f)));
check('현재 규칙·안내 문서에 옛 이름이 없다', hits(rules).length === 0, hits(rules).slice(0, 10));

console.log('\n[4] 바꾸지 않기로 한 내부 이름은 그대로 있다(운영에 지장 — "정리"한다고 바꾸면 안 된다)');
const must = [
    ['client/js/ai-chat/ai_chat.js', "'nariya_history_v1'", '휴대폰에 저장된 지난 대화 기록 열쇠'],
    ['local_server/routes/legal.js', "'nariya_config.json'", '챗봇 공개 설정 파일'],
    ['local_server/services/nariya_autorun.js', "'nariya_autorun_state.json'", '자동 반영 상태 파일'],
    ['local_server/services/nariya_pr_merge.js', "'nariya_pr_state.json'", '자동 머지 상태 파일'],
    ['local_server/services/nariya_autorun.js', 'env.NARIYA_ROUTINE_FIRE_URL', '서버 비밀 값 이름'],
    ['local_server/services/nariya_pr_merge.js', "'nariya-run: '", '예약 세션과 주고받는 표식'],
    ['client/js/admin/admin.js', "id: 'nariya-chat'", '점검 기능 id'],
];
for (const [f, needle, what] of must) {
    let s = '';
    try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { s = ''; }
    check(`${what} — ${needle}`, s.includes(needle), f);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
