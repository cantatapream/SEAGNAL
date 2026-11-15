/**
 * ============================================================================
 * 파일명: local_server/scripts/test_bulletin_ai_ui.js
 * 역할  : 관리자 「AI 모델 설정」 탭(client/js/admin/admin_bulletin_ai.js)의 기능별 AI 순서 목록을 실제 Chromium 으로 그려 본다 —
 *         특히 ③ 연안 안전 브리핑(설계서 §11.10.51, 2026-11-16 사용자 「① 특보 통보문 읽기에 해당하는 리스트와 같이 … 그 탭으로 넣어줘」 ·
 *         다시 시도 「(나)」 줄마다 횟수 · 처음 순서 「클로드 2번, 클로드 1번, 업스테이지, gpt, gemini」).
 *         서버는 띄우지 않는다 — 화면이 부르는 GET·POST /api/admin/bulletin-ai/config 를 page.route 로 받아 **실제 services/bulletin_ai.js**(임시 설정 파일)에 넘긴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : client/js/admin/admin_bulletin_ai.js · services/bulletin_ai.js(getConfig·setConfig·choices) · playwright(전역 — NODE_PATH)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 실행: NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_bulletin_ai_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-ui-'));
process.env.BULLETIN_AI_CONFIG_FILE = path.join(tmp, 'cfg.json');
const bai = require('../services/bulletin_ai');
const { chromium } = require('playwright');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }
const state = () => ({ ok: true, config: bai.getConfig(), choices: bai.choices(), workers: { fly: true, vm: false }, status: [{ id: 'claude2', hasKey: false }, { id: 'claude1', hasKey: true }, { id: 'upstage', hasKey: true }] });

(async () => {
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
    const posts = [];
    page.on('dialog', (d) => d.accept());
    await page.route('**/api/admin/bulletin-ai/config', async (r) => {
        if (r.request().method() === 'POST') {
            const b = JSON.parse(r.request().postData() || '{}'); posts.push(b);
            const x = bai.setConfig(b.feature, { order: b.order, removed: b.removed, models: b.models, attempts: b.attempts });
            return r.fulfill({ status: x.ok ? 200 : 400, contentType: 'application/json', body: JSON.stringify(x.ok ? state() : x) });
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state()) });
    });
    await page.route('http://t/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="background:#0f172a"><div id="host"></div></body>' }));
    await page.goto('http://t/');
    await page.addScriptTag({ path: path.join(__dirname, '../../client/js/admin/admin_bulletin_ai.js') });
    const draw = async () => { await page.evaluate(() => window.renderBulletinAiAdmin(document.getElementById('host'))); await page.waitForSelector('[data-bai-feature="briefing"]'); };
    const rows = (f) => page.$$eval('[data-bai-feature="' + f + '"] > div', (ds) => ds.filter((d) => /^\d+$/.test((d.firstChild && d.firstChild.textContent) || '')).map((d) => d.children[1].textContent));
    const settle = () => page.waitForFunction(() => document.querySelector('#host > div:last-child') && document.querySelector('#host > div:last-child').style.opacity === '');
    await draw();

    await check('[§11.10.51-UI-1] ③ 연안 안전 브리핑 카드 — ①·② 다음 · 처음 순서 클로드 키2→키1→업스테이지→ChatGPT→Gemini · 맨 아래 「규칙 분석(고정)」 줄은 ③ 에만', async () => {
        const feats = await page.$$eval('[data-bai-feature]', (cs) => cs.map((c) => c.getAttribute('data-bai-feature')));
        assert.deepStrictEqual(feats, ['read', 'interpret', 'briefing']);
        assert.deepStrictEqual(await rows('briefing'), ['클로드 키2', '클로드 키1', '업스테이지', 'ChatGPT', 'Gemini']);
        assert.ok(await page.$('[data-bai-feature="briefing"] [data-bai-rule]')); assert.equal(await page.$('[data-bai-feature="read"] [data-bai-rule]'), null);
        assert.ok(/③ 연안 안전 브리핑/.test(await page.textContent('[data-bai-feature="briefing"]')));
    });
    await check('[§11.10.51-UI-2] 칸별 시도 횟수 고르기(③ 에만) — 기본 ChatGPT 최대 3번·나머지 1번 · 바꾸면 그 칸만 저장(POST attempts)·다시 그림', async () => {
        const vals = await page.$$eval('[data-bai-feature="briefing"] [data-bai-attempts]', (ss) => ss.map((s) => s.getAttribute('data-bai-attempts') + ':' + s.value));
        assert.deepStrictEqual(vals, ['claude2:1', 'claude1:1', 'upstage:1', 'chatgpt:3', 'gemini:1']);
        assert.equal((await page.$$('[data-bai-feature="read"] [data-bai-attempts]')).length, 0, '①에는 시도 칸 없음');
        await page.selectOption('[data-bai-feature="briefing"] [data-bai-attempts="claude2"]', '2'); await settle();
        assert.deepStrictEqual(posts[posts.length - 1], { feature: 'briefing', attempts: { claude2: 2 } });
        assert.equal(await page.$eval('[data-bai-feature="briefing"] [data-bai-attempts="claude2"]', (s) => s.value), '2'); assert.equal(bai.getConfig().briefing.attempts.claude2, 2);
    });
    await check('[§11.10.51-UI-3] Gemini 모델은 ③ 에서만 고름(①·②는 「(고정)」 표시) · 키 없는 칸은 「키 없음 · 건너뜀」', async () => {
        const gRow = await page.$$('[data-bai-feature="briefing"] > div');
        const gem = await page.evaluateHandle(() => [...document.querySelectorAll('[data-bai-feature="briefing"] > div')].find((d) => d.children[1] && d.children[1].textContent === 'Gemini'));
        assert.ok(gRow.length > 0);
        const opts = await gem.evaluate((d) => [...d.querySelectorAll('select')].filter((s) => !s.hasAttribute('data-bai-attempts')).map((s) => [...s.options].map((o) => o.value).join(',')));
        assert.deepStrictEqual(opts, ['gemini-2.5-flash,gemini-2.5-flash-lite']);
        await gem.evaluate((d) => { const s = [...d.querySelectorAll('select')].find((x) => !x.hasAttribute('data-bai-attempts')); s.value = 'gemini-2.5-flash-lite'; s.dispatchEvent(new Event('change')); }); await settle();
        assert.deepStrictEqual(posts[posts.length - 1], { feature: 'briefing', models: { gemini: { model: 'gemini-2.5-flash-lite' } } });
        assert.ok(/\(고정\)/.test(await page.textContent('[data-bai-feature="read"]')));
        assert.ok(/키 없음 · 건너뜀/.test(await page.textContent('[data-bai-feature="briefing"]')), '클로드 키2 키 없음 표시');
    });
    await check('[§11.10.51-UI-4] 순서 바꾸기·삭제·다시 추가(③) — 서버에 저장되고 briefingChain 에 반영 · Gemini 는 삭제 버튼 없음', async () => {
        await page.evaluate(() => [...document.querySelectorAll('[data-bai-feature="briefing"] > div')].find((d) => d.children[1] && d.children[1].textContent === 'ChatGPT').querySelectorAll('button')[0].click()); await settle();
        assert.deepStrictEqual(await rows('briefing'), ['클로드 키2', '클로드 키1', 'ChatGPT', '업스테이지', 'Gemini']);
        await page.evaluate(() => [...[...document.querySelectorAll('[data-bai-feature="briefing"] > div')].find((d) => d.children[1] && d.children[1].textContent === '클로드 키1').querySelectorAll('button')].find((b) => b.textContent === '삭제').click()); await settle();
        assert.deepStrictEqual(bai.briefingChain().map((c) => c.id), ['claude2', 'chatgpt', 'upstage', 'gemini']);
        assert.ok(/클로드 키1 다시 추가/.test(await page.textContent('[data-bai-feature="briefing"]')));
        const gemBtns = await page.evaluate(() => [...[...document.querySelectorAll('[data-bai-feature="briefing"] > div')].find((d) => d.children[1] && d.children[1].textContent === 'Gemini').querySelectorAll('button')].map((b) => b.textContent));
        assert.ok(!gemBtns.includes('삭제'));
        await page.evaluate(() => [...document.querySelectorAll('[data-bai-feature="briefing"] button')].find((b) => b.textContent === '클로드 키1 다시 추가').click()); await settle();
        assert.deepStrictEqual(await rows('briefing'), ['클로드 키2', 'ChatGPT', '업스테이지', '클로드 키1', 'Gemini'], 'Gemini 바로 앞에 다시');
    });

    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
