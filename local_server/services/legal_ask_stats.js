/**
 * ============================================================================
 * 파일명: services/legal_ask_stats.js
 * 역할: 나리야 법률봇에 들어온 질문 수를 날짜(KST)별로 세어 1년(365일) 보관한다.
 *       관리자 센터 「질문 수」 카드가 이 숫자를 보여 준다. **질문 내용은 저장하지 않고 숫자만** 남긴다.
 * ============================================================================
 * [사용자 확정 2026-11-02] 날짜별 전체·관리자/일반·마지막에 답한 AI·실패를 센다. 1년 보관. 숫자만.
 *
 * [「질문 1건」 기준 — routes/legal.js POST /api/legal/ask 를 끝까지 읽고 정함]
 *   그 라우트는 한 번의 요청이 두 갈래 중 하나로 끝난다.
 *   ① 되묻기(확인 카드) — 이해확인·상황질문·프로필확인·「잘 모르겠어요」풀이·해역 트리 되묻기·
 *      쪼개진 법 되묻기·AI 되묻기·모르는 구어 확인. 사용자가 버튼을 누르면 **같은 질문으로 요청이 또 온다.**
 *   ② 최종 — 답변(1차 합성·2차 원문 직독·해역 트리 답), 또는 답을 못 냄(근거 없음·생성 실패·
 *      모르는 구어 포기·처리 중 오류).
 *   한 사용자 질문은 되묻기를 몇 번 거치든 **최종(②)으로는 한 번만** 끝난다. 그래서
 *   **전체(total)는 ②만 센다** — 되묻기 요청까지 세면 같은 질문이 되묻기 횟수만큼 두 번·세 번 세진다.
 *   ①은 별도 칸 clarify(「되묻기 카드를 낸 횟수」)로 센다 — total 에 더하지 않는다.
 *   ⚠한계: 되묻기 카드에서 사용자가 그만두면(버튼을 안 누르면) 그 질문은 total 에 안 들어가고 clarify 에만 남는다.
 *   빈 질의(400)는 질문이 아니라 세지 않는다.
 *
 * [칸] total = admin + user · total = failed + (ai 각 칸의 합)
 *   ai: upstage·claude1·claude2·chatgpt·gemini = 그 답을 쓴 AI(답변 끝 「※ 이 답변은 …」 표시와 같은 판정 —
 *       codex_bridge.answerLabel 과 같은 규칙) · rule = AI 없이 해역 트리가 정해 준 답.
 *
 * [연계]
 *   - 사용 파일 : services/atomic_write.js(원자적 쓰기) · services/codex_bridge.js(요청 범위 store — 어느 AI 가 답했나)
 *                 data/legal_ask_stats.json (fly.toml 볼륨 /app/local_server/data — 재배포·재시작 뒤에도 남는다)
 *   - 호출처    : routes/legal.js POST /api/legal/ask(record·providerNow) · GET /api/legal/admin/ask-stats(summary)
 *   - 화면      : client/js/ai-chat/ai_chat.js 관리자 콘솔 「질문 수」 카드
 *   - 환경변수  : LEGAL_ASK_STATS_FILE (저장 파일 경로 바꾸기 — 시험이 운영 data 파일을 건드리지 않게 임시 폴더로 돌린다)
 *   - 시험      : scripts/test_legal_ask_stats.js
 * [로드 순서] 서버 모듈 — require 순서 무관. 파일은 처음 쓸 때(record·summary) 읽는다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic_write');
const codexBridge = require('./codex_bridge');

const FILE = String(process.env.LEGAL_ASK_STATS_FILE || '').trim() || path.join(__dirname, '..', 'data', 'legal_ask_stats.json');
const KEEP_DAYS = 365;                 // 오늘 포함 365일(오늘 − 364일 ~ 오늘)
const DAY_MS = 24 * 3600 * 1000;
const KST_MS = 9 * 3600 * 1000;
const AIS = ['upstage', 'claude1', 'claude2', 'chatgpt', 'gemini', 'rule'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let days = null;                       // 'YYYY-MM-DD'(KST) → 칸 묶음. 처음 쓸 때 load() 가 채운다.

/**
 * 시각(ms)을 KST 날짜 문자열로 바꾼다.
 * 예: kstDate(Date.parse('2026-11-01T15:00:00Z')) → '2026-11-02' (KST 자정)
 * @param {number} ms @returns {string} 'YYYY-MM-DD'
 * [연계] ← record·summary·prune.
 */
function kstDate(ms) {
  return new Date(ms + KST_MS).toISOString().slice(0, 10);
}

/** 빈 하루 칸. @returns {object} */
function emptyRow() {
  const ai = {};
  AIS.forEach((k) => { ai[k] = 0; });
  return { total: 0, admin: 0, user: 0, failed: 0, clarify: 0, ai };
}

/**
 * 파일에서 읽은 하루 칸을 검사해 숫자만 남긴다(음수·소수·문자는 0).
 * 예: normRow({ total: 3, ai: { gemini: 2, x: 9 } }) → { total:3, admin:0, …, ai:{ …, gemini:2 } }
 * @param {any} v @returns {object}
 * [연계] ← load.
 */
function normRow(v) {
  const n = (x) => (Number.isInteger(x) && x > 0 ? x : 0);
  const r = emptyRow();
  if (!v || typeof v !== 'object') return r;
  ['total', 'admin', 'user', 'failed', 'clarify'].forEach((k) => { r[k] = n(v[k]); });
  const ai = v.ai && typeof v.ai === 'object' ? v.ai : {};
  AIS.forEach((k) => { r.ai[k] = n(ai[k]); });
  return r;
}

/**
 * 저장 파일을 읽어 days 를 채운다(처음 한 번). 파일 없음 → 빈 상태. 읽기 실패·손상 → 빈 상태 + 로그.
 * 예: {"version":1,"days":{"2026-11-02":{"total":5,…}}}
 * [연계] ← record·summary. saveState 가 쓴 것을 읽는다.
 */
function load() {
  if (days) return;
  days = {};
  let j;
  try {
    j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[질문 수] 저장 파일 읽기 실패 → 빈 상태로 시작 file=${FILE} err=${String(e.message || e).slice(0, 200)}`);
    return;
  }
  const d = j && typeof j === 'object' && j.days && typeof j.days === 'object' && !Array.isArray(j.days) ? j.days : null;
  if (!d) { console.error(`[질문 수] 저장 파일 모양이 틀림 → 빈 상태로 시작 file=${FILE}`); return; }
  Object.keys(d).forEach((k) => { if (DATE_RE.test(k)) days[k] = normRow(d[k]); });
}

/**
 * 365일이 지난 날짜를 지운다(오늘 − 364일보다 앞선 날짜). 지운 게 있으면 true.
 * 예: 오늘이 2026-11-02 면 2025-11-03 은 남고 2025-11-02 는 지운다.
 * @param {number} now - 지금 시각(ms) @returns {boolean}
 * [연계] ← record·summary.
 */
function prune(now) {
  const cutoff = kstDate(now - (KEEP_DAYS - 1) * DAY_MS);
  let gone = false;
  Object.keys(days).forEach((k) => { if (k < cutoff) { delete days[k]; gone = true; } });
  return gone;
}

/** days 를 저장 파일에 원자적으로 쓴다. 실패하면 로그만(메모리 숫자는 계속 센다). [연계] ← record. → writeFileAtomic. */
function save() {
  try {
    writeFileAtomic(FILE, JSON.stringify({ version: 1, days, savedAt: new Date().toISOString() }));
  } catch (e) {
    console.error(`[질문 수] 저장 파일 쓰기 실패(메모리로 계속) file=${FILE} err=${String(e.message || e).slice(0, 200)}`);
  }
}

/**
 * 요청 하나의 결과를 센다. **던지지 않는다**(집계 실패가 답변 흐름을 깨면 안 된다).
 * 예: record({ admin: false, outcome: 'answered', ai: 'claude2' }) → 오늘 total+1·user+1·ai.claude2+1
 *     record({ admin: true, outcome: 'clarify' }) → 오늘 clarify+1 (total 은 그대로)
 * @param {{admin:boolean, outcome:'answered'|'failed'|'clarify', ai?:string, now?:number}} o
 *   now: 시험이 고정 시각을 넣을 때만. 없으면 Date.now().
 * [연계] ← routes/legal.js POST /api/legal/ask(요청마다 한 번 — 그 라우트의 countAsk 가 두 번 안 부르게 막는다).
 */
function record(o) {
  try {
    const now = Number.isFinite(o && o.now) ? o.now : Date.now();
    load();
    prune(now);
    const d = kstDate(now);
    const r = days[d] || (days[d] = emptyRow());
    if (o.outcome === 'clarify') r.clarify++;
    else {
      r.total++;
      r[o.admin ? 'admin' : 'user']++;
      if (o.outcome === 'failed') r.failed++;
      else if (AIS.includes(o.ai)) r.ai[o.ai]++;
    }
    save();
  } catch (e) {
    console.error(`[질문 수] 집계 실패(답변에는 영향 없음) err=${String(e && e.message || e).slice(0, 200)}`);
  }
}

/**
 * 지금 이 요청에서 마지막으로 답을 쓴 AI 이름. codex_bridge.answerLabel(답변 끝 표시줄)과 같은 판정이다.
 *   사슬 요청이면 store().used(마지막으로 성공한 AI), codex 직행(llm:"codex")이면 chatgpt, 그 밖(Gemini 경로)은 gemini.
 * 예: 사슬 요청에서 클로드 키2 가 답을 흘린 직후 → 'claude2'
 * @returns {'upstage'|'claude1'|'claude2'|'chatgpt'|'gemini'}
 * [연계] ← routes/legal.js POST /api/legal/ask(answerLabel 을 부르는 두 자리 바로 옆). → codex_bridge.store.
 */
function providerNow() {
  const s = codexBridge.store();
  const used = s && s.chain ? s.used : null;
  if (used === 'upstage' || used === 'claude1' || used === 'claude2' || used === 'chatgpt') return used;
  if (s && s.codex) return 'chatgpt';
  return 'gemini';
}

/** 여러 날 칸을 더한다. @param {string[]} keys @returns {object} */
function sumOf(keys) {
  const t = emptyRow();
  keys.forEach((k) => {
    const r = days[k]; if (!r) return;
    ['total', 'admin', 'user', 'failed', 'clarify'].forEach((f) => { t[f] += r[f]; });
    AIS.forEach((a) => { t.ai[a] += r.ai[a]; });
  });
  return t;
}

/**
 * 관리자 화면용 요약 — 날짜별 목록(최신 먼저)과 오늘·어제·최근 7일·최근 30일 합계(모두 오늘 포함, KST)
 *   · all = 보관 중인 날짜 전부(최대 365일)의 합 — 관리자 콘솔 「질문 수」 아코디언 머리 「총 N건」(2026-11-02 사용자 요청).
 * 예: summary() → { today:'2026-11-02', days:[{date:'2026-11-02', total:5, …}], sums:{ today, yesterday, d7, d30, all } }
 * @param {number} [now] - 시험이 고정 시각을 넣을 때만
 * @returns {{today:string, keepDays:number, days:object[], sums:{today:object, yesterday:object, d7:object, d30:object, all:object}}}
 * [연계] ← routes/legal.js GET /api/legal/admin/ask-stats.
 */
function summary(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  load();
  prune(t);
  const back = (n) => Array.from({ length: n }, (_, i) => kstDate(t - i * DAY_MS));
  return {
    today: kstDate(t),
    keepDays: KEEP_DAYS,
    days: Object.keys(days).sort().reverse().map((k) => Object.assign({ date: k }, days[k])),
    sums: { today: sumOf(back(1)), yesterday: sumOf([kstDate(t - DAY_MS)]), d7: sumOf(back(7)), d30: sumOf(back(30)), all: sumOf(Object.keys(days)) },
  };
}

module.exports = { record, providerNow, summary, kstDate, AIS, KEEP_DAYS, FILE };
