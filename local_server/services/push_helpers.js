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

// ============================================================================
// [v7] 관리자용 자식 정보 통합 푸시 (PARENT_PUSH_WITH_CHILDREN.md)
// ============================================================================
//
// 본 블록은 "부모 푸시 + 자식 정보 통합 (관리자 시범 적용)" 기능을 담당합니다.
//
// 핵심 설계 — Agent B 차별화 시각:
//   - 클래스 기반 (PushBuilder, PushSplitter) — 상태(시간 라벨, 부모/자식 정보,
//     누적 문자열) 를 메서드 단위로 캡슐화
//   - 단계별 try/catch — 외부에서 들어온 데이터 변형 (children 누락 등) 에 강건
//   - 테이블 기반 dispatch — eventType → handler 매핑 (switch/if-else 체인 회피)
//
// 일반 사용자 푸시 흐름 (push_sender.js / generateMessage 기존 분기) 는
// **변화 없음**. 본 블록은 audience='admin' 일 때만 활성화됩니다.
// ============================================================================

/** 부모 → 자식 타입 분류 (28 부모) — ZONE_MAPPING.md 의 그룹 정의 */
const PARENT_CHILD_TYPE = {
    // (A) 연안바다만
    '강원북부앞바다': 'connection',
    '강원중부앞바다': 'connection',
    '강원남부앞바다': 'connection',
    '경북북부앞바다': 'connection',
    '거제시동부앞바다': 'connection',
    '제주도북부앞바다': 'connection',
    '제주도남부앞바다': 'connection',
    '동해중부안쪽먼바다': 'connection',
    '남해서부서쪽먼바다': 'connection',
    '제주도동부앞바다': 'connection',
    '제주도서부앞바다': 'connection',

    // (B) 평수구역만
    '인천·경기북부앞바다': 'pyeongsu',
    '인천·경기남부앞바다': 'pyeongsu',
    '전북북부앞바다': 'pyeongsu',
    '전북남부앞바다': 'pyeongsu',
    '전남북부서해앞바다': 'pyeongsu',
    '전남중부서해앞바다': 'pyeongsu',
    '전남남부서해앞바다': 'pyeongsu',
    '전남서부남해앞바다': 'pyeongsu',
    '전남동부남해앞바다': 'pyeongsu',
    '충남북부앞바다': 'pyeongsu',
    '충남남부앞바다': 'pyeongsu',
    '서해남부남쪽안쪽먼바다': 'pyeongsu',

    // (C) 둘 다
    '울산앞바다': 'both',
    '경북남부앞바다': 'both',
    '경남중부남해앞바다': 'both',
    '부산앞바다': 'both'
};

/** 자식 타입 → 라벨 */
const TYPE_LABEL = {
    connection: '연안바다',
    pyeongsu: '평수구역',
    both: '평수구역/연안바다'
};

/** 시간 라벨 매핑 — 본문 줄에 들어가는 prefix */
const TIME_LABEL_BY_EVENT = {
    publish: '발효예정',
    active: '해제예정',
    additional_active: '해제예정',
    prelim_cancel: null,        // 시간 없음
    partial_release: null,      // 시간 없음
    release: null,              // 시간 없음
    level_upgrade_publish: '발효예정',
    level_upgrade_active: '해제예정',
    level_downgrade_publish: '발효예정',
    level_downgrade_active: '해제예정',
    type_upgrade_publish: '발효예정',
    type_upgrade_active: '해제예정',
    type_downgrade_publish: '발효예정',
    type_downgrade_active: '해제예정',
    time_ef_change: '발효예정',
    time_yn_change: '해제예정'
};

/** 시간 키 — items 안의 어느 필드를 시간으로 쓰는가 */
const TIME_KEY_BY_EVENT = {
    publish: 'tmEf',
    active: 'tmYn',
    additional_active: 'tmYn',
    level_upgrade_publish: 'tmEf',
    level_upgrade_active: 'tmYn',
    level_downgrade_publish: 'tmEf',
    level_downgrade_active: 'tmYn',
    type_upgrade_publish: 'tmEf',
    type_upgrade_active: 'tmYn',
    type_downgrade_publish: 'tmEf',
    type_downgrade_active: 'tmYn',
    time_ef_change: 'tmEf',
    time_yn_change: 'tmYn'
};

/**
 * [Synthesis Q] 자식 풀네임에서 부모명+'중' prefix 제거 (Agent C C1 흡수).
 *
 * 예: '제주도서부앞바다중북서연안바다' → '북서연안바다'
 *     '천수만평수구역' → '천수만평수구역' (prefix 없음 → 그대로)
 *
 * SPEC §2 의 "자식 풀네임 사용" 은 mappings.js 의 정식 식별자 기준이며,
 * 본문 표기 시에는 사용자 가독성을 위해 부모명 접두사를 제거한 short name 사용.
 */
function _stripParentPrefix(parent, child) {
    if (!parent || !child) return child || '';
    const pfx = parent + '중';
    return child.startsWith(pfx) ? child.substring(pfx.length) : child;
}

/**
 * 자식 한정사 빌더 — 부모 한 줄의 괄호 부분을 구성.
 *
 * @param {string} parent      — 부모 zone 이름 (예: '제주도서부앞바다')
 * @param {Object} childState  — 자식 발효 상태 정보
 *     {
 *       active:   string[],   // 현재 발효 중인 자식 fullName 들
 *       all:      string[],   // 부모 산하 모든 자식 fullName 들 (mappings 기반)
 *       added:    string[],   // 이번 사이클에 새로 추가된 자식 (additional_active)
 *       released: string[],   // 해제된 자식 (partial_release)
 *       allReleased: boolean  // 모든 자식이 한꺼번에 해제
 *     }
 * @param {string} eventType   — 이벤트 종류 (publish/active/release/...)
 * @returns {string}           — `(연안바다 포함)` / `(가파도연안바다만 해제)` 등.
 *                                 한정사가 필요 없으면 '' 반환.
 */
function buildChildQualifier(parent, childState, eventType) {
    try {
        const ptype = PARENT_CHILD_TYPE[parent];
        const label = TYPE_LABEL[ptype] || '연안바다';
        const safe = childState || {};
        const all = Array.isArray(safe.all) ? safe.all : [];
        const active = Array.isArray(safe.active) ? safe.active : [];
        const added = Array.isArray(safe.added) ? safe.added : [];
        const released = Array.isArray(safe.released) ? safe.released : [];

        // 부모+자식 동시 해제: 부모명만, 한정사 없음 (S13)
        if (eventType === 'release') return '';

        // 예비특보 취소: 부모명만 (S10)
        if (eventType === 'prelim_cancel') return '';

        // 자식만 해제 (S11, S12) — partial_release
        if (eventType === 'partial_release') {
            if (safe.allReleased || released.length === all.length && all.length > 0) {
                return `(모든 ${label} 해제)`;
            }
            if (released.length > 0) {
                const shown = released.map(c => _stripParentPrefix(parent, c));
                return `(${shown.join(', ')}만 해제)`;
            }
            return '';
        }

        // 추가 발효 (S8, S9): 자식만 추가
        if (eventType === 'additional_active') {
            if (added.length > 0) {
                const shown = added.map(c => _stripParentPrefix(parent, c));
                return `(${shown.join(', ')} 추가 발효)`;
            }
            return '';
        }

        // 등급/종류 격상·격하 — 자식 동반 X 시 "(X 격상/격하 없음)" (S15/S17/S19/S21)
        const isLevelChange =
            eventType === 'level_upgrade_publish' || eventType === 'level_upgrade_active' ||
            eventType === 'level_downgrade_publish' || eventType === 'level_downgrade_active' ||
            eventType === 'type_upgrade_publish' || eventType === 'type_upgrade_active' ||
            eventType === 'type_downgrade_publish' || eventType === 'type_downgrade_active';
        const isDown =
            eventType === 'level_downgrade_publish' || eventType === 'level_downgrade_active' ||
            eventType === 'type_downgrade_publish' || eventType === 'type_downgrade_active';
        if (isLevelChange && active.length === 0) {
            return `(${label} ${isDown ? '격하' : '격상'} 없음)`;
        }

        // 자식만 시각 변경 (S24/S25)
        if ((eventType === 'time_ef_change' || eventType === 'time_yn_change') &&
            safe.parentTimeUnchanged === true && active.length > 0) {
            return `(${label}만 시각 변경)`;
        }

        // ----- 발표/발효/시각변경/격상격하 — 자식 발효 매트릭스 -----
        // 부모만 발효, 자식 미발효
        if (active.length === 0) {
            return `(${label} 미발효)`;
        }

        // 부모 + 모든 자식
        if (all.length > 0 && active.length === all.length) {
            // 자식 1개짜리 부모는 "(평수구역 포함)" 형태 (S3)
            if (all.length === 1) {
                return `(${label} 포함)`;
            }
            return `(모든 ${label} 포함)`;
        }

        // 부모 + 자식 일부 (자식 이름 나열)
        if (active.length > 0) {
            const shown = active.map(c => _stripParentPrefix(parent, c));
            return `(${shown.join(', ')} 포함)`;
        }

        return '';
    } catch (err) {
        console.warn('[push_helpers] buildChildQualifier 실패 — 빈 한정사로 폴백:', err && err.message);
        return '';
    }
}

/**
 * PushBuilder — 한 시간 그룹의 본문 (부모 줄 묶음) 을 만든다.
 *
 *   사용 예:
 *     const b = new PushBuilder(eventType);
 *     b.addParent({ name, qualifier, time });
 *     b.addParent(...)
 *     const lines = b.renderLines();   // 시간 라벨 1줄 + 부모 줄 N
 */
class PushBuilder {
    constructor(eventType) {
        this.eventType = eventType;
        this.timeLabel = TIME_LABEL_BY_EVENT[eventType] || null;
        this.parents = [];  // { name, qualifier, time }
    }

    addParent({ name, qualifier, time }) {
        this.parents.push({ name, qualifier: qualifier || '', time: time || '' });
    }

    /**
     * 같은 시간(time) 끼리 묶어 렌더링.
     * 반환: 시간 그룹별 본문 string[] (각 그룹 안엔 부모줄들 + 시간 라벨 1줄)
     */
    renderTimeGroups(fmtFn) {
        if (this.timeLabel === null) {
            // 시간 라벨 없는 이벤트 — 그냥 부모 줄만 묶어 1개 본문 반환
            const lines = this.parents.map(p => `ㅇ${p.name}${p.qualifier}`);
            return [lines.join('\n')];
        }
        // 시간별 그룹화 (삽입 순서 유지)
        const groups = new Map();
        for (const p of this.parents) {
            const key = p.time || '미정';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(`ㅇ${p.name}${p.qualifier}`);
        }
        const bodies = [];
        for (const [time, lines] of groups) {
            const body = [
                ...lines,
                `   - ${this.timeLabel} : ${fmtFn(time)}`
            ].join('\n');
            bodies.push(body);
        }
        return bodies;
    }
}

/**
 * PushSplitter — Greedy first-fit 분할 (v7 알고리즘).
 *
 *   사용 예:
 *     const s = new PushSplitter({ effectiveMax: 165 });
 *     for (body of groupBodies) s.feed(body);
 *     const pushes = s.flush();        // string[] — 각 1건 푸시 본문
 */
class PushSplitter {
    constructor(opts = {}) {
        this.MAX_BODY = opts.maxBody || 200;
        // 제목 + (n/N) 등 안전 마진. spec §7 의 EFFECTIVE_MAX=165 기본.
        this.EFFECTIVE_MAX = opts.effectiveMax || 165;
        this.current = '';
        this.pushes = [];
    }

    /** 한 시간 그룹 본문을 받아 누적. greedy first-fit. */
    feed(groupBody) {
        if (!groupBody) return;
        const sep = this.current ? 1 : 0; // '\n'
        const projected = this.current.length + sep + groupBody.length;
        if (projected <= this.EFFECTIVE_MAX) {
            this.current = this.current ? (this.current + '\n' + groupBody) : groupBody;
            return;
        }
        // 못 들어감 → 현재 버퍼 확정 후 새로 시도
        if (this.current) {
            this.pushes.push(this.current);
            this.current = '';
        }
        if (groupBody.length > this.EFFECTIVE_MAX) {
            // 한 시간 그룹 단독으로 한도 초과 → 줄(부모) 단위 분할
            const lines = groupBody.split('\n');
            // 시간 라벨 줄(첫 글자가 공백) 추출 — 매 청크에 반복 부착
            const timeLine = lines.find(l => l.startsWith('   - ')) || '';
            const parentLines = lines.filter(l => !l.startsWith('   - '));
            let buf = [];
            let bufLen = 0;
            const flushBuf = () => {
                if (buf.length === 0) return;
                const body = (timeLine ? buf.concat(timeLine) : buf).join('\n');
                this.pushes.push(body);
                buf = [];
                bufLen = 0;
            };
            for (const pl of parentLines) {
                const projLen = bufLen + (buf.length ? 1 : 0) + pl.length
                                + (timeLine ? 1 + timeLine.length : 0);
                if (buf.length > 0 && projLen > this.EFFECTIVE_MAX) {
                    flushBuf();
                }
                buf.push(pl);
                bufLen += (buf.length === 1 ? 0 : 1) + pl.length;
            }
            flushBuf();
        } else {
            this.current = groupBody;
        }
    }

    flush() {
        if (this.current) {
            this.pushes.push(this.current);
            this.current = '';
        }
        return this.pushes.slice();
    }
}

/**
 * 시각 포맷 — generateMessage 안의 fmt() 와 동일 규칙. 모듈 외부 사용 가능하도록 노출.
 */
function fmtTime(str) {
    if (!str) return '미정';
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (m) {
        const [, , , day, hour, minute] = m;
        return `${parseInt(day, 10)}일 ${hour}:${minute}`;
    }
    m = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(.+)/);
    if (m) {
        const [, , , day, timeDesc] = m;
        return `${parseInt(day, 10)}일 ${timeDesc}`;
    }
    if (/^\d{12}$/.test(str)) {
        const day = str.substring(6, 8);
        const hour = str.substring(8, 10);
        const minute = str.substring(10, 12);
        return `${parseInt(day, 10)}일 ${hour}:${minute}`;
    }
    m = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(.*)/);
    if (m) {
        const [, , , day, rest] = m;
        return `${String(day).padStart(2, '0')}일 ${rest}`.trim();
    }
    return str;
}

/**
 * 제목 빌더 — 관리자 푸시 제목 (이벤트별 이모지 + 종류/등급).
 * 사용자 푸시 제목 형식과 호환 (CHILD_TITLE_SUFFIX 미부착).
 *
 * @param {Object} payload
 *     {
 *       eventType, typeName, level, prevLevel, prevTypeName
 *     }
 */
function buildAdminTitle(payload) {
    const { eventType, typeName, level, prevLevel, prevTypeName } = payload || {};
    const effLevel = level === '예비' ? '주의보' : (level || '');
    const effPrev = prevLevel === '예비' ? '주의보' : (prevLevel || '');
    const tp = typeName || '특보';
    const full = `${tp}${effLevel ? ' ' + effLevel : ''}`.trim();

    // 이벤트별 제목 핸들러 — 테이블 dispatch
    const TITLE_DISPATCH = {
        publish:            () => `📢 ${full} 발표`,
        active:             () => `🚨 ${full} 발효`,
        additional_active:  () => `📢 ${full} 추가 발효`,
        prelim_cancel:      () => `✅ ${tp} 예비특보 취소`,
        partial_release:    () => `✅ ${full} 일부 해제`,
        release:            () => `✅ ${full} 해제`,
        level_upgrade_publish:   () => `📢 ${tp} ${effPrev || '주의보'}→${effLevel} 격상 발표`,
        level_upgrade_active:    () => `🚨 ${tp} ${effPrev || '주의보'}→${effLevel} 격상 발효`,
        level_downgrade_publish: () => `📢 ${tp} ${effPrev || '경보'}→${effLevel} 격하 발표`,
        level_downgrade_active:  () => `🔻 ${tp} ${effPrev || '경보'}→${effLevel} 격하 발효`,
        // 종류 격상/격하 — spec 예시 형식: "풍랑경보→태풍주의보 격상 발효" (이전/이후 모두 종류+등급 공백 없이)
        type_upgrade_publish:   () => `📢 ${(prevTypeName || '') + (effPrev || '')}→${tp + effLevel} 격상 발표`,
        type_upgrade_active:    () => `🚨 ${(prevTypeName || '') + (effPrev || '')}→${tp + effLevel} 격상 발효`,
        type_downgrade_publish: () => `📢 ${(prevTypeName || '') + (effPrev || '')}→${tp + effLevel} 격하 발표`,
        type_downgrade_active:  () => `🔻 ${(prevTypeName || '') + (effPrev || '')}→${tp + effLevel} 격하 발효`,
        time_ef_change:     () => `🕐 발효시각 변경`,
        time_yn_change:     () => `🕐 해제시각 변경`
    };
    const fn = TITLE_DISPATCH[eventType];
    return fn ? fn() : `📢 ${full} 알림`;
}

/**
 * 분할 푸시 빌더 — 자식 정보 포함, v7 알고리즘 적용.
 *
 * @param {string} eventType
 * @param {Array<{ parent, childState, time }>} parentEntries
 *     - parent: 부모 zone 이름
 *     - childState: buildChildQualifier 의 두 번째 인자
 *     - time: tmEf/tmYn (이벤트에 따라 다름)
 * @param {Object} opts
 *     - typeName, level, prevLevel, prevTypeName  (제목 구성용)
 *     - audience: 'admin'|'user' (기본 'admin')
 *     - maxBody, effectiveMax (분할 한도)
 * @returns {Array<{ title, body }>}
 */
function buildSplitPushes(eventType, parentEntries, opts = {}) {
    const audience = opts.audience || 'admin';

    // user 경로는 본 함수 사용 안 함 (사용자는 기존 generateMessage 그대로)
    if (audience !== 'admin') {
        console.warn('[push_helpers] buildSplitPushes 는 audience=admin 전용. fallback.');
    }

    // 1) PushBuilder 로 부모 줄 → 시간 그룹 본문 변환
    const builder = new PushBuilder(eventType);
    for (const e of (parentEntries || [])) {
        const qual = buildChildQualifier(e.parent, e.childState, eventType);
        builder.addParent({ name: e.parent, qualifier: qual, time: e.time });
    }
    const groupBodies = builder.renderTimeGroups(fmtTime);

    // 2) PushSplitter 로 200자 한도 분할
    const splitter = new PushSplitter({
        maxBody: opts.maxBody || 200,
        effectiveMax: opts.effectiveMax || 165
    });
    for (const gb of groupBodies) splitter.feed(gb);
    const bodies = splitter.flush();

    // 3) 제목 + (n/N) 부착
    const baseTitle = buildAdminTitle({
        eventType,
        typeName: opts.typeName,
        level: opts.level,
        prevLevel: opts.prevLevel,
        prevTypeName: opts.prevTypeName
    });
    const N = bodies.length;
    return bodies.map((body, i) => ({
        title: N > 1 ? `${baseTitle} (${i + 1}/${N})` : baseTitle,
        body
    }));
}

module.exports = {
    ZONE_HIERARCHY,
    expandToMinorZones,
    getMatchedZones,
    generateMessage,
    // v7 신규 — 관리자 자식 정보 통합 푸시
    PARENT_CHILD_TYPE,
    TYPE_LABEL,
    TIME_LABEL_BY_EVENT,
    TIME_KEY_BY_EVENT,
    buildChildQualifier,
    buildAdminTitle,
    buildSplitPushes,
    fmtTime,
    PushBuilder,
    PushSplitter
};
