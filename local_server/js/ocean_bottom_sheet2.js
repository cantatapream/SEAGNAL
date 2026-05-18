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

        // (1) 양력 — 새 포맷: "'26. 5. 2.(토) 17:00"
        //   - 'YY: 연도 끝 두 자리, 앞에 ' 부착 (예: "26" → "'26")
        //   - 월/일: leading zero 없음 (예: 5월 2일 → "5. 2.")
        //   - 요일: (토) 형태
        //   - 시간: HH:MM 24시 (OS.state.date 의 시각 — 슬라이더 이동 시 이 함수가 재호출)
        var solarEl = document.getElementById('ocean-sheet-solar');
        if (solarEl) {
            var yy = String(d.getFullYear()).slice(-2);
            var hh = String(d.getHours()).padStart(2, '0');
            var mi = String(d.getMinutes()).padStart(2, '0');
            solarEl.textContent =
                "'" + yy + ". " +
                (d.getMonth() + 1) + ". " +
                d.getDate() + ".(" + WEEKDAYS_KO[d.getDay()] + ") " +
                hh + ":" + mi;
        }

        // (2) 음력 — 새 포맷: "(음력 '26. 3. 16.)"
        //   tide.js 의 getLunarDate("YYYY년 (윤)?M월 D일") 결과를 점 표기로 변환.
        //   윤달 표기 (윤) 는 월 앞에 그대로 보존.
        var lunarEl = document.getElementById('ocean-sheet-lunar');
        if (lunarEl) {
            if (typeof getLunarDate === 'function') {
                try {
                    var lunarRaw = getLunarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
                    // "2026년 (윤)3월 16일" 또는 "2026년 3월 16일" 두 형태 모두 매칭
                    var m = /^(\d{4})년\s+(\(윤\))?(\d+)월\s+(\d+)일$/.exec(lunarRaw);
                    if (m) {
                        var lyy = m[1].slice(-2);
                        var leap = m[2] || '';
                        lunarEl.textContent = "(음력 '" + lyy + ". " + leap + m[3] + ". " + m[4] + ".)";
                    } else {
                        lunarEl.textContent = '(음력 ' + lunarRaw + ')';   // fallback
                    }
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
     * [외부 hook] 타임라인 슬라이더 이동 시 호출되는 진입점.
     *
     * 무엇을 하나?
     *   ocean_timeline.js 의 onTimeChange(hours) 에서 이 함수 호출.
     *   슬라이더 값(0~72시간) 을 OS.state.date 에 반영하고 헤더 다시 그림.
     *   → 사용자가 슬라이더 잡고 움직이면 헤더의 시간 표시가 따라 움직임.
     *
     * [정책]
     *   - 슬라이더 시간 = 현재 시각 + N 시간 (sheet 처음 열 때와 동일 방식)
     *   - 시트가 닫혀있으면 무시 (OS.state.date 는 그대로)
     *
     * [의존]
     *   - ocean_timeline.js 가 onTimeChange 안에서 이 함수 호출
     *   - OS.state, OS.renderHeader
     */
    OS.onTimelineChanged = function (hours) {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet || sheet.style.display === 'none') return;
        var n = parseInt(hours, 10);
        if (!isFinite(n)) n = 0;
        OS.state.date = new Date(Date.now() + n * 60 * 60 * 1000);
        OS.renderHeader();
        // 천기 카드 — 새 시각으로 다시 sample. 캐시 적중 시 즉답.
        if (typeof OS.loadWeatherCard === 'function' && OS.state.lat != null && OS.state.lon != null) {
            OS.loadWeatherCard(OS.state.lat, OS.state.lon, OS.state.date);
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
        // [시트 슬라이더 동기] OS.state.date 변경됐으니 슬라이더 위치도 따라가게
        if (OS.SheetTL && typeof OS.SheetTL.syncToStateDate === 'function') {
            OS.SheetTL.syncToStateDate();
        }
        // [레이어 슬라이더 + 배경 오버레이 동기] 슬라이더 release 핸들러와 동일하게
        // 새 시각의 배경 히트맵을 다시 로드. (이전엔 호출 누락으로 ◀ 후 카드는
        // 갱신되지만 배경 색은 옛 시각에 멈춰 있던 회귀)
        if (typeof OS._syncLayerSliderToSheet === 'function') {
            OS._syncLayerSliderToSheet();
        }
        // [예보 범위 외 처리] 새 날짜가 wave/wind 범위 안인지 판정
        if (typeof OS._enforceForecastRangeVisibility === 'function') {
            OS._enforceForecastRangeVisibility();
        }
        // 날짜 변경 시 시트 본문 스크롤을 최상단으로 되돌림
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (sheet) sheet.scrollTop = 0;
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
        // [시트 슬라이더 동기]
        if (OS.SheetTL && typeof OS.SheetTL.syncToStateDate === 'function') {
            OS.SheetTL.syncToStateDate();
        }
        // [레이어 슬라이더 + 배경 오버레이 동기] ▶ 후에도 배경 히트맵을 새 시각으로
        // 다시 로드. (goPrev 와 동일 — 슬라이더 release 핸들러와 같은 시각 갱신 흐름)
        if (typeof OS._syncLayerSliderToSheet === 'function') {
            OS._syncLayerSliderToSheet();
        }
        // [예보 범위 외 처리]
        if (typeof OS._enforceForecastRangeVisibility === 'function') {
            OS._enforceForecastRangeVisibility();
        }
        // 날짜 변경 시 시트 본문 스크롤을 최상단으로 되돌림
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (sheet) sheet.scrollTop = 0;
    };

    /* --------------------------------------------------------------
     * 📍 토글
     * ------------------------------------------------------------ */
    OS.toggleCoord = function () {
        OS.state.coordVisible = !OS.state.coordVisible;
        OS.renderHeader();
    };

    /* --------------------------------------------------------------
     * [시트 슬라이더 release 콜백 wire]
     *
     * 사용자가 시트 헤더 슬라이더 손잡이를 잡고 움직이다 놓는 순간 호출.
     * - 같은 날 (sameDay=true)
     *     1) 조석 API 호출 X — 게이지/예상조위 라벨만 클라이언트 재계산
     *     2) 천문(일출몰/월령) skip — 날짜 같으면 결과 동일
     *     3) 시간 의존 카드(천기/파고/풍/유향속/수온) loadAllForDate({skipHeavy:true}) 재호출
     * - 다른 날: 풀 재로드
     *
     * @param {number} hours    - 슬라이더 value (0, 3, 6, 9, ...)
     * @param {boolean} sameDay - 직전 release/init 시점과 같은 날인지
     * @param {Date} newDate    - 새 슬라이더 시각
     * ------------------------------------------------------------ */
    if (window.OceanSheet && window.OceanSheet.SheetTL) {
        window.OceanSheet.SheetTL.onRelease = function (hours, sameDay, newDate) {
            var sheet = document.getElementById('ocean-bottom-sheet');
            if (!sheet || sheet.style.display === 'none') return;
            if (OS.state.lat == null || OS.state.lon == null) return;

            // OS.state.date 는 드래그 중 syncHeaderToSlider 가 매번 갱신했지만 안전을 위해 명시.
            OS.state.date = newDate;

            if (sameDay) {
                if (typeof OS.refreshTideGaugeForTime === 'function') {
                    OS.refreshTideGaugeForTime(newDate);
                }
                if (typeof OS.loadAllForDate === 'function') {
                    OS.loadAllForDate({ skipHeavy: true });
                }
            } else {
                if (typeof OS.loadAllForDate === 'function') {
                    OS.loadAllForDate();
                }
            }

            // 레이어 슬라이더 동기 + 활성 오버레이 reload
            if (typeof OS._syncLayerSliderToSheet === 'function') {
                OS._syncLayerSliderToSheet();
            }

            // 예보 범위 외 처리 (방어 — 일반적으로 in-range 보장)
            if (typeof OS._enforceForecastRangeVisibility === 'function') {
                OS._enforceForecastRangeVisibility();
            }
        };
    }
})();
