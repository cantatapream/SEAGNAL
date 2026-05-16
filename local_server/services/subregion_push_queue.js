/**
 * [자식해역 관리자 푸시 큐 — 사이클 단위 묶음 발송]
 *
 * 정책 13 (9 광역 일괄 발송) 의 자식해역 측면 보강.
 *
 * 사이클 동안 자식해역 관련 푸시(케이스 ①·②·③·④·⑤·⑥·⑦·⑧)를 큐에 모아두고,
 * 사이클 종료 시 flush 호출 시 다음 규칙으로 묶어서 발송:
 *
 * 1. 같은 category 끼리 그룹화 (예: P2 단독 발효 여러 건 → 한 푸시)
 * 2. 한 푸시 body 의 최대 길이(`MAX_BODY_LEN`) 까지 채움
 * 3. 초과 예정이면 **묶음 단위로 분할** — 한 케이스가 중간에서 잘리지 않음
 * 4. 분할 시 제목에 "(N/M)" 표기
 * 5. 사이클당 같은 category 발송 횟수 제한 (`MAX_NOTIFS_PER_CATEGORY`)
 *
 * 사용자 결정 (2026-05-16):
 * > "텍스트 총량은 꽉 채우되 만약 초과할 것 같으면 내용의 묶음별로 나누어서
 * >  중간에 텍스트가 잘리는 느낌 없이 다음 푸시알림을 이어서 보내라"
 */
'use strict';

const { sendAdminPush } = require('./admin_push');

// FCM body 안전 한도 — 안드로이드/iOS 모두에서 잘리지 않게 보장
// 안드로이드 BigText: 4096, iOS body: 2000 정도. 보수적으로 1400자.
const MAX_BODY_LEN = 1400;

// 한 사이클당 같은 category 최대 푸시 횟수 (분할 시 (N/M) 으로 표기)
const MAX_NOTIFS_PER_CATEGORY = 5;

// 케이스별 메타 (제목·딥링크)
const CATEGORY_META = {
    subregion_p2_solo_active: {
        title: '🆕 자식해역 단독 발효',
        urlPath: '/?openAdmin=collectTest',
        severity: 'MEDIUM'
    },
    subregion_p1_excluded: {
        title: '⊘ 자식해역 제외 처리',
        urlPath: '/?openAdmin=collectTest',
        severity: 'LOW'
    },
    subregion_cross_check_mismatch: {
        title: '⚠️ 자식해역 추출 불일치',
        urlPath: '/?openAdmin=collectTest',
        severity: 'MEDIUM'
    },
    subregion_principle_violation: {
        title: '❌ 데이터 원칙 위반',
        urlPath: '/?openAdmin=collectTest',
        severity: 'HIGH'
    },
    subregion_parser_failure: {
        title: '🐛 자식해역 파서 실패',
        urlPath: '/?openAdmin=collectError',
        severity: 'HIGH'
    },
    subregion_unknown_name: {
        title: '🆕 신규 자식해역 명칭 감지',
        urlPath: '/?openAdmin=collectError',
        severity: 'HIGH'
    },
    subregion_prelim_natural_cancel: {
        title: '📩 예비특보 취소 확인 요청',
        urlPath: '/?openAdmin=reviewNeeded&category=prelim_natural_cancel',
        severity: 'HIGH'
    },
    subregion_time_monotonicity: {
        title: '⏪ 시각 갱신 이상',
        urlPath: '/?openAdmin=collectTest',
        severity: 'MEDIUM'
    }
};

// 사이클 동안의 큐 — { category: [{ line, data }, ...] }
let _queue = {};

/**
 * 큐에 한 줄 추가 — 정책 06 의 각 케이스에서 호출
 *
 * @param {string} category — 카테고리 키 (subregion_p2_solo_active 등)
 * @param {string} line — 한 줄 메시지 (예: "제주 제05-42호 (5/16 14:30) 풍랑주의보 발효 / 제주도서부앞바다(북서연안바다)")
 * @param {object} data — sendAdminPush 의 data 페이로드용 메타
 */
function enqueue(category, line, data = {}) {
    if (!CATEGORY_META[category]) {
        console.warn('[SubregionPushQueue] 알 수 없는 category:', category);
        return;
    }
    if (!_queue[category]) _queue[category] = [];
    _queue[category].push({ line: String(line || '').trim(), data });
}

/**
 * 큐 비우고 발송 — 1분 사이클 종료 시 호출
 *
 * 같은 category 의 줄들을 그룹화 → MAX_BODY_LEN 한도 내에서 묶음 →
 * 초과 예정 시 묶음 단위 분할 발송.
 */
async function flush() {
    const entries = Object.entries(_queue);
    if (entries.length === 0) return { sent: 0 };

    const snapshot = _queue;
    _queue = {};  // 즉시 리셋 (재진입 안전)

    let totalSent = 0;
    for (const [category, items] of entries) {
        if (!items || items.length === 0) continue;
        const meta = CATEGORY_META[category];
        if (!meta) continue;

        // 묶음 단위로 분할 — 케이스가 중간에 잘리지 않게
        const chunks = [];   // [['line1', 'line2'], ['line3'], ...]
        let currentChunk = [];
        let currentLen = 0;

        for (const item of items) {
            const lineLen = item.line.length + 1;  // 줄바꿈 포함
            // 단일 줄이 한도 초과? 어차피 한 푸시로 보냄 (잘림 위험 감수)
            if (lineLen >= MAX_BODY_LEN) {
                if (currentChunk.length > 0) chunks.push(currentChunk);
                chunks.push([item.line]);
                currentChunk = [];
                currentLen = 0;
                continue;
            }
            // 추가하면 한도 초과? 새 청크 시작
            if (currentLen + lineLen > MAX_BODY_LEN) {
                chunks.push(currentChunk);
                currentChunk = [item.line];
                currentLen = lineLen;
            } else {
                currentChunk.push(item.line);
                currentLen += lineLen;
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        // 분할이 너무 많으면 첫 MAX_NOTIFS_PER_CATEGORY 만 발송
        const sliced = chunks.slice(0, MAX_NOTIFS_PER_CATEGORY);
        const totalChunks = sliced.length;
        const omitted = chunks.length - sliced.length;

        for (let i = 0; i < sliced.length; i++) {
            const chunkLines = sliced[i];
            const partLabel = totalChunks > 1 ? ` (${i + 1}/${totalChunks})` : '';
            const omittedNote = (i === sliced.length - 1 && omitted > 0)
                ? `\n…외 ${omitted}건 묶음 추가 발생 (어드민 확인 필요)`
                : '';
            const body = chunkLines.join('\n') + omittedNote;

            // data 페이로드는 첫 item 의 data 사용 + 묶음 정보 추가
            const firstData = items[0].data || {};
            const payload = {
                ...firstData,
                category,
                severity: meta.severity,
                bundled: true,
                bundleSize: chunkLines.length,
                bundlePart: i + 1,
                bundleTotal: totalChunks,
                url: firstData.url || `https://seagnal-server.fly.dev${meta.urlPath}`
            };

            try {
                await sendAdminPush(`${meta.title}${partLabel}`, body, payload);
                totalSent++;
            } catch (e) {
                console.error('[SubregionPushQueue] 발송 오류:', e.message);
            }
        }
    }

    return { sent: totalSent };
}

/**
 * 현재 큐 길이 (디버깅용)
 */
function size() {
    let n = 0;
    for (const arr of Object.values(_queue)) n += arr.length;
    return n;
}

module.exports = {
    enqueue,
    flush,
    size,
    MAX_BODY_LEN,
    MAX_NOTIFS_PER_CATEGORY
};
