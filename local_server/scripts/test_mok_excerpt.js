/**
 * test_mok_excerpt.js — ★원문결손 점검이 **스스로 발췌라고 밝힌 파일**을 결함으로 세지 않는다. (3-85)
 *
 * [왜 있나] 2026-10-07 원문결손 72건을 하나씩 열어 보니 약 65건이 이름·머리말·_meta.json 으로 「발췌」 를
 * 밝힌 파일이었는데, 점검기(`mok_audit.py`)가 그 표시를 못 읽어 매주 「누락」 카드로 올렸다(「해당없음」 으로
 * 닫아도 다시 뜬다). 판정을 `_dashboard/loop/_excerpt.py` 한 곳으로 모으고 읽는 자리를 넷으로 늘렸다.
 *
 * [무엇을 고정하나 — 망 없이, 임시 폴더에서]
 *  X1 파일 이름(…_발췌 · …연결조문 · …_제N조…) → 발췌
 *  X2 종전 머리말 표시([발췌 · 발췌 수집 · 해당 조문만 …) → 발췌
 *  X3 조문 머리줄이 「발췌」라고 적음(`[제2조] 정의 (…, 발췌: 제3호)` · `— 17호 발췌`) → 발췌
 *  X4 폴더 _meta.json 비고 「전체 아님」/「발췌 수집」 → 발췌
 *  X5 ⚠머리말에 「발췌」 낱말만 있는 **전문**(옛 내력 설명)은 발췌가 아니다 · 「전문 수집」 은 위 넷을 이긴다
 *  X6 진짜 빈 전문(표시 없음)은 발췌가 아니다 — 결함으로 남는다
 *  X7 mok_audit.py 가 이 자를 쓰고 까닭(excerpt_why)을 남긴다 · 함께 고친 도구 옵션 셋(정적)
 *  X8 별표를 안 바꾸는 재수집(byl=False)도 원문과 다른 별표를 찾아 기록한다(3-86 — 그 사이 바뀐 별표 6개를 놓쳤다)
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → _dashboard/loop/_excerpt.py · mok_audit.py · fold_effective.py · recollect_tier.py · collect_approved.py
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LOOP = path.resolve(__dirname, '../knowledge/legal/_dashboard/loop');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600));
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mok-excerpt-'));
const mk = (dir, file, text, meta) => {
  const d = path.join(TMP, dir); fs.mkdirSync(d, { recursive: true });
  if (meta) fs.writeFileSync(path.join(d, '_meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(d, file), text);
  return path.join(d, file);
};
const F = {
  name1: mk('a', '법률_발췌.txt', '[제2조] 정의 (시행 20260101)\n본문\n'),
  name2: mk('b', '법률_제2조(연결조문).txt', '[제2조] 정의\n'),
  name3: mk('c', '법률_제2조의2(벤처기업요건).txt', '[제2조의2] 요건\n'),
  oldmark: mk('d', '법률.txt', '[발췌 수집 안내]\n「선박법」이 인용하는 조만\n\n[제5조] 목적\n'),
  artline1: mk('e', '법률.txt', '[제2조] 정의 (시행 20260310 · 타법개정, 발췌: 제3호·제16호)\n3. "대규모점포"란\n'),
  artline2: mk('f', '법률.txt', '[제2조] 정의 (시행 20260701 · 일부개정) — 17호 발췌\n'),
  meta: mk('g', '시행령.txt', '[제56조] 수출입 물품의 원산지 표시방법 (시행 20260317 · 일부개정)\n', { 비고: '연결조문만 발췌 수집, 전체 아님 — 신선도 점검 대상에서 제외된다' }),
  fullHistory: mk('h', '시행규칙.txt', '※ 「폐기물관리법 시행규칙」 — 2026-09-21 발췌본을 전문으로 바꿨다.\n   종전 발췌본은 _구판/ 에 있다.\n\n[제1조] 목적\n'),
  fullMark: mk('i', '법률.txt', '[전문 수집] 「공직자의 이해충돌 방지법」 (시행 2022-05-19)\n  (종전에는 제2조만 발췌했다)\n\n[제1조] 목적\n', { 비고: '연결조문만 발췌 수집, 전체 아님' }),
  plain: mk('j', '시행령.txt', '[제1조] 목적 (시행 20231221 · 일부개정)\n본문\n', { 분류: '타법(기준법 인용 대상, 위키는 뻗어나온 지점만)' }),
};
const PY = `
import sys, json
sys.path.insert(0, sys.argv[1])
from _excerpt import excerpt_reason
print(json.dumps({k: excerpt_reason(v) for k, v in json.loads(sys.argv[2]).items()}, ensure_ascii=False))
`;
const r = spawnSync('python3', ['-c', PY, LOOP, JSON.stringify(F)], { encoding: 'utf8' });
let o = {};
try { o = JSON.parse(r.stdout.trim()); } catch (e) { ok('파이썬이 돌았다', false, r.stderr || r.stdout); }

console.log('\n── 발췌로 본다 ──');
ok('X1 파일 이름 「…_발췌」', o.name1 === '파일 이름', o.name1);
ok('X1 파일 이름 「…(연결조문)」', o.name2 === '파일 이름', o.name2);
ok('X1 파일 이름 「…_제N조의N(…)」 — 그 조만 받은 파일', o.name3 === '파일 이름', o.name3);
ok('X2 종전 머리말 표시 「[발췌 수집 안내]」', o.oldmark === '머리말 표시', o.oldmark);
ok('X3 조문 머리줄 「…, 발췌: 제3호·제16호)」', o.artline1 === '조문 머리줄', o.artline1);
ok('X3 조문 머리줄 「— 17호 발췌」', o.artline2 === '조문 머리줄', o.artline2);
ok('X4 폴더 _meta.json 비고 「…전체 아님」', o.meta === '_meta.json 비고', o.meta);

console.log('\n── 발췌로 보지 않는다 ──');
ok('X5 머리말에 「발췌본을 전문으로 바꿨다」 만 있는 전문은 발췌가 아니다(폐기물관리법 시행규칙 실측)', o.fullHistory === '', o.fullHistory);
ok('X5 「[전문 수집]」 은 폴더 비고 「전체 아님」 보다 이긴다(공직자이해충돌방지법 실측)', o.fullMark === '', o.fullMark);
ok('X6 표시 없는 전문은 발췌가 아니다 — 목이 모자라면 결함으로 남는다', o.plain === '', o.plain);

console.log('\n── 쓰는 쪽 · 함께 고친 도구 ──');
const read = (f) => fs.readFileSync(path.join(LOOP, f), 'utf8');
const mok = read('mok_audit.py');
ok('X7 mok_audit.py 가 _excerpt.excerpt_reason 을 쓰고(자체 판정 없음) 까닭을 excerpt_why 로 남긴다',
  /from _excerpt import excerpt_reason/.test(mok) && /rec\['excerpt_why'\] = why/.test(mok) && !/^def is_excerpt/m.test(mok));
ok('X7 fold_effective.py 는 승격이 있을 때만, 원래 들여쓰기로 _meta.json 을 쓴다',
  /if meta is not None and meta_changed and not dry:/.test(read('fold_effective.py')) && /_indent_of\(meta_raw\)/.test(read('fold_effective.py')));
ok('X7 recollect_tier.do_one 에 byl=False(별표 그대로)·force=True(같은 판 다시) 옵션',
  /def do_one\([^)]*byl=True, force=False\)/.test(read('recollect_tier.py')) && /if byl and byl_units:/.test(read('recollect_tier.py')) && /and not force:/.test(read('recollect_tier.py')));
ok('X8 byl=False 재수집도 바뀐 별표를 찾아 적는다(byl_changed → byl_skipped_changed · 쓰지 않는다)(3-86)',
  /def byl_changed\(law, tier, bdir\)/.test(read('recollect_tier.py')) && /if not byl and byl_units:\s*\n[\s\S]{0,400}rec\['byl_skipped_changed'\] = byl_changed\(law, tier, bdir\)/.test(read('recollect_tier.py')));
ok('X7 collect_approved.py --force 가 예고본 재수집까지 이어진다', /'--force' in flags/.test(read('collect_approved.py')) && /CPL\.collect_item, item, touched, force/.test(read('collect_approved.py')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
