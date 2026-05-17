/**
 * ============================================================================
 * 파일명: js/pagination_helper.js
 * 역할: 관리자 리스트 화면용 공용 페이지네이션 UI helper
 * ============================================================================
 *
 * [노출 API]
 *   window.renderStandardPagination(container, currentPage, totalPages, onPageChange, options?)
 *   window.PaginationHelper.render(...)
 *   window.PaginationHelper.normalize(json)
 *
 * [설명]
 *   - 페이지 수가 1 이하일 때는 컨테이너를 비우고 종료
 *   - ‹ 1 2 3 ... › 형태의 버튼 UI 를 container.innerHTML 로 갱신
 *   - 현재 페이지 ±2 + 처음/끝 페이지만 표시 (그 외는 ellipsis "…")
 *   - 인라인 onclick 대신 addEventListener 로 콜백 바인딩
 *   - 클래스는 기존 `.promo-pagination` 영역에서 사용 중인
 *     `.pagination` / `.pagination-btn` / `.pagination-btn.active` 와 통일
 *
 * [접근성]
 *   - 현재 페이지 버튼: aria-current="page"
 *   - 페이지 번호 버튼: aria-label="N 페이지로 이동"
 *   - 이전/다음 버튼: aria-label="이전/다음 페이지" + disabled 상태
 *   - ellipsis: pointer-events:none 으로 hover 인터랙션 차단
 *
 * [options]
 *   - scrollTarget : HTMLElement | string(selector) — 페이지 클릭 후 자동
 *     scrollIntoView 대상. 없으면 스크롤 처리 안 함 (호출자 책임).
 *
 * [현재 사용처]
 *   - js/alert_push.js renderHistoryTab() (특보 발송 이력)
 *   - js/admin_report.js renderReportList() (제보 관리)
 *   - js/admin_collect.js loadPromoListForAdmin() (홍보 관리)
 *   - js/admin_survey.js 설문 목록 / 응답 모달
 *   - js/admin.js 에러 리스트 3종 (검토필요/재시도/수집실패)
 *
 * [디자인 원칙]
 *   - 전역 오염 최소화: window.renderStandardPagination + PaginationHelper 만 노출
 *   - container.innerHTML 으로 전체 갱신 → 기존 핸들러 누수 걱정 없음
 * ============================================================================
 */
(function () {
    'use strict';

    /**
     * 현재 페이지를 기준으로 표시할 페이지 번호 배열을 만든다.
     * 결과 예시 (current=5, total=10): [1, '...', 3, 4, 5, 6, 7, '...', 10]
     */
    function buildPageList(current, total) {
        const pages = [];
        if (total <= 7) {
            for (let i = 1; i <= total; i++) pages.push(i);
            return pages;
        }

        const window_ = 2; // 현재 페이지 양쪽으로 보여줄 개수
        const start = Math.max(2, current - window_);
        const end = Math.min(total - 1, current + window_);

        pages.push(1);
        if (start > 2) pages.push('...');
        for (let i = start; i <= end; i++) pages.push(i);
        if (end < total - 1) pages.push('...');
        pages.push(total);
        return pages;
    }

    /**
     * 공용 페이지네이션 UI 렌더.
     * @param {HTMLElement} container - 페이지 버튼 삽입 요소 (innerHTML 으로 덮어씀)
     * @param {number} currentPage - 1-based 현재 페이지
     * @param {number} totalPages - 총 페이지 수
     * @param {(page:number)=>void} onPageChange - 페이지 클릭 콜백
     * @param {Object} [options]
     * @param {HTMLElement|string} [options.scrollTarget] - 페이지 클릭 후 scrollIntoView 대상
     */
    function renderStandardPagination(container, currentPage, totalPages, onPageChange, options) {
        if (!container) return;
        const total = Math.max(0, parseInt(totalPages, 10) || 0);
        const cur = Math.max(1, parseInt(currentPage, 10) || 1);

        if (total <= 1) {
            container.innerHTML = '';
            return;
        }

        const pages = buildPageList(cur, total);
        let html = '';

        // 이전 버튼
        const prevDisabled = cur <= 1;
        html += '<button type="button" class="pagination-btn" data-page="' + (cur - 1) + '"'
            + (prevDisabled ? ' disabled style="opacity:0.4;cursor:not-allowed;"' : '')
            + ' aria-label="이전 페이지">&lsaquo;</button>';

        // 페이지 번호 버튼들
        pages.forEach(function (p) {
            if (p === '...') {
                // ellipsis: 클릭/hover 인터랙션 차단 (pointer-events:none)
                html += '<span class="pagination-btn pagination-ellipsis" aria-hidden="true" '
                    + 'style="border:none;background:transparent;cursor:default;pointer-events:none;">…</span>';
            } else if (p === cur) {
                // 현재 페이지: aria-current + aria-disabled (클릭 무의미)
                html += '<button type="button" class="pagination-btn active" data-page="' + p + '"'
                    + ' aria-current="page" aria-label="' + p + ' 페이지 (현재 페이지)">' + p + '</button>';
            } else {
                html += '<button type="button" class="pagination-btn" data-page="' + p + '"'
                    + ' aria-label="' + p + ' 페이지로 이동">' + p + '</button>';
            }
        });

        // 다음 버튼
        const nextDisabled = cur >= total;
        html += '<button type="button" class="pagination-btn" data-page="' + (cur + 1) + '"'
            + (nextDisabled ? ' disabled style="opacity:0.4;cursor:not-allowed;"' : '')
            + ' aria-label="다음 페이지">&rsaquo;</button>';

        container.innerHTML = html;

        // 페이지네이션 컨테이너에 기본 레이아웃 클래스가 없으면 부여
        if (!container.classList.contains('pagination') && !container.classList.contains('promo-pagination')) {
            container.classList.add('pagination');
        }

        // 옵션 정규화: scrollTarget 은 selector 문자열일 수 있음
        const opts = options || {};
        function resolveScrollTarget() {
            const t = opts.scrollTarget;
            if (!t) return null;
            if (typeof t === 'string') {
                try { return document.querySelector(t); } catch (e) { return null; }
            }
            return t;
        }

        // 클릭 이벤트 바인딩 (인라인 onclick 회피)
        const buttons = container.querySelectorAll('button.pagination-btn[data-page]');
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                const target = parseInt(btn.getAttribute('data-page'), 10);
                if (isNaN(target) || target < 1 || target > total || target === cur) return;
                if (typeof onPageChange === 'function') onPageChange(target);
                // 옵션에 scrollTarget 이 있으면 클릭 후 자동 스크롤
                const scrollEl = resolveScrollTarget();
                if (scrollEl && typeof scrollEl.scrollIntoView === 'function') {
                    scrollEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    /**
     * 서버 응답을 표준화된 { items, pagination } 형태로 정규화.
     *
     * 지원 입력:
     *  - Array              → { items: arr, pagination: null }  (raw 배열, 구 포맷)
     *  - { data, pagination } → { items: data, pagination }       (신 포맷)
     *  - 그 외/오류         → { items: [], pagination: null }    (안전 폴백)
     *
     * [용례]
     *  const { items, pagination } = window.PaginationHelper.normalize(json);
     *  if (!pagination) {
     *      // 구 포맷: 클라이언트 슬라이스
     *  } else {
     *      // 신 포맷: 서버 pagination.totalPages 등 사용
     *  }
     */
    function normalize(json) {
        if (Array.isArray(json)) {
            return { items: json, pagination: null };
        }
        if (json && Array.isArray(json.data)) {
            return { items: json.data, pagination: json.pagination || null };
        }
        return { items: [], pagination: null };
    }

    // 전역 노출 (기존 호환 + normalize 추가)
    window.renderStandardPagination = renderStandardPagination;
    window.PaginationHelper = {
        render: renderStandardPagination,
        normalize: normalize
    };
})();
