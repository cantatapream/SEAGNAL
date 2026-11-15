/**
 * ============================================================================
 * 파일명: local_server/routes/bulletin_watch.js
 * 역할  : 통보문 관찰기(services/bulletin_watch) 기록을 관리자가 내려받는 창구.
 *         한 파일(마크다운)에 쉬운 설명 줄과 원본(JSON 줄)을 함께 담아 사람·AI 가 모두 읽을 수 있게 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(기록 읽기) · services/admin_auth(관리자 확인)
 *  - 서버 API      : GET /api/admin/bulletin-watch/report.md?day=YYYY-MM-DD|all
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : server.js(등록) · client/js/admin/admin_kakao_relay.js(「통보문 관찰기록」 버튼) · 검사 test_bulletin_watch
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
function createRouter({ watch = require('../services/bulletin_watch'), authorize = adminAuth.requireAdminToken } = {}) {
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
    return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.reportMarkdown = reportMarkdown;
