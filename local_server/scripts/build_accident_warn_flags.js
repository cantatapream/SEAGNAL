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
 *   hk[12]: ["TY","WV"] 형태 배열(발효중인 종류만, 없으면 []) — 특보 필터가 그대로 씀
 *   person[10]: ["TY","WV","GW"] 형태 배열(위와 동일)
 *
 * [심각도(주의보/경보) 세분화 — 새 필드 추가(2026-08-31 사용자 확정)] 통계 시트의
 * "특보발효" 도넛을 유형×심각도로 쪼개 보여달라는 요청 — 기존 hk[12]/person[10]
 * (유형만, 필터가 쓰는 값)은 그대로 두고, 뒤에 심각도 필드를 새로 추가한다:
 *   hk[16]/person[11]: ["TY_경보","WV_주의보"] 형태 배열(발효중인 유형+심각도 조합,
 *   레벨은 항상 유형당 1개 — 격상/완화 시 구간을 그 시각에 닫고 새로 열어 겹치지 않음).
 *   (hk 는 원래 17 이었으나 2026-09-01 선박사고 전면 재구축으로 사건번호 필드가
 *   빠지며 16으로 당겨짐 — 아래 WARN_SEVERITY_POS_IDX 참고)
 * 재실행 시 기존 hk[12]/person[10] 값을 다시 계산해 그대로 나오는지 먼저 대조 검증하고,
 * 하나라도 다르면 저장하지 않고 중단한다(적대검증 — 레벨 분리로 판정 로직을 바꿨으니
 * "유형만 보면 예전과 똑같다"는 게 재현돼야 심각도 필드도 믿을 수 있다). 단, hk 가
 * 원본 CSV로 전면 재구축돼 유형(row[12])이 전부 미계산([])인 경우는 --recompute-hk
 * 플래그로 이 검증을 건너뛰고 유형까지 새로 쓴다(아래 RECOMPUTE_HK 참고).
 *
 * [연계] 사용하는 파일: warn_zone_parser.js · local_server/config/zone_group_map.js ·
 *        local_server/scripts/data/warn_zone_flags/*
 *        결과 소비처: client/js/marine-life/safety/accident_info.js (특보 필터·통계 도넛)
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

const ROOT = path.resolve(__dirname, '..', '..'); // 저장소 뿌리
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

/**
 * [특보 세분화(2026-08-31, 사용자 확정) — 태풍/풍랑/강풍(유형) × 주의보/경보(심각도)]
 * 원래는 zone+종류(zone|tcode) 하나로 구간을 합쳐 관리했다(주의보든 경보든 "그 종류
 * 발효중"으로만 취급). 통계 도넛에서 심각도까지 쪼개 보여달라는 요청으로, 구간 키에
 * 심각도를 더한 zone|tcode|level 로 나눠 관리한다. 격상/완화(예: 주의보→경보로 "대치")
 * 는 이전 레벨 구간을 그 시각에 닫고 새 레벨 구간을 같은 시각에 연다 — 그래서 두 레벨
 * 구간의 합집합은 예전 방식의 단일 구간과 정확히 같다(경계에서 닫힘/열림이 맞물려
 * 빈틈이 없음). 이 성질 덕분에 기존 "발효중이었는지"(유형만, 심각도 무관) 판정은
 * main() 에서 재계산해 기존 저장값과 대조 검증한다 — 다르면 저장하지 않고 중단.
 */
function buildIntervals() {
    const raw = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const header = parseCsvLine(lines[0]);
    const idx = { 발효시각: header.indexOf('발효시각'), 해당지역: header.indexOf('해당지역') };
    const TYPE_CODE = { '태풍': 'TY', '풍랑': 'WV', '강풍': 'GW' };

    const openLevel = {};   // zoneType(zone|tcode) -> '주의보'|'경보'|null
    const openSince = {};   // zoneType -> 그 레벨이 시작된 시각
    const lastEventAt = {};
    const intervals = {};   // zoneType|level -> [{start,end}]
    const ensureArr = key => (intervals[key] || (intervals[key] = []));

    function closeCurrent(zoneType, atTime) {
        const lvl = openLevel[zoneType];
        if (lvl == null) return;
        ensureArr(zoneType + '|' + lvl).push({ start: openSince[zoneType], end: atTime });
        openLevel[zoneType] = null;
        openSince[zoneType] = null;
    }

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
            const level = typ.includes('경보') ? '경보' : '주의보';
            const isSea = tcode === 'TY' || tcode === 'WV';
            const effTime = effItems[n] ? parseKoreanDatetime(effItems[n]) : null;
            if (!effTime) continue;

            for (const rawZone of parseZonestr(zonestr)) {
                if (typeof rawZone === 'object') continue; // 미해결(8개 도 희귀 제외 패턴) — 스킵
                const zz = rawZone.replace(/\s*제외\s*$/, '').trim();
                const resolved = isSea ? resolveSeaZone(zz, seaNames, ZONE_GROUP_MAP) : resolveZone(zz, landNames);
                if (!resolved) continue; // 태풍 항목 속 육상 노이즈 등 — 정상, 스킵

                for (const zone of resolved) {
                    const zoneType = zone + '|' + tcode;
                    if (openLevel[zoneType] != null && lastEventAt[zoneType] != null && daysBetween(lastEventAt[zoneType], effTime) > STALE_GAP_DAYS) {
                        closeCurrent(zoneType, lastEventAt[zoneType]);
                    }
                    if (action === '해제') {
                        closeCurrent(zoneType, effTime);
                    } else if (openLevel[zoneType] == null) {
                        openLevel[zoneType] = level;
                        openSince[zoneType] = effTime;
                    } else if (openLevel[zoneType] !== level) {
                        // 레벨 변경(예: 주의보→경보 격상/완화) — 이전 레벨을 이 시각에 닫고 새 레벨을 연다
                        closeCurrent(zoneType, effTime);
                        openLevel[zoneType] = level;
                        openSince[zoneType] = effTime;
                    } // 같은 레벨의 반복(발표/대치/변경) — since 그대로 유지
                    lastEventAt[zoneType] = effTime;
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
        // [2026-10-10] 짧은 이름(regko, 예 '거제')도 함께 보관 — 통보문 구간은 짧은 이름으로 쌓인 것이 많다(아래 zoneKeys 참고)
        const alt = f.properties.regko && f.properties.regko !== name ? f.properties.regko : null;
        try {
            landFeatures.push({ name, alt, geom: turf.feature(f.geometry), bbox: turf.bbox(f), line: turf.polygonToLine(f.geometry) });
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
            if (d < bestDist) { bestDist = d; best = f.alt ? [name, f.alt] : name; }
        }
        // 반환: 이름 하나(문자열) 또는 [긴 이름, 짧은 이름] — levelOnDay 가 둘 다 찾는다
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
    // [2026-10-10, 사용자 지시 "기존 특보구역 명을 변경하는것이 아닌 그 데이터도 받아올 수 있도록 넓히라"]
    // 구간 키의 구역 이름은 통보문 표기 그대로 둔다. 대신 찾을 때 표기 차이를 넓게 받는다.
    //  ① 해상: 통보문 키는 '인천·경기남부앞바다'(가운뎃점), 사고 위치 판정은 '인천경기남부앞바다'(정규화) —
    //     공백·가운뎃점·마침표를 지운 이름이 같으면 같은 구역으로 본다.
    //  ② 육상(강풍): 통보문 키는 '거제'(짧은 이름)와 '거제시'(긴 이름), '속초평지', '부산'(부산중부의 상위) 등이
    //     섞여 있다 — findNearLand 가 돌려준 두 이름(긴·짧은) 각각에서 앱 사고정보 탭의 특보 일수 계산과
    //     **같은 후보 규칙**(client/js/marine-life/safety/accident_info.js warnZoneNameCandidates)으로
    //     후보 이름을 만들어, 구간 자료에 있는 후보 **전부의 구간을 합집합**한다(앱과 같은 방식).
    // 같은 구역의 여러 표기 구간을 합쳐서 보므로, 원래 맞던 구역의 결과는 바뀌지 않는다(추가만 됨).
    const normZone = z => String(z).replace(/[\s·.]/g, '');
    const byNorm = {};   // 정규화 이름|종류|레벨 -> [{start,end}] (표기가 다른 키를 모두 합침)
    for (const [k, arr] of Object.entries(intervals)) {
        const [z, t, l] = k.split('|');
        const nk = normZone(z) + '|' + t + '|' + l;
        (byNorm[nk] || (byNorm[nk] = [])).push(...arr);
    }
    // 앱 accident_info.js warnZoneNameCandidates 와 같은 규칙(상위 구역 parents 후보만 빠짐 — 이 스크립트의
    // 육상 구역 파일에는 parents 가 없다). 규칙을 바꾸면 두 곳을 같이 바꿀 것.
    const DIR_SUFFIX = /(중부|서부|동부|남부|북부|영종|도서)$/;
    function landCandidates(name) {
        const out = [];
        const push = v => { if (v && !out.includes(v)) out.push(v); };
        const n = normZone(name); push(n);
        const noTag = n.replace(/__.*$/, ''); push(noTag);
        const noParen = noTag.replace(/\(.*?\)/g, ''); push(noParen);
        [noTag, noParen].forEach(b => {
            push(b.replace(/(시|군|구)(?=(평지|산지)?$)/, ''));
            push(b.replace(/(시|군|구)/g, ''));
            const base = b.replace(DIR_SUFFIX, ''); push(base); push(base.replace(/(시|군|구)$/, ''));
            push(b + '평지'); push(b.replace(/(시|군|구)$/, '') + '평지');
            const tail = b.match(/(평지|산지)$/);
            if (tail) { const head = b.slice(0, -tail[0].length); ['시', '군', '구'].forEach(u => push(head + u + tail[0])); }
        });
        return out;
    }
    // 해상(문자열)은 정규화 이름만, 육상(findNearLand 가 준 [긴 이름, 짧은 이름] 또는 이름)은 후보 규칙까지 넓힌다.
    const zoneKeys = (zone, wide) => [...new Set((Array.isArray(zone) ? zone : [zone]).flatMap(z => wide ? landCandidates(z) : [normZone(z)]))];
    const ivs = (zone, type, level) => zoneKeys(zone, type === 'GW').flatMap(z => byNorm[z + '|' + type + '|' + level] || []);
    // 두 레벨 구간의 합집합이 예전 단일 구간과 같으므로(위 buildIntervals 주석 참고),
    // "발효중이었는지"(레벨 무관)는 두 레벨 중 하나라도 걸리면 true — 기존 flags 산출과 동일.
    function levelAt(zone, type, exactTime) {
        for (const level of ['경보', '주의보']) {
            const arr = ivs(zone, type, level);
            if (arr.some(iv => exactTime >= iv.start && exactTime < iv.end)) return level;
        }
        return null;
    }
    function levelOnDay(zone, type, dateDash) {
        const dayStart = dateDash + ' 00:00', dayEnd = dateDash + ' 23:59';
        for (const level of ['경보', '주의보']) {
            const arr = ivs(zone, type, level);
            if (arr.some(iv => iv.start <= dayEnd && iv.end >= dayStart)) return level;
        }
        return null;
    }
    // hk: 태풍·풍랑만(강풍은 육상 개념이라 배 사고와 무관) — 정확한 시각 기준
    // [반환] flags: 기존과 동일한 ['TY','WV'] 형태(필터가 그대로 씀) /
    //        severity: 새로 추가된 ['TY_경보','WV_주의보'] 형태(통계 도넛 전용, 2026-08-31)
    function computeHkFlags(row) {
        const [lat, lon, ymd, hm] = row;
        const exactTime = ymdToDash(ymd) + ' ' + hmToPadded(hm);
        const zone = findSeaZone(lon, lat);
        if (!zone) return { flags: [], severity: [] };
        const flags = [], severity = [];
        const tyLevel = levelAt(zone, 'TY', exactTime);
        if (tyLevel) { flags.push('TY'); severity.push('TY_' + tyLevel); }
        const wvLevel = levelAt(zone, 'WV', exactTime);
        if (wvLevel) { flags.push('WV'); severity.push('WV_' + wvLevel); }
        return { flags, severity };
    }
    // person: 태풍·풍랑·강풍 다 — 시각 정보가 없어 날짜 단위(그 날과 조금이라도 겹치면 통과)
    function computePersonFlags(row) {
        const [lat, lon, ymd] = row;
        const dateDash = ymdToDash(ymd);
        const flags = [], severity = [];
        const seaZone = findSeaZone(lon, lat);
        if (seaZone) {
            const tyLevel = levelOnDay(seaZone, 'TY', dateDash);
            if (tyLevel) { flags.push('TY'); severity.push('TY_' + tyLevel); }
            const wvLevel = levelOnDay(seaZone, 'WV', dateDash);
            if (wvLevel) { flags.push('WV'); severity.push('WV_' + wvLevel); }
        }
        const landZone = findNearLand(lon, lat, dateDash);
        if (landZone) {
            const gwLevel = levelOnDay(landZone, 'GW', dateDash);
            if (gwLevel) { flags.push('GW'); severity.push('GW_' + gwLevel); }
        }
        return { flags, severity };
    }
    return { computeHkFlags, computePersonFlags };
}

// ============================================================================
// 실행
// ============================================================================
// 기존 warn flags 필드 위치(최초 실행 때 이미 append됨) — 재실행 시 이 값을 다시 계산해
// 대조 검증만 하고 덮어쓰지 않는다(레벨 분리로 판정 로직을 바꿨으니, 유형만 놓고 보면
// 예전과 똑같이 나오는지 먼저 확인하지 않고 severity 를 얹으면 조용히 틀린 데이터가
// 쌓일 위험이 있다 — 2026-08-31, 적대검증 원칙 적용).
const WARN_FLAGS_POS_IDX = { hk: 12, person: 10 };
// [hk: 17→16, 2026-09-01] 선박사고 전면 재구축(build_ship_accidents_v2.js)이 hk
// 스키마에서 사건번호(caseNo, 옛 index16) 필드를 없애 17개→16개가 됐다 — season(15)
// 바로 다음이 severity 자리라 16으로 당김(client/js/marine-life/safety/accident_info.js
// 의 같은 이름 상수도 함께 갱신해야 함).
const WARN_SEVERITY_POS_IDX = { hk: 16, person: 11 };

function main() {
    console.log('[1/5] 통보문 CSV 파싱 -> 구간표(유형×심각도) 생성...');
    const intervals = buildIntervals();
    console.log('  (구역,종류,심각도) 조합', Object.keys(intervals).length, '개');

    console.log('[2/5] 구역 지오메트리 로드...');
    const { seaFeatures, landFeatures } = loadZoneFeatures();
    const { findSeaZone, findNearLand } = makeZoneFinders(seaFeatures, landFeatures);
    const { computeHkFlags, computePersonFlags } = makeFlagComputers(intervals, findSeaZone, findNearLand);

    console.log('[3/5] 사고 데이터 재계산 + 기존 판정과 대조 검증...');
    const hkData = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    const personData = JSON.parse(fs.readFileSync(PERSON_JSON_PATH, 'utf8'));

    function verifyAndCollect(rows, computeFn, flagsIdx) {
        let mismatch = 0;
        const severities = [], flagsList = [];
        rows.forEach((row) => {
            const { flags, severity } = computeFn(row);
            const existing = row[flagsIdx] || [];
            const same = existing.length === flags.length && existing.every(c => flags.includes(c));
            if (!same) mismatch++;
            severities.push(severity);
            flagsList.push(flags);
        });
        return { severities, flagsList, mismatch };
    }

    // [--recompute-hk/--recompute-person, 2026-09-01] hk 는 원본 CSV로 전면 재구축돼
    // (build_ship_accidents_v2.js) row[12](특보유형)가 전부 자리만 맞춘 빈 배열([],
    // "미계산")이다. person 도 이번 세션에 ERR_CD 필터로 다시 만들어져(build_accidents.js
    // buildPersons()) row 가 10개 필드뿐 — warnFlags/severity 필드 자체가 없다(직접
    // 확인: field-length 10, row[10] 전부 undefined). 두 경우 다 아래 자기검증("기존
    // 저장값과 같아야 한다")의 전제 자체가 안 맞는다 — 기존 값이 애초에 미계산이라
    // "달라졌는지" 볼 대상이 없다. 그래서 해당 소스는 검증 없이 유형까지 새로 쓴다
    // (사용자 확정 2026-09-01: "재계산 진행하자").
    const RECOMPUTE_HK = process.argv.includes('--recompute-hk');
    const RECOMPUTE_PERSON = process.argv.includes('--recompute-person');

    const hkResult = verifyAndCollect(hkData.rows, computeHkFlags, WARN_FLAGS_POS_IDX.hk);
    const personResult = verifyAndCollect(personData.rows, computePersonFlags, WARN_FLAGS_POS_IDX.person);
    console.log('  hk 유형 판정 불일치:', hkResult.mismatch, '/', hkData.rows.length, RECOMPUTE_HK ? '(재계산 모드 — 무시하고 새로 씀)' : '');
    console.log('  person 유형 판정 불일치:', personResult.mismatch, '/', personData.rows.length, RECOMPUTE_PERSON ? '(재계산 모드 — 무시하고 새로 씀)' : '');
    if ((!RECOMPUTE_HK && hkResult.mismatch > 0) || (!RECOMPUTE_PERSON && personResult.mismatch > 0)) {
        console.error('[중단] 레벨 분리 후에도 기존 "발효중" 판정(유형만)이 똑같이 나와야 하는데 달라졌다.');
        console.error('       buildIntervals()의 레벨 전환 로직을 다시 확인할 것 — 저장하지 않고 종료.');
        process.exit(1);
    }

    console.log('[4/5] 심각도(주의보/경보) 필드 반영...');
    hkData.rows.forEach((row, i) => {
        if (RECOMPUTE_HK) row[WARN_FLAGS_POS_IDX.hk] = hkResult.flagsList[i]; // 유형도 새로 씀
        if (row.length > WARN_SEVERITY_POS_IDX.hk) row[WARN_SEVERITY_POS_IDX.hk] = hkResult.severities[i];
        else row.push(hkResult.severities[i]);
    });
    personData.rows.forEach((row, i) => {
        if (RECOMPUTE_PERSON) row[WARN_FLAGS_POS_IDX.person] = personResult.flagsList[i]; // 유형도 새로 씀
        if (row.length > WARN_SEVERITY_POS_IDX.person) row[WARN_SEVERITY_POS_IDX.person] = personResult.severities[i];
        else row.push(personResult.severities[i]);
    });
    const sevStats = {};
    hkResult.severities.concat(personResult.severities).forEach(s => {
        const k = s.length ? s.join('+') : '없음';
        sevStats[k] = (sevStats[k] || 0) + 1;
    });
    console.log('  심각도 분포(hk+person):', sevStats);

    console.log('[5/5] 저장...');
    fs.writeFileSync(HK_JSON_PATH, JSON.stringify(hkData));
    fs.writeFileSync(PERSON_JSON_PATH, JSON.stringify(personData));
    console.log('완료:', HK_JSON_PATH, PERSON_JSON_PATH);
}

if (require.main === module) main();
module.exports = { buildIntervals, loadZoneFeatures, makeZoneFinders, makeFlagComputers, WARN_SEVERITY_POS_IDX };
