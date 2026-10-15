/**
 * 역할: 운영 서버가 실제로 쓰는 외부 패키지가 **저장소 루트 package.json** 에 모두 들어 있는지 검사한다.
 *       운영 Docker 는 루트 package.json 만 설치하고(Dockerfile `COPY package.json` → `npm install`),
 *       CI 는 local_server/ 에서 `npm ci` 를 한다. 그래서 local_server/package.json 에만 넣은 패키지는
 *       시험은 통과하고 운영에서만 require 가 실패한다(2026-10-15 stream-json 누락 —
 *       운영 로그 「[startup] 위험예측 상태 감시 시작 실패」).
 * [연계] Dockerfile(설치 범위) · package.json(루트) · local_server 의 서버 코드(server.js·scheduler.js·
 *        루트 *.js·routes·services·advisory) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 서버 코드가 아니다 — 시험 스크립트(node local_server/scripts/test_root_deps.js).
 */
'use strict';
const fs = require('fs'), path = require('path'), { builtinModules } = require('module');
const ROOT = path.resolve(__dirname, '../..'), LS = path.join(ROOT, 'local_server');
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name + (detail ? ' — ' + detail : '')); } }

/**
 * 운영 서버로 실리는 JS 파일을 모은다(시험·도구·분석·지식 폴더는 운영 require 경로가 아니라 뺀다).
 * 예: local_server/server.js, local_server/services/risk_store.js
 * @returns {string[]} 절대 경로 목록 [연계] ← 아래 검사
 */
function serverFiles() {
  const out = fs.readdirSync(LS).filter(f => f.endsWith('.js')).map(f => path.join(LS, f));
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (e.name.endsWith('.js')) out.push(p); } };
  for (const d of ['routes', 'services', 'advisory']) if (fs.existsSync(path.join(LS, d))) walk(path.join(LS, d));
  return out;
}

/**
 * 파일 안의 require('패키지') 중 상대경로·내장모듈이 아닌 패키지 이름만 뽑는다.
 * 예: require('stream-json/Parser') → 'stream-json', require('@google/genai') → '@google/genai'
 * @param {string} src 파일 본문 @returns {string[]} 패키지 이름 [연계] ← 아래 검사
 */
function packagesIn(src) {
  const names = [];
  for (const m of src.matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
    const spec = m[1].replace(/^node:/, ''), parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (!builtinModules.includes(name)) names.push(name);
  }
  return names;
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set(Object.keys({ ...rootPkg.dependencies, ...rootPkg.optionalDependencies }));
const files = serverFiles();
ok('운영 서버 파일을 실제로 읽었다', files.length > 50, '파일 ' + files.length);
const missing = new Map();
for (const f of files) for (const n of packagesIn(fs.readFileSync(f, 'utf8'))) if (!declared.has(n)) {
  if (!missing.has(n)) missing.set(n, []);
  missing.get(n).push(path.relative(ROOT, f));
}
ok('★운영 서버가 require 하는 외부 패키지가 모두 루트 package.json dependencies 에 있다', missing.size === 0,
  [...missing].map(([n, fs_]) => n + ' ← ' + fs_.slice(0, 3).join(', ')).join(' | '));
ok('검사기 자체: scoped·하위경로·node: 접두를 패키지 이름으로 맞게 자른다',
  JSON.stringify(packagesIn("require('stream-json/Parser');require('@google/genai');require('node:fs');require('./x');require('path')")) === JSON.stringify(['stream-json', '@google/genai']));
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
