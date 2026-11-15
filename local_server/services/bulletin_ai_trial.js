'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai_trial.js
 * 역할  : 통보문 「참고사항」을 서버의 ChatGPT(codex_bridge)에 읽혀 정해진 칸으로 해석하게 하고,
 *         같은 통보문의 규칙 결과와 나란히 맞춰 보는 **시험**(표본 200건, 관리자가 버튼으로 시작·멈춤).
 *         실제 특보현황·푸시에는 아무것도 반영하지 않는다.
 * 사용자 확정:
 *   2026-11-12 「추후 참고사항 ai 호출적용할때 기존 참고사항 데이터를 ai에게 넣어서 어떻게 ai가 해석했는지 결과를 보는방안이 좋겠음」
 *   2026-11-15 「대표 표본 200건으로 확인해보자」 「이미 우리 앱은 서버에서 chat gpt가 돌아가도록 해놓았어 … 그것을 활용해봐」
 *              「통보문 관찰이라는 탭을 하나 더 두고」 「보내는 시각은 ㄱ(누르면 바로 시작)」
 * 원칙(analysis/bulletin_survey/README.md 「참고사항 AI 해석 — 계획」): AI 는 정해진 칸만 채운다. **해역을 펼치지 않는다** —
 *   원문 해역 표현을 그대로 옮기고, 펼치기는 규칙(lifecycle_check.expand)이 한다. 근거 문장은 원문에 그대로 있어야 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : analysis/bulletin_survey/ai_trial_sample.json(표본·규칙 결과 — ai_trial_build.js 가 만든다) ·
 *                   analysis/bulletin_survey/lifecycle_check.js(해역 펼치기) · services/codex_bridge(ChatGPT 줄 — 나리야·브리핑 AI 와 같은 줄)
 *  - 저장          : data/bulletin_ai_trial.json(진행·결과 — 서버가 다시 떠도 이어서)
 *  - 나를 쓰는 곳  : routes/bulletin_watch.js(관리자 시작·멈춤·상태·보고서) · 검사 test_bulletin_ai_trial
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_FILE = path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'ai_trial_sample.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'bulletin_ai_trial.json');
const KINDS = ['예비취소', '예비연장', '예비연기', '예비추가', '해제예고연장', '등급변경가능성', '특보발표가능성', '일부해제', '정확해제시각', '안내'];
const GAP_MS = 2000;               // 한 건 끝나고 다음 건까지 쉼(같은 줄을 쓰는 나리야가 끼어들 틈)
const MAX_FAIL_IN_ROW = 3;         // 연달아 3번 실패하면 멈춘다(작업자 끊김 등 — 200번 헛돌지 않게)

/**
 * AI 에 줄 지시문을 만든다(한 통보문당 한 번).
 * 예: buildPrompt({ office:'부산청', 종류:'예비특보', 발표:'2025-10-13 00:00', 본문:'o 없음', 참고사항:'o 당초 …해제하나 …' })
 * @param {object} item 표본 한 건
 * @returns {string}
 * [연계] ← runOne(이 파일)
 */
function buildPrompt(item) {
    return [
        '너는 기상청 해상 특보 통보문의 「참고사항」만 읽고 정해진 칸으로 옮기는 도우미다. 추측하지 마라.',
        '규칙:',
        '1) 참고사항에 실제로 적힌 것만 옮긴다. 적힌 게 없으면 사건을 빈 배열로 둔다.',
        '2) 해역 표현은 원문 글자를 그대로 복사한다(예: 「동해남부남쪽해상」 「제주도서부앞바다 중 북서연안바다」). 펼치거나 바꾸거나 새로 만들지 마라.',
        '3) 근거문장은 참고사항에서 한 글자도 바꾸지 않고 그대로 복사한다.',
        '4) 시간도 원문 표현 그대로(예: 「오늘(12일) 밤」 「13일 새벽(00~06시)」). 없으면 null.',
        `5) 종류는 다음 중 하나: ${KINDS.join(', ')}. 해상(바다) 특보가 아닌 것(강풍·호우·대설·육상 지역)은 옮기지 마라.`,
        '   예비취소=예비특보를 해제·취소함 / 예비연장=예비특보 시간을 뒤로 늘리거나 옮겨 다시 발표 / 예비연기=발표 시점을 늦춤 / 예비추가=예비특보 추가 발표',
        '   해제예고연장=특보 해제 예고 시각을 늦춤 / 등급변경가능성=주의보가 경보로 바뀔 가능성·시점 / 특보발표가능성=특보가 새로 발표될 가능성',
        '   일부해제=일부 구역만 해제 / 정확해제시각=○시를 기해 해제 같은 정확한 시각 / 안내=그 밖의 상태 정보(유의 당부만 있는 문장은 옮기지 마라)',
        '출력은 JSON 하나만: {"사건":[{"종류":"…","해역표현":"…","시간_전":"…또는 null","시간_후":"…또는 null","근거문장":"…"}],"요약":"한 문장"}',
        '',
        `[통보문] ${item.office} ${item.종류} ${item.호} (발표 ${item.발표})`,
        `[본문]\n${item.본문 || '(없음)'}`,
        `[참고사항]\n${item.참고사항 || '(없음)'}`,
    ].join('\n');
}

const norm = (s) => String(s || '').replace(/\s+/g, '');

/**
 * AI 가 적은 해역 표현을 규칙으로 펼친다(부모 해역 이름들). 못 펼치면 null.
 * 예: '동해중부앞바다(강원중부앞바다, 강원남부앞바다)' → ['강원중부앞바다','강원남부앞바다'] · '제주도서부앞바다 중 북서연안바다' → ['제주도서부앞바다'](자식은 그 부모로)
 *     · '동해중부먼바다' → 안쪽·바깥 두 곳(줄임 이름 규칙) · '동해남부남쪽해상' → null(못 읽음 — 보고서에 그대로 남긴다)
 * [연계] ← checkOne(이 파일) / → lifecycle_check.expand(규칙 — AI 는 펼치지 않는다)
 */
function resolveZones(expr) {
    const { expand, splitTop, PARENTS, childrenOf } = require('../analysis/bulletin_survey/lifecycle_check');
    const parentOf = (x) => (PARENTS.has(x) ? x : [...PARENTS].find((p) => childrenOf(p).includes(x)));
    // 「A 중 B」(띄어 쓴 「중」만 — 「동해중부」의 중은 아니다) → 「A(B)」
    let s = String(expr || '').replace(/\s+중\s+([^,，와과및]+)/g, '($1)');
    const out = new Set();
    for (const tok of splitTop(s.replace(/\s+/g, '').replace(/(바다|해상|구역|\))(와|과|및)/g, '$1,'))) {
        let u = expand(tok, []);
        if (!u) {
            // 줄임 이름(규칙): 「X먼바다」 = X안쪽먼바다+X바깥먼바다, 「X앞바다」 = X북부·중부·남부앞바다 — 목록에 있는 것만
            const base = tok.replace(/\(.*$/, '');
            const cand = /먼바다$/.test(base) ? ['안쪽먼바다', '바깥먼바다'].map((t) => base.replace(/먼바다$/, t))
                : /앞바다$/.test(base) ? ['북부앞바다', '중부앞바다', '남부앞바다'].map((t) => base.replace(/앞바다$/, t)) : [];
            const hit = cand.filter((c) => PARENTS.has(c));
            if (!hit.length) return null;
            u = new Set(hit);
        }
        for (const x of u) { const p = parentOf(x); if (p) out.add(p); }
    }
    return out.size ? [...out] : null;
}

/**
 * AI 답 한 건을 검산한다: ① JSON 꼴 ② 근거 문장이 원문에 있나 ③ 해역 표현을 규칙이 펼치나 ④ 규칙 결과(목록 비교)와 맞나.
 * @param {object} item 표본  @param {object|null} parsed AI 답(JSON)
 * @returns {{events:Array, 꼴:boolean, 근거있음:number, 근거없음:number, 해역못읽음:string[], 판정:Array<{종류,해역표현,판정,까닭}>, 규칙만:string[]}}
 * [연계] ← runOne · reportMarkdown(이 파일)
 */
function checkOne(item, parsed) {
    const res = { 꼴: false, 근거있음: 0, 근거없음: 0, 해역못읽음: [], 판정: [], 규칙만: [] };
    if (!parsed || !Array.isArray(parsed.사건)) return res;
    res.꼴 = true;
    const r = item.rule || {};
    const gone = new Set([...(r.빠짐 || []).map((x) => x.해역), ...(r.시간지나끝남 || []).filter((x) => !x.다시나옴.length).map((x) => x.해역)]);
    const moved = new Set([...(r.시간바뀜 || []).map((x) => x.해역), ...(r.시간지나끝남 || []).filter((x) => x.다시나옴.length).map((x) => x.해역)]);
    const added = new Set((r.새로 || []).map((x) => x.해역));
    const told = new Set();
    for (const e of parsed.사건) {
        if (norm(item.참고사항).includes(norm(e.근거문장)) && norm(e.근거문장)) res.근거있음++; else res.근거없음++;
        const zones = resolveZones(e.해역표현);
        if (!zones) { res.해역못읽음.push(e.해역표현); res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 판정: '해역 못 읽음', 까닭: '규칙이 이 해역 표현을 펼치지 못했다' }); continue; }
        zones.forEach((z) => told.add(z));
        const base = item.rpt === '7' && (e.종류 === '예비취소' ? gone : (e.종류 === '예비연장' || e.종류 === '예비연기') ? moved : e.종류 === '예비추가' ? added : null);
        if (!base) { res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 해역: zones, 판정: '비교 기준 없음', 까닭: '목록 비교로 확인할 수 있는 종류가 아니다' }); continue; }
        const hit = zones.filter((z) => base.has(z));
        res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 해역: zones, 판정: hit.length === zones.length ? '일치' : hit.length ? '일부 일치' : '불일치',
            까닭: hit.length === zones.length ? '규칙 목록 비교와 같다' : `규칙 목록 비교에 없는 해역: ${zones.filter((z) => !base.has(z)).join(', ')}` });
    }
    // 규칙은 바뀌었다고 하는데 AI 가 말하지 않은 해역(참고사항에 안 적혔을 수도 있다 — 참고로만)
    for (const z of [...gone, ...moved]) if (!told.has(z)) res.규칙만.push(z);
    return res;
}

/**
 * 시험 실행기를 만든다. 검사에서는 AI 호출·표본·저장 위치·시계를 바꿔 끼운다.
 * @param {{ai?: function(string): Promise<{success:boolean, response?:{text:string}, error?:string}>, sample?: Array, file?: string, now?: function(): number, sleep?: function(number): Promise<void>, gapMs?: number}} o
 * @returns {{start: function(): object, stop: function(): object, status: function(): object, results: function(): Array, done: function(): Promise<void>}}
 * [연계] ← module.exports(실제 codex_bridge) · test_bulletin_ai_trial
 */
function createTrial({ ai, sample, file = STATE_FILE, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
    const getSample = () => sample || (sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')));
    const callAi = ai || ((prompt) => require('./codex_bridge').callRaw({ contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'Bulletin-AI-Trial' }));
    let st = null, loop = null, stopAsked = false;
    const load = () => { if (st) return st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { st = { results: {} }; } st.status = st.status === 'running' ? 'stopped' : (st.status || 'idle'); return st; };
    const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st)); fs.renameSync(file + '.tmp', file); };

    async function runOne(item) {
        const t0 = now();
        let r; try { r = await callAi(buildPrompt(item)); } catch (e) { console.warn('[bulletin_ai_trial] AI 호출 실패', item.id, e && e.message); r = { success: false, error: String(e && e.message || e) }; }
        const rec = { at: new Date(t0).toISOString(), ms: now() - t0 };
        if (!r || !r.success) { rec.ok = false; rec.error = (r && r.error) || '응답 없음'; return rec; }
        rec.raw = String(r.response && r.response.text || '').slice(0, 6000);
        try { rec.parsed = JSON.parse(require('./codex_bridge').stripFence(rec.raw)); } catch (_) { rec.parsed = null; }
        rec.ok = !!rec.parsed;
        if (!rec.ok) rec.error = 'JSON 으로 읽을 수 없는 답';
        return rec;
    }

    async function run() {
        let failRow = 0;
        for (const item of getSample()) {
            if (stopAsked) break;
            if (st.results[item.id] && st.results[item.id].ok) continue;   // 끝난 건 건너뜀(멈춘 곳부터 이어서) — 실패한 건은 다시 시도
            const rec = await runOne(item);
            st.results[item.id] = rec; st.lastAt = rec.at; st.lastError = rec.ok ? null : rec.error;
            failRow = rec.ok ? 0 : failRow + 1;
            save();
            if (failRow >= MAX_FAIL_IN_ROW) { st.status = 'stopped'; st.stopReason = `연달아 ${failRow}번 실패 — 마지막: ${rec.error}`; save(); console.warn('[bulletin_ai_trial] 멈춤:', st.stopReason); return; }
            await sleep(gapMs);
        }
        const all = getSample().every((it) => st.results[it.id] && st.results[it.id].ok);
        st.status = stopAsked ? 'stopped' : (all ? 'done' : 'stopped');
        st.stopReason = stopAsked ? '관리자가 멈춤' : (all ? null : '일부 실패 — 다시 시작하면 실패한 건만 다시 한다');
        save();
    }

    function status() {
        load();
        const n = getSample().length, res = Object.values(st.results);
        return { status: st.status, total: n, done: res.filter((r) => r.ok).length, failed: res.filter((r) => !r.ok).length, lastAt: st.lastAt || null, lastError: st.lastError || null, stopReason: st.stopReason || null, startedAt: st.startedAt || null };
    }
    function start() {
        load();
        if (st.status === 'running') return status();
        stopAsked = false; st.status = 'running'; st.startedAt = st.startedAt || new Date(now()).toISOString(); st.stopReason = null; save();
        loop = run().catch((e) => { st.status = 'stopped'; st.stopReason = '오류: ' + (e && e.message); save(); console.warn('[bulletin_ai_trial] 오류:', e && e.message); });
        return status();
    }
    function stop() { load(); if (st.status === 'running') stopAsked = true; return status(); }
    const results = () => { load(); return getSample().map((item) => ({ item, rec: st.results[item.id] || null })); };
    return { start, stop, status, results, done: () => loop || Promise.resolve() };
}

/**
 * 시험 결과 보고서(마크다운): 요약 → 건마다 원문·규칙 결과·AI 해석·판정 → 부록(원본 JSON).
 * @param {Array<{item, rec}>} rows  @param {object} st status()
 * @returns {string}
 * [연계] ← routes/bulletin_watch GET /api/admin/bulletin-ai-trial/report.md
 */
function reportMarkdown(rows, st) {
    const done = rows.filter((x) => x.rec && x.rec.ok);
    const checks = done.map((x) => Object.assign({ x }, checkOne(x.item, x.rec.parsed)));
    const cnt = {}; let ev = 0, okEv = 0, badEv = 0; const unread = {};
    for (const c of checks) { for (const p of c.판정) cnt[p.판정] = (cnt[p.판정] || 0) + 1; ev += c.근거있음 + c.근거없음; okEv += c.근거있음; badEv += c.근거없음; for (const u of c.해역못읽음) unread[u] = (unread[u] || 0) + 1; }
    const ruleBlock = (r) => {
        if (!r) return '- (규칙 결과 없음)';
        if (r.항목) return r.항목.map((i) => `- ${i.종류} ${i.동작}: ${i.해역.join(', ') || '(바다 해역 없음)'}`).join('\n') || '- (변경 항목 없음)';
        const f = (a, g) => (a || []).map(g).join(' · ') || '없음';
        return [`- 빠짐(취소로 보임): ${f(r.빠짐, (x) => x.해역 + ' ' + x.시간창)}`, `- 시간 바뀜: ${f(r.시간바뀜, (x) => x.해역 + ' ' + x.전 + ' → ' + x.후.join('/'))}`,
            `- 새로: ${f(r.새로, (x) => x.해역 + ' ' + x.시간창)}`, `- 시간 지나 끝남: ${f(r.시간지나끝남, (x) => x.해역 + ' ' + x.시간창 + (x.다시나옴.length ? ' → 다시 ' + x.다시나옴.join('/') : ''))}`].join('\n');
    };
    const out = [
        '# 통보문 참고사항 AI 시험 결과', '',
        '서버의 ChatGPT 에 지난 통보문 참고사항(표본)을 읽혀 정해진 칸으로 옮기게 하고, 규칙(직전 예비 목록과 비교 등)과 맞춰 본 결과입니다. 실제 특보현황·푸시에는 반영하지 않았습니다.', '',
        '## 요약', '',
        `- 진행: ${st.done}/${st.total}건 끝남 · 실패 ${st.failed}건 · 상태 ${st.status}${st.stopReason ? ' (' + st.stopReason + ')' : ''}`,
        `- AI 가 뽑은 사건: ${ev}개 · 근거 문장이 원문에 그대로 있음 ${okEv}개 · **원문에 없음 ${badEv}개**(AI 가 문장을 바꾸거나 지어냄)`,
        `- 판정: ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`,
        `- 규칙이 못 읽은 해역 표현: ${Object.entries(unread).map(([k, v]) => `「${k}」×${v}`).join(', ') || '없음'}`, '',
        '판정 뜻 — 일치: 규칙의 목록 비교와 같다 / 불일치·일부 일치: AI 가 말한 해역이 규칙 결과에 없다 / 비교 기준 없음: 목록으로 확인할 수 없는 종류(가능성·해제예고 등) / 해역 못 읽음: 규칙이 그 표현을 펼치지 못함.', '',
        '## 건별', '',
    ];
    for (const { item, rec } of rows) {
        out.push(`### ${item.id}. ${item.office} ${item.종류} ${item.호} — 발표 ${item.발표}${item.특이 ? ' ★특이 사례' : ''} (분류 어림: ${item.분류어림})`, '');
        out.push('**참고사항 원문**', '', '> ' + String(item.참고사항 || '(없음)').replace(/\n/g, '\n> '), '');
        out.push('**규칙 결과**', '', ruleBlock(item.rule), '');
        if (!rec) { out.push('**AI**: 아직 안 함', ''); continue; }
        if (!rec.ok) { out.push(`**AI**: 실패 — ${rec.error}`, ''); continue; }
        const c = checkOne(item, rec.parsed);
        out.push(`**AI 해석** (${Math.round(rec.ms / 1000)}초) — ${rec.parsed.요약 || ''}`, '');
        if (!rec.parsed.사건.length) out.push('- (사건 없음)');
        rec.parsed.사건.forEach((e, i) => { const p = c.판정[i] || {}; out.push(`- [${e.종류}] 「${e.해역표현}」 ${e.시간_전 || ''}${e.시간_후 ? ' → ' + e.시간_후 : ''} — **${p.판정 || ''}**${p.까닭 ? ' (' + p.까닭 + ')' : ''}${norm(item.참고사항).includes(norm(e.근거문장)) ? '' : ' ⚠근거 문장이 원문에 없음'}`); });
        if (c.규칙만.length) out.push(`- (규칙은 바뀌었는데 AI 가 말하지 않은 해역: ${c.규칙만.join(', ')})`);
        out.push('');
    }
    out.push('## 부록: 원본(한 줄 = 한 건, JSON)', '', '```jsonl', ...rows.map(({ item, rec }) => JSON.stringify({ id: item.id, office: item.office, 호: item.호, 발표: item.발표, rec })), '```', '');
    return out.join('\n');
}

let real = null;
const getReal = () => (real = real || createTrial({}));
module.exports = {
    start: () => getReal().start(), stop: () => getReal().stop(), status: () => getReal().status(),
    report: () => reportMarkdown(getReal().results(), getReal().status()),
    createTrial, buildPrompt, checkOne, resolveZones, reportMarkdown, KINDS,
};
