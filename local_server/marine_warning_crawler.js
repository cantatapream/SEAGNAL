/**
 * ============================================================================
 * 파일명: marine_warning_crawler.js
 * 역할: marine.kma.go.kr (mmis) 응답 기반 통합 특보 크롤러 + 부모/자식 통합 push.
 * ============================================================================
 *
 * [상태]
 *   본 파일은 Phase 1 (marine 대체) 의 기존 산출물 + Phase 1 v7
 *   (부모 푸시 자식 정보 통합) 의 차이매트릭스 디스패처를 합친 형태로,
 *   Agent B 의 차별화된 작성본입니다.
 *
 * [Agent B 차별화]
 *   - 클래스 기반: StateSnapshot / DiffMatrix / EventDispatcher
 *   - 단계별 try/catch — 외부 endpoint 응답 변형에 강건
 *   - eventType → handler 테이블 dispatch
 *
 * [흐름]
 *   1) marine_client (별도 모듈 가정) 로 4 endpoint 응답 수집
 *   2) StateSnapshot.build(response) — 부모 + 자식 발효 set 구축
 *   3) DiffMatrix.compare(prev, curr) — 변화 종류별 entries 분류
 *   4) EventDispatcher.dispatch(matrix) — dmdw_push_sender.enqueueParent* 호출
 *   5) await flushParent(cycleId)
 *
 * [발송 분리]
 *   - 사용자 push (push_sender.js) — 기존 generateMessage 그대로 (부모만, 형식 동일)
 *   - 관리자 push (dmdw_push_sender.flushParent) — 본 파일이 enqueue
 *
 * [의존성]
 *   - Node built-in 만 사용 (외부 라이브러리 X)
 *   - services/dmdw_push_sender.js  (v7 신규 함수)
 *   - services/push_helpers.js      (v7 신규 함수)
 *   - services/push_sender.js       (기존 사용자 푸시 — import 만)
 *
 * [자격증명]
 *   process.env.MARINE_USER_ID, process.env.MARINE_USER_PWD
 *   로그 마스킹 hy*** (실제 ID 평문 출력 금지)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dmdwPush = require('./services/dmdw_push_sender');
const pushHelpers = require('./services/push_helpers');

// [수정1] 관리자 알림 푸시(dmdw 채널) 전면 비활성.
//   작업2 통합으로 사용자 푸시에 이미 자식 한정사가 포함되므로 관리자 채널은 중복.
//   끄는 대상: 정상 발표/발효/해제 관리자 푸시(runDiffAndPush) + 의심사례 알림 +
//   즉시해제 알림. ※ 의심 "가드 로직"(_applySuspiciousGuard 해제 보류)은 데이터
//   안전장치라 유지 — 알림 푸시만 끔.
const ADMIN_PUSH_ENABLED = false;
// [사용자 푸시 복원] legacy 시스템에서 weather_alerts_crawler 가 호출하던 push_sender.
// marine v7 통합 시 legacy 비활성화 → 사용자 push 채널 끊김 → 복원.
let pushSender = null;
try {
    pushSender = require('./push_sender');
} catch (e) {
    console.warn('[marine_warning_crawler] push_sender 로드 실패 — 사용자 push 비활성:', e && e.message);
}

// marine_client 는 require 단계에서 자격증명 검사 후 enabled 플래그만 노출.
// 자격증명 부재 시 require 자체는 성공하며, 인증 endpoint 호출 시에만 throw.
let marineClient = null;
try {
    marineClient = require('./services/marine_client');
} catch (e) {
    console.warn('[marine_warning_crawler] marine_client 로드 실패 — run() 비활성:', e && e.message);
}

// [자식-only 통보문 보강] 확정된 자식 변동(_buildUserPushChanges 통과분)에만 그 부모 관할
//   지방청 ntfctn/list 를 이벤트성으로 조회·매칭해 ef/list 에 없는 자식 통보문을 영속 저장한다.
//   로드 실패해도 크롤러 본체엔 영향 없음(자식 통보문 보강만 비활성).
let childBulletin = null;
try {
    childBulletin = require('./services/child_bulletin');
} catch (e) {
    console.warn('[marine_warning_crawler] child_bulletin 로드 실패 — 자식 통보문 보강 비활성:', e && e.message);
}
// [단일 출처] 부모 해역 → 관할 지방청 prdc_go 정적 매핑 (routes/weather.js 와 공유).
let ZONE_HOME_OFFICE = {};
try {
    ZONE_HOME_OFFICE = require('./config/zone_home_office').ZONE_HOME_OFFICE || {};
} catch (e) {
    console.warn('[marine_warning_crawler] zone_home_office 로드 실패 — 자식 통보문 보강 비활성:', e && e.message);
}

// [§7.7.23 판정 보류실] 예비취소 확정용 통보문 취소 문구 스캐너 (무인증 날씨누리 지방청 페이지).
//   로드 실패 시 문구 확정((c) 판정)만 비활성 — 보류실은 TTL 무푸시로 안전하게 닫힌다.
let bulletinScanner = null;
try {
    bulletinScanner = require('./services/bulletin_cancel_scanner');
} catch (e) {
    console.warn('[marine_warning_crawler] bulletin_cancel_scanner 로드 실패 — 예비취소 문구 확정 비활성:', e && e.message);
}

// ============================================================================
// 부모 → 자식 fullName 매핑 (ZONE_MAPPING.md 확정본)
// frontend mappings.js 와 동일 — 본 서버에서는 require 불가하므로 사본.
// ============================================================================
const PARENT_TO_CHILDREN = {
    '울산앞바다':            ['울산앞바다중평수구역', '울산앞바다중연안바다'],
    '경북남부앞바다':         ['경북남부앞바다중평수구역', '경북남부앞바다중연안바다'],
    '경북북부앞바다':         ['경북북부앞바다중연안바다'],
    '강원북부앞바다':         ['강원북부앞바다중연안바다'],
    '강원중부앞바다':         ['강원중부앞바다중연안바다'],
    '강원남부앞바다':         ['강원남부앞바다중연안바다'],
    '동해중부안쪽먼바다':      ['울릉도울릉읍연안바다', '울릉도서면연안바다', '울릉도북면연안바다'],
    '전북북부앞바다':         ['전북북부앞바다중평수구역'],
    '전북남부앞바다':         ['전북남부앞바다중평수구역'],
    '전남북부서해앞바다':      ['전남북부서해앞바다중평수구역'],
    '전남중부서해앞바다':      ['전남중부서해앞바다중먼평수구역', '전남중부서해앞바다중앞평수구역'],
    '전남남부서해앞바다':      ['전남남부서해앞바다중평수구역'],
    '서해남부남쪽안쪽먼바다':   ['서해남부남쪽안쪽먼바다중조도부근평수구역'],
    '인천·경기북부앞바다':     ['인천·경기북부앞바다중평수구역'],
    '인천·경기남부앞바다':     ['인천·경기남부앞바다중먼평수구역', '인천·경기남부앞바다중북부앞평수구역', '인천·경기남부앞바다중남부앞평수구역'],
    '충남북부앞바다':         ['천수만평수구역', '안면도서쪽평수구역', '당진평수구역', '태안·서산북쪽평수구역'],
    '충남남부앞바다':         ['충남남부앞바다중평수구역'],
    '부산앞바다':            ['부산앞바다중동부평수구역', '부산앞바다중서부평수구역', '부산앞바다중연안바다'],
    '경남중부남해앞바다':      ['경남중부남해앞바다중평수구역', '경남중부남해앞바다중연안바다'],
    '거제시동부앞바다':        ['거제시동부앞바다중연안바다'],
    '전남서부남해앞바다':      ['전남서부남해앞바다중평수구역'],
    '전남동부남해앞바다':      ['전남동부남해앞바다중서부평수구역', '전남동부남해앞바다중동부평수구역'],
    '남해서부서쪽먼바다':      ['남해서부서쪽먼바다중추자도연안바다'],
    '제주도북부앞바다':        ['제주도북부앞바다중연안바다'],
    '제주도동부앞바다':        ['제주도동부앞바다중북동연안바다', '제주도동부앞바다중남동연안바다', '제주도동부앞바다중우도연안바다'],
    '제주도남부앞바다':        ['제주도남부앞바다중연안바다'],
    '제주도서부앞바다':        ['제주도서부앞바다중북서연안바다', '제주도서부앞바다중남서연안바다', '제주도서부앞바다중가파도연안바다'],
    // [Followup Major-1] 경남서부남해앞바다 — 평수구역 3 + 연안바다 1
    '경남서부남해앞바다':       ['경남서부남해앞바다중동부평수구역', '경남서부남해앞바다중서부평수구역', '경남서부남해앞바다중남부평수구역', '경남서부남해앞바다중남해군연안바다']
};

// ============================================================================
// [A안] warn_zone_cd → 앱 정식 해역명 매핑 (mmis archive ef2 1년치로 추출, 93개)
//   mmis 실시간 endpoint(warn/list, warn/ready, warn-sasc)의 warn_zone_nm 은
//   일부 zone 을 축약("남해서부 동쪽")해서 주지만, warn_zone_cd 는 불변.
//   따라서 코드로 정식명을 해석하면 축약·표기차이(·, 공백)를 전부 무력화.
//   값은 앱 zone 트리/PARENT_TO_CHILDREN 의 정식명과 일치시킴.
//   (· 표기 불일치 2건 S2211100/S2212200 은 앱 표기로 보정 반영)
// ============================================================================
const MMIS_CODE_TO_NAME = {
    'S1131100': '울산앞바다',
    'S1131200': '경북남부앞바다',
    'S1131300': '경북북부앞바다',
    'S1132110': '동해남부남쪽안쪽먼바다',
    'S1132120': '동해남부남쪽바깥먼바다',
    'S1132210': '동해남부북쪽안쪽먼바다',
    'S1132220': '동해남부북쪽바깥먼바다',
    'S1151100': '강원북부앞바다',
    'S1151200': '강원중부앞바다',
    'S1151300': '강원남부앞바다',
    'S1152010': '동해중부안쪽먼바다',
    'S1152020': '동해중부바깥먼바다',
    'S1231100': '전북북부앞바다',
    'S1231200': '전북남부앞바다',
    'S1231300': '전남북부서해앞바다',
    'S1231400': '전남중부서해앞바다',
    'S1231500': '전남남부서해앞바다',
    'S1232110': '서해남부북쪽안쪽먼바다',
    'S1232120': '서해남부북쪽바깥먼바다',
    'S1232210': '서해남부남쪽안쪽먼바다',
    'S1232220': '서해남부남쪽바깥먼바다',
    'S1251100': '인천·경기북부앞바다',
    'S1251200': '인천·경기남부앞바다',
    'S1251300': '충남북부앞바다',
    'S1251400': '충남남부앞바다',
    'S1252010': '서해중부안쪽먼바다',
    'S1252020': '서해중부바깥먼바다',
    'S1311100': '부산앞바다',
    'S1311200': '경남서부남해앞바다',
    'S1311300': '경남중부남해앞바다',
    'S1311400': '거제시동부앞바다',
    'S1312010': '남해동부안쪽먼바다',
    'S1312020': '남해동부바깥먼바다',
    'S1321100': '전남서부남해앞바다',
    'S1321200': '전남동부남해앞바다',
    'S1322100': '남해서부서쪽먼바다',
    'S1322200': '남해서부동쪽먼바다',
    'S1323100': '제주도북부앞바다',
    'S1323200': '제주도동부앞바다',
    'S1323300': '제주도남부앞바다',
    'S1323400': '제주도서부앞바다',
    'S1324020': '제주도남쪽바깥먼바다',
    'S1324110': '제주도남동쪽안쪽먼바다',
    'S1324210': '제주도남서쪽안쪽먼바다',
    'S2110100': '경북남부앞바다중평수구역',
    'S2110200': '울산앞바다중평수구역',
    'S2120100': '경북북부앞바다중연안바다',
    'S2120300': '경북남부앞바다중연안바다',
    'S2120400': '울산앞바다중연안바다',
    'S2120500': '강원중부앞바다중연안바다',
    'S2120600': '강원북부앞바다중연안바다',
    'S2120700': '강원남부앞바다중연안바다',
    'S2120800': '울릉도울릉읍연안바다',
    'S2120900': '울릉도서면연안바다',
    'S2121000': '울릉도북면연안바다',
    'S2210100': '전북북부앞바다중평수구역',
    'S2210200': '전북남부앞바다중평수구역',
    'S2210300': '전남북부서해앞바다중평수구역',
    'S2210500': '전남남부서해앞바다중평수구역',
    'S2210700': '충남남부앞바다중평수구역',
    'S2211100': '인천·경기남부앞바다중먼평수구역',
    'S2211200': '서해남부남쪽안쪽먼바다중조도부근평수구역',
    'S2211300': '전남중부서해앞바다중먼평수구역',
    'S2211400': '전남중부서해앞바다중앞평수구역',
    'S2211500': '천수만평수구역',
    'S2211600': '인천·경기남부앞바다중북부앞평수구역',
    'S2211700': '인천·경기남부앞바다중남부앞평수구역',
    'S2211900': '안면도서쪽평수구역',
    'S2212000': '인천·경기북부앞바다중평수구역',
    'S2212100': '당진평수구역',
    'S2212200': '태안·서산북쪽평수구역',
    'S2310100': '부산앞바다중동부평수구역',
    'S2310200': '부산앞바다중서부평수구역',
    'S2310300': '경남중부남해앞바다중평수구역',
    'S2310400': '경남서부남해앞바다중동부평수구역',
    'S2310500': '경남서부남해앞바다중서부평수구역',
    'S2310600': '경남서부남해앞바다중남부평수구역',
    'S2310700': '전남서부남해앞바다중평수구역',
    'S2310800': '전남동부남해앞바다중서부평수구역',
    'S2310900': '전남동부남해앞바다중동부평수구역',
    'S2320100': '부산앞바다중연안바다',
    'S2320200': '거제시동부앞바다중연안바다',
    'S2320300': '경남서부남해앞바다중남해군연안바다',
    'S2320400': '제주도북부앞바다중연안바다',
    'S2320610': '제주도서부앞바다중북서연안바다',
    'S2320620': '제주도서부앞바다중남서연안바다',
    'S2320700': '제주도남부앞바다중연안바다',
    'S2320800': '경남중부남해앞바다중연안바다',
    'S2320900': '제주도동부앞바다중북동연안바다',
    'S2321000': '제주도동부앞바다중남동연안바다',
    'S2330100': '남해서부서쪽먼바다중추자도연안바다',
    'S2330200': '제주도동부앞바다중우도연안바다',
    'S2330300': '제주도서부앞바다중가파도연안바다'
};

/**
 * [A안] 런타임 row 의 해역명을 warn_zone_cd 로 정식 해석.
 *   코드 매핑 있으면 앱 정식명 반환(축약 무력화), 없으면 warn_zone_nm 폴백(공백제거).
 */
function _resolveZoneName(row) {
    if (!row) return '';
    const cd = row.warn_zone_cd;
    if (cd && MMIS_CODE_TO_NAME[cd]) return MMIS_CODE_TO_NAME[cd];
    return (row.warn_zone_nm || row.kor_nm || '').trim().replace(/\s+/g, '');
}

// ============================================================================
// 등급/종류 점수 — 격상/격하 판별
// ============================================================================
const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 2, '해제': 0, '': 0 };
const TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, '해일': 10, '호우': 10, '대설': 10 };

function _score(typeName, lvlName) {
    if (!lvlName || lvlName === '해제') return 0;
    const t = TYPE_RANK[typeName] || (typeName && typeName.includes('태풍') ? 100 : 10);
    const l = LVL_RANK[lvlName] || 0;
    return t + l;
}

// ============================================================================
// StateSnapshot — 한 사이클의 상태 (부모별 발효 자식 set + 부모 자체 발효)
// ============================================================================
class StateSnapshot {
    /**
     * @param {Object} raw
     *   - parents: Map<parentName, { wrnTpNm, wrnLvlNm, tmFc, tmEf, tmYn, clrNtcTm }>
     *   - children: Map<parentName, Map<childFullName, { wrnTpNm, wrnLvlNm, tmFc, tmEf, tmYn }>>
     */
    constructor(raw = {}) {
        this.parents = raw.parents instanceof Map ? raw.parents : new Map();
        this.children = raw.children instanceof Map ? raw.children : new Map();
        // [B] 발효중인 해역에 "다가오는(예비)" 특보가 공존할 때 그것을 보관 (발효 우선 드롭 대신).
        //   parents 가 active 인 zone 의 예비를 upcomings 에 분리 보관 → 병렬 표출.
        this.upcomings = raw.upcomings instanceof Map ? raw.upcomings : new Map();
        // [제외 자식 게이트] MMIS 가 warn-sasc/list 에서 warn_lvl='0' 빈 메타행으로 "미포함"이라
        //   명시한 자식명 집합 (통보문 '연안바다 제외'에 해당). 매 사이클 재계산되는 일시 필드라
        //   toJSON 영속 대상 아님 — 발표대기 GAP 합성이 유령 자식을 끼워넣지 못하게 막는 용도.
        this.excludedChildren = raw.excludedChildren instanceof Set ? raw.excludedChildren : new Set();
        // [라이브 자식 집합] 이번 사이클 실제 라이브 row(warn-sasc/list 발효 + warn-sasc/ready 예비
        //   + warn/ready 자식형)로 들어온 자식명 집합. carry/synth/디바운스로 끼워진 자식과 구분용.
        //   제외 자식 사후정리가 "라이브 근거 없는 유령"만 제거하도록 하는 화이트리스트.
        //   매 사이클 재계산되는 일시 필드 — toJSON 영속 대상 아님.
        this.liveChildren = raw.liveChildren instanceof Set ? raw.liveChildren : new Set();
    }

    static fromJSON(obj) {
        const s = new StateSnapshot();
        if (obj && obj.parents) {
            for (const [k, v] of Object.entries(obj.parents)) s.parents.set(k, v);
        }
        if (obj && obj.children) {
            for (const [parent, childMap] of Object.entries(obj.children)) {
                const m = new Map();
                for (const [k, v] of Object.entries(childMap || {})) m.set(k, v);
                s.children.set(parent, m);
            }
        }
        if (obj && obj.upcomings) {
            for (const [k, v] of Object.entries(obj.upcomings)) s.upcomings.set(k, v);
        }
        return s;
    }

    toJSON() {
        const obj = { parents: {}, children: {}, upcomings: {} };
        for (const [k, v] of this.parents) obj.parents[k] = v;
        for (const [parent, m] of this.children) {
            obj.children[parent] = {};
            for (const [k, v] of m) obj.children[parent][k] = v;
        }
        for (const [k, v] of this.upcomings) obj.upcomings[k] = v;
        return obj;
    }

    /** zone 의 다가오는(예비) 특보: parents 가 예비면 그것, 아니면 upcomings. */
    getUpcoming(name) {
        const p = this.parents.get(name);
        if (p && p.wrnLvlNm === '예비') return p;
        return this.upcomings.get(name) || null;
    }
    /** zone 의 발효중(active) 특보: parents 가 active(예비·해제 아님)면 그것. */
    getActive(name) {
        const p = this.parents.get(name);
        return (p && p.wrnLvlNm && p.wrnLvlNm !== '예비' && p.wrnLvlNm !== '해제') ? p : null;
    }

    getParent(name) { return this.parents.get(name) || null; }
    getActiveChildren(parent) {
        const m = this.children.get(parent);
        if (!m) return [];
        return Array.from(m.keys());
    }
}

// ============================================================================
// DiffMatrix — prev vs curr 비교, 이벤트별 entries 분류.
// ============================================================================
class DiffMatrix {
    constructor() {
        // eventType → Array<{ parent, time, childState, wrn... }>
        this.buckets = {
            publish: [],
            active: [],
            additional_active: [],
            child_prelim: [],          // [자식 예비 보존] 자식 단독 예비 발표(발효 전) — '발표(예비)'
            prelim_cancel: [],
            partial_release: [],
            release: [],
            level_upgrade_publish: [],
            level_upgrade_active: [],
            level_downgrade_publish: [],
            level_downgrade_active: [],
            type_upgrade_publish: [],
            type_upgrade_active: [],
            type_downgrade_publish: [],
            type_downgrade_active: [],
            time_ef_change: [],
            time_yn_change: []
        };
        // 그룹 식별용 메타 — (wrnTp, wrnLvl) 별 묶기
        this.metaByBucket = {};
    }

    add(eventType, entry, meta) {
        if (!this.buckets[eventType]) return;
        this.buckets[eventType].push(entry);
        const key = `${meta.wrnTp || ''}|${meta.wrnLvl || ''}`;
        if (!this.metaByBucket[eventType]) this.metaByBucket[eventType] = new Map();
        if (!this.metaByBucket[eventType].has(key)) {
            this.metaByBucket[eventType].set(key, { meta, entries: [] });
        }
        this.metaByBucket[eventType].get(key).entries.push(entry);
    }

    /** 부모별 자식 발효 매트릭스 빌드. */
    static compute(prev, curr) {
        const matrix = new DiffMatrix();

        const allParents = new Set([
            ...prev.parents.keys(),
            ...curr.parents.keys(),
            ...prev.children.keys(),
            ...curr.children.keys()
        ]);

        for (const parent of allParents) {
            try {
                // [버그수정 1회성 가드 — 자식이 prev 에서 self-key 부모로 잘못 저장된 경우]
                //   구코드(_extractParent 이름분할)는 '중' 구분자가 없는 자식
                //   (울릉도*연안바다 → 동해중부안쪽먼바다, 천수만/안면도/당진/태안·서산북쪽
                //    평수구역 → 충남북부앞바다)을 self-key 부모로 prev 에 저장했다.
                //   신코드는 이들을 올바른 부모 아래 자식으로 분류하므로, 배포 첫 사이클에
                //   "부모(prev)→소멸(curr)" 디프로 보여 거짓 prelim_cancel/release 푸시를
                //   3건 낼 수 있다. CHILD_TO_PARENT 에 정의된 키(=실제로는 절대 부모일 수
                //   없는 자식 fullName)가 부모 루프에 들어왔다면, 이는 재분류 아티팩트이므로
                //   디프에서 제외한다. (정상 부모는 CHILD_TO_PARENT 키가 아니므로 무영향 —
                //   정상 예비취소/해제를 삼키지 않음. 1회성: 다음 사이클부터 prev 가 신코드로
                //   재저장되어 이 키는 더 이상 부모로 안 나타남.)
                if (CHILD_TO_PARENT[parent] && !curr.parents.has(parent)) {
                    continue;
                }

                const pPrev = prev.getParent(parent);
                const pCurr = curr.getParent(parent);
                const childrenAll = PARENT_TO_CHILDREN[parent] || [];
                const prevActiveChildren = prev.getActiveChildren(parent);
                const currActiveChildren = curr.getActiveChildren(parent);

                const childState = {
                    all: childrenAll,
                    active: currActiveChildren,
                    added: currActiveChildren.filter(c => !prevActiveChildren.includes(c)),
                    released: prevActiveChildren.filter(c => !currActiveChildren.includes(c))
                };
                childState.allReleased =
                    prevActiveChildren.length > 0 &&
                    currActiveChildren.length === 0 &&
                    childrenAll.length > 0 &&
                    prevActiveChildren.length === childrenAll.length;
                // [2026-07-18 실사고] GAP 보강 부모(전이 창)의 자식 '미상' 전파 — 한정사 단정 금지
                if (currActiveChildren.length === 0 && pCurr && pCurr._childUnknown === true) {
                    childState.unknown = true;
                }

                // ----- 부모 단위 신규 발효 -----
                if (!pPrev && pCurr && pCurr.wrnLvlNm && pCurr.wrnLvlNm !== '해제') {
                    const isPublish = pCurr.wrnLvlNm === '예비';
                    if (isPublish) {
                        matrix.add('publish',
                            { parent, time: pCurr.tmEf, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    } else {
                        matrix.add('active',
                            { parent, time: pCurr.tmYn, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }
                    continue;
                }

                // ----- 부모 해제 / 예비특보 취소 (S10) -----
                // [Synthesis Q / Agent A M1 흡수] !curr.wrnLvlNm (빈 값/undefined) 도 release 로 인지.
                // [Followup Major-4] 예비 → 정식 발효 없이 사라진 경우 prelim_cancel 로 발사.
                //   SPEC §5 S10: 예비특보가 정식 발효(active) 단계를 거치지 않고 통보문에서
                //   사라지면 "✅ 예비특보 취소" 푸시. release(정식 해제) 와 분리.
                if (pPrev && (!pCurr || pCurr.wrnLvlNm === '해제' || !pCurr.wrnLvlNm)) {
                    if (pPrev.wrnLvlNm === '예비') {
                        matrix.add('prelim_cancel',
                            { parent, time: '', childState },
                            { wrnTp: pPrev.wrnTp, wrnLvl: pPrev.wrnLvl,
                              wrnTpNm: pPrev.wrnTpNm, wrnLvlNm: '' });
                    } else {
                        // 부모+자식 동시 해제 → release (한정사 없음)
                        matrix.add('release',
                            { parent, time: '', childState },
                            { wrnTp: pPrev.wrnTp, wrnLvl: pPrev.wrnLvl,
                              wrnTpNm: pPrev.wrnTpNm, wrnLvlNm: pPrev.wrnLvlNm });
                    }
                    continue;
                }

                // ----- [Synthesis Q / Critical-1 보강] 예비 → 정식 발효 전이 -----
                // 같은 종류·등급으로 표면화되지만 의미상 '🚨 발효' 푸시가 필요한 케이스.
                // _score 상 예비==주의보로 동률이라 격상 bucket 에 들어가지 못함.
                // 별도 분기로 active bucket 으로 보낸다.
                if (pPrev && pCurr && pPrev.wrnLvlNm === '예비'
                    && pCurr.wrnLvlNm && pCurr.wrnLvlNm !== '예비' && pCurr.wrnLvlNm !== '해제') {
                    matrix.add('active',
                        { parent, time: pCurr.tmYn, childState },
                        { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                          wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    continue;
                }

                // ----- 부모 유지 + 등급/종류 변경 -----
                if (pPrev && pCurr && pPrev.wrnLvlNm && pCurr.wrnLvlNm) {
                    const pScore = _score(pPrev.wrnTpNm, pPrev.wrnLvlNm);
                    const cScore = _score(pCurr.wrnTpNm, pCurr.wrnLvlNm);
                    const typeChanged = pPrev.wrnTpNm !== pCurr.wrnTpNm;
                    const lvlChanged = pPrev.wrnLvlNm !== pCurr.wrnLvlNm;

                    if (typeChanged && cScore !== pScore) {
                        const phase = pCurr.wrnLvlNm === '예비' ? 'publish' : 'active';
                        const isUp = cScore > pScore;
                        const bucket = isUp
                            ? (phase === 'publish' ? 'type_upgrade_publish' : 'type_upgrade_active')
                            : (phase === 'publish' ? 'type_downgrade_publish' : 'type_downgrade_active');
                        matrix.add(bucket,
                            { parent, time: phase === 'publish' ? pCurr.tmEf : pCurr.tmYn, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm,
                              prevWrnTpNm: pPrev.wrnTpNm, prevWrnLvlNm: pPrev.wrnLvlNm });
                        continue;
                    }
                    if (lvlChanged && cScore !== pScore) {
                        const phase = pCurr.wrnLvlNm === '예비' ? 'publish' : 'active';
                        const isUp = cScore > pScore;
                        const bucket = isUp
                            ? (phase === 'publish' ? 'level_upgrade_publish' : 'level_upgrade_active')
                            : (phase === 'publish' ? 'level_downgrade_publish' : 'level_downgrade_active');
                        matrix.add(bucket,
                            { parent, time: phase === 'publish' ? pCurr.tmEf : pCurr.tmYn, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm,
                              prevWrnLvlNm: pPrev.wrnLvlNm });
                        continue;
                    }

                    // ----- 시각 변경 (부모) -----
                    // [Synthesis Q / M2 보강] 부모 + 자식 동반 vs 부모만 — childState 그대로
                    // 부모 시각이 변하면 자식 동반 한정사는 buildChildQualifier 가 active set
                    // 기준으로 자연스럽게 결정. parentTimeUnchanged 는 false (기본).
                    //
                    // [Followup Major-3] 자식 set 변화 동시 발생 → 시각 변경 푸시 억제.
                    //   우선순위: 자식 set 변화 (additional_active/partial_release) > 시각 변경.
                    //   같은 cycle 에 두 종류 이벤트가 동시 발사되는 것을 막아 푸시 1회로 통합.
                    const setChanged = childState.added.length > 0 || childState.released.length > 0;

                    if (pPrev.tmEf !== pCurr.tmEf && !setChanged) {
                        matrix.add('time_ef_change',
                            { parent, time: pCurr.tmEf, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }
                    // 해제예고시각 신규 등장 OR 변경 → time_yn_change 로 통합
                    if ((pPrev.clrNtcTm !== pCurr.clrNtcTm || pPrev.tmYn !== pCurr.tmYn) && !setChanged) {
                        matrix.add('time_yn_change',
                            { parent, time: pCurr.clrNtcTm || pCurr.tmYn, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }

                    // ----- [Synthesis Q / Critical-2 보강] 자식만 시각 변경 (S24/S25) -----
                    // 부모 시각은 그대로인데 자식 시각이 변한 경우 — buildChildQualifier 의
                    // (X만 시각 변경) 분기를 호출하기 위해 별도 이벤트 발사.
                    // parentTimeUnchanged 플래그를 childState 에 set.
                    const prevChMap = prev.children.get(parent) || new Map();
                    const currChMap = curr.children.get(parent) || new Map();
                    const childTimeChanged = [];
                    let childEfChanged = false, childYnChanged = false;
                    for (const cn of currChMap.keys()) {
                        const a = prevChMap.get(cn);
                        const b = currChMap.get(cn);
                        if (!a || !b) continue;
                        if (a.tmEf !== b.tmEf) { childEfChanged = true; childTimeChanged.push(cn); }
                        if (a.tmYn !== b.tmYn) { childYnChanged = true; if (!childTimeChanged.includes(cn)) childTimeChanged.push(cn); }
                    }
                    // [Followup Major-3] 자식 set 변화 동시 발생 → 자식 시각 변경 푸시 억제.
                    if (pPrev.tmEf === pCurr.tmEf && childEfChanged && !setChanged) {
                        const cs = Object.assign({}, childState, {
                            parentTimeUnchanged: true,
                            timeChanged: childTimeChanged.slice()
                        });
                        matrix.add('time_ef_change',
                            { parent, time: pCurr.tmEf, childState: cs },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }
                    if (pPrev.tmYn === pCurr.tmYn && pPrev.clrNtcTm === pCurr.clrNtcTm && childYnChanged && !setChanged) {
                        const cs = Object.assign({}, childState, {
                            parentTimeUnchanged: true,
                            timeChanged: childTimeChanged.slice()
                        });
                        matrix.add('time_yn_change',
                            { parent, time: pCurr.tmYn, childState: cs },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }

                    // ----- 자식만 변화 -----
                    // [자식 예비 보존] 추가된 자식을 예비(발표 전)/발효로 분리.
                    //   예비 자식 → child_prelim('발표(예비)'), 발효 자식 → additional_active('추가 발효').
                    //   과거엔 둘 다 additional_active 로 보내 자식 단독 예비가 "추가 발효"로 오발송됐다.
                    //   (※ 사용자 채널은 push_sender CHILD_PRELIM_ADD/CHILD_ADD 분기로 동일 처리. 이
                    //    관리자 채널은 ADMIN_PUSH_ENABLED=false 라 현재 비활성이나 일관성 위해 동기화.)
                    if (childState.added.length > 0) {
                        const currChMap2 = curr.children.get(parent) || new Map();
                        const prelimAdded = childState.added.filter(cn => {
                            const ci = currChMap2.get(cn);
                            return ci && ci.wrnLvlNm === '예비';
                        });
                        const activeAdded = childState.added.filter(cn => !prelimAdded.includes(cn));
                        if (prelimAdded.length > 0) {
                            const csPub = Object.assign({}, childState, { added: prelimAdded });
                            matrix.add('child_prelim',
                                { parent, time: pCurr.tmEf, childState: csPub },
                                { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                                  wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                        }
                        if (activeAdded.length > 0) {
                            const csAct = Object.assign({}, childState, { added: activeAdded });
                            matrix.add('additional_active',
                                { parent, time: pCurr.tmYn, childState: csAct },
                                { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                                  wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                        }
                    }
                    // 자식 일부 해제 (부모 유지)
                    if (childState.released.length > 0) {
                        matrix.add('partial_release',
                            { parent, time: '', childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
                    }
                }
            } catch (err) {
                console.warn(`[marine_warning_crawler] DiffMatrix.compute parent=${parent} 실패:`,
                    err && err.message);
            }
        }
        return matrix;
    }
}

// ============================================================================
// EventDispatcher — DiffMatrix → enqueueParent* 호출.
// ============================================================================
class EventDispatcher {
    constructor(cycleId) { this.cycleId = cycleId; }

    /** eventType → enqueue 함수 매핑 (테이블 dispatch) */
    static get TABLE() {
        return {
            publish:                  (cid, m, info, entries) => dmdwPush.enqueueParentPublish(cid, info.wrnTp, info.wrnLvl, entries, info),
            active:                   (cid, m, info, entries) => dmdwPush.enqueueParentActive(cid, info.wrnTp, info.wrnLvl, entries, info),
            release:                  (cid, m, info, entries) => dmdwPush.enqueueParentRelease(cid, info.wrnTp, info.wrnLvl, entries, info),
            additional_active:        (cid, m, info, entries) => dmdwPush.enqueueAdditionalActive(cid, info.wrnTp, info.wrnLvl, entries, info),
            // [자식 예비 보존] 자식 단독 예비 발표 = 발표(announce) 계열 → publish enqueue 로 라우팅.
            child_prelim:             (cid, m, info, entries) => dmdwPush.enqueueParentPublish(cid, info.wrnTp, info.wrnLvl, entries, info),
            prelim_cancel:            (cid, m, info, entries) => dmdwPush.enqueuePrelimCancel(cid, info.wrnTp, entries, info),
            partial_release:          (cid, m, info, entries) => dmdwPush.enqueuePartialRelease(cid, info.wrnTp, info.wrnLvl, entries, info),
            level_upgrade_publish:    (cid, m, info, entries) => dmdwPush.enqueueLevelUpgrade(cid, info.wrnTp, info.prevWrnLvlNm, info.wrnLvl, entries, 'publish', info),
            level_upgrade_active:     (cid, m, info, entries) => dmdwPush.enqueueLevelUpgrade(cid, info.wrnTp, info.prevWrnLvlNm, info.wrnLvl, entries, 'active', info),
            level_downgrade_publish:  (cid, m, info, entries) => dmdwPush.enqueueLevelDowngrade(cid, info.wrnTp, info.prevWrnLvlNm, info.wrnLvl, entries, 'publish', info),
            level_downgrade_active:   (cid, m, info, entries) => dmdwPush.enqueueLevelDowngrade(cid, info.wrnTp, info.prevWrnLvlNm, info.wrnLvl, entries, 'active', info),
            type_upgrade_publish:     (cid, m, info, entries) => dmdwPush.enqueueTypeUpgrade(cid,
                                            { wrnTpNm: info.prevWrnTpNm, wrnLvlNm: info.prevWrnLvlNm },
                                            { wrnTp: info.wrnTp, wrnLvl: info.wrnLvl, wrnTpNm: info.wrnTpNm, wrnLvlNm: info.wrnLvlNm },
                                            entries, 'publish', info),
            type_upgrade_active:      (cid, m, info, entries) => dmdwPush.enqueueTypeUpgrade(cid,
                                            { wrnTpNm: info.prevWrnTpNm, wrnLvlNm: info.prevWrnLvlNm },
                                            { wrnTp: info.wrnTp, wrnLvl: info.wrnLvl, wrnTpNm: info.wrnTpNm, wrnLvlNm: info.wrnLvlNm },
                                            entries, 'active', info),
            type_downgrade_publish:   (cid, m, info, entries) => dmdwPush.enqueueTypeDowngrade(cid,
                                            { wrnTpNm: info.prevWrnTpNm, wrnLvlNm: info.prevWrnLvlNm },
                                            { wrnTp: info.wrnTp, wrnLvl: info.wrnLvl, wrnTpNm: info.wrnTpNm, wrnLvlNm: info.wrnLvlNm },
                                            entries, 'publish', info),
            type_downgrade_active:    (cid, m, info, entries) => dmdwPush.enqueueTypeDowngrade(cid,
                                            { wrnTpNm: info.prevWrnTpNm, wrnLvlNm: info.prevWrnLvlNm },
                                            { wrnTp: info.wrnTp, wrnLvl: info.wrnLvl, wrnTpNm: info.wrnTpNm, wrnLvlNm: info.wrnLvlNm },
                                            entries, 'active', info),
            time_ef_change:           (cid, m, info, entries) => dmdwPush.enqueueTimeEfChange(cid, info.wrnTp, info.wrnLvl, entries, info),
            time_yn_change:           (cid, m, info, entries) => dmdwPush.enqueueTimeYnChange(cid, info.wrnTp, info.wrnLvl, entries, info)
        };
    }

    dispatch(matrix) {
        const TABLE = EventDispatcher.TABLE;
        for (const [eventType, byMeta] of Object.entries(matrix.metaByBucket || {})) {
            const fn = TABLE[eventType];
            if (!fn) continue;
            for (const [, group] of byMeta) {
                try {
                    fn(this.cycleId, matrix, group.meta, group.entries);
                } catch (err) {
                    console.error(`[marine_warning_crawler] dispatch ${eventType} 실패:`, err && err.message);
                }
            }
        }
    }
}

// ============================================================================
// 메인 사이클 — runOnce(prev, curr) → admin push flush 까지
// ============================================================================

/**
 * 한 사이클 실행:
 *   - prev / curr 스냅샷을 받아 diff 계산 → dispatch → flushParent.
 *   - marine_client 와 weather_alerts.json 갱신은 (별도) — 본 함수는 push 흐름 전담.
 *
 * @param {StateSnapshot} prev
 * @param {StateSnapshot} curr
 * @param {Object} opts
 *   - cycleId  — 기본 Date.now()
 *   - dryRun   — true 시 실제 발송 X (테스트)
 */
async function runDiffAndPush(prev, curr, opts = {}) {
    const cycleId = opts.cycleId || Date.now();
    try {
        const matrix = DiffMatrix.compute(prev, curr);
        const dispatcher = new EventDispatcher(cycleId);
        dispatcher.dispatch(matrix);
        return await dmdwPush.flushParent(cycleId, { dryRun: !!opts.dryRun });
    } catch (err) {
        console.error('[marine_warning_crawler] runDiffAndPush 실패:', err && err.stack || err);
        return [];
    }
}

// ============================================================================
// [Followup Critical-4] 디스크 영속화 — prev StateSnapshot 보존
// ============================================================================
//
// fly.io 재배포 = process 재시작 시 메모리 _prevSnapshot 휘발 →
// 1) 부모/자식 set 의 첫 사이클이 신규 발효(active) 로 오인되거나,
// 2) 자식 set 변화 (added/released) 가 잘못 계산되어 추가 발효/일부 해제 푸시가 중복 발사.
//
// 저장 위치: local_server/data/marine_warning_state.json (Fly.io persistent volume)
// 스키마: { prev: StateSnapshot.toJSON(), updatedAt: ISO }
// I/O: atomic write (tmp → rename). 부팅 시 read 실패는 무시 (빈 상태 폴백).
const _STATE_FILE = path.join(__dirname, 'data', 'marine_warning_state.json');
const _STATE_TMP = _STATE_FILE + '.tmp';
let _prevSnapshot = null;

function _loadPrevSnapshot() {
    try {
        if (!fs.existsSync(_STATE_FILE)) return new StateSnapshot();
        const raw = fs.readFileSync(_STATE_FILE, 'utf8');
        const j = JSON.parse(raw);
        if (j && j.prev) {
            const snap = StateSnapshot.fromJSON(j.prev);
            console.log('[marine_warning_crawler] prev snapshot 디스크 복원 완료');
            return snap;
        }
    } catch (e) {
        console.warn('[marine_warning_crawler] prev snapshot 복원 실패 (무시):', e && e.message);
    }
    return new StateSnapshot();
}

function _savePrevSnapshot(snap) {
    try {
        const dir = path.dirname(_STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = {
            updatedAt: new Date().toISOString(),
            prev: snap ? snap.toJSON() : { parents: {}, children: {} }
        };
        fs.writeFileSync(_STATE_TMP, JSON.stringify(obj), 'utf8');
        fs.renameSync(_STATE_TMP, _STATE_FILE);
    } catch (e) {
        console.warn('[marine_warning_crawler] prev snapshot 저장 실패 (무시):', e && e.message);
    }
}

// ============================================================================
// [D-medium 인터랙티브 결정] mmis 빈 응답 폭주 방어 — 관리자 결정 기반
// ============================================================================
//
// 배경: mmis endpoint 일시 장애 / 응답 누락 시 prev 에 있던 zone 들이 curr 에 없어
//   release 푸시 일괄 발사되는 사고 위험. 그러나 정상 일괄 해제 (예: 태풍 종결 시
//   8개 zone 동시 해제) 도 가능하므로 일률적으로 skip 하면 정상 해제 누락.
//
// 정책 (인터랙티브):
//   - clr_ntc_tm (사전 해제 예고) 이 등록된 zone 이 사라지면 → 정상 해제로 인정
//   - clr_ntc_tm 없이 사라진 zone 이 SUSPICIOUS_THRESHOLD 개 이상 → 의심 사례
//     • 의심 zone 은 curr 에 다시 추가하여 "아직 발효 중" 으로 위장 → release skip
//     • currentCase 생성 + 1차 의심 push 즉시 발사 (관리자에게 결정 요청)
//     • PUSH_REINFORCE_INTERVAL (10분) 마다 재push (자동 처리 X)
//   - 관리자 결정 = 'normal'  → 정상 해제로 처리 → release push 즉시 발사 + currentCase 리셋
//   - 관리자 결정 = 'invalid' → 수집 오류로 유지 → currentCase 유지, push 카운터만 리셋
//   - mmis 회복 (zone 재등장 또는 의심 미달) → currentCase 자동 리셋 (history 에 auto-reset 기록)
//
// 디스크 영속화: data/marine_suspicious_state.json (재배포 시 상태 복원)
const _SUSPICIOUS_FILE = path.join(__dirname, 'data', 'marine_suspicious_state.json');
const _SUSPICIOUS_TMP = _SUSPICIOUS_FILE + '.tmp';
const SUSPICIOUS_THRESHOLD = 3;     // 3+ zone 미예고 사라짐 시 의심 가드 작동
const PUSH_REINFORCE_INTERVAL = 10 * 60 * 1000;  // 10분마다 재push (자동 처리 X)
const SUSPICIOUS_HISTORY_LIMIT = 20;

let _suspiciousState = null;        // lazy load
let _pendingImmediateRelease = null; // decide('normal') 시 다음 cycle 에서 강제 release 처리할 zone 명

/**
 * 의심 사례 ID 생성 — "YYYYMMDD-HHMM" KST 기준
 */
function _genCaseId() {
    const kst = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const y = kst.getUTCFullYear();
    const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    const h = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${y}${mo}${d}-${h}${mi}`;
}

function _loadSuspiciousState() {
    try {
        if (fs.existsSync(_SUSPICIOUS_FILE)) {
            const raw = fs.readFileSync(_SUSPICIOUS_FILE, 'utf8');
            const data = JSON.parse(raw);
            return {
                currentCase: data.currentCase || null,
                history: Array.isArray(data.history) ? data.history : []
            };
        }
    } catch (e) {
        console.warn('[marine_warning_crawler] suspicious state 복원 실패 (무시):', e && e.message);
    }
    return { currentCase: null, history: [] };
}

function _saveSuspiciousState(state) {
    try {
        const dir = path.dirname(_SUSPICIOUS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(_SUSPICIOUS_TMP, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(_SUSPICIOUS_TMP, _SUSPICIOUS_FILE);
    } catch (e) {
        console.warn('[marine_warning_crawler] suspicious state 저장 실패 (무시):', e && e.message);
    }
}

/**
 * 사라진 zone 들을 clr_ntc_tm 등록 여부로 분류.
 *   - normalReleases: clr_ntc_tm 등록 → 정상 해제 인정
 *   - suspiciousZones: 미등록 → 의심 (mmis 누락 가능성)
 */
function _classifyReleases(prev, curr) {
    const normalReleases = [];
    const suspiciousZones = [];
    if (!prev || !prev.parents) return { normalReleases, suspiciousZones };
    for (const [name, info] of prev.parents) {
        if (curr.parents.has(name)) continue;     // 아직 발효 중
        if (!info) continue;
        if (info.wrnLvlNm === '해제') continue;    // 이미 해제 처리
        // [수정B] 예비 zone 이 사라지는 건 정상(예비취소 또는 발표 전이) — 의심 아님.
        //   예비는 원래 clrNtcTm 이 없어 의심으로 오분류되던 문제(예비 단체 이탈 → 의심사례).
        //   발효중(주의보/경보)만 clrNtcTm 없이 사라질 때 의심으로 본다.
        if (info.wrnLvlNm === '예비') continue;
        if (info.clrNtcTm && String(info.clrNtcTm).length > 0) {
            normalReleases.push(name);
        } else {
            suspiciousZones.push(name);
        }
    }
    return { normalReleases, suspiciousZones };
}

/**
 * 의심 가드 적용 — curr 를 in-place 수정 (의심 zone 을 prev 정보로 복원).
 *   - 새 의심 사례 → currentCase 생성 + 1차 push 발사
 *   - 기존 의심 사례 누적 → cycleCount++, 10분 경과 시 재push
 *   - mmis 회복 시 → currentCase auto-reset
 *
 *   반환: { skipped: string[], normalReleases: string[] }
 */
function _applySuspiciousGuard(prev, curr) {
    if (_suspiciousState === null) {
        _suspiciousState = _loadSuspiciousState();
    }
    const { normalReleases, suspiciousZones } = _classifyReleases(prev, curr);
    const result = { skipped: [], normalReleases: normalReleases.slice() };
    const now = Date.now();

    if (suspiciousZones.length >= SUSPICIOUS_THRESHOLD) {
        if (!_suspiciousState.currentCase) {
            // 새 의심 사례 시작
            const id = _genCaseId();
            _suspiciousState.currentCase = {
                id: id,
                firstSeenAt: now,
                zones: suspiciousZones.map(name => {
                    const info = prev.parents.get(name) || {};
                    return {
                        name: name,
                        wrnTp: info.wrnTp || null,
                        wrnTpNm: info.wrnTpNm || null,
                        wrnLvl: info.wrnLvl || null,
                        wrnLvlNm: info.wrnLvlNm || null,
                        tmFc: info.tmFc || null,
                        tmEf: info.tmEf || null
                    };
                }),
                cycleCount: 1,
                lastPushAt: now,
                decisionPending: true
            };
            console.warn('[Marine] 의심 사례 신규 발생 caseId=' + id + ' zones=' + suspiciousZones.join(', '));
            // 1차 push 즉시 발사 (비동기 — await X)
            _enqueueSuspiciousAlert(_suspiciousState.currentCase);
        } else {
            // 기존 의심 사례 누적
            _suspiciousState.currentCase.cycleCount += 1;
            // 10분 경과 시 재push (관리자 결정 X 상태에서 강화)
            if (now - (_suspiciousState.currentCase.lastPushAt || 0) >= PUSH_REINFORCE_INTERVAL) {
                console.warn('[Marine] 의심 사례 재push caseId=' + _suspiciousState.currentCase.id +
                    ' cycleCount=' + _suspiciousState.currentCase.cycleCount);
                // [B-2 fix] lastPushAt 을 push 호출 앞에서 갱신 — enqueueSuspiciousAlert 가
                //   dedupKey 빌드 시 새 timestamp 를 사용하도록. (옛 lastPushAt 으로 빌드하면
                //   기존 _sentKeys 와 충돌해 첫 reinforce 가 silent dedup 됨.)
                _suspiciousState.currentCase.lastPushAt = now;
                _enqueueSuspiciousAlert(_suspiciousState.currentCase);
            }
        }
        _saveSuspiciousState(_suspiciousState);

        // 의심 zone 을 curr 에 복원 (해제 push 발사 안 되도록)
        for (const name of suspiciousZones) {
            const info = prev.parents.get(name);
            if (info) curr.parents.set(name, info);
            // [수정C] 부모만 복원하면 자식이 비어 "(연안바다 미발효)" 오표시 → 자식도 복원
            const pkids = prev.children ? prev.children.get(name) : null;
            if (pkids && pkids.size > 0 && !curr.children.has(name)) {
                curr.children.set(name, new Map(pkids));
            }
            // [B] 공존 다가오는(예비)도 복원 — 글리치 사이클에 병렬 예비 깜빡임 방지
            const pUp = prev.upcomings ? prev.upcomings.get(name) : null;
            if (pUp && curr.upcomings && !curr.upcomings.has(name)) {
                curr.upcomings.set(name, pUp);
            }
        }
        result.skipped = suspiciousZones.slice();
    } else {
        // mmis 회복 또는 의심 없음
        if (_suspiciousState.currentCase) {
            // 자동 reset — history 에 기록
            console.log('[Marine] mmis 회복 — currentCase auto-reset caseId=' +
                _suspiciousState.currentCase.id);
            _suspiciousState.history.unshift({
                id: _suspiciousState.currentCase.id,
                firstSeenAt: _suspiciousState.currentCase.firstSeenAt,
                decidedAt: now,
                decision: 'auto-reset',
                decidedBy: 'system',
                zones: (_suspiciousState.currentCase.zones || []).map(z => z.name),
                elapsedMin: Math.floor((now - _suspiciousState.currentCase.firstSeenAt) / 60000),
                cycleCount: _suspiciousState.currentCase.cycleCount
            });
            _suspiciousState.history = _suspiciousState.history.slice(0, SUSPICIOUS_HISTORY_LIMIT);
            _suspiciousState.currentCase = null;
            _saveSuspiciousState(_suspiciousState);
        }
    }
    return result;
}

/**
 * 의심 알림 push — dmdw_push_sender.enqueueSuspiciousAlert 위임.
 * dmdw_push_sender 가 import 안전한 경우만 호출 (circular safe).
 */
function _enqueueSuspiciousAlert(currentCase) {
    if (!ADMIN_PUSH_ENABLED) return;   // [수정1] 관리자 알림 푸시 비활성 (가드 로직은 유지)
    try {
        if (typeof dmdwPush.enqueueSuspiciousAlert === 'function') {
            // fire-and-forget — push 실패는 본 사이클에 영향 없도록
            Promise.resolve(dmdwPush.enqueueSuspiciousAlert(currentCase))
                .catch(e => console.error('[Marine] suspicious push 실패 (무시):', e && e.message));
        } else {
            console.warn('[Marine] dmdwPush.enqueueSuspiciousAlert 미구현 — push skip');
        }
    } catch (e) {
        console.error('[Marine] _enqueueSuspiciousAlert 실패:', e && e.message);
    }
}

/**
 * 관리자 결정 처리 — admin route 에서 호출.
 *   decision = 'normal'  → 정상 해제 인정 (다음 cycle 에서 release push 발사 유도)
 *   decision = 'invalid' → 수집 오류로 유지 (currentCase 유지, push 카운터 리셋)
 *
 * @returns {Object} { ok: true, decision, zones, caseId } 또는 { error: string }
 */
function decideSuspiciousCase(decision, decidedBy) {
    if (_suspiciousState === null) {
        _suspiciousState = _loadSuspiciousState();
    }
    if (!_suspiciousState.currentCase) {
        return { error: 'no pending case' };
    }
    if (decision !== 'normal' && decision !== 'invalid') {
        return { error: 'invalid decision (expected normal | invalid)' };
    }

    const zones = (_suspiciousState.currentCase.zones || []).map(z => z.name);
    const caseId = _suspiciousState.currentCase.id;
    const now = Date.now();
    const elapsedMin = Math.floor((now - _suspiciousState.currentCase.firstSeenAt) / 60000);

    if (decision === 'normal') {
        // history 에 기록
        _suspiciousState.history.unshift({
            id: caseId,
            firstSeenAt: _suspiciousState.currentCase.firstSeenAt,
            decidedAt: now,
            decision: 'normal',
            decidedBy: decidedBy || 'unknown',
            zones: zones.slice(),
            elapsedMin: elapsedMin,
            cycleCount: _suspiciousState.currentCase.cycleCount
        });
        _suspiciousState.history = _suspiciousState.history.slice(0, SUSPICIOUS_HISTORY_LIMIT);
        // 다음 cycle 의 guard 가 더이상 zone 을 복원하지 않도록 prev 에서 제거
        // (직접 prev 수정 — 다음 run() 의 _classifyReleases 에서 해당 zone 이 prev 에 없으면
        //  자연스럽게 무시되어 release 분기 트리거 안 됨)
        // → 대안: 즉시 pending 등록 → 다음 cycle 에서 강제 release 처리
        _pendingImmediateRelease = (_suspiciousState.currentCase.zones || []).slice();
        _suspiciousState.currentCase = null;
        _saveSuspiciousState(_suspiciousState);
        // 즉시 release push 발사 (다음 cycle 안 기다림)
        _enqueueImmediateRelease(_pendingImmediateRelease);
        _pendingImmediateRelease = null;
        return { ok: true, decision, zones, caseId };
    } else {
        // invalid — currentCase 유지, lastPushAt 만 now 로 (10분 카운터 reset)
        _suspiciousState.currentCase.lastPushAt = now;
        _saveSuspiciousState(_suspiciousState);
        return { ok: true, decision, zones, caseId };
    }
}

/**
 * decide('normal') 시 즉시 release push 발사.
 * zones 는 caseZone 객체 배열 ({name, wrnTp, wrnTpNm, wrnLvl, wrnLvlNm, tmFc, tmEf}).
 *
 * 같은 wrnTp+wrnLvl 별로 묶어서 enqueueParentRelease 호출.
 * prev.parents 에서 zone 을 제거하여 다음 cycle 에서 release 가 다시 트리거되지 않도록 함.
 */
/**
 * [사용자 push 복원] prev vs curr 의 부모 zone 변화를 push_sender 형식으로 변환.
 *   push_sender.processChanges(changes) 가 받는 형식:
 *     [{ type: 'CURRENT_CHANGE' | 'UPCOMING_CHANGE', zone, prev, curr, currentActive? }, ...]
 *
 *   각 prev/curr 객체는 { wrnTp, wrnLvl, tmFc, tmEf, tmYn } — wrnTp/wrnLvl 은 한글.
 *
 *   - 부모 zone 만 (자식 정보 X — 사용자 push V15 호환)
 *   - 변화 없는 zone (prev==curr) 은 skip
 *   - 옛 weather_alerts_crawler.detectChanges 와 동일 패턴:
 *       UPCOMING_CHANGE (예비특보) + CURRENT_CHANGE (발효) 두 종류 발사
 *   - UPCOMING_CHANGE 에는 currentActive 동봉 (격상/격하 판정용 — 현재 발효 중인 부모)
 *
 *   StateSnapshot.parents Map 은 wrnLvlNm 별로 구분 없이 한 zone 당 1 entry.
 *   '예비' = upcoming, '주의보'/'경보' = current 로 분류.
 *   (한 zone 이 예비 + 발효 동시 보유 불가 — mmis 응답 구조상 OR 관계)
 */
// ============================================================================
// [자식 해제 디바운스] 자식이 "해제예고 없이" 데이터에서 사라질 때(글리치 의심)
//   3분간 관찰 후에도 계속 없으면 진짜 해제로 확정. 관찰 중엔 직전 자식을 curr 로
//   이어받아(carry) 가짜 "일부 해제"/뒤따르는 "추가 발효" 푸시와 화면 깜빡임을 막는다.
//   해제 통보문(warn-sasc/latest cmd=해제, _childReleaseNoticeSet)이 있으면 즉시 해제.
// ============================================================================
const CHILD_RELEASE_DEBOUNCE_MS = 3 * 60 * 1000;   // 3분
let _childReleasePending = {};                     // key: parent child → { firstMissingAt }

// [예비취소 디바운스] 예비특보가 글리치(통보문 깜빡임)로 한 사이클 사라졌다 재등장할 때
//   가짜 "예비취소" 푸시가 나가던 문제 방지. 자식 해제 디바운스와 동일 정책(3분).
const UPCOMING_CANCEL_DEBOUNCE_MS = 3 * 60 * 1000;
let _upcomingCancelPending = {};                   // zone → { firstMissingAt, block, inParents }
let _childReleaseNoticeSet = new Set();            // 이번 사이클 해제 통보문 있는 자식 (enrich 가 채움)

// [자식 예비취소 재확인] (§7.7.19) 예비 자식 소멸(releasedPrelim)은 즉발하지 않고 3분(앱 표준
//   디바운스와 동일) 연속 부재 재확인 후 CHILD_PRELIM_CANCEL 발사. 예비 자식은 warn-sasc/list 에서
//   항상 level-0 이라(§7.7.14 실측) ready 행이 1사이클만 빠져도 purge 가 디바운스 carry 를 즉시
//   걷어 releasedChildren 에 나타나므로, 복귀(글리치) 시 오발 취소를 여기서 흡수한다.
//   (carry 방식이 아니라 스냅샷 밖 메모 방식이라 purge 의 영향을 받지 않음 — 다사이클 관찰 가능.
//    부모 예비취소도 3분 관찰 후 발사되므로 부모/자식 타이밍 대칭.)
const CHILD_PRELIM_CANCEL_CONFIRM_MS = 3 * 60 * 1000;    // 3분 연속 부재 재확인 (표준 디바운스 정합)
const CHILD_PRELIM_CANCEL_TTL_MS = 15 * 60 * 1000;       // 부모 소멸 등으로 미발사 잔존 시 정리
let _childPrelimCancelPending = {};                      // "zone|child" → { info, since }

// ============================================================================
// [§7.7.23 판정 보류실] 예비취소 푸시는 "통보문으로 확인된 뒤에만" 발사한다.
// ============================================================================
//
// 배경(오보 3건): 예비가 MMIS 에서 사라지는 원인이 취소만이 아니다 —
//   ① 진짜 취소(통보문 참고사항 문구), ② 글리치(3분 디바운스가 처리), ③ 시각변경·지연(재등장),
//   ④ 예비→발표 전환(7/11 09:35 오보), ⑤ 만료성 소멸(7/10 06:01 오보).
//   기존 "3분 후 무조건 취소 발사"가 ④⑤에서 오보를 냈다.
//
// 동작: 기존 3분 디바운스 확정 시(= UPCOMING_CANCEL / CHILD_PRELIM_CANCEL 발사 직전)
//   푸시를 쏘지 않고 보류실에 등록한다. 매 사이클 판정:
//   (a) 예비 재등장(같은 종류)                     → 폐기 (시각변경 로직이 대신 안내)
//   (b) 같은 zone 실제 발표 등장(발효 승격 또는 명찰: _efBridged/_realLvlNm≠예비) → 폐기 (발표/발효 푸시가 안내)
//   (c) 관할 지방청 통보문 취소 문구 + 해역·종류 매칭 → 그 시점에 취소 푸시 발사 (유일한 발사 경로)
//   (d) TTL 1시간 경과                             → 무푸시 + 로그(참고사항 원문 포함, 사후 정규식 보강 재료)
//
// 원칙: "부모 특보 없이 자식 특보 없음" — 부모 등록 시 그 zone 자식 펜딩/보류를 흡수,
//   (c) 확정 시 부모명 1건 푸시가 자식까지 대표(§7.7.13). 부모·자식 모두 동일 TTL 1시간.
//
// 영속화: 재배포/재시작으로 보류 건이 증발하면 진짜 취소를 영영 못 알린다(치명 1) —
//   data/marine_prelim_cancel_verdicts.json 에 tmp→rename 으로 저장, registeredAt 기준으로
//   재시작 후에도 TTL 이 벽시계로 이어진다.
//
// 스코프: 풍랑·태풍만(스캐너 정규식 대상과 일치). 그 외 종류는 기존 즉시 발사 유지.
//   표출(weather_alerts.json)은 무영향 — MMIS 추종 그대로, 푸시 판단만 보류.
const CANCEL_VERDICT_TTL_MS = 60 * 60 * 1000;            // 기본 대기 1시간 (만료 예비 등 데드라인 과거인 경우)
// [2026-07-12 실측 개정] 대기 데드라인 = max(등록+1h, 예비의 발효예정 끝시각+1h).
//   근거: KMA 는 발효예정 시각까지 반드시 결론(발표 or 취소 통보문)을 낸다 — 7/12 실사고에서
//   취소 통보문이 소멸 2시간 55분 뒤(발효예정 11시 직전 10시)에 발행되어 고정 1시간이면 놓쳤음.
//   폭주 방지: 발효예정이 며칠 뒤인 예비가 소멸해도 보류(=매분 스캔)는 최대 24시간까지만.
const CANCEL_VERDICT_MAX_HOLD_MS = 24 * 60 * 60 * 1000;
const CANCEL_VERDICT_TYPES = ['풍랑', '태풍'];
// [적대검증 1] (c) 시간 축 게이트 — 취소 문구의 통보문 발행시각이 보류 등록보다 이 유예 이상
//   과거면 "이전 에피소드의 묵은 문구"로 보고 매칭하지 않는다 (등록 직전 발행 통보문은 허용).
//   [레드팀 2-B] 30분 → 60분: KMA 가 취소 통보문을 먼저 내고 MMIS ready 반영이 30분+ 지연되는
//   날(장애일)에 진짜 취소를 묵은 문구로 오차단하지 않도록 확대. 묵은 문구 재사용 위험은
//   해역 단위 소각 + 스캔 신선도 + 보류 0건 시 결과 폐기가 계속 방어한다.
const CANCEL_PHRASE_GRACE_MS = 60 * 60 * 1000;
// [적대검증 1] 스캔 신선도 — _lastCancelScan 이 이보다 오래됐으면 (c) 판정 생략 (stale 방지).
const CANCEL_SCAN_FRESH_MS = 10 * 60 * 1000;
const CANCEL_VERDICT_FILE = path.join(__dirname, 'data', 'marine_prelim_cancel_verdicts.json');
const CANCEL_VERDICT_TMP = CANCEL_VERDICT_FILE + '.tmp';
let _cancelVerdicts = null;        // { parents: {zone: ent}, children: {"zone|child": ent} }, lazy-load
let _cancelVerdictsDirty = false;
let _lastCancelScan = null;        // 이번 사이클 스캔 결과 (run 4-G 가 채움)
let _cvSuppressFireThisCycle = false;   // [4차 통합검증 4] 관리자 테스트 사이클 (c) 발사 이월

/** MMIS 시각 문자열의 "끝 모멘트" epoch ms (KST).
 *   지원: "YYYY.MM.DD HH~HH시"·"HH시~HH시"·전각 ∼ (범위 — 끝시각), "YYYY.MM.DD HH:mm"(정확),
 *   "YYYY.MM.DD HH시". "24시"는 익일 00시로 자연 정규화(Date.UTC 시간 오버플로).
 *   [3차 검증 치명] 자정넘김 표기 "18~00시"(실측: warn-sasc/ready 2026-07-11) — 끝시가
 *   시작시보다 작으면 익일 보정(+24h). 이 보정이 없으면 끝이 18시간 과거로 계산되어
 *   데드라인이 기본 1h 로 붕괴(저녁 예비 소멸 → 익일 새벽 취소 통보문을 놓치는 7/12 형).
 *   파싱 불가 → null (호출측 기본 1h — 등록 로그로 가시화). */
function _mmisEndMs(t) {
    if (!t) return null;
    const s = String(t).trim();
    let m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2})\s*시?\s*[~∼]\s*(\d{1,2})\s*시/.exec(s);
    if (m) {
        const start = +m[4];
        let end = +m[5];
        if (end < start) end += 24;   // 자정넘김 "18~00시" → 익일 00시
        return Date.UTC(+m[1], +m[2] - 1, +m[3], end - 9, 0);
    }
    m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]);
    m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2})\s*시/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, 0);
    return null;
}

/** 보류 건의 판정 데드라인 — max(등록+1h, 발효예정 끝+1h), 상한 등록+24h. */
function _cvDeadline(ent) {
    const base = ent.registeredAt + CANCEL_VERDICT_TTL_MS;
    const efEnd = _mmisEndMs(ent.block && ent.block.tmEf);
    const byEf = (efEnd != null) ? efEnd + CANCEL_VERDICT_TTL_MS : 0;
    return Math.min(Math.max(base, byEf), ent.registeredAt + CANCEL_VERDICT_MAX_HOLD_MS);
}

function _loadCancelVerdicts() {
    if (_cancelVerdicts) return _cancelVerdicts;
    _cancelVerdicts = { parents: {}, children: {} };
    try {
        const raw = JSON.parse(fs.readFileSync(CANCEL_VERDICT_FILE, 'utf8'));
        const now = Date.now();
        for (const bucket of ['parents', 'children']) {
            const src = raw && raw[bucket];
            if (!src) continue;
            for (const k of Object.keys(src)) {
                const ent = src[k];
                if (!ent || typeof ent.registeredAt !== 'number') continue;
                if (now >= _cvDeadline(ent)) {
                    // 다운타임 중 데드라인 초과 — (d) 와 동일하게 무푸시 종료 (통보문 확인 불가였으므로 보수적)
                    console.log(`[Marine] 예비취소 보류 만료(재시작 복원 중, 무푸시): ${k}`);
                    _cancelVerdictsDirty = true;
                    continue;
                }
                // [레드팀 2-A] 부모 키 구식(zone 단독) → zone|종류 마이그레이션
                let key = k;
                if (bucket === 'parents' && k.indexOf('|') === -1) {
                    key = k + '|' + ((ent.block && ent.block.wrnTp) || '');
                    _cancelVerdictsDirty = true;
                }
                _cancelVerdicts[bucket][key] = ent;
            }
        }
        const np = Object.keys(_cancelVerdicts.parents).length, nc = Object.keys(_cancelVerdicts.children).length;
        if (np + nc > 0) console.log(`[Marine] 예비취소 보류 복원: 부모 ${np}건, 자식 ${nc}건 (판정 이어감)`);
    } catch (_) { /* 파일 없음/손상 → 빈 보류실 */ }
    return _cancelVerdicts;
}

function _saveCancelVerdicts() {
    if (!_cancelVerdicts || !_cancelVerdictsDirty) return;
    try {
        const dir = path.dirname(CANCEL_VERDICT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CANCEL_VERDICT_TMP, JSON.stringify(_cancelVerdicts), 'utf8');
        fs.renameSync(CANCEL_VERDICT_TMP, CANCEL_VERDICT_FILE);
        _cancelVerdictsDirty = false;
    } catch (e) {
        console.warn('[Marine] 예비취소 보류 저장 실패:', e && e.message);
    }
}

function _cvHasPendings() {
    const v = _loadCancelVerdicts();
    return Object.keys(v.parents).length > 0 || Object.keys(v.children).length > 0;
}

/** 자식 info → 푸시 블록 (diff 스코프의 childToBlock 과 동일 매핑 — 흡수 자식 복원용). */
function _childInfoToBlock(info) {
    return info ? {
        wrnTp: info.wrnTpNm || info.wrnTp || '',
        wrnLvl: info.wrnLvlNm || info.wrnLvl || '',
        tmFc: info.tmFc || '',
        tmEf: info.tmEf || '',
        tmYn: info.tmYn || info.clrNtcTm || ''
    } : null;
}

/** [레드팀 2-A] 부모 보류 키 — zone 단독이면 풍랑↔태풍 교대 시 서로 덮어써 앞선 종류의
 *  취소 판정이 흡수·보존 없이 소멸(침묵 살해)한다. 자식(zone|child)과 동형으로 종류를 키에 포함. */
function _cvParentKey(zone, tp) { return zone + '|' + (tp || ''); }

/** 부모 예비취소 보류 등록 — 같은 종류의 자식 펜딩 흡수(부모 대표). block = toBlock(prevUpcoming). */
function _registerParentCancelVerdict(zone, block) {
    const v = _loadCancelVerdicts();
    const tp = (block && block.wrnTp) || '';
    const pkey = _cvParentKey(zone, tp);
    // [적대검증 9] 같은 zone·종류 재등록(재등장↔재소멸 진동)은 registeredAt 승계 — TTL 이
    //   매번 리셋되어 판정·스캔이 무기한 연장되는 것을 방지. (종류가 다르면 키가 달라
    //   별도 에피소드로 공존 — 레드팀 2-A)
    const prevEnt = v.parents[pkey];
    const sameEpisode = !!(prevEnt && prevEnt.block);
    const registeredAt = sameEpisode ? prevEnt.registeredAt : Date.now();
    // [적대검증 6] 흡수하는 자식들을 기록 — 부모가 (a)/(b)로 폐기(취소 아님 판명)될 때
    //   미복귀 자식을 자식 보류로 복원해 §7.7.19(자식 단독취소 통지) 보장을 유지.
    //   흡수는 같은 종류만 — 타 종류 자식 판정은 독립 지속.
    const absorbed = sameEpisode ? (prevEnt.absorbed || []) : [];
    for (const pk of Object.keys(_childPrelimCancelPending)) {
        if (pk.slice(0, zone.length + 1) !== zone + '|') continue;
        const ent = _childPrelimCancelPending[pk];
        const iTp = (ent.info && (ent.info.wrnTpNm || ent.info.wrnTp)) || '';
        if (iTp && iTp !== tp) continue;   // 타 종류 펜딩은 그대로
        const cn = pk.slice(zone.length + 1);
        if (!absorbed.some(a => a.child === cn)) {
            absorbed.push({ child: cn, block: _childInfoToBlock(ent.info), registeredAt: Date.now() });
        }
        delete _childPrelimCancelPending[pk];
    }
    for (const ck of Object.keys(v.children)) {
        const ce = v.children[ck];
        if (ce && ce.zone === zone && ce.block && ce.block.wrnTp === tp) {
            if (!absorbed.some(a => a.child === ce.child)) {
                absorbed.push({ child: ce.child, block: ce.block, registeredAt: ce.registeredAt });
            }
            delete v.children[ck];
        }
    }
    v.parents[pkey] = { zone, block, registeredAt, evalCycles: (sameEpisode ? prevEnt.evalCycles : 0) || 0, absorbed };
    _cancelVerdictsDirty = true;
    const ddl = _cvDeadline(v.parents[pkey]);
    const efNote = (block && block.tmEf && _mmisEndMs(block.tmEf) == null) ? ', 발효예정 파싱불가→기본 1h' : '';
    console.log(`[Marine] 예비취소 판정 보류(부모): ${zone} [${tp}] — 통보문 확인 대기 (데드라인 ${Math.round((ddl - Date.now()) / 60000)}분 후${sameEpisode ? ', 기존 판정 승계' : ''}${efNote})`);
}

/** 자식 예비취소 보류 등록 — 부모 예비는 살아있는 케이스(§7.7.19). block = childToBlock(info). */
function _registerChildCancelVerdict(zone, child, block) {
    const v = _loadCancelVerdicts();
    if (v.parents[_cvParentKey(zone, (block && block.wrnTp) || '')]) return;   // 같은 종류 부모 보류 중이면 부모가 대표
    const key = zone + '|' + child;
    const prevEnt = v.children[key];
    const sameEpisode = prevEnt && prevEnt.block && block && prevEnt.block.wrnTp === block.wrnTp;
    v.children[key] = {
        zone, child, block,
        registeredAt: sameEpisode ? prevEnt.registeredAt : Date.now(),
        evalCycles: (sameEpisode ? prevEnt.evalCycles : 0) || 0
    };
    _cancelVerdictsDirty = true;
    console.log(`[Marine] 예비취소 판정 보류(자식): ${zone} > ${child} [${block && block.wrnTp}] — 통보문 확인 대기`);
}

/** 보류 zone 들의 통보문 스캔 대상(관할청 집합 + 날짜) 구성. */
function _cvScanTargets() {
    const v = _loadCancelVerdicts();
    const offices = new Set(['108']);   // 묶음명(전해상 등) 취소는 전국 통보문에 실릴 수 있음
    const dayMs = new Set();
    const addZone = (zone, registeredAt) => {
        offices.add(ZONE_HOME_OFFICE[zone] || '108');
        if (zone.indexOf('강원') === 0) offices.add('105');   // 강원 3해역: 매핑 105 확정(2026-07-12 내용검증) — 이중 방어로 유지
        dayMs.add(registeredAt);
    };
    for (const k of Object.keys(v.parents)) addZone(v.parents[k].zone, v.parents[k].registeredAt);
    for (const k of Object.keys(v.children)) addZone(v.children[k].zone, v.children[k].registeredAt);
    // KST 날짜: 오늘 + 등록일(자정 걸침 대비)
    const kst = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const dates = new Set([kst(Date.now())]);
    for (const ms of dayMs) dates.add(kst(ms));
    return { offices, dates: Array.from(dates) };
}

/** 테스트용 — 스캔 결과 주입/보류실 초기화 (프로덕션 미사용). */
function _setLastCancelScanForTest(v) { _lastCancelScan = v; }
function _resetCancelVerdictsForTest() {
    _cancelVerdicts = { parents: {}, children: {} };
    _cancelVerdictsDirty = false;
    _lastCancelScan = null;
}

/**
 * [§7.7.23] 보류 건 판정 — _buildUserPushChanges 말미(zone 루프 밖)에서 호출.
 *   확정((c))·대표 발사는 합성 change 를 changes 에 append 해 기존 발송 경로
 *   (processChanges: 점검모드 차단·pendingPushes 재시도·dedup)를 그대로 탄다.
 *   pushSender 부재 환경에서는 판정을 소비하지 않는다(발사 없이 소진 방지).
 * @param h { getUp, getAct, childKeys } — diff 함수 스코프의 헬퍼
 */
function _evaluateCancelVerdicts(curr, changes, h) {
    const v = _loadCancelVerdicts();
    if (Object.keys(v.parents).length === 0 && Object.keys(v.children).length === 0) return;
    const now = Date.now();
    // [적대검증 8] (a)(b)(d) 판정은 항상 수행 — pushSender 부재는 (c) "발사"만 막는다.
    //   (전부 멈추면 보류가 영구 잔존해 매분 스캔이 무기한 지속됐음.)
    // [4차 통합검증 3·4] (c) 발사는 실제로 사용자에게 전달될 수 있을 때만 — 점검모드(blockPush)
    //   면 processChanges 가 pending 저장 없이 false 를 반환해 확정 취소가 유실됐고, 관리자
    //   테스트 사이클이면 관리자 기기로만 나가고 보류가 소진됐다. 두 경우 모두 발사를 미루면
    //   보류가 유지되어 다음 정상 사이클에 (c)가 다시 잡는다.
    const canFire = !!(pushSender && typeof pushSender.processChanges === 'function')
        && !_cvSuppressFireThisCycle
        && !(pushSender && typeof pushSender.isPushBlocked === 'function' && pushSender.isPushBlocked());
    // [적대검증 1] (c) 시간 축 3중 게이트: ① 스캔 신선도, ② 문구의 통보문 발행시각(issuedAtMs,
    //   없으면 발견시각 foundAt 폴백)이 보류 등록 - 유예(30분) 이후, ③ 발사에 쓴 문구는 소각
    //   (한 문구가 다른 에피소드를 재확정하는 것 방지). — 묵은 문구 오확정(7/11형 재발) 차단.
    const scanFresh = _lastCancelScan && (now - _lastCancelScan.fetchedAt) < CANCEL_SCAN_FRESH_MS;
    const releases = (scanFresh && _lastCancelScan.releases) || [];
    const timeOk = (r, ent) => {
        const t = (typeof r.issuedAtMs === 'number') ? r.issuedAtMs : r.foundAt;
        return typeof t === 'number' && t >= ent.registeredAt - CANCEL_PHRASE_GRACE_MS;
    };
    // 소각은 "해역(또는 zone|child) 단위" — 한 문장이 여러 해역을 나열하는 실서식에서
    //   첫 해역 발사가 문구를 통째로 소각해 나머지 해역을 막지 않도록. 같은 해역의
    //   에피소드 재확정(묵은 문구 재사용)만 차단한다.
    const isConsumed = (r, key) => Array.isArray(r.consumedFor) && r.consumedFor.indexOf(key) !== -1;
    const consume = (r, key) => { r.consumedFor = (r.consumedFor || []).concat(key); };
    // [적대검증 6] 부모 (a)/(b) 폐기 시 흡수 자식 복원 — 미복귀 자식은 자식 보류로 돌려
    //   §7.7.19(자식 단독취소 통지) 보장 유지. TTL 이 이미 지난 흡수분은 (d)와 동일 무푸시 로그.
    const restoreAbsorbed = (zone, ent) => {
        for (const a of (ent.absorbed || [])) {
            if (!a || !a.child || !a.block) continue;
            if (h.childKeys(curr, zone).indexOf(a.child) !== -1) continue;   // 복귀 → 불요
            if (now >= _cvDeadline(a)) {
                console.log(`[Marine] 자식 예비취소 보류 만료(부모 해소 복원 중, 무푸시): ${zone} > ${a.child}`);
                continue;
            }
            v.children[zone + '|' + a.child] = { zone, child: a.child, block: a.block, registeredAt: a.registeredAt, evalCycles: 0 };
            console.log(`[Marine] 자식 예비취소 보류 복원(부모 취소 아님 판명): ${zone} > ${a.child}`);
        }
    };

    // ── 부모 보류 판정 (키 = zone|종류 — 레드팀 2-A) ─────────────────────────
    for (const pkey of Object.keys(v.parents)) {
        const ent = v.parents[pkey];
        const zone = ent.zone;
        ent.evalCycles = (ent.evalCycles || 0) + 1;
        _cancelVerdictsDirty = true;
        const tp = (ent.block && ent.block.wrnTp) || '';

        // (a)/(b) 같은 종류의 예비 재등장 — 명찰(_efBridged/_realLvlNm)로 전환 여부 구분(로그용).
        //   어느 쪽이든 취소가 아니므로 폐기: (a)는 시각변경/발표 로직이, (b)는 발표·발효 푸시가 안내.
        const cUpInfo = h.getUp(curr, zone);
        if (cUpInfo && (cUpInfo.wrnTpNm || '') === tp) {
            const converted = !!cUpInfo._efBridged || (cUpInfo._realLvlNm && cUpInfo._realLvlNm !== '예비');
            console.log(`[Marine] 예비취소 보류 해소(${converted ? '발표 전환 감지' : '예비 재등장'}): ${zone} — 취소 아님, 무푸시`);
            restoreAbsorbed(zone, ent);
            delete v.parents[pkey];
            continue;
        }
        // (b) 발효 승격 (같은 종류)
        const cActInfo = h.getAct(curr, zone);
        if (cActInfo && (cActInfo.wrnTpNm || '') === tp) {
            console.log(`[Marine] 예비취소 보류 해소(발효 승격): ${zone} — 발효 푸시가 대표, 무푸시`);
            restoreAbsorbed(zone, ent);
            delete v.parents[pkey];
            continue;
        }
        // (c) 통보문 취소 문구 매칭 → 유일한 발사 경로 (시간 축 게이트 + 해역 단위 소각)
        if (canFire && bulletinScanner && releases.length > 0) {
            const hit = releases.find(r => !isConsumed(r, zone) && r.wrnTp === tp && timeOk(r, ent) && bulletinScanner.matchesZone(r, zone));
            if (hit) {
                consume(hit, zone);
                console.log(`[Marine] ✅ 예비취소 확정(통보문 문구): ${zone} [${tp}] — "${(hit.sentence || '').slice(0, 100)}" (${hit.source || ''})`);
                changes.push({
                    type: 'UPCOMING_CANCEL', zone, prev: ent.block,
                    childState: { all: PARENT_TO_CHILDREN[zone] || [], active: h.childKeys(curr, zone), added: [], released: [] }
                });
                delete v.parents[pkey];
                continue;
            }
        }
        // (d) 데드라인(발효예정 끝+1h, 최소 1h, 최대 24h) — 무푸시 + 원문 로그 (정규식 사후 보강 재료)
        if (now >= _cvDeadline(ent)) {
            const raw = _lastCancelScan && _lastCancelScan.rawByOffice
                ? JSON.stringify(_lastCancelScan.rawByOffice).slice(0, 600) : '(스캔 원문 없음)';
            console.log(`[Marine] 예비취소 보류 만료(무푸시): ${zone} [${tp}] — ${ent.evalCycles}사이클 판정, 취소 문구 미발견. 최근 참고사항: ${raw}`);
            // [3차 검증 중간] 부모(만료형, 짧은 데드라인)와 흡수 자식(발효예정 미래, 긴 데드라인)이
            //   어긋날 수 있음 — 부모 만료 시에도 미복귀 자식은 복원해 자기 데드라인까지 판정 지속.
            restoreAbsorbed(zone, ent);
            delete v.parents[pkey];
        }
    }

    // ── 자식 보류 판정 (zone 별 묶어 1건 발사 — 기존 CHILD_PRELIM_CANCEL 형식 유지) ──
    const fireByZone = new Map();
    for (const key of Object.keys(v.children)) {
        const ent = v.children[key];
        ent.evalCycles = (ent.evalCycles || 0) + 1;
        _cancelVerdictsDirty = true;
        const { zone, child } = ent;
        const tp = (ent.block && ent.block.wrnTp) || '';

        // 같은 종류의 부모 보류가 뒤늦게 열렸으면 흡수 (부모 대표 — 등록 함수가 absorbed 에 기록함)
        if (v.parents[_cvParentKey(zone, tp)]) { delete v.children[key]; continue; }
        // (a) 자식 복귀 (글리치/재등록) → 폐기. [적대검증 7] 종류 일치할 때만 —
        //   태풍철 풍랑↔태풍 교대 재등장이 풍랑 취소 판정을 오해소하지 않도록.
        if (h.childKeys(curr, zone).indexOf(child) !== -1) {
            const ci = h.childInfoOf ? h.childInfoOf(curr, zone, child) : null;
            if (!ci || (ci.wrnTpNm || '') === tp) {
                console.log(`[Marine] 자식 예비취소 보류 해소(복귀): ${zone} > ${child} — 무푸시`);
                delete v.children[key];
                continue;
            }
        }
        // (c) 통보문 매칭 — 자식명 직접(0·1순위) 또는 부모명/묶음명 대표(2·3순위)
        if (canFire && bulletinScanner && releases.length > 0) {
            const hit = releases.find(r => !isConsumed(r, key) && r.wrnTp === tp && timeOk(r, ent) && bulletinScanner.matchesChild(r, zone, child));
            if (hit) {
                consume(hit, key);
                console.log(`[Marine] ✅ 자식 예비취소 확정(통보문 문구): ${zone} > ${child} — "${(hit.sentence || '').slice(0, 100)}"`);
                // [6차] zone|종류 로 묶음 — 같은 zone 의 풍랑·태풍 자식이 같은 사이클에 확정될 때
                //   한 change 에 종류가 섞여 "풍랑 취소" 제목에 태풍 자식이 실리는 혼합 방지.
                const fzKey = zone + '|' + tp;
                if (!fireByZone.has(fzKey)) fireByZone.set(fzKey, { zone, block: ent.block, names: [] });
                fireByZone.get(fzKey).names.push(child);
                delete v.children[key];
                continue;
            }
        }
        // (c2) [2026-07-14 실사고] 해당구역 절의 제외 단서 — "경북남부앞바다(평수구역 제외)".
        //   부모는 발표/변경되면서 자식만 대상에서 빠지는 서식(참고사항에 취소 문구 없음)의
        //   긍정 확정 근거. 부모 판정에는 불사용(제외 = 부모 생존 전제). 시간축·소각·신선도
        //   게이트는 (c)와 동일. 종류 미상('') 단서는 보수적으로 종류 일치 요구를 통과시키되
        //   부모명 직접 일치 + 자식 단축명 토큰 일치가 모두 필요해 오귀속 여지가 없다.
        const exclusions = (scanFresh && _lastCancelScan && _lastCancelScan.exclusions) || [];
        if (canFire && bulletinScanner && typeof bulletinScanner.matchesChildExclusion === 'function' && exclusions.length > 0) {
            const ex = exclusions.find(x => !isConsumed(x, key) && (x.tp === '' || x.tp === tp) && timeOk(x, ent) && bulletinScanner.matchesChildExclusion(x, zone, child));
            if (ex) {
                consume(ex, key);
                console.log(`[Marine] ✅ 자식 예비취소 확정(제외 단서): ${zone} > ${child} — "${ex.parent}(${(ex.excluded || []).join(',')} 제외)" (${ex.source || ''})`);
                const fzKey = zone + '|' + tp;
                if (!fireByZone.has(fzKey)) fireByZone.set(fzKey, { zone, block: ent.block, names: [] });
                fireByZone.get(fzKey).names.push(child);
                delete v.children[key];
                continue;
            }
        }
        // (c3) [2026-07-14 제주 실물, 제07-33·36·44호] 해당구역 절의 지정 단서 —
        //   "제주도동부앞바다( 북동연안바다 )": 발표/변경이 괄호로 "남는 자식만" 지목하는
        //   서식((c2) 제외형의 반대 방향). 나열에서 빠진 이 자식은 대상 제외 = 취소 확정.
        //   게이트는 (c2)와 동일(시간축·소각·신선도·부모 판정 불사용)하되, 부재(omission)
        //   기반 근거라 문턱을 한 단 높여 종류(tp) 일치를 반드시 요구한다('' 통과 없음).
        //   [적대검증(c3) 결함4] 같은 부모+종류의 지정이 여럿이면 "최신 발행분만" 권위 —
        //   묵은 지정(자식 미나열)이 신규 확대 통보(자식 재나열)를 이기고 오발사하지 않도록.
        //   [적대검증(c3) 결함6] 나열 토큰에 이 부모의 알려진 자식과 대응 안 되는 이름이
        //   섞여 있으면(표기 변형 의심) 그 지정은 판정 불사용 — 변형 1글자로 인한 오발사 차단.
        const designations = (scanFresh && _lastCancelScan && _lastCancelScan.designations) || [];
        if (canFire && bulletinScanner && typeof bulletinScanner.matchesChildDesignation === 'function'
            && typeof bulletinScanner.designationAppliesTo === 'function' && designations.length > 0) {
            const knownKids = (PARENT_TO_CHILDREN[zone] || []).map(k => String(k).replace(/\s+/g, ''));
            const tokenKnown = t => {
                const nt = String(t).replace(/\s+/g, '');
                return knownKids.some(k => {
                    const short = k.split('중').pop();
                    return k.indexOf(nt) !== -1 || short === nt || nt.indexOf(short) !== -1;
                });
            };
            const applicable = designations.filter(x => x.tp === tp && timeOk(x, ent) && bulletinScanner.designationAppliesTo(x, zone));
            const newest = applicable.length > 0 ? applicable.reduce((a, b) =>
                (((b.issuedAtMs || b.foundAt || 0) >= (a.issuedAtMs || a.foundAt || 0)) ? b : a)) : null;
            const dg = (newest && !isConsumed(newest, key) && (newest.listed || []).every(tokenKnown)
                && bulletinScanner.matchesChildDesignation(newest, zone, child)) ? newest : null;
            if (dg) {
                consume(dg, key);
                console.log(`[Marine] ✅ 자식 예비취소 확정(지정 단서): ${zone} > ${child} — "${dg.parent}(${(dg.listed || []).join(',')})" 나열에서 제외 (${dg.source || ''})`);
                const fzKey = zone + '|' + tp;
                if (!fireByZone.has(fzKey)) fireByZone.set(fzKey, { zone, block: ent.block, names: [] });
                fireByZone.get(fzKey).names.push(child);
                delete v.children[key];
                continue;
            }
        }
        // (d) 데드라인 — 무푸시 + 원문 로그 (자식 괄호형(V4) 미매치가 바로 보강 재료인 케이스)
        if (now >= _cvDeadline(ent)) {
            const raw = _lastCancelScan && _lastCancelScan.rawByOffice
                ? JSON.stringify(_lastCancelScan.rawByOffice).slice(0, 600) : '(스캔 원문 없음)';
            console.log(`[Marine] 자식 예비취소 보류 만료(무푸시): ${zone} > ${child} — ${ent.evalCycles}사이클 판정, 취소 문구 미발견. 최근 참고사항: ${raw}`);
            delete v.children[key];
        }
    }
    for (const g of fireByZone.values()) {
        changes.push({
            type: 'CHILD_PRELIM_CANCEL', zone: g.zone, prev: g.block,
            childState: { all: PARENT_TO_CHILDREN[g.zone] || [], active: h.childKeys(curr, g.zone), added: [], released: g.names }
        });
    }
    // [4차 통합검증 5] (c) 소진 직후 즉시 영속화 — run 6단계 저장 전에 프로세스가 죽으면
    //   재시작 재스캔이 같은 문구로 재확정해 취소가 2회 발사되던 크래시 창을 닫는다.
    _saveCancelVerdicts();
}

/**
 * curr 를 변형: 해제예고 없이 사라진 자식을 3분간 이어받기. 깜빡임/확정/정상해제 로그.
 * _buildUserPushChanges / _writeWeatherAlertsJson 보다 먼저 호출되어야 함.
 */
function _applyChildReleaseDebounce(prev, curr) {
    if (!prev || !curr || !prev.children) return;
    const now = Date.now();
    const stillPending = new Set();

    for (const [parent, prevKids] of prev.children) {
        if (!curr.parents || !curr.parents.has(parent)) continue;  // 부모 해제 시 자식 디바운스 안 함
        const currKidMap = curr.children ? curr.children.get(parent) : null;
        for (const [childName, prevInfo] of prevKids) {
            if (currKidMap && currKidMap.has(childName)) continue;   // 그대로 존재 — 무관
            const key = parent + ' ' + childName;

            // 해제 통보문이 있으면(관리자 사전등록 해제 데이터) 진짜 해제 → 즉시 허용
            if (_childReleaseNoticeSet.has(childName)) {
                if (_childReleasePending[key]) delete _childReleasePending[key];
                console.log(`[Marine] 자식 정상 해제(해제예고 있음): ${parent} > ${childName}`);
                continue;
            }

            // 해제예고 없이 사라짐 → 글리치 의심 → 디바운스
            if (!_childReleasePending[key]) {
                _childReleasePending[key] = { firstMissingAt: now };
                console.log(`[Marine] 자식 해제 디바운스 시작: ${parent} > ${childName} (해제예고 없이 사라짐, 3분 관찰)`);
            }
            const elapsed = now - _childReleasePending[key].firstMissingAt;
            if (elapsed < CHILD_RELEASE_DEBOUNCE_MS) {
                // 관찰 중 — 직전 자식을 curr 에 이어받아 가짜 해제/추가/깜빡임 방지
                if (!curr.children.has(parent)) curr.children.set(parent, new Map());
                curr.children.get(parent).set(childName, Object.assign({}, prevInfo));
                stillPending.add(key);
            } else {
                // 3분 경과 — 진짜 해제로 확정 (이어받기 중단 → diff 가 CHILD_RELEASE 발사)
                console.log(`[Marine] 자식 해제 확정(디바운스 ${Math.round(elapsed / 1000)}초 경과, 해제예고 없음): ${parent} > ${childName}`);
                delete _childReleasePending[key];
            }
        }
    }

    // 관찰 중이던 자식이 이번 사이클에 복귀 → 깜빡임(글리치) 확정 로그 + 정리
    for (const key of Object.keys(_childReleasePending)) {
        if (stillPending.has(key)) continue;
        const sep = key.indexOf(' ');
        const p = key.slice(0, sep), ch = key.slice(sep + 1);
        const backNow = !!(curr.children && curr.children.get(p) && curr.children.get(p).has(ch));
        const elapsedSec = Math.round((now - _childReleasePending[key].firstMissingAt) / 1000);
        if (backNow && curr.parents && curr.parents.has(p)) {
            console.log(`[Marine] ⚡ 자식 깜빡임 감지(글리치): ${p} > ${ch} — ${elapsedSec}초 만에 복귀, 가짜 해제 억제됨`);
        }
        delete _childReleasePending[key];
    }
}

// ============================================================================
// [예비취소 디바운스] 예비특보가 실시간(warn/ready)·ef/list 양쪽에서 사라진 사이클에 한해
//   직전 예비를 curr 로 N분간 이어받기(carry). carry 중엔 currUpcoming 이 채워져
//   _buildUserPushChanges 의 UPCOMING_CANCEL 분기(!currUpcoming)가 성립하지 않아 가짜취소가
//   원천 억제된다. N분 연속 부재면 carry 중단 → diff 가 UPCOMING_CANCEL 1회 정상 발사(진짜취소).
//   - ef/list 보강·의심가드 이후에 호출되므로 "둘 다 놓친" 사이클만 대상(ef 가 살린 사이클은
//     currUpcoming 이 차서 비대상). 발효 승격은 currActive 가 차서 비대상(발효 푸시로 처리).
//   - carry 블록 = prev 예비 그대로 → blockEqual 무변화 → 다른 푸시(발표/변경/연장 등) 무영향.
//   - 비영속(재시작=타이머 리셋=지연만, 가짜취소/누락 없음 — carry 는 첫 목격에도 발사 안 함).
// ============================================================================
function _applyUpcomingCancelDebounce(prev, curr) {
    if (!prev || !curr) return;
    const now = Date.now();
    const stillPending = new Set();

    // prev 의 예비 zone 수집 (parents 예비 + upcomings) — 위치(parents/upcomings) 기록
    const prevUpZones = new Map();   // zone → { block, inParents }
    if (prev.parents) for (const [z, info] of prev.parents) {
        if (info && info.wrnLvlNm === '예비') prevUpZones.set(z, { block: info, inParents: true });
    }
    if (prev.upcomings) for (const [z, info] of prev.upcomings) {
        if (!prevUpZones.has(z) && info && info.wrnLvlNm === '예비') prevUpZones.set(z, { block: info, inParents: false });
    }

    const hasUp = (z) => {
        const p = curr.parents ? curr.parents.get(z) : null;
        if (p && p.wrnLvlNm === '예비') return true;
        return !!(curr.upcomings && curr.upcomings.get(z));
    };
    const hasAct = (z) => {
        const p = curr.parents ? curr.parents.get(z) : null;
        return !!(p && p.wrnLvlNm && p.wrnLvlNm !== '예비' && p.wrnLvlNm !== '해제');
    };

    for (const [zone, ent] of prevUpZones) {
        if (hasUp(zone) || hasAct(zone)) {
            // 예비 여전히 있음(실시간/ef) 또는 발효 승격 → 정상. 관찰 중이었으면 글리치 확정.
            if (_upcomingCancelPending[zone]) {
                const sec = Math.round((now - _upcomingCancelPending[zone].firstMissingAt) / 1000);
                console.log(`[Marine] ⚡ 예비 깜빡임 감지(글리치): ${zone} — ${sec}초 만에 복귀, 가짜 예비취소 억제됨`);
                delete _upcomingCancelPending[zone];
            }
            continue;
        }
        // 예비가 curr 어디에도 없음 → 글리치 의심 → 디바운스
        if (!_upcomingCancelPending[zone]) {
            _upcomingCancelPending[zone] = { firstMissingAt: now, block: Object.assign({}, ent.block), inParents: ent.inParents };
            console.log(`[Marine] 예비취소 디바운스 시작: ${zone} (예비 사라짐, ${UPCOMING_CANCEL_DEBOUNCE_MS / 60000}분 관찰)`);
        }
        const p = _upcomingCancelPending[zone];
        if (now - p.firstMissingAt < UPCOMING_CANCEL_DEBOUNCE_MS) {
            // 관찰 중 — 직전 예비를 curr 에 이어받아 가짜취소·화면 깜빡임 방지 (빈 슬롯에만)
            if (p.inParents) {
                if (curr.parents && !curr.parents.has(zone)) curr.parents.set(zone, Object.assign({}, p.block));
            } else {
                if (!curr.upcomings) curr.upcomings = new Map();
                if (!curr.upcomings.has(zone)) curr.upcomings.set(zone, Object.assign({}, p.block));
            }
            stillPending.add(zone);
        } else {
            // N분 경과 — 진짜취소 확정 (이어받기 중단 → diff 가 UPCOMING_CANCEL 발사)
            console.log(`[Marine] 예비취소 확정(디바운스 ${Math.round((now - p.firstMissingAt) / 1000)}초 경과): ${zone}`);
            delete _upcomingCancelPending[zone];
            // [§7.7.19] 부모 진짜취소 확정 → 보류 중이던 자식 예비취소 펜딩도 함께 폐기.
            //   부모 UPCOMING_CANCEL(prelim_cancel) 1건이 자식까지 대표(§7.7.13). TTL 에만 기대면
            //   15분 내 동일 zone 신규 특보 재발표 시 구특보의 자식취소가 뒤늦게 오발사될 수 있음.
            for (const cpk of Object.keys(_childPrelimCancelPending)) {
                if (cpk.slice(0, zone.length + 1) === zone + '|') delete _childPrelimCancelPending[cpk];
            }
        }
    }

    // prev 에서도 사라진 stale pending 정리
    for (const zone of Object.keys(_upcomingCancelPending)) {
        if (stillPending.has(zone) || prevUpZones.has(zone)) continue;
        delete _upcomingCancelPending[zone];
    }
}

// ============================================================================
// [제외 자식 사후정리(post-pass)] 모든 보강(latest/ef)·디바운스가 끝난 직후, snap.children
//   전체를 순회해 "이번 사이클 라이브 근거가 전혀 없는데 carry/synth 로만 들어온 유령 자식"을
//   제거한다. 제거 조건 = (warn-sasc/list level-0 으로 명시 제외) AND (이번 사이클 라이브 자식 아님).
//   - 배경: 제외 게이트가 synth(맹목 합성) 분기에만 있고 carry(prev 이어받기)·해제 디바운스
//     3경로는 무게이트라, synth 가 1회 시드한 유령 자식이 carry 로 영속하던 문제(제주도북부앞바다
//     연안바다 오포함). 개별 carry 게이트는 경로가 셋이라 누락 재발 위험 → 단일 사후정리로 통합.
//   - [라이브 회귀 방지 — 핵심] 제외 소스 excludedChildren(warn-sasc/list level-0) 은 "미포함"뿐
//     아니라 "아직 미발효(예비)"도 level-0 으로 내려준다(라이브 확인: warn-sasc/ready 의 예비특보
//     자식이 warn-sasc/list 에선 level-0). 따라서 excludedChildren 만으로 지우면 진짜 예비 자식까지
//     오삭제된다. → 이번 사이클 실제 row(snap.liveChildren: warn-sasc/list 발효 + warn-sasc/ready
//     예비 + warn/ready 자식형 + latest/ef 자식 통보문)로 들어온 자식은 항상 보존(화이트리스트).
//   - 게이트 소스는 warn-sasc/list 단독(excludedChildren). latest 로 넓히면 분별력이 없어 부적합.
//   - carry 글리치 방어(adab23e) 보존: 글리치(잠깐 row 부재)는 level-0 명시가 아니라 *부재*라
//     excludedChildren 에 안 들어옴 → 디바운스 carry 유지(무영향).
//   - 결과적으로 제거되는 건 "list level-0 명시 제외 + 이번 사이클 어떤 라이브 row 도 없음 +
//     prev carry/synth 로만 존재" = 통보문상 명백히 제외된 유령 자식뿐.
// ============================================================================
function _purgeExcludedChildren(snap) {
    if (!snap || !snap.children || !snap.excludedChildren || snap.excludedChildren.size === 0) return 0;
    const live = snap.liveChildren instanceof Set ? snap.liveChildren : new Set();
    let purged = 0;
    for (const [parent, kids] of snap.children) {
        for (const childName of Array.from(kids.keys())) {
            if (!snap.excludedChildren.has(childName)) continue;   // list level-0 제외 명시 아님 → 보존
            if (live.has(childName)) continue;                     // 이번 사이클 라이브 근거 있음 → 보존(예비 자식 등)
            kids.delete(childName);
            purged++;
            console.log(`[Marine] 제외 자식 사후정리: ${parent} > ${childName} (warn-sasc/list level-0 명시 제외 + 라이브 근거 없음 → 유령 제거)`);
        }
        if (kids.size === 0) snap.children.delete(parent);
    }
    return purged;
}

// ============================================================================
// [발표시각 고정] 발표시각(tmFc)은 "현재 발효중 특보가 최초 발표된 시각"으로 고정.
//   예비→발표→발효→해제 동안 불변(변경/연장에도 안 바뀜). 격상/격하(등급 변화)·
//   종류 변화·해제 시에만 새 등급의 발표시각으로 재설정.
//   구현: 직전 cycle(prev, 디스크 영속)에 같은 종류·동급(예비는 정식의 전구체로 동급
//   취급)이 있으면 그 tmFc 를 이어받아 고정. 신규/격상격하/종류변경이면 현재 tmFc 가 새 앵커.
//   별도 저장소 불필요 — 고정값이 스냅샷 체인(marine_warning_state.json)에 그대로 영속.
//   [한계] 예비 단계를 못 본 채(콜드스타트) 발효부터 관측하면 그때 tmFc 가 앵커(best-effort).
// ============================================================================
function _anchorLevel(info) {
    return (info && info.wrnLvlNm === '경보') ? '경보' : '주의보';   // 예비·주의보 동급
}
function _applyAnnounceAnchor(prev, curr) {
    if (!curr) return;
    const carry = (pinfo, info) =>
        pinfo && pinfo.tmFc && pinfo.wrnTpNm === info.wrnTpNm &&
        // 예비는 정식특보의 전구체 → 어떤 등급으로 성숙해도 이어받음. 그 외엔 동급일 때만.
        (pinfo.wrnLvlNm === '예비' || _anchorLevel(pinfo) === _anchorLevel(info));
    if (curr.parents) {
        for (const [zone, info] of curr.parents) {
            if (!info || !info.wrnLvlNm || info.wrnLvlNm === '해제') continue;
            const pinfo = prev && prev.parents ? prev.parents.get(zone) : null;
            if (carry(pinfo, info)) { info.tmFc = pinfo.tmFc; continue; }   // 직전 고정값 이어받기
            // [B] 격상/격하 발효: 직전에 공존하던 예비(upcomings)는 새 발효 등급의 전구체이므로
            //   그 예비의 발표시각을 이어받음 (예비는 wrnLvlNm 이 '예비'라 등급 인코딩이 없어
            //   같은 종류이면 인계). 경보 예비 → 경보 발효 시 경보 최초(예비) 발표시각 유지.
            const pUp = prev && prev.upcomings ? prev.upcomings.get(zone) : null;
            if (pUp && pUp.tmFc && pUp.wrnTpNm === info.wrnTpNm) {
                info.tmFc = pUp.tmFc;
                continue;
            }
            // [핸드오프 공백] 예비가 잠깐 사라졌다 발표대기로 재등장한 경우 — prev 체인이 끊겨도
            //   최근(5분 내) 기억의 발표시각으로 고정 유지 (해제 후 한참 뒤 새 특보는 제외).
            const e = _extensionMemory[zone];
            const mem = e && (info.wrnLvlNm === '예비' ? e.upcoming : e.active);
            if (mem && mem.tmFc && mem.wrnTpNm === info.wrnTpNm &&
                (Date.now() - (mem.lastSeenAt || 0)) < EXTENSION_BRIDGE_MS) {
                info.tmFc = mem.tmFc;
            }
        }
    }
    // [B] 공존 다가오는(예비) 도 자기 최초 발표시각 고정
    if (curr.upcomings) {
        for (const [zone, info] of curr.upcomings) {
            if (!info || !info.wrnLvlNm) continue;
            const pUp = prev && prev.upcomings ? prev.upcomings.get(zone) : null;
            if (carry(pUp, info)) info.tmFc = pUp.tmFc;
        }
    }
    if (curr.children) {
        for (const [zone, cmap] of curr.children) {
            const pmap = prev && prev.children ? prev.children.get(zone) : null;
            for (const [cn, info] of cmap) {
                if (!info || !info.wrnLvlNm) continue;
                const pinfo = pmap ? pmap.get(cn) : null;
                if (carry(pinfo, info)) info.tmFc = pinfo.tmFc;
            }
        }
    }
}

// ============================================================================
// [연장 감지] 발효예정/해제예정 시각이 "더 늦은 시각"으로 연장되는 경우 감지.
//   - 주(主): diff 기반 — 같은 zone·종류, 같은 단계(예비/발효)인데 해당 시각이
//     더 늦어짐(_timeKey 비교) → 연장.
//   - null gap 대응: 예비 onset 이 지나 목록에서 잠깐 빠졌다가 연장 재등록되는 경우,
//     prev 가 비어 "신규 발표"로 오인되므로 _extensionMemory(직전 특보 짧은 기억)로 보강.
// ============================================================================
const EXTENSION_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;   // 6시간 retention
const EXTENSION_BRIDGE_MS = 5 * 60 * 1000;            // 핸드오프 공백 복원 허용 시간(예비→발표대기)
let _extensionMemory = {};   // zone → { upcoming|active: { wrnTpNm, wrnLvlNm, tmFc, tmEf, clrNtcTm, lastSeenAt } }

/** mmis 시각 문자열 → 비교용 정수키 (월·일·시·분). 해석 불가 시 null. refMonth: 월 미기재 시 기준월.
 *  rangeUseStart=true 면 범위형의 시작 시각을 사용(기본은 끝 시각). */
function _timeKey(str, refMonth, rangeUseStart) {
    if (!str) return null;
    let s = String(str).replace(/&#40;/g, '(').replace(/&#41;/g, ')').replace(/&nbsp;/g, ' ').trim();
    let mo = null, d = null, hh = null, mm = 0, m;
    if (m = s.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/)) { mo = +m[2]; d = +m[3]; }
    else if (/^\d{12}$/.test(s)) { mo = +s.slice(4, 6); d = +s.slice(6, 8); hh = +s.slice(8, 10); mm = +s.slice(10, 12); }
    else if (m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) { mo = +m[1]; d = +m[2]; }
    else if (m = s.match(/(\d{1,2})\s*일/)) { d = +m[1]; }
    if (hh == null) {
        let hm;
        // 범위형("21시~24시","00~06시")은 일관되게 끝 시각 사용 (rangeUseStart 면 시작 시각)
        if (hm = s.match(/(\d{1,2})\s*시?\s*[~∼]\s*(\d{1,2})\s*시?/)) { hh = rangeUseStart ? +hm[1] : +hm[2]; }
        else if (hm = s.match(/(\d{1,2}):(\d{2})/)) { hh = +hm[1]; mm = +hm[2]; }
        else if (hm = s.match(/(\d{1,2})\s*시/)) { hh = +hm[1]; }
    }
    if (d == null || hh == null) return null;
    if (mo == null) mo = refMonth || (new Date(Date.now() + 9 * 3600000).getUTCMonth() + 1);
    if (hh === 24) { hh = 0; d += 1; }   // 24시 = 다음날 00시 정규화 (범위 끝 ↔ 정확 00시 비교용)
    return mo * 1000000 + d * 10000 + hh * 100 + mm;
}

/** 두 시각이 "같은 해제/발효 모멘트"인지 — 범위형의 끝 시각과 정확시각이 같으면 동일로 봄.
 *  (예: "26일 21시~24시" 의 끝 24시 = "27일 00시" → 같은 모멘트). warn/latest 휘발성으로
 *  범위↔정확이 깜빡여도 같은 시각이면 변경으로 보지 않아 가짜 푸시 방지. */
function _sameReleaseMoment(a, b) {
    if (!a || !b) return false;
    const ka = _timeKey(a), kb = _timeKey(b);
    return ka != null && kb != null && ka === kb;
}

/** 범위형 시각인지 (예: "21시~24시", "00~06시"). 정확시각("27일 00시","2026.05.27 00:00")은 false.
 *  [연장 규칙] 연장은 "범위형 → 더 늦은 범위형" 일 때만. 정확시각으로 바뀌면 연장 아님(시각 변경). */
function _isRangeTime(str) {
    return /[~∼]/.test(String(str || ''));
}

// ============================================================================
// [발효/해제 예정시각 고정 + 연장 판별] (공통)
//   - "윈도우"(처음 확립된 범위의 끝 시각) 를 추적. 범위로만 확립/확장.
//   - 윈도우 안: 정확시각이 발표되면 고정(범위로 안 되돌림). MMIS 발효/해제 전까지 유지.
//     · [#1 핸드오프] 직전 스냅샷에 정확값이 없어도(1사이클 공백) 최근 기억(_extensionMemory)
//       에 정확값이 있으면 그 값으로 고정 → 공백 후 범위 재등장에도 가짜 푸시 방지.
//   - 윈도우 초과(원래 범위보다 늦음): 연장 플래그 → "발효/해제 예정시각 연장".
//   - [#2 자식] 자식 해역도 직전 정확값으로 고정 (표출 깜빡임 방지; 윈도우/연장은 부모만).
//   - 미해당(소멸/단계변경): 윈도우 정리. _buildUserPushChanges 보다 먼저 호출.
// ============================================================================
let _clrWindowEnd = {};   // zone → 해제 윈도우 끝 시각키
let _efWindowEnd = {};    // zone → 발효 윈도우 끝 시각키 (예비/발표대기)
// [표시형 보존] zone → 같은 모멘트의 "범위형" 표시 문자열. 비교용 정확값(info[field])과
//   별개로, 화면 표출은 KMA 통보문과 동일한 범위형(예: "새벽(00시~06시)")을 우선·고정한다.
//   warn/latest 가 범위↔정확을 깜빡여도 표시는 범위형으로 안정(깜빡임 없음), 비교/푸시는 정확값 유지.
let _clrRangeDisp = {};   // 해제예정 표시용 범위
let _efRangeDisp = {};    // 발효예정 표시용 범위

function _applyTimeWindowHold(prev, curr, cfg) {
    if (!curr) return;
    const seen = new Set();
    const proc = (zone, info, prevInfo) => {
        if (!cfg.matchParent(info)) return;
        seen.add(zone);
        const incoming = info[cfg.field];
        if (!incoming) return;
        // [#1] held 정확값: 직전 스냅샷 우선, 없으면 최근(5분) 기억 — 핸드오프 공백 견딤
        let held = (prevInfo && prevInfo[cfg.field] && !_isRangeTime(prevInfo[cfg.field])) ? prevInfo[cfg.field] : null;
        if (!held) {
            const m = _extensionMemory[zone] && _extensionMemory[zone][cfg.phase];
            if (m && m[cfg.field] && !_isRangeTime(m[cfg.field]) && (Date.now() - (m.lastSeenAt || 0)) < EXTENSION_BRIDGE_MS) held = m[cfg.field];
        }
        const incKey = _timeKey(incoming);
        const isRange = _isRangeTime(incoming);
        const win = cfg.winMap[zone];
        if (win != null && incKey != null && incKey > win) {
            // 윈도우(원래 범위 끝) 초과 → 연장
            info[cfg.flag] = { oldTime: held || (prevInfo && prevInfo[cfg.field]) || '', newTime: incoming };
            cfg.winMap[zone] = incKey;
        } else {
            if (win == null && isRange && incKey != null) cfg.winMap[zone] = incKey;   // 윈도우는 범위로만 확립
            if (held && isRange) info[cfg.field] = held;   // [#1] 정확값 고정 (공백/확립 시에도)
        }
        // [표시형 보존] 비교용 정확값(info[field])과 별개로, 화면 표출은 통보문과 동일한
        //   범위형을 우선·고정한다. 범위형은 그대로 기억/표시, 정확값이 와도 같은 모멘트면
        //   기억된 범위로 표시(sticky) → 깜빡임 없음. 윈도우 초과(연장=새 모멘트)면 폐기.
        const dispKey = cfg.field + 'Disp';
        if (isRange) {
            cfg.rangeMap[zone] = incoming;
            info[dispKey] = incoming;
        } else if (cfg.rangeMap[zone]) {
            // [수정] 정확값이 기억된 범위의 [시작,끝] 구간 안(=같은 모멘트)일 때만 범위형 유지(깜빡임 방지).
            //   구간 밖(시각이 앞당겨지거나 연장돼 다른 모멘트가 됨)이면 범위 폐기 → 정확값으로 표출 갱신.
            //   (기존 결함: incKey>win '연장(늦어짐)'만 폐기하고, 앞당겨진 경우는 옛 범위에 고착돼
            //    푸시는 새 발효시각을 알리는데 화면은 안 갱신되던 문제.)
            const rng = cfg.rangeMap[zone];
            const startK = _timeKey(rng, null, true);   // 범위 시작 시각키
            const endK = _timeKey(rng);                  // 범위 끝 시각키
            if (startK != null && endK != null && incKey != null && (incKey < startK || incKey > endK)) {
                delete cfg.rangeMap[zone];               // 키 산출 가능 + 구간 밖(앞당김/연장) → 폐기, 정확값 표시
                // [winMap 동기화] 앞당김(구간보다 이름)이면 연장 기준선(winMap)도 함께 폐기 —
                //   stale 윈도우로 이후 정확값이 가짜 '연장(_efExtend/_clrExtend)'으로 오발사되는 것 방지.
                //   늦춰짐(incKey>endK)은 상위 블록이 winMap 갱신·연장 플래그를 이미 처리하므로 손대지 않음.
                if (incKey < startK) delete cfg.winMap[zone];
            } else {
                // 같은 모멘트(구간 안), 또는 키 산출 불가(날짜 없는 범위 등)이면 범위형 유지.
                //   후자에서 무조건 폐기하면 #818 이 막던 '동일 모멘트 깜빡임'이 재유입되므로 안전하게 sticky.
                info[dispKey] = rng;
            }
        }
    };
    if (curr.parents) for (const [z, info] of curr.parents) {
        proc(z, info, prev && prev.parents ? prev.parents.get(z) : null);
    }
    if (cfg.includeUpcomings && curr.upcomings) for (const [z, info] of curr.upcomings) {
        const p = (prev && prev.upcomings && prev.upcomings.get(z)) || (prev && prev.parents && prev.parents.get(z)) || null;
        proc(z, info, p);
    }
    // [#2] 자식 해역 정확값 고정 (직전 정확 + 이번 범위 → 유지). 윈도우/연장 없음.
    if (curr.children) for (const [z, cm] of curr.children) {
        const pm = prev && prev.children ? prev.children.get(z) : null;
        if (!pm) continue;
        for (const [cn, info] of cm) {
            if (!cfg.matchChild(info)) continue;
            const pInfo = pm.get(cn);
            const cv = info[cfg.field];
            if (pInfo && pInfo[cfg.field] && !_isRangeTime(pInfo[cfg.field]) &&
                cv && _isRangeTime(cv) && pInfo.wrnTpNm === info.wrnTpNm) {
                info[cfg.field + 'Disp'] = cv;          // [표시형] 자식도 범위형 표시 보존
                info[cfg.field] = pInfo[cfg.field];     // 비교용 정확값 고정
            }
        }
    }
    for (const z of Object.keys(cfg.winMap)) if (!seen.has(z)) delete cfg.winMap[z];
    for (const z of Object.keys(cfg.rangeMap)) if (!seen.has(z)) delete cfg.rangeMap[z];
}

function _applyReleaseClrLogic(prev, curr) {
    _applyTimeWindowHold(prev, curr, {
        field: 'clrNtcTm', phase: 'active', winMap: _clrWindowEnd, rangeMap: _clrRangeDisp, flag: '_clrExtend',
        matchParent: (i) => !!(i && i.wrnLvlNm && i.wrnLvlNm !== '예비' && i.wrnLvlNm !== '해제'),
        matchChild: (i) => !!(i && i.wrnLvlNm && i.wrnLvlNm !== '예비' && i.wrnLvlNm !== '해제'),
        includeUpcomings: false
    });
}
function _applyUpcomingEfLogic(prev, curr) {
    _applyTimeWindowHold(prev, curr, {
        field: 'tmEf', phase: 'upcoming', winMap: _efWindowEnd, rangeMap: _efRangeDisp, flag: '_efExtend',
        matchParent: (i) => !!(i && i.wrnLvlNm === '예비'),
        matchChild: (i) => !!(i && i.wrnLvlNm === '예비'),
        includeUpcomings: true
    });
}

// ============================================================================
// [발효/해제 예정시각 변경 디바운스] 새 시각값이 3분(연속) 유지될 때만 변경/연장 푸시 발송.
//   값이 진동(A→B→A)하면 확정 안 되어 푸시 억제 — warn/latest 가 값을 흔들거나 5분+ 공백
//   복귀 등 잔여 오실레이션까지 차단. 확정 전엔 직전 확정값으로 되돌려(표출·푸시 억제) +
//   연장 플래그도 제거. 최초값(신규 발표/발효)은 즉시 수락(디바운스 안 함).
//   _applyTimeWindowHold(고정) 이후, _buildUserPushChanges 이전에 호출.
// ============================================================================
const TIME_CHANGE_DEBOUNCE_MS = 3 * 60 * 1000;   // 3분
// [§7.7.21] 자식 키("zone>자식|field")는 1사이클 부재(purge/드롭아웃)로 관찰 상태가 리셋되지
//   않도록 유예를 둔다 — 부모 키는 기존대로 미관측 즉시 정리(특보 종료 시 상태 리셋 보존).
const TC_CHILD_GRACE_MS = 10 * 60 * 1000;
let _tcConfirmed = {};   // key "zone|field" (부모) · "zone>자식|field" (자식) → 확정 시각값
let _tcPending = {};      // 동일 키 → { value, since }
let _tcChildSeenAt = {};  // 자식 키 → 마지막 관측 ts (유예 판정용)

/** [§7.7.21] 확정적으로 끝난(해제/취소 발사) 자식의 시각 관찰 상태를 능동 폐기 — 10분 유예가
 *  stale 확정값을 붙잡아, 유예 내 동명 자식 재등장(새 특보) 시 옛 시각으로 롤백·오표기하는
 *  것을 차단한다(회귀검증 A-6). 유예는 "1사이클 깜빡임" 전용으로만 남긴다. */
function _tcInvalidateChild(zone, childName) {
    for (const f of ['tmEf', 'clrNtcTm']) {
        const k = zone + '>' + childName + '|' + f;
        delete _tcConfirmed[k]; delete _tcPending[k]; delete _tcChildSeenAt[k];
    }
}
function _debounceTimeValues(curr) {
    if (!curr) return;
    const now = Date.now();
    const seen = new Set();
    const gate = (keyBase, info, field, flag) => {
        const cur = info[field];
        const key = keyBase + '|' + field;
        if (!cur) {
            // [자식 키] 값이 명시적으로 빈값(철회)이면 관찰 상태를 즉시 폐기 — 부모(미관측 즉시
            //   정리)와 동일 동작 복원. 유예는 "행 자체가 잠깐 사라진" 경우만 보호(그땐 gate
            //   호출 자체가 없음). 이게 없으면 철회→유예 내 새 값 도래 시 철회된 옛 값으로
            //   롤백되어 ''→옛값 오발 후 3분 뒤 2건째가 나간다(회귀검증 A-6-2).
            if (keyBase.indexOf('>') !== -1) {
                delete _tcConfirmed[key]; delete _tcPending[key]; delete _tcChildSeenAt[key];
            }
            return;
        }
        seen.add(key);
        const conf = _tcConfirmed[key];
        if (conf == null) { _tcConfirmed[key] = cur; delete _tcPending[key]; return; }   // 최초 수락
        if (cur === conf || _sameReleaseMoment(cur, conf)) { delete _tcPending[key]; return; }   // 변화 없음
        // 값이 달라짐 → 디바운스
        const p = _tcPending[key];
        if (p && (p.value === cur || _sameReleaseMoment(p.value, cur))) {
            if (now - p.since >= TIME_CHANGE_DEBOUNCE_MS) {
                _tcConfirmed[key] = cur; delete _tcPending[key];   // 3분 유지 → 확정 (이번 사이클 푸시 허용)
                return;
            }
        } else {
            _tcPending[key] = { value: cur, since: now };   // 새 후보 (타이머 리셋)
        }
        info[field] = conf;                 // 미확정 → 직전 확정값으로 되돌려 푸시·표출 억제
        if (flag && info[flag]) delete info[flag];   // 연장 플래그도 보류
    };
    if (curr.parents) for (const [zone, info] of curr.parents) {
        if (!info || !info.wrnLvlNm || info.wrnLvlNm === '해제') continue;
        if (info.wrnLvlNm === '예비') gate(zone, info, 'tmEf', '_efExtend');
        else gate(zone, info, 'clrNtcTm', '_clrExtend');
    }
    if (curr.upcomings) for (const [zone, info] of curr.upcomings) {
        if (info && info.wrnLvlNm === '예비') gate(zone, info, 'tmEf', '_efExtend');
    }
    // [§7.7.21] 자식 시각값도 동일 3분 관찰 — 부모만 관찰하던 비대칭 탓에 통보문 1건의
    //   부모+자식 동시 시각변경/연장이 "자식 즉발 + 부모 3분후" 2건으로 갈라지고(2026-07-08
    //   해제시각 실사고 3건), 자식 값 진동이 무제한 재푸시되던 문제 해소. 부모와 같은
    //   사이클에 확정되면 그 사이클엔 부모 변경으로 자식 독립 블록이 스킵되어 부모 푸시
    //   1건(자식 한정사 "포함")이 자연 대표. 자식만 변한 경우엔 3분 뒤 자식 전용 푸시.
    //   (자식엔 _efExtend/_clrExtend 플래그가 없어 flag=null.)
    if (curr.children) for (const [zone, kids] of curr.children) {
        for (const [cn, info] of kids) {
            if (!info || !info.wrnLvlNm || info.wrnLvlNm === '해제') continue;
            if (info.wrnLvlNm === '예비') gate(zone + '>' + cn, info, 'tmEf', null);
            else gate(zone + '>' + cn, info, 'clrNtcTm', null);
        }
    }
    for (const k of seen) if (k.indexOf('>') !== -1) _tcChildSeenAt[k] = now;
    for (const k of Object.keys(_tcConfirmed)) {
        if (seen.has(k)) continue;
        if (k.indexOf('>') !== -1 && now - (_tcChildSeenAt[k] || 0) <= TC_CHILD_GRACE_MS) continue;   // 자식 유예
        delete _tcConfirmed[k];
    }
    for (const k of Object.keys(_tcPending)) {
        if (seen.has(k)) continue;
        if (k.indexOf('>') !== -1 && now - (_tcChildSeenAt[k] || 0) <= TC_CHILD_GRACE_MS) continue;   // 자식 유예
        delete _tcPending[k];
    }
    for (const k of Object.keys(_tcChildSeenAt)) {
        if (now - _tcChildSeenAt[k] > TC_CHILD_GRACE_MS) delete _tcChildSeenAt[k];
    }
}

/** run() 에서 매 cycle 호출 — 현재 특보 기억 갱신 + 만료 prune. (_buildUserPushChanges 이후)
 *   zone 별로 phase(active/upcoming) 각각 보관 — 발효+공존예비를 동시에 기억(B 트랙 포함). */
function _updateExtensionMemory(curr) {
    const now = Date.now();
    const rec = (zone, info, phase) => {
        if (!info || !info.wrnLvlNm || info.wrnLvlNm === '해제') return;
        if (!_extensionMemory[zone]) _extensionMemory[zone] = {};
        _extensionMemory[zone][phase] = {
            wrnTpNm: info.wrnTpNm || '', wrnLvlNm: info.wrnLvlNm || '',
            tmFc: info.tmFc || '',   // [핸드오프] 발표시각 고정값 — 공백 후 복원용
            tmEf: info.tmEf || '', clrNtcTm: info.clrNtcTm || info.tmYn || '',
            lastSeenAt: now
        };
    };
    if (curr && curr.parents) {
        for (const [zone, info] of curr.parents) {
            rec(zone, info, info.wrnLvlNm === '예비' ? 'upcoming' : 'active');
        }
    }
    if (curr && curr.upcomings) {
        for (const [zone, info] of curr.upcomings) rec(zone, info, 'upcoming');   // [B] 공존 예비도 기억
    }
    for (const z of Object.keys(_extensionMemory)) {
        const e = _extensionMemory[z];
        for (const ph of Object.keys(e)) {
            if (now - (e[ph].lastSeenAt || 0) > EXTENSION_MEMORY_TTL_MS) delete e[ph];
        }
        if (Object.keys(e).length === 0) delete _extensionMemory[z];
    }
}

function _buildUserPushChanges(prev, curr) {
    const changes = [];
    if (!prev || !curr) return changes;

    // [§7.7.19] 자식 예비취소 펜딩 TTL 정리 — 부모가 함께 소멸(부모 취소 푸시가 대표)해
    //   zone 루프에서 더 이상 평가되지 않는 잔존 펜딩을 조용히 폐기(발사 없음).
    for (const pk of Object.keys(_childPrelimCancelPending)) {
        if (Date.now() - _childPrelimCancelPending[pk].since > CHILD_PRELIM_CANCEL_TTL_MS) {
            delete _childPrelimCancelPending[pk];
        }
    }

    // [§7.7.20] 해제예고 확정 dedup 첫 실행 시드 — 이력 파일 부재(기능 첫 배포/볼륨 유실) 시
    //   현재 스냅샷에 이미 등록된 해제예고 통보문을 "알림 완료"로 간주(배포 직후 뒷북 푸시 방지).
    const _clrSeen = _loadClrConfirms();
    if (_clrConfirmsFirstRun) {
        if (curr.parents) for (const [sz, si] of curr.parents) {
            if (si && si._clrConfirmed && si._clrConfirmed.tmEf) {
                _clrSeen.set(_clrConfirmKey(sz, si, si._clrConfirmed.tmEf), Date.now());
            }
        }
        // 시드 0건이어도 빈 이력 파일을 1회 기록 — 파일 부재로 재시작마다 시드가 반복되어
        //   다운타임 중 발행된 통보문 confirm 까지 삼키는 창을 닫는다(구현검증 경미 #3).
        _clrConfirmsDirty = true;
        _clrConfirmsFirstRun = false;
    }

    const allZones = new Set();
    if (prev.parents) for (const k of prev.parents.keys()) allZones.add(k);
    if (curr.parents) for (const k of curr.parents.keys()) allZones.add(k);
    if (prev.upcomings) for (const k of prev.upcomings.keys()) allZones.add(k);
    if (curr.upcomings) for (const k of curr.upcomings.keys()) allZones.add(k);

    // [B] zone 의 다가오는(예비)/발효 추출 — parents 가 예비면 그것, 아니면 upcomings.
    const getUp = (snap, zone) => {
        const p = snap.parents ? snap.parents.get(zone) : null;
        if (p && p.wrnLvlNm === '예비') return p;
        return snap.upcomings ? (snap.upcomings.get(zone) || null) : null;
    };
    const getAct = (snap, zone) => {
        const p = snap.parents ? snap.parents.get(zone) : null;
        return (p && p.wrnLvlNm && p.wrnLvlNm !== '예비' && p.wrnLvlNm !== '해제') ? p : null;
    };

    const toBlock = (info) => info ? {
        // [B] 발효중 공존 격상/격하 예비는 wrnLvlReal(실제 등급)로 푸시 — push_sender 점수비교가
        //   active 대비 정확한 격상/격하 방향을 내도록. 평상시(wrnLvlReal 없음)는 기존과 동일.
        wrnTp: info.wrnTpNm || info.wrnTp || '',
        wrnLvl: info.wrnLvlReal || info.wrnLvlNm || info.wrnLvl || '',
        tmFc: info.tmFc || '',
        tmEf: info.tmEf || '',
        tmYn: info.tmYn || info.clrNtcTm || ''
    } : null;

    // 예비/발효 분리 헬퍼
    const isUpcoming = (info) => info && info.wrnLvlNm === '예비';
    const isActive = (info) => info && info.wrnLvlNm && info.wrnLvlNm !== '예비' && info.wrnLvlNm !== '해제';

    const blockEqual = (a, b) => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return a.wrnTp === b.wrnTp
            && a.wrnLvl === b.wrnLvl
            // 발효예정/해제예정: 범위↔정확이 같은 모멘트면 동일로 봄 (warn/latest 깜빡임 가짜 푸시 방지)
            && (a.tmEf === b.tmEf || _sameReleaseMoment(a.tmEf, b.tmEf))
            && (a.tmYn === b.tmYn || _sameReleaseMoment(a.tmYn, b.tmYn));
    };

    // [작업2b] 부모 zone 의 자식 한정사용 childState 구성.
    //   all    = 매핑상 전체 자식 (PARENT_TO_CHILDREN)
    //   active = 현재 발효/예비 자식 (curr.children 키)
    //   buildChildQualifier 가 이 둘로 "(연안바다 포함)/(미발효)" 등을 만든다.
    //   사용자 푸시는 토글(options.childZones) 켠 사용자에게만 한정사를 붙임.
    const childKeys = (snap, zone) => {
        const m = snap.children ? snap.children.get(zone) : null;
        return m ? Array.from(m.keys()) : [];
    };
    const childInfoOf = (snap, zone, name) => {
        const m = snap.children ? snap.children.get(zone) : null;
        return m ? m.get(name) : null;
    };
    // 자식 자신의 데이터로 푸시 블록 구성 (부모 비종속)
    const childToBlock = (info) => info ? {
        wrnTp: info.wrnTpNm || info.wrnTp || '',
        wrnLvl: info.wrnLvlNm || info.wrnLvl || '',
        tmFc: info.tmFc || '',
        tmEf: info.tmEf || '',
        tmYn: info.tmYn || info.clrNtcTm || ''
    } : null;

    for (const zone of allZones) {
        const c = curr.parents ? curr.parents.get(zone) : null;   // 자식 독립 블록 가드용(부모 존재)

        // [B] upcoming 은 parents 예비 또는 upcomings 에서, active 는 parents 에서 추출 (병렬 지원)
        const pUp = getUp(prev, zone), cUp = getUp(curr, zone);
        const pAct = getAct(prev, zone), cAct = getAct(curr, zone);
        if (!pUp && !cUp && !pAct && !cAct) continue;

        // [ef/list 보강 + 발송이력 dedup] ef/list 로만 잡힌 발표대기(_efBridged)는:
        //   - 발송이력에 이미 있으면(=warn/latest 등으로 이미 발표 푸시됨) → 재푸시 방지로 skip.
        //   - 이력에 없으면(=발표 순간을 통째로 놓쳐 ef/list 가 최초 포착) → 1회 발송 허용 + 기록.
        //   (발효시각 도래로 warn/list 발효 승격 시엔 _efBridged 아님 → 정식 발효 푸시 정상 발사.)
        let suppressUpcoming = false;                   // ef 보강 재푸시 방지(아래 upcoming emit 만 억제)
        if (cUp) {
            const pubs = _loadPushedPubs();
            const key = _pubKey(zone, cUp);
            const known = pubs.has(key);
            pubs.set(key, Date.now());                  // 최신 확인시각 갱신(메모리)
            if (cUp._efBridged && known) {
                // ef 보강 + 이미 발송됨 → 재푸시 방지. 단, 발효중 active 와 공존(격상/격하 발표대기)
                //   하는 경우엔 그 active 의 독립 변화(해제·해제예정시각·자식 추가/해제)는 계속
                //   처리해야 하므로 zone 전체 skip 대신 upcoming emit 만 억제한다. 순수 GAP
                //   (active 없음)은 기존대로 zone 전체 skip(부수효과 보존).
                if (cAct) suppressUpcoming = true;
                else continue;
            }
            if (!known) _pushedPubsDirty = true;        // 신규 통보문 → 이력 영속 저장 필요
            // (ef 보강 + 미발송 → 아래로 진행해 1회 발송 / 비-ef 실시간 발표 → 정상 진행)
        }

        let prevUpcoming = toBlock(pUp);
        const currUpcoming = toBlock(cUp);
        const prevActive = toBlock(pAct);
        const currActive = toBlock(cAct);

        // [핸드오프 공백] 예비가 잠깐 사라졌다 발표대기(예비)로 재등장 — prev 가 비어 "신규 발표"로
        //   오인되던 문제. 최근(5분 내) 기억의 직전 예비를 복원해 prev 를 채움 → push_sender 가
        //   "발표"가 아니라 "발효시각 변경"(또는 진짜 더 늦으면 연장)으로 보냄.
        if (!prevUpcoming && currUpcoming) {
            const e = _extensionMemory[zone];
            const mem = e && e.upcoming;
            if (mem && mem.wrnTpNm === currUpcoming.wrnTp &&
                (Date.now() - (mem.lastSeenAt || 0)) < EXTENSION_BRIDGE_MS) {
                prevUpcoming = {
                    wrnTp: mem.wrnTpNm, wrnLvl: mem.wrnLvlNm,
                    tmFc: mem.tmFc || '', tmEf: mem.tmEf || '', tmYn: mem.clrNtcTm || ''
                };
            }
        }

        const all = PARENT_TO_CHILDREN[zone] || [];
        const prevChildren = childKeys(prev, zone);
        const currChildren = childKeys(curr, zone);
        const childState = { all, active: currChildren, added: [], released: [] };
        // [2026-07-18 실사고] GAP 보강 부모(전이 창)의 자식 '미상' 전파 — 자식 목록이 비어 있어도
        //   "미발표 확정"이 아니므로 한정사 단정 금지 플래그를 싣는다 (push_helpers 가 소비).
        if (currChildren.length === 0 && ((cUp && cUp._childUnknown) || (cAct && cAct._childUnknown))) {
            childState.unknown = true;
        }

        // [§7.7.25] 범위형 → 정확시각 정밀화는 "같은 모멘트"(정확시각 = 범위 끝, 예: 06~12시 → 12시)
        //   여도 사용자에겐 새 정보(확정)다. blockEqual 의 동일모멘트 흡수를 이 경우에만 우회해
        //   1회 발사한다 — 해제측 §7.7.20(해제시각 확정)과 같은 취지. 흡수 규칙 자체는 불변.
        const efExactRefinedNow = !!(cUp && cUp._efExactFrom) &&
            !!prevUpcoming && _isRangeTime(prevUpcoming.tmEf || '') &&
            !!currUpcoming && !_isRangeTime(currUpcoming.tmEf || '');
        const upcomingChanged = !blockEqual(prevUpcoming, currUpcoming) || efExactRefinedNow;
        const activeChanged = !blockEqual(prevActive, currActive);

        // [연장 감지] 발효예정 연장 (예비 단계): 같은 종류·동급 예비인데 발효예정(tmEf)이 더 늦어짐.
        //   prev 가 있으면 prev 와, 없으면(null gap) _extensionMemory 의 직전 예비와 비교.
        let efExtend = null;
        if (currUpcoming) {
            let oldEf = prevUpcoming ? prevUpcoming.tmEf : null;
            let oldType = prevUpcoming ? prevUpcoming.wrnTp : null;
            let oldLevel = prevUpcoming ? prevUpcoming.wrnLvl : null;
            if (!oldEf) {
                const mem = _extensionMemory[zone] && _extensionMemory[zone].upcoming;
                if (mem) { oldEf = mem.tmEf; oldType = mem.wrnTpNm; oldLevel = mem.wrnLvlNm; }
            }
            if (oldEf && currUpcoming.tmEf) {
                const kn = _timeKey(currUpcoming.tmEf), ko = _timeKey(oldEf, kn ? Math.floor((kn / 1000000)) : null);
                const sameType = !oldType || oldType === currUpcoming.wrnTp;
                const sameLevel = !oldLevel || oldLevel === currUpcoming.wrnLvl;   // 예비 단계는 항상 '예비'
                const bothRange = _isRangeTime(oldEf) && _isRangeTime(currUpcoming.tmEf);   // 범위→범위만 연장
                if (ko != null && kn != null && kn > ko && sameType && sameLevel && bothRange && oldEf !== currUpcoming.tmEf) {
                    efExtend = { oldTime: oldEf, newTime: currUpcoming.tmEf };
                }
            }
            // [발효 윈도우 초과 연장] _applyUpcomingEfLogic 가 표시한 플래그 — 고정된 정확시각에서
            //   원래 범위를 넘어선 발효시각이 나온 경우 (정확→범위/정확 모두).
            const cUpInfo = getUp(curr, zone);
            if (!efExtend && cUpInfo && cUpInfo._efExtend) {
                const e = cUpInfo._efExtend;
                const pUpInfo = getUp(prev, zone);
                if (!pUpInfo || pUpInfo.wrnTpNm === cUpInfo.wrnTpNm) {
                    efExtend = { oldTime: e.oldTime || (prevUpcoming && prevUpcoming.tmEf) || '', newTime: e.newTime };
                }
            }
        }
        // [연장 감지] 해제예정 연장 (발효 단계): 같은 종류·동급 발효인데 해제예정(tmYn)이 더 늦어짐.
        //   [중요] 등급(level)이 다르면 연장이 아니라 격상/격하 → 연장으로 오분류하면 격상/격하
        //   푸시가 사라지므로 반드시 동급일 때만 연장으로 본다.
        let ynExtend = null;
        if (currActive && currActive.tmYn) {
            let oldYn = prevActive ? prevActive.tmYn : null;
            let oldType = prevActive ? prevActive.wrnTp : null;
            let oldLevel = prevActive ? prevActive.wrnLvl : null;
            if (!oldYn) {
                const mem = _extensionMemory[zone] && _extensionMemory[zone].active;
                if (mem) { oldYn = mem.clrNtcTm; oldType = mem.wrnTpNm; oldLevel = mem.wrnLvlNm; }
            }
            if (oldYn) {
                const kn = _timeKey(currActive.tmYn), ko = _timeKey(oldYn, kn ? Math.floor((kn / 1000000)) : null);
                const sameType = !oldType || oldType === currActive.wrnTp;
                const sameLevel = !!oldLevel && oldLevel === currActive.wrnLvl;   // 등급 변하면 연장 아님(격상격하)
                const bothRange = _isRangeTime(oldYn) && _isRangeTime(currActive.tmYn);   // 범위→범위만 연장(정확시각이면 시각변경)
                if (ko != null && kn != null && kn > ko && sameType && sameLevel && bothRange && oldYn !== currActive.tmYn) {
                    ynExtend = { oldTime: oldYn, newTime: currActive.tmYn };
                }
            }
            // [해제 윈도우 초과 연장] _applyReleaseClrLogic 가 표시한 플래그 — 고정된 정확시각에서
            //   원래 범위를 넘어선 해제시각이 나온 경우 (정확→범위/정확 모두). 종류·동급일 때만.
            const cActInfo = getAct(curr, zone);
            if (!ynExtend && cActInfo && cActInfo._clrExtend) {
                const e = cActInfo._clrExtend;
                const pAct2 = getAct(prev, zone);
                if (!pAct2 || (pAct2.wrnTpNm === cActInfo.wrnTpNm && pAct2.wrnLvlNm === cActInfo.wrnLvlNm)) {
                    ynExtend = { oldTime: e.oldTime || (prevActive && prevActive.tmYn) || '', newTime: e.newTime };
                }
            }
        }

        // UPCOMING_CHANGE — 예비특보 변화. 연장이면 EF_EXTEND 로 대체 (신규 "발표" 오인 방지).
        //   suppressUpcoming(ef 공존 재푸시 방지)면 upcoming 계열 emit 만 건너뛰고 아래 active/자식은 처리.
        if (suppressUpcoming) {
            // 공존 예비 재푸시 억제 — UPCOMING 푸시(발표/연장/취소)만 생략
        } else if (efExtend) {
            changes.push({
                type: 'EF_EXTEND', zone: zone, curr: currUpcoming,
                oldTime: efExtend.oldTime, newTime: efExtend.newTime, childState
            });
        } else if (upcomingChanged) {
            // [예비특보 취소] 예비가 사라졌는데(curr=null) 발효(active)로 승격된 것도 아니면
            //   → 취소 "후보". [§7.7.23] 풍랑·태풍은 즉시 발사하지 않고 판정 보류실에 등록,
            //   통보문 취소 문구로 확인된 뒤에만 발사한다 (오보 3건: 만료 소멸·발표 전환 차단).
            //   그 외 종류는 스캐너 정규식 대상 밖이라 기존 즉시 발사 유지.
            //   (발효 승격이면 currActive 가 차므로 아래 CURRENT_CHANGE 발효 푸시로 처리됨.)
            if (!currUpcoming && prevUpcoming && !currActive) {
                // 스캐너 로드 실패 시에도 등록한다 — "취소는 통보문 확인 후에만" 원칙 유지,
                //   (c) 확인이 불가하면 TTL 무푸시로 닫힌다 (구식 즉발 복귀 없음).
                if (CANCEL_VERDICT_TYPES.indexOf(prevUpcoming.wrnTp) !== -1) {
                    _registerParentCancelVerdict(zone, prevUpcoming);
                } else {
                    changes.push({ type: 'UPCOMING_CANCEL', zone: zone, prev: prevUpcoming, childState });
                }
                // [§7.7.21] 부모 예비 종료 = 데이터상 특보 종료 — 자식 시각 관찰 상태는 푸시 보류와
                //   무관하게 "지금" 일괄 폐기 (유예 내 동명 재발표 시 stale 확정값 롤백 방지,
                //   회귀검증 M-1 · §7.7.23 함정5: 청소를 미루면 새 특보 발표가 "변경"으로 오알림).
                for (const cn of prevChildren) _tcInvalidateChild(zone, cn);
            } else {
                // [5차 전수열거 발견1] 예비 소멸인데 남아있는 발효가 "다른 종류"면 승격이 아니다 —
                //   (태풍 예비 소멸 + 풍랑 주의보 발효 등) 기존엔 등록 게이트(!currActive)가 종류
                //   무관으로 막아 취소 판정이 무보류·무로그로 증발(침묵)했다. 보류 등록을 추가하되
                //   기존 UPCOMING_CHANGE(curr=null, push_sender 가 무시하는 no-op) emit 은 그대로
                //   두어 비취소 출력의 차분 동일성을 보존한다. (같은 종류 발효 = 승격 → 미등록 유지.
                //   자식 시각 관찰 폐기는 하지 않음 — 남은 타종류 특보의 자식 관찰을 해치지 않도록.)
                if (!currUpcoming && prevUpcoming && currActive && currActive.wrnTp !== prevUpcoming.wrnTp
                    && CANCEL_VERDICT_TYPES.indexOf(prevUpcoming.wrnTp) !== -1) {
                    _registerParentCancelVerdict(zone, prevUpcoming);
                }
                changes.push({
                    type: 'UPCOMING_CHANGE',
                    zone: zone,
                    prev: prevUpcoming,
                    curr: currUpcoming,
                    currentActive: currActive || null,  // 현재 발효 중인 부모 (격상/격하 판정용)
                    childState                           // [작업2b] 자식 한정사용
                });
            }
        }

        // CURRENT_CHANGE — 발효 변화. 해제예정 연장이면 YN_EXTEND 로 대체.
        if (ynExtend) {
            changes.push({
                type: 'YN_EXTEND', zone: zone, curr: currActive,
                oldTime: ynExtend.oldTime, newTime: ynExtend.newTime, childState
            });
        } else if (activeChanged) {
            changes.push({
                type: 'CURRENT_CHANGE',
                zone: zone,
                prev: prevActive,
                curr: currActive,
                childState                           // [작업2b] 자식 한정사용
            });
            // [§7.7.21] 부모 해제(발효 소멸) = 특보 종료 — 자식 시각 관찰 상태도 일괄 폐기
            //   (유예 내 동명 재발표 시 stale 확정값이 새 특보 시각을 덮는 것 방지, 회귀검증 M-1).
            if (!currActive) {
                for (const cn of prevChildren) _tcInvalidateChild(zone, cn);
            }
        }

        // [해제예고 확정 — CLR_CONFIRM] (§7.7.20) 정식 해제 통보문(warn/latest cmd='해제')이
        //   해제시각을 확정 등록했는데 그 시각이 기존 해제예정 범위와 "같은 모멘트"
        //   (예: "…21시~24시" ↔ "익일 00:00", _timeKey 동일)라 blockEqual/_debounceTimeValues 의
        //   깜빡임 흡수에 걸려 무푸시가 되던 빈틈(2026-07-01 제7-4호 사고)을 메운다.
        //   warn/list 의 tm_yn 이 채워져 clrNtcTm 변화가 diff 에 안 보이는 갈래(M2)도 커버.
        //   - 통보문 모멘트 키 단위 영속 dedup(_clrConfirms) → 매사이클 재유입·재시작에도 1회만.
        //   - 이번 사이클 CURRENT_CHANGE/YN_EXTEND 가 발사되면(시각 진짜 변경/연장 등) 그 푸시가
        //     대표 → 키만 기록하고 발사 생략(이중발송 차단).
        //   - 디바운스 미확정(새 모멘트 3분 관찰중 — clrNtcTm 이 직전 확정값으로 롤백된 상태)엔
        //     모멘트 불일치로 발사 보류 → 관찰 확정 시 CURRENT_CHANGE(time_yn_change)가 담당.
        const cActClr = getAct(curr, zone);
        if (cActClr && cActClr._clrConfirmed && cActClr._clrConfirmed.tmEf && currActive) {
            const ck = _clrConfirmKey(zone, cActClr, cActClr._clrConfirmed.tmEf);
            if (!_clrSeen.has(ck)) {
                if (activeChanged || ynExtend) {
                    _clrSeen.set(ck, Date.now()); _clrConfirmsDirty = true;   // 기존 이벤트가 대표 — 기록만
                } else if ((cActClr.clrNtcTm || '') === cActClr._clrConfirmed.tmEf ||
                           _sameReleaseMoment(cActClr.clrNtcTm || '', cActClr._clrConfirmed.tmEf)) {
                    changes.push({
                        type: 'CLR_CONFIRM', zone: zone, curr: currActive,
                        newTime: cActClr._clrConfirmed.tmEf, childState
                    });
                    _clrSeen.set(ck, Date.now()); _clrConfirmsDirty = true;
                }
            }
        }

        // [자식 독립 푸시] 부모 블록이 둘 다 안 변했을 때만 — 자식만 추가/해제된 경우 별도 1건.
        //   부모와 동시 이동(발표/발효)은 위 부모 푸시 + 자식 한정사로 이미 처리되므로 중복 방지.
        //   원칙: 자식은 부모 특보 없이 못 옴 → 부모가 현재 존재(c)할 때만 의미.
        //   added/released 는 자식 자신의 데이터로 메시지 구성 (부모 비종속).
        if (!upcomingChanged && !activeChanged && c) {
            const addedChildren = currChildren.filter(x => !prevChildren.includes(x));
            const releasedChildren = prevChildren.filter(x => !currChildren.includes(x));
            // [자식 예비 보존] 자식도 부모와 동일하게 발표(예비)/발효 lifecycle 을 갖는다.
            //   신규 등장 자식을 등급으로 분기:
            //     · 예비(미발효)      → CHILD_PRELIM_ADD ("발표(예비)") — "추가 발효"로 오발사 금지.
            //     · 주의보/경보(발효) → CHILD_ADD ("추가 발효").
            //   snapshot(snap.children, _rowToChildInfo)은 wrnLvlNm='예비'를 보존하므로 여기서 분별 가능
            //   하다. weather_alerts 트리의 '예비→주의보' 정규화는 표출 dedup 용일 뿐 snapshot 엔 무관.
            const childLvl = (snap, name) => {
                const info = childInfoOf(snap, zone, name);
                return info ? (info.wrnLvlNm || '') : '';
            };
            const addedPrelim = addedChildren.filter(x => childLvl(curr, x) === '예비');
            const addedActive = addedChildren.filter(x => childLvl(curr, x) !== '예비');
            // [자식 예비→발효 전이] prev·curr 양쪽에 키가 있어 "신규 추가"는 아니지만 등급이
            //   예비→발효(주의보/경보)로 올라간 자식 = 그 순간이 진짜 "추가 발효". 이 신호가 없으면
            //   사용자는 자식 발효를 영영 통지받지 못한다(예비 발표만 받고 발효 푸시 누락).
            //   (발효→예비 격하는 별도 발사 안 함 — 현실에 거의 없고 오분류 위험만 큼.)
            const nowActivated = currChildren.filter(x =>
                prevChildren.includes(x) &&
                childLvl(prev, x) === '예비' &&
                childLvl(curr, x) !== '예비' && childLvl(curr, x) !== '');
            if (addedPrelim.length > 0) {
                changes.push({
                    type: 'CHILD_PRELIM_ADD',
                    zone: zone,
                    curr: childToBlock(childInfoOf(curr, zone, addedPrelim[0])),
                    childState: { all, active: currChildren, added: addedPrelim, released: [] }
                });
            }
            const activeAdds = addedActive.concat(nowActivated);
            if (activeAdds.length > 0) {
                changes.push({
                    type: 'CHILD_ADD',
                    zone: zone,
                    curr: childToBlock(childInfoOf(curr, zone, activeAdds[0])),
                    childState: { all, active: currChildren, added: activeAdds, released: [] }
                });
            }
            // [문제1 — 예비 자식 소멸 비대칭 해소] 해제 자식을 prev 등급으로 분기.
            //   발표측(PR#991)이 신규 자식을 예비/발효로 분기(CHILD_PRELIM_ADD/CHILD_ADD)한 것과
            //   대칭이 되도록 해제측도 분기한다.
            //     · prev 자식이 '주의보'/'경보'(진짜 발효중) → 기존 CHILD_RELEASE("주의보 일부 해제") 유지.
            //     · prev 자식이 '예비'(미발효 예비 자식)        → "일부 해제" 발사 금지(예비는 발효된 적 없음).
            //       대신 CHILD_PRELIM_CANCEL("예비특보 취소") 로 발사한다(§7.7.19). 부모/자식 예비는
            //       독립 lifecycle 이라 부모가 발효중이거나 부모 예비가 생존한 채 자식 예비만 취소되는
            //       정상 케이스가 있고, 이때 대표할 부모 UPCOMING_CANCEL 이 없어 무푸시가 되던 결함 수정.
            //   [보수적] prev 등급이 명확히 '예비'일 때만 신경로. 등급 메타가 비었거나(enrich
            //   누락) 알 수 없는 경우는 기존대로 partial_release 유지(누락 푸시 방지 — 안전쪽).
            const releasedActive = releasedChildren.filter(x => childLvl(prev, x) !== '예비');
            const releasedPrelim = releasedChildren.filter(x => childLvl(prev, x) === '예비');
            if (releasedActive.length > 0) {
                changes.push({
                    type: 'CHILD_RELEASE',
                    zone: zone,
                    prev: childToBlock(childInfoOf(prev, zone, releasedActive[0])),
                    childState: { all, active: currChildren, added: [], released: releasedActive }
                });
                // [§7.7.21] 해제 확정 자식의 시각 관찰 상태 능동 폐기 — 유예 내 동명 재등장 시
                //   옛 확정값 롤백(옛 시각 CHILD_ADD 오표기) 방지.
                for (const cn of releasedActive) _tcInvalidateChild(zone, cn);
            }
            // [자식 예비 단독 취소 — CHILD_PRELIM_CANCEL] (§7.7.19)
            //   즉발하지 않고 펜딩에 기록 → 아래에서 3분 연속 부재 확인 후 발사.
            //   (예비 자식은 purge 가 디바운스 carry 를 우회시킬 수 있어 글리치 오발 방지 —
            //    메모는 스냅샷 밖이라 purge 무영향, 표준 3분 디바운스와 동일 관찰 시간.)
            for (const cn of releasedPrelim) {
                const pk = zone + '|' + cn;
                if (!_childPrelimCancelPending[pk]) {
                    const pi = childInfoOf(prev, zone, cn);
                    if (pi) _childPrelimCancelPending[pk] = { info: Object.assign({}, pi), since: Date.now() };
                }
            }
            // (펜딩 평가는 이 블록 밖 — zone 루프 말미에서 부모 변경 여부와 무관하게 수행.
            //  §7.7.21: 블록 안에서만 평가하면 부모 시각변경 확정 사이클마다 발사가 이연되어
            //  부모가 연속 변경 시 자식 취소가 무기한 밀리는 문제가 있었음.)

            // [자식 단독 연장] 부모 불변 + 유지중인 자식의 발효예정/해제예정이 더 늦어짐.
            //   prev·curr 양쪽에 있는 자식만 (추가/해제는 위에서 처리). (기존,변경후) 쌍별 묶음.
            const efKids = {}, ynKids = {};   // key: old||new → { oldTime, newTime, names:[], block }
            for (const cn of currChildren) {
                if (!prevChildren.includes(cn)) continue;
                const pi = childInfoOf(prev, zone, cn), ci = childInfoOf(curr, zone, cn);
                if (!pi || !ci) continue;
                if (pi.wrnLvlNm !== ci.wrnLvlNm) continue;   // 등급 변하면 연장 아님(격상/격하) — 오분류 방지
                const isUp = ci.wrnLvlNm === '예비';
                const oldT = isUp ? (pi.tmEf || '') : (pi.clrNtcTm || pi.tmYn || '');
                const newT = isUp ? (ci.tmEf || '') : (ci.clrNtcTm || ci.tmYn || '');
                if (!oldT || !newT || oldT === newT) continue;
                if (!_isRangeTime(oldT) || !_isRangeTime(newT)) continue;   // 범위→범위만 연장(정확시각이면 시각변경)
                const kn = _timeKey(newT), ko = _timeKey(oldT, kn ? Math.floor(kn / 1000000) : null);
                if (ko == null || kn == null || kn <= ko) continue;   // 더 늦어진 경우만(연장)
                const bucket = isUp ? efKids : ynKids;
                const key = oldT + '||' + newT;
                if (!bucket[key]) bucket[key] = { oldTime: oldT, newTime: newT, names: [], block: childToBlock(ci) };
                bucket[key].names.push(cn);
            }
            for (const g of Object.values(efKids)) {
                changes.push({
                    type: 'CHILD_EF_EXTEND', zone: zone, curr: g.block,
                    oldTime: g.oldTime, newTime: g.newTime,
                    childState: { all, active: currChildren, extended: g.names }
                });
            }
            for (const g of Object.values(ynKids)) {
                changes.push({
                    type: 'CHILD_YN_EXTEND', zone: zone, curr: g.block,
                    oldTime: g.oldTime, newTime: g.newTime,
                    childState: { all, active: currChildren, extended: g.names }
                });
            }

            // [자식 단독 시각/해제예고 변경] (수정 #3 — MD §4.25 / S-CHILD-TIMECH) — 부모 블록 불변
            //   (이 if 조건: !upcomingChanged && !activeChanged) + 자식 set 변화 없음일 때, 유지중인 자식의
            //   발효예정(tmEf)·해제예정/해제예고(clrNtcTm|tmYn) 가 "의미있게" 바뀌면 자식 전용 1건 푸시.
            //   (예: 자식만 해제예고시각이 새로 생김/달라짐 — 부모 앞바다는 변동 없음.)
            //   기존엔 자식 set 변화(추가/해제/예비→발효)와 "범위→더 늦은 범위"(연장)만 처리하고,
            //   자식 단독 해제예고 신규(없음→정확시각)·정확↔다른정확·앞당김은 무푸시였다(사용자 경로 누락).
            //   → push_sender 가 child_time_ef_change/child_time_yn_change 로 매핑(부모 time_*_change 와 분리).
            //
            //   [정합 4관문]
            //     ① 부모 불변: 이 블록 자체가 !upcomingChanged && !activeChanged && c 안에 있음.
            //     ② Major-3(자식 set 변화 동반 억제): 같은 사이클 추가/해제/예비→발효면 그 푸시가 대표 →
            //        setChanged 일 때 시각 변경 억제(중복/우선순위 충돌 방지).
            //     ③ 범위↔정확 깜빡임 / HOLD / 연장 중복 제외: _sameReleaseMoment(동일 모멘트) 흡수,
            //        위 efKids/ynKids 가 가져간 자식(연장)은 제외(이중 발사 방지).
            //     ④ 의미있는 변경만: (없음→값) 또는 (값→다른 모멘트) 일 때만. 동일값/사라짐/깜빡임 무시.
            //   등급(wrnLvlNm) 이 바뀐 자식은 격상/격하이지 시각변경이 아니므로 제외(오분류 방지).
            //   [해제예고 필드] 실측상 자식 해제예고는 clr_ntc_tm(범위형)에 옴, tm_yn 미존재 → clrNtcTm 우선.
            const childSetChanged =
                addedChildren.length > 0 || releasedChildren.length > 0 || nowActivated.length > 0;
            if (!childSetChanged) {
                // 위 연장 블록이 이미 발사한 자식 — 이중 발사 방지용 집합.
                const efExtendedNames = new Set();
                for (const g of Object.values(efKids)) g.names.forEach(n => efExtendedNames.add(n));
                const ynExtendedNames = new Set();
                for (const g of Object.values(ynKids)) g.names.forEach(n => ynExtendedNames.add(n));

                const efChangeKids = [];   // 발효예정(tmEf) 변경 자식 (예비 단계)
                const ynChangeKids = [];   // 해제예정(clrNtcTm/tmYn) 변경 자식 (발효 단계)
                let efChangeBlock = null, ynChangeBlock = null;
                for (const cn of currChildren) {
                    if (!prevChildren.includes(cn)) continue;     // 유지중인 자식만 (추가/해제는 위에서 처리)
                    const pi = childInfoOf(prev, zone, cn), ci = childInfoOf(curr, zone, cn);
                    if (!pi || !ci) continue;
                    if (pi.wrnLvlNm !== ci.wrnLvlNm) continue;    // 등급 변하면 격상/격하 — 시각변경 아님
                    const isUp = ci.wrnLvlNm === '예비';
                    if (isUp) {
                        // 발효예정 시각 변경 (예비 자식)
                        if (efExtendedNames.has(cn)) continue;             // 연장으로 이미 발사 → 스킵
                        const oldT = pi.tmEf || '', newT = ci.tmEf || '';
                        if (!newT) continue;                               // curr 값 없음(사라짐) → 시각변경 아님(무푸시)
                        if (oldT === newT) continue;                       // 동일값 무시
                        if (_sameReleaseMoment(oldT, newT)) continue;      // 범위↔정확 깜빡임(동일 모멘트) 흡수
                        // [§7.7.22 부모 대표 억제] 자식의 새 발효예정이 부모의 현재 발효예정과 같은
                        //   순간이면 생략 — 부모 발표/시각변경 푸시가 그 시각을 이미 알렸으므로
                        //   "(…만 시각 변경)"은 새 정보 없는 잉여 알림. (2026-07-10 06:09 실사고:
                        //   GAP 신규 자식의 첫 등록값이 부모와 동일한 09시로 정착하며 '변경' 발사.)
                        //   자식이 부모와 다른 시각으로 진짜 갈라진 경우에만 발사.
                        const pEf = currUpcoming ? (currUpcoming.tmEf || '') : '';
                        if (pEf && (newT === pEf || _sameReleaseMoment(newT, pEf))) continue;
                        efChangeKids.push(cn);
                        if (!efChangeBlock) efChangeBlock = childToBlock(ci);
                    } else {
                        // 해제예정 시각 변경/신규 (발효 자식) — clrNtcTm 우선, 없으면 tmYn.
                        if (ynExtendedNames.has(cn)) continue;             // 연장으로 이미 발사 → 스킵
                        const oldT = pi.clrNtcTm || pi.tmYn || '';
                        const newT = ci.clrNtcTm || ci.tmYn || '';
                        if (!newT) continue;                               // 사라짐(해제예고 취소)은 시각변경 아님
                        if (oldT === newT) continue;                       // 동일값 무시
                        if (_sameReleaseMoment(oldT, newT)) continue;      // 범위↔정확 깜빡임 흡수
                        // [§7.7.22 부모 대표 억제] 자식의 새 해제예정이 부모의 현재 해제예정과 같은
                        //   순간이면 생략 (발효예정 분기와 동일 취지 — 부모 푸시가 이미 대표).
                        const pYn = currActive ? (currActive.tmYn || '') : '';
                        if (pYn && (newT === pYn || _sameReleaseMoment(newT, pYn))) continue;
                        ynChangeKids.push(cn);
                        if (!ynChangeBlock) ynChangeBlock = childToBlock(ci);
                    }
                }
                if (efChangeKids.length > 0) {
                    changes.push({
                        type: 'CHILD_TIME_EF_CHANGE', zone: zone, curr: efChangeBlock,
                        childState: {
                            all, active: currChildren,
                            parentTimeUnchanged: true, timeChanged: efChangeKids.slice()
                        }
                    });
                }
                if (ynChangeKids.length > 0) {
                    changes.push({
                        type: 'CHILD_TIME_YN_CHANGE', zone: zone, curr: ynChangeBlock,
                        childState: {
                            all, active: currChildren,
                            parentTimeUnchanged: true, timeChanged: ynChangeKids.slice()
                        }
                    });
                }
            }
        }

        // [자식 예비취소 펜딩 평가 — §7.7.19·§7.7.21] 자식 독립 블록 밖에서, 부모 변경 여부와
        //   무관하게 매 사이클 평가한다. (블록 안에서만 평가하면 부모 시각변경 확정 사이클에
        //   발사가 이연되고, 부모가 연속 변경되면 무기한 밀렸음.)
        //   - 복귀(글리치) → 폐기(무푸시). 부모 예비취소 관찰중 → 보류(§7.7.13 대표 1건 원칙,
        //     부모 진짜취소 확정 시 디바운스가 펜딩을 능동 폐기). 3분 연속 부재 → 발사.
        //   - 부모가 curr 에 존재(c)할 때만 — 부모 자체가 소멸하면 부모 해제/취소 푸시가 대표.
        if (c) {
            const duePrelimCancel = [];
            let duePrelimInfo = null;
            for (const pk of Object.keys(_childPrelimCancelPending)) {
                if (pk.slice(0, zone.length + 1) !== zone + '|') continue;
                const ent = _childPrelimCancelPending[pk];
                const cn = pk.slice(zone.length + 1);
                if (currChildren.includes(cn)) { delete _childPrelimCancelPending[pk]; continue; }   // 복귀=글리치 → 무푸시
                if (_upcomingCancelPending[zone]) continue;                                          // 부모 취소 관찰중 → 보류
                // [§7.7.23] 같은 종류의 부모가 판정 보류실에 있으면 흡수 — 부모 판정 1건이 자식까지 대표.
                if (_loadCancelVerdicts().parents[_cvParentKey(zone, (ent.info && (ent.info.wrnTpNm || ent.info.wrnTp)) || '')]) { delete _childPrelimCancelPending[pk]; continue; }
                if (Date.now() - ent.since < CHILD_PRELIM_CANCEL_CONFIRM_MS) continue;               // 재확인 대기
                duePrelimCancel.push(cn);
                if (!duePrelimInfo) duePrelimInfo = ent.info;
                delete _childPrelimCancelPending[pk];
            }
            if (duePrelimCancel.length > 0 && duePrelimInfo) {
                // [§7.7.23] 풍랑·태풍 자식 취소도 즉시 발사하지 않고 보류실 등록 — 통보문 확인 후
                //   발사 (15분 TTL 대신 부모와 동일한 1시간 판정으로 통일). 그 외 종류는 기존 유지.
                const dueBlk = childToBlock(duePrelimInfo);
                if (dueBlk && CANCEL_VERDICT_TYPES.indexOf(dueBlk.wrnTp) !== -1) {
                    for (const cn of duePrelimCancel) _registerChildCancelVerdict(zone, cn, dueBlk);
                } else {
                    changes.push({
                        type: 'CHILD_PRELIM_CANCEL',
                        zone: zone,
                        prev: dueBlk,
                        childState: { all, active: currChildren, added: [], released: duePrelimCancel }
                    });
                }
                // [§7.7.21] 자식 예비 종료 — 시각 관찰 상태는 푸시 보류와 무관하게 즉시 폐기.
                for (const cn of duePrelimCancel) _tcInvalidateChild(zone, cn);
            }
        }
    }

    // [§7.7.23 판정 보류실] zone 루프 밖 별도 패스 — 보류 건 판정. (c) 확정/대표 발사는
    //   합성 change 를 changes 에 append 해 기존 발송 경로(processChanges)를 그대로 탄다.
    try {
        _evaluateCancelVerdicts(curr, changes, { getUp, getAct, childKeys, childInfoOf });
    } catch (e) {
        console.error('[Marine] 예비취소 보류 판정 실패 (다른 푸시 무영향):', e && e.message);
    }

    return changes;
}

async function _enqueueImmediateRelease(caseZones) {
    try {
        if (!Array.isArray(caseZones) || caseZones.length === 0) return;
        const cycleId = Date.now();

        // prev snapshot 에서 해당 zone 제거 (이미 정상 해제로 처리되었으므로) — 가드 데이터 처리, 유지
        if (_prevSnapshot && _prevSnapshot.parents) {
            for (const z of caseZones) {
                if (z && z.name) _prevSnapshot.parents.delete(z.name);
            }
            _savePrevSnapshot(_prevSnapshot);
        }

        // [수정1] 관리자 알림 푸시 비활성 — prev 정리만 하고 dmdw 발사는 skip
        if (!ADMIN_PUSH_ENABLED) return;

        // wrnTp+wrnLvl 별로 그룹화
        const groups = new Map();
        for (const z of caseZones) {
            if (!z || !z.name) continue;
            const key = `${z.wrnTp || 'UNK'}|${z.wrnLvl || 'UNK'}`;
            if (!groups.has(key)) groups.set(key, { wrnTp: z.wrnTp, wrnLvl: z.wrnLvl, info: z, entries: [] });
            groups.get(key).entries.push({
                fullName: z.name,
                wrnTp: z.wrnTp,
                wrnLvl: z.wrnLvl,
                wrnTpNm: z.wrnTpNm,
                wrnLvlNm: z.wrnLvlNm,
                tmFc: z.tmFc,
                tmEf: z.tmEf
            });
        }

        for (const group of groups.values()) {
            try {
                dmdwPush.enqueueParentRelease(cycleId, group.wrnTp, group.wrnLvl, group.entries, group.info);
            } catch (e) {
                console.error('[Marine] enqueueParentRelease 실패:', e && e.message);
            }
        }
        await dmdwPush.flushParent(cycleId, {}).catch(e => {
            console.error('[Marine] flushParent (immediate release) 실패:', e && e.message);
        });
    } catch (e) {
        console.error('[Marine] _enqueueImmediateRelease 실패:', e && e.message);
    }
}

/**
 * admin route 용 조회.
 */
function getSuspiciousState() {
    if (_suspiciousState === null) {
        _suspiciousState = _loadSuspiciousState();
    }
    return {
        currentCase: _suspiciousState.currentCase,
        history: _suspiciousState.history || []
    };
}

// ============================================================================
// [Followup E-2] weather_alerts.json zone tree 갱신
// ============================================================================
//
// SPEC §4 — "weather_alerts.json 갱신": v7 통합 후에도 사용자 앱 weather 페이지가
//   기존 weather_alerts.json 의 부모/자식 트리에 의존. marine_warning_crawler 가
//   매 cycle dispatch + state save 후 이 파일도 함께 갱신해야 stale 표시 차단.
//
// 정책:
//   - 기존 zone tree 구조 (동/서/남/제주 4 sea — 해상 — 앞바다 — leaf zone) 보존
//   - 각 leaf zone 마다 { current, upcoming, history, children } 필드 유지
//     • current   : 발효 (wrnLvlNm = 주의보/경보) 시 객체, 아니면 null
//     • upcoming  : 예비특보 (wrnLvlNm = 예비) 시 객체, 아니면 null
//     • history   : 본 cycle 에선 손대지 않음 (기존 디스크 값 보존)
//     • children  : 자식 fullName 키 그대로, active 면 객체, 비활성이면 null
//   - 디스크 파일이 이미 있으면 history / lastReportId / processedReportIds 등
//     legacy 메타 필드를 보존하기 위해 read → current/previous 만 덮어쓰기.
//   - 디스크 IO 는 cycle 끝에 한 번만 (atomic tmp → rename).
//   - downstream (routes/weather.js, services/cache_manager.js, routes/admin.js)
//     의 shape 검사 (current·children 보유 여부) 와 mtime 기반 캐시 무력화 자연 호환.

const _WEATHER_ALERTS_FILE = path.join(__dirname, 'data', 'weather_alerts.json');
const _WEATHER_ALERTS_TMP = _WEATHER_ALERTS_FILE + '.tmp';

/** weather_alerts.json zone tree skeleton — 기존 weather_alerts_crawler.createZoneStructure() 와 동일. */
function _createZoneSkeleton() {
    const leaf = (children) => ({ current: null, upcoming: null, history: [], children: children || {} });
    return {
        "동해": {
            "동해남부해상": {
                "동해남부앞바다": {
                    "울산앞바다": leaf({ "울산앞바다중평수구역": null, "울산앞바다중연안바다": null }),
                    "경북남부앞바다": leaf({ "경북남부앞바다중평수구역": null, "경북남부앞바다중연안바다": null }),
                    "경북북부앞바다": leaf({ "경북북부앞바다중연안바다": null })
                },
                "동해남부먼바다": {
                    "동해남부남쪽안쪽먼바다": leaf(),
                    "동해남부남쪽바깥먼바다": leaf(),
                    "동해남부북쪽안쪽먼바다": leaf(),
                    "동해남부북쪽바깥먼바다": leaf()
                }
            },
            "동해중부해상": {
                "동해중부앞바다": {
                    "강원북부앞바다": leaf({ "강원북부앞바다중연안바다": null }),
                    "강원중부앞바다": leaf({ "강원중부앞바다중연안바다": null }),
                    "강원남부앞바다": leaf({ "강원남부앞바다중연안바다": null })
                },
                "동해중부먼바다": {
                    "동해중부안쪽먼바다": leaf({ "울릉도울릉읍연안바다": null, "울릉도서면연안바다": null, "울릉도북면연안바다": null }),
                    "동해중부바깥먼바다": leaf()
                }
            }
        },
        "서해": {
            "서해남부해상": {
                "서해남부앞바다": {
                    "전북북부앞바다": leaf({ "전북북부앞바다중평수구역": null }),
                    "전북남부앞바다": leaf({ "전북남부앞바다중평수구역": null }),
                    "전남북부서해앞바다": leaf({ "전남북부서해앞바다중평수구역": null }),
                    "전남중부서해앞바다": leaf({ "전남중부서해앞바다중먼평수구역": null, "전남중부서해앞바다중앞평수구역": null }),
                    "전남남부서해앞바다": leaf({ "전남남부서해앞바다중평수구역": null })
                },
                "서해남부먼바다": {
                    "서해남부북쪽안쪽먼바다": leaf(),
                    "서해남부북쪽바깥먼바다": leaf(),
                    "서해남부남쪽안쪽먼바다": leaf({ "서해남부남쪽안쪽먼바다중조도부근평수구역": null }),
                    "서해남부남쪽바깥먼바다": leaf()
                }
            },
            "서해중부해상": {
                "서해중부앞바다": {
                    "인천·경기북부앞바다": leaf({ "인천·경기북부앞바다중평수구역": null }),
                    "인천·경기남부앞바다": leaf({ "인천·경기남부앞바다중먼평수구역": null, "인천·경기남부앞바다중북부앞평수구역": null, "인천·경기남부앞바다중남부앞평수구역": null }),
                    "충남북부앞바다": leaf({ "천수만평수구역": null, "안면도서쪽평수구역": null, "당진평수구역": null, "태안·서산북쪽평수구역": null }),
                    "충남남부앞바다": leaf({ "충남남부앞바다중평수구역": null })
                },
                "서해중부먼바다": {
                    "서해중부안쪽먼바다": leaf(),
                    "서해중부바깥먼바다": leaf()
                }
            }
        },
        "남해": {
            "남해동부해상": {
                "남해동부앞바다": {
                    "부산앞바다": leaf({ "부산앞바다중동부평수구역": null, "부산앞바다중서부평수구역": null, "부산앞바다중연안바다": null }),
                    "경남서부남해앞바다": leaf({ "경남서부남해앞바다중동부평수구역": null, "경남서부남해앞바다중서부평수구역": null, "경남서부남해앞바다중남부평수구역": null, "경남서부남해앞바다중남해군연안바다": null }),
                    "경남중부남해앞바다": leaf({ "경남중부남해앞바다중평수구역": null, "경남중부남해앞바다중연안바다": null }),
                    "거제시동부앞바다": leaf({ "거제시동부앞바다중연안바다": null })
                },
                "남해동부먼바다": {
                    "남해동부안쪽먼바다": leaf(),
                    "남해동부바깥먼바다": leaf()
                }
            },
            "남해서부해상": {
                "남해서부앞바다": {
                    "전남서부남해앞바다": leaf({ "전남서부남해앞바다중평수구역": null }),
                    "전남동부남해앞바다": leaf({ "전남동부남해앞바다중서부평수구역": null, "전남동부남해앞바다중동부평수구역": null })
                },
                "남해서부먼바다": {
                    "남해서부서쪽먼바다": leaf({ "남해서부서쪽먼바다중추자도연안바다": null }),
                    "남해서부동쪽먼바다": leaf()
                }
            }
        },
        "제주도": {
            "제주도앞바다": {
                "제주도북부앞바다": leaf({ "제주도북부앞바다중연안바다": null }),
                "제주도동부앞바다": leaf({ "제주도동부앞바다중북동연안바다": null, "제주도동부앞바다중남동연안바다": null, "제주도동부앞바다중우도연안바다": null }),
                "제주도남부앞바다": leaf({ "제주도남부앞바다중연안바다": null }),
                "제주도서부앞바다": leaf({ "제주도서부앞바다중북서연안바다": null, "제주도서부앞바다중남서연안바다": null, "제주도서부앞바다중가파도연안바다": null })
            },
            "제주도먼바다": {
                "제주도남쪽바깥먼바다": leaf(),
                "제주도남동쪽안쪽먼바다": leaf(),
                "제주도남서쪽안쪽먼바다": leaf()
            }
        }
    };
}

/** zone tree leaf 노드 (current + children 보유) 를 부모 이름 → 노드 Map 으로 수집. */
function _collectLeafZonesByName(tree) {
    const out = new Map();
    function walk(node) {
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node)) {
            if (!v || typeof v !== 'object') continue;
            const isLeaf = Object.prototype.hasOwnProperty.call(v, 'current')
                && Object.prototype.hasOwnProperty.call(v, 'children');
            if (isLeaf) {
                out.set(k, v);
            } else {
                walk(v);
            }
        }
    }
    walk(tree);
    return out;
}

/**
 * StateSnapshot → 기존 zone tree 형식 변환.
 *
 *   - skeleton 의 leaf zone 들을 순회 → snapshot.parents / snapshot.children 으로부터
 *     current / upcoming / children 값을 채운다.
 *   - 예비 (wrnLvlNm = '예비') → upcoming. 정식 (주의보/경보) → current.
 *   - history 는 손대지 않음 (skeleton 의 [] 그대로 — 호출자가 디스크값 머지).
 *   - 자식: skeleton 의 children 객체에 등록된 자식만 채운다 (skeleton 외 자식은 무시).
 *
 * @param {StateSnapshot} snap
 * @returns {Object} zone tree (동/서/남/제주 4 sea)
 */
/**
 * [D-6 (A) + Followup] mmis 시간 형식을 우리 시스템 한글 형식으로 변환.
 *   - 일반 시간 ("2026.05.21 06:00") → "2026년 05월 21일 06시 00분"
 *   - 범위형 ("22일 21시 ~ 24시") → "22일 밤(21시~24시)" (시간대 명칭 보강)
 *   - 자연어 ("내일 오전" 등) → 그대로 통과
 *   - 빈 값/null/undefined → ''
 *
 * 시간대 매핑 (시작시각 기준 — 실측 DMDW 본문 + 시각 역산 결과):
 *   0-6시 새벽 / 6-9시 아침 / 9-12시 오전 / 12-15시 낮
 *   15-18시 늦은 오후 / 18-21시 저녁 / 21-24시 밤
 *
 *   변경 (P4):
 *     - "오후" 단독 미관측, "늦은 오후" 가 표준 (Agent A 52건, D 5건)
 *     - "저녁" 18~21시 신규 분기 (Agent A 6건, B/C 시각 역산)
 *     - "밤" 18~24 → 21~24 좁힘 (Agent A/D 본문 일치)
 */
function _periodNameByHour(h) {
    if (h >= 21) return '밤';              // 21~24시
    if (h >= 18) return '저녁';             // 18~21시
    if (h >= 15) return '늦은 오후';        // 15~18시
    if (h >= 12) return '낮';               // 12~15시
    if (h >= 9)  return '오전';             // 09~12시
    if (h >= 6)  return '아침';             // 06~09시
    return '새벽';                          // 00~06시
}

function normalizeMmisTime(t) {
    if (!t) return '';
    const s = String(t).trim();

    // 범위형 변환: "22일 21시 ~ 24시" → "22일 밤(21시~24시)"
    //   (옛 시스템 표시 형식 호환 — 사용자 앱 utils.js 의 시간대 분기 호출용)
    const rangeMatch = s.match(/^(\d+)일\s*(\d+)시\s*[~∼]\s*(\d+)시$/);
    if (rangeMatch) {
        const day = rangeMatch[1];
        const startH = parseInt(rangeMatch[2], 10);
        const endH = parseInt(rangeMatch[3], 10);
        const period = _periodNameByHour(startH);
        const startStr = String(startH).padStart(2, '0');
        const endStr = String(endH).padStart(2, '0');
        return `${day}일 ${period}(${startStr}시~${endStr}시)`;
    }

    // 연도 포함 범위형 (warn/ready 발효예정 형식): "2026.06.02 23~23시" → "2026년 06월 02일 밤(23시~23시)"
    const ymdRange = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2})\s*[~∼]\s*(\d{1,2})시$/);
    if (ymdRange) {
        const [, Y, M, D, sh, eh] = ymdRange;
        const period = _periodNameByHour(parseInt(sh, 10));
        return `${Y}년 ${M}월 ${D}일 ${period}(${String(sh).padStart(2, '0')}시~${String(eh).padStart(2, '0')}시)`;
    }

    // 이미 시간대 명칭 있는 범위형 → 그대로 통과
    if (/[~∼]/.test(s)) return s;

    // 일반 시간 변환: "2026.05.21 06:00" → "2026년 05월 21일 06시 00분"
    // [레거시] 분=58/59 는 KMA 범위코드 → 해당 6시간 블록 범위로 복원
    //   예: "2026.06.01 05:58" → "2026년 06월 01일 00시~06시"
    const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (m) {
        const [, Y, M, D, h, mn] = m;
        const hh = parseInt(h, 10), mm = parseInt(mn, 10);
        // [KMA 레거시 범위코드] 정확시각은 통상 분 일의자리가 0(00/10/.../50). 분=58/59 는
        //   실제 시각이 아니라 시간대 범위 코드 → 해당 6시간 블록 범위로 복원 (main 기존 처리 채택).
        if (mm === 58 || mm === 59) {
            const block = (hh >= 18) ? '18시~24시' : (hh >= 12) ? '12시~18시'
                        : (hh >= 9) ? '09시~12시' : (hh >= 6) ? '06시~09시' : '00시~06시';
            return `${Y}년 ${M}월 ${D}일 ${block}`;
        }
        return `${Y}년 ${M}월 ${D}일 ${h}시 ${mn}분`;
    }

    return s;
}

function _buildZoneTreeFromSnapshot(snap) {
    const tree = _createZoneSkeleton();
    if (!snap) return tree;
    const leafByName = _collectLeafZonesByName(tree);

    // 부모 발효 채우기
    // [legacy 호환] 사용자 앱 (js/data.js, ocean_warn_active*.js) 이 옛 dmdw 구조 가정:
    //   - wrnTp 가 한글 "풍랑" (mmis 는 "V" 코드)
    //   - wrnLvl 이 한글 "주의보" (mmis 는 "2" 코드)
    //   - tmCc 가 해제예고 (mmis 는 clrNtcTm)
    // 다운스트림 영향 최소화 위해 본 빌더가 옛 구조로 변환 + 신규 필드 병기.
    const toBlock = (info) => ({
        wrnTp: info.wrnTpNm || info.wrnTp || '',       // 한글 우선 (data.js:269 호환)
        wrnTpNm: info.wrnTpNm || '',
        // [B] 발효중 공존 격상/격하 예비는 wrnLvlReal(실제 등급, 예: 경보)로 "다가오는 특보" 표출.
        //   render.js 가 upcoming.wrnLvl 의 경보/주의보/예비를 모두 처리하므로 안전. 평상시 동일.
        wrnLvl: info.wrnLvlReal || info.wrnLvlNm || info.wrnLvl || '',    // 한글 우선
        wrnLvlNm: info.wrnLvlReal || info.wrnLvlNm || '',
        tmFc: normalizeMmisTime(info.tmFc),
        // [표시 = 확정값] 비교/푸시용 info.tmEf 를 그대로 표출. info.tmEf 는 (a)정확시각이
        //   오면 그 시각, (b)범위형만 오면 범위, (c)정확값을 본 뒤엔 그 정확값으로 고정(held),
        //   (d):58/59 코드는 normalizeMmisTime 이 범위로 변환 — 즉 "확정 시각이 나오면 그 시각,
        //   아직 예측(범위)이면 범위" 가 자연스럽게 표출됨. (이전 *Disp 범위 sticky 는 확정 시각을
        //   가려 발효시각이 안 갱신되던 문제가 있어 폐지.)
        tmEf: normalizeMmisTime(info.tmEf),
        tmYn: normalizeMmisTime(info.tmYn),
        tmCc: normalizeMmisTime(info.clrNtcTm),        // 옛 tmCc = mmis clrNtcTm
        clrNtcTm: normalizeMmisTime(info.clrNtcTm),    // 신규 필드 (양 형식 모두 지원)
        source: 'MARINE_MMIS'
    });
    for (const [parentName, info] of snap.parents) {
        const leaf = leafByName.get(parentName);
        if (!leaf) continue;
        if (!info || !info.wrnLvlNm) continue;
        if (info.wrnLvlNm === '예비') {
            leaf.upcoming = toBlock(info);
        } else if (info.wrnLvlNm !== '해제') {
            leaf.current = toBlock(info);
        }
    }
    // [B] 발효중 해역에 공존하는 "다가오는(예비)" 특보 → leaf.upcoming 병렬 표출.
    //   parents 가 이미 예비여서 upcoming 이 찬 경우는 덮어쓰지 않음.
    if (snap.upcomings) {
        for (const [parentName, info] of snap.upcomings) {
            const leaf = leafByName.get(parentName);
            if (!leaf || leaf.upcoming) continue;
            if (!info || !info.wrnLvlNm || info.wrnLvlNm === '해제') continue;
            leaf.upcoming = toBlock(info);
        }
    }

    // 자식 발효 채우기 — [원칙] 모든 자식 표출 필드는 자식 자신의 데이터에만 기인.
    //   warn-sasc/list·ready·latest 가 자식별 tm_fc/tm_ef/tm_yn/clr_ntc_tm 을 개별
    //   제공하므로(부모 warn/* 와 동일 스키마) 부모값으로 fallback 하지 않는다.
    //   (과거 [D-6 (B)] 는 "자식 응답에 시간 필드 없음" 가정으로 부모 fallback 했으나
    //    실측 결과 자식이 개별 제공함이 확인되어 제거 — 종속 표출 금지.)
    //   자식 고유 데이터가 없으면 빈 값(미표시)이 올바른 표출.
    for (const [parentName, childMap] of snap.children) {
        const leaf = leafByName.get(parentName);
        if (!leaf || !leaf.children) continue;
        for (const [childName, info] of childMap) {
            if (!Object.prototype.hasOwnProperty.call(leaf.children, childName)) continue;
            if (!info || !info.wrnLvlNm) continue;
            // [자식 예비 보존] 자식 '예비'를 그대로 표출한다. (과거엔 "푸시 dedup 정책"이라 적힌
            //   채 '주의보'로 강제 정규화했으나, 실제 푸시 diff/dedup 은 StateSnapshot(snap.children)
            //   으로만 동작하고 이 트리(weather_alerts.json)는 화면 표출 전용이라 dedup 과 무관함을
            //   라이브 grep + 시뮬로 확인. 정규화를 제거하면 프론트(js/data.js processSingleAlert)가
            //   level==='예비'를 1순위로 '발표(예비)' 표출 → 시간추정(childEfNotYet) 보정에 의존하지
            //   않아 더 견고. 실제 발효 시 snapshot 이 '주의보'가 되어 트리도 자동 전환.)
            const lvlNm = info.wrnLvlNm;
            leaf.children[childName] = {
                source: 'MARINE_MMIS',
                wrnTp: info.wrnTpNm || info.wrnTp || '',  // 한글 우선
                wrnTpNm: info.wrnTpNm || '',
                wrnLvl: lvlNm || info.wrnLvl || '',    // 한글 우선
                wrnLvlNm: lvlNm,
                tmFc: normalizeMmisTime(info.tmFc),
                tmEf: normalizeMmisTime(info.tmEf),       // [표시 = 확정값] 부모와 동일 정책
                tmYn: normalizeMmisTime(info.tmYn),
                tmCc: normalizeMmisTime(info.clrNtcTm),
                clrNtcTm: normalizeMmisTime(info.clrNtcTm)
            };
        }
    }
    return tree;
}

/**
 * weather_alerts.json 디스크 갱신.
 *   - 기존 파일이 있으면 read → updatedAt / current / previous 만 덮어쓰고 나머지 메타
 *     (lastReportId, processedReportIds, pendingRetries, oneTimeBulletinWindowOverride,
 *      각 leaf 의 history) 는 디스크 값 보존.
 *   - atomic write (tmp → rename).
 *   - I/O 실패는 무시 (다음 cycle 에서 재시도).
 *
 * @param {StateSnapshot} prevSnap — 직전 cycle snapshot
 * @param {StateSnapshot} currSnap — 이번 cycle snapshot
 */
function _writeWeatherAlertsJson(prevSnap, currSnap) {
    try {
        const dir = path.dirname(_WEATHER_ALERTS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // 1) 디스크 read — 메타 + history 보존용
        let disk = null;
        try {
            if (fs.existsSync(_WEATHER_ALERTS_FILE)) {
                disk = JSON.parse(fs.readFileSync(_WEATHER_ALERTS_FILE, 'utf8'));
            }
        } catch (e) {
            // 깨진 파일이면 새로 생성
            console.warn('[marine_warning_crawler] weather_alerts.json 읽기 실패 — 새 파일 생성:', e && e.message);
            disk = null;
        }

        // 2) 새 current / previous 트리 생성
        const newCurrent = _buildZoneTreeFromSnapshot(currSnap);
        const newPrevious = _buildZoneTreeFromSnapshot(prevSnap);

        // 3) 기존 디스크의 history / 메타 보존
        if (disk && typeof disk === 'object') {
            // history 머지 — leaf 노드 history 만 디스크에서 가져옴
            const oldCurrLeafs = disk.current ? _collectLeafZonesByName(disk.current) : new Map();
            const oldPrevLeafs = disk.previous ? _collectLeafZonesByName(disk.previous) : new Map();
            for (const [name, leaf] of _collectLeafZonesByName(newCurrent)) {
                const old = oldCurrLeafs.get(name);
                if (old && Array.isArray(old.history)) leaf.history = old.history;
            }
            for (const [name, leaf] of _collectLeafZonesByName(newPrevious)) {
                const old = oldPrevLeafs.get(name);
                if (old && Array.isArray(old.history)) leaf.history = old.history;
            }
        }

        const merged = {
            updatedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
            lastReportId: (disk && disk.lastReportId) || null,
            processedReportIds: (disk && Array.isArray(disk.processedReportIds)) ? disk.processedReportIds : [],
            pendingRetries: (disk && disk.pendingRetries && typeof disk.pendingRetries === 'object') ? disk.pendingRetries : {},
            oneTimeBulletinWindowOverride: (disk && Object.prototype.hasOwnProperty.call(disk, 'oneTimeBulletinWindowOverride'))
                ? disk.oneTimeBulletinWindowOverride : null,
            previous: newPrevious,
            current: newCurrent
        };

        fs.writeFileSync(_WEATHER_ALERTS_TMP, JSON.stringify(merged, null, 2), 'utf8');
        fs.renameSync(_WEATHER_ALERTS_TMP, _WEATHER_ALERTS_FILE);
    } catch (e) {
        console.warn('[marine_warning_crawler] weather_alerts.json 저장 실패 (무시):', e && e.message);
    }
}

// ============================================================================
// [Followup Critical-1] response → StateSnapshot 변환
// ============================================================================
//
// marine.kma 응답 envelope: { status, payload } 또는 { code, data } 혼용.
// marine_client.js 가 이미 payload/data 를 _unwrap 으로 흡수하여 row 배열만 반환.

/** 자식 row 에서 부모 zone 추출 — '...중...' 패턴 기준. */
function _extractParent(korNm) {
    if (!korNm) return '';
    const s = String(korNm).trim().replace(/\s+/g, '');
    const idx = s.lastIndexOf('중');
    if (idx > 0) {
        const after = s.substring(idx + 1);
        if (after && after.length >= 2) return s.substring(0, idx);
    }
    return s;
}

// ============================================================================
// [버그수정 — 중부 부모 누락] 부모/자식 분류·부모키 산출을 코드 기반으로 통일.
//
//  근본원인: _extractParent 가 lastIndexOf('중') 로 분할 → "강원중부앞바다" 등
//   이름에 '중부'가 든 *부모* 해역을 "강원"+"부앞바다" 로 오분할 → 부모를 자식으로
//   오분류 → snap.parents 누락 → 화면에서 7개 해역(중부) 사라짐.
//
//  해결: MMIS warn_zone_cd 는 ^S1=부모, ^S2/^S3=자식 으로 불변 규약(전 93코드 반례 0
//   검증). 코드가 있으면 코드로 분류하고, 없을 때만 이름폴백(_extractParent===self).
//
//  부모키 역인덱스(CHILD_TO_PARENT): PARENT_TO_CHILDREN 의 자식 fullName → 부모.
//   이름에 '중' 구분자가 없는 자식(울릉도*연안바다→동해중부안쪽먼바다, 천수만/안면도/
//   당진/태안·서산북쪽 평수구역→충남북부앞바다)은 _extractParent 가 self-key 로 잡아
//   고아 등록되던 문제를, 역인덱스 우선으로 해소한다.
// ============================================================================
const CHILD_TO_PARENT = (() => {
    const idx = {};
    for (const parent of Object.keys(PARENT_TO_CHILDREN)) {
        for (const child of PARENT_TO_CHILDREN[parent]) idx[child] = parent;
    }
    return idx;
})();

/**
 * warn_zone_cd 기반 자식 여부 판정.
 *   ^S1 → 부모(false), ^S2/^S3 → 자식(true). 코드 부재/비표준 시 이름폴백.
 * @param {string} cd   warn_zone_cd (예: 'S1151200', 'S2120500')
 * @param {string} name 정식 해역명 (이름폴백용)
 * @returns {boolean} 자식이면 true
 */
function _isChildZoneCode(cd, name) {
    const c = String(cd || '');
    if (/^S1/.test(c)) return false;        // S1 = 부모(앞바다/먼바다)
    if (/^S[23]/.test(c)) return true;      // S2/S3 = 자식(평수구역/연안바다)
    // 코드 부재(L* 육상은 호출 전 allowlist 로 이미 배제) → 이름폴백
    return name ? _extractParent(name) !== name : false;
}

/**
 * 자식 fullName → 부모키.
 *   1순위: CHILD_TO_PARENT 역인덱스(정의된 모든 자식, '중' 구분자 유무 무관 정확).
 *   2순위: _extractParent 이름분할(역인덱스에 없는 미지 자식 폴백).
 * @param {string} childName 자식 정식 해역명
 * @returns {string} 부모키
 */
function _parentKeyForChild(childName) {
    if (childName && CHILD_TO_PARENT[childName]) return CHILD_TO_PARENT[childName];
    return _extractParent(childName);
}

/**
 * [V11 — 등급명 정규화]
 * mmis 실시간 endpoint 는 예비특보를 warn_lvl_nm='예비특보' 로 내려주지만,
 * 내부 diff/push 로직은 전부 '예비' 로 비교한다 (isUpcoming, isPublish, prelim_cancel 등).
 * 두 값을 맞추지 않으면 예비 판정이 전부 실패하므로 여기서 '예비특보' → '예비' 로 정규화.
 */
function _normLvlNm(nm) {
    const s = String(nm || '');
    return s === '예비특보' ? '예비' : s;
}

/**
 * [V11 — 실시간 특보종류 allowlist]
 * mmis 실시간 endpoint(warn/list, warn/ready, warn/latest, warn-sasc/*) 는
 * 문자 코드를 쓴다: V=풍랑, T=태풍, W=강풍, O=폭풍해일, C=한파 ...
 * (과거 ef/list 의 숫자 코드 6/7/1/5 와 다름)
 * 우리 앱 대상은 풍랑(V)+태풍(T) 뿐이므로 allowlist 로 그 외 전부 제외.
 *   - 기존 'warn_tp===5' 제외 로직은 숫자 코드 가정이라 실시간에서 무력(폭풍해일 O 유입)
 *   - allowlist 가 아니라 denylist 였어서 강풍(W) 등도 유입되던 결함 동시 해소
 */
const REALTIME_TARGET_TP = new Set(['V', 'T']);
function _isTargetRealtimeType(warnTp) {
    return REALTIME_TARGET_TP.has(String(warnTp || '').toUpperCase());
}

/** marine row 를 내부 state 객체로 변환. */
function _rowToParentInfo(row) {
    return {
        wrnTp: String(row.warn_tp || ''),
        wrnTpNm: row.warn_tp_nm || '',
        wrnLvl: String(row.warn_lvl || ''),
        wrnLvlNm: _normLvlNm(row.warn_lvl_nm),
        tmFc: row.tm_fc || '',
        tmEf: row.tm_ef || row.st_tm || '',
        tmYn: row.tm_yn || row.ed_tm || '',
        clrNtcTm: row.clr_ntc_tm || ''
    };
}

function _rowToChildInfo(row) {
    return {
        wrnTp: String(row.warn_tp || ''),
        wrnTpNm: row.warn_tp_nm || '',
        wrnLvl: String(row.warn_lvl || ''),
        wrnLvlNm: _normLvlNm(row.warn_lvl_nm),
        tmFc: row.tm_fc || '',
        tmEf: row.tm_ef || row.st_tm || '',
        tmYn: row.tm_yn || row.ed_tm || '',
        clrNtcTm: row.clr_ntc_tm || ''   // 자식 개별 해제예고 (warn-sasc/list·ready 에서 보존)
    };
}

/** 발효 row 만 — 메타 row (tm_fc 또는 warn_lvl_nm 부재) 제외. */
function _isLiveRow(row) {
    return !!(row && row.warn_lvl_nm && (row.tm_fc || row.tm_ef || row.st_tm));
}

/**
 * marine 실시간 endpoint 응답을 StateSnapshot 으로 변환.
 *
 * [V11 — 예비 병합 + allowlist]
 *   기존: warn/list(발효 부모) + warn-sasc/list(발효 자식) 만 사용.
 *         → warn/ready(예비) 가 통째로 버려져 예비특보 푸시가 전혀 안 됨 (구멍①).
 *         → 'warn_tp===5' 숫자 제외라 실시간 문자코드(폭풍해일 O, 강풍 W)가 유입 (구멍③④).
 *   변경: warn/ready + warn-sasc/ready 도 병합, allowlist(V/T) 적용.
 *
 * 우선순위: 발효중(warn/list) > 예비(warn/ready). 같은 zone 이 양쪽에 있으면 발효 유지.
 *
 * warn/ready 는 부모(S1 코드)와 마린 자식(S2·S3 코드, 이름에 '중…연안바다')이
 * 한 응답에 혼재 → _extractParent 로 부모/자식 분기.
 *
 * @param {Array} warnList     — fetchWarnList (발효 부모)
 * @param {Array} warnSascList — fetchWarnSascList (발효 자식)
 * @param {Array} warnReady     — fetchWarnReady (예비 부모+자식 혼재)
 * @param {Array} warnSascReady — fetchWarnSascReady (예비 자식 — 활성은 대개 강풍 육상)
 * @returns {StateSnapshot}
 */
function _buildSnapshotFromMarine(warnList, warnSascList, warnReady, warnSascReady) {
    const snap = new StateSnapshot();

    const addChild = (childName, row) => {
        const parent = _parentKeyForChild(childName);   // 역인덱스 우선 (self-key 고아 방지)
        snap.liveChildren.add(childName);   // [라이브 근거] 실제 row 출처 표식 (사후정리 화이트리스트)
        if (!snap.children.has(parent)) snap.children.set(parent, new Map());
        const m = snap.children.get(parent);
        if (m.has(childName)) return;   // 이미 등록(발효 우선) → skip
        m.set(childName, _rowToChildInfo(row));
    };

    // --- 1) 발효중 부모 (warn/list) ---
    for (const row of (warnList || [])) {
        if (!_isLiveRow(row)) continue;
        if (!_isTargetRealtimeType(row.warn_tp)) continue;   // 풍랑(V)+태풍(T) 만
        const name = _resolveZoneName(row);
        if (!name) continue;
        snap.parents.set(name, _rowToParentInfo(row));
    }
    // --- 2) 발효중 자식 (warn-sasc/list) ---
    //   [제외 자식 게이트] MMIS 는 부모에 '미포함'인 자식을 warn-sasc/list 에 warn_lvl='0'
    //   빈 메타행으로 명시한다(통보문 '연안바다 제외'). 그 명단을 모아 두었다가, 발표대기 GAP 의
    //   PARENT_TO_CHILDREN '무조건 합성'이 이 자식을 유령으로 끼워넣지 못하게 막는다. 정상 포함
    //   자식은 풀 행(warn_lvl≠0)으로 와서 여기 안 들어옴. (※ 반드시 list 기준 — warn-sasc/latest
    //   는 발효중 정상 자식까지 전부 warn_lvl='0' 으로 줘서 분별력이 없어 게이트 소스로 부적합.)
    for (const row of (warnSascList || [])) {
        const exName = _resolveZoneName(row);
        if (exName && String(row.warn_lvl || '') === '0') snap.excludedChildren.add(exName);
        if (!_isLiveRow(row)) continue;
        if (!_isTargetRealtimeType(row.warn_tp)) continue;
        const childName = _resolveZoneName(row);
        if (!childName) continue;
        addChild(childName, row);
    }
    // --- 3) 예비 (warn/ready) — 부모/자식 혼재. 발효중 우선 ---
    for (const row of (warnReady || [])) {
        if (!_isLiveRow(row)) continue;
        if (!_isTargetRealtimeType(row.warn_tp)) continue;
        const name = _resolveZoneName(row);
        if (!name) continue;
        if (!_isChildZoneCode(row.warn_zone_cd, name)) {
            // 부모형 예비 — 발효중이면 parents 는 유지하되, 예비를 upcomings 에 보관(병렬 표출용).
            //   [B] 과거엔 발효 우선으로 드롭했으나, 다가오는 특보를 별도 트랙으로 보존.
            if (snap.parents.has(name)) {
                if (!snap.upcomings.has(name)) snap.upcomings.set(name, _rowToParentInfo(row));
                continue;
            }
            snap.parents.set(name, _rowToParentInfo(row));
        } else {
            addChild(name, row);   // 자식형 예비 (addChild 가 발효 우선 보장)
        }
    }
    // --- 4) 예비 자식 (warn-sasc/ready) — 강풍 육상 등은 allowlist 가 자동 제외 ---
    for (const row of (warnSascReady || [])) {
        if (!_isLiveRow(row)) continue;
        if (!_isTargetRealtimeType(row.warn_tp)) continue;
        const childName = _resolveZoneName(row);
        if (!childName) continue;
        if (!_isChildZoneCode(row.warn_zone_cd, childName)) continue;   // 부모형이면 자식 endpoint 에선 skip
        addChild(childName, row);
    }
    return snap;
}

/**
 * [V10 — 정확한 해제시각 보강]
 *
 * warn/list 응답에는 "현재 발효 상태"만 들어있어, 해제예고가 범위형 텍스트
 * ("23일 3시 ~ 6시") 로만 노출되고 정확한 시각은 빠짐.
 * 반면 warn/latest 응답은 같은 zone 에 대한 "가장 최근 통보문" 을 제공하며,
 * 해제 통보문 발행 시 tm_ef 에 정확한 해제시각이 들어있음
 *  (예: "2026.05.23 01:00", warn_inpt_tm 은 통보문 발행시각보다 사전등록).
 *
 * 이 함수는 발효중 parent zone 의 clrNtcTm 을 warn/latest 의 정확한 tm_ef 로
 * 갱신해 사용자 앱에 정확한 시각이 표출되게 한다.
 *
 * 갱신 조건:
 *  1. 동일 zone 이 발효중 (snap.parents 에 존재)
 *  2. latest row 의 warn_cmd_nm === '해제'
 *  3. latest row 의 tm_ef 가 존재 (정확한 시각)
 *  4. 풍랑(V)·태풍(T) 만 — _isTargetRealtimeType allowlist (강풍 W·폭풍해일 O 등 제외)
 *
 * 갱신 후 clrNtcTm 은 mmis 원형식 ("2026.05.23 01:00") 으로 저장되어
 * _buildZoneTreeFromSnapshot 에서 normalizeMmisTime() 통과 시 "23일 01:00" 으로 변환됨.
 *
 * @param {StateSnapshot} snap
 * @param {Array} warnLatest — fetchWarnLatest() 응답 row 배열
 * @returns {StateSnapshot} (in-place 수정, 반환은 편의용)
 */
function _enrichSnapshotWithLatest(snap, warnLatest, prev, warnSascLatest) {
    if (!snap) return snap;
    let enriched = 0, gapAdded = 0, gapChildAdded = 0, gapChildCarried = 0, gapChildSynth = 0, efRefined = 0;
    let sascChildAdded = 0, sascChildEnriched = 0;

    // [수정A-3] warn-sasc/latest = 자식 통보문 endpoint (부모 warn/latest 의 자식판).
    //   각 자식의 개별 warn_tp/warn_cmd_nm/tm_ef/clr_ntc_tm 를 부모처럼 제공 →
    //   GAP(발표 발효대기) 동안 부모로부터 단순 상속/합성하던 것보다 정확.
    //   특히 "자식 3개 중 2개만 발표, 1개는 미발표" 같은 부분집합을 정확히 반영.
    //   (실제 통보문 가진 자식만 tp 세팅 — 나머지는 빈 메타행이라 자동 제외)
    //   발표대기(미래 발효시각) 자식만 GAP 로 추가. 발효중(snap.children) 은 그대로 우선.
    // [자식 해제 디바운스] 이번 사이클 warn-sasc/latest 에 '해제' 통보문이 있는 자식 집합 —
    //   "관리자가 미리 넣어둔 해제 데이터(해제예고)" 의 신호. 이 집합에 든 자식의 소멸은
    //   진짜 해제로 즉시 처리하고, 이 집합에 없이 사라지는 자식만 글리치 의심 → 디바운스.
    _childReleaseNoticeSet = new Set();
    if (Array.isArray(warnSascLatest)) {
        for (const row of warnSascLatest) {
            if (!_isTargetRealtimeType(row.warn_tp)) continue;   // 통보문 없는 빈 메타행 자동 제외
            const cname = _resolveZoneName(row);
            if (!cname) continue;
            if (!_isChildZoneCode(row.warn_zone_cd, cname)) continue;   // 부모형 행은 warn/latest 루프가 처리
            const parent = _parentKeyForChild(cname);   // 역인덱스 우선 (snap.children 키 일관)
            const cmd = String(row.warn_cmd_nm || '').trim();

            if (cmd === '해제') {
                _childReleaseNoticeSet.add(cname);   // 해제 통보문 있는 자식 (디바운스 면제 신호)
                // 발효중 자식의 정확한 해제예고시각 보강 (부모 해제 보강의 자식판)
                const m = snap.children.get(parent);
                if (m && m.has(cname)) {
                    const ci = m.get(cname);
                    const t = String(row.tm_ef || '').trim();
                    if (t) { ci.clrNtcTm = t; m.set(cname, ci); sascChildEnriched++; }
                }
                continue;
            }
            if (!['발표', '변경', '연장'].includes(cmd)) continue;
            const childClr = String(row.clr_ntc_tm || '').trim();   // 자식 개별 해제예고
            // 이미 발효중/예비(snap.children) 인 자식 — GAP 추가 skip, 단 자기 통보문의
            //   해제예고를 보강 (warn-sasc/list 가 clr 을 안 줄 때 자식 고유값 채움).
            //   부모값에 종속하지 않고 자식 자신의 통보문에서만 가져옴.
            if (snap.children.has(parent) && snap.children.get(parent).has(cname)) {
                const ci = snap.children.get(parent).get(cname);
                if (childClr && !String(ci.clrNtcTm || '').trim()) {
                    ci.clrNtcTm = childClr; sascChildEnriched++;
                }
                continue;
            }
            const ctmEf = String(row.tm_ef || '').trim();
            if (!ctmEf || !_isFutureExactTime(ctmEf)) continue;   // 정확·미래 발효시각(발표대기)만
            if (!snap.children.has(parent)) snap.children.set(parent, new Map());
            const cinfo = _rowToChildInfo(row);
            cinfo.wrnLvlNm = '예비';            // 발효 전 → 예비 취급
            cinfo.wrnLvl = cinfo.wrnLvl || '1';
            cinfo.clrNtcTm = childClr;          // 자식 개별 해제예고 (부모 비종속)
            snap.children.get(parent).set(cname, cinfo);
            snap.liveChildren.add(cname);   // [라이브 근거] 자식 자신의 통보문(발표/변경/연장) → 사후정리 화이트리스트
            sascChildAdded++;
        }
    }

    if (!Array.isArray(warnLatest) || warnLatest.length === 0) {
        if (sascChildAdded > 0) console.log(`[Marine] warn-sasc/latest GAP 자식: ${sascChildAdded} 자식 발표대기로 추가`);
        if (sascChildEnriched > 0) console.log(`[Marine] warn-sasc/latest 자식 해제예고 보강: ${sascChildEnriched}`);
        return snap;
    }
    for (const row of warnLatest) {
        if (!_isTargetRealtimeType(row.warn_tp)) continue;   // 풍랑(V)+태풍(T) 만 (실시간 문자코드)
        const cmd = String(row.warn_cmd_nm || '').trim();
        const name = _resolveZoneName(row);
        if (!name) continue;

        if (cmd === '해제') {
            // [V10] 해제 통보문 → 발효중 zone 의 정확한 해제시각(clrNtcTm) 보강
            if (!snap.parents.has(name)) continue;  // 발효중인 zone 만 보강
            const tmEf = String(row.tm_ef || '').trim();
            if (!tmEf) continue;
            const info = snap.parents.get(name);
            info.clrNtcTm = tmEf;   // mmis 원형식 유지 — 표시 시 normalize
            // [§7.7.20] 정식 해제 통보문(cmd='해제')의 해제시각 확정 마킹 — diff 가 소비해
            //   time_yn_confirm 1회 발사. (같은 모멘트 범위↔정확 흡수로 무푸시 되던 빈틈 메움.)
            info._clrConfirmed = { tmEf: tmEf };
            snap.parents.set(name, info);
            enriched++;
            continue;
        }

        // [GAP 보강] "발표 발효대기" — 발표/변경/연장 통보문이 나왔으나 발효시각이
        //   아직 미래라 warn/list(발효중)·warn/ready(예비) 어디에도 없는 중간 상태.
        //   이 zone 이 누락되어 앱에서 사라지고 "발효시각 변경" 푸시도 안 나가던 문제.
        //   → 발효 전이므로 예비(upcoming)로 스냅샷에 추가 (정확한 tm_ef 보존).
        //     앱 표시=예비(발효예정 정확시각), 푸시=범위→정확 time_ef_change.
        //   발효시각 도래 시 warn/list / warn-sasc/list 로 인계되어 정식(발효)으로 전환됨.
        // publish 계열(발표/변경/연장) + '변경해제'(격상/격하 해제부) 통과. '변경해제' 는 발효중
        //   zone 공존 격하 판정에만 쓰고, 아래에서 신규 GAP 부모 생성은 publish 계열로만 제한.
        const isPublishCmd = ['발표', '변경', '연장'].includes(cmd);
        if (!isPublishCmd && cmd !== '변경해제') continue;
        const tmEf = String(row.tm_ef || '').trim();
        if (!tmEf || !_isFutureExactTime(tmEf)) continue;  // 정확·미래 발효시각만 (발표 발효대기)
        if (!_isChildZoneCode(row.warn_zone_cd, name)) {
            const info = _rowToParentInfo(row);
            info._realLvlNm = info.wrnLvlNm;   // [B] 실제 등급 보존 (예비 덮어쓰기 전) — 공존 격상/격하용
            info.wrnLvlNm = '예비';   // 발효 전 → 예비 취급 (표시·푸시 일관성)
            info.wrnLvl = info.wrnLvl || '1';
            // [§7.7.25] 이미 예비인 해역이면 "범위형 → 정확시각" 정밀화만 반영하고 나머지는 종전대로 skip.
            if (isPublishCmd && _refineUpcomingExactEf(snap, name, info)) efRefined++;
            // [B] 발효중 zone 과 공존하는 상·하위/다른종류 → upcomings 보강 (격상/격하 발표).
            if (_tryAddCoexistingUpcoming(snap, name, info)) continue;
            // 부모형 — 발효중/예비면 그쪽 우선
            if (!isPublishCmd) continue;   // '변경해제' 는 공존 격하 전용 — 신규 GAP 부모 생성 안 함
            if (snap.parents.has(name)) continue;
            snap.parents.set(name, info);
            gapAdded++;
            // [수정A] warn/latest 는 자식 행을 주지 않으므로(부모만), 발표대기 동안
            //   자식이 "특보 없음"/"미발효"로 표출되던 문제 해결.
            //   1순위: 예비 단계에 있던 자식(prev.children) 이어받기 — 실제 대상 자식의
            //          정확한 부분집합 보존 (일부만 발효/예비였던 경우 대응).
            //   2순위[수정A-2]: prev 가 비어있으면(이미 GAP 진입해 자식을 잃은 경우 등)
            //          PARENT_TO_CHILDREN 매핑으로 자식 합성 — mmis 가 GAP 에서 자식을
            //          부모로부터 상속해 표출하는 것과 동일. 부모 발효예정/해제예고 상속.
            if (!snap.children.has(name)) {
                const pkids = (prev && prev.children) ? prev.children.get(name) : null;
                if (pkids && pkids.size > 0) {
                    const m = new Map();
                    for (const [cn, ci] of pkids) {
                        const cc = Object.assign({}, ci);
                        cc.wrnLvlNm = '예비';          // 발효 전
                        cc.tmEf = info.tmEf;            // 부모의 새 발효예정 정확시각 상속
                        cc.clrNtcTm = info.clrNtcTm;   // 부모 해제예고 상속
                        m.set(cn, cc);
                    }
                    snap.children.set(name, m);
                    gapChildCarried += m.size;
                } else {
                    const mapped = PARENT_TO_CHILDREN[name] || [];
                    if (mapped.length > 0) {
                        const m = new Map();
                        for (const cn of mapped) {
                            // [제외 자식 게이트] MMIS 가 warn-sasc/list 에서 미포함(warn_lvl=0)이라
                            //   명시한 자식은 합성하지 않음 — 통보문 '연안바다 제외'를 맹목 합성이
                            //   '포함'으로 뒤집던 버그 차단. (prev-carry 분기·디바운스는 무수정.)
                            if (snap.excludedChildren.has(cn)) continue;
                            m.set(cn, {
                                wrnTp: info.wrnTp,
                                wrnTpNm: info.wrnTpNm,
                                wrnLvl: '1',
                                wrnLvlNm: '예비',
                                tmFc: info.tmFc,
                                tmEf: info.tmEf,         // 부모 발효예정 상속
                                tmYn: info.tmYn,
                                clrNtcTm: info.clrNtcTm  // 부모 해제예고 상속
                            });
                        }
                        if (m.size > 0) {
                            snap.children.set(name, m);
                            gapChildSynth += m.size;
                        }
                    }
                }
            }
            // [2026-07-18 실사고] 자식이 전혀 못 실린 GAP 부모 — 전이 창 '미상' 표식
            //   (_addGapParentFromEf 의 동일 표식과 한 쌍 — 푸시 한정사 "미발표" 단정 억제 전용).
            if ((!snap.children.has(name) || snap.children.get(name).size === 0)
                && (PARENT_TO_CHILDREN[name] || []).length > 0) info._childUnknown = true;
        } else {
            // 자식형 행 (warn/latest 가 자식을 주는 경우 — 현재는 거의 없음). 발효중/예비면 그쪽 우선.
            const parent = _parentKeyForChild(name);   // 역인덱스 우선 (snap.children 키 일관)
            if (!snap.children.has(parent)) snap.children.set(parent, new Map());
            const m = snap.children.get(parent);
            if (m.has(name)) continue;
            const cinfo = _rowToChildInfo(row);
            cinfo.wrnLvlNm = '예비';
            cinfo.wrnLvl = cinfo.wrnLvl || '1';
            m.set(name, cinfo);
            snap.liveChildren.add(name);   // [라이브 근거] 자식 자신의 통보문(warn/latest 자식행) → 사후정리 화이트리스트
            gapChildAdded++;
        }
    }
    if (efRefined > 0) console.log(`[Marine] warn/latest 발효시각 정밀화: ${efRefined} zone 범위→정확 (§7.7.25)`);
    if (enriched > 0) console.log(`[Marine] warn/latest 보강: ${enriched} zone clrNtcTm 갱신`);
    if (gapAdded > 0) console.log(`[Marine] warn/latest GAP 보강: ${gapAdded} 부모 발표 발효대기 → 예비로 추가`);
    if (gapChildCarried > 0) console.log(`[Marine] GAP 자식 이어받기(prev): ${gapChildCarried} 자식 발표대기로 carry`);
    if (gapChildSynth > 0) console.log(`[Marine] GAP 자식 합성(매핑): ${gapChildSynth} 자식 발표대기로 추가`);
    if (gapChildAdded > 0) console.log(`[Marine] warn/latest GAP 보강(자식행): ${gapChildAdded} 자식 추가`);
    if (sascChildAdded > 0) console.log(`[Marine] warn-sasc/latest GAP 자식: ${sascChildAdded} 자식 발표대기로 추가`);
    if (sascChildEnriched > 0) console.log(`[Marine] warn-sasc/latest 자식 해제예고 보강: ${sascChildEnriched}`);
    return snap;
}

/** "YYYY.MM.DD HH:MM" / "YYYY-MM-DD HH:MM" 정확시각이 현재(KST)보다 미래인지. 범위형 등은 false. */
function _isFutureExactTime(tmStr) {
    const m = String(tmStr).match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]);  // KST → UTC epoch
    return t > Date.now();
}

// ============================================================================
// [발표대기 보강 — ef/list (인증 endpoint)]
//   문제: 발표됐으나 발효시각이 미래라 warn/list(발효중)·warn/ready(예비)·warn/latest
//         (발표대기 브릿지) 어디에도 안 잡히는 "발표 발효대기" 특보가 발표~발효 사이
//         (수시간) 동안 앱에서 사라지던 문제. warn/latest 가 통보문을 잠깐만 보유해
//         그 사이 GAP 보강 소스가 비면 특보가 무음으로 누락됨.
//   해결: 인증 endpoint warn/ef/list 는 발효 전 특보도 "발효시각(ed_tm)" 과 함께 계속
//         보유하므로, 실시간 endpoint 가 놓친 발표대기 zone 을 이걸로 메운다.
//   범용성: 특정 해역 전용이 아니라 "발표됨 + 발효시각 미래 + 실시간 endpoint 미수록"
//         조건의 모든 대상(풍랑/태풍, 부모·자식, 발표/변경/연장)에 일반 적용.
//   안전성: 인증 미설정·실패 시 캐시(직전 성공분, TTL) fallback → 기존 동작 유지.
//         _isFutureExactTime 가드로 발효시각 경과분은 자동 제외(유령특보 방지).
// ============================================================================
let _efListCache = { rows: [], at: 0 };
const EF_LIST_CACHE_TTL_MS = 30 * 60 * 1000;   // 30분 — 인증 일시 실패 시 직전 성공분 재사용

// ============================================================================
// [발송이력 dedup] "이 통보문(발표)을 사용자에게 푸시한 적 있나" 를 통보문 단위로 영속 기록.
//   목적: ef/list 로만 처음 발견된 발표대기 특보(발표 순간 warn/latest 창을 놓친 경우)도
//         이력에 없으면 1회 발송하여 "신규인데 미발송" 공백을 메우되, 이미 발송된 통보문은
//         재푸시하지 않는다(배포/공백 복귀 시 중복 방지). 재배포에도 유지되도록 디스크 영속.
//   키: "zone|종류|발표시각(tmFc)" — tmFc 는 _applyAnnounceAnchor 로 고정되어 경로(warn/latest
//       ↔ ef/list)·사이클과 무관하게 동일 통보문이면 같은 값으로 수렴(키 안정).
// ============================================================================
const PUSHED_PUBS_FILE = path.join(__dirname, 'data', 'marine_pushed_pubs.json');
const PUSHED_PUB_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7일 — 오래된 통보문 이력 정리
let _pushedPubs = null;       // Map(key → lastSeenMs), lazy-load
let _pushedPubsDirty = false;

function _loadPushedPubs() {
    if (_pushedPubs) return _pushedPubs;
    _pushedPubs = new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(PUSHED_PUBS_FILE, 'utf8'));
        const now = Date.now();
        for (const k of Object.keys(raw)) {
            if (now - raw[k] < PUSHED_PUB_TTL_MS) _pushedPubs.set(k, raw[k]);
        }
    } catch (_) { /* 파일 없음/파싱실패 → 빈 이력 */ }
    return _pushedPubs;
}

function _savePushedPubs() {
    if (!_pushedPubs || !_pushedPubsDirty) return;
    try {
        const now = Date.now();
        const obj = {};
        for (const [k, ms] of _pushedPubs) if (now - ms < PUSHED_PUB_TTL_MS) obj[k] = ms;
        fs.writeFileSync(PUSHED_PUBS_FILE, JSON.stringify(obj), 'utf8');
        _pushedPubsDirty = false;
    } catch (e) {
        console.warn('[Marine] pushed_pubs 저장 실패:', e && e.message);
    }
}

/** 통보문(발표) 식별 키 — zone + 종류 + 발표시각(tmFc, anchor 고정). */
function _pubKey(zone, info) {
    const tp = (info && (info.wrnTpNm || info.wrnTp)) || '';
    const fc = (info && info.tmFc) || '';
    return `${zone}|${tp}|${fc}`;
}

// ============================================================================
// [해제예고 확정 dedup] (§7.7.20) 정식 해제 통보문(warn/latest cmd='해제')의 "해제시각 확정"
//   푸시(time_yn_confirm)를 통보문 모멘트 단위로 1회만 발사하기 위한 영속 이력.
//   키: "zone|종류|해제모멘트키(_timeKey(tm_ef))" — 같은 해제시각의 재발행·범위↔정확 깜빡임·
//   매사이클 재유입·서버 재시작 모두 동일 키로 수렴해 재푸시가 없다. TTL 7일.
//   [초기 시드] 파일이 없으면(기능 첫 배포/볼륨 유실) 현재 스냅샷에 이미 등록된 해제예고
//   통보문을 "알림 완료"로 시드해 배포 직후 과거 통보문에 대한 뒷북 푸시를 막는다.
// ============================================================================
const CLR_CONFIRMS_FILE = path.join(__dirname, 'data', 'marine_clr_confirms.json');
const CLR_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7일
let _clrConfirms = null;          // Map(key → lastSeenMs), lazy-load
let _clrConfirmsDirty = false;
let _clrConfirmsFirstRun = false; // 파일 부재(첫 배포/유실) → 첫 diff 사이클에 시드

function _loadClrConfirms() {
    if (_clrConfirms) return _clrConfirms;
    _clrConfirms = new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(CLR_CONFIRMS_FILE, 'utf8'));
        const now = Date.now();
        for (const k of Object.keys(raw)) {
            if (now - raw[k] < CLR_CONFIRM_TTL_MS) _clrConfirms.set(k, raw[k]);
        }
    } catch (_) { _clrConfirmsFirstRun = true; /* 파일 없음/파싱실패 → 시드 대상 */ }
    return _clrConfirms;
}

function _saveClrConfirms() {
    if (!_clrConfirms || !_clrConfirmsDirty) return;
    try {
        const now = Date.now();
        const obj = {};
        for (const [k, ms] of _clrConfirms) if (now - ms < CLR_CONFIRM_TTL_MS) obj[k] = ms;
        fs.writeFileSync(CLR_CONFIRMS_FILE, JSON.stringify(obj), 'utf8');
        _clrConfirmsDirty = false;
    } catch (e) {
        console.warn('[Marine] clr_confirms 저장 실패:', e && e.message);
    }
}

/** 해제예고 확정 키 — zone + 종류 + 해제 모멘트 키(파싱 불가 시 원문). */
function _clrConfirmKey(zone, info, tmEf) {
    const tp = (info && (info.wrnTpNm || info.wrnTp)) || '';
    const mk = _timeKey(tmEf);
    return `${zone}|${tp}|${mk != null ? mk : tmEf}`;
}

/** ef/list 의 한글 종류명 → 실시간 문자코드 (스냅샷 일관성용). 대상 외는 ''. */
function _efTpChar(tpNm) {
    if (tpNm === '태풍') return 'T';
    if (tpNm === '풍랑') return 'V';
    return '';
}

/** ef/list row → 내부 부모/자식 info. 발표대기이므로 '예비' 로 취급, tmEf = 발효시각(ed_tm). */
function _efRowToInfo(row) {
    const tpNm = String(row.warn_tp_nm || '');
    return {
        wrnTp: _efTpChar(tpNm),
        wrnTpNm: tpNm,
        wrnLvl: '1',
        wrnLvlNm: '예비',                 // 발효 전 → 예비 취급 (표시·푸시 일관성, 기존 GAP 과 동일)
        _realLvlNm: _normLvlNm(row.warn_lvl_nm),   // [B] 실제 등급(경보/주의보) — 발효중 zone 공존 격상/격하 판정·표출용 (평상시 미사용)
        tmFc: row.tm_fc || row.st_tm || '',
        tmEf: row.ed_tm || '',            // [검증됨] ef/list 의 ed_tm = 발효(예정)시각 (정확시각)
        tmYn: '',
        clrNtcTm: '',
        _efBridged: true                  // [표시전용 표식] ef/list 보강분 — 사용자 푸시 생성 제외(재푸시 방지)
    };
}

/** GAP 부모를 snap 에 추가하면서 자식을 prev 이어받기 또는 매핑 합성 (warn/latest GAP 과 동일 정책). */
function _addGapParentFromEf(snap, prev, name, info, counters) {
    if (snap.parents.has(name)) return;        // 발효중/예비면 그쪽 우선
    snap.parents.set(name, info);
    counters.gapAdded++;
    if (snap.children.has(name)) {
        // [2026-07-18 실사고] 컨테이너가 있어도 비어 있으면 자식 정보 '미상' — 아래 주석 참조
        if (snap.children.get(name).size === 0 && (PARENT_TO_CHILDREN[name] || []).length > 0) info._childUnknown = true;
        return;
    }
    const pkids = (prev && prev.children) ? prev.children.get(name) : null;
    if (pkids && pkids.size > 0) {
        const m = new Map();
        for (const [cn, ci] of pkids) {
            const cc = Object.assign({}, ci);
            cc.wrnLvlNm = '예비';
            cc.tmEf = info.tmEf;               // 부모의 새 발효예정 정확시각 상속
            cc.clrNtcTm = info.clrNtcTm;
            m.set(cn, cc);
        }
        snap.children.set(name, m);
        counters.gapChildCarried += m.size;
        return;
    }
    const mapped = PARENT_TO_CHILDREN[name] || [];
    if (mapped.length > 0) {
        const m = new Map();
        for (const cn of mapped) {
            // [제외 자식 게이트] warn-sasc/list 에서 미포함(warn_lvl=0)으로 명시된 자식은 합성 안 함.
            if (snap.excludedChildren.has(cn)) continue;
            m.set(cn, {
                wrnTp: info.wrnTp, wrnTpNm: info.wrnTpNm, wrnLvl: '1', wrnLvlNm: '예비',
                tmFc: info.tmFc, tmEf: info.tmEf, tmYn: info.tmYn, clrNtcTm: info.clrNtcTm
            });
        }
        if (m.size > 0) {
            snap.children.set(name, m);
            counters.gapChildSynth += m.size;
        }
    }
    // [2026-07-18 실사고] carry 0·synth 0 으로 자식이 전혀 못 실린 GAP 부모 — 전이 창의 '미상' 표식.
    //   이 창에서는 sasc/list 의 제외행(warn_lvl=0)조차 미확정이다 (7/18 05:12 "미포함" 표기가
    //   2분 뒤 포함 4자식 합류로 뒤집힘 실측). 푸시 한정사의 "미발표" 단정 억제 전용 —
    //   특보 판정·발송 분기(디바운스·보류실·dedup)에는 불사용.
    if ((!snap.children.has(name) || snap.children.get(name).size === 0)
        && (PARENT_TO_CHILDREN[name] || []).length > 0) info._childUnknown = true;
}

/**
 * [B — 발효중 zone 공존 격상/격하 발표대기 보강]
 *   이미 발효중(warn/list)인 해역에, 등급이나 종류가 다른 "발표대기" 통보문(예: 풍랑주의보
 *   발효중 → 풍랑경보 발표·발효예정)이 ef/list·warn/latest 에 올 때, 기존 로직은
 *   `snap.parents.has(name)` 가드에 걸려 그 격상/격하 발표를 통째로 누락했다.
 *   → 발효중 active 와 등급/종류가 다르면 upcomings 로 보강하여
 *     (a) 앱에 "다가오는 특보"로 병렬 표출, (b) UPCOMING_CHANGE → 격상/격하 발표 푸시 발사.
 *
 *   [안전 설계] wrnLvlNm 은 '예비' 로 유지(분류 불변 → 매처/디바운스/dedup/표시 정책 무영향),
 *     실제 등급은 별도 wrnLvlReal 에 보존. 푸시 점수 비교(push_sender.getAlertScore)와
 *     표출 배지는 wrnLvlReal 을 우선 사용해 active 대비 정확한 격상/격하 방향을 산출한다.
 *     (LVL_RANK 에서 '예비'='주의보' 동점이라, wrnLvlReal 없이는 주의보→경보 격상이 동점
 *      처리돼 발사되지 않음 — 이 필드가 핵심.)
 *   _efBridged 표식을 달아 깜빡임(ef/latest 진동) 시 _pubKey dedup 으로 1회만 발사되게 한다.
 *
 * @returns {boolean} 발효중 zone 과 공존 처리했으면(또는 이미 upcoming 점유) true — 호출측은
 *                    이후 신규 GAP 부모 생성을 건너뛴다. 발효중 아님/동급·동종이면 false.
 */
function _tryAddCoexistingUpcoming(snap, name, info) {
    const active = snap.parents ? snap.parents.get(name) : null;
    // 발효중(정식)이 아니면 일반 GAP 경로로 — 예비/해제 부모는 대상 아님
    if (!active || !active.wrnLvlNm || active.wrnLvlNm === '예비' || active.wrnLvlNm === '해제') return false;
    const realLvl = info._realLvlNm || info.wrnLvlNm || '';
    const realTp = info.wrnTpNm || '';
    const lvlDiffers = realLvl && realLvl !== active.wrnLvlNm;
    const tpDiffers = realTp && active.wrnTpNm && realTp !== active.wrnTpNm;
    if (!lvlDiffers && !tpDiffers) return false;   // 동급·동종 → 단순 시각변경(기존 경로), 공존 아님
    if (!snap.upcomings) snap.upcomings = new Map();
    if (snap.upcomings.has(name)) return true;     // 이미 다가오는(예비) 점유 — warn/ready 우선, 덮어쓰지 않음
    const up = Object.assign({}, info);
    up.wrnLvlNm = '예비';            // 분류 유지 (매처/디바운스/dedup/표시 정책 불변)
    up.wrnLvlReal = realLvl;         // [신규] 실제 등급 — 푸시 점수·표출 배지 전용
    up._efBridged = true;            // 깜빡임 재발사 방지 (_pubKey dedup 연동)
    delete up._realLvlNm;
    snap.upcomings.set(name, up);
    return true;
}

/**
 * [2026-08-06 실사고 §7.7.25] 이미 예비로 잡혀 있는 해역의 발효예정 "정밀화" 반영.
 *   배경: GAP 보강 2경로(warn/latest·ef/list)는 "발효중/예비면 그쪽 우선" 가드로 통보문 행을
 *   통째로 버린다. 그래서 예고가 범위형("8/6 06~12시")인 상태에서 기상청이 발표 통보문으로
 *   정확시각("11시")을 확정해도, 그 정확시각이 범위 "안"이면 MMIS 예비 목록이 갱신되지 않아
 *   우리 스냅샷에 영원히 안 들어오고 사용자는 확정 시각을 통지받지 못했다(8/6 제주 2해역 실측).
 *   → 등급·종류·해역 구성은 일절 건드리지 않고, "범위형 → 정확시각" 정밀화일 때만 tmEf 갱신.
 *   갱신 사실은 _efExactFrom 표식으로 남겨 경계(정확시각 = 범위 끝, 예: 12시) 동일모멘트
 *   흡수로 침묵하던 케이스도 1회 발사되게 한다(해제측 §7.7.20 _clrConfirmed 와 같은 취지).
 * 예: 예비 tmEf "2026.08.06 06~12시" + 통보문 ed_tm "2026.08.06 11:00" → tmEf 11:00 으로 정밀화
 * @param {StateSnapshot} snap - 현재 사이클 스냅샷
 * @param {string} name - 부모 해역명
 * @param {Object} info - 통보문 행에서 만든 info (_rowToParentInfo/_efRowToInfo 결과)
 * @returns {boolean} 정밀화가 일어났으면 true (로그 카운터용)
 * [연계] ← _enrichSnapshotWithLatest · _enrichSnapshotWithEfList (이 파일) — GAP 스킵 직전 호출
 *        → _buildUserPushChanges 가 _efExactFrom 을 읽어 UPCOMING_CHANGE 발사 → push_sender
 *          time_ef_change("🕐 발효시각 변경") 로 매핑된다.
 */
function _refineUpcomingExactEf(snap, name, info) {
    const cur = (snap.upcomings && snap.upcomings.get(name)) || (snap.parents && snap.parents.get(name));
    if (!cur || cur.wrnLvlNm !== '예비') return false;              // 예비(발효 전)만 — 발효중은 tmEf 무의미
    if ((cur.wrnTpNm || '') !== (info.wrnTpNm || '')) return false; // 종류 일치 필수 (풍랑↔태풍 오염 방지)
    const inc = String(info.tmEf || '').trim();
    if (!inc || _isRangeTime(inc)) return false;                    // 통보문이 정확시각일 때만
    const old = String(cur.tmEf || '').trim();
    if (!old || !_isRangeTime(old)) return false;                   // 범위형 → 정확 정밀화만 (정확↔정확은 기존 경로)
    cur.tmEf = inc;
    cur._efExactFrom = old;                                         // [표식] 이번 사이클 정밀화 (경계 발사용)
    return true;
}

/**
 * ef/list 행들로 발표대기 zone 을 snap 에 보강.
 * @param {StateSnapshot} snap - 현재 사이클 스냅샷 (parents/children/upcomings)
 * @param {Array} efRows - warn/ef/list 응답 row 배열
 * @param {StateSnapshot} prev - 직전 스냅샷 (자식 이어받기용)
 */
function _enrichSnapshotWithEfList(snap, efRows, prev) {
    if (!snap || !Array.isArray(efRows) || efRows.length === 0) return snap;
    // zone 별 최신 행 선택: tm_fc 최신 → tm_seq 최대 (여러 통보office/seq 중 가장 최근 상태).
    //   [영향 격리] 두 셀렉션을 분리한다:
    //     - latestByZone   : publish 계열(발표/변경/연장)만 — 신규 발표대기 GAP 생성용.
    //                        '변경해제' 를 섞으면 같은 zone 의 publish 행을 밀어내(최신 우선)
    //                        기존 GAP 생성이 누락될 수 있어, 이 셀렉션은 기존과 100% 동일 유지.
    //     - coexistByZone  : publish + '변경해제' — 발효중 zone 공존 격상/격하 판정 전용(가산만).
    const PUBLISH_CMDS = new Set(['발표', '변경', '연장']);
    const latestByZone = new Map();
    const coexistByZone = new Map();
    for (const row of efRows) {
        const tpNm = String(row.warn_tp_nm || '');
        if (tpNm !== '풍랑' && tpNm !== '태풍') continue;            // 앱 대상 종류만
        const cmd = String(row.warn_cmd_nm || '').trim();
        // '변경해제' 는 격상/격하의 해제부(옛 등급 종료)일 수 있어 발효중 공존 판정에 필요 →
        //   통과시키되, _isFutureExactTime(ed) 가드로 순수해제(ed=과거)는 배제.
        if (!['발표', '변경', '연장', '변경해제'].includes(cmd)) continue;
        const name = _resolveZoneName(row);
        if (!name) continue;
        const ed = String(row.ed_tm || '').trim();
        if (!_isFutureExactTime(ed)) continue;                      // 발효시각 미래(=발표대기)만
        const key = String(row.tm_fc || '') + '#' + String(row.tm_seq || 0).padStart(4, '0');
        const cx = coexistByZone.get(name);                         // 공존 판정용(모든 통과 cmd)
        if (!cx || key > cx.key) coexistByZone.set(name, { key, row });
        if (PUBLISH_CMDS.has(cmd)) {                                // 신규 GAP 선택용(publish 만 — 기존 동작 보존)
            const sel = latestByZone.get(name);
            if (!sel || key > sel.key) latestByZone.set(name, { key, row });
        }
    }
    const counters = { gapAdded: 0, gapChildCarried: 0, gapChildSynth: 0 };
    // [B] 1차: 발효중 zone 공존 격상/격하 → upcomings 보강 (가산만, 발효중 아니면 무동작).
    for (const [name, sel] of coexistByZone) {
        _tryAddCoexistingUpcoming(snap, name, _efRowToInfo(sel.row));
    }
    // 2차: 신규 발표대기 GAP (publish 계열만 — 기존 로직 그대로).
    for (const [name, sel] of latestByZone) {
        const info = _efRowToInfo(sel.row);
        // [§7.7.25] 스킵 전에 "범위형 → 정확시각" 정밀화만 반영 (등급·종류·구성 불변).
        if (_refineUpcomingExactEf(snap, name, info)) counters.efRefined = (counters.efRefined || 0) + 1;
        // 실시간 endpoint 가 이미 커버(발효중/예비/발표대기/공존)하면 skip — 중복/덮어쓰기 방지.
        if (snap.parents.has(name)) continue;
        if (snap.upcomings && snap.upcomings.has(name)) continue;
        if (!_isChildZoneCode(sel.row.warn_zone_cd, name)) {
            _addGapParentFromEf(snap, prev, name, info, counters);
        } else {
            // 자식형 행 (드묾) — 부모 컨테이너에 예비로 추가.
            const parent = _parentKeyForChild(name);   // 역인덱스 우선 (snap.children 키 일관)
            if (!snap.children.has(parent)) snap.children.set(parent, new Map());
            const m = snap.children.get(parent);
            if (!m.has(name)) {
                m.set(name, info);
                snap.liveChildren.add(name);   // [라이브 근거] ef/list 자식 자신의 통보문 → 사후정리 화이트리스트
                counters.gapChildSynth++;
            }
        }
    }
    if (counters.efRefined) console.log(`[Marine] ef/list 발효시각 정밀화: ${counters.efRefined} zone 범위→정확 (§7.7.25)`);
    if (counters.gapAdded || counters.gapChildCarried || counters.gapChildSynth) {
        console.log(`[Marine] ef/list 발표대기 보강: 부모 ${counters.gapAdded} 추가 ` +
            `(자식 carry ${counters.gapChildCarried} / synth ${counters.gapChildSynth})`);
    }
    return snap;
}

/** ef/list 를 KST 어제~내일 윈도우로 조회 (발표대기 특보 포착). 인증 미설정 시 []. */
async function _fetchEfListForGap() {
    if (!marineClient || typeof marineClient.fetchWarnEfList !== 'function') return [];
    const kst = new Date(Date.now() + 9 * 3600000);
    const ymd = (offDays) => {
        const d = new Date(kst.getTime() + offDays * 86400000);
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const rows = await marineClient.fetchWarnEfList({ st_tm: ymd(-1), ed_tm: ymd(1) });
    return Array.isArray(rows) ? rows : [];
}

// ============================================================================
// [Followup Critical-1] run() — scheduler 의 1분 cron 에서 호출되는 진입점
// ============================================================================
//
// 한 사이클:
//   1) marine_client 4 endpoint 호출 (비로그인 — 자격증명 불필요)
//   2) prev snapshot (디스크 복원) vs curr snapshot diff
//   3) DiffMatrix → EventDispatcher → flushParent (관리자 푸시)
//   4) curr snapshot 을 디스크에 저장 (다음 사이클의 prev)
//
// 자격증명 없는 경우:
//   비로그인 endpoint (warn/list, warn-sasc/list, warn/ready, warn-sasc/ready) 는
//   호출 가능 — AUTH_ENABLED 와 무관. 인증 endpoint (ef/list) 만 skip 되므로
//   timeline diff 가 비활성화될 뿐, 본 cycle 은 정상 진행.
let _runInProgress = false;

/**
 * StateSnapshot 이 "비어있는지" 판정 — 첫 부팅 guard 용.
 *   parents / children 모두 비었으면 true. 한 발효라도 있으면 false.
 */
function _isSnapshotEmpty(snap) {
    if (!snap) return true;
    if (snap.parents && snap.parents.size > 0) return false;
    if (snap.children && snap.children.size > 0) return false;
    return true;
}

/**
 * [테스트] diff 기준점(prev 스냅샷) 초기화.
 *   메모리 _prevSnapshot 과 디스크 state 파일을 비운다.
 *   이후 run({forceBaselinePush:true}) 를 호출하면 현재 활성 특보가 신규로 감지돼
 *   실제 푸시가 발사된다 (관리자 "장부 초기화" 버튼 전용).
 */
// [리셋 경합 방어] resetState 가 1회성 force-baseline 을 예약하는 플래그.
//   리셋 직후 run({force}) 가 마침 진행중인 cron 과 겹쳐 early-return 되어도,
//   이 플래그가 남아 다음 사이클(또는 즉시 run)이 강제 baseline 푸시를 보장한다.
let _forceBaselinePending = false;
// [4차 통합검증 1 — 치명] 예약이 cron 에 넘어갈 때 관리자 토큰이 유실되어 "관리자 기기 테스트"
//   가 전체 사용자 브로드캐스트로 둔갑하던 문제 — 겹침(early-return) 시 토큰을 함께 보존한다.
let _forceBaselineAdminToken = undefined;

function resetState() {
    _prevSnapshot = new StateSnapshot();
    _forceBaselinePending = true;
    try {
        _savePrevSnapshot(_prevSnapshot);
        console.log('[Marine] 장부(state) 초기화 완료 — 다음 사이클에서 현재 특보를 신규로 감지(force baseline 예약)');
    } catch (e) {
        console.error('[Marine] resetState 실패:', e && e.message);
    }
}

async function run(opts = {}) {
    if (_runInProgress) {
        // 중복 실행 방지. [4차 통합검증 1] 관리자 테스트 run 이 진행중 cron 과 겹쳐 여기서
        //   반환되면 resetState 의 예약 플래그만 남는다 — 토큰을 보존해 다음 사이클(cron)이
        //   예약을 소비할 때 전체 브로드캐스트가 아닌 관리자 기기 한정으로 발사되게 한다.
        if (opts.forceBaselinePush && opts.adminToken) _forceBaselineAdminToken = opts.adminToken;
        return [];
    }
    if (!marineClient) {
        console.warn('[marine_warning_crawler] marine_client 미로드 — skip');
        return [];
    }
    _runInProgress = true;
    try {
        // prev snapshot 부팅 시 1회 복원 — 첫 호출 lazy 로드.
        const isFirstLoad = (_prevSnapshot === null);
        if (isFirstLoad) {
            _prevSnapshot = _loadPrevSnapshot();
        }

        // 1) endpoint 4종 fetch — [Followup E-4] 부분 실패 시 이번 cycle 통째 skip.
        //    Promise.allSettled 묶음 호출 결과를 marine_client.fetchAllRealtimeEndpoints 가
        //    검사하고, 하나라도 rejected 면 throw → 마지막 성공 state 유지, push 0회.
        //    정상 빈 응답 (zone 없음) 은 [] 로 흡수되어 정상 cycle 흐름 진행.
        let fetched;
        try {
            fetched = await marineClient.fetchAllRealtimeEndpoints();
        } catch (err) {
            console.warn('[Marine] endpoint 부분 실패 — cycle skip (이번 1분 발사 0):',
                (err && err.failedEndpoints) ? err.failedEndpoints.join(' | ') : (err && err.message));
            return [];
        }

        // 2) curr snapshot 구축 — [V11] 발효(list)+예비(ready) 모두 병합, allowlist(V/T) 적용
        const curr = _buildSnapshotFromMarine(
            fetched.warnList, fetched.warnSascList,
            fetched.warnReady, fetched.warnSascReady
        );

        // 2-B) [V10] warn/latest 호출 → 발효중 zone 의 해제예고시각을 정확한 시각으로 보강.
        //   warn/list 는 "현재 발효 상태" (clr_ntc_tm 이 범위형 텍스트) 만 제공.
        //   warn/latest 는 같은 zone 에 대한 "가장 최근 통보문" 제공.
        //   해제 통보문 발행 시 tm_ef 에 정확한 시각이 들어있음.
        //   실패 시 graceful — 보강만 skip 하고 기존 cycle 진행.
        try {
            const [warnLatest, warnSascLatest] = await Promise.all([
                marineClient.fetchWarnLatest(),
                marineClient.fetchWarnSascLatest().catch(() => [])   // 자식 통보문 (실패해도 부모 보강은 진행)
            ]);
            _enrichSnapshotWithLatest(curr, warnLatest, _prevSnapshot, warnSascLatest);
        } catch (e) {
            console.warn('[Marine] warn/latest 호출 실패 — 보강 skip:', e && e.message);
        }

        // 2-C) [발표대기 보강 — ef/list 인증 endpoint] 발표됐으나 발효시각이 미래라 실시간
        //   endpoint(warn/list·ready·latest) 어디에도 안 잡히는 "발표 발효대기" 특보를 메움.
        //   warn/latest 가 통보문을 잠깐만 보유해 발표~발효 사이 특보가 사라지던 문제 해결.
        //   - 성공(빈 응답 포함) 시 캐시 갱신. 예외(네트워크/HTTP 실패) 시에만 캐시 fallback
        //     → 진짜 빈 응답(해제/소멸)은 그대로 반영, 일시 장애만 캐시로 안정화(깜빡임/재push 방지).
        //   - 인증 미설정(AUTH 비활성) 이면 fetch 가 [] 반환 → no-op (기존 동작 유지).
        try {
            const efRows = await _fetchEfListForGap();
            _efListCache = { rows: efRows, at: Date.now() };
            _enrichSnapshotWithEfList(curr, efRows, _prevSnapshot);
        } catch (e) {
            console.warn('[Marine] ef/list 발표대기 보강 실패 — 캐시 fallback:', e && e.message);
            if (_efListCache.rows.length && (Date.now() - _efListCache.at) < EF_LIST_CACHE_TTL_MS) {
                try { _enrichSnapshotWithEfList(curr, _efListCache.rows, _prevSnapshot); } catch (_) {}
            }
        }

        // 3) [Followup E-1 + D-1] 빈 snapshot 가드 — 콜드 부팅 직후 prev 가 비어있을 때만.
        //    재배포/장부 초기화로 활성 특보가 "전부 신규"로 오인되어 push 폭주하는 케이스만 차단.
        //    자연 전이(이미 가동 중인 프로세스에서 무특보→신규특보)는 통과시켜 정상 push.
        //    [테스트] forceBaseline 이 true 면 이 가드를 1회 우회 →
        //    빈 prev vs 현재 발효+예비 를 "전부 신규" 로 diff 하여 실제 푸시 발사.
        //    (관리자 "장부 초기화(테스트 푸시)" 버튼 전용. opts 또는 예약 플래그로 지정)
        const forceBaseline = !!opts.forceBaselinePush || _forceBaselinePending;
        if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
            console.log('[Marine] 콜드 부팅 + 빈 prev — push skip, state 저장만 (현재 발효 부모=' +
                curr.parents.size + ', 자식=' + curr.children.size + ')');
            _prevSnapshot = curr;
            _savePrevSnapshot(curr);
            // [Followup E-2] weather_alerts.json 도 갱신 — 첫 부팅 후에도 사용자 앱 즉시 fresh.
            //   prev 가 비어있으므로 previous 트리도 비어있는 skeleton 으로 기록.
            _writeWeatherAlertsJson(new StateSnapshot(), curr);
            return [];
        }
        if (forceBaseline && _isSnapshotEmpty(_prevSnapshot)) {
            console.log('[Marine] ⚠️ 강제 baseline 푸시 모드 — E-1 가드 우회, 현재 활성 특보를 신규로 발사');
        }
        // 예약 플래그는 이번 사이클에서 소비 (1회성).
        // [4차 통합검증 1] cron 이 예약을 소비하는 경우(opts 에 토큰 없음) 보존해둔 관리자
        //   토큰을 이어받아 사용 — 테스트 예약이 전체 발송으로 둔갑하지 않도록.
        const _baselineTokenCarry = (!opts.adminToken && _forceBaselinePending) ? _forceBaselineAdminToken : undefined;
        _forceBaselinePending = false;
        _forceBaselineAdminToken = undefined;

        // 4) [D-medium 인터랙티브] 의심 가드 — mmis 빈 응답 / 부분 누락 폭주 차단.
        //    clr_ntc_tm 미등록 zone 이 SUSPICIOUS_THRESHOLD 이상 사라지면
        //    의심 zone 을 curr 에 prev 정보로 복원 → 이번 cycle 의 release 분기 보류.
        //    관리자 결정(normal/invalid) 전까지 자동 처리 안 됨 (10분마다 재push).
        //    정상 해제 (clr_ntc_tm 등록) 는 영향 받지 않음.
        const prevForDiff = _prevSnapshot;
        _applySuspiciousGuard(prevForDiff, curr);

        // 4-B) [자식 해제 디바운스] 해제예고 없이 사라진 자식을 3분 관찰 — 글리치성
        //    깜빡임에 따른 가짜 "일부 해제"/"추가 발효" 푸시 및 화면 깜빡임 방지.
        //    curr 를 변형(이어받기)하므로 diff(_buildUserPushChanges)·표출(weather_alerts)
        //    양쪽에 반영됨. 해제 통보문(_childReleaseNoticeSet) 있는 자식은 즉시 해제.
        _applyChildReleaseDebounce(prevForDiff, curr);

        // 4-B2) [예비취소 디바운스] 예비가 실시간·ef/list 양쪽에서 사라진 사이클에 한해 직전 예비를
        //   curr 로 3분 이어받기 → 글리치성 가짜 "예비취소" 푸시 차단. 3분 연속 부재면 진짜취소 1회.
        //   (ef/list 보강·의심가드 이후, 발표시각고정 이전 — _applyChildReleaseDebounce 와 동일 구역.)
        _applyUpcomingCancelDebounce(prevForDiff, curr);

        // 4-B3) [제외 자식 사후정리] 모든 보강(latest/ef)·디바운스가 curr 를 변형한 직후, MMIS 가
        //   이번 사이클 warn-sasc/list 에서 level-0(미포함)으로 명시한 자식을 출처불문 제거.
        //   carry(prev 이어받기) 3경로가 무게이트라 synth 가 시드한 유령 자식이 영속하던 문제
        //   (제주도북부앞바다 연안바다 오포함)를 단일 사후정리로 차단. 글리치 carry(부재≠level-0)는
        //   excludedChildren 밖이라 보존. diff·표출 양쪽 반영 위해 발표시각고정·앵커 전에 적용.
        _purgeExcludedChildren(curr);

        // 4-C) [발표시각 고정] 현재 발효 등급의 최초 발표시각으로 tmFc 고정 (변경/연장 불변,
        //   격상/격하·종류변경·해제 시에만 재설정). _buildUserPushChanges·표출 전에 적용.
        _applyAnnounceAnchor(prevForDiff, curr);

        // 4-D) [해제시각 고정/연장] 발효중 해제예정: 윈도우 안이면 정확값 고정(유지),
        //   윈도우(원래 범위) 초과면 연장 표시. _buildUserPushChanges 전에 적용.
        _applyReleaseClrLogic(prevForDiff, curr);

        // 4-E) [발효시각 고정/연장] 예비/발표대기 발효예정: 위와 동일 정책의 발효시각판.
        _applyUpcomingEfLogic(prevForDiff, curr);

        // 4-F) [시각변경 디바운스] 발효/해제예정 새 값이 3분 유지될 때만 변경/연장 푸시.
        //   진동(값 왔다갔다) 시 확정 안 되어 푸시 억제. _buildUserPushChanges 전 적용.
        _debounceTimeValues(curr);

        // 4-G) [§7.7.23 판정 보류실] 보류 건이 열려 있을 때만 관할 지방청 통보문 스캔.
        //   결과는 _lastCancelScan 에 담겨 diff 말미의 _evaluateCancelVerdicts (c) 판정에 쓰임.
        //   실패해도 이번 사이클 (c) 만 생략(무푸시 안전) — (a)(b)(d) 판정은 계속 돈다.
        //   평상시(보류 0건) 조회 0회. dryRun 은 네트워크 생략.
        if (!opts.dryRun && bulletinScanner && _cvHasPendings()) {
            try {
                _lastCancelScan = await bulletinScanner.scan(_cvScanTargets());
                if (_lastCancelScan.scannedCount > 0) {
                    console.log(`[Marine] 취소판정 통보문 스캔: 신규 ${_lastCancelScan.scannedCount}건, 취소문구 누적 ${_lastCancelScan.releases.length}건`);
                }
            } catch (e) {
                _lastCancelScan = null;
                console.warn('[Marine] 취소판정 통보문 스캔 실패 (이번 사이클 (c) 생략):', e && e.message);
            }
        } else if (!_cvHasPendings()) {
            // [적대검증 1] 보류 0건이면 직전 스캔 결과를 비운다 — 다음 에피소드가 묵은
            //   결과(stale releases)로 판정되는 것 방지 (신선도 게이트의 이중 방어).
            _lastCancelScan = null;
        }

        // 5) diff + dispatch + flush (관리자 push) — [수정1] 관리자 채널 비활성.
        //    runDiffAndPush 는 관리자(dmdw) 푸시 전용이므로 비활성 시 호출 자체 skip.
        let sent = [];
        if (ADMIN_PUSH_ENABLED) {
            sent = await runDiffAndPush(prevForDiff, curr, {
                cycleId: opts.cycleId || Date.now(),
                dryRun: !!opts.dryRun
            });
        }

        // 5-B) [사용자 푸시 복원] 부모 zone 단위 변화 → push_sender.processChanges
        //   legacy 시스템에서 weather_alerts_crawler 가 호출하던 채널.
        //   marine v7 통합 시 legacy 비활성화로 끊긴 사용자 푸시 채널 복원.
        //   - 부모 단위만 (자식 정보 X — V15 호환)
        //   - push_sender 자체 dedup (pendingPushes.json) 으로 중복 방지
        //   - 첫 부팅 가드 (위 E-1) 안 가드도 통과 후라 안전
        // [자식-only 통보문 보강] _buildUserPushChanges 는 모든 디바운스·의심가드를 통과한
        //   "확정 푸시 신호"다(SPEC §2). 이 결과를 자식 통보문 보강 모듈에 그대로 넘겨 자식
        //   변동 펜딩을 등록한다(부모만 변동한 신호는 childState.added/released 가 비어 등록 안 됨).
        let _userChanges = null;
        if (!opts.dryRun && pushSender && typeof pushSender.processChanges === 'function') {
            try {
                // [4차 통합검증 4] 관리자 테스트 사이클(adminToken)에는 (c) 확정 발사를 이월 —
                //   실사용자 대상 취소가 관리자 기기로만 나가고 보류가 소진되는 것 방지.
                _cvSuppressFireThisCycle = !!(opts.adminToken || _baselineTokenCarry);
                _userChanges = _buildUserPushChanges(prevForDiff, curr);
                _cvSuppressFireThisCycle = false;
                // [P2] 변화 0 일 때도 호출 — push_sender 의 pending retry 보장
                // (옛 weather_alerts_crawler 동일 패턴)
                // [테스트 푸시] opts.adminToken 이 있으면 그 토큰(관리자 기기)에게만 발송.
                //   장부 초기화(테스트 푸시) 버튼이 forceBaselinePush + adminToken 으로 호출.
                const userOpts = opts.adminToken ? { adminToken: opts.adminToken }
                    : (_baselineTokenCarry ? { adminToken: _baselineTokenCarry } : {});
                await pushSender.processChanges(_userChanges, userOpts);
            } catch (e) {
                console.error('[marine_warning_crawler] 사용자 push 발사 실패 (관리자 push 영향 없음):', e && e.message);
            }
        }

        // 5-B1) [위치기반 특보 경보 ④] 활성 특보 변화 → 동의(활성) 단말에 깨우는 신호(데이터 메시지).
        //   기존 푸시와 완전 독립. 위치 좌표는 서버로 오지 않음(단말이 판정). 실패는 흡수.
        if (!opts.dryRun) {
            try {
                await require('./services/location_alert_dispatch').dispatchOnLatest();
            } catch (e) {
                console.error('[marine_warning_crawler] 위치기반 경보 dispatch skip:', e && e.message);
            }
        }

        // 5-B2) [자식-only 통보문 보강] 확정 자식 변동을 펜딩 등록 + 열린 펜딩 부모만 ntfctn/list 조회·매칭.
        //   - 평상시(변동 없음·펜딩 없음) ntfctn 호출 0회 (tick 내부 가드).
        //   - dryRun 이면 네트워크/등록 모두 skip. 실패해도 기존 흐름 무영향.
        if (!opts.dryRun && childBulletin) {
            try {
                if (_userChanges === null) _userChanges = _buildUserPushChanges(prevForDiff, curr);
                childBulletin.registerChildChanges(_userChanges, ZONE_HOME_OFFICE);
                await childBulletin.tick({ marineClient, zoneHomeOffice: ZONE_HOME_OFFICE });
            } catch (e) {
                console.error('[marine_warning_crawler] 자식 통보문 보강 실패 (다른 동작 무영향):', e && e.message);
            }
        }

        // 5-C) [연장 감지] 직전 특보 기억 갱신 — _buildUserPushChanges 이후 호출되어야
        //   다음 cycle 의 null gap 연장 판정에 직전 값이 쓰임.
        _updateExtensionMemory(curr);

        // 6) curr 를 다음 사이클의 prev 로 저장
        _prevSnapshot = curr;
        _savePrevSnapshot(curr);
        _savePushedPubs();   // [발송이력 dedup] 이번 사이클 갱신분 영속화 (재배포에도 유지)
        _saveClrConfirms();  // [§7.7.20] 해제예고 확정 dedup 영속화 (재배포에도 재푸시 방지)
        _saveCancelVerdicts();   // [§7.7.23] 예비취소 판정 보류실 영속화 (재배포에도 판정 이어감)

        // 7) [Followup E-2] weather_alerts.json 갱신 — SPEC §4.
        //    dispatch 후 / state 저장 후 / cycle 끝에 한 번. atomic tmp → rename.
        //    실패해도 push 흐름엔 영향 없음 (다음 cycle 에서 재시도).
        _writeWeatherAlertsJson(prevForDiff, curr);

        return sent;
    } catch (err) {
        console.error('[marine_warning_crawler] run 실패:', err && err.stack || err);
        return [];
    } finally {
        _runInProgress = false;
    }
}

// ============================================================================
// exports
// ============================================================================
module.exports = {
    PARENT_TO_CHILDREN,
    StateSnapshot,
    DiffMatrix,
    EventDispatcher,
    runDiffAndPush,
    run,
    resetState,
    // 내부 노출 (테스트용)
    _score,
    _buildSnapshotFromMarine,
    _enrichSnapshotWithLatest,
    _enrichSnapshotWithEfList,
    _refineUpcomingExactEf,
    _purgeExcludedChildren,
    _tryAddCoexistingUpcoming,
    _extractParent,
    _loadPrevSnapshot,
    _savePrevSnapshot,
    _STATE_FILE,
    // [Followup E-2] weather_alerts.json 갱신 (테스트용 노출)
    _buildZoneTreeFromSnapshot,
    _writeWeatherAlertsJson,
    _WEATHER_ALERTS_FILE,
    _isSnapshotEmpty,
    _buildUserPushChanges,
    _applyChildReleaseDebounce,
    _updateExtensionMemory,
    _timeKey,
    _applyAnnounceAnchor,
    _applyReleaseClrLogic,
    _applyUpcomingEfLogic,
    _debounceTimeValues,
    // [D-6 (A)] 시간 형식 변환 (테스트용 노출)
    normalizeMmisTime,
    // [D-medium 인터랙티브] 의심 가드 + 결정 API
    _classifyReleases,
    _applySuspiciousGuard,
    _loadSuspiciousState,
    _saveSuspiciousState,
    _enqueueImmediateRelease,
    decideSuspiciousCase,
    getSuspiciousState,
    _SUSPICIOUS_FILE,
    SUSPICIOUS_THRESHOLD,
    PUSH_REINFORCE_INTERVAL,
    SUSPICIOUS_HISTORY_LIMIT,
    // [§7.7.23 판정 보류실] (테스트용 노출)
    _loadCancelVerdicts,
    _saveCancelVerdicts,
    _registerParentCancelVerdict,
    _registerChildCancelVerdict,
    _evaluateCancelVerdicts,
    _cvHasPendings,
    _cvScanTargets,
    _setLastCancelScanForTest,
    _resetCancelVerdictsForTest,
    _mmisEndMs,
    _cvDeadline,
    _CANCEL_VERDICT_FILE: CANCEL_VERDICT_FILE,
    CANCEL_VERDICT_TTL_MS,
    CANCEL_VERDICT_MAX_HOLD_MS
};
