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
        return s;
    }

    toJSON() {
        const obj = { parents: {}, children: {} };
        for (const [k, v] of this.parents) obj.parents[k] = v;
        for (const [parent, m] of this.children) {
            obj.children[parent] = {};
            for (const [k, v] of m) obj.children[parent][k] = v;
        }
        return obj;
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
                    // 추가 발효
                    if (childState.added.length > 0) {
                        matrix.add('additional_active',
                            { parent, time: pCurr.tmYn, childState },
                            { wrnTp: pCurr.wrnTp, wrnLvl: pCurr.wrnLvl,
                              wrnTpNm: pCurr.wrnTpNm, wrnLvlNm: pCurr.wrnLvlNm });
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
function _buildUserPushChanges(prev, curr) {
    const changes = [];
    if (!prev || !curr) return changes;

    const allZones = new Set();
    if (prev.parents) for (const k of prev.parents.keys()) allZones.add(k);
    if (curr.parents) for (const k of curr.parents.keys()) allZones.add(k);

    const toBlock = (info) => info ? {
        wrnTp: info.wrnTpNm || info.wrnTp || '',
        wrnLvl: info.wrnLvlNm || info.wrnLvl || '',
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
            && a.tmEf === b.tmEf
            && a.tmYn === b.tmYn;
    };

    for (const zone of allZones) {
        const p = prev.parents ? prev.parents.get(zone) : null;
        const c = curr.parents ? curr.parents.get(zone) : null;

        if (!p && !c) continue;

        // prev / curr 각각 upcoming / active 블록 추출
        const prevUpcoming = isUpcoming(p) ? toBlock(p) : null;
        const currUpcoming = isUpcoming(c) ? toBlock(c) : null;
        const prevActive = isActive(p) ? toBlock(p) : null;
        const currActive = isActive(c) ? toBlock(c) : null;

        // UPCOMING_CHANGE — 예비특보 변화
        if (!blockEqual(prevUpcoming, currUpcoming)) {
            changes.push({
                type: 'UPCOMING_CHANGE',
                zone: zone,
                prev: prevUpcoming,
                curr: currUpcoming,
                currentActive: currActive || null  // 현재 발효 중인 부모 (격상/격하 판정용)
            });
        }

        // CURRENT_CHANGE — 발효 변화
        if (!blockEqual(prevActive, currActive)) {
            changes.push({
                type: 'CURRENT_CHANGE',
                zone: zone,
                prev: prevActive,
                curr: currActive
            });
        }
    }

    return changes;
}

async function _enqueueImmediateRelease(caseZones) {
    try {
        if (!Array.isArray(caseZones) || caseZones.length === 0) return;
        const cycleId = Date.now();

        // prev snapshot 에서 해당 zone 제거 (이미 정상 해제로 처리되었으므로)
        if (_prevSnapshot && _prevSnapshot.parents) {
            for (const z of caseZones) {
                if (z && z.name) _prevSnapshot.parents.delete(z.name);
            }
            _savePrevSnapshot(_prevSnapshot);
        }

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

    // 이미 시간대 명칭 있는 범위형 → 그대로 통과
    if (/[~∼]/.test(s)) return s;

    // 일반 시간 변환: "2026.05.21 06:00" → "2026년 05월 21일 06시 00분"
    const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (m) {
        const [, Y, M, D, h, mn] = m;
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
    for (const [parentName, info] of snap.parents) {
        const leaf = leafByName.get(parentName);
        if (!leaf) continue;
        if (!info || !info.wrnLvlNm) continue;
        const block = {
            wrnTp: info.wrnTpNm || info.wrnTp || '',       // 한글 우선 (data.js:269 호환)
            wrnTpNm: info.wrnTpNm || '',
            wrnLvl: info.wrnLvlNm || info.wrnLvl || '',    // 한글 우선
            wrnLvlNm: info.wrnLvlNm || '',
            tmFc: normalizeMmisTime(info.tmFc),
            tmEf: normalizeMmisTime(info.tmEf),
            tmYn: normalizeMmisTime(info.tmYn),
            tmCc: normalizeMmisTime(info.clrNtcTm),        // 옛 tmCc = mmis clrNtcTm
            clrNtcTm: normalizeMmisTime(info.clrNtcTm),    // 신규 필드 (양 형식 모두 지원)
            source: 'MARINE_MMIS'
        };
        if (info.wrnLvlNm === '예비') {
            leaf.upcoming = block;
        } else if (info.wrnLvlNm !== '해제') {
            leaf.current = block;
        }
    }

    // 자식 발효 채우기 — [D-6 (B)] mmis 자식 응답에 시간 필드가 없으므로 부모 시간 fallback.
    for (const [parentName, childMap] of snap.children) {
        const leaf = leafByName.get(parentName);
        if (!leaf || !leaf.children) continue;
        const parentInfo = snap.parents.get(parentName);
        for (const [childName, info] of childMap) {
            if (!Object.prototype.hasOwnProperty.call(leaf.children, childName)) continue;
            if (!info || !info.wrnLvlNm) continue;
            // 예비는 푸시 dedup 정책 따라 wrnLvlNm '주의보' 정규화 (배지엔 wrnLvl 별도 보존)
            const lvlNmNorm = info.wrnLvlNm === '예비' ? '주의보' : info.wrnLvlNm;
            leaf.children[childName] = {
                source: 'MARINE_MMIS',
                wrnTp: info.wrnTpNm || info.wrnTp || (parentInfo && parentInfo.wrnTpNm) || '',  // 한글 우선
                wrnTpNm: info.wrnTpNm || (parentInfo && parentInfo.wrnTpNm) || '',
                wrnLvl: lvlNmNorm || info.wrnLvl || '',    // 한글 우선
                wrnLvlNm: lvlNmNorm,
                tmFc: normalizeMmisTime(info.tmFc || (parentInfo && parentInfo.tmFc) || ''),
                tmEf: normalizeMmisTime(info.tmEf || (parentInfo && parentInfo.tmEf) || ''),
                tmYn: normalizeMmisTime(info.tmYn || (parentInfo && parentInfo.tmYn) || ''),
                tmCc: normalizeMmisTime(info.clrNtcTm || (parentInfo && parentInfo.clrNtcTm) || ''),
                clrNtcTm: normalizeMmisTime(info.clrNtcTm || (parentInfo && parentInfo.clrNtcTm) || '')
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

/** marine row 를 내부 state 객체로 변환. */
function _rowToParentInfo(row) {
    return {
        wrnTp: String(row.warn_tp || ''),
        wrnTpNm: row.warn_tp_nm || '',
        wrnLvl: String(row.warn_lvl || ''),
        wrnLvlNm: row.warn_lvl_nm || '',
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
        wrnLvlNm: row.warn_lvl_nm || '',
        tmFc: row.tm_fc || '',
        tmEf: row.tm_ef || row.st_tm || '',
        tmYn: row.tm_yn || row.ed_tm || ''
    };
}

/** 발효 row 만 — 메타 row (tm_fc 또는 warn_lvl_nm 부재) 제외. */
function _isLiveRow(row) {
    return !!(row && row.warn_lvl_nm && (row.tm_fc || row.tm_ef || row.st_tm));
}

/**
 * marine 4 endpoint 응답을 StateSnapshot 으로 변환.
 *
 * @param {Array} warnList    — fetchWarnList (부모 발효)
 * @param {Array} warnSascList — fetchWarnSascList (자식 발효)
 * @returns {StateSnapshot}
 */
function _buildSnapshotFromMarine(warnList, warnSascList) {
    const snap = new StateSnapshot();
    // 부모 — V8 폭풍해일 제외 (warn_tp '5')
    for (const row of (warnList || [])) {
        if (!_isLiveRow(row)) continue;
        if (String(row.warn_tp || '') === '5') continue;  // 폭풍해일 제외
        const name = (row.warn_zone_nm || row.kor_nm || '').trim().replace(/\s+/g, '');
        if (!name) continue;
        snap.parents.set(name, _rowToParentInfo(row));
    }
    // 자식 — 같은 정책
    for (const row of (warnSascList || [])) {
        if (!_isLiveRow(row)) continue;
        if (String(row.warn_tp || '') === '5') continue;
        const childName = (row.kor_nm || row.warn_zone_nm || '').trim().replace(/\s+/g, '');
        if (!childName) continue;
        const parent = _extractParent(childName);
        if (!snap.children.has(parent)) snap.children.set(parent, new Map());
        snap.children.get(parent).set(childName, _rowToChildInfo(row));
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
 *  4. 폭풍해일(warn_tp='5') 제외 — V8 정책
 *
 * 갱신 후 clrNtcTm 은 mmis 원형식 ("2026.05.23 01:00") 으로 저장되어
 * _buildZoneTreeFromSnapshot 에서 normalizeMmisTime() 통과 시 "23일 01:00" 으로 변환됨.
 *
 * @param {StateSnapshot} snap
 * @param {Array} warnLatest — fetchWarnLatest() 응답 row 배열
 * @returns {StateSnapshot} (in-place 수정, 반환은 편의용)
 */
function _enrichSnapshotWithLatest(snap, warnLatest) {
    if (!snap || !Array.isArray(warnLatest) || warnLatest.length === 0) return snap;
    let enriched = 0;
    for (const row of warnLatest) {
        const tp = String(row.warn_tp || '');
        if (tp === '5') continue;
        const cmd = String(row.warn_cmd_nm || '').trim();
        if (cmd !== '해제') continue;
        const name = (row.warn_zone_nm || row.kor_nm || '').trim().replace(/\s+/g, '');
        if (!name) continue;
        if (!snap.parents.has(name)) continue;  // 발효중인 zone 만 보강
        const tmEf = String(row.tm_ef || '').trim();
        if (!tmEf) continue;
        const info = snap.parents.get(name);
        // 정확한 해제시각으로 clrNtcTm 갱신 (mmis 원형식 유지 — 표시 시 normalize)
        info.clrNtcTm = tmEf;
        snap.parents.set(name, info);
        enriched++;
    }
    if (enriched > 0) {
        console.log(`[Marine] warn/latest 보강: ${enriched} zone clrNtcTm 정확한 시각으로 갱신`);
    }
    return snap;
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

async function run(opts = {}) {
    if (_runInProgress) {
        // 중복 실행 방지
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

        // 2) curr snapshot 구축
        const curr = _buildSnapshotFromMarine(fetched.warnList, fetched.warnSascList);

        // 2-B) [V10] warn/latest 호출 → 발효중 zone 의 해제예고시각을 정확한 시각으로 보강.
        //   warn/list 는 "현재 발효 상태" (clr_ntc_tm 이 범위형 텍스트) 만 제공.
        //   warn/latest 는 같은 zone 에 대한 "가장 최근 통보문" 제공.
        //   해제 통보문 발행 시 tm_ef 에 정확한 시각이 들어있음.
        //   실패 시 graceful — 보강만 skip 하고 기존 cycle 진행.
        try {
            const warnLatest = await marineClient.fetchWarnLatest();
            _enrichSnapshotWithLatest(curr, warnLatest);
        } catch (e) {
            console.warn('[Marine] warn/latest 호출 실패 — 보강 skip:', e && e.message);
        }

        // 3) [Followup E-1 + D-1] 빈 snapshot 가드 — prev snapshot 이 비어있으면 (이유 불문)
        //    diff/dispatch 결과가 "전부 신규 발효" 로 오인되어 release/active 폭주 위험.
        //    SPEC §운영안전: state 저장 + weather_alerts.json 갱신만 하고 push skip.
        //    다음 cycle 부터 정상 diff/push.
        //    조건: 부팅 직후 lazy load + 디스크 prev 비어있음, **또는** E-4 partial-fail 후
        //    빈 snapshot 으로 lazy set 된 케이스 (D-1 보강 — isFirstLoad 가드 제거).
        if (_isSnapshotEmpty(_prevSnapshot)) {
            console.log('[Marine] 첫 부팅 — push skip, state 저장만 (현재 발효 부모=' +
                curr.parents.size + ', 자식=' + curr.children.size + ')');
            _prevSnapshot = curr;
            _savePrevSnapshot(curr);
            // [Followup E-2] weather_alerts.json 도 갱신 — 첫 부팅 후에도 사용자 앱 즉시 fresh.
            //   prev 가 비어있으므로 previous 트리도 비어있는 skeleton 으로 기록.
            _writeWeatherAlertsJson(new StateSnapshot(), curr);
            return [];
        }

        // 4) [D-medium 인터랙티브] 의심 가드 — mmis 빈 응답 / 부분 누락 폭주 차단.
        //    clr_ntc_tm 미등록 zone 이 SUSPICIOUS_THRESHOLD 이상 사라지면
        //    의심 zone 을 curr 에 prev 정보로 복원 → 이번 cycle 의 release 분기 보류.
        //    관리자 결정(normal/invalid) 전까지 자동 처리 안 됨 (10분마다 재push).
        //    정상 해제 (clr_ntc_tm 등록) 는 영향 받지 않음.
        const prevForDiff = _prevSnapshot;
        _applySuspiciousGuard(prevForDiff, curr);

        // 5) diff + dispatch + flush (관리자 push — 자식 정보 묶음)
        const sent = await runDiffAndPush(prevForDiff, curr, {
            cycleId: opts.cycleId || Date.now(),
            dryRun: !!opts.dryRun
        });

        // 5-B) [사용자 푸시 복원] 부모 zone 단위 변화 → push_sender.processChanges
        //   legacy 시스템에서 weather_alerts_crawler 가 호출하던 채널.
        //   marine v7 통합 시 legacy 비활성화로 끊긴 사용자 푸시 채널 복원.
        //   - 부모 단위만 (자식 정보 X — V15 호환)
        //   - push_sender 자체 dedup (pendingPushes.json) 으로 중복 방지
        //   - 첫 부팅 가드 (위 E-1) 안 가드도 통과 후라 안전
        if (!opts.dryRun && pushSender && typeof pushSender.processChanges === 'function') {
            try {
                const userChanges = _buildUserPushChanges(prevForDiff, curr);
                // [P2] 변화 0 일 때도 호출 — push_sender 의 pending retry 보장
                // (옛 weather_alerts_crawler 동일 패턴)
                await pushSender.processChanges(userChanges);
            } catch (e) {
                console.error('[marine_warning_crawler] 사용자 push 발사 실패 (관리자 push 영향 없음):', e && e.message);
            }
        }

        // 6) curr 를 다음 사이클의 prev 로 저장
        _prevSnapshot = curr;
        _savePrevSnapshot(curr);

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
    // 내부 노출 (테스트용)
    _score,
    _buildSnapshotFromMarine,
    _enrichSnapshotWithLatest,
    _extractParent,
    _loadPrevSnapshot,
    _savePrevSnapshot,
    _STATE_FILE,
    // [Followup E-2] weather_alerts.json 갱신 (테스트용 노출)
    _buildZoneTreeFromSnapshot,
    _writeWeatherAlertsJson,
    _WEATHER_ALERTS_FILE,
    _isSnapshotEmpty,
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
    SUSPICIOUS_HISTORY_LIMIT
};
