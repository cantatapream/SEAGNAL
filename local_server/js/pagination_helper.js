/**
 * ============================================================================
 * 파일명: js/pagination_helper.js
 * 역할: 관리자 리스트 화면용 공용 페이지네이션 UI helper
 * ============================================================================
 *
 * [노출 API]
 *   window.renderStandardPagination(container, currentPage, totalPages, onPageChange)
 *
 * [설명]
 *   - 페이지 수가 1 이하일 때는 컨테이너를 비우고 종료
 *   - ‹ 1 2 3 ... › 형태의 버튼 UI 를 container.innerHTML 로 갱신
 *   - 현재 페이지 ±2 + 처음/끝 페이지만 표시 (그 외는 ellipsis "…")
 *   - 인라인 onclick 대신 addEventListener 로 콜백 바인딩
 *   - 클래스는 기존 `.promo-pagination` 영역에서 사용 중인
 *     `.pagination` / `.pagination-btn` / `.pagination-btn.active` 와 통일
 *
 * [현재 사용처]
 *   - js/alert_push.js renderHistoryTab() (특보 발송 이력)
 *   - js/admin_report.js renderReportList() (제보 관리)
 *
 * [디자인 원칙]
 *   - 전역 오염 최소화: window.renderStandardPagination 단일 함수만 노출
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
     */
    function renderStandardPagination(container, currentPage, totalPages, onPageChange) {
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
                html += '<span class="pagination-btn" style="border:none;background:transparent;cursor:default;">…</span>';
            } else {
                const activeCls = p === cur ? ' active' : '';
                html += '<button type="button" class="pagination-btn' + activeCls + '" data-page="' + p + '">' + p + '</button>';
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

        // 클릭 이벤트 바인딩 (인라인 onclick 회피)
        const buttons = container.querySelectorAll('button.pagination-btn[data-page]');
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                const target = parseInt(btn.getAttribute('data-page'), 10);
                if (isNaN(target) || target < 1 || target > total || target === cur) return;
                if (typeof onPageChange === 'function') onPageChange(target);
            });
        });
    }

    // 단일 전역 함수만 노출 (PaginationHelper 객체로도 접근 가능하도록 한 번 더 wrap)
    window.renderStandardPagination = renderStandardPagination;
    window.PaginationHelper = { render: renderStandardPagination };
})();
