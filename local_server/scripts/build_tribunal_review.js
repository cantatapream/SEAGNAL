/**
 * ============================================================================
 * 파일명: scripts/build_tribunal_review.js
 * 역할  : 해양안전심판원 신규 CSV(2021~2025)의 위경도(도분초)를 십진도로 변환해
 *         "검수 모드 전용" 마커 JSON 을 만든다. 처음엔 좌표 파싱이 맞는지 눈으로
 *         확인만 하는 용도였으나(2026-08-25 초판), 사용자가 "해경과 병합된 것도
 *         안 된 것도 전부 심판원 데이터를 검수해서 육지에 찍힌 것 등을 걸러내고
 *         싶다"고 목적을 넓혀(같은 날 재확정) 사고유형·병합여부까지 담아 실제
 *         검수(클릭→팝업→선택→내보내기)가 가능하게 확장했다.
 * ----------------------------------------------------------------------------
 * [입력]
 *   - scripts/_accident_raw/TL_SHPACC_HS_NEW.csv (UTF-8, git 추적 안 함 — build_accidents.js
 *     와 같은 폴더 관례. 컬럼명이 한글 원본 그대로라 build_accidents.js 가 쓰는
 *     ORGNL_XCDNT 류 십진도 컬럼이 없고, "해양사고장소(위/위도/위분/위초, 경/경도/경분/경초)"
 *     도분초 컬럼만 있다.)
 *   - client/accident_ships_hk.json (현재 서비스 중인 hk — 이 CSV 중 어떤 사건번호가
 *     이미 hk 에 병합됐는지 대조하는 용도로만 읽는다, hk 자체는 안 건드림)
 * [범위 필터 없음(2026-08-25 사용자 요청 — "21년부터 25년 내용 추가한 모든 마커들을 전부
 *   보여주도록")] 검수용 레이어라 한국 근해 범위 밖(원본 오류로 추정되는 147건)도 걸러내지
 *   않고 파싱 가능한 좌표는 전부 표출한다 — 오히려 그 이상치들이 실제로 범위 밖인지
 *   눈으로 확인하는 것도 이 레이어의 목적.
 * [사고유형 매핑] 심판원 "해양사고종류1" 텍스트 → ATY0xx 코드. build_tribunal_merge.js
 *   의 SEA_TYPE_TO_ATY 와 같은 매핑(2021~2025 전체 실측 20종 전부 매핑, unmapped 0건) —
 *   서로 다른 스크립트라 각자 사본을 갖는다(매핑을 고치면 두 파일 다 고칠 것).
 * [출력] client/accident_tribunal_review.json —
 *   [[lat, lon, ymd, hm, typeCd, caseNo, merged], ...]
 *   (merged: 이 사건번호가 accident_ships_hk.json 에 이미 들어있으면 1, 아니면 0 —
 *   검수 화면 팝업에 "해경 병합 여부"로 보여줘 사용자가 우선순위를 판단하게 한다.
 *   accident_ships_hk.json 처럼 필터가 있는 정식 컬럼 구성은 아니고 검수 전용 최소 형태)
 * [실행] node local_server/scripts/build_tribunal_review.js
 * [연계] client/js/marine-life/safety/accident_info.js 의 검수 모드(REVIEW_MODE,
 *   사고정보 버튼 10회 연타 후 5회 더 연타로 이 레이어 토글) — ensureTribunalReviewLayer
 *   가 이 JSON 을 fetch, popupRowsFor/reviewLabelFor 의 'tribunal' 분기가 표시,
 *   toggleFlag(map,'tribunal',feature) 로 선택하면 내보내기 JSON 에 "tribunal" 키로
 *   담긴다(기존 "hk"/"person" 키와 같은 메커니즘 — 코드 변경 없이 그대로 재사용됨).
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '_accident_raw', 'TL_SHPACC_HS_NEW.csv');
const HK_JSON_PATH = path.join(__dirname, '..', '..', 'client', 'accident_ships_hk.json');

// build_tribunal_merge.js 의 SEA_TYPE_TO_ATY 와 같은 매핑(주석 참고) — 사본.
const SEA_TYPE_TO_ATY = {
    충돌: 'ATY027', 침몰: 'ATY028', 전복: 'ATY018', 화재: 'ATY036', 좌초: 'ATY023',
    폭발: 'ATY032', 접촉: 'ATY019', 침수: 'ATY029', 기관손상: 'ATY010',
    조타장치손상: 'ATY021', 운항저해: 'ATY016', 추진축계손상: 'ATY026',
    해양오염: 'ATY034', 부유물감김: 'ATY040', 안전사고: 'ATY017',
    시설물손상: 'ATY014', 속구손상: 'ATY013', 행방불명: 'ATY035', 기타: 'ATY038',
    '선체결함 또는 수밀문, 개구부 결함': 'ATY012',
};
function mapSeaTypeToAty(text) {
    if (!text) return null;
    const base = text.replace(/\([^)]*\)\s*$/, '').trim();
    return SEA_TYPE_TO_ATY[base] || null;
}
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'accident_tribunal_review.json');

/**
 * RFC4180 최소 구현 CSV 파서(build_accidents.js 의 parseCsv 와 동일 방식). 사건명
 * 컬럼에 쉼표 포함 자유문장이 섞여 있어 단순 split(',') 은 안 됨(실측: naive split
 * 기준 17,036행 중 2,581행 컬럼 수 불일치 확인).
 * @param {string} text - CSV 전체 텍스트
 * @returns {Array<Array<string>>} 행 배열(0번째 행 = 헤더)
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            // no-op, \n 에서 행을 닫는다
        } else if (c === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

/** 도분초 3필드 → 십진도. dir 이 남/서면 음수. */
function dmsToDecimal(degStr, minStr, secStr, dir) {
    // degStr 은 "N34" 형태(방위 접두 1글자 + 숫자)라 접두를 뗀다.
    const deg = parseFloat(degStr.replace(/^[NSEW]/, ''));
    const min = parseFloat(minStr);
    const sec = parseFloat(secStr);
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return NaN;
    const val = deg + min / 60 + sec / 3600;
    return (dir === '남' || dir === '서') ? -val : val;
}

function main() {
    const text = fs.readFileSync(RAW_PATH, 'utf8').replace(/^﻿/, '');
    const rows = parseCsv(text);
    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => { idx[h.trim()] = i; });

    // 이미 hk 에 병합된 사건번호 집합 — accident_ships_hk.json row[16]=caseNo(심판원
    // 매칭/단독 행에만 있음, 그 외 기존 hk 행은 null).
    const hkData = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    const mergedCaseNos = new Set(hkData.rows.map((r) => r[16]).filter(Boolean));

    let skipped = 0;
    let unmappedCount = 0;
    const points = [];
    for (let i = 1; i < rows.length; i++) {
        const f = rows[i];
        const latDir = f[idx['해양사고장소(위)']];
        const lonDir = f[idx['해양사고장소(경)']];
        const lat = dmsToDecimal(f[idx['해양사고장소(위도)']], f[idx['해양사고장소(위분)']], f[idx['해양사고장소(위초)']], latDir);
        const lon = dmsToDecimal(f[idx['해양사고장소(경도)']], f[idx['해양사고장소(경분)']], f[idx['해양사고장소(경초)']], lonDir);
        const caseNo = f[idx['사건번호']] || '';
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            skipped++; // 도분초 파싱 자체가 안 되는 행(값 누락 등) — 좌표가 없어 표출 불가
            continue;
        }
        const y = f[idx['해양사고발생(년도)']], mo = f[idx['해양사고발생(월)']], d = f[idx['해양사고발생(일)']];
        const ymd = (y && mo && d) ? y + mo.padStart(2, '0') + d.padStart(2, '0') : null;
        const h = f[idx['해양사고발생(시)']] || '0', mi = f[idx['해양사고발생(분)']] || '0';
        const hm = `${parseInt(h, 10)}:${String(parseInt(mi, 10)).padStart(2, '0')}`;
        const typeCd = mapSeaTypeToAty(f[idx['해양사고종류1']]);
        if (!typeCd) unmappedCount++;
        points.push([
            Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000, ymd, hm,
            typeCd, caseNo, mergedCaseNos.has(caseNo) ? 1 : 0,
        ]);
    }

    const mergedCount = points.filter((p) => p[6] === 1).length;
    fs.writeFileSync(OUT_PATH, JSON.stringify({ v: 1, rows: points }));
    const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`[심판원 검수용] ${points.length}건 저장(${kb}KB), ${skipped}건 좌표 파싱 실패 제외 (전체 ${rows.length - 1}건) — hk 병합됨 ${mergedCount}건, 사고유형 매핑 안 됨 ${unmappedCount}건`);
}

main();
