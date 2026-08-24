/**
 * ============================================================================
 * 파일명: local_server/scripts/warn_zone_parser.js
 * 역할: 기상특보 통보문의 "해당지역" 텍스트를 실제 구역명 리스트로 분해하는 파서.
 *       build_accident_warn_flags.js 가 사용(단독 실행 없음).
 * ============================================================================
 *
 * [배경] FCT_WRN 통보문 CSV(2016~2025)의 "해당지역" 칸은 사람이 읽으라고 쓴 문장
 * (예: "경상북도(울진군평지. 포항시. 영덕군)")이라 그대로는 못 씀. 아래를 처리:
 *   1) 괄호 안/밖 구분해 ". "(마침표+공백)로 항목 분리, 괄호 안 "제외" 처리
 *   2) 강원북부/중부/남부산지·경북북동산지 그룹명 전개 — CSV 안에서 그룹명과 개별
 *      구역이 같은 통보문에 함께 나온 사례(co-occurrence)로 역산해 확정(추측 아님,
 *      2026-08-24 검증)
 *   3) "산간"↔"산지" 표기차, 파주↔파주시 등 소수 별칭
 *   4) 해상(태풍·풍랑) 쪽 "동해중부먼바다" 같은 묶음명은 local_server/config/
 *      zone_group_map.js 가 이미 갖고 있어(다른 목적으로 이미 존재) 그대로 재사용.
 *
 * 검증 결과(2026-08-24): 태풍+풍랑+강풍 전체 49,404개 구역 표현 중 99.86% 해석 성공.
 * 남은 0.14%는 8개 도의 희귀 "OO 제외" 패턴(각 1~5건, 그 도 전체 하위구역 목록을
 * 안 만듦) — 무시해도 되는 수준이라 손 안 댐.
 *
 * [연계] 사용하는 파일: local_server/config/zone_group_map.js
 *        나를 쓰는 곳: local_server/scripts/build_accident_warn_flags.js
 * ============================================================================
 */
'use strict';

const GROUP_EXPANSION = {
    '강원북부산지': ['고성군산지', '속초시산지', '양양군산지', '인제군산지'],
    '강원중부산지': ['강릉시산지', '양구군산지', '평창군산지', '홍천군산지'],
    '강원남부산지': ['동해시산지', '삼척시산지', '정선군산지'],
    '경북북동산지': ['봉화군산지', '영양군산지', '울진군산지'],
};

// "제외" 처리용 — 부모 하위 전체 목록(현재 확인된 두 곳만; 나머지 부모는 목록 없으면 그대로 둠)
const PARENT_CHILDREN = {
    '인천': ['강화군', '옹진군', '인천'],
    '제주도': ['제주도북부', '제주도남부', '제주도동부', '제주도서부', '제주도산지', '추자도'],
};

/** "부모(자식1. 자식2)"/"부모(자식 제외)"/"단독구역명" 혼합 문자열을 구역명 배열로 분해.
 * 괄호 안의 부모 하위 전체 목록을 모르는 "제외" 패턴은 {unresolved:true, raw} 로 표시. */
function parseZonestr(s) {
    const parts = [];
    let cur = '';
    let depth = 0;
    for (let j = 0; j < s.length; j++) {
        const ch = s[j];
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth--; cur += ch; }
        else if (depth === 0 && s.slice(j, j + 2) === '. ') { parts.push(cur); cur = ''; j++; }
        else { cur += ch; }
    }
    if (cur) parts.push(cur);

    const zones = [];
    for (let part of parts) {
        part = part.trim();
        const m = part.match(/^(.+?)\((.+)\)$/);
        if (m) {
            const parent = m[1].trim();
            const inner = m[2].trim();
            if (inner.endsWith('제외')) {
                const excludedRaw = inner.replace(/\s*제외\s*$/, '').trim();
                const excluded = excludedRaw.split('. ').map(x => x.trim());
                const children = PARENT_CHILDREN[parent];
                if (children) {
                    for (const c of children) {
                        if (!excluded.includes(c)) zones.push(c);
                    }
                } else {
                    zones.push({ unresolved: true, raw: part });
                }
            } else {
                for (const sub of inner.split('. ')) {
                    zones.push(sub.trim());
                }
            }
        } else {
            zones.push(part);
        }
    }
    return zones;
}

// CSV 표기 <-> geojson 표기가 다른 소수 사례(실증 확인: CSV 전체 기간에서 딱 이 형태로만 씀)
const ALIAS = {
    '파주': '파주시',
    '동남권': '서울동남권',
    '동북권': '서울동북권',
    '서남권': '서울서남권',
    '서북권': '서울서북권',
};

/** 육상(강풍) 구역명 리졸버 — zoneNames 는 wrnArea_land.geojson 의 regko/regKo 전체 집합. */
function resolveZone(name, zoneNames) {
    if (typeof name !== 'string') return null;
    if (zoneNames.has(name)) return [name];
    if (ALIAS[name] && zoneNames.has(ALIAS[name])) return [ALIAS[name]];
    const sanji = name.replace(/산간/g, '산지');
    if (zoneNames.has(sanji)) return [sanji];
    if (GROUP_EXPANSION[name]) return GROUP_EXPANSION[name].slice();
    if (name.includes('.') && !name.includes('. ')) {
        const combo = name.split('.').map(s => s.trim()).filter(Boolean);
        if (combo.every(c => zoneNames.has(c))) return combo;
    }
    return null; // 미해결
}

// (제주도남쪽먼바다: CSV 표기, 실제 zone명은 "제주도남쪽바깥먼바다" — "남쪽" 갈래엔 "안쪽"이 없어 1:1 별칭)
const SEA_ALIAS = { '제주도남쪽먼바다': '제주도남쪽바깥먼바다' };

/** 해상(태풍·풍랑) 구역명 리졸버 — seaNames 는 warn_zones.geojson(44개) name 집합(공백·마침표 제거). */
function resolveSeaZone(name, seaNames, ZONE_GROUP_MAP) {
    if (typeof name !== 'string') return null;
    const aliased = SEA_ALIAS[name] || name;
    const nn = aliased.replace(/[\s·.]/g, '');
    if (seaNames.has(nn)) return [aliased];
    if (ZONE_GROUP_MAP[name]) return ZONE_GROUP_MAP[name].slice();
    const m = name.match(/^(.+?)(북쪽|남쪽)먼바다$/);
    if (m) {
        const cand = [m[1] + m[2] + '안쪽먼바다', m[1] + m[2] + '바깥먼바다'];
        if (cand.every(c => seaNames.has(c.replace(/[\s·.]/g, '')))) return cand;
    }
    return null;
}

module.exports = { parseZonestr, resolveZone, resolveSeaZone, GROUP_EXPANSION, PARENT_CHILDREN, SEA_ALIAS };
