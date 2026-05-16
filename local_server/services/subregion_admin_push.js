/**
 * [자식해역 관련 관리자 푸시 발송]
 *
 * 정책 06_ADMIN_PUSH_POLICY.md 의 9가지 케이스를 처리한다.
 * 기존 sendAdminPush(title, body, data) 시그니처에 맞춰 호출.
 *
 * 빈도 제어:
 *   같은 (category, key) 조합이 일정 시간 안에 반복되면 발송 차단.
 *   상태는 data/admin_push_throttle.json 에 영속화.
 *
 * 사람 친화 통보문 표기:
 *   "제주 제05-42호 (5/16 14:30)" 형식 (정책 06 §2)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sendAdminPush } = require('./admin_push');

const THROTTLE_FILE = path.join(__dirname, '..', 'data', 'admin_push_throttle.json');

const PUSH_BASE_URL = 'https://seagnal-server.fly.dev';

// ============================================================================
// 통보문 표기 변환 — reportId → 사람 친화 표기
// ============================================================================

const STN_ABBR = {
    105: '강원', 109: '서울인천경기', 133: '대전세종충남',
    143: '대구경북', 146: '전북', 156: '광주전남',
    159: '부산울산경남', 184: '제주', 108: '전국'
};
const KIND_LABEL = {
    met: '특보', pwn: '예비', cmt: '해설', inf: '정보', ann: '속보'
};

/**
 * reportId + stn → 사람 친화 표기
 * 예: ("met:202605161430:42", 184) → "제주 제05-42호 (5/16 14:30)"
 */
function formatReportLabel(reportId, stn) {
    if (!reportId) return '(미상)';
    try {
        const parts = reportId.split(':');
        const kind = parts[0];
        const dateStr = parts[1] || '';
        const seq = parts[2] || '';
        const m = dateStr.substring(4, 6);
        const d = dateStr.substring(6, 8);
        const hh = dateStr.substring(8, 10);
        const mm = dateStr.substring(10, 12);
        const stnAbbr = STN_ABBR[stn] || '';
        const kindLabel = KIND_LABEL[kind] || kind;
        const houNumber = `제${m}-${seq}호`;
        return `${stnAbbr ? stnAbbr + ' ' : ''}${houNumber} (${parseInt(m, 10)}/${parseInt(d, 10)} ${hh}:${mm})`;
    } catch (e) {
        return reportId;
    }
}

// ============================================================================
// 빈도 제어 — 동일 키 일정 시간 내 중복 발송 차단
// ============================================================================

function loadThrottle() {
    try {
        if (fs.existsSync(THROTTLE_FILE)) {
            return JSON.parse(fs.readFileSync(THROTTLE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[SubregionAdminPush] throttle 로드 실패:', e.message);
    }
    return {};
}

function saveThrottle(data) {
    try {
        // 1일 이상 지난 항목은 제거 (메모리 절약)
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const cleaned = {};
        for (const [k, ts] of Object.entries(data)) {
            if (ts >= cutoff) cleaned[k] = ts;
        }
        fs.writeFileSync(THROTTLE_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
    } catch (e) {
        console.error('[SubregionAdminPush] throttle 저장 실패:', e.message);
    }
}

/**
 * 빈도 제어 — 같은 key 가 minIntervalMs 안에 발송된 적 있으면 false
 */
function shouldSend(key, minIntervalMs) {
    const throttle = loadThrottle();
    const lastSent = throttle[key];
    if (lastSent && (Date.now() - lastSent) < minIntervalMs) {
        return false;
    }
    throttle[key] = Date.now();
    saveThrottle(throttle);
    return true;
}

// ============================================================================
// 9가지 푸시 케이스
// ============================================================================

/**
 * 케이스 ① — 자식해역 단독 발효 (P2)
 */
async function sendP2SoloActive({ reportId, stn, parentRegion, childRegion, wrnTp, wrnLvl, tmEf, action }) {
    const key = `p2:${reportId}:${parentRegion}:${childRegion}`;
    if (!shouldSend(key, 60 * 60 * 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '🆕 자식해역 단독 발효';
    const body = `${label} ${wrnTp || ''}${wrnLvl ? ' ' + wrnLvl : ''} ${action || '발효'} / ${parentRegion}(${childRegion}) — 부모와 별개로 단독 발효`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_p2_solo_active',
        severity: 'MEDIUM',
        reportId, stn, parentRegion, childRegion, wrnTp, wrnLvl, tmEf
    }).catch(err => console.error('[SubregionAdminPush] ① 발송 오류:', err.message));
}

/**
 * 케이스 ② — 자식해역 EXCLUDED 처리 (P1)
 */
async function sendP1Excluded({ reportId, stn, parentRegion, childRegion }) {
    const key = `p1:${parentRegion}:${childRegion}`;
    if (!shouldSend(key, 6 * 60 * 60 * 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '⊘ 자식해역 제외 처리';
    const body = `${label} / ${parentRegion}(${childRegion} 제외) — ${childRegion}는 미발효 처리됨`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_p1_excluded',
        severity: 'LOW',
        reportId, stn, parentRegion, childRegion
    }).catch(err => console.error('[SubregionAdminPush] ② 발송 오류:', err.message));
}

/**
 * 케이스 ③ — AI ↔ 정규식 결과 불일치
 */
async function sendCrossCheckMismatch({ reportId, stn, parentRegion, aiChildren, regexChildren }) {
    const key = `mismatch:${reportId}`;
    if (!shouldSend(key, 1000)) return;   // 즉시 발송
    const label = formatReportLabel(reportId, stn);
    const title = '⚠️ 자식해역 추출 불일치 — 검토 필요';
    const aiStr = (aiChildren || []).join(', ') || '(없음)';
    const regexStr = (regexChildren || []).join(', ') || '(없음)';
    const body = `${label} / ${parentRegion} — AI: [${aiStr}] / 정규식: [${regexStr}] / 정규식 결과로 반영. 검토 부탁`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_cross_check_mismatch',
        severity: 'MEDIUM',
        reportId, stn, parentRegion,
        aiChildren, regexChildren
    }).catch(err => console.error('[SubregionAdminPush] ③ 발송 오류:', err.message));
}

/**
 * 케이스 ④ — 사용자 원칙 위반 (자동 보정)
 */
async function sendPrincipleViolation({ reportId, stn, parentRegion, childRegion }) {
    const key = `violation:${reportId}:${parentRegion}:${childRegion}`;
    if (!shouldSend(key, 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '❌ 데이터 원칙 위반 — 자동 보정';
    const body = `${label} / 부모해역(${parentRegion}) 없이 자식(${childRegion}) 단독 발효 시도 — 자동 보정 적용`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_principle_violation',
        severity: 'HIGH',
        reportId, stn, parentRegion, childRegion
    }).catch(err => console.error('[SubregionAdminPush] ④ 발송 오류:', err.message));
}

/**
 * 케이스 ⑤ — 자식해역 파서 실패
 */
async function sendParserFailure({ reportId, stn, rawSnippet }) {
    const key = `parser_fail:${reportId}`;
    if (!shouldSend(key, 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '🐛 자식해역 파서 실패';
    const body = `${label} — 본문에 자식해역 명시 있으나 AI·정규식 모두 추출 실패. 패턴 비정상. 즉시 검토 필요`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectError&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_parser_failure',
        severity: 'HIGH',
        reportId, stn,
        rawSnippet: (rawSnippet || '').slice(0, 200)
    }).catch(err => console.error('[SubregionAdminPush] ⑤ 발송 오류:', err.message));
}

/**
 * 케이스 ⑥ — 신규 자식해역 명칭 감지
 */
async function sendUnknownChildName({ reportId, stn, parentRegion, detectedChildName }) {
    const key = `unknown:${detectedChildName}`;
    if (!shouldSend(key, 24 * 60 * 60 * 1000)) return;  // 1일
    const label = formatReportLabel(reportId, stn);
    const title = '🆕 신규 자식해역 명칭 감지 — 카탈로그 갱신 검토';
    const body = `${label} — "${detectedChildName}" 명칭 등장 / ${parentRegion} 산하 / subregion_catalog.json 추가 검토`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectError&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_unknown_name',
        severity: 'HIGH',
        reportId, stn, parentRegion, detectedChildName
    }).catch(err => console.error('[SubregionAdminPush] ⑥ 발송 오류:', err.message));
}

/**
 * 케이스 ⑦ — 예비특보 자연어 해제 (방식 A)
 */
async function sendPrelimNaturalCancel({ reportId, stn, affectedRegion, affectedKind, detectedPhrase }) {
    const key = `prelim_natural:${reportId}`;
    if (!shouldSend(key, 60 * 60 * 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '📩 예비특보 취소 확인 요청';
    const body = `${label} — ${affectedRegion} ${affectedKind} 예비특보 / "${(detectedPhrase || '').slice(0, 60)}" / 어드민 확인 후 적용`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=reviewNeeded&category=prelim_natural_cancel`,
        category: 'subregion_prelim_natural_cancel',
        severity: 'HIGH',
        reportId, stn, affectedRegion, affectedKind, detectedPhrase
    }).catch(err => console.error('[SubregionAdminPush] ⑦ 발송 오류:', err.message));
}

/**
 * 케이스 ⑧ — 시각 단조성 위반
 */
async function sendTimeMonotonicity({ reportId, stn, parentRegion, childRegion, previousTmEf, newTmEf }) {
    const key = `mono:${reportId}:${childRegion}`;
    if (!shouldSend(key, 60 * 60 * 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '⏪ 시각 갱신 이상';
    const body = `${label} — ${childRegion} 이전 ${previousTmEf} → 새 ${newTmEf} / 시간상 뒤로 가는 갱신. 검토 필요`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_time_monotonicity',
        severity: 'MEDIUM',
        reportId, stn, parentRegion, childRegion, previousTmEf, newTmEf
    }).catch(err => console.error('[SubregionAdminPush] ⑧ 발송 오류:', err.message));
}

/**
 * 케이스 ⑨ — 자식해역 정상 수집 완료 (선택적, 기본 OFF)
 */
async function sendCollectedOk({ reportId, stn, parentRegion, activeChildren, excludedChildren, enabled }) {
    if (!enabled) return;  // 기본 OFF — 사용자 설정으로만 발송
    const key = `ok:${reportId}`;
    if (!shouldSend(key, 24 * 60 * 60 * 1000)) return;
    const label = formatReportLabel(reportId, stn);
    const title = '✅ 자식해역 수집 완료';
    const aStr = (activeChildren || []).join('·') || '없음';
    const eStr = (excludedChildren || []).join('·') || '없음';
    const body = `${label} — ${parentRegion} / 발효: ${aStr} / 제외: ${eStr}`;
    await sendAdminPush(title, body, {
        url: `${PUSH_BASE_URL}/?openAdmin=collectTest&stn=${stn}&reportId=${encodeURIComponent(reportId)}`,
        category: 'subregion_collected_ok',
        severity: 'LOW',
        reportId, stn, parentRegion, activeChildren, excludedChildren
    }).catch(err => console.error('[SubregionAdminPush] ⑨ 발송 오류:', err.message));
}

module.exports = {
    formatReportLabel,
    sendP2SoloActive,
    sendP1Excluded,
    sendCrossCheckMismatch,
    sendPrincipleViolation,
    sendParserFailure,
    sendUnknownChildName,
    sendPrelimNaturalCancel,
    sendTimeMonotonicity,
    sendCollectedOk
};
