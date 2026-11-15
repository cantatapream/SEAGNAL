/**
 * ============================================================================
 * 파일명: local_server/routes/bulletin_watch.js
 * 역할  : 통보문 관찰기(services/bulletin_watch) 기록을 관리자가 내려받는 창구.
 *         한 파일(마크다운)에 쉬운 설명 줄과 원본(JSON 줄)을 함께 담아 사람·AI 가 모두 읽을 수 있게 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(기록 읽기) · services/bulletin_ai_trial(참고사항 AI 시험) · services/bulletin_status(통보문 기준 특보현황) ·
 *                   services/bulletin_compare(MMIS ↔ 통보문 비교) · services/admin_auth(관리자 확인)
 *  - 서버 API      : GET /api/admin/bulletin-watch/report.md?day=YYYY-MM-DD|all ·
 *                    GET /api/admin/bulletin-ai-trial(상태) · POST /api/admin/bulletin-ai-trial/start · POST /api/admin/bulletin-ai-trial/stop ·
 *                    GET /api/admin/bulletin-ai-trial/report.md — 모두 ?trial=1(1차 ChatGPT, 기본)|2(2차 클로드 키2) ·
 *                    GET·POST /api/admin/bulletin-ai/config(「AI 특보 분석」 순서 — services/bulletin_ai) ·
 *                    GET /api/admin/bulletin-status(통보문 기준 특보현황 — 메인 화면 [통보문]) · GET /api/admin/bulletin-compare/report.md(MMIS ↔ 통보문 비교)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : server.js(등록) · client/js/admin/admin_bulletin_watch.js(특보 관리 → 통보문 관찰 탭) · 검사 test_bulletin_watch·test_bulletin_ai_trial
 * [로드 순서] server.js 에서 routes/admin 보다 먼저 등록한다(자체 인증).
 * ============================================================================
 */
'use strict';
const express = require('express');
const adminAuth = require('../services/admin_auth');

const KIND_WORD = { new: '새 통보문', filled: '빈 통보문이 채워짐', detail_changed: '내용 바뀜', list_changed: '목록 글자 바뀜', gone: '목록에서 사라짐', error: '오류' };

/**
 * 기록(사건 배열)을 마크다운 보고서로 만든다.
 * 예: reportMarkdown([{ at:'2026-11-15T21:03:00.000Z', kind:'new', 설명:'…' }], 'all') → '# 통보문 관찰 기록 …'
 * @param {Array<object>} events  @param {string} day
 * @returns {string}
 * [연계] ← GET /api/admin/bulletin-watch/report.md
 */
function reportMarkdown(events, day) {
    const count = {}; for (const e of events) count[e.kind] = (count[e.kind] || 0) + 1;
    const filled = events.filter((e) => e.kind === 'filled');
    const emptyNew = events.filter((e) => e.kind === 'new' && e.empty);   // 관찰 시작 때 이미 빈 채로 있던 것도 센다(채워짐과 짝이 맞게)
    const base = events.filter((e) => e.baseline).length;
    const out = [
        `# 통보문 관찰 기록 (${day === 'all' ? '전체' : day})`, '',
        '방재기상플랫폼 특보·예비특보 통보문을 1분마다 보며 처음 보인 모습과 바뀐 모습을 남긴 기록입니다(시각은 KST). 관찰만 하고 앱 특보현황·푸시는 바꾸지 않습니다.', '',
        '## 요약', '',
        ...Object.keys(KIND_WORD).map((k) => `- ${KIND_WORD[k]}: ${k === 'new' ? (count[k] || 0) - base : (count[k] || 0)}건`),
        `- (관찰 시작 때 이미 있던 통보문: ${base}건 — 새 통보문에서 뺐다)`,
        `- 처음 볼 때 비어 있던 통보문: ${emptyNew.length}건 · 그중 채워진 것: ${filled.length}건` +
            (filled.length ? ` (채워지기까지 ${filled.map((e) => e.emptyMinutes + '분').join(', ')})` : ''), '',
        '## 사건 (쉬운 설명)', '',
        ...events.filter((e) => e.kind !== 'error').map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} [${KIND_WORD[e.kind] || e.kind}] ${e.설명 || ''}`),
        '', '## 오류', '',
        ...events.filter((e) => e.kind === 'error').map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} ${e.설명 || ''} — ${e.message || ''}`),
        '', '## 부록: 원본 기록(한 줄 = 한 사건, JSON)', '', '```jsonl', ...events.map((e) => JSON.stringify(e)), '```', '',
    ];
    return out.join('\n');
}

/**
 * 라우터를 만든다. 검사에서는 관찰기(watch)와 관리자 인증을 바꿔 끼운다.
 * 예: createRouter({ watch: { days: () => [], readDay: () => [] }, authorize: (q, s, n) => n() })
 * @returns {import('express').Router}
 * [연계] ← server.js / → services/bulletin_watch
 */
function createRouter({ bulletinAi = require('../services/bulletin_ai'), watch = require('../services/bulletin_watch'), trial = require('../services/bulletin_ai_trial'), status = require('../services/bulletin_status'), compare = require('../services/bulletin_compare'), authorize = adminAuth.requireAdminToken } = {}) {
    const router = express.Router();
    router.get('/api/admin/bulletin-watch/report.md', authorize, (req, res) => {
        const day = String(req.query.day || 'all');
        if (day !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ ok: false, error: 'day 는 YYYY-MM-DD 또는 all' });
        const days = day === 'all' ? watch.days() : [day];
        const events = days.flatMap((d) => watch.readDay(d));
        res.set('Content-Type', 'text/markdown; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="bulletin_watch_${day}.md"`);
        res.send(reportMarkdown(events, day));
    });
    // 참고사항 AI 시험(표본 200건) — 시작은 바로(사용자 확정 2026-11-15 「ㄱ」), 한 건씩 차례로. 특보현황·푸시에는 반영 안 함.
    // ?trial=1(1차 ChatGPT·200건, 기본) | 2(2차 클로드 키2·161건) — 2026-11-15
    const tid = (req) => { const t = String(req.query && req.query.trial || '1'); return ['1', '2', '3', '4'].includes(t) ? t : '1'; };   // 3 = 2025년 새 표현(2026-11-16) · 4 = 「AI 특보 분석」 설정 순서(2026-11-15)
    router.get('/api/admin/bulletin-ai-trial', authorize, (req, res) => res.json({ ok: true, trial: tid(req), ...trial.status(tid(req)) }));
    router.post('/api/admin/bulletin-ai-trial/start', authorize, (req, res) => res.json({ ok: true, trial: tid(req), ...trial.start(tid(req)) }));
    router.post('/api/admin/bulletin-ai-trial/stop', authorize, (req, res) => res.json({ ok: true, trial: tid(req), ...trial.stop(tid(req)) }));
    router.get('/api/admin/bulletin-ai-trial/report.md', authorize, (req, res) => {
        res.set('Content-Type', 'text/markdown; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="bulletin_ai_trial_${tid(req)}.md"`);
        res.send(trial.report(tid(req)));
    });
    // 「AI 특보 분석」 설정(관리자 센터 AI 탭) — 기능(read=특보 읽기·interpret=참고사항 해석)마다 AI 순서·칸별 모델·노력·ChatGPT 실행 위치.
    //   GET → { config:{read,interpret}, choices, workers(Fly·VM 연결) } · POST { feature, order?, removed?, models? } → 저장 후 같은 모양.
    const aiState = () => ({ ok: true, config: bulletinAi.getConfig(), choices: bulletinAi.choices(), workers: require('../services/codex_bridge').workers(),
        status: require('../services/llm_chain').status([]) });
    router.get('/api/admin/bulletin-ai/config', authorize, (req, res) => { res.set('Cache-Control', 'no-store'); res.json(aiState()); });
    router.post('/api/admin/bulletin-ai/config', authorize, (req, res) => {
        const b = req.body || {};
        const r = bulletinAi.setConfig(String(b.feature || ''), { order: b.order, removed: b.removed, models: b.models });
        if (!r.ok) return res.status(400).json(r);
        res.json(aiState());
    });
    // 통보문 기준 특보현황(관리자 메인 화면 [통보문] 버튼) — /api/weather-alerts 와 같은 모양(current 나무). 2026-11-16
    router.get('/api/admin/bulletin-status', authorize, (req, res) => {
        const s = status.read();
        if (!s) return res.status(503).json({ ok: false, error: '아직 계산 전 — 관찰기가 한 번 돈 뒤 다시' });
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, source: 'BULLETIN', updatedAt: s.updatedAt, bulletins: s.bulletins, waiting: s.waiting, current: s.current });
    });
    // MMIS ↔ 통보문 비교 보고서(마크다운) — ?day=YYYY-MM-DD|all
    router.get('/api/admin/bulletin-compare/report.md', authorize, (req, res) => {
        const day = String(req.query.day || 'all');
        if (day !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ ok: false, error: 'day 는 YYYY-MM-DD 또는 all' });
        const events = (day === 'all' ? compare.days() : [day]).flatMap((d) => compare.readDay(d));
        res.set('Content-Type', 'text/markdown; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="bulletin_compare_${day}.md"`);
        res.send(compare.reportMarkdown(events, day));
    });
    return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.reportMarkdown = reportMarkdown;
