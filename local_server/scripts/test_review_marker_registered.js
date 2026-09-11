/**
 * ============================================================================
 * 파일명: scripts/test_review_marker_registered.js
 * 역할: 위키 본문에 `⚠REVIEW-<식별자>` 마커를 달아 놓고 **승인 대기열
 *       (`_dashboard/review_queue.md`)에는 올리지 않은 것**을 찾아낸다.
 * ============================================================================
 *
 * [왜 있나 — 2026-09-10 초안 정리 배치에서 되풀이 확인]
 * 23개 법을 훑는 동안 담당 에이전트들이 같은 사고를 **다섯 번** 따로 보고했다:
 * 위키 본문에는 `⚠REVIEW-…` 마커와 "승인: [ ] 대기" 가 적혀 있는데 대기열에는 그 항목이 없어
 * **사람이 승인하려 해도 관리자 화면에 뜨지 않는** 상태였다. 페이지들은 스스로
 * *"등록은 이 사서 패스의 쓰기 범위 밖이라 다음 패스에서 옮겨 처리한다"* 고 적어 둔 채 방치돼 있었다.
 * 사람 눈에 띄려면 누군가 그 페이지를 열어 봐야 하니, 안 열리면 영영 안 보인다.
 * 그래서 **기계가 매번 세도록** 한다.
 *
 * [무엇을 하나]
 * 기준선(BASELINE)보다 늘어나면 실패한다. 줄어드는 것은 언제나 통과다.
 * 늘었다면 그 라운드에서 마커만 달고 대기열 등록을 빠뜨린 것이니, 그 자리에서 등록한다.
 *
 * [연계]
 * - `_dashboard/review_queue.md` → `### REVIEW-<식별자>:` 제목 줄이 등록의 기준
 * - `wiki/` 아래 모든 마크다운 → 본문의 `⚠REVIEW-<식별자>` 마커
 * - `_dashboard/loop/register_open_reviews.py` → 옮겨 담는 도구(이 검사가 걸리면 그걸 쓴다)
 * - `scripts/refactor/verify_all.sh` → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_review_marker_registered.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'knowledge', 'legal');
const QUEUE = path.join(ROOT, '_dashboard', 'review_queue.md');
const WIKI = path.join(ROOT, 'wiki');

// 2026-09-10 실측값. **줄이는 것이 목표다** — 줄었으면 이 숫자를 함께 내린다.
const BASELINE = 22;

/** 대기열에 제목으로 올라 있는 식별자 집합. 예: `### REVIEW-해운법-806: …` → `REVIEW-해운법-806` */
function registeredIds() {
  const q = fs.readFileSync(QUEUE, 'utf8');
  return new Set([...q.matchAll(/^###\s*(REVIEW-[^:\n]+):/gm)].map((m) => m[1].trim()));
}

/** 위키 본문에 달린 `⚠REVIEW-<식별자>` 마커를 전부 모은다. @returns {Map<string, Set<string>>} 식별자 → 파일 */
function bodyMarkers() {
  const out = new Map();
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!f.endsWith('.md')) continue;
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/⚠\s*REVIEW-([가-힣A-Za-z0-9ㆍ·()[\]_]+?-\d+)/g)) {
        const id = 'REVIEW-' + m[1];
        if (!out.has(id)) out.set(id, new Set());
        out.get(id).add(f);
      }
    }
  })(WIKI);
  return out;
}

const ids = registeredIds();
const markers = bodyMarkers();
const missing = [...markers].filter(([id]) => !ids.has(id));

console.log('── 본문 마커 ↔ 승인 대기열 등록 대조 ──');
console.log(`  대기열 등록 항목 ${ids.size}개 · 본문 마커 식별자 ${markers.size}개`);
for (const [id, files] of missing) console.log(`  ⚠ 대기열에 없음: ${id}  (${[...files].join(' · ')})`);

const pass = missing.length <= BASELINE;
console.log(pass
  ? `\n  ✅ 대기열 미등록 마커 ${missing.length}건 — 기준선(${BASELINE}) 이하`
  : `\n  ❌ 대기열 미등록 마커 ${missing.length}건 — 기준선(${BASELINE})보다 늘었다.`
    + '\n     마커만 달고 등록을 빠뜨리면 사람이 승인하려 해도 화면에 뜨지 않는다.'
    + '\n     `_dashboard/loop/register_open_reviews.py` 로 옮겨 담고 기준선을 내려라.');
console.log(`\n${pass ? 1 : 0} PASS / ${pass ? 0 : 1} FAIL`);
process.exit(pass ? 0 : 1);
