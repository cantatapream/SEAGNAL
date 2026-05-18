/**
 * ============================================================================
 * 파일명: services/dmdw_error_log.js
 * 역할 : 방재기상플랫폼(dmdw) 크롤러에서 발생한 오류·상태 변경 이벤트를
 *        디스크에 기록하고 관리자 페이지에서 조회·확인·삭제할 수 있게 함.
 * ============================================================================
 *
 * [왜 필요한가 — 초보자용 설명]
 *  dmdw 크롤러는 로그인 실패·네트워크 장애 등 운영자 개입이 필요한 일이
 *  생기면 관리자 폰으로 즉시 푸시 알림을 보낸다. 그러나 알림은 한 번
 *  보내고 끝이라, 운영자가 나중에 다시 돌아봤을 때 "어떤 문제가 언제
 *  있었지?" 를 확인할 곳이 없다.
 *
 *  이 모듈은 푸시 알림이 발송될 때마다 같은 내용을 디스크에 누적 기록하여
 *  관리자 페이지의 "특보 알림 ▸ 특보 수집 오류 ▸ dmdw 오류" 하위 탭에서
 *  목록·확인·삭제할 수 있게 만든다.
 *
 * [데이터 파일]
 *  data/dmdw_errors.json — 항목 배열을 저장하는 단일 JSON 파일.
 *  스키마 예:
 *    [{
 *      id: "dmdw_login_fail_credential_1747500000000",
 *      type: "login_fail_credential" | "login_fail_network" | "recovered",
 *      title: "🔐 방재기상플랫폼 로그인 실패",
 *      body:  "방재기상플랫폼 로그인이 거부되었습니다. ID/비밀번호 또는...",
 *      detail: "statecode=00",          // 디버깅용 짧은 코드 (옵션)
 *      detectedAt: "2026-05-17T14:30:00.000Z",
 *      acknowledged: false,
 *      acknowledgedAt: null,
 *      acknowledgedReason: null         // "manual" | "auto-recovered"
 *    }]
 *
 * [연계 파일]
 *  - dmdw_warn_crawler.js : 오류 발생 시 appendError() 호출
 *                            정상화 시 acknowledgeAllUnack('auto-recovered') 호출
 *  - routes/admin.js      : 4개 API 엔드포인트가 이 모듈 호출
 *  - js/admin.js          : "dmdw 오류" 하위 탭이 위 API 통해 데이터 표시
 *
 * [안전 정책]
 *  - 모든 디스크 쓰기는 atomic (tmp 파일 → rename) — 부분 쓰기 시점에 read 해도
 *    깨진 JSON 안 보임
 *  - 파일 부재 시 자동으로 빈 배열 반환 — 첫 실행 시 자연스럽게 동작
 *  - 외부 의존 0 (Node 내장 fs, path 만 사용)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const FILE_PATH = path.join(DATA_DIR, 'dmdw_errors.json');
const TMP_PATH  = FILE_PATH + '.tmp';

// 한 파일에 너무 많이 쌓이지 않도록 보관 상한 (오래된 것부터 자동 제거)
// 분당 폴링 + 관리자 확인 안 하는 최악의 경우에도 충분히 여유 있는 값.
const MAX_ENTRIES = 200;

// ============================================================================
// 내부 헬퍼: 파일 로드 / 저장
// ============================================================================

/**
 * 디스크에서 항목 배열 로드.
 *  - 파일이 없거나 비정상이면 빈 배열 반환 (안전 fallback)
 *  - 호출자가 매번 직접 호출하지 말고 listErrors()/내부에서만 사용
 */
function loadAll() {
    try {
        if (!fs.existsSync(FILE_PATH)) return [];
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        if (!raw || !raw.trim()) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        // 깨진 JSON 등 — 빈 배열로 시작해서 다음 쓰기에 자동 복구
        console.log(`[dmdw_error_log] load fail (${e.message}) — empty fallback`);
        return [];
    }
}

/**
 * 디스크에 항목 배열 저장.
 *  - atomic write: tmp 파일에 먼저 쓰고 rename 으로 한 번에 교체
 *  - 데이터 디렉터리 부재 시 자동 생성
 *  - MAX_ENTRIES 초과 시 오래된 항목부터 잘라냄 (detectedAt 오름차순)
 */
function saveAll(arr) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

        // 보관 상한 초과 시 오래된 것부터 제거
        let list = arr;
        if (list.length > MAX_ENTRIES) {
            list = [...list].sort((a, b) => {
                const ta = new Date(a.detectedAt || 0).getTime();
                const tb = new Date(b.detectedAt || 0).getTime();
                return ta - tb;
            }).slice(-MAX_ENTRIES);
        }

        fs.writeFileSync(TMP_PATH, JSON.stringify(list, null, 2), 'utf8');
        fs.renameSync(TMP_PATH, FILE_PATH);
    } catch (e) {
        console.log(`[dmdw_error_log] save fail (${e.message}) — 기록 누락 가능성, 다음 호출에 재시도`);
    }
}

// ============================================================================
// 공개 API
// ============================================================================

/**
 * 새 오류·상태 이벤트 한 건 추가.
 *  - 호출 즉시 디스크에 반영
 *  - id 는 type + 시각(ms) 으로 자동 생성하므로 호출자가 신경 안 써도 됨
 *
 * @param {string} type   카테고리 키. dmdw_warn_crawler 의 알림 type 과 동일하게 사용.
 *                        예: 'login_fail_credential', 'login_fail_network', 'recovered'
 * @param {string} title  알림 제목 (푸시 알림과 동일하게 보내면 됨)
 * @param {string} body   알림 본문 (서술형 자연어 — 코드 X)
 * @param {string} [detail]  디버깅용 짧은 코드 (옵션). 예: "statecode=00", "ETIMEDOUT"
 * @returns {{ok:boolean, id:string|null}}
 */
function appendError(type, title, body, detail) {
    const now = Date.now();
    const entry = {
        id: `dmdw_${type}_${now}`,
        type: String(type || 'unknown'),
        title: String(title || ''),
        body: String(body || ''),
        detail: detail ? String(detail).substring(0, 300) : '',
        detectedAt: new Date(now).toISOString(),
        acknowledged: false,
        acknowledgedAt: null,
        acknowledgedReason: null
    };
    const arr = loadAll();
    arr.push(entry);
    saveAll(arr);
    return { ok: true, id: entry.id };
}

/**
 * 전체 항목 목록 반환 (최신순 정렬).
 *  - routes/admin.js 의 GET /api/admin/dmdw-errors 가 이 함수 호출
 *  - 빈 배열도 정상 반환
 */
function listErrors() {
    const arr = loadAll();
    // 최신순 — detectedAt 내림차순
    return [...arr].sort((a, b) => {
        const ta = new Date(a.detectedAt || 0).getTime();
        const tb = new Date(b.detectedAt || 0).getTime();
        return tb - ta;
    });
}

/**
 * id 항목을 "확인 처리" (acknowledged=true).
 *  - 삭제가 아님 → 이력 보존
 *  - reason: 'manual' (사용자가 버튼 클릭) | 'auto-recovered' (정상화 시 자동)
 *
 * @returns {{ok:boolean, found:boolean}}
 */
function acknowledgeError(id, reason) {
    const arr = loadAll();
    const idx = arr.findIndex(e => e && e.id === id);
    if (idx < 0) return { ok: true, found: false };
    if (arr[idx].acknowledged) return { ok: true, found: true }; // 멱등
    arr[idx].acknowledged = true;
    arr[idx].acknowledgedAt = new Date().toISOString();
    arr[idx].acknowledgedReason = reason || 'manual';
    saveAll(arr);
    return { ok: true, found: true };
}

/**
 * id 항목 1건 영구 삭제.
 *  - 기존 review_needed 에는 없는 신규 기능 (개별 삭제)
 *
 * @returns {{ok:boolean, found:boolean}}
 */
function deleteError(id) {
    const arr = loadAll();
    const before = arr.length;
    const next = arr.filter(e => !(e && e.id === id));
    if (next.length === before) return { ok: true, found: false };
    saveAll(next);
    return { ok: true, found: true };
}

/**
 * 전체 삭제 (초기화 버튼용).
 *  - 빈 배열로 덮어쓰기
 */
function deleteAllErrors() {
    saveAll([]);
    return { ok: true };
}

/**
 * 미확인 항목 전부를 자동 "확인 처리".
 *  - dmdw 크롤러가 정상화 사이클을 1회 성공했을 때 호출됨
 *  - reason 은 보통 'auto-recovered' 로 지정
 *  - 이미 확인된 항목은 건너뜀
 *
 * @param {string} reason  acknowledgedReason 에 기록될 값
 * @returns {{ok:boolean, count:number}}  자동 확인 처리된 건수
 */
function acknowledgeAllUnack(reason) {
    const arr = loadAll();
    let count = 0;
    const nowIso = new Date().toISOString();
    for (const e of arr) {
        if (e && !e.acknowledged) {
            e.acknowledged = true;
            e.acknowledgedAt = nowIso;
            e.acknowledgedReason = reason || 'auto-recovered';
            count++;
        }
    }
    if (count > 0) saveAll(arr);
    return { ok: true, count };
}

// ============================================================================
// 모듈 export
// ============================================================================

module.exports = {
    appendError,
    listErrors,
    acknowledgeError,
    deleteError,
    deleteAllErrors,
    acknowledgeAllUnack,
    // 테스트·디버깅용
    _filePath: FILE_PATH
};
