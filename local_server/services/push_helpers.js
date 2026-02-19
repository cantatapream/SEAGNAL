/**
 * ============================================================================
 * 파일명: services/push_helpers.js
 * 역할: 푸시 알림 발송을 위한 구역 매칭 및 메시지 생성 헬퍼
 * ============================================================================
 *
 * [설명]
 * 이 파일은 푸시 알림 발송 시 필요한 핵심 로직을 담당합니다.
 * - ZONE_HIERARCHY: 대분류 → 중분류 → 소분류(특보구역) 계층 구조
 * - expandToMinorZones(): 사용자 구독 구역을 소분류로 확장
 * - getMatchedZones(): 사용자 구독 구역과 타겟 구역의 교집합 추출
 * - generateMessage(): 특보 상태별 동적 알림 메시지 생성
 *
 * [연계 파일]
 * - routes/push.js → 커스텀 푸시 발송 시 이 헬퍼들을 사용
 * - app.js (프론트엔드) → SEA_REGIONS + SUB_REGION_ZONES 구조와 일치
 *
 * [초보자를 위한 안내]
 * 해상 특보는 "소분류" 단위(예: 제주도서부앞바다)로 발령됩니다.
 * 하지만 사용자는 "대분류"(예: 제주)나 "중분류"(예: 제주해역)로 구독할 수 있습니다.
 * 이 파일은 사용자가 어떤 단위로 구독했든, 올바른 특보를 받을 수 있도록
 * 구역 계층을 확장하고 교집합을 계산하는 역할을 합니다.
 * ============================================================================
 */

// ============================================================================
// [ZONE_HIERARCHY] 대분류 → 중분류 → 소분류(특보구역) 계층 구조
// 앱의 SEA_REGIONS + SUB_REGION_ZONES 구조와 완전 일치시킴
// ============================================================================
const ZONE_HIERARCHY = {
    // 대분류: 동해
    '동해': {
        '동해중부해상': [
            '강원북부앞바다', '강원중부앞바다', '강원남부앞바다',
            '동해중부안쪽먼바다', '동해중부바깥먼바다'
        ],
        '동해남부해상': [
            '울산앞바다', '경북남부앞바다', '경북북부앞바다',
            '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다',
            '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다'
        ]
    },
    // 대분류: 서해
    '서해': {
        '서해중부해상': [
            '인천·경기북부앞바다', '인천·경기남부앞바다',
            '충남북부앞바다', '충남남부앞바다',
            '서해중부안쪽먼바다', '서해중부바깥먼바다'
        ],
        '서해남부해상': [
            '전북북부앞바다', '전북남부앞바다',
            '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다',
            '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다',
            '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'
        ]
    },
    // 대분류: 남해
    '남해': {
        '남해서부해상': [
            '전남서부남해앞바다', '전남동부남해앞바다',
            '남해서부서쪽먼바다', '남해서부동쪽먼바다'
        ],
        '남해동부해상': [
            '부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다',
            '남해동부안쪽먼바다', '남해동부바깥먼바다'
        ]
    },
    // 대분류: 제주
    '제주': {
        '제주해역': [
            '제주도북부앞바다', '제주도남부앞바다', '제주도동부앞바다', '제주도서부앞바다',
            '제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'
        ]
    }
};

// ============================================================================
// 헬퍼 함수들
// ============================================================================

/**
 * 사용자 구독 목록(대/중/소 혼재)을 모두 소분류(특보구역)로 확장합니다.
 * @param {string[]} userZones - 사용자가 구독한 구역 목록
 * @returns {string[]} 소분류 구역 목록
 */
function expandToMinorZones(userZones) {
    if (!userZones || userZones.length === 0) return [];

    const minorZones = new Set();

    userZones.forEach(uz => {
        // 1. 대분류인지 확인
        if (ZONE_HIERARCHY[uz]) {
            Object.values(ZONE_HIERARCHY[uz]).forEach(minors => {
                minors.forEach(m => minorZones.add(m));
            });
            return;
        }

        // 2. 중분류인지 확인
        for (const major of Object.keys(ZONE_HIERARCHY)) {
            if (ZONE_HIERARCHY[major][uz]) {
                ZONE_HIERARCHY[major][uz].forEach(m => minorZones.add(m));
                return;
            }
        }

        // 3. 소분류(이미 최소 단위)인 경우 그대로 추가
        minorZones.add(uz);
    });

    return Array.from(minorZones);
}

/**
 * 사용자 구독 구역과 타겟 구역의 교집합(실제 보낼 구역들)을 추출합니다.
 * @param {string[]} userZones - 사용자 구독 구역
 * @param {Object[]} targetItems - 타겟 아이템 배열 (각 item에 zones 배열 포함)
 * @param {Object} opts - 옵션 (target: 'all'이면 필터 없이 전체 반환)
 * @returns {Object[]} 필터링된 아이템 배열
 */
function getMatchedZones(userZones, targetItems, opts = {}) {
    // 모든해역 설정인 경우 필터링 없이 전체 반환
    if (opts.target === 'all') return targetItems;

    // 사용자가 아무것도 구독 안했으면 전체 수신 (기존 정책 유지)
    if (!userZones || userZones.length === 0) return targetItems;

    // 사용자 구독 목록을 소분류(특보구역)로 확장
    const expandedUserZones = expandToMinorZones(userZones);
    if (expandedUserZones.length === 0) return [];

    // 교집합 찾기 (Items 구조 유지)
    const filteredItems = [];

    targetItems.forEach(item => {
        const intersection = item.zones.filter(tz =>
            expandedUserZones.includes(tz)
        );

        if (intersection.length > 0) {
            filteredItems.push({
                ...item,
                zones: intersection
            });
        }
    });

    return filteredItems;
}

/**
 * 동적 메시지 생성기 (5가지+ 시나리오 적용)
 * @param {Object} filteredPayload - 필터링된 페이로드
 * @returns {{ title: string, body: string }}
 */
function generateMessage(filteredPayload) {
    const { templateId, typeName, level, items, prevLevel } = filteredPayload;

    let genTitle = '';
    let genBody = '';

    // 시각 포맷 헬퍼: D일 HH:mm 또는 D일 범위시간 형식으로 변환
    const fmt = (str) => {
        if (!str) return '미정';

        // 1. "2026-02-06 12:00" 형식 처리
        const dateMatch = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (dateMatch) {
            const [, , , day, hour, minute] = dateMatch;
            return `${parseInt(day)}일 ${hour}:${minute}`;
        }

        // 2. "2026-02-07 밤(18~24시)" 형식 처리
        const koreanTimeMatch = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(.+)/);
        if (koreanTimeMatch) {
            const [, , , day, timeDesc] = koreanTimeMatch;
            return `${parseInt(day)}일 ${timeDesc}`;
        }

        // 3. 12자리 숫자 형식 (202602061200)
        if (/^\d{12}$/.test(str)) {
            const day = str.substring(6, 8);
            const hour = str.substring(8, 10);
            const minute = str.substring(10, 12);
            return `${parseInt(day)}일 ${hour}:${minute}`;
        }

        // 4. 한국어 형식 "2026년 02월 07일 00시 00분"
        const korFmtMatch = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(.*)/);
        if (korFmtMatch) {
            const [, , , day, rest] = korFmtMatch;
            return `${String(day).padStart(2, '0')}일 ${rest}`.trim();
        }

        // 5. 그 외 (이미 포맷팅된 문자열)
        return str;
    };

    // 시각별 그룹핑 헬퍼
    const groupByTime = (items, timeKey) => {
        const groups = {};
        items.forEach(item => {
            const timeVal = item[timeKey] || '미정';
            if (!groups[timeVal]) {
                groups[timeVal] = [];
            }
            item.zones.forEach(z => {
                if (!groups[timeVal].includes(z)) {
                    groups[timeVal].push(z);
                }
            });
        });
        return groups;
    };

    // 그룹핑된 데이터를 메시지로 변환
    const formatGroupedMessage = (groups, timeLabel) => {
        return Object.entries(groups).map(([time, zones]) => {
            const zStr = zones.join(', ');
            const formattedTime = fmt(time);
            return `ㅇ${zStr}\n   - ${timeLabel} : ${formattedTime}`;
        }).join('\n');
    };

    // '예비' 등급은 실질적으로 '주의보'를 의미하므로 명칭 보정
    let effectiveLevel = level;
    if (level === '예비') {
        effectiveLevel = '주의보';
    }

    const fullTitle = `${typeName}${effectiveLevel ? ' ' + effectiveLevel : ''}`.trim();

    // 1. 발표 (예비특보)
    if (templateId === 'publish') {
        genTitle = `📢 ${fullTitle} 발표`;
        const grouped = groupByTime(items, 'tmEf');
        genBody = formatGroupedMessage(grouped, '발효예정');
    }
    // 2. 발효 (현재 발효)
    else if (templateId === 'active') {
        genTitle = `🚨 ${fullTitle} 발효`;
        const grouped = groupByTime(items, 'tmYn');
        genBody = formatGroupedMessage(grouped, '해제예정');
    }
    // 3. 해제 (특보 종료)
    else if (templateId === 'release') {
        genTitle = `✅ ${fullTitle} 해제`;
        const allZones = [];
        items.forEach(i => i.zones.forEach(z => { if (!allZones.includes(z)) allZones.push(z); }));
        genBody = `ㅇ${allZones.join(', ')}`;
    }
    // 4. 격상 발표
    else if (templateId === 'level_upgrade_publish') {
        const prevLvl = prevLevel || '주의보';
        genTitle = `📢 ${typeName} ${prevLvl}→${effectiveLevel} 격상 발표`;
        const grouped = groupByTime(items, 'tmEf');
        genBody = formatGroupedMessage(grouped, '발효예정');
    }
    // 5. 격상 발효
    else if (templateId === 'level_upgrade_active') {
        const prevLvl = prevLevel || '주의보';
        genTitle = `🚨 ${typeName} ${prevLvl}→${effectiveLevel} 격상 발효`;
        const grouped = groupByTime(items, 'tmYn');
        genBody = formatGroupedMessage(grouped, '해제예정');
    }
    // 6. 격하 발표
    else if (templateId === 'level_downgrade_publish') {
        const prevLvl = prevLevel || '경보';
        genTitle = `📢 ${typeName} ${prevLvl}→${effectiveLevel} 격하 발표`;
        const grouped = groupByTime(items, 'tmEf');
        genBody = formatGroupedMessage(grouped, '발효예정');
    }
    // 7. 격하 발효
    else if (templateId === 'level_downgrade_active') {
        const prevLvl = prevLevel || '경보';
        genTitle = `🚨 ${typeName} ${prevLvl}→${effectiveLevel} 격하 발효`;
        const grouped = groupByTime(items, 'tmYn');
        genBody = formatGroupedMessage(grouped, '해제예정');
    }
    // 8. 발효시각 변경
    else if (templateId === 'time_ef_change') {
        genTitle = `🕐 발효시각 변경`;
        const grouped = groupByTime(items, 'tmEf');
        genBody = formatGroupedMessage(grouped, '발효예정');
    }
    // 9. 해제시각 변경
    else if (templateId === 'time_yn_change') {
        genTitle = `🕐 해제시각 변경`;
        const grouped = groupByTime(items, 'tmYn');
        genBody = formatGroupedMessage(grouped, '해제예정');
    }
    // Fallback
    else {
        genTitle = `📢 ${fullTitle} 알림`;
        genBody = items.map(i => i.zones.join(', ')).join('\n');
    }

    return { title: genTitle, body: genBody };
}

module.exports = {
    ZONE_HIERARCHY,
    expandToMinorZones,
    getMatchedZones,
    generateMessage
};
