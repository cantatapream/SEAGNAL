/**
 * backlog_extract.js — 감사 파일에서 **아직 안 고쳐진 thin·missing 만** 뽑아 법별 백로그 파일로 분리한다.
 * AI 를 부르지 않는다(비용 0).
 *
 * [왜 있나 — H-43]
 * 감사는 매 라운드 결함을 찾는데 옛 항목은 계속 밀린다. 범위에서 빠진 것이 아니라 **감사 파일이
 * 너무 커서**다 — `_dashboard/audit/` 전체 28만 줄, 큰 파일은 한 법에 6,000줄이 넘는다(선원법
 * 6,314 · 해상교통안전법 6,277). 통합수정 사서가 그걸 다 읽고 옛 항목까지 되짚기는 현실적으로
 * 어려워, 매 라운드 최신 구간만 처리되고 백로그는 쌓인다("다음 통합수정 우선순위 재상신 9회째").
 * 그래서 **고칠 것만 든 짧은 목록**을 따로 만들어 준다.
 *
 * [어떻게 고르나]
 * `⚠thin`·`❌missing` 이 적힌 줄 중, 같은 줄에 **해소 표시**(✅·해소·해결·완료·full 전환 등)가
 * 없는 것만 남긴다. 법마다 표 형식이 제각각이라 컬럼을 파싱하지 않고 **줄 단위**로 본다 —
 * 정확도를 위해 애매한 것은 버리지 말고 `미분류`로 남겨 사람(사서)이 판단하게 한다.
 *
 * [분류] 줄에 이미 붙어 있는 꼬리표로 가른다:
 *   wiki_lag(원문엔 있는데 위키 미반영, **고칠 수 있음**) / content_gap(원문 자체 공백) /
 *   REVIEW(사람 판단) / collection_hole(수집) / 미분류
 *
 * [쓰는 법]
 *   node backlog_extract.js               → 법별 건수만 요약
 *   node backlog_extract.js --write       → `_dashboard/backlog/<법>.md` 생성
 *   node backlog_extract.js --law <이름>   → 한 법만
 *
 * [다시 써도 사서의 일을 잃지 않는다 — 2026-08-24]
 * `--write` 는 백로그 파일을 **덮어쓰지 않고 합친다.** 항목마다 고정 ID(`⟨BL-xxxxxxxx⟩`)를 달고,
 * 옛 파일에 같은 항목이 있으면 그 ID·확인표시(`- [x]`)·주석(`⟪…⟫`)을 그대로 이어받는다.
 * 그래서 라운드가 돌아도 **같은 항목이 새 항목으로 다시 등록되지 않는다.**
 * (종전에는 통째로 덮어써서 사서가 확인해 둔 표시 6,627건이 매번 사라졌다.)
 *
 * [연계] ← _dashboard/audit/<법>.md(읽기 전용) · → _dashboard/backlog/<법>.md
 *        ⚠감사 파일을 고치지 않는다.  · ID 계산은 `backlog_id.py` 와 동일(전수 대조로 확인)
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const AUDIT = path.join(LEGAL, '_dashboard', 'audit');
const OUT = path.join(LEGAL, '_dashboard', 'backlog');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

// 판정 표기(법마다 이모지 유무가 달라 둘 다 받는다)
const OPEN_RE = /⚠\s*thin|❌\s*missing|\bstill_missing\b/;
// 같은 줄에 이것이 있으면 **이미 끝난 것**으로 본다.
const DONE_RE = /✅|해소|해결(?!\s*안)|완료|full\s*(?:로)?\s*(?:전환|재평가|승격|확인)|→\s*✅|더 이상|제거|종료/;
// 애매하게 "유지"라고만 적힌 것은 열린 항목이다(해소가 아니다).
const KEEP_RE = /유지|불변|무변경|이월|잔존|연속|여전히|carry/;
// ★부정형 먼저 지운다(2026-08-20 — 진짜 미해소 516건이 통째로 사라지고 있었다).
//   `미해결`·`미해소` 안에 `해결`·`해소` 가 들어 있어 DONE_RE 가 그대로 물었다. 그러면
//   "여전히 미해결"이라고 적힌 줄이 **해소된 것으로 판정돼 목록에서 빠진다** — 빠진 것은
//   눈에 안 보이므로 이 오류는 스스로 드러나지 않는다. 대조 전에 부정형을 지워 버린다.
const NEG_DONE_RE = /미\s*해소|미\s*해결|미\s*완료|미\s*처리|해소되지\s*않|해결되지\s*않|해소\s*안\s*됨|해결\s*안\s*됨/g;
/**
 * 이 줄이 "끝난 항목"이라고 말하고 있나.
 * ⓐ 부정형(`미해결`)을 지운 뒤에 해소 표기가 남아야 한다.
 * ⓑ `유지`·`불변`·`연속` 같은 말이 있으면 보통 열린 항목이다. **다만 `✅` 가 그 말보다
 *    뒤에 오면 해소가 맞다** — `| E121 | … | ❌missing(3라운드 연속) | **✅full** |` 처럼
 *    앞 칸이 과거 이력을 적고 뒤 칸이 이번 판정을 적는 표가 흔하다. 이 경우를 못 걸러
 *    이미 ✅full 로 뒤집힌 항목 143건이 미해소로 남아 있었다(사서 보고 → 확인).
 */
function isClosed(line) {
  if (!DONE_RE.test(line.replace(NEG_DONE_RE, ''))) return false;
  if (!KEEP_RE.test(line)) return true;
  const tick = line.lastIndexOf('\u2705');
  if (tick < 0) return false;
  let lastKeep = -1, m;
  const re = new RegExp(KEEP_RE.source, 'g');
  while ((m = re.exec(line)) !== null) lastKeep = m.index + m[0].length;
  return tick > lastKeep;
}

function classify(line) {
  // 꼬리표가 붙어 있으면 그대로 쓴다.
  if (/wiki_lag/.test(line)) return 'wiki_lag';
  if (/content_gap/.test(line)) return 'content_gap';
  if (/collection_hole|uncollected|structural|genuine/.test(line)) return 'collection_hole';
  if (/\bREVIEW\b/.test(line)) return 'REVIEW';
  // 꼬리표가 없는 요약 행(법마다 형식이 달라 대부분 여기 온다) — 적힌 말로 가른다.
  if (/스코프|소관\s*(?:이\s*)?아님|범위\s*밖|타법\s*소관|세법|판례|법리\s*해석/.test(line)) return '스코프경계';
  if (/원문에\s*(?:는\s*)?없|규정\s*(?:자체\s*)?없|명문\s*(?:규정\s*)?없|입법\s*공백|조문\s*(?:자체\s*)?없|미제정/.test(line)) return '원문공백';
  return '미분류';
}
const LABEL = {
  wiki_lag: '원문엔 있는데 위키에 안 옮김 — **고칠 수 있음**',
  content_gap: '원문 자체에 규정 없음 — 정직 표기가 최선',
  collection_hole: '수집 관련 — 조회 기록 확인 필요(§6-B-1 ⓑ)',
  REVIEW: '사람 판단 필요',
  스코프경계: '이 법 소관이 아님 — 안내 문구가 닿는 자리에 있는지만 본다(§6-B-1 ⓐ)',
  원문공백: '원문 자체에 규정 없음(요약 행 표현으로 판정) — 조회 기록 확인 후 확정 공백으로',
  미분류: '사서가 유형을 갈라야 함',
};
const ORDER = ['wiki_lag', '미분류', 'collection_hole', '원문공백', 'content_gap', '스코프경계', 'REVIEW'];

/** 한 줄에서 라운드 표기(R23·23R·23라운드)를 찾아 숫자로. 없으면 0. */
function roundOf(line) {
  const m = /\bR(\d{1,2})\b|\b(\d{1,2})\s*R\b|(\d{1,2})\s*라운드/.exec(line);
  return m ? Number(m[1] || m[2] || m[3]) : 0;
}
/**
 * 중복 판정용 열쇠.
 * ⚠2026-08-20 실측 보정: 처음엔 줄 전체를 열쇠로 썼는데, **같은 항목이 라운드마다 표현만 조금
 *   바뀌어 다시 적히므로** 전부 다른 것으로 세어 38,566건이 나왔다 — 23차 감사 자체 집계
 *   (thin 5,409 + missing 5,366 = 10,775)의 3.6배다. 감사 요약 행은 대개
 *   `| 항목이름 | 출처 | ❌missing | 9회 | [[페이지]] |` 꼴이라 **첫 칸(항목 이름)** 이 그 항목의
 *   정체다. 표 행이면 첫 칸으로, 아니면 문장 앞머리로 잡는다.
 */
function keyOf(line) {
  let core = line;
  if (line.startsWith('|')) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // 첫 칸이 번호(#12·R13)뿐이면 그다음 칸이 항목 이름이다.
    core = (cells[0] && !/^[#R]?\d+$/.test(cells[0].replace(/[#\s]/g, ''))) ? cells[0] : (cells[1] || cells[0] || '');
  }
  return core.replace(/[|`*_#>\s]/g, '').replace(/[⚠❌✅📛]/g, '')
    .replace(/^\d+/, '').slice(0, 60);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 고정 ID(⟨BL-xxxxxxxx⟩) — 항목에 **이름을 붙여** 다음 라운드가 같은 것을 또 등록하지 못하게 한다.
 *
 * [왜 있나 — 2026-08-24 실측]
 * 이 도구는 `--write` 때 백로그 파일을 **통째로 덮어썼다.** 그래서 라운드가 돌 때마다
 *   ① 사서가 확인해 `- [x]` 로 바꿔 둔 표시가 사라지고  ② 같은 항목이 새 항목처럼 다시 등록되고
 *   ③ 그 결과 **남은 일이 몇 건인지 자체를 알 수 없었다**(23,529건 중 중복을 세는 방법이
 *      셋 다 무효였다 — backlog_id.py 머리말 참조).
 * 이제 항목마다 ID 를 달고, 다시 쓸 때 **옛 파일에 있던 같은 항목을 찾아 그 ID·확인표시·주석을
 * 그대로 이어받는다.** 새로 나온 항목만 새 ID 를 받는다.
 *
 * [ID 는 어떻게 만드나] `backlog_id.py` 와 **똑같은 계산**이다(법 + 정규화한 본문의 sha1 앞 8자리).
 *   2026-08-24 에 이미 붙어 있던 23,529건을 이 JS 로 다시 계산해 **23,529건 전부 일치**함을 확인했다.
 *   ⚠`SYM_RE` 의 `u` 플래그는 없으면 안 된다 — 없으면 🟡 같은 글자의 절반만 지워져
 *   Python 과 다른 값이 나온다(실측: 63건 어긋났다).
 *
 * [이어받기 열쇠는 ID 가 아니라 `keyOf` 다] ID 는 본문에서 나오는데, 감사는 라운드마다 그 항목에
 *   새 줄을 덧붙이므로 **본문이 바뀌면 ID 도 바뀐다.** 그래서 이어받을 때는 이 도구가 이미 쓰고 있는
 *   항목 정체(`keyOf` — 표 첫 칸/문장 앞머리)로 찾고, 찾으면 **옛 ID 를 그대로 물려준다.**
 *   즉 ID 는 **태어날 때 내용에서 나오고, 그 뒤로는 붙어 다닌다.**
 * ───────────────────────────────────────────────────────────────────────────── */
const crypto = require('crypto');
const BL_ID_RE = /⟨BL-[0-9a-f]{8}⟩/g;
const BL_NOTE_RE = /⟪[^⟫]*⟫/g;
const BL_ROUND_RE = /^\((?:R?\d+|라운드미상)\)\s*/;
const BL_SYM_RE = /[✅⚠❌📛〰🔓🔒🆙🔁]/gu;
/** backlog_id.py 의 norm() 과 같은 값을 낸다(2026-08-24 전수 대조로 확인). */
function blNorm(law, body) {
  let t = body.replace(BL_ID_RE, '').replace(BL_NOTE_RE, '');
  t = t.trim().replace(BL_ROUND_RE, '').replace(BL_SYM_RE, '');
  return law + '|' + t.replace(/\s+/g, '');
}
const blId = key => 'BL-' + crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 8);

/** 백로그 줄에서 감사 원문 부분만 되꺼낸다 — 앞의 라운드 표기와 뒤에 붙인 ⟨…⟩·⟪…⟫ 를 뗀다. */
function coreOf(body) {
  return body.replace(/⟨[^⟩]*⟩/g, '').replace(BL_NOTE_RE, '')
    .replace(/^\((?:R\d+(?:~R\d+)?|라운드미상)\)\s*/, '').trim();
}
/** 이미 있는 백로그 파일을 읽어 **항목 정체 → (ID·확인표시·주석·원래 줄)** 로 색인한다. */
function readPrev(p) {
  const idx = new Map();
  idx.extras = [];
  idx.ids = new Set();          // 이 파일에 있던 ID 전부(정체 매칭과 별개로 "정말 새 것인가"를 가리는 데 쓴다)
  if (!fs.existsSync(p)) return idx;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^- \[([ x])\] (.*)$/.exec(line);
    if (!m) continue;
    const k = keyOf(coreOf(m[2]));
    if (!k) continue;
    // 같은 정체(keyOf)가 둘인 줄이 드물게 있다(실측 1건). 이어받기는 먼저 것으로 하되,
    // **확인 근거가 적힌 줄은 버리지 않고 따로 담아** 아래 '닫힘' 절에 남긴다.
    if (idx.has(k)) {
      const dupId = /⟨(BL-[0-9a-f]{8})⟩/.exec(m[2]);
      if (dupId) idx.ids.add(dupId[1]);
      if (m[1] === 'x') idx.extras.push(line);
      continue;
    }
    const id = /⟨(BL-[0-9a-f]{8})⟩/.exec(m[2]);
    if (id) idx.ids.add(id[1]);
    idx.set(k, {
      id: id ? id[1] : null,
      checked: m[1] === 'x',
      notes: (m[2].match(BL_NOTE_RE) || []).join(' '),
      raw: line,
    });
  }
  return idx;
}

/**
 * ★집계·헤더 줄 걸러내기(2026-08-20 신설 — 사서 두 명이 독립적으로 보고).
 * 감사 파일에는 `| ⚠ thin | 86 | 22R 회귀 | ` 같은 **판정별 총계 행**과 `### G19. still_missing (6문항)`
 * 같은 절 헤더, `**§1 소계(29건)**: …` 같은 소계 줄이 섞여 있다. 이 줄들에도 `⚠thin`·`❌missing` 이
 * 적혀 있어 그대로 항목으로 뽑히는데, **가리키는 페이지도 조문도 없어 사서가 대조할 수가 없다.**
 * 실측 260건(전체의 1.1%). 지우는 규칙은 **좁게** 잡는다 — 진짜 항목을 지우는 쪽이 훨씬 나쁘다:
 *   ⓐ 절 헤더(`###`로 시작)  ⓑ 앞머리에 소계·합계·총계·집계가 있고 숫자가 있는 줄
 *   ⓒ 표 행인데 **판정 낱말만 든 칸**이 있고, **그 칸 뒤에** 순수 숫자 칸이 오고,
 *      물음표가 없고, 어느 칸도 한글 12자를 넘지 않는 것(= 서술이 없다)
 * ⓒ의 "판정 칸 뒤"가 핵심이다. 진짜 항목 행은 `| 248 | 협회 회비는…? | ❌missing | … |` 처럼
 * 숫자(문항번호)가 판정 **앞**에 온다. 이 조건을 빼면 진짜 항목 5,000건이 함께 지워졌다(실측).
 */
// ★숫자 뒤에 **띄어쓰기와 내역**이 붙는 꼴을 못 잡고 있었다(2026-08-24, 사서 보고로 발견).
//   `| ⚠ thin | 26 (1-B 18+2〈E101·E105 부분개선〉 + 2-A 1) |` 같은 판정 총계 행이
//   그대로 항목으로 뽑혀, 가리키는 조문도 페이지도 없어 사서가 대조할 수가 없었다.
//   실측: 이 완화로 새로 걸리는 것 5건(도선법 3 · 항만운송사업법 2). 전부 눈으로 확인했다.
const NUM_CELL = /^\**\s*(?:약\s*)?\d+\s*(?:\(.*\))?\s*\**$/;
const VERDICT_CELL = /^\**\s*(?:⚠|❌)?\s*(?:thin|missing|still_missing)\s*(?:\([^)]*\))?\s*\**$/;
// ★표가 아닌 줄인데 **판정어와 숫자만** 든 것(2026-08-24 신설).
//   `- ⚠thin 114 (wiki_lag/content_gap 구분은 R15/16 원표 참조)` 처럼 라운드 간 이월 개수만
//   적어 둔 줄이다. 어떤 질문인지 안 적혀 있어 **사서가 아무리 봐도 [x] 로 바꿀 근거를 못 만든다.**
//   실측 6건(수상레저기구법). 규칙을 아주 좁게 잡았다 — 판정어 바로 뒤에 숫자가 와야 한다.
const COUNT_ONLY = /^[-•*]?\s*[⚠❌]?\s*(?:thin|missing|still_missing)\s*\d+\s*(?:\(.*\))?$/;
// ★"코드 나열 + 판정 불변" 회귀요약 문장(2026-08-24 신설). 실측 1건(해양레저관광진흥법).
//   `E51·E54~E57 — 전부 판정 불변(콘텐츠 diff 없음).` — 그 코드들이 무슨 질문인지는
//   이 줄에 없고, 원래 정의가 담긴 옛 라운드 기록은 감사 파일에서 이미 사라져 대조가 불가능하다.
const REGRESS_SUMMARY = /^[A-Z]{1,3}\d+[^가-힣]{0,40}(?:—|-)\s*(?:전부\s*)?판정\s*불변/;

function isNoise(line) {
  if (/^#{2,6}\s/.test(line)) return true;
  if (COUNT_ONLY.test(line.trim())) return true;
  if (REGRESS_SUMMARY.test(line.trim())) return true;
  if (/(소계|합계|총계|집계)/.test(line.slice(0, 40)) && /\d/.test(line)) return true;
  if (!line.startsWith('|')) return false;
  const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const vi = cells.findIndex(c => VERDICT_CELL.test(c));
  if (vi < 0) return false;
  if (!cells.slice(vi + 1).some(c => NUM_CELL.test(c))) return false;
  if (line.includes('?')) return false;
  return cells.every(c => (c.match(/[가-힣]/g) || []).length < 12);
}

const files = fs.readdirSync(AUDIT).filter(f => f.endsWith('.md') && f !== '_횡단.md');
const only = arg('--law');
const rows = [];
for (const f of files) {
  const slug = f.slice(0, -3);
  if (only && slug !== only) continue;
  const lines = fs.readFileSync(path.join(AUDIT, f), 'utf8').split('\n');
  // ★감사 파일은 **덧붙이는 기록**이다 — 옛 라운드 줄은 그대로 남고 나중 라운드가 그 아래에
  //   "해소 확인"을 적는다. 그래서 "같은 줄에 해소 표시가 있나"만 보면, **나중에 고쳐진 것도
  //   옛 줄 때문에 미해소로 잡힌다.** 그 항목의 **마지막 언급**이 무엇이라 말하는지로 판정한다
  //   (2026-08-20 실측 보정 — 이 보정 전에는 한 라운드 집계의 2.4배가 나왔다).
  const seen = new Map();
  let curRound = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^#{2,3}\s*R(\d{1,2})\b/.exec(line);
    if (h) curRound = Number(h[1]);
    if (line.length < 25) continue;                 // 표 구분선·머리글 같은 부스러기
    if (isNoise(line)) continue;                    // 집계 총계 행·절 헤더·소계 줄
    const opened = OPEN_RE.test(line);
    const closed = isClosed(line);
    if (!opened && !closed) continue;               // 이 항목 얘기가 아니다
    const k = keyOf(line);
    if (!k) continue;
    const r = roundOf(line) || curRound;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, { line, first: r, last: r, cat: classify(line), open: opened && !closed }); continue; }
    // 같은 항목의 더 나중 언급이면 상태를 갈아끼운다(같은 라운드면 뒤에 적힌 줄이 최신이다).
    if (r >= prev.last) {
      prev.last = r;
      prev.open = opened && !closed;
      if (prev.open) { prev.line = line; prev.cat = classify(line); }
    }
  }
  for (const [k, v] of seen) if (!v.open) seen.delete(k);
  rows.push({ slug, items: [...seen.values()] });
}

// ★위키 현재 상태와 대조한다(2026-08-20 신설 → 같은 날 **범위를 좁혀 다시 씀**).
//   처음 만든 규칙은 "항목이 짚은 조문 번호가 그 법 위키 어딘가에 있으면 `이미반영?`"이었다.
//   8,862건이 그리로 갔는데, **그중 1,353건은 감사관이 바로 그 줄에 "위키에 없음"이라고
//   적어 둔 항목**이었다 — 기계가 사람 관찰을 덮어썼다. 원인은 규칙이 너무 헐거운 것이다:
//   「제6조」는 어느 법 위키에도 나오므로 아무것도 가르지 못한다. 낱말 겹침(3글자 n-gram)으로
//   조여 봐도 마찬가지였다 — **감사 항목은 "무엇이 없는지"를 위키의 말로 적기 때문에**,
//   글자가 겹친다는 사실이 "이미 반영됐다"는 뜻이 되지 못한다. 그래서 그 갈래를 버린다.
//   "이미 고쳐졌나"는 기계가 못 정한다 — 사서가 위키를 읽고 판단할 일이다(파일 머리말에 그렇게 적었다).
//
//   대신 **반대 방향만** 남긴다. 이건 논리적으로 성립한다:
//     항목이 짚은 조문 번호가 그 법 위키에 **하나도 없으면**, 그 항목은 확실히 안 고쳐졌다.
//   이 표시는 버리는 데 쓰지 않고 **먼저 볼 것을 고르는 데**만 쓴다.
const WIKI = path.join(LEGAL, 'wiki');
const wikiCache = new Map();
function wikiTextOf(slug) {
  if (wikiCache.has(slug)) return wikiCache.get(slug);
  let t = '';
  for (const kind of ['concepts', 'statutes', 'annexes']) {
    const d = path.join(WIKI, kind);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f === slug + '.md' || f.startsWith(slug + '__')) t += fs.readFileSync(path.join(d, f), 'utf8');
    }
  }
  wikiCache.set(slug, t);
  return t;
}
const ART_RE = /제\s*\d+조(?:의\d+)?|별표\s*\d+(?:의\d+)?|별지\s*제\s*\d+호/g;
let certainlyOpen = 0;
for (const r of rows) {
  // ⚠**양쪽을 같은 방식으로 눌러서 비교한다**(2026-08-20 오탐으로 발견).
  //   항목 쪽 토큰만 공백을 지우고 위키 원문은 그대로 두면, 위키의 `별지 제10호서식` 이
  //   `별지제10호` 와 안 맞아 "위키에 없다"가 된다. 실제로 무인도서법 3건이 그렇게 잘못 찍혔다
  //   (본문에 토씨까지 그대로 있는데 마커가 붙었다). 정규화는 **비교하는 두 쪽 모두**에 건다.
  const text = wikiTextOf(r.slug).replace(/\s+/g, '');
  if (!text) continue;
  for (const it of r.items) {
    const arts = [...new Set((it.line.match(ART_RE) || []).map(a => a.replace(/\s+/g, '')))];
    if (!arts.length) continue;
    // ★`every` 다 — `some` 이 아니다. "확실히 미해소"라고 말할 수 있는 것은 짚은 조문이
    //   **하나도** 위키에 없을 때뿐이다. 하나만 빠져도 마커를 붙이면 그 단언이 성립하지 않는다.
    if (arts.every(a => !text.includes(a))) { it.absent = true; certainlyOpen++; }
  }
}

rows.sort((a, b) => b.items.length - a.items.length);
const total = rows.reduce((s, r) => s + r.items.length, 0);
const byCat = {};
rows.forEach(r => r.items.forEach(i => { byCat[i.cat] = (byCat[i.cat] || 0) + 1; }));

console.log(`감사 파일 ${rows.length}개에서 뽑은 **미해소 thin·missing** : ${total.toLocaleString()}건\n`);
for (const c of ORDER) if (byCat[c]) console.log(`  ${String(byCat[c]).padStart(5)}  ${c.padEnd(16)} ${LABEL[c]}`);
console.log(`\n  그중 ${certainlyOpen.toLocaleString()}건은 **짚은 조문이 그 법 위키에 아예 없다** = 확실히 미해소(먼저 볼 것).`);
console.log('\n건수 상위 12개 법:');
rows.slice(0, 12).forEach(r => {
  const lag = r.items.filter(i => i.cat === 'wiki_lag').length;
  console.log(`  ${String(r.items.length).padStart(4)}건 (그중 고칠 수 있음 ${String(lag).padStart(3)})  ${r.slug}`);
});

if (argv.includes('--write')) {
  fs.mkdirSync(OUT, { recursive: true });
  let carried = 0, fresh = 0, rematched = 0, done = 0, dropped = 0, droppedDone = 0, dupSkipped = 0, idRemint = 0;
  for (const r of rows) {
    if (!r.items.length) continue;
    const g = {};
    r.items.forEach(i => { (g[i.cat] = g[i.cat] || []).push(i); });
    let md = `# ${r.slug} — 미해소 백로그 (기계 추출, ${r.items.length}건)\n\n`;
    md += '> `_dashboard/audit/' + r.slug + '.md` 에서 **해소 표시가 없는 `⚠thin`·`❌missing` 줄만** 뽑았다.\n';
    md += `> 감사 파일을 통독하지 말고 **이 목록만** 보고 고치면 된다(H-43).\n`;
    md += `> ⚠기계가 줄 단위로 골랐으므로 **이미 고쳐졌는데 표기만 안 바뀐 것이 섞여 있다.**\n`;
    md += `>   "이미 고쳐졌나"는 기계가 못 가른다(2026-08-20 시도했다 실패 — backlog_extract.js 주석 참조).\n`;
    md += `>   그러니 각 항목은 **위키 현재 상태를 먼저 확인**하고, 이미 해소됐으면 고치지 말고\n`;
    md += `>   \`- [x]\` 로 바꾸며 근거를 \`(확인: <파일>:<줄>)\` 로 적는다. 안 됐으면 그때 고친다.\n`;
    md += `>   \`⟨짚은 조문이 위키에 없음⟩\` 표시가 붙은 항목은 확인 없이도 미해소가 확실하다 — 먼저 본다.\n\n`;
    const dst = path.join(OUT, `${r.slug}.md`);
    // ★옛 파일을 먼저 읽어 둔다 — 사서가 해 둔 일(확인표시·주석)과 ID 를 잃지 않기 위해서다.
    const prev = readPrev(dst);
    const law = r.slug.replace(/_\d+라운드$/, '');
    const used = new Set();
    // ★한 파일 안에서 **같은 이름표가 두 번 나오지 않게** 한다(2026-08-27 신설).
    //   실측: 지금 백로그 101개 파일에 같은 이름표가 두 자리에 있는 항목이 74건 있고,
    //   그중 대부분이 `## 미분류` 와 `## 닫힘` 에 동시에 들어가 있었다. 사서 셋이 각각 보고했다
    //   (수산업협동조합법 2건 · 해양레저관광진흥법 8건 · 해운법 1건).
    //   사서 입장에서는 **이미 근거까지 달아 닫은 항목이 미해소로 다시 떠 있는 것**이라
    //   같은 확인을 또 하게 된다. 게다가 한번 생기면 다음 실행이 그대로 다시 만들어 낸다.
    //   여기서 두 가지를 막는다:
    //     ⓐ 활성 절에 쓴 이름표는 '닫힘' 절에 다시 쓰지 않는다.
    //     ⓑ 같은 이름표가 두 항목에 붙으려 하면 뒤엣것은 **내용에서 새로 만든다**
    //        (이어받기 열쇠 `keyOf` 가 짧아 남의 이름표를 물려받는 경우가 있다 —
    //         실측: 같은 파일 안에서 열쇠가 겹치는 항목이 42건이다).
    const seenIds = new Map();
    const claimId = (want, body) => {
      let id = want;
      if (seenIds.has(id)) {
        id = blId(blNorm(law, body));
        let n = 0;
        while (seenIds.has(id)) id = blId(blNorm(law, body) + '#' + (++n));
        idRemint++;
      }
      seenIds.set(id, true);
      return id;
    };
    for (const c of ORDER) {
      if (!g[c]) continue;
      md += `## ${c} (${g[c].length}건) — ${LABEL[c]}\n\n`;
      g[c].sort((a, b) => a.first - b.first);
      for (const i of g[c]) {
        const age = i.first ? `R${i.first}${i.last > i.first ? `~R${i.last}` : ''}` : '라운드미상';
        const mark = i.absent ? ' ⟨짚은 조문이 위키에 없음 — 확실히 미해소⟩' : '';
        const body = `(${age}) ${i.line.replace(/\n/g, ' ')}${mark}`;
        const k = keyOf(i.line);
        const p = prev.get(k);
        if (p) used.add(k);
        if (p && p.checked) {
          // 사서가 이미 확인해 끝낸 항목이다. 감사가 표현을 바꿔 다시 적었더라도 **손대지 않는다.**
          md += p.raw + '\n';
          if (p.id) seenIds.set(p.id, true);
          carried++; done++;
          continue;
        }
        const id = claimId((p && p.id) ? p.id : blId(blNorm(law, body)), body);
        // ★"정체 매칭이 어긋난 것"과 "정말 처음 보는 항목"은 다르다(2026-08-24 실측으로 갈랐다).
        //   사서가 줄을 손보면 정체(keyOf)가 달라져 이어받기에 실패할 수 있는데, ID 는 내용에서
        //   나오므로 내용이 그대로면 **같은 ID 가 다시 나온다.** 그래서 ID 가 옛 파일에 있었는지로
        //   센다. 이렇게 안 세면 "새로 등록 88건"으로 나오지만 실제 새 항목은 7건뿐이다.
        if (p && p.id) carried++;
        else if (prev.ids.has(id)) rematched++;
        else fresh++;
        md += `- [ ] ${body}${p && p.notes ? '  ' + p.notes : ''}  ⟨${id}⟩\n`;
      }
      md += '\n';
    }
    // 옛 파일에 있었는데 이번 추출에는 안 나온 항목 = 감사가 "이제 해소됐다"고 적었다는 뜻이다.
    // 그중 **사서가 확인해 근거까지 적어 둔 것(`- [x]`)은 지우지 않고 아래 '닫힘' 절에 남긴다.**
    //   왜: 감사 표현이 다음 라운드에 또 흔들려 그 항목이 되살아나면, 기록이 없으면 **새 항목처럼
    //   다시 등록되고 사서가 같은 확인을 처음부터 다시 한다** — 이 도구를 고친 이유가 바로 그것이다.
    //   여기 남은 줄은 다음 실행 때 `readPrev` 가 다시 읽으므로 ID·근거가 계속 따라다닌다.
    const closed = [];
    // 활성 절에 이미 쓴 이름표는 '닫힘' 에 다시 넣지 않는다(중복의 주된 경로였다).
    const idOf = raw => (/⟨(BL-[0-9a-f]{8})⟩/.exec(raw) || [])[1] || null;
    const pushClosed = raw => {
      const id = idOf(raw);
      if (id && seenIds.has(id)) { dupSkipped++; return; }
      if (id) seenIds.set(id, true);
      droppedDone++; closed.push(raw);
    };
    for (const [k, v] of prev) {
      if (used.has(k)) continue;
      if (v.checked) pushClosed(v.raw); else dropped++;
    }
    for (const raw of prev.extras) pushClosed(raw);
    if (closed.length) {
      md += `## 닫힘 (${closed.length}건) — 감사가 해소로 적었고 사서 확인 근거가 있는 것. **기록만 남긴다(할 일 아님).**\n\n`;
      md += closed.join('\n') + '\n\n';
    }
    fs.writeFileSync(dst, md);
  }
  console.log(`\n저장: ${path.relative(LEGAL, OUT)}/ (${rows.filter(r => r.items.length).length}개 파일)`);
  console.log('■ 고정 ID');
  console.log(`   중복 이름표 정리     : 닫힘 절에서 뺀 것 ${dupSkipped.toLocaleString()}건 (활성 절에 이미 있던 항목) · 새로 만든 것 ${idRemint.toLocaleString()}건 (남의 이름표를 물려받으려던 항목)`);
  console.log(`   옛 파일에서 이어받음 : ${carried.toLocaleString()}건 (그중 이미 확인 끝난 것 ${done.toLocaleString()}건)`);
  console.log(`   ID 로 다시 찾음      : ${rematched.toLocaleString()}건 (사서가 줄을 손봐 정체 매칭은 어긋났지만 내용이 같아 같은 ID)`);
  console.log(`   새로 등록(진짜 새 것) : ${fresh.toLocaleString()}건`);
  console.log(`   닫힘 절에 보존       : ${droppedDone.toLocaleString()}건 (감사는 해소라 하고, 사서 확인 근거가 남아 있는 것)`);
  console.log(`   목록에서 버림        : ${dropped.toLocaleString()}건 (감사가 해소라 했고 사서 확인 근거도 없는 것)`);
  console.log('     └ 버림 = 감사가 이번엔 그 줄을 미해소로 안 적었다는 뜻이다. 갑자기 크게 늘면 추출 규칙을 의심할 것.');
}
