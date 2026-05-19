/**
 * ============================================================================
 * 파일명: services/dmdw_push_sender.js
 * 역할: 자식 해역(연안바다·평수구역) 단위 푸시 알림 발송기
 * ============================================================================
 *
 * [배경 — 비개발자 운영자용 설명]
 * SEAGNAL 앱은 그동안 "부모 해역(앞바다)" 단위의 통보문만으로 푸시 알림을 보냈습니다.
 * 그러나 기상청 방재기상플랫폼(dmdw.kma.go.kr) 은 더 작은 단위인
 *   - 연안바다 (예: 제주도동부앞바다 중 북동연안바다)
 *   - 평수구역 (예: 부산앞바다 중 동부평수구역)
 * 에 대한 정밀 특보를 1분 주기로 제공합니다. 이 파일은 그 자식 해역 단위 특보의
 * 변화를 감지하여 관리자에게 푸시 알림을 보내는 책임을 가집니다.
 *
 * [발송 대상]
 *   - 본 모듈은 services/admin_push.js 의 sendAdminPush() 를 통해
 *     "관리자 등록 기기" 에만 푸시를 발송합니다 (테스트 기간).
 *   - 일반 사용자에게는 발송되지 않습니다.
 *
 * [발송 이벤트 6 종]
 *   1) publish              — 자식 발표 (FC 응답에 미래 tmEf 로 새로 잡힘)
 *   2) active               — 자식 발효 (EF 응답에 새로 잡힘)
 *   3) release              — 자식 해제 (직전 EF 사이클에 있던 자식이 이번에 사라짐)
 *   4) level_upgrade_publish — 자식 격상 발표 (wrnLvl 상승, 미래 tmEf)
 *   5) level_upgrade_active  — 자식 격상 발효 (wrnLvl 상승, 현재 tmEf)
 *   6) level_downgrade_publish/active — 자식 격하 발표/발효 (wrnLvl 하락)
 *
 * [사용 패턴]
 *   const dpush = require('./services/dmdw_push_sender');
 *   const cycleId = Date.now(); // 1분 사이클 식별자 — 같은 사이클은 같은 ID
 *
 *   // 이벤트 감지 시 큐에 적재
 *   dpush.enqueue({
 *     cycleId,
 *     eventType: 'publish',
 *     parentZone: '제주도동부앞바다',
 *     childName: '북동연안바다',
 *     wrnTpNm: '풍랑',
 *     wrnLvlNm: '주의보',
 *     tmFc: '2026-05-18 08:00',
 *     tmEf: '2026-05-18 09:00'
 *   });
 *
 *   // 사이클 끝나면 flush — 같은 사이클·같은 이벤트·같은 등급/종류를 묶어서 1~N 회 발송
 *   await dpush.flush(cycleId);
 *
 * [의존성]
 *   - Node built-in (fs, path 불필요)
 *   - services/admin_push.js (sendAdminPush)
 *   - 외부 패키지 추가 없음
 * ============================================================================
 */

'use strict';

// admin_push 는 firebase-admin 을 lazy-load 하므로 require 비용이 거의 없음.
const { sendAdminPush } = require('./admin_push');

// ============================================================================
// 상수
// ============================================================================

/** 푸시 본문 1건 길이 한도. 부모 단위로 자르므로 약간의 여유를 가짐. */
const BODY_MAX_LEN = 200;

/** 제목 끝에 붙는 자식 식별용 접미사. 운영자가 부모/자식을 한눈에 구분하도록. */
const CHILD_TITLE_SUFFIX = '[자식]';

/** 푸시 클릭 시 이동할 경로 (앱 메인). admin_push 가 data.url 을 사용함. */
const CLICK_URL = '/';

/** 격상/격하 판별을 위한 등급 점수 (push_sender.js 와 동일 체계). */
const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 2, '해제': 0, '': 0 };

/** 격상/격하 판별을 위한 종류 점수. 태풍은 별격. */
const TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, '해일': 10, '호우': 10, '대설': 10 };

// ----------------------------------------------------------------------------
// [M1] _sentKeys 메모리 누수 방지용 상수
// ----------------------------------------------------------------------------
// 정책: TTL(24시간) + 최대 사이즈(8000) 결합.
//   - TTL: 24시간 지나면 자동 제거 → 같은 자식이 하루 뒤 다시 같은 등급으로 떠도
//          새 푸시로 인지된다. (실 운영에선 tmEf 가 매번 달라지므로 같은 키 재출현
//          빈도는 매우 낮지만, 안전망으로 TTL 둠.)
//   - MAX_SIZE: 폭증 상황 대비 상한. 초과 시 가장 오래된 것부터 정리.
//     Map 의 삽입 순서 = 발송 순서 이므로 자연스러운 LRU 가 된다.
const SENT_KEY_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
const SENT_KEY_MAX = 8000;                      // 상한

// ============================================================================
// 모듈 상태 (메모리)
// ============================================================================

/**
 * 사이클별 이벤트 큐.
 *   Map<cycleId, Array<event>>
 * event 구조:
 *   {
 *     eventType: 'publish' | 'active' | 'release'
 *               | 'level_upgrade_publish' | 'level_upgrade_active'
 *               | 'level_downgrade_publish' | 'level_downgrade_active',
 *     parentZone: string,     // 예: '제주도동부앞바다'
 *     childName:  string,     // 예: '북동연안바다'  (표시용 짧은 이름)
 *     wrnTp:      string,     // 코드 (예: 'W'). 없으면 ''
 *     wrnTpNm:    string,     // 한글명 (예: '풍랑')
 *     wrnLvl:     string,     // 코드/등급 (예: 'A')
 *     wrnLvlNm:   string,     // 한글명 (예: '주의보' | '경보')
 *     prevWrnLvlNm: string,   // 격상/격하 시 이전 등급 한글명
 *     prevWrnTpNm:  string,   // 종류 전환 시 이전 종류 한글명 (옵션)
 *     tmFc: string,           // 발표 시각 ("YYYY-MM-DD HH:mm" 등)
 *     tmEf: string            // 발효 시각
 *   }
 */
const _queue = new Map();

/**
 * 발송 이력 (중복 방지용).
 *
 * [M1 변경 — 메모리 누수 방지]
 *   Set → Map<dedupKey, insertedAt(ms)> 로 교체.
 *   - 값에 적재 시각을 보관해 TTL(24h) 자동 정리 가능.
 *   - Map 의 삽입 순서가 유지되므로 사이즈 한도(8000) 초과 시
 *     가장 오래된 키부터 제거 (자연스러운 LRU).
 *   - 외부 노출 API (forgetChild 등) 는 동작 동일하게 유지 — Set 메서드 대신 Map 메서드 사용.
 *
 * dedupKey 구성: `${childKey}|${wrnTpNm}|${wrnLvlNm}|${tmEf}|${eventType}`
 *   - childKey   : 자식 식별 (부모|자식 조합)
 *   - eventType  : publish/active/release/격상/격하 까지 다 포함해
 *                  같은 자식의 발표→발효 흐름이 둘 다 보장되도록 분리
 */
const _sentKeys = new Map();

/**
 * [M1] _sentKeys 정리 — TTL 경과 항목 제거 + 사이즈 한도 LRU 제거.
 *  - flush() 끝에 호출되어 매 사이클마다 가벼운 정리 수행.
 *  - 정리 비용은 O(n) 이지만 SENT_KEY_MAX(8000) 이내라 무시 가능.
 *  - 외부 forgetChild 호출이 없어도 자식 이력이 24시간 후 자동 만료.
 */
function _gcSentKeys() {
    const now = Date.now();
    // (1) TTL 경과 항목 제거
    for (const [k, ts] of _sentKeys) {
        if (now - ts > SENT_KEY_TTL_MS) _sentKeys.delete(k);
        else break; // Map 삽입 순서 = 시각 오름차순. 첫 살아있는 항목 만나면 이후도 모두 살아있음.
    }
    // (2) 사이즈 한도 초과 시 가장 오래된 것부터 제거
    if (_sentKeys.size > SENT_KEY_MAX) {
        const over = _sentKeys.size - SENT_KEY_MAX;
        let removed = 0;
        for (const k of _sentKeys.keys()) {
            if (removed >= over) break;
            _sentKeys.delete(k);
            removed++;
        }
    }
}

/**
 * 디버그/테스트용: 마지막 flush 결과를 보관 — 시뮬레이션 검증 시 사용.
 *   Array<{ title, body, data, eventType, cycleId }>
 */
let _lastFlushed = [];

// ============================================================================
// 내부 유틸
// ============================================================================

/** 부모|자식 조합 키. */
function _childKey(parentZone, childName) {
    return `${parentZone || ''}|${childName || ''}`;
}

/** 중복 방지 키. */
function _dedupKey(ev) {
    return [
        _childKey(ev.parentZone, ev.childName),
        ev.wrnTpNm || ev.wrnTp || '',
        ev.wrnLvlNm || ev.wrnLvl || '',
        ev.tmEf || '',
        ev.eventType || ''
    ].join('|');
}

/**
 * 시각 문자열을 "D일 HH:mm" 으로 정규화.
 * push_helpers.js 의 fmt() 와 동일한 규칙을 사용한다.
 */
function fmtTime(str) {
    if (!str) return '미정';

    // 1) "YYYY-MM-DD HH:mm" 형식
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (m) {
        const [, , , day, hour, minute] = m;
        return `${parseInt(day, 10)}일 ${hour}:${minute}`;
    }

    // 2) "YYYY-MM-DD 자유시간문구" 형식
    m = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(.+)/);
    if (m) {
        const [, , , day, timeDesc] = m;
        return `${parseInt(day, 10)}일 ${timeDesc}`;
    }

    // 3) 12자리 숫자 (YYYYMMDDHHmm)
    if (/^\d{12}$/.test(str)) {
        const day = str.substring(6, 8);
        const hour = str.substring(8, 10);
        const minute = str.substring(10, 12);
        return `${parseInt(day, 10)}일 ${hour}:${minute}`;
    }

    // 4) "YYYY년 MM월 DD일 HH시 mm분"
    m = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(.*)/);
    if (m) {
        const [, , , day, rest] = m;
        return `${String(day).padStart(2, '0')}일 ${rest}`.trim();
    }

    return str;
}

/** 등급+종류 종합 점수 — 격상/격하 판별.
 *
 * [M2 변경 — '해제' 처리]
 *   기존 로직: TYPE_RANK ≥ 10 이 항상 더해져 lvlName='해제' 도 점수 ≥ 10 이었음.
 *   문제: release 직후 (자식이 children 에서 사라진 상태) 어떤 호출자가
 *         prev={wrnLvlNm:'해제'} 로 enqueueLevelChange 를 호출하면
 *         "10(타입) + 0(해제) = 10" vs "10(타입) + 2(주의보) = 12" → 격상 오판.
 *   해결: lvlName === '해제' 또는 빈 값/없음 이면 0 을 반환해
 *         release 상태와 active 상태 사이의 자연스러운 격상 판정을 막는다.
 *         (호출자는 이 경우 enqueueActive 를 호출해야 함)
 */
function _score(typeName, lvlName) {
    // 해제·공백 등급은 "특보 없음" 상태로 간주 → 0점.
    if (!lvlName || lvlName === '해제') return 0;
    const t = TYPE_RANK[typeName] || (typeName && typeName.includes('태풍') ? 100 : 10);
    const l = LVL_RANK[lvlName] || 0;
    return t + l;
}

/**
 * 두 wrn 상태를 비교해 격상/격하 방향을 결정.
 * @returns 'upgrade' | 'downgrade' | 'same'
 *
 * [M2 추가 가드 — Q 결과에서 흡수]
 *   _score 가 '해제'를 0 으로 반환하더라도, 점수 비교만으로는 release 경계에서
 *   호출자가 enqueueLevelChange 를 잘못 호출할 때(예: prev=해제, curr=주의보)
 *   curr 점수가 더 높아 'upgrade' 로 잡힐 수 있다. 호출자가 forgetChild 로 prev 를
 *   지웠다면 enqueueLevelChange 자체가 안 불리지만, 깜빡 누락 대비 이중 안전망:
 *     prev 또는 curr 한쪽의 등급이 '해제' 이면 항상 'same' 반환 → enqueueLevelChange
 *     가 false 반환하여 푸시 발송되지 않음. 호출자는 release 또는 active 를 별도로
 *     호출해 정확한 의미의 푸시를 보내야 한다.
 */
function compareLevel(prevTpNm, prevLvlNm, currTpNm, currLvlNm) {
    if (prevLvlNm === '해제' || currLvlNm === '해제') return 'same';
    const p = _score(prevTpNm, prevLvlNm);
    const c = _score(currTpNm, currLvlNm);
    if (c > p) return 'upgrade';
    if (c < p) return 'downgrade';
    return 'same';
}

// ============================================================================
// 제목 생성
// ============================================================================

/**
 * 자식 푸시 제목 생성 — 부모 양식과 일치 + [자식] 접미사.
 *   예) '📢 풍랑 주의보 발표 [자식]'
 *       '🚨 풍랑 주의보→경보 격상 발효 [자식]'
 */
function buildTitle(ev) {
    const tp = ev.wrnTpNm || ev.wrnTp || '특보';
    const lvl = (ev.wrnLvlNm === '예비' ? '주의보' : ev.wrnLvlNm) || '';
    const prevLvl = (ev.prevWrnLvlNm === '예비' ? '주의보' : ev.prevWrnLvlNm) || '';
    const prevTp = ev.prevWrnTpNm || '';
    const full = `${tp}${lvl ? ' ' + lvl : ''}`.trim();

    // 격상/격하 라벨 — 종류가 바뀌면 "풍랑 경보→태풍 주의보" 처럼 둘 다 표기,
    //                같으면 "주의보→경보" 처럼 등급만 표기 (사양 예시와 동일).
    const typeChanged = prevTp && prevTp !== tp;
    const lvlPair = typeChanged
        ? `${prevTp} ${prevLvl || '주의보'}→${tp} ${lvl}`
        : `${prevLvl || '주의보'}→${lvl}`;
    const typePrefix = typeChanged ? '' : `${tp} `;

    let core;
    switch (ev.eventType) {
        case 'publish':
            core = `📢 ${full} 발표`; break;
        case 'active':
            core = `🚨 ${full} 발효`; break;
        case 'release':
            core = `✅ ${full} 해제`; break;
        case 'level_upgrade_publish':
            core = `📢 ${typePrefix}${lvlPair} 격상 발표`; break;
        case 'level_upgrade_active':
            core = `🚨 ${typePrefix}${lvlPair} 격상 발효`; break;
        case 'level_downgrade_publish':
            core = `📢 ${typePrefix}${(typeChanged ? lvlPair : (prevLvl || '경보') + '→' + lvl)} 격하 발표`; break;
        case 'level_downgrade_active':
            core = `🚨 ${typePrefix}${(typeChanged ? lvlPair : (prevLvl || '경보') + '→' + lvl)} 격하 발효`; break;
        default:
            core = `📢 ${full} 알림`;
    }
    return `${core} ${CHILD_TITLE_SUFFIX}`;
}

// ============================================================================
// 본문 생성 — 부모 단위 그룹화 + 200자 분할
// ============================================================================

/**
 * 본문 1줄 (부모 1개 단위) 을 만든다.
 *   - 발표/격상 발표/격하 발표 → 두 줄: "ㅇ부모(자식들)\n   - 발효예정 : D일 HH:mm"
 *   - 발효/격상 발효/격하 발효 → 한 줄: "ㅇ부모(자식들)"
 *     (자식은 해제 시각이 부정확하므로 "해제예정" 줄을 일부러 생략한다)
 *   - 해제 → 한 줄: "ㅇ부모(자식들)"
 *
 * @param {string} parentZone
 * @param {string[]} childNames
 * @param {string} eventType
 * @param {string} tmEf
 */
function buildParentLine(parentZone, childNames, eventType, tmEf) {
    const head = `ㅇ${parentZone}(${childNames.join(', ')})`;
    const isPublish = eventType === 'publish'
        || eventType === 'level_upgrade_publish'
        || eventType === 'level_downgrade_publish';
    if (isPublish) {
        return `${head}\n   - 발효예정 : ${fmtTime(tmEf)}`;
    }
    return head;
}

/**
 * 같은 사이클·같은 이벤트로 묶인 events 를 받아
 *   [{ title, body, data }, ...] 푸시 페이로드 배열을 반환.
 *
 * 그룹화 규칙
 *   - parentZone 별로 자식 이름을 모음.
 *   - publish/level_* publish 는 tmEf 가 다르면 부모 단위로 묶지 않고
 *     "부모|tmEf" 키로 묶어 별도 줄로 출력 (다른 발효예정 시각을 한 줄에 섞지 않음).
 *   - 200자 초과 시 부모 단위로 잘라 분할 발송.
 */
function buildPushesFromEvents(events) {
    if (!events || events.length === 0) return [];

    // 모든 이벤트는 같은 cycleId·같은 eventType·같은 wrnTpNm·wrnLvlNm·(격상/격하의 경우 prevWrnLvlNm) 묶음이라고 가정한다.
    // 호출자 (groupEventsForFlush) 가 그 단위로 분리해 넘긴다.
    const eventType = events[0].eventType;

    // 키: 발표류면 `${parent}|${tmEf}` / 그 외엔 `${parent}`
    // → 같은 부모의 같은 발효시각 자식들끼리 한 줄.
    const isPublish = eventType === 'publish'
        || eventType === 'level_upgrade_publish'
        || eventType === 'level_downgrade_publish';

    const groups = new Map();
    for (const ev of events) {
        const key = isPublish ? `${ev.parentZone}|${ev.tmEf || ''}` : `${ev.parentZone}`;
        if (!groups.has(key)) {
            groups.set(key, { parentZone: ev.parentZone, tmEf: ev.tmEf || '', children: [] });
        }
        const g = groups.get(key);
        if (!g.children.includes(ev.childName)) g.children.push(ev.childName);
    }

    // 모든 그룹을 라인으로 변환 후, 200자 한도 안에서 부모 단위로 분할.
    const lines = Array.from(groups.values()).map(g =>
        buildParentLine(g.parentZone, g.children, eventType, g.tmEf)
    );

    const title = buildTitle(events[0]);
    const data = { url: CLICK_URL, type: 'dmdw_child_alert', eventType };

    const pushes = [];
    let bufLines = [];
    let bufLen = 0;
    for (const line of lines) {
        // 줄바꿈 1자 가산 (이미 줄이 더해진 경우)
        const sep = bufLines.length === 0 ? 0 : 1;
        if (bufLines.length > 0 && bufLen + sep + line.length > BODY_MAX_LEN) {
            // 현재 버퍼를 1건의 푸시로 확정 후 새 버퍼 시작.
            pushes.push({ title, body: bufLines.join('\n'), data });
            bufLines = [];
            bufLen = 0;
        }
        // 단일 라인 자체가 200자를 넘는 극단 케이스 → 그대로 단독 발송 (자식 이름 절단 금지 원칙).
        bufLines.push(line);
        bufLen += (bufLines.length === 1 ? 0 : 1) + line.length;
    }
    if (bufLines.length > 0) {
        pushes.push({ title, body: bufLines.join('\n'), data });
    }
    return pushes;
}

// ============================================================================
// 그룹핑: 큐 → 푸시 단위
// ============================================================================

/**
 * 같은 사이클의 이벤트 배열을 "같은 푸시로 묶을 수 있는 단위" 로 분리한다.
 * 묶음 키 = eventType | wrnTpNm | wrnLvlNm | prevWrnLvlNm
 *   - 동일 사이클이라도 종류·등급·이벤트가 다르면 별개 푸시.
 */
function groupEventsForFlush(events) {
    const buckets = new Map();
    for (const ev of events) {
        const k = [
            ev.eventType || '',
            ev.wrnTpNm || ev.wrnTp || '',
            ev.wrnLvlNm || ev.wrnLvl || '',
            ev.prevWrnLvlNm || '',
            ev.prevWrnTpNm || ''
        ].join('|');
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(ev);
    }
    return Array.from(buckets.values());
}

// ============================================================================
// 공개 API
// ============================================================================

/**
 * 이벤트를 큐에 적재.
 * 중복(같은 자식+종류+등급+tmEf+eventType) 은 자동으로 무시한다.
 * @param {Object} ev — 위 _queue 주석의 event 구조 참고
 * @returns {boolean} true=적재됨, false=중복으로 무시됨
 */
function enqueue(ev) {
    if (!ev || !ev.cycleId || !ev.eventType || !ev.parentZone || !ev.childName) {
        console.warn('[DmdwPush] enqueue 호출에 필수 필드 누락:', ev);
        return false;
    }
    const k = _dedupKey(ev);
    if (_sentKeys.has(k)) {
        // 이미 발송된 동일 키 → 재발송 방지
        // (M1: Map 으로 바뀌었지만 has() 시멘틱 동일)
        return false;
    }
    if (!_queue.has(ev.cycleId)) _queue.set(ev.cycleId, []);
    // 사이클 내부에서도 같은 dedupKey 면 1회만.
    const list = _queue.get(ev.cycleId);
    if (list.some(e => _dedupKey(e) === k)) return false;
    list.push(ev);
    return true;
}

/**
 * 편의 함수: 자식 발표 이벤트 적재 (FC 응답에 새 자식 잡힌 경우).
 * tmFc < tmEf 인 미래 발효 건만 발표로 처리한다.
 *
 * [M3 변경 — 시각 검증]
 *   기존: 주석엔 "tmFc < tmEf 미래 발효만" 이라 했으나 실제 검증 없음.
 *         호출자가 tmFc >= tmEf 인 데이터로 호출하면 silent 발송 발생.
 *   변경: 함수 안에서 tmFc, tmEf 비교 후 위배 시 console.warn + false 반환.
 *         - tmFc/tmEf 형식이 다양해(KMA "YYYY-MM-DD HH:mm", "YYYYMMDDHHmm",
 *           dmdw "YYYY.MM.DD.HH:mm" 등) 단순 문자열 비교만으론 위험 → 둘 다
 *           숫자만 추출하여 비교한다. 형식 추출 실패 시는 보수적으로 통과시킴
 *           (False negative 보다 False positive 가 더 위험 — 발표 자체를 막아버리면
 *            운영자가 알림을 못 받음).
 */
function _digits(s) {
    return s ? String(s).replace(/[^0-9]/g, '') : '';
}
function enqueuePublish(cycleId, parentZone, childName, child) {
    const fcD = _digits(child && child.tmFc);
    const efD = _digits(child && child.tmEf);
    // 둘 다 12자리(YYYYMMDDHHmm) 이상으로 정상 추출됐을 때만 비교 수행.
    if (fcD && efD && fcD.length >= 8 && efD.length >= 8) {
        // 동일 자리수로 잘라 비교 (둘이 다른 자리수일 때 사전식 오인 방지)
        const len = Math.min(fcD.length, efD.length);
        if (fcD.substring(0, len) >= efD.substring(0, len)) {
            console.warn(
                `[DmdwPush] enqueuePublish 거부: tmFc(${child.tmFc}) >= tmEf(${child.tmEf}) — ` +
                `즉시 발효 건은 enqueueActive 로 호출해야 합니다. ` +
                `parent=${parentZone} child=${childName}`
            );
            return false;
        }
    }
    return enqueue({
        cycleId,
        eventType: 'publish',
        parentZone, childName,
        wrnTp: child.wrnTp, wrnTpNm: child.wrnTpNm,
        wrnLvl: child.wrnLvl, wrnLvlNm: child.wrnLvlNm,
        tmFc: child.tmFc, tmEf: child.tmEf
    });
}

/**
 * 편의 함수: 자식 발효 이벤트 적재 (EF 응답에 새 자식 잡힌 경우).
 */
function enqueueActive(cycleId, parentZone, childName, child) {
    return enqueue({
        cycleId,
        eventType: 'active',
        parentZone, childName,
        wrnTp: child.wrnTp, wrnTpNm: child.wrnTpNm,
        wrnLvl: child.wrnLvl, wrnLvlNm: child.wrnLvlNm,
        tmFc: child.tmFc, tmEf: child.tmEf
    });
}

/**
 * 편의 함수: 자식 해제 이벤트 적재.
 * 호출자는 직전 EF 사이클 vs 이번 EF 사이클 set-diff 로 사라진 자식을 찾아 호출.
 */
function enqueueRelease(cycleId, parentZone, childName, prevChild) {
    return enqueue({
        cycleId,
        eventType: 'release',
        parentZone, childName,
        wrnTp: prevChild.wrnTp, wrnTpNm: prevChild.wrnTpNm,
        wrnLvl: prevChild.wrnLvl, wrnLvlNm: prevChild.wrnLvlNm,
        tmFc: prevChild.tmFc, tmEf: prevChild.tmEf
    });
}

/**
 * 편의 함수: 자식 격상/격하 이벤트 적재.
 * 종류 전환(예: 풍랑→태풍) 도 점수 비교를 통해 동일하게 격상/격하로 매핑된다.
 *
 * @param {string} cycleId
 * @param {string} parentZone
 * @param {string} childName
 * @param {Object} prev — 변경 전 child {wrnTpNm, wrnLvlNm}
 * @param {Object} curr — 변경 후 child {wrnTpNm, wrnLvlNm, tmFc, tmEf, ...}
 * @param {'publish'|'active'} phase — tmFc<tmEf 이면 'publish', tmFc==tmEf 이면 'active'
 */
function enqueueLevelChange(cycleId, parentZone, childName, prev, curr, phase) {
    const dir = compareLevel(prev.wrnTpNm, prev.wrnLvlNm, curr.wrnTpNm, curr.wrnLvlNm);
    if (dir === 'same') return false;
    const eventType = dir === 'upgrade'
        ? (phase === 'publish' ? 'level_upgrade_publish' : 'level_upgrade_active')
        : (phase === 'publish' ? 'level_downgrade_publish' : 'level_downgrade_active');
    return enqueue({
        cycleId,
        eventType,
        parentZone, childName,
        wrnTp: curr.wrnTp, wrnTpNm: curr.wrnTpNm,
        wrnLvl: curr.wrnLvl, wrnLvlNm: curr.wrnLvlNm,
        prevWrnTpNm: prev.wrnTpNm, prevWrnLvlNm: prev.wrnLvlNm,
        tmFc: curr.tmFc, tmEf: curr.tmEf
    });
}

/**
 * 해당 cycleId 에 누적된 이벤트들을 푸시로 변환·발송한다.
 * 발송 성공한 이벤트는 _sentKeys 에 기록되어 향후 사이클에서 중복 방지된다.
 *
 * @param {string|number} cycleId
 * @param {Object} [opts]
 *   - opts.dryRun: true 면 발송 없이 페이로드만 반환 (테스트용)
 * @returns {Promise<Array<{title, body, data}>>} 실제 만들어진(또는 발송된) 푸시 목록
 */
async function flush(cycleId, opts = {}) {
    const events = _queue.get(cycleId) || [];
    _queue.delete(cycleId);
    _lastFlushed = [];
    if (events.length === 0) return [];

    // 같은 푸시로 묶을 수 있는 단위로 분리
    const groups = groupEventsForFlush(events);

    const allPushes = [];
    for (const groupEvents of groups) {
        const pushes = buildPushesFromEvents(groupEvents);
        for (const p of pushes) {
            allPushes.push({ ...p, _events: groupEvents });
        }
    }

    for (const push of allPushes) {
        const recordable = push._events;
        delete push._events;
        if (opts.dryRun) {
            _lastFlushed.push({ ...push, cycleId });
            continue;
        }
        // 실제 발송 — admin_push 실패해도 본 모듈은 throw 하지 않는다.
        try {
            await sendAdminPush(push.title, push.body, push.data);
            // 성공 시 해당 이벤트들을 sentKeys 에 기록 (중복 방지)
            // [M1] Map.set(key, ts) — ts 는 TTL 기준 시각
            const now = Date.now();
            for (const ev of recordable) _sentKeys.set(_dedupKey(ev), now);
            _lastFlushed.push({ ...push, cycleId });
        } catch (e) {
            // admin_push 자체가 내부에서 try/catch 하지만 만약 throw 되더라도
            // dmdw 크롤러 본체를 영향주지 않도록 여기서 흡수.
            console.error('[DmdwPush] 발송 실패 (무시하고 계속):', e && e.message);
        }
    }
    // [M1] 매 flush 끝에 가벼운 GC — TTL 만료 + 사이즈 한도 정리
    _gcSentKeys();
    return _lastFlushed.slice();
}

/**
 * 자식 해역이 해제되었을 때 그 자식의 모든 발송 이력을 정리.
 * 같은 자식이 나중에 다시 발생하면 푸시가 다시 가도록 함.
 *   (메모리 누수 방지 목적도 겸함)
 */
function forgetChild(parentZone, childName) {
    const prefix = `${_childKey(parentZone, childName)}|`;
    // [M1] Map 으로 변경 — keys() 순회는 Map 도 동일하게 동작.
    for (const k of _sentKeys.keys()) {
        if (k.startsWith(prefix)) _sentKeys.delete(k);
    }
}

/** 테스트/디버그 전용: 모듈 상태 초기화. */
function _resetForTest() {
    _queue.clear();
    _sentKeys.clear();
    _lastFlushed = [];
}

/** 테스트/디버그 전용: 최근 flush 결과 조회. */
function _getLastFlushed() {
    return _lastFlushed.slice();
}

/** 테스트/디버그 전용: _sentKeys 의 (키, 적재시각) 직접 주입 — TTL 시뮬레이션용. */
function _setSentKeyForTest(key, ts) {
    _sentKeys.set(key, ts);
}

/** 테스트/디버그 전용: _sentKeys 의 현재 크기. */
function _getSentKeysSize() {
    return _sentKeys.size;
}

/** 테스트/디버그 전용: 강제 GC 호출. */
function _runGcForTest() {
    _gcSentKeys();
}

module.exports = {
    // 상수
    BODY_MAX_LEN,
    CHILD_TITLE_SUFFIX,
    // 적재 API
    enqueue,
    enqueuePublish,
    enqueueActive,
    enqueueRelease,
    enqueueLevelChange,
    // 발송 API
    flush,
    forgetChild,
    // 유틸 (다른 모듈에서 재사용 가능)
    compareLevel,
    fmtTime,
    buildTitle,
    buildParentLine,
    // 테스트용 (앞에 _ 가 붙은 것은 외부에서 호출하지 말 것)
    _resetForTest,
    _getLastFlushed,
    _setSentKeyForTest,
    _getSentKeysSize,
    _runGcForTest
};
