/**
 * ============================================================================
 * 파일명: local_server/scripts/patch_2025_type_codes.js
 * 역할  : build_tribunal_merge.js 가 2025년 심판원 단독 행에 사고유형코드(typeCd,
 *         row[5])를 못 채운 채로(null) 넣었던 걸, 사건번호(caseNo)로 원본 CSV와
 *         다시 대조해 채운다.
 * [배경] build_tribunal_merge.js 는 그 커밋 시점엔 심판원 "해양사고종류1" 텍스트를
 *   ATY0xx 코드로 옮기는 로직이 없어 2025년 단독 3,840건의 typeCd 가 전부 null
 *   이었다. 지도 클러스터 대표 이미지 계산(accident_info.js dominantTypeCode)이
 *   "코드 없음"을 하나의 큰 덩어리로 세다 보니 실제 사고유형(충돌·전복 등 15종
 *   이상으로 흩어짐)보다 더 자주 이겨버려, 마커가 거의 전부 아이콘 없는 빨간
 *   원+숫자로만 보이는 문제가 있었다(사용자 스크린샷 지적, 2026-08-25). 원인은
 *   고쳤지만(build_tribunal_merge.js 의 SEA_TYPE_TO_ATY), 그 스크립트를 통째로
 *   재실행하면 현재 서비스 중인 accident_ships_hk.json(이미 병합 완료)을 다시
 *   기존 데이터로 읽어 그 위에 복원분을 또 이어붙이는 중복이 생긴다 — 그래서
 *   이미 병합된 파일 안의 2025년 단독 구간만 좁혀 typeCd 만 patch 한다.
 * [대상 식별] build_tribunal_merge.js 최종 조립 순서(existingExtended.concat(
 *   restored2016, restored2124, rows2025))가 고정이라, 2025년 단독 3,840건은
 *   항상 배열의 맨 끝에 있다(23,421+1,268+6,498=31,187 부터 끝까지).
 * [실행] node local_server/scripts/patch_2025_type_codes.js
 * [연계] build_tribunal_merge.js 의 SEA_TYPE_TO_ATY/mapSeaTypeToAty 와 같은
 *        매핑(두 파일에 각각 있음 — build_tribunal_merge.js 는 require 하면
 *        currentHk 를 다시 읽어 main() 이 즉시 재병합을 실행해버려 그대로
 *        가져다 쓸 수 없다. 매핑표를 고치면 두 파일 다 고칠 것).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '_accident_raw');
const HK_JSON_PATH = path.join(__dirname, '..', '..', 'client', 'accident_ships_hk.json');
const SEGMENT_START = 23421 + 1268 + 6498; // 31187 — 2025 단독 구간 시작 인덱스

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

function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
            else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* no-op */ }
        else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
        else field += c;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
function readCsvAsRecords(filePath) {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const rows = parseCsv(text);
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => {
        const obj = {};
        header.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
    });
}

function main() {
    const tribunal = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_NEW.csv'));
    const typeByCaseNo = new Map();
    tribunal.forEach((row) => {
        if (row['해양사고발생(년도)'] === '2025') typeByCaseNo.set(row['사건번호'], row['해양사고종류1']);
    });

    const hkData = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    if (hkData.rows.length <= SEGMENT_START) {
        console.error(`[ERROR] 전체 행 수(${hkData.rows.length})가 2025 구간 시작(${SEGMENT_START})보다 작거나 같음`);
        process.exit(1);
    }

    let patched = 0, unmatched = 0;
    const unmappedTypes = {};
    for (let i = SEGMENT_START; i < hkData.rows.length; i++) {
        const row = hkData.rows[i];
        const caseNo = row[16];
        const seaType = typeByCaseNo.get(caseNo);
        if (seaType == null) { unmatched++; continue; }
        const typeCd = mapSeaTypeToAty(seaType);
        if (!typeCd) { unmappedTypes[seaType] = (unmappedTypes[seaType] || 0) + 1; continue; }
        row[5] = typeCd;
        patched++;
    }
    console.log(`[patch] 2025 단독 ${hkData.rows.length - SEGMENT_START}건 중 ${patched}건 typeCd 채움, 사건번호 매칭 안 됨 ${unmatched}건`);
    if (Object.keys(unmappedTypes).length) console.log('[patch] 사고유형 매핑 안 된 텍스트:', unmappedTypes);

    fs.writeFileSync(HK_JSON_PATH, JSON.stringify(hkData));
    console.log('완료:', HK_JSON_PATH);
}

if (require.main === module) main();
