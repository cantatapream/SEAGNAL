/**
 * ============================================================================
 * 파일명: services/nariya_exposure_schedule.js
 * 역할: 나리야 챗봇 버튼의 「자동 노출 시간」 계산기. 매일 KST 노출 시각(기본 08:00)에는
 *       모든 사용자에게 노출('user'), 비노출 시각(기본 19:00)에는 아무에게도 안 보이게('off') 한다.
 *       (초보자용: 시계를 보고 "지금 챗봇 버튼을 보여 줄 시간인가"를 그때그때 계산한다)
 * ----------------------------------------------------------------------------
 * [동작 원리 — 2026-11-02 사용자 확정]
 *  - 타이머·예약 작업이 없다. GET/POST /api/legal/config 가 **요청이 올 때마다** 지금 시각으로
 *    「유효 노출」을 계산한다 → 서버가 재시작·재배포되어도 어긋날 것이 없다.
 *  - 서버(Fly)는 UTC 로 돌 수 있으므로 TZ 환경변수에 기대지 않고 UTC 에 9시간을 직접 더한다
 *    (services/effective_date.js todayKST 와 같은 관례).
 *  - 자동이 켜져 있을 때 관리자가 노출을 손으로 바꾸면 그 시각(exposureManualAt)을 저장해 두고,
 *    **그 시각 이후 아직 경계(노출·비노출 시각)를 한 번도 지나지 않았으면** 손으로 고른 값을 쓴다.
 *    경계를 지나는 순간 다시 시간표 값으로 돌아간다(파일을 고치지 않아도 계산만으로 돌아간다).
 *  - 노출 시각이 비노출 시각보다 늦으면(예: 노출 20:00 · 비노출 06:00) 자정을 넘기는 창으로 본다.
 *    두 시각이 같으면 창을 정할 수 없어 저장을 거절한다(routes/legal.js POST 400).
 * [연계]
 *  - 사용처 : routes/legal.js normConfig(필드 정규화) · GET/POST /api/legal/config(유효 노출 계산)
 *  - 화면   : client/js/ai-chat/ai_chat.js (관리자 콘솔 노출 카드 · FAB 표시 · 다음 전환 시각 재조회)
 *  - 시험   : scripts/test_nariya_exposure_schedule.js (시각은 setNowForTest 로 주입)
 * ============================================================================
 */
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_ON_AT = '08:00';
const DEFAULT_OFF_AT = '19:00';

let _nowOverride = null;

/**
 * 지금 시각(ms, UTC 기준 epoch). 시험이 주입한 값이 있으면 그것.
 * 예: now() → 1793000000000
 * @returns {number}
 * [연계] ← routes/legal.js(GET/POST config). 시험은 setNowForTest 로 고정한다.
 */
function now() { return _nowOverride !== null ? _nowOverride : Date.now(); }

/**
 * 시험용 시각 고정. null 이면 해제.
 * 예: setNowForTest(Date.parse('2026-11-02T10:00:00Z')) → 그 순간을 19:00 KST 로 본다
 * @param {number|null} ms
 */
function setNowForTest(ms) { _nowOverride = (typeof ms === 'number') ? ms : null; }

/**
 * 'HH:MM'(00:00~23:59) 형식인지.
 * 예: isHHMM('08:00') → true · isHHMM('8:00') → false · isHHMM('24:00') → false
 * @param {*} s @returns {boolean}
 */
function isHHMM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

/** 'HH:MM' → 하루 중 몇 분째. 예: toMin('19:00') → 1140 @param {string} s @returns {number} */
function toMin(s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); }

/**
 * 저장값에서 노출·비노출 시각 쌍을 정리한다. 형식이 틀리거나 둘이 같으면 기본값(08:00·19:00) 쌍.
 * 예: normTimes({exposureOnAt:'07:30'}) → {onAt:'07:30', offAt:'19:00'} · normTimes({exposureOnAt:'19:00'}) → 기본 쌍
 * @param {object} c - 저장된 설정 @returns {{onAt:string, offAt:string}}
 * [연계] ← routes/legal.js normConfig.
 */
function normTimes(c) {
  const onAt = isHHMM(c && c.exposureOnAt) ? c.exposureOnAt : DEFAULT_ON_AT;
  const offAt = isHHMM(c && c.exposureOffAt) ? c.exposureOffAt : DEFAULT_OFF_AT;
  return onAt === offAt ? { onAt: DEFAULT_ON_AT, offAt: DEFAULT_OFF_AT } : { onAt, offAt };
}

/**
 * 시간표만으로 본 노출값. 노출 시각 ≤ 지금 < 비노출 시각이면 'user', 아니면 'off'(자정 넘김 창 지원).
 * 예: scheduledAt('08:00','19:00', 18:59 KST) → 'user' · 19:00 KST → 'off'
 * @param {string} onAt @param {string} offAt @param {number} ms @returns {'user'|'off'}
 */
function scheduledAt(onAt, offAt, ms) {
  const d = new Date(ms + KST_MS);
  const t = d.getUTCHours() * 60 + d.getUTCMinutes();
  const on = toMin(onAt), off = toMin(offAt);
  const inside = on < off ? (t >= on && t < off) : (t >= on || t < off);
  return inside ? 'user' : 'off';
}

/**
 * 지금 바로 앞(≤ ms)과 바로 뒤(> ms)의 경계 시각(노출·비노출 시각)을 구한다.
 * 예: boundaries('08:00','19:00', 20:00 KST) → {last: 오늘 19:00, next: 내일 08:00}
 * @param {string} onAt @param {string} offAt @param {number} ms @returns {{last:number, next:number}}
 */
function boundaries(onAt, offAt, ms) {
  const dayStart = Math.floor((ms + KST_MS) / DAY_MS) * DAY_MS - KST_MS;   // 오늘 KST 00:00 의 epoch
  let last = -Infinity, next = Infinity;
  for (const dd of [-1, 0, 1]) {
    for (const hm of [onAt, offAt]) {
      const b = dayStart + dd * DAY_MS + toMin(hm) * 60000;
      if (b <= ms && b > last) last = b;
      if (b > ms && b < next) next = b;
    }
  }
  return { last, next };
}

/**
 * 정규화된 설정과 지금 시각으로 「유효 노출」과 다음 전환을 계산한다.
 * 예(자동 켜짐, 10:00 KST) → {exposure:'user', exposureSource:'schedule', exposureNext:{at:'…T10:00:00.000Z', kst:'19:00', exposure:'off', inMs:32400000}}
 * 예(자동 켜짐, 20:00 KST 에 관리자가 'admin' 으로 바꿈) → {exposure:'admin', exposureSource:'override', exposureNext:{kst:'08:00', exposure:'user', …}}
 * 예(자동 꺼짐) → {exposure: 저장값, exposureSource:'manual', exposureNext:null}
 * @param {{exposure:string, exposureAuto:boolean, exposureOnAt:string, exposureOffAt:string, exposureManualAt:string|null}} cfg
 * @param {number} ms - 지금 시각
 * @returns {{exposure:string, exposureSource:string, exposureNext:object|null}}
 * [연계] ← routes/legal.js GET/POST /api/legal/config 응답(이 값의 exposure 가 저장값을 덮어 클라에 간다).
 */
function describe(cfg, ms) {
  if (!cfg.exposureAuto) return { exposure: cfg.exposure, exposureSource: 'manual', exposureNext: null };
  const { onAt, offAt } = normTimes(cfg);
  const { last, next } = boundaries(onAt, offAt, ms);
  const manualAt = cfg.exposureManualAt ? Date.parse(cfg.exposureManualAt) : NaN;
  const override = Number.isFinite(manualAt) && manualAt >= last;
  const nextKst = new Date(next + KST_MS).toISOString().slice(11, 16);
  return {
    exposure: override ? cfg.exposure : scheduledAt(onAt, offAt, ms),
    exposureSource: override ? 'override' : 'schedule',
    exposureNext: { at: new Date(next).toISOString(), kst: nextKst, exposure: scheduledAt(onAt, offAt, next), inMs: next - ms },
  };
}

module.exports = { DEFAULT_ON_AT, DEFAULT_OFF_AT, now, setNowForTest, isHHMM, normTimes, scheduledAt, boundaries, describe };
