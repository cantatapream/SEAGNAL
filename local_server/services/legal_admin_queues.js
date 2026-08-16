/**
 * ============================================================================
 * 파일명: services/legal_admin_queues.js
 * 역할  : 관리자 검토센터 3개 방(피드백·새지식후보·개정검토)이 공유하는 JSONL 큐
 *         read/append/decide 헬퍼. (초보자용: review_queue.md는 사람이 손으로 쓰는
 *         마크다운이지만, 이 3개 방은 서버가 자동으로 쌓는 로그라서 한 줄에 항목
 *         하나씩 저장하는 JSONL이 더 맞다 — 대신 형태(구조)는 review_queue.md와
 *         같은 원칙: 원본 로그는 지우지 않고 'status' 필드만 갱신)
 * ----------------------------------------------------------------------------
 * [설계] review_queue.md 승인 이력(review_approvals.json)과 다르게, 이 3개 방은
 *   아직 볼륨이 적어 "로그 파일 + 별도 검토 파일" 2단 구조(각 README가 원래 그린
 *   설계) 대신 파일 하나에 status 필드로 상태를 관리하는 단순화를 택했다 — 볼륨이
 *   늘면 review_queue.md 패턴(원장+승인이력 분리)으로 확장 검토.
 * [연계] ← routes/legal.js(피드백·새지식후보·개정검토 API), services/legal_amendment_scanner.js
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic_write');

/** JSONL 파일을 파싱해 배열로. 파일 없으면 []. 손상된 줄은 건너뛴다(전체 실패 방지). @param {string} file @returns {object[]} */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch (_) { /* 손상 줄 스킵 */ }
  }
  return out;
}

/** 한 줄 append(단순 append — 스캐너·POST 핸들러 각각 자기 파일만 쓰므로 동시쓰기 경합 없음). @param {string} file @param {object} entry */
function appendJsonl(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * id로 항목을 찾아 patch를 병합하고 파일 전체를 원자적으로 재기록한다(승인/반려 등
 * 상태 변경용 — append가 아니라 update이므로 파일을 통째로 다시 씀).
 * @param {string} file @param {string} id @param {object} patch @returns {object|null} 갱신된 항목(못 찾으면 null)
 */
function updateJsonlById(file, id, patch) {
  const items = readJsonl(file);
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return null;
  items[idx] = Object.assign({}, items[idx], patch);
  const body = items.length ? items.map((it) => JSON.stringify(it)).join('\n') + '\n' : '';
  writeFileAtomic(file, body);
  return items[idx];
}

/** 대기(status가 없거나 'pending') 항목 수만 센다 — 관리자 서브탭 배지용. @param {string} file @returns {number} */
function countPending(file) {
  return readJsonl(file).filter((e) => (e.status || 'pending') === 'pending').length;
}

module.exports = { readJsonl, appendJsonl, updateJsonlById, countPending };
