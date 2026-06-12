'use strict';
/**
 * prelim_census.js — 예비특보 통보문(2023~2026) 구조화 + 발효 연계 분석.
 *
 *  입력: data/prelim_warnings.json (fetch_prelim.js 수집물)
 *  출력: out/prelim_events.json  — 구역단위 행 [{announceAt, kind, zone, expectedAt}]
 *        reports/PRELIM_census.md — 통계 리포트
 *
 *  분석:
 *   1) 본문 파싱: "(N) 풍랑|태풍 예비특보" 섹션의 "o <시간대> : <구역들>" → 구역단위 행
 *      (묶음명은 ZONE_GROUP_MAP 으로 부모구역 펼침, 이름 정규화)
 *   2) 발효 연계: warnings CSV(풍랑 발표/변경)와 (구역, 예비발표시각) 매칭
 *      → 예비→발효 리드타임 분포, 예비 적중률(=KMA 자체 정밀도), 발효의 예비 커버리지
 *
 *  실행: node analysis/wave_leadtime/prelim_census.js
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { normName } = require('./zonePolygon');

const IN = path.join(__dirname, 'data', 'prelim_warnings.json');
const CSVS = ['warnings_2020-2023.csv', 'warnings_2023-2026.csv'].map(f => path.join(__dirname, 'data', f));
const OUT_EVENTS = path.join(__dirname, 'out', 'prelim_events.json');
const OUT_MD = path.join(__dirname, 'reports', 'PRELIM_census.md');

let ZONE_GROUP_MAP = {};
try { ZONE_GROUP_MAP = require('../../ai_report_parser').ZONE_GROUP_MAP || {}; } catch (_) {}

// ── 시간대 라벨 → 시작시각(시) ───────────────────────────────────────────────
const BAND_HOUR = { '새벽': 0, '아침': 6, '오전': 6, '낮': 12, '오후': 12, '저녁': 18, '밤': 18 };

/** "06월 29일 밤(18시~24시)" + 발표시각 → 예상시각 Date. 실패 시 null. */
function parseExpected(when, announceAt) {
    const m = String(when).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*([가-힣]*)?\s*(?:\((\d{1,2})\s*시)?/);
    if (!m) return null;
    const mo = +m[1], da = +m[2];
    let hh = m[4] != null ? +m[4] : (BAND_HOUR[m[3]] != null ? BAND_HOUR[m[3]] : 9);
    if (hh === 24) hh = 23;
    let y = announceAt.getFullYear();
    if (mo < announceAt.getMonth() + 1 - 6) y += 1; // 12월 발표 → 1월 예상 롤오버
    const d = new Date(y, mo - 1, da, hh, 0, 0);
    return isNaN(d) ? null : d;
}

/** 구역 토큰 정리: 괄호 부가설명 제거, 해상 구역만, 묶음명 펼침. */
function cleanZones(raw) {
    const out = [];
    for (let tok of String(raw).split(/[,]/)) {
        tok = tok.replace(/\([^)]*\)/g, '').replace(/[.。]\s*$/, '').trim();
        if (!tok) continue;
        if (!/바다|해상|먼바다|앞바다/.test(tok)) continue; // 해상 구역만
        const members = ZONE_GROUP_MAP[tok];
        if (Array.isArray(members) && members.length) members.forEach(mn => out.push(mn));
        else out.push(tok);
    }
    return out;
}

/** 통보문 1건 본문 → [{kind, when, zones[]}] (풍랑/태풍 예비특보 섹션만) */
function parseBody(body) {
    const events = [];
    // 섹션 경계로 분할
    const parts = String(body).split(/(?=\(\d+\)\s*[가-힣]+\s*예비특보)/);
    for (const part of parts) {
        const head = part.match(/^\(\d+\)\s*(풍랑|태풍)\s*예비특보/);
        if (!head) continue;
        const kind = head[1];
        // "o <시간대> : <구역들>" 반복 — 다음 'o ' 또는 끝까지
        const lines = [...part.matchAll(/o\s*([^:o]{2,60}?)\s*:\s*([^o]+?)(?=(?:\s+o\s)|\s*\(\d+\)|$)/g)];
        for (const [, when, zonesRaw] of lines) {
            const zones = cleanZones(zonesRaw);
            if (zones.length) events.push({ kind, when: when.trim(), zones });
        }
    }
    return events;
}

(function main() {
    const store = JSON.parse(fs.readFileSync(IN, 'utf8'));
    const bulletins = Object.values(store).filter(b => b.isV || b.isT);

    // 1) 구역단위 행 구축
    const rows = []; // {announceAt(ms), kind, zone(norm), zoneRaw, expectedAt(ms|null)}
    let parsedBul = 0, noParse = 0;
    for (const b of bulletins) {
        const announceAt = new Date(String(b.tmFc).replace(/\.0$/, '').replace(' ', 'T'));
        if (isNaN(announceAt)) { noParse++; continue; }
        const evs = parseBody(b.body);
        if (!evs.length) { noParse++; continue; }
        parsedBul++;
        for (const e of evs) {
            const exp = parseExpected(e.when, announceAt);
            for (const z of e.zones) {
                rows.push({
                    announceAt: announceAt.getTime(), kind: e.kind,
                    zone: normName(z), zoneRaw: z,
                    expectedAt: exp ? exp.getTime() : null,
                });
            }
        }
    }

    // (구역,종류) 단위 dedup — 같은 이벤트의 연장/재발표는 "가장 이른 발표"만 유지
    //   기준: 같은 zone+kind 이고 발표시각이 24h 이내면 같은 예비 에피소드로 봄.
    rows.sort((a, b) => a.announceAt - b.announceAt);
    const episodes = [];
    const lastByKey = new Map();
    for (const r of rows) {
        const k = r.kind + '|' + r.zone;
        const last = lastByKey.get(k);
        if (last && r.announceAt - last.announceAt <= 24 * 3600 * 1000) { last.announceAtLast = r.announceAt; continue; }
        const ep = { ...r, announceAtLast: r.announceAt };
        episodes.push(ep); lastByKey.set(k, ep);
    }

    // 2) 발효 연계 — 풍랑 주의보/경보 발효 census (6년: 두 CSV 합산)
    const evs = [];
    for (const csv of CSVS) {
        if (!fs.existsSync(csv)) continue;
        for (const e of parseWarnings(csv, { kinds: new Set(['풍랑', '태풍']), actions: new Set(['발표', '변경']) }))
            if (e.effectiveAt) evs.push(e);
    }
    const effByZone = new Map(); // zoneNorm → [발효ms...] (오름차순)
    for (const e of evs) for (const a of e.seaAreas) {
        const z = normName(a); if (!z) continue;
        if (!effByZone.has(z)) effByZone.set(z, []);
        effByZone.get(z).push(e.effectiveAt.getTime());
    }
    for (const arr of effByZone.values()) arr.sort((a, b) => a - b);

    const H = 3600 * 1000;
    const LINK_WINDOW = 72 * H; // 예비 발표 후 72h 내 발효면 연계
    let linked = 0, cancelled = 0; const leads = [];
    for (const ep of episodes) {
        if (ep.kind !== '풍랑') { ep.linked = null; continue; }
        const arr = effByZone.get(ep.zone) || [];
        const hit = arr.find(t => t >= ep.announceAt - 2 * H && t <= ep.announceAt + LINK_WINDOW);
        if (hit != null) { linked++; ep.linked = hit; leads.push((hit - ep.announceAt) / H); }
        else { cancelled++; ep.linked = null; }
    }
    // 발효의 예비 커버리지(역방향): 풍랑 발효 고유 (zone,발효시각) 중, 그 전 72h 내 예비 있던 비율
    const preByZone = new Map();
    for (const ep of episodes) { if (ep.kind !== '풍랑') continue; if (!preByZone.has(ep.zone)) preByZone.set(ep.zone, []); preByZone.get(ep.zone).push(ep.announceAt); }
    for (const arr of preByZone.values()) arr.sort((a, b) => a - b);
    let effTotal = 0, effCovered = 0;
    for (const [z, arr] of effByZone) {
        const pres = preByZone.get(z) || [];
        // 같은 zone 의 발효들을 에피소드화(24h dedup)
        let lastT = -Infinity;
        for (const t of arr) {
            if (t - lastT <= 24 * H) { lastT = t; continue; }
            lastT = t; effTotal++;
            if (pres.some(p => p <= t + 2 * H && p >= t - LINK_WINDOW)) effCovered++;
        }
    }

    const sortN = a => a.slice().sort((x, y) => x - y);
    const q = (a, p) => { if (!a.length) return null; const s = sortN(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const f1 = v => v == null ? '-' : v.toFixed(1);

    const vEp = episodes.filter(e => e.kind === '풍랑'), tEp = episodes.filter(e => e.kind === '태풍');
    let md = '# 예비특보 census (2020-06 ~ 2026-06) — 구조화 + 발효 연계\n\n';
    md += `통보문(풍랑/태풍 포함): ${bulletins.length} (파싱성공 ${parsedBul} / 실패 ${noParse})\n`;
    md += `구역단위 행: ${rows.length} → 에피소드(24h dedup): 풍랑 ${vEp.length} · 태풍 ${tEp.length}\n\n`;
    md += '## 예비 → 발효 연계 (풍랑, 72h 윈도)\n\n';
    md += `- 발효로 이어짐: **${linked}** (${(linked / (linked + cancelled) * 100).toFixed(0)}%)  ← KMA 예비특보 자체 정밀도\n`;
    md += `- 발효 안 됨(취소 등): **${cancelled}** (${(cancelled / (linked + cancelled) * 100).toFixed(0)}%)\n`;
    md += `- 예비발표→발효 리드타임(h): 중앙 **${f1(q(leads, .5))}** · p25 ${f1(q(leads, .25))} · p75 ${f1(q(leads, .75))} · p90 ${f1(q(leads, .9))}\n\n`;
    md += '## 발효의 예비 커버리지 (역방향)\n\n';
    md += `- 풍랑/태풍 발효 에피소드 ${effTotal} 중 사전 예비 있던 것 **${effCovered}** (${(effCovered / effTotal * 100).toFixed(0)}%)\n`;
    md += `  → 나머지 ${(100 - effCovered / effTotal * 100).toFixed(0)}% 는 예비 없이 발효 — 우리 예측이 가치를 더할 1차 영역\n\n`;
    md += '## 연도별 풍랑 예비 에피소드\n\n| 연도 | 에피소드 | 발효연계 | 취소 |\n|---|---|---|---|\n';
    for (const y of ['2020', '2021', '2022', '2023', '2024', '2025', '2026']) {
        const g = vEp.filter(e => new Date(e.announceAt).getFullYear() === +y);
        const l = g.filter(e => e.linked != null).length;
        md += `| ${y} | ${g.length} | ${l} | ${g.length - l} |\n`;
    }

    fs.writeFileSync(OUT_EVENTS, JSON.stringify(episodes));
    fs.writeFileSync(OUT_MD, md);
    console.log(md);
    console.log('events →', OUT_EVENTS);
})();
