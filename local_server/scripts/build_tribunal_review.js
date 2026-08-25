/**
 * ============================================================================
 * 파일명: scripts/build_tribunal_review.js
 * 역할  : 해양안전심판원 신규 CSV(2021~2025, 사용자 제공 77b5f58c)의 위경도(도분초)를
 *         십진도로 변환해 "검수 모드 전용" 마커 좌표 JSON 을 만든다. 실제 서비스
 *         데이터가 아니라 좌표 파싱이 맞는지 지도 위에서 눈으로 확인하기 위한
 *         용도(2026-08-25 사용자 요청 — "경위도 정보가 제대로 반영되었는지 보기 위해").
 * ----------------------------------------------------------------------------
 * [입력] scripts/_accident_raw/TL_SHPACC_HS_NEW.csv (UTF-8, git 추적 안 함 — build_accidents.js
 *   와 같은 폴더 관례. 컬럼명이 한글 원본 그대로라 build_accidents.js 가 쓰는
 *   ORGNL_XCDNT 류 십진도 컬럼이 없고, "해양사고장소(위/위도/위분/위초, 경/경도/경분/경초)"
 *   도분초 컬럼만 있다.)
 * [출력] client/accident_tribunal_review.json — [[lat, lon, 사건번호], ...]
 *   (검수 모드에서만 fetch — accident_ships_hk.json 처럼 필터·팝업에 쓰는 정식 컬럼
 *   구성이 아니라 좌표 확인용 최소 형태)
 * [실행] node local_server/scripts/build_tribunal_review.js
 * [연계] client/js/marine-life/safety/accident_info.js 의 검수 모드(REVIEW_MODE)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '_accident_raw', 'TL_SHPACC_HS_NEW.csv');
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'accident_tribunal_review.json');

// accident_info.js 의 KOREA_BOUNDS 와 동일 — 원본 CSV에 남반구·경도 0 근처 등
// 명백히 잘못된 좌표가 섞여 있어(예: BS-2025-0012 "S15 E042") 같은 기준으로 걸러낸다.
const KOREA_BOUNDS = { latMin: 24, latMax: 44, lonMin: 118, lonMax: 144 };

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

    let skipped = 0;
    const points = [];
    for (let i = 1; i < rows.length; i++) {
        const f = rows[i];
        const latDir = f[idx['해양사고장소(위)']];
        const lonDir = f[idx['해양사고장소(경)']];
        const lat = dmsToDecimal(f[idx['해양사고장소(위도)']], f[idx['해양사고장소(위분)']], f[idx['해양사고장소(위초)']], latDir);
        const lon = dmsToDecimal(f[idx['해양사고장소(경도)']], f[idx['해양사고장소(경분)']], f[idx['해양사고장소(경초)']], lonDir);
        const caseNo = f[idx['사건번호']] || '';
        if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
            lat < KOREA_BOUNDS.latMin || lat > KOREA_BOUNDS.latMax ||
            lon < KOREA_BOUNDS.lonMin || lon > KOREA_BOUNDS.lonMax) {
            skipped++;
            continue;
        }
        points.push([Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000, caseNo]);
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify({ v: 1, rows: points }));
    const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`[심판원 검수용] ${points.length}건 저장(${kb}KB), ${skipped}건 좌표범위 밖 제외 (전체 ${rows.length - 1}건)`);
}

main();
