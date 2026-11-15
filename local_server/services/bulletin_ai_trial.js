'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai_trial.js
 * 역할  : 통보문 「참고사항」을 서버의 ChatGPT(codex_bridge)에 읽혀 정해진 칸으로 해석하게 하고,
 *         같은 통보문의 규칙 결과와 나란히 맞춰 보는 **시험**(관리자가 버튼으로 시작·멈춤).
 *         1차 = ChatGPT·표본 200건, 2차 = 클로드 키2·2026년 1차에 없던 표현 161건(ai_trial_sample_2.json).
 *         실제 특보현황·푸시에는 아무것도 반영하지 않는다.
 * 사용자 확정:
 *   2026-11-12 「추후 참고사항 ai 호출적용할때 기존 참고사항 데이터를 ai에게 넣어서 어떻게 ai가 해석했는지 결과를 보는방안이 좋겠음」
 *   2026-11-15 「대표 표본 200건으로 확인해보자」 「이미 우리 앱은 서버에서 chat gpt가 돌아가도록 해놓았어 … 그것을 활용해봐」
 *              「통보문 관찰이라는 탭을 하나 더 두고」 「보내는 시각은 ㄱ(누르면 바로 시작)」
 * 원칙(analysis/bulletin_survey/README.md 「참고사항 AI 해석 — 계획」): AI 는 정해진 칸만 채운다. **해역을 펼치지 않는다** —
 *   원문 해역 표현을 그대로 옮기고, 펼치기는 규칙(lifecycle_check.expand)이 한다. 근거 문장은 원문에 그대로 있어야 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : analysis/bulletin_survey/ai_trial_sample.json·ai_trial_sample_2.json(표본·규칙 결과 — ai_trial_build.js 가 만든다) · services/llm_chain(클로드 키2) ·
 *                   analysis/bulletin_survey/lifecycle_check.js(해역 펼치기) · services/codex_bridge(ChatGPT 줄 — 나리야·브리핑 AI 와 같은 줄)
 *  - 저장          : data/bulletin_ai_trial.json(1차)·bulletin_ai_trial_2.json(2차) — 진행·결과, 서버가 다시 떠도 이어서
 *  - 나를 쓰는 곳  : routes/bulletin_watch.js(관리자 시작·멈춤·상태·보고서) · 검사 test_bulletin_ai_trial
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_FILE = path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'ai_trial_sample.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'bulletin_ai_trial.json');
const KINDS = ['예비취소', '예비연장', '예비연기', '예비추가', '해제예고연장', '해제예고변경', '등급변경가능성', '특보발표가능성', '일부해제', '정확해제시각', '안내'];
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
        `5) 종류는 다음 중 하나: ${KINDS.join(', ')}. 해상(바다) 특보가 아닌 것(강풍·호우·대설·육상 지역)은 옮기지 마라. 한 문장에 바다와 육상이 섞이면 바다 부분만 옮긴다.`,
        '   예비취소=예비특보를 해제·취소함 / 예비연장=예비특보 시간을 뒤로 늘리거나 옮겨 다시 발표 / 예비연기=발표 시점을 늦춤 / 예비추가=예비특보 추가 발표',
        '   해제예고연장=특보 해제 예고 시각을 늦춤 / 해제예고변경=해제 예고 시각을 앞당기거나 바꿈(늦추는 것은 해제예고연장) / 등급변경가능성=주의보가 경보로 바뀔 가능성·시점 / 특보발표가능성=특보가 새로 발표될 가능성',
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
function resolveZones(expr, ctx = {}) {
    const { expand, splitTop, PARENTS, childrenOf } = require('../analysis/bulletin_survey/lifecycle_check');
    const { ZONE_GROUP_MAP } = require('../config/zone_group_map');
    const parentOf = (x) => (PARENTS.has(x) ? x : [...PARENTS].find((p) => childrenOf(p).includes(x)));
    const allKids = [...PARENTS].flatMap((p) => childrenOf(p));
    // ③ 「위 구역·위 해역·위 지역」 = 이 통보문 본문의 해역(규칙이 본문에서 읽은 것) — 2026-11-15 AI 시험 7건
    if (/^위\s*(구역|해역|지역)/.test(String(expr || '').trim()) && ctx.bodyZones) return ctx.bodyZones.length ? [...ctx.bodyZones] : null;
    // 「A 중 B」(띄어 쓴 「중」만 — 「동해중부」의 중은 아니다) → 「A(B)」 · 끝에 붙은 조사 「의」 떼기(「동해중부해상의」)
    let s = String(expr || '').replace(/\s+중\s+([^,，와과및]+)/g, '($1)').replace(/의\s*$/, '');
    // ④ 점(.)으로 이어 쓴 이름 — 「제주도동부.남부앞바다」 「북서.남서.가파도연안바다」 「강원중.북부앞바다」: 끝말(앞바다·연안바다…)과 앞머리를 나눠 붙여 하나씩 푼다
    const dotSplit = (tok) => {
        const m = tok.match(/^(.+?)(앞바다|먼바다|연안바다|평수구역)$/);
        if (!m || !/[.·]/.test(m[1])) return null;
        if (/\./.test(tok)) { const whole = resolveZones(tok.replace(/\./g, '·'), ctx); if (whole) return new Set(whole); }   // 「인천.경기앞바다」 = 「인천·경기앞바다」
        const parts = m[1].split(/[.·]/).filter(Boolean);
        if (parts.length < 2) return null;
        const tail = parts[1].slice(-1);
        if (tail === '부' && !parts[0].endsWith('부')) parts[0] += '부';   // 「강원중.북부」 = 강원중부·강원북부
        const pre = parts[0].length > parts[1].length ? parts[0].slice(0, parts[0].length - parts[1].length) : '';
        const got = new Set();
        for (let i = 0; i < parts.length; i++) {
            const name = (i === 0 ? parts[0] : pre + parts[i]) + m[2];
            const r = resolveZones(name, Object.assign({}, ctx, { office: ctx.office }));
            if (!r) return null;
            r.forEach((x) => got.add(x));
        }
        return got;
    };
    const out = new Set();
    for (let tok of splitTop(s.replace(/\s+/g, '').replace(/(바다|해상|구역|\))(와|과|및)/g, '$1,'))) {
        tok = tok.replace(/의$/, '');
        let u = expand(tok, []);
        // ④ 묶음 이름 + 「(줄인 부모 이름 제외)」 — 「제주도앞바다(북부앞바다 제외)」: expand 는 괄호 안을 못 알아봐 묶음 전체를 준다
        const ex = tok.match(/^([^(]+)\((.+)제외\)$/);
        if (ex && ZONE_GROUP_MAP[ex[1]]) {
            const drop = splitTop(ex[2]).map((t) => t.replace(/\s+/g, ''));
            u = new Set(ZONE_GROUP_MAP[ex[1]].filter((p) => !drop.some((d) => p === d || p.endsWith(d))));
        }
        if (!u) u = dotSplit(tok);
        if (!u) {
            const base = tok.replace(/\(.*$/, '');
            let hit = [];
            // 줄임 이름(규칙): 「X먼바다」 = X안쪽먼바다+X바깥먼바다, 「X앞바다」 = X북부·중부·남부앞바다
            if (/먼바다$/.test(base)) hit = ['안쪽먼바다', '바깥먼바다'].map((t) => base.replace(/먼바다$/, t));
            else if (/앞바다$/.test(base)) hit = ['북부앞바다', '중부앞바다', '남부앞바다'].map((t) => base.replace(/앞바다$/, t));
            // ④ 「X해상」 = X앞바다 묶음 + X…먼바다(목록에서 X 로 시작하는 먼바다) — 「동해중부해상」 「동해남부남쪽해상」
            else if (/해상$/.test(base)) { const x = base.replace(/해상$/, ''); hit = [...(ZONE_GROUP_MAP[x + '앞바다'] || []), ...[...PARENTS].filter((p) => p.startsWith(x) && /먼바다$/.test(p))]; }
            // ④ 「제주도북동연안바다」처럼 「앞바다 중」이 빠진 자식 이름 — 끝부분이 하나의 자식 이름과만 맞으면 그 자식
            else if (/(연안바다|평수구역)$/.test(base)) { for (let k = 0; k < base.length - 3 && !hit.length; k++) { const m = allKids.filter((c) => c.replace(/\s+/g, '').endsWith(base.slice(k)) && c.startsWith(base.slice(0, 2))); if (m.length === 1) hit = m; } }
            hit = hit.filter((c) => PARENTS.has(c) || allKids.includes(c));
            // ④ 줄인 부모 이름 「동부앞바다」(= 제주도동부앞바다) — 관할 안에서 끝이 맞는 부모가 하나일 때만
            if (!hit.length && /(앞바다|먼바다)$/.test(base) && ctx.office) { const m = (officeZones()[ctx.office] || []).filter((p) => p.endsWith(base) && p !== base); if (m.length === 1) hit = m; }
            // ④ 별칭(공식 목록에 없는 이름 — 2026 참고사항): 「제주도바깥먼바다」 = 제주도남쪽바깥먼바다(제주 먼바다 중 바깥은 하나뿐)
            if (!hit.length && ALIAS[base]) hit = ALIAS[base];
            // ④ 부모 없이 자식 이름만(「남동연안바다」 「동부평수구역」) — 그 관서 관할 부모의 자식 중 끝이 맞는 것이 **하나**일 때만
            if (!hit.length && /(연안바다|평수구역)$/.test(base) && ctx.office) {
                const own = officeZones()[ctx.office] || [];
                const find = (ps) => ps.flatMap((p) => childrenOf(p)).filter((c) => c.replace(/\s+/g, '').endsWith(base));
                const inBody = find(own.filter((p) => (ctx.bodyZones || []).includes(p)));   // 본문 해역으로 먼저 좁힌다(「동부평수구역」은 부산·경남서부 둘 다 있다)
                let m = inBody.length ? inBody : find(own);
                // 「(제주도)북부연안바다」 = 북부앞바다의 연안바다 — 방향 + 연안바다(제주는 자식 이름이 그냥 「연안바다」)
                if (!m.length) { const d = base.match(/(북부|남부|동부|서부|중부)(연안바다|평수구역)$/); if (d) m = own.filter((p) => p.endsWith(d[1] + '앞바다')).flatMap((p) => childrenOf(p)).filter((c) => c.endsWith(d[2])); }
                if (m.length === 1) hit = m;
            }
            hit = hit.filter((c) => PARENTS.has(c) || allKids.includes(c));
            if (!hit.length) return null;
            u = new Set(hit);
        }
        for (const x of u) { const p = parentOf(x); if (p) out.add(p); }
    }
    // ① 관서 관할로 좁힌다 — 「서해중부앞바다」를 수도권청 글에서는 인천·경기만(충남은 대전청). 겹치는 게 없으면 좁히지 않는다.
    if (ctx.office) {
        const own = officeZones()[ctx.office] || [];
        const mine = [...out].filter((z) => own.includes(z));
        if (mine.length) return mine;
    }
    return out.size ? [...out] : null;
}
const ALIAS = { '제주도바깥먼바다': ['제주도남쪽바깥먼바다'] };
let _oz = null;
/** 관서별 관할 부모 해역(analysis/bulletin_survey/office_zones.json — ai_trial_build.js 가 원본에서 만든다). */
function officeZones() { if (!_oz) { try { _oz = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'office_zones.json'), 'utf8')); } catch (e) { console.warn('[bulletin_ai_trial] 관할 표 없음', e && e.message); _oz = {}; } } return _oz; }
/** 육상 지역 표현인가 — 「충청남도(…)」 「제주도(추자도)」 「울릉도.독도」 「위 지역」은 바다 특보가 아니다(지시 5번을 AI 가 어긴 4건, 2026-11-15). */
const isLand = (expr) => /^[가-힣]+도\(|^울릉도\.독도|^(서해5도|흑산도|제주도)$|산지|평지|중산간|^위\s*지역/.test(String(expr || '').trim());

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
    const gone = new Set([...(r.빠짐 || []).map((x) => x.해역), ...(r.시간지나끝남 || []).filter((x) => !x.다시나옴.length).map((x) => x.해역), ...(r.직전빠짐 || []).map((x) => x.해역)]);   // 직전빠짐: 문장이 한 통보문 늦게 오는 경우
    const moved = new Set([...(r.시간바뀜 || []).map((x) => x.해역), ...(r.시간지나끝남 || []).filter((x) => x.다시나옴.length).map((x) => x.해역)]);
    const added = new Set((r.새로 || []).map((x) => x.해역));
    const told = new Set();
    // 「위 구역」을 풀 이 통보문 본문 해역(규칙 결과에서)
    const bodyZones = [...new Set(r.항목 ? r.항목.flatMap((i) => i.해역) : [...(r.지금목록 || []), ...(r.빠짐 || []), ...(r.시간지나끝남 || [])].map((x) => x.해역))];
    for (const e of parsed.사건) {
        if (norm(item.참고사항).includes(norm(e.근거문장)) && norm(e.근거문장)) res.근거있음++; else res.근거없음++;
        if (isLand(e.해역표현)) { res.육상 = (res.육상 || 0) + 1; res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 판정: '육상(뺌)', 까닭: '바다 특보가 아닌 육상 지역 — 비교에서 뺀다' }); continue; }
        const zones = resolveZones(e.해역표현, { office: item.office, bodyZones });
        if (!zones) { res.해역못읽음.push(e.해역표현); res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 판정: '해역 못 읽음', 까닭: '규칙이 이 해역 표현을 펼치지 못했다' }); continue; }
        zones.forEach((z) => told.add(z));
        const base = item.rpt === '7' && (e.종류 === '예비취소' ? gone : (e.종류 === '예비연장' || e.종류 === '예비연기') ? moved : e.종류 === '예비추가' ? added : null);
        if (!base) { res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 해역: zones, 판정: '비교 기준 없음', 까닭: '목록 비교로 확인할 수 있는 종류가 아니다' }); continue; }
        const hit = zones.filter((z) => base.has(z));
        res.판정.push({ 종류: e.종류, 해역표현: e.해역표현, 해역: zones, 판정: hit.length === zones.length ? '일치' : hit.length ? '일부 일치' : '불일치',
            까닭: hit.length === zones.length ? '규칙 목록 비교와 같다' : `규칙 목록 비교에 없는 해역: ${zones.filter((z) => !base.has(z)).join(', ')}` });
    }
    // 규칙은 바뀌었다고 하는데 AI 가 말하지 않은 해역(참고사항에 안 적혔을 수도 있다 — 참고로만)
    const prevOnly = new Set((r.직전빠짐 || []).map((x) => x.해역));   // 앞 통보문에서 빠진 것은 이 통보문이 말할 의무가 없다
    for (const z of new Set([...gone, ...moved])) if (!told.has(z) && !(prevOnly.has(z) && !(r.빠짐 || []).some((x) => x.해역 === z))) res.규칙만.push(z);
    return res;
}

/**
 * 시험 실행기를 만든다. 검사에서는 AI 호출·표본·저장 위치·시계를 바꿔 끼운다.
 * @param {{ai?: function(string): Promise<{success:boolean, response?:{text:string}, error?:string}>, sample?: Array, file?: string, now?: function(): number, sleep?: function(number): Promise<void>, gapMs?: number}} o
 * @returns {{start: function(): object, stop: function(): object, status: function(): object, results: function(): Array, done: function(): Promise<void>}}
 * [연계] ← module.exports(실제 codex_bridge) · test_bulletin_ai_trial
 */
function createTrial({ ai, sample, sampleFile = SAMPLE_FILE, file = STATE_FILE, provider = 'chatgpt', label = '', now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
    const getSample = () => sample || (sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8')));
    const callAi = ai || aiFor(provider);
    let st = null, loop = null, stopAsked = false;
    const load = () => { if (st) return st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { st = { results: {} }; } st.status = st.status === 'running' ? 'stopped' : (st.status || 'idle'); return st; };
    const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st)); fs.renameSync(file + '.tmp', file); };

    async function runOne(item) {
        const t0 = now();
        let r; try { r = await callAi(buildPrompt(item)); } catch (e) { console.warn('[bulletin_ai_trial] AI 호출 실패', item.id, e && e.message); r = { success: false, error: String(e && e.message || e) }; }
        const rec = { at: new Date(t0).toISOString(), ms: now() - t0 };
        if (!r || !r.success) { rec.ok = false; rec.error = (r && r.error) || '응답 없음'; if (r && r.creditOut) rec.creditOut = true; return rec; }
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
            if (rec.creditOut) { st.status = 'stopped'; st.stopReason = '크레딧 소진 — ' + rec.error; save(); console.warn('[bulletin_ai_trial] 멈춤:', st.stopReason); return; }   // 소진이면 바로 멈춘다(헛돌지 않게)
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
        return { label, provider, status: st.status, total: n, done: res.filter((r) => r.ok).length, failed: res.filter((r) => !r.ok).length, lastAt: st.lastAt || null, lastError: st.lastError || null, stopReason: st.stopReason || null, startedAt: st.startedAt || null };
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
        return [`- 빠짐(취소로 보임): ${f(r.빠짐, (x) => x.해역 + ' ' + x.시간창)}`, ...(r.직전빠짐 && r.직전빠짐.length ? [`- 바로 앞 예비 통보문(3시간 안)에서 빠짐: ${f(r.직전빠짐, (x) => x.해역 + ' ' + x.시간창)}`] : []), `- 시간 바뀜: ${f(r.시간바뀜, (x) => x.해역 + ' ' + x.전 + ' → ' + x.후.join('/'))}`,
            `- 새로: ${f(r.새로, (x) => x.해역 + ' ' + x.시간창)}`, `- 시간 지나 끝남: ${f(r.시간지나끝남, (x) => x.해역 + ' ' + x.시간창 + (x.다시나옴.length ? ' → 다시 ' + x.다시나옴.join('/') : ''))}`].join('\n');
    };
    const out = [
        '# 통보문 참고사항 AI 시험 결과' + (st.label ? ` — ${st.label}` : ''), '',
        '서버의 ChatGPT 에 지난 통보문 참고사항(표본)을 읽혀 정해진 칸으로 옮기게 하고, 규칙(직전 예비 목록과 비교 등)과 맞춰 본 결과입니다. 실제 특보현황·푸시에는 반영하지 않았습니다.', '',
        '## 요약', '',
        `- 진행: ${st.done}/${st.total}건 끝남 · 실패 ${st.failed}건 · 상태 ${st.status}${st.stopReason ? ' (' + st.stopReason + ')' : ''}`,
        `- AI 가 뽑은 사건: ${ev}개 · 근거 문장이 원문에 그대로 있음 ${okEv}개 · **원문에 없음 ${badEv}개**(AI 가 문장을 바꾸거나 지어냄)`,
        `- 판정: ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`,
        `- 규칙이 못 읽은 해역 표현: ${Object.entries(unread).map(([k, v]) => `「${k}」×${v}`).join(', ') || '없음'}`, '',
        '판정 뜻 — 일치: 규칙의 목록 비교와 같다 / 불일치·일부 일치: AI 가 말한 해역이 규칙 결과에 없다 / 비교 기준 없음: 목록으로 확인할 수 없는 종류(가능성·해제예고 등) / 해역 못 읽음: 규칙이 그 표현을 펼치지 못함 / 육상(뺌): 바다가 아닌 지역이라 비교에서 뺌.', '',
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

/**
 * 시험마다 쓰는 AI. chatgpt = 서버 ChatGPT(codex_bridge 줄) · claude2 = 관리자 센터 「클로드 키2」(llm_chain.callClaudeDirect — 사슬 안 거침).
 * [연계] ← createTrial / → codex_bridge.callRaw · llm_chain.callClaudeDirect
 */
function aiFor(provider) {
    const config = { responseMimeType: 'application/json' };
    if (provider === 'claude2' || provider === 'claude1') return (prompt) => require('./llm_chain').callClaudeDirect(provider, { contents: prompt, config });
    return (prompt) => require('./codex_bridge').callRaw({ contents: prompt, config, caller: 'Bulletin-AI-Trial' });
}
// 시험 목록 — 1차는 결과를 그대로 두고 2차를 따로 돌린다(사용자 확정 2026-11-15 「이번에는 테스트를 이미 앱에 반영되어 있는 클로드 키2로 진행」).
const TRIALS = {
    '1': { label: '1차 · ChatGPT · 표본 200건', provider: 'chatgpt', sampleFile: SAMPLE_FILE, file: STATE_FILE },
    '2': { label: '2차 · 클로드 키2 · 2026년 새 표현 161건', provider: 'claude2',
        sampleFile: path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'ai_trial_sample_2.json'), file: path.join(__dirname, '..', 'data', 'bulletin_ai_trial_2.json') },
};
const reals = {};
const getReal = (id) => { const k = TRIALS[id] ? id : '1'; return (reals[k] = reals[k] || createTrial(TRIALS[k])); };
module.exports = {
    TRIALS: Object.fromEntries(Object.entries(TRIALS).map(([k, v]) => [k, { label: v.label, provider: v.provider }])),
    start: (id) => getReal(id).start(), stop: (id) => getReal(id).stop(), status: (id) => getReal(id).status(),
    report: (id) => reportMarkdown(getReal(id).results(), getReal(id).status()),
    createTrial, buildPrompt, checkOne, resolveZones, reportMarkdown, isLand, KINDS,
};
