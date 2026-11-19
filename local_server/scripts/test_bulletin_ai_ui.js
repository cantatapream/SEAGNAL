/**
 * ============================================================================
 * 파일명: local_server/scripts/test_bulletin_ai_ui.js
 * 역할  : 관리자 「AI 모델 설정」 탭(client/js/admin/admin_bulletin_ai.js)의 기능별 AI 순서 목록을 실제 Chromium 으로 그려 본다 —
 *         특히 ④ 연안 안전 브리핑(설계서 §11.10.51, 2026-11-16 사용자 「① 특보 통보문 읽기에 해당하는 리스트와 같이 … 그 탭으로 넣어줘」 ·
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
let gemmaState = {};   // 기능별 마지막 Gemma 결과(서버 GET 의 gemma 칸)
const state = () => ({ ok: true, config: bai.getConfig(), choices: bai.choices(), workers: { fly: true, vm: false }, status: [{ id: 'claude2', hasKey: false }, { id: 'claude1', hasKey: true }, { id: 'upstage', hasKey: true }], gemma: gemmaState });

(async () => {
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
    const posts = [];
    page.on('dialog', (d) => d.accept());
    await page.route('**/api/admin/bulletin-ai/config', async (r) => {
        if (r.request().method() === 'POST') {
            const b = JSON.parse(r.request().postData() || '{}'); posts.push(b);
            const x = bai.setConfig(b.feature, { order: b.order, removed: b.removed, models: b.models, attempts: b.attempts, gemma: b.gemma });
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

    await check('[§11.10.51-UI-1] ④ 연안 안전 브리핑 카드 — ①·②·③ 다음 · 처음 순서 클로드 키2→키1→업스테이지→ChatGPT→Gemini · 맨 아래 「규칙 분석(고정)」 줄은 ③ 에만', async () => {
        const feats = await page.$$eval('[data-bai-feature]', (cs) => cs.map((c) => c.getAttribute('data-bai-feature')));
        assert.deepStrictEqual(feats, ['read', 'interpret', 'forecast', 'briefing', 'escalation']);   // ⑤ 격상 가능성 읽기(2026-11-19) — ④ 다음
        assert.ok(/⑤ 격상 가능성 읽기/.test(await page.textContent('[data-bai-feature="escalation"]')));
        assert.deepStrictEqual(await rows('escalation'), ['Gemini'], '⑤ 기본은 Gemini 만(다른 AI 는 「다시 추가」 해야 쓰인다)');
        assert.deepStrictEqual(await rows('briefing'), ['클로드 키2', '클로드 키1', '업스테이지', 'ChatGPT', 'Gemini']);
        assert.ok(await page.$('[data-bai-feature="briefing"] [data-bai-rule]')); assert.equal(await page.$('[data-bai-feature="read"] [data-bai-rule]'), null);
        assert.ok(/④ 연안 안전 브리핑/.test(await page.textContent('[data-bai-feature="briefing"]')));
    });
    await check('[§11.10.51-UI-2] 칸별 시도 횟수 고르기(④ 에만) — 기본 ChatGPT 최대 3번·나머지 1번 · 바꾸면 그 칸만 저장(POST attempts)·다시 그림', async () => {
        const vals = await page.$$eval('[data-bai-feature="briefing"] [data-bai-attempts]', (ss) => ss.map((s) => s.getAttribute('data-bai-attempts') + ':' + s.value));
        assert.deepStrictEqual(vals, ['claude2:1', 'claude1:1', 'upstage:1', 'chatgpt:3', 'gemini:1']);
        assert.equal((await page.$$('[data-bai-feature="read"] [data-bai-attempts]')).length, 0, '①에는 시도 칸 없음');
        await page.selectOption('[data-bai-feature="briefing"] [data-bai-attempts="claude2"]', '2'); await settle();
        assert.deepStrictEqual(posts[posts.length - 1], { feature: 'briefing', attempts: { claude2: 2 } });
        assert.equal(await page.$eval('[data-bai-feature="briefing"] [data-bai-attempts="claude2"]', (s) => s.value), '2'); assert.equal(bai.getConfig().briefing.attempts.claude2, 2);
    });
    await check('[§11.10.51-UI-3] Gemini 모델은 ④ 에서만 고름(①·②는 「(고정)」 표시) · 키 없는 칸은 「키 없음 · 건너뜀」', async () => {
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
    await check('[§11.10.51-UI-4] 순서 바꾸기·삭제·다시 추가(④) — 서버에 저장되고 briefingChain 에 반영 · Gemini 는 삭제 버튼 없음', async () => {
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

    // Gemma(2026-11-19 사용자 「젬마가 색칠하는 기능을 넣자 격상읽기는 하지말고 … 문제가 있다면 그때 내가 선택한 api가 호출하여 색칠하도록 하자」) — ③ 색칠 칸 맨 위 「먼저 Gemma」 줄
    const tries = []; let tryAnswer = (m) => ({ ok: true, model: m, ms: 812, text: '{"해역":"동해중부먼바다","시점":"오늘 밤부터"}' });
    await page.route('**/api/admin/bulletin-ai/try-model', async (r) => { const b = JSON.parse(r.request().postData() || '{}'); tries.push(b); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tryAnswer(b.model)) }); });
    await check('[Gemma-UI-1] ③ 색칠 칸 맨 위에만 「먼저 Gemma」 줄 — 쓰지 않음(기본)·Gemma 두 모델 · 순서 목록은 그대로 · 고르면 그 칸만 저장 · ①②④⑤ 에는 없다', async () => {
        const opts = await page.$eval('[data-bai-gemma="forecast"]', (x) => [...x.options].map((o) => o.value + '|' + o.textContent + '|' + o.selected));
        assert.deepStrictEqual(opts, ['|쓰지 않음|true', 'gemma-4-26b-a4b-it|gemma-4-26b-a4b-it|false', 'gemma-4-31b-it|gemma-4-31b-it|false']);
        for (const f of ['read', 'interpret', 'briefing', 'escalation']) assert.equal(await page.$('[data-bai-feature="' + f + '"] [data-bai-gemma]'), null, f);
        assert.ok(/\(고정\)/.test(await page.textContent('[data-bai-feature="escalation"]')), '⑤ 의 Gemini 칸은 종전처럼 고정 표시');
        assert.ok(/\(고정\)/.test(await page.textContent('[data-bai-feature="forecast"]')), '③ 의 Gemini 칸도 고정 표시(Gemma 는 따로 맨 위 줄)');
        assert.ok(/Gemma 가 색칠하지 못하면\(오류·한도 초과·수요 과다·못 쓰는 답\) 아래 순서대로 이어서 부릅니다/.test(await page.textContent('[data-bai-gemma-row="forecast"]')));
        const first = await page.$eval('[data-bai-feature="forecast"]', (c) => [...c.children].findIndex((d) => d.hasAttribute('data-bai-gemma-row')) < [...c.children].findIndex((d) => /^\d+$/.test((d.firstChild && d.firstChild.textContent) || '')));
        assert.ok(first, '「먼저 Gemma」 줄이 순서 목록보다 위');
        const before = await rows('forecast');
        await page.selectOption('[data-bai-gemma="forecast"]', 'gemma-4-26b-a4b-it'); await settle();
        assert.deepStrictEqual(posts[posts.length - 1], { feature: 'forecast', gemma: 'gemma-4-26b-a4b-it' });
        assert.equal(await page.$eval('[data-bai-gemma="forecast"]', (x) => x.value), 'gemma-4-26b-a4b-it');
        assert.equal(bai.getConfig().forecast.gemma, 'gemma-4-26b-a4b-it');
        assert.deepStrictEqual(await rows('forecast'), before, '순서 목록은 그대로');
    });
    await check('[Gemma-UI-2] 「시험 호출」 — 지금 화면에 고른 모델을 불러 결과를 그 줄 아래에 보인다(성공 초록·실패 붉게) · 설정은 안 바뀐다 · 고른 직후에도 지금 값', async () => {
        const n = posts.length;
        await page.click('[data-bai-try="forecast"]');
        await page.waitForFunction(() => /시험 성공/.test(document.querySelector('[data-bai-try-out="forecast"]').textContent));
        assert.deepStrictEqual(tries[tries.length - 1], { model: 'gemma-4-26b-a4b-it' });
        assert.ok(/시험 성공 812ms · gemma-4-26b-a4b-it — \{"해역":"동해중부먼바다"/.test(await page.textContent('[data-bai-try-out="forecast"]')));
        tryAnswer = (m) => ({ ok: false, model: m, ms: 90, error: '503 This model is currently experiencing high demand' });
        // 저장 응답이 오기 전에(다시 그려지기 전) 다른 모델로 바꾸고 바로 누른다 — 화면에 고른 값을 불러야 한다(별도 에이전트 검토)
        await page.evaluate(() => { const s = document.querySelector('[data-bai-gemma="forecast"]'); s.value = 'gemma-4-31b-it'; document.querySelector('[data-bai-try="forecast"]').click(); });
        await page.waitForFunction(() => /시험 실패/.test(document.querySelector('[data-bai-try-out="forecast"]').textContent));
        assert.deepStrictEqual(tries[tries.length - 1], { model: 'gemma-4-31b-it' });
        assert.ok(/시험 실패 · gemma-4-31b-it — 503 This model is currently experiencing high demand/.test(await page.textContent('[data-bai-try-out="forecast"]')));
        assert.equal(posts.length, n, '시험 호출은 설정을 저장하지 않는다');
        await page.selectOption('[data-bai-gemma="forecast"]', ''); await settle();
        tryAnswer = (m) => ({ ok: true, model: m, ms: 5, text: '{}' });
        await page.click('[data-bai-try="forecast"]');
        await page.waitForFunction(() => /시험 성공/.test(document.querySelector('[data-bai-try-out="forecast"]').textContent));
        assert.deepStrictEqual(tries[tries.length - 1], { model: 'gemini-2.5-flash-lite' }, '「쓰지 않음」이면 기본 Gemini 모델을 부른다(그 모델이 아직 불리는지 볼 때)');
    });
    await check('[Gemma-UI-3] 운영 중 Gemma 가 색칠하지 못해 다음 AI 가 대신했으면 그 줄에 붉게 보인다(조용히 대신하면 고장이 안 보인다) · 날짜와 누적 횟수 · 성공이면 초록(실패가 섞였으면 노랑) · 기록 없음 안내', async () => {
        await page.selectOption('[data-bai-gemma="forecast"]', 'gemma-4-26b-a4b-it'); await settle();
        assert.ok(/Gemma 를 골랐지만 서버를 올린 뒤 아직 부른 기록이 없습니다/.test(await page.textContent('[data-bai-try-out="forecast"]')), '기록이 없으면 「이상 없음」처럼 비워 두지 않는다');
        gemmaState = { forecast: { at: Date.parse('2026-11-19T04:41:00+09:00'), model: 'gemma-4-26b-a4b-it', ok: false, error: '503 This model is currently experiencing high demand', okCount: 3, failCount: 2 } };
        await draw();
        const f = await page.textContent('[data-bai-try-out="forecast"]');
        assert.ok(/마지막 Gemma 색칠 실패\(.+\) → 아래 순서의 AI 가 대신 색칠함 — 503 This model/.test(f), f);
        assert.ok(/11\. 1[89]\./.test(f), '날짜도 보인다(시각만 보이면 며칠 전 실패가 오늘 일처럼 읽힌다 — 검사 브라우저의 시간대에 따라 18일·19일): ' + f);
        assert.ok(/서버를 올린 뒤 성공 3 · 실패 2/.test(f), f);
        gemmaState = { forecast: { at: Date.parse('2026-11-19T05:00:00+09:00'), model: 'gemma-4-26b-a4b-it', ok: true, error: null, okCount: 4, failCount: 2 } };
        await draw();
        assert.ok(/마지막 Gemma 색칠 성공\(.+\) · gemma-4-26b-a4b-it · 서버를 올린 뒤 성공 4 · 실패 2/.test(await page.textContent('[data-bai-try-out="forecast"]')));
    });

    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
