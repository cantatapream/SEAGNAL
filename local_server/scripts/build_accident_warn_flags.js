/**
 * ============================================================================
 * 파일명: local_server/scripts/build_accident_warn_flags.js
 * 역할: 사고 하나하나에 "그 시각(또는 그 날) 태풍·풍랑·강풍 특보가 실제로 떠
 *       있었는지"를 계산해 client/accident_ships_hk.json·accident_persons.json
 *       각 행 끝에 필드로 추가한다(빌드타임 1회성 스크립트, 배포에는 안 실림).
 * ============================================================================
 *
 * [실행 방법]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf   # 운영 환경에 영구 설치 금지(build_warn_zones_holed.js 와 동일 관례)
 *   node local_server/scripts/build_accident_warn_flags.js
 *
 * [배경 — 사용자 확정 사항, 2026-08-24]
 *  - 마커는 대부분 해상, 강풍구역은 육상 단위라 "사고좌표가 육상 폴리곤 안"이라는
 *    점-폴리곤 판정이 해상 사고엔 항상 실패한다. 그래서 강풍만 다르게: "사고 지점이
 *    해안(육상구역 폴리곤 경계)에서 3km 이내면 가장 가까운 육상구역 기준으로 판정"
 *    (원문: "해안에서 3km 이내면 특보 영향권으로 보자. 폴리곤 기준으로.").
 *  - 필터에서 특보종류 여러 개(예: 강풍+풍랑)를 동시에 켜면 OR(그 중 하나라도 발효
 *    중이면 통과) — AND로 하면 해상 사고는 강풍과 원래 무관해 대부분 사라져버림.
 *  - 선박(hk)은 태풍·풍랑만(강풍은 육상 개념이라 배 사고와 무관), 인명(person)은
 *    태풍·풍랑·강풍 셋 다 본다.
 *  - hk 는 발생시각(hm)이 있어 그 정확한 시각 기준, person 은 시각이 없어(ymd 만)
 *    그 날짜 전체와 조금이라도 겹치면 발효중으로 본다(기존 시간대 필터의 "판단 불가
 *    축은 안 막는다" 원칙과 동일).
 *
 * [1~3단계 — 통보문 파싱] warn_zone_parser.js 참고. 태풍+풍랑+강풍 전체 49,404개
 *   구역 표현 중 99.86% 해석 성공(2026-08-24 검증).
 *
 * [제주 옛 특보구역 — 근사 폴리곤] 제주 특보구역이 2026-06-01 부로 8→10개로 전면
 *   개편(방위명→행정시명)됐는데 사고데이터(hk 2020-12월까지·person 2024-12월까지)는
 *   전부 그 이전이라 새 10구역 이름/경계가 안 맞는다. weather.go.kr 원본은 이 세션
 *   네트워크 정책상 직접 못 받아(egress 차단, curl 로도 403 확인) 사용자가 F12로
 *   받아준 새 파일(wrnArea_land.geojson, 2026.6.1~ 체계)의 제주시서부+서귀포시서부
 *   등을 합쳐 옛 이름 폴리곤을 근사 생성(jeju_old_zones.geojson, 사용자 확정
 *   "2번으로 진행" — union 근사). 검증: 면적 합계가 실제 제주도 전체 면적
 *   (≈1,845km²)과 거의 일치(1,857km², 신구 어느 시점 기준으로 더해도 동일). 또한
 *   2022-12-17(북부)/12-19(남부) 부로 "중산간" 구역이 실제로 신설된 이력이 CSV
 *   자체에서 확인돼(그 이전엔 안 씀) 이 날짜로 폴리곤을 분기한다.
 *
 * [해제 없이 대치/변경만 반복되는 통보문 — 구간 최대 10일 강제 마감] 첫 구현에서
 *   실측 결과 TY(태풍) 구간 42개 중 34개가 30일 초과, 최대 5년(!)짜리 "태풍 발효
 *   구간"이 나왔다 — 현실적으로 불가능. 원인: 같은 구역·종류에 "해제" 없이 "대치"·
 *   "변경"만 몇 년째 반복되는 통보문 기록 누락 사례가 실제로 있음. 고쳐서 재검증:
 *   TY 최대 12.13일·WV 최대 16.54일·GW 최대 23.08일로 정상화(같은 (구역,종류)에서
 *   다음 이벤트까지 10일 넘게 비면 직전 이벤트 시점에서 강제 마감).
 *
 * [출력 — 각 행 끝에 필드 추가]
 *   hk: [...기존 12개], ["TY","WV"] 형태 배열(발효중인 종류만, 없으면 [])
 *   person: [...기존 10개], ["TY","WV","GW"] 형태 배열(위와 동일)
 *
 * [연계] 사용하는 파일: warn_zone_parser.js · local_server/config/zone_group_map.js ·
 *        local_server/scripts/data/warn_zone_flags/*
 *        결과 소비처: client/js/marine-life/safety/accident_info.js (특보 필터)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

let turf;
try {
    turf = require('@turf/turf');
} catch (e) {
    console.error('[ERROR] @turf/turf 미설치. 다음 명령 후 다시 실행:');
    console.error('  npm install --no-save @turf/turf');
    process.exit(1);
}

const { parseZonestr, resolveZone, resolveSeaZone } = require('./warn_zone_parser.js');
const { ZONE_GROUP_MAP } = require('../config/zone_group_map.js');

const ROOT = path.resolve(__dirname, '..', '..'); // /home/user/SEAGNAL
const DATA_DIR = path.join(__dirname, 'data', 'warn_zone_flags');
const CSV_PATH = path.join(DATA_DIR, 'fct_wrn_2016_2025.csv');
const LAND_GEO_PATH = path.join(DATA_DIR, 'wrnArea_land.geojson');
const JEJU_OLD_PATH = path.join(DATA_DIR, 'jeju_old_zones.geojson');
const SEA_GEO_PATH = path.join(ROOT, 'client/assets/warn_zones.geojson');
const HK_JSON_PATH = path.join(ROOT, 'client/accident_ships_hk.json');
const PERSON_JSON_PATH = path.join(ROOT, 'client/accident_persons.json');

const STALE_GAP_DAYS = 10;
const NEAR_LAND_KM = 3;

// ============================================================================
// 1단계: 구역 사전 준비
// ============================================================================
const landGeo = JSON.parse(fs.readFileSync(LAND_GEO_PATH, 'utf8'));
const landNames = new Set();
for (const f of landGeo.features) {
    if (f.properties.regko) landNames.add(f.properties.regko);
    if (f.properties.regKo) landNames.add(f.properties.regKo);
}
// 제주 옛 이름(신 10구역 체계엔 없음) — resolveZone 이 통보문 파싱 때 인식하도록 추가
['제주도북부', '제주도남부', '제주도동부', '제주도서부', '제주도북부중산간', '제주도남부중산간']
    .forEach(n => landNames.add(n));

const seaGeo = JSON.parse(fs.readFileSync(SEA_GEO_PATH, 'utf8'));
const seaNames = new Set(seaGeo.features.map(f => f.properties.name.replace(/[\s·.]/g, '')));

// ============================================================================
// 2단계: 통보문 CSV -> 구역별 "OO특보 발효 구간" 목록
// ============================================================================
function parseCsvLine(line) {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
        else { if (ch === '"') inQ = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
    }
    out.push(cur);
    return out;
}
function parseKoreanDatetime(s) {
    const m = s.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (!m) return null;
    const [, y, mo, d, h, mi] = m;
    return `${y}-${mo}-${d} ${h}:${mi}`;
}
function daysBetween(a, b) {
    return (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 86400000;
}

function buildIntervals() {
    const raw = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const header = parseCsvLine(lines[0]);
    const idx = { 발효시각: header.indexOf('발효시각'), 해당지역: header.indexOf('해당지역') };
    const TYPE_CODE = { '태풍': 'TY', '풍랑': 'WV', '강풍': 'GW' };

    const openState = {};
    const lastEventAt = {};
    const intervals = {};
    const ensureArr = key => (intervals[key] || (intervals[key] = []));

    for (let li = 1; li < lines.length; li++) {
        const cols = parseCsvLine(lines[li]);
        const effCol = cols[idx.발효시각] || '';
        const zoneCol = cols[idx.해당지역] || '';
        const effItems = {};
        for (const m of effCol.matchAll(/\((\d+)\)\s*([가-힣]+(?:주의보|경보))\s*(발표|해제|대치|변경)\s*:\s*([^/]+)/g)) {
            effItems[m[1]] = m[4].trim();
        }
        for (const m of zoneCol.matchAll(/\((\d+)\)\s*([가-힣]+(?:주의보|경보))\s*(발표|해제|대치|변경)\s*:\s*([^/]+)/g)) {
            const n = m[1], typ = m[2], action = m[3], zonestr = m[4].trim();
            const baseType = Object.keys(TYPE_CODE).find(t => typ.includes(t));
            if (!baseType) continue;
            const tcode = TYPE_CODE[baseType];
            const isSea = tcode === 'TY' || tcode === 'WV';
            const effTime = effItems[n] ? parseKoreanDatetime(effItems[n]) : null;
            if (!effTime) continue;

            for (const rawZone of parseZonestr(zonestr)) {
                if (typeof rawZone === 'object') continue; // 미해결(8개 도 희귀 제외 패턴) — 스킵
                const zz = rawZone.replace(/\s*제외\s*$/, '').trim();
                const resolved = isSea ? resolveSeaZone(zz, seaNames, ZONE_GROUP_MAP) : resolveZone(zz, landNames);
                if (!resolved) continue; // 태풍 항목 속 육상 노이즈 등 — 정상, 스킵

                for (const zone of resolved) {
                    const key = zone + '|' + tcode;
                    if (openState[key] != null && lastEventAt[key] != null && daysBetween(lastEventAt[key], effTime) > STALE_GAP_DAYS) {
                        ensureArr(key).push({ start: openState[key], end: lastEventAt[key] });
                        openState[key] = null;
                    }
                    if (action === '발표') {
                        if (openState[key] == null) openState[key] = effTime;
                    } else if (action === '해제') {
                        if (openState[key] != null) { ensureArr(key).push({ start: openState[key], end: effTime }); openState[key] = null; }
                    } else if (openState[key] == null) {
                        openState[key] = effTime;
                    }
                    lastEventAt[key] = effTime;
                }
            }
        }
    }
    return intervals;
}

// ============================================================================
// 3단계: 사고 좌표 -> 해상구역(포함)/육상구역(3km 이내 최근접) 판정
// ============================================================================
function loadZoneFeatures() {
    const seaFeatures = seaGeo.features.map(f => ({
        name: f.properties.name.replace(/[\s·.]/g, ''),
        geom: turf.feature(f.geometry),
        bbox: turf.bbox(f),
    }));

    const jejuOld = JSON.parse(fs.readFileSync(JEJU_OLD_PATH, 'utf8'));
    const NEW_JEJU_NAMES = ['제주시서부', '제주시동부', '제주시북부', '제주시중산간', '서귀포시서부', '서귀포시동부', '서귀포시남부', '서귀포시중산간'];
    const landFeatures = [];
    for (const f of landGeo.features) {
        if (f.properties.level !== 2 || f.properties.ground !== 'local') continue;
        const name = f.properties.regKo || f.properties.regko;
        if (!name || NEW_JEJU_NAMES.includes(name)) continue; // 신 제주 10구역 이름은 옛 이름으로 대체(아래)
        try {
            landFeatures.push({ name, geom: turf.feature(f.geometry), bbox: turf.bbox(f), line: turf.polygonToLine(f.geometry) });
        } catch (e) { /* 지오메트리 이상 — skip */ }
    }
    for (const f of jejuOld.features) {
        try {
            landFeatures.push({ name: f.properties.name, geom: turf.feature(f.geometry), bbox: turf.bbox(f), line: turf.polygonToLine(f.geometry) });
        } catch (e) { /* skip */ }
    }
    return { seaFeatures, landFeatures };
}

function bboxNear(lon, lat, bbox, marginDeg) {
    return lon >= bbox[0] - marginDeg && lon <= bbox[2] + marginDeg && lat >= bbox[1] - marginDeg && lat <= bbox[3] + marginDeg;
}

function makeZoneFinders(seaFeatures, landFeatures) {
    function findSeaZone(lon, lat) {
        const pt = turf.point([lon, lat]);
        for (const f of seaFeatures) {
            if (!bboxNear(lon, lat, f.bbox, 0.02)) continue;
            try { if (turf.booleanPointInPolygon(pt, f.geom)) return f.name; } catch (e) { }
        }
        return null;
    }
    function findNearLand(lon, lat, dateDash) {
        const pt = turf.point([lon, lat]);
        let best = null, bestDist = Infinity;
        const marginDeg = 0.05; // 3km(~0.027도)보다 여유, 과도하게 넓히면 후보 폭증으로 느려짐
        for (const f of landFeatures) {
            if (!bboxNear(lon, lat, f.bbox, marginDeg)) continue;
            let name = f.name;
            if (name.includes('__pre20221217')) { if (!(dateDash < '2022-12-17')) continue; name = '제주도북부'; }
            else if (name.includes('__from20221217')) { if (!(dateDash >= '2022-12-17')) continue; name = '제주도북부'; }
            else if (name.includes('__pre20221219')) { if (!(dateDash < '2022-12-19')) continue; name = '제주도남부'; }
            else if (name.includes('__from20221219')) { if (!(dateDash >= '2022-12-19')) continue; name = '제주도남부'; }

            let d;
            try {
                if (turf.booleanPointInPolygon(pt, f.geom)) d = 0;
                else d = turf.nearestPointOnLine(f.line, pt).properties.dist; // km
            } catch (e) { continue; }
            if (d < bestDist) { bestDist = d; best = name; }
        }
        return (best != null && bestDist <= NEAR_LAND_KM) ? best : null;
    }
    return { findSeaZone, findNearLand };
}

// ============================================================================
// 4~5단계: 사고 행 -> 발효중인 특보종류 코드 배열
// ============================================================================
function ymdToDash(ymd) { return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`; }
function hmToPadded(hm) { const [h, m] = String(hm).split(':'); return h.padStart(2, '0') + ':' + (m || '00').padStart(2, '0'); }

function makeFlagComputers(intervals, findSeaZone, findNearLand) {
    function activeAt(zone, type, exactTime) {
        const arr = intervals[zone + '|' + type];
        if (!arr) return false;
        return arr.some(iv => exactTime >= iv.start && exactTime < iv.end);
    }
    function activeOnDay(zone, type, dateDash) {
        const arr = intervals[zone + '|' + type];
        if (!arr) return false;
        const dayStart = dateDash + ' 00:00', dayEnd = dateDash + ' 23:59';
        return arr.some(iv => iv.start <= dayEnd && iv.end >= dayStart);
    }
    // hk: 태풍·풍랑만(강풍은 육상 개념이라 배 사고와 무관) — 정확한 시각 기준
    function computeHkFlags(row) {
        const [lat, lon, ymd, hm] = row;
        const exactTime = ymdToDash(ymd) + ' ' + hmToPadded(hm);
        const zone = findSeaZone(lon, lat);
        if (!zone) return [];
        const flags = [];
        if (activeAt(zone, 'TY', exactTime)) flags.push('TY');
        if (activeAt(zone, 'WV', exactTime)) flags.push('WV');
        return flags;
    }
    // person: 태풍·풍랑·강풍 다 — 시각 정보가 없어 날짜 단위(그 날과 조금이라도 겹치면 통과)
    function computePersonFlags(row) {
        const [lat, lon, ymd] = row;
        const dateDash = ymdToDash(ymd);
        const flags = [];
        const seaZone = findSeaZone(lon, lat);
        if (seaZone) {
            if (activeOnDay(seaZone, 'TY', dateDash)) flags.push('TY');
            if (activeOnDay(seaZone, 'WV', dateDash)) flags.push('WV');
        }
        const landZone = findNearLand(lon, lat, dateDash);
        if (landZone && activeOnDay(landZone, 'GW', dateDash)) flags.push('GW');
        return flags;
    }
    return { computeHkFlags, computePersonFlags };
}

// ============================================================================
// 실행
// ============================================================================
function main() {
    console.log('[1/4] 통보문 CSV 파싱 -> 구간표 생성...');
    const intervals = buildIntervals();
    console.log('  (구역,종류) 조합', Object.keys(intervals).length, '개');

    console.log('[2/4] 구역 지오메트리 로드...');
    const { seaFeatures, landFeatures } = loadZoneFeatures();
    const { findSeaZone, findNearLand } = makeZoneFinders(seaFeatures, landFeatures);
    const { computeHkFlags, computePersonFlags } = makeFlagComputers(intervals, findSeaZone, findNearLand);

    console.log('[3/4] 사고 데이터 계산...');
    const hkData = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    const personData = JSON.parse(fs.readFileSync(PERSON_JSON_PATH, 'utf8'));

    const hkStats = {};
    hkData.rows.forEach(row => {
        const flags = computeHkFlags(row);
        row.push(flags);
        const k = flags.join('+') || '없음';
        hkStats[k] = (hkStats[k] || 0) + 1;
    });
    console.log('  hk(선박)', hkData.rows.length, '건 완료 —', hkStats);

    const personStats = {};
    personData.rows.forEach(row => {
        const flags = computePersonFlags(row);
        row.push(flags);
        const k = flags.join('+') || '없음';
        personStats[k] = (personStats[k] || 0) + 1;
    });
    console.log('  person(인명)', personData.rows.length, '건 완료 —', personStats);

    console.log('[4/4] 저장...');
    fs.writeFileSync(HK_JSON_PATH, JSON.stringify(hkData));
    fs.writeFileSync(PERSON_JSON_PATH, JSON.stringify(personData));
    console.log('완료:', HK_JSON_PATH, PERSON_JSON_PATH);
}

if (require.main === module) main();
module.exports = { buildIntervals, loadZoneFeatures, makeZoneFinders, makeFlagComputers };
