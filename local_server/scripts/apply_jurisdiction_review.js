/**
 * ============================================================================
 * 파일명: scripts/apply_jurisdiction_review.js
 * 역할  : 사고정보 "관할서 검수 워크스루"(사고정보 버튼 20회 연타)에서 사람이
 *         확인/변경/삭제로 고른 결과를 accident_ships_hk.json 에 실제로 반영한다
 *         — 2026-08-25 사용자 확정: "선택만 모아뒀다가 일괄 반영".
 * ----------------------------------------------------------------------------
 * [입력] local_server/scripts/_accident_raw/jurisdiction_review_export.json
 *   — 검수 화면 패널의 "내보내기" 버튼을 누르면 텍스트박스에 뜨는 JSON을 그대로
 *   이 경로에 저장(파일이 없으면 실행 중 안내). 형식:
 *   {"jurisdiction":[{"idx":123,"action":"confirm"}, {"idx":456,"action":"change","to":"부산해양경찰서"},
 *   {"idx":789,"action":"delete"}, ...]}
 *   (2026-08-26 재설계 — "확인/변경/삭제" 3액션. confirm=지금 값 그대로 유지(아무
 *   것도 안 함), change=orgCd 를 to 로 정정, delete=행 자체를 삭제. idx 는 검수
 *   화면이 후보 목록을 만들었을 때의 accident_ships_hk.json 행 인덱스 — 그 사이
 *   hk 에 행 추가/삭제가 있었으면 idx 가 밀려 있을 수 있어 아래에서 좌표·날짜까지
 *   대조해 어긋나면 스킵하고 경고한다, 추측 반영 안 함)
 * [후보 출처 두 곳] accident_jurisdiction_mismatch.json(①·② 기록≠판정) +
 *   accident_jurisdiction_2025_review.json(③ 2025 단독 저신뢰) — idx 는 서로
 *   절대 겹치지 않는다(후자는 2025년행만, 전자는 2025년행을 명시적으로 제외).
 *   드리프트 검증(좌표·날짜 대조)에 둘 다 합쳐서 쓴다.
 * [실행] node local_server/scripts/apply_jurisdiction_review.js
 * [출력] client/accident_ships_hk.json 갱신(orgCd 정정 또는 행 삭제, confirm 은 무변경)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const RAW_DIR = path.join(__dirname, '_accident_raw');
const EXPORT_PATH = path.join(RAW_DIR, 'jurisdiction_review_export.json');
const MISMATCH_PATH = path.join(CLIENT_DIR, 'accident_jurisdiction_mismatch.json');
const Y2025_PATH = path.join(CLIENT_DIR, 'accident_jurisdiction_2025_review.json');

const ORG_CODE_OF = {
    속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466, 울산해양경찰서: 1532304,
    부산해양경찰서: 1532329, 창원해양경찰서: 1532357, 통영해양경찰서: 1532376, 여수해양경찰서: 1532170,
    완도해양경찰서: 1532199, 목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
    태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121, 제주해양경찰서: 1532508,
    서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281, 울진해양경찰서: 1532609, 사천해양경찰서: 1532759,
    강릉해양경찰서: 1532865,
};

function loadCandidates(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8')).rows;
}

function main() {
    if (!fs.existsSync(EXPORT_PATH)) {
        console.log(`[안내] ${EXPORT_PATH} 가 없다 — 검수 화면 "내보내기" 결과를 그 경로에 저장한 뒤 다시 실행할 것.`);
        return;
    }
    const exportData = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));
    const picks = exportData.jurisdiction || [];
    if (!picks.length) { console.log('[안내] jurisdiction 키에 담긴 선택이 없다.'); return; }

    // idx 밀림 검증용 — 두 후보 목록(①·② + ③2025)을 합쳐 같은 idx 의 좌표·날짜를
    // 대조, 그 사이 hk 가 바뀌어 밀렸으면 반영을 스킵한다.
    const candByIdx = new Map();
    loadCandidates(MISMATCH_PATH).forEach((r) => candByIdx.set(r[8], r));
    loadCandidates(Y2025_PATH).forEach((r) => candByIdx.set(r[8], r));

    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    let applied = 0, confirmed = 0, unchanged = 0, skippedBadAction = 0, skippedDrift = 0;
    const deleteIdx = new Set();
    picks.forEach((p) => {
        const row = hkData.rows[p.idx];
        if (!row) { skippedDrift++; return; }
        const cand = candByIdx.get(p.idx);
        if (cand && (row[0] !== cand[0] || row[1] !== cand[1] || row[2] !== cand[2])) {
            skippedDrift++; // idx 가 가리키는 행이 검수 당시와 달라짐 — hk 가 그 사이 바뀐 것
            return;
        }
        if (p.action === 'confirm') {
            confirmed++; // 지금 값이 맞다고 확인만 함 — 데이터 변경 없음
        } else if (p.action === 'delete') {
            deleteIdx.add(p.idx);
            applied++;
        } else if (p.action === 'change') {
            const newCd = ORG_CODE_OF[p.to];
            if (!newCd) { skippedBadAction++; return; } // to 가 없거나 알 수 없는 관할서명
            if (row[8] === newCd) { unchanged++; return; }
            row[8] = newCd;
            applied++;
        } else {
            skippedBadAction++;
        }
    });

    const before = hkData.rows.length;
    if (deleteIdx.size) hkData.rows = hkData.rows.filter((r, i) => !deleteIdx.has(i));

    fs.writeFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), JSON.stringify(hkData));
    console.log(`[완료] 변경 ${applied}건(삭제 ${deleteIdx.size}건 포함, ${before}→${hkData.rows.length}건), 확인만(무변경) ${confirmed}건, 이미 같은 값 ${unchanged}건, 알 수 없는/빈 액션 ${skippedBadAction}건, idx 밀림 스킵 ${skippedDrift}건`);
}

main();
