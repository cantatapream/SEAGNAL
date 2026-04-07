/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet2.js
 * 역할: 바텀시트 헤더 — 날짜 네비게이션 + 음력 표시 + 📍 토글 + ✕ 닫기
 * ============================================================================
 *
 * [표시 형식]
 *   ◀  2026년 4월 7일(화)  ▶                       📍   ✕
 *       (음력 2026년 2월 20일)
 *       📍 34.860, 124.439         ← 📍 토글 ON일 때만
 *
 * [동작]
 * - ◀ 는 오늘 날짜에 도달하면 비활성 (과거로 못 감)
 * - ▶ 는 항상 활성 (미래는 무제한)
 * - 📍 클릭 시 좌표 행 토글
 * - 날짜 변경 시 5.js의 loadAllForDate()를 호출하여 모든 데이터 재로딩
 *
 * [의존]
 * - tide.js의 getLunarDate(year, month, date) — 전역 함수
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};
    var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

    /* --------------------------------------------------------------
     * 헤더 렌더링: 양력/음력/좌표/◀ 비활성 여부 갱신
     * ------------------------------------------------------------ */
    OS.renderHeader = function () {
        var d = OS.state.date;

        // (1) 양력
        var solarEl = document.getElementById('ocean-sheet-solar');
        if (solarEl) {
            solarEl.textContent =
                d.getFullYear() + '년 ' +
                (d.getMonth() + 1) + '월 ' +
                d.getDate() + '일(' + WEEKDAYS_KO[d.getDay()] + ')';
        }

        // (2) 음력 — tide.js의 getLunarDate 재사용
        var lunarEl = document.getElementById('ocean-sheet-lunar');
        if (lunarEl) {
            if (typeof getLunarDate === 'function') {
                try {
                    var lunarStr = getLunarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
                    lunarEl.textContent = '(음력 ' + lunarStr + ')';
                } catch (e) {
                    lunarEl.textContent = '';
                }
            } else {
                lunarEl.textContent = '';
            }
        }

        // (3) ◀ 버튼 활성/비활성: 오늘이면 비활성
        var prevBtn = document.getElementById('ocean-sheet-prev');
        if (prevBtn) {
            if (OS.isToday(d)) {
                prevBtn.setAttribute('disabled', 'disabled');
            } else {
                prevBtn.removeAttribute('disabled');
            }
        }

        // (4) 좌표 행 (📍 토글 상태에 따라)
        var coordEl = document.getElementById('ocean-sheet-coord');
        if (coordEl) {
            if (OS.state.coordVisible && OS.state.lat != null) {
                coordEl.textContent =
                    '📍 ' + OS.state.lat.toFixed(3) + ', ' + OS.state.lon.toFixed(3);
                coordEl.style.display = '';
            } else {
                coordEl.style.display = 'none';
            }
        }

        // (5) 📍 버튼 active 클래스
        var locBtn = document.getElementById('ocean-sheet-loc-toggle');
        if (locBtn) {
            if (OS.state.coordVisible) locBtn.classList.add('active');
            else locBtn.classList.remove('active');
        }
    };

    /* --------------------------------------------------------------
     * 컨트롤 1회 바인딩 (◀ ▶ 📍 ✕)
     * ------------------------------------------------------------ */
    OS.bindControls = function () {
        var prevBtn = document.getElementById('ocean-sheet-prev');
        var nextBtn = document.getElementById('ocean-sheet-next');
        var locBtn  = document.getElementById('ocean-sheet-loc-toggle');
        var closeBtn = document.getElementById('ocean-sheet-close');

        if (prevBtn) prevBtn.addEventListener('click', OS.goPrev);
        if (nextBtn) nextBtn.addEventListener('click', OS.goNext);
        if (locBtn)  locBtn.addEventListener('click', OS.toggleCoord);
        if (closeBtn) closeBtn.addEventListener('click', OS.closeSheet);
    };

    /* --------------------------------------------------------------
     * ◀ : 하루 전으로 (오늘이면 무시)
     * ------------------------------------------------------------ */
    OS.goPrev = function () {
        if (OS.isToday(OS.state.date)) return; // 과거 차단
        var d = new Date(OS.state.date);
        d.setDate(d.getDate() - 1);
        OS.state.date = d;
        OS.renderHeader();
        if (OS.loadAllForDate) OS.loadAllForDate();
    };

    /* --------------------------------------------------------------
     * ▶ : 하루 후로
     * ------------------------------------------------------------ */
    OS.goNext = function () {
        var d = new Date(OS.state.date);
        d.setDate(d.getDate() + 1);
        OS.state.date = d;
        OS.renderHeader();
        if (OS.loadAllForDate) OS.loadAllForDate();
    };

    /* --------------------------------------------------------------
     * 📍 토글
     * ------------------------------------------------------------ */
    OS.toggleCoord = function () {
        OS.state.coordVisible = !OS.state.coordVisible;
        OS.renderHeader();
    };
})();
