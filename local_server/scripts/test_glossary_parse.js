/**
 * test_glossary_parse.js — 구어 표(`wiki/_glossary.md`) 파싱이 링크문법 때문에 줄을 잃지 않는가.
 *
 * [왜 있나] 2026-08-18 횡단 감사관이 찾은 결함: `loadGlossary()` 가 표 한 줄을 자체 정규식
 * `^\|([^|]+)\|([^|]+)\|[^|]*\|$` 로 쪼갰는데, 목적지 칸에 `[[대상|라벨]]` 처럼 **링크 안에
 * 파이프가 든** 표기가 흔해서(실측 396행 중 63행) 그 줄이 통째로 매치 실패해 조용히 버려졌다.
 * 금어기·금지체장·TAC·조개껍데기·어업인·국가어항 같은 실사용 빈도가 높은 구어가 22라운드 동안
 * 런타임 캐시에서 빠져 있었고, 문서 검사(xref_check)는 정상이라 아무도 못 봤다.
 *
 * [무엇을 고정하나] ①표의 데이터 행이 하나도 안 버려진다 ②링크 안 파이프가 든 줄도 목적지를
 * 제대로 뽑는다 ③그 줄들의 구어로 실제 검색 확장이 걸린다.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js loadGlossary·glossaryExpand.
 */
const fs = require('fs');
const path = require('path');
const R = require('../services/legal_retriever.js');

const GLOSSARY = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki', '_glossary.md');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// 표에서 "데이터 행"이 몇 개인지 파일에서 직접 센다(코드와 같은 방식으로 세면 결함을 못 잡는다).
function countDataRows() {
  let n = 0;
  for (const line of fs.readFileSync(GLOSSARY, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;       // 구분선
    if (t.includes('구어·별칭')) continue;         // 헤더
    n++;
  }
  return n;
}

console.log('── 구어 표 파싱 ──');

const rows = R.loadGlossary();
const expected = countDataRows();
ok('데이터 행을 하나도 버리지 않는다', rows.length === expected,
  '파일 ' + expected + '행 / 파싱 ' + rows.length + '행');

// 링크 안에 파이프가 든 줄(`[[대상|라벨]]`)이 실제로 파일에 있어야 이 테스트가 의미를 가진다.
const piped = fs.readFileSync(GLOSSARY, 'utf8').split('\n')
  .filter(l => l.trim().startsWith('|') && /\[\[[^\]]*\|[^\]]*\]\]/.test(l));
ok('링크 안 파이프가 든 줄이 표에 실재한다(테스트 전제)', piped.length > 0, piped.length + '행');

// 그 줄들의 첫 칸 구어가 전부 파싱 결과에 들어 있어야 한다.
const flat = s => String(s).replace(/\s+/g, '');
const parsedTerms = new Set();
rows.forEach(r => r.terms.forEach(t => parsedTerms.add(flat(t))));
const lost = [];
for (const line of piped) {
  const first = line.trim().replace(/^\|/, '').split('|')[0].trim();
  const terms = first.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  for (const t of terms) if (!parsedTerms.has(flat(t))) lost.push(t);
}
ok('링크 안 파이프가 든 줄의 구어가 하나도 안 빠진다', lost.length === 0,
  lost.length ? '유실: ' + lost.slice(0, 8).join(', ') : '');

// 목적지(slug)는 라벨이 아니라 **대상**이어야 한다(`[[대상|라벨]]` → 대상).
const withLabel = rows.find(r => r.slugs.some(s => s.includes('__')));
ok('목적지 slug 를 뽑는다', !!withLabel, withLabel ? withLabel.slugs[0] : '하나도 없음');

console.log('── 실사용 구어로 검색 확장이 걸리는가 ──');
// 이 6개는 전부 링크 안 파이프가 든 줄에 있던 것들이라 결함 당시 통째로 안 걸렸다.
for (const [q, want] of [
  ['금어기가 언제까지인가요', '수산자원관리법__금어기금지체장'],
  ['TAC 배분량이 궁금해요', '수산자원관리법__총허용어획량'],
  ['조개껍데기 바다에 버려도 되나요', '폐기물관리법__수산부산물조개껍데기투기'],
  ['어업인 정의가 뭔가요', '수산업ㆍ어촌발전기본법__수산업수산인어업인정의'],
  ['국가어항이 뭐죠', '어촌ㆍ어항법__어항의정의와종류'],
]) {
  const r = R.glossaryExpand(q);
  ok('"' + q + '" → ' + want, (r.forcedSlugs || []).includes(want),
    '실제: ' + ((r.forcedSlugs || []).slice(0, 3).join(', ') || '없음'));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
