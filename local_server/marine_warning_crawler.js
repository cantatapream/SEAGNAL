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
        if (_prevSnapshot === null) {
            _prevSnapshot = _loadPrevSnapshot();
        }

        // 1) endpoint 4종 fetch — 부분 실패해도 진행
        const [warnList, warnSascList] = await Promise.all([
            marineClient.fetchWarnList().catch(err => {
                console.warn('[marine_warning_crawler] fetchWarnList 실패:', err && err.message);
                return [];
            }),
            marineClient.fetchWarnSascList().catch(err => {
                console.warn('[marine_warning_crawler] fetchWarnSascList 실패:', err && err.message);
                return [];
            })
        ]);

        // 2) curr snapshot 구축
        const curr = _buildSnapshotFromMarine(warnList, warnSascList);

        // 3) diff + dispatch + flush
        const sent = await runDiffAndPush(_prevSnapshot, curr, {
            cycleId: opts.cycleId || Date.now(),
            dryRun: !!opts.dryRun
        });

        // 4) curr 를 다음 사이클의 prev 로 저장
        _prevSnapshot = curr;
        _savePrevSnapshot(curr);

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
    _extractParent,
    _loadPrevSnapshot,
    _savePrevSnapshot,
    _STATE_FILE
};
