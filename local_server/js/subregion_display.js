/**
 * [자식해역 신규 표출 모듈 — index1 전용]
 *
 * 방재기상 API 기반 신규 자식해역 표출. 기존 텍스트 스크래핑 기반 표출과
 * 별도 영역(#subregion-section)에 나란히 표시되어 비교 검증 가능.
 *
 * 본 모듈은 다음 두 페이지 가드로 인해 index1에서만 동작:
 *  - Layer 1: window.__SEAGNAL_PAGE !== 'index1' 면 즉시 종료
 *  - Layer 2: #subregion-section 컨테이너 미존재 시 종료
 *
 * 근거 문서:
 * - separation/06_comparison_validation.md §7 (화면 레이아웃)
 * - implementation/guard_pattern.md (3-Layer 가드 + namespacing)
 * - 01_LOGIC/15_estimation_display.md §4 (추정 마커 정책)
 * - 02_DATA_MODEL/03_subregion_lifecycle_schema.md (데이터 형식)
 */

(function () {
    'use strict';

    // ========================================================================
    // [Layer 1] 페이지 가드
    // ========================================================================
    if (window.__SEAGNAL_PAGE !== 'index1') {
        // index2 또는 기타 페이지 — 즉시 종료
        return;
    }

    // ========================================================================
    // [Layer 2] 마운트 위치 가드
    // ========================================================================
    const container = document.getElementById('subregion-section');
    if (!container) {
        console.warn('[Subregion] #subregion-section 마운트 위치 없음 — 1단계 인프라 미완료');
        return;
    }

    // ========================================================================
    // [Layer 3] 정상 진입 — 본 모듈 로직
    // ========================================================================

    const KEY_PREFIX = 'seagnal_subregion_';
    const REFRESH_EVENT = 'seagnal:subregion-refreshed';
    const POLL_INTERVAL_MS = 60 * 1000;
    const TOOLTIP_TEXT = '본 정보는 실제 발표내용과 다를 수 있습니다.';

    // 모듈 상태 (캡슐화)
    let aliasMap = null;
    let lastState = null;
    let pollTimer = null;
    let isEnabled = true;

    // ========================================================================
    // 데이터 페칭
    // ========================================================================

    async function fetchAliasMap() {
        try {
            const res = await fetch('/api/subregion/alias-map');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('[Subregion] alias-map 로드 실패:', e.message);
            return null;
        }
    }

    async function fetchState() {
        try {
            const res = await fetch('/api/subregion/state');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('[Subregion] state 로드 실패:', e.message);
            return null;
        }
    }

    // ========================================================================
    // 데이터 그룹화 — 부모해역별로 자식 묶기
    // ========================================================================

    function groupByParent(state) {
        if (!state || !state.subregions || !aliasMap) return [];

        const parentMap = new Map();
        // aliasMap의 parents 순서를 보존하기 위해 먼저 빈 그룹 생성
        for (const [parentRegId, parentInfo] of Object.entries(aliasMap.parents || {})) {
            parentMap.set(parentRegId, {
                parentRegId,
                parentName: parentInfo.appRegKo,
                children: []
            });
        }

        // 자식해역들을 부모별로 분류 (활성 자식 또는 예비만 있는 자식)
        // LOGIC 10 §3:
        //   패턴 A (자식 발효 + 다른 종류 예비) → current만 표시
        //   패턴 B (자식 미발효 + 예비만) → upcoming 표시 (라벨 "예비특보 발표")
        //   패턴 C (자식 발효 + 같은 종류 격상/격하 예비) → current만 표시
        for (const [regId, child] of Object.entries(state.subregions)) {
            // current가 있으면 표시 (패턴 A, C 모두 current 우선)
            // current 없고 upcoming만 있으면 표시 (패턴 B)
            const hasCurrent = child.current != null;
            const hasUpcoming = child.upcoming != null;
            if (!hasCurrent && !hasUpcoming) continue;

            const parentRegId = child.parentRegId;
            if (!parentMap.has(parentRegId)) {
                parentMap.set(parentRegId, {
                    parentRegId,
                    parentName: '(매핑 미완)',
                    children: []
                });
            }
            parentMap.get(parentRegId).children.push(child);
        }

        // 자식이 1개 이상 있는 부모만 반환
        return Array.from(parentMap.values()).filter(g => g.children.length > 0);
    }

    // ========================================================================
    // 렌더링
    // ========================================================================

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderConfidenceMarker(confidence, reason) {
        if (!confidence || confidence === 'CONFIRMED') return '';
        const isStrong = confidence === 'STRONGLY_ESTIMATED';
        const cls = isStrong ? 'strong' : 'weak';
        const reasonText = reason ? ` (${reason})` : '';
        return `<span class="subregion-confidence-marker ${cls}" title="${escapeHtml(TOOLTIP_TEXT + reasonText)}">ⓘ</span>`;
    }

    function renderItem(child) {
        // current 우선, 없으면 upcoming(예비특보 발표 케이스 — 패턴 B)
        const display = child.current || child.upcoming;
        const status = display
            ? `${escapeHtml(display.wrnTp || '')} ${escapeHtml(display.wrnLvlName || '')}`.trim()
            : '미발효';

        const marker = renderConfidenceMarker(child.confidence, child.estimationReason);
        const eventLabel = child.eventLabel ? `<span class="subregion-event-label">${escapeHtml(child.eventLabel)}</span>` : '';

        // 예비특보 표시 시 시각적 구분 클래스
        const itemClass = (!child.current && child.upcoming) ? 'subregion-item subregion-item-preliminary' : 'subregion-item';

        return `
            <div class="${itemClass}" data-reg-id="${escapeHtml(child.regId)}">
                <span class="subregion-item-name">${escapeHtml(child.regKoApp)}</span>
                <span class="subregion-item-status">${status}</span>
                ${marker}
                ${eventLabel}
            </div>
        `;
    }

    function renderParentGroup(group) {
        const items = group.children.map(renderItem).join('');
        return `
            <div class="subregion-parent-group" data-parent-reg-id="${escapeHtml(group.parentRegId)}">
                <div class="subregion-parent-name">${escapeHtml(group.parentName)}</div>
                <div class="subregion-list">${items}</div>
            </div>
        `;
    }

    function renderHeader(stateInfo) {
        const lastUpdated = stateInfo && stateInfo.lastUpdated
            ? new Date(stateInfo.lastUpdated).toLocaleString('ko-KR')
            : '데이터 없음';
        return `
            <div class="subregion-section-header">
                <span class="subregion-section-title">방재기상 기반 자식해역 (검증 단계)</span>
                <span class="subregion-section-subtitle">${escapeHtml(TOOLTIP_TEXT)}</span>
                <span class="subregion-section-meta">최종 갱신: ${escapeHtml(lastUpdated)}</span>
            </div>
        `;
    }

    function renderEmpty(reason) {
        return `
            <div class="subregion-section-header">
                <span class="subregion-section-title">방재기상 기반 자식해역 (검증 단계)</span>
            </div>
            <div class="subregion-empty">${escapeHtml(reason)}</div>
        `;
    }

    function render(state) {
        if (!isEnabled) {
            container.classList.add('hidden');
            return;
        }

        if (!state) {
            container.classList.remove('hidden');
            container.innerHTML = renderEmpty('자식해역 데이터를 불러오지 못했습니다.');
            return;
        }

        const groups = groupByParent(state);
        if (groups.length === 0) {
            container.classList.remove('hidden');
            container.innerHTML = renderHeader(state) +
                '<div class="subregion-empty">현재 발효 중인 자식해역이 없습니다.</div>';
            return;
        }

        const headerHtml = renderHeader(state);
        const groupsHtml = groups.map(renderParentGroup).join('');
        container.classList.remove('hidden');
        container.innerHTML = headerHtml + groupsHtml;
    }

    // ========================================================================
    // 폴링 사이클
    // ========================================================================

    async function refresh() {
        try {
            // alias-map은 1회만 로드 (캐시)
            if (!aliasMap) {
                aliasMap = await fetchAliasMap();
            }

            const state = await fetchState();
            lastState = state;

            try {
                localStorage.setItem(`${KEY_PREFIX}last_refresh`, new Date().toISOString());
            } catch (e) { /* localStorage 사용 불가 환경 무시 */ }

            render(state);

            // 다른 모듈에 알림 (어드민 UI 등)
            try {
                window.dispatchEvent(new CustomEvent(REFRESH_EVENT, {
                    detail: { state, page: 'index1' }
                }));
            } catch (e) { /* 무시 */ }
        } catch (e) {
            console.error('[Subregion] refresh 오류:', e);
            render(null);
        }
    }

    function startPolling() {
        if (pollTimer) return;
        refresh();  // 즉시 1회
        pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function setEnabled(enabled) {
        isEnabled = !!enabled;
        try {
            localStorage.setItem(`${KEY_PREFIX}enabled`, isEnabled ? '1' : '0');
        } catch (e) { /* 무시 */ }

        if (isEnabled) {
            container.classList.remove('hidden');
            startPolling();
        } else {
            container.classList.add('hidden');
            stopPolling();
        }
    }

    // ========================================================================
    // 초기화
    // ========================================================================

    function init() {
        // 사용자 설정 복원
        try {
            const savedEnabled = localStorage.getItem(`${KEY_PREFIX}enabled`);
            if (savedEnabled === '0') isEnabled = false;
        } catch (e) { /* 무시 */ }

        if (isEnabled) {
            startPolling();
        } else {
            container.classList.add('hidden');
        }

        console.log('[Subregion] index1 자식해역 표출 모듈 초기화 완료');
    }

    // 글로벌 namespace 노출 (디버깅/관리용)
    window.SubregionDisplay = {
        refresh: refresh,
        getState: () => (lastState ? JSON.parse(JSON.stringify(lastState)) : null),
        setEnabled: setEnabled,
        isEnabled: () => isEnabled
    };

    // DOM 준비 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
