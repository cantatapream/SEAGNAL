/**
 * 역할: 느린 요청 기록(services/slow_request_log.js)이 3초 넘는 요청만, 쿼리 없이, 붙잡는 요청은 빼고 남기는지 실제 HTTP 로 확인한다.
 * [연계] services/slow_request_log.js · config/server_config.js(등록 위치) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_slow_request_log.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const express = require('express');
const { slowRequestLog } = require('../services/slow_request_log');
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + e.message); } }
const assert = require('assert');

(async () => {
    const lines = [];
    const app = express();
    app.use(slowRequestLog({ thresholdMs: 200, log: (l) => lines.push(l) }));
    app.get('/fast', (req, res) => res.send('ok'));
    app.get('/slow', (req, res) => setTimeout(() => res.status(201).send('ok'), 260));
    app.post('/api/legal/codex/poll', (req, res) => setTimeout(() => res.status(204).end(), 260));
    app.get('/api/force-update/:type/stream', (req, res) => setTimeout(() => res.end(), 260));
    app.get('/hang', () => { /* 응답하지 않는다 — 클라이언트가 끊는 경우를 흉내 */ });
    const server = http.createServer(app).listen(0);
    const port = server.address().port;
    const call = (method, p, abortMs) => new Promise((resolve) => {
        const req = http.request({ port, path: p, method }, (res) => { res.resume(); res.on('end', resolve); });
        req.on('error', () => resolve());
        if (abortMs) setTimeout(() => { req.destroy(); setTimeout(resolve, 50); }, abortMs);
        req.end();
    });
    try {
        await test('빠른 요청은 남기지 않는다', async () => { await call('GET', '/fast'); assert.deepEqual(lines, []); });
        await test('느린 요청은 초·방법·경로·코드를 한 줄로, 쿼리는 빼고 남긴다', async () => {
            lines.length = 0; await call('GET', '/slow?serviceKey=SECRET&lat=35');
            assert.equal(lines.length, 1); assert.match(lines[0], /^\[slow\] 0\.\ds GET \/slow 201$/); assert.equal(lines[0].includes('SECRET'), false);
        });
        await test('나리야 VM 작업자 대기·SSE 진행 스트림은 느려도 남기지 않는다', async () => {
            lines.length = 0; await call('POST', '/api/legal/codex/poll'); await call('GET', '/api/force-update/buoys/stream'); assert.deepEqual(lines, []);
        });
        await test('응답 전에 끊긴 느린 요청은 「끊김」으로 남는다', async () => {
            lines.length = 0; await call('GET', '/hang', 300);
            assert.equal(lines.length, 1); assert.match(lines[0], /GET \/hang 끊김$/);
        });
        await test('서버 설정에 실제로 등록돼 있다(정적 파일·라우트보다 앞)', () => {
            const src = fs.readFileSync(path.join(__dirname, '..', 'config', 'server_config.js'), 'utf8');
            const at = src.indexOf('slowRequestLog()'), comp = src.indexOf('app.use(compression())');
            assert.ok(at > 0 && comp > 0 && at < comp, 'slowRequestLog 등록 위치');
        });
    } finally { server.close(); }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
