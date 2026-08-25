/**
 * ============================================================================
 * 파일명: scripts/apply_jurisdiction_review.js
 * 역할  : 사고정보 "관할서 불일치 검수" 레이어(사고정보 버튼 20회 연타)에서 사람이
 *         직접 지도 위 경계선을 보고 골라 "내보내기"한 결과를 accident_ships_hk.json
 *         에 실제로 반영한다(orgCd 수정) — 2026-08-25 사용자 확정: "선택만 모아뒀다가
 *         일괄 반영".
 * ----------------------------------------------------------------------------
 * [입력] local_server/scripts/_accident_raw/jurisdiction_review_export.json
 *   — 검수 화면 패널의 "내보내기" 버튼을 누르면 텍스트박스에 뜨는 JSON을 그대로
 *   이 경로에 저장(파일이 없으면 실행 중 안내). 형식:
 *   {"jurisdiction":[{"idx":123,"chosen":"부산해양경찰서"}, ...]}
 *   (idx 는 build_jurisdiction_mismatch_review.js 를 돌렸을 때의 accident_ships_hk.json
 *   행 인덱스 — 그 사이 hk 에 행 추가/삭제가 있었으면 idx 가 밀려 있을 수 있어
 *   아래에서 좌표·날짜까지 대조해 어긋나면 스킵하고 경고한다, 추측 반영 안 함)
 * [실행] node local_server/scripts/apply_jurisdiction_review.js
 * [출력] client/accident_ships_hk.json 갱신(orgCd 만 변경)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const RAW_DIR = path.join(__dirname, '_accident_raw');
const EXPORT_PATH = path.join(RAW_DIR, 'jurisdiction_review_export.json');
const MISMATCH_PATH = path.join(CLIENT_DIR, 'accident_jurisdiction_mismatch.json');

const ORG_CODE_OF = {
    속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466, 울산해양경찰서: 1532304,
    부산해양경찰서: 1532329, 창원해양경찰서: 1532357, 통영해양경찰서: 1532376, 여수해양경찰서: 1532170,
    완도해양경찰서: 1532199, 목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
    태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121, 제주해양경찰서: 1532508,
    서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281, 울진해양경찰서: 1532609, 사천해양경찰서: 1532759,
    강릉해양경찰서: 1532865,
};

function main() {
    if (!fs.existsSync(EXPORT_PATH)) {
        console.log(`[안내] ${EXPORT_PATH} 가 없다 — 검수 화면 "내보내기" 결과를 그 경로에 저장한 뒤 다시 실행할 것.`);
        return;
    }
    const exportData = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));
    const picks = exportData.jurisdiction || [];
    if (!picks.length) { console.log('[안내] jurisdiction 키에 담긴 선택이 없다.'); return; }

    // idx 밀림 검증용 — build_jurisdiction_mismatch_review.js 가 만든 후보 목록에서
    // 같은 idx 의 좌표·날짜를 대조해, 그 사이 hk 가 바뀌어 밀렸으면 반영을 스킵한다.
    const mismatchData = fs.existsSync(MISMATCH_PATH) ? JSON.parse(fs.readFileSync(MISMATCH_PATH, 'utf8')) : null;
    const candByIdx = new Map();
    if (mismatchData) mismatchData.rows.forEach((r) => candByIdx.set(r[8], r));

    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    let applied = 0, skippedBadOwner = 0, skippedDrift = 0, unchanged = 0;
    picks.forEach((p) => {
        const row = hkData.rows[p.idx];
        if (!row) { skippedDrift++; return; }
        const cand = candByIdx.get(p.idx);
        if (cand && (row[0] !== cand[0] || row[1] !== cand[1] || row[2] !== cand[2])) {
            skippedDrift++; // idx 가 가리키는 행이 검수 당시와 달라짐 — hk 가 그 사이 바뀐 것
            return;
        }
        const newCd = ORG_CODE_OF[p.chosen];
        if (!newCd) { skippedBadOwner++; return; }
        if (row[8] === newCd) { unchanged++; return; }
        row[8] = newCd;
        applied++;
    });

    fs.writeFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), JSON.stringify(hkData));
    console.log(`[완료] ${applied}건 반영, 이미 같은 값 ${unchanged}건, 알 수 없는 관할서명 ${skippedBadOwner}건, idx 밀림/삭제로 스킵 ${skippedDrift}건`);
}

main();
