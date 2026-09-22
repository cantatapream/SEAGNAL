/**
 * ============================================================================
 * 파일명: _dashboard/loop/live_article_probe.js
 * 역할  : ★게이트가 아니다 — **조사용 탐침**(일감 L-7).
 * ============================================================================
 * [왜] 2-11(github_raw 로컬 폴백)로 조문 원문·서식(§5-5)·별표 이미지(§5-9) 경로가
 *   토큰 없이 열렸다. 그래서 처음으로 **"실제 답변의 근거 조문을 눌렀을 때 정말
 *   열리는가"** 를 라이브로 잴 수 있다. `link_ready.js`(V5-8)는 위키 표를 정적으로
 *   보지만, 이 탐침은 **검색이 실제로 고른 쪽의 표**를 타고 `loadArticle` 까지 간다.
 * [무엇을] 골든 291문항 → 상위 3쪽 → 그 쪽의 근거 조문 행 → `loadArticle`.
 *   열림/실패 사유별 집계 + 첨부(서식·별지·이미지) 수를 센다.
 * [쓰는 법] node .../live_article_probe.js [문항수]
 * [연계] 결과 `_dashboard/live_article_probe_2026-09-22.json` · 짝 `live_probe.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');
const A = require('../../../../services/article_text.js');

const QFILE = path.join(__dirname, 'pinned', 'golden_questions.json');
const OUT = path.join(__dirname, '..', 'live_article_probe_2026-09-22.json');
const PAGES_PER_Q = 3, ROWS_PER_PAGE = 8;

(async () => {
  const limit = Number(process.argv[2] || 0);
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || [];
  const list = limit > 0 ? qs.slice(0, limit) : qs;

  const reason = {}, seen = new Set();
  let tried = 0, ok = 0, refs = 0, forms = 0, images = 0, annex = 0;
  const failSamples = [];
  let n = 0;

  for (const q of list) {
    if (++n % 25 === 0) process.stderr.write(`  ...${n}/${list.length}\n`);
    let cp = [];
    try { cp = ((await R.search(q.question)) || {}).contextPages || []; } catch (_) { continue; }
    for (const p of cp.slice(0, PAGES_PER_Q)) {
      let chain = [];
      try { chain = R.extractCitationChain(p.body || '').slice(0, ROWS_PER_PAGE); } catch (_) { continue; }
      for (const c of chain) {
        const art = c.citedArticle || c.article || '';
        const key = `${c.law}|${art}|${c.tier || ''}|${p.law}`;
        if (seen.has(key)) continue;          // 같은 (법,조)를 여러 문항에서 다시 열지 않는다
        seen.add(key);
        tried++;
        let a;
        try { a = await A.loadArticle({ law: c.law, article: art, tier: c.tier || 'law', baseLaw: p.law }); }
        catch (e) { a = { ok: false, reason: 'throw:' + String(e && e.message).slice(0, 60) }; }
        if (a.ok) {
          ok++;
          for (const x of (a.refs || [])) {
            refs++;
            const k = String(x.key || '');
            if (/^(서식|별지)/.test(k)) forms++;
            else if (/^별표/.test(k)) annex++;
            if (x.kind === 'image' || x.image) images++;
          }
        } else {
          const r = a.reason || 'unknown';
          reason[r] = (reason[r] || 0) + 1;
          if (failSamples.length < 30) failSamples.push({ law: c.law, article: art, tier: c.tier || '', baseLaw: p.law, reason: r });
        }
      }
    }
  }

  const report = {
    생성: new Date().toISOString(), 문항: list.length,
    '서로 다른 (법·조) 조합': tried,
    '열렸다': ok, '열림 비율': tried ? (ok / tried * 100).toFixed(1) + '%' : '—',
    '못 연 사유': reason,
    '첨부 총계': refs, '  └ 별표': annex, '  └ 서식·별지': forms, '  └ 이미지': images,
    실패표본: failSamples,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  for (const [k, v] of Object.entries(report)) {
    if (k === '실패표본') continue;
    console.log(`  ${k.padEnd(24)} ${typeof v === 'object' ? JSON.stringify(v, null, 0) : v}`);
  }
  console.log('\n  실패 표본:');
  for (const s of failSamples.slice(0, 10)) console.log(`    [${s.reason}] ${s.law} ${s.article} (tier=${s.tier}, base=${s.baseLaw})`);
  console.log(`\n  → ${path.relative(process.cwd(), OUT)}`);
})();
