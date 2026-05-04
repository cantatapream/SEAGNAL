/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet1.js
 * 역할: 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸
 * ============================================================================
 *
 * [설명]
 * 지도(모드 A) 클릭 시 떠오르는 바텀시트의 핵심 모듈입니다.
 * 5개 파일(ocean_bottom_sheet1~5.js)로 분할되어 있으며,
 * 이 파일이 가장 먼저 로드되어 공용 네임스페이스 `window.OceanSheet`를 만들고
 * 다른 파일들이 그 안에 메서드/렌더러를 붙이는 구조입니다.
 *
 * [분할 구성]
 *  1.js  코어/상태/진입점/공용 유틸           ← 본 파일
 *  2.js  헤더(날짜네비/📍토글/✕) 렌더 + 컨트롤
 *  3.js  조석 카드 (TideBED 폴링 + 렌더링 3모드)
 *  4.js  동해북부 IDW 우회 + 천문 카드 (SunCalc)
 *  5.js  6개 일반카드 + 저질 분석 + 오케스트레이터
 *
 * [의존]
 * - tide.js (전역 함수: getLunarDate, getAstronomyInfo, findNearestStationsWithData,
 *            interpolateTideByIDW, convertIDWToTideBedFormat, loadTideData,
 *            getClientAdjacentDates) — typeof 가드 후 호출
 * - SunCalc (CDN 전역 객체)
 * ============================================================================
 */

(function () {
    'use strict';

    /* --------------------------------------------------------------
     * 공용 네임스페이스
     * ------------------------------------------------------------ */
    // window.OceanSheet 라는 단일 네임스페이스 안에 5개 파일이 메서드를 붙입니다.
    // 다른 파일에서 OceanSheet.state, OceanSheet.renderHeader 등으로 접근.
    var OS = window.OceanSheet = window.OceanSheet || {};

    /* --------------------------------------------------------------
     * 시트 상태 (현재 클릭된 좌표 + 보고 있는 날짜)
     * ------------------------------------------------------------ */
    OS.state = {
        lat: null,        // 클릭한 위도
        lon: null,        // 클릭한 경도
        date: new Date(), // 현재 시트가 표시 중인 날짜 (오늘 기준 시작)
        coordVisible: false, // 📍 토글 상태
        bound: false,     // 헤더 컨트롤 이벤트 바인딩 여부 (1회만)
        useKts: false,    // KTS 단위 토글 (해류/바람)
        rawCrsp: null,    // 해류 원시 속도 (cm/s)
        rawCrdir: null,   // 해류 원시 방향 (deg)
        rawWindSpeed: null, // 바람 원시 속도 (m/s)
        rawWindDir: null,   // 바람 원시 방향 (deg)
    };

    /* --------------------------------------------------------------
     * 풍향 도(°) → 16방위 텍스트 변환 (다른 파일에서 재사용)
     * ------------------------------------------------------------ */
    var WIND_DIR_NAMES = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
        '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
    OS.windDirToText = function (deg) {
        if (deg == null || isNaN(deg)) return '--';
        var idx = Math.round(deg / 22.5) % 16;
        return WIND_DIR_NAMES[idx];
    };

    /* --------------------------------------------------------------
     * 날짜 → YYYYMMDD 정수 (TideBED API가 기대하는 형식)
     * ------------------------------------------------------------ */
    OS.formatDateInt = function (date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return parseInt(y + '' + m + '' + d);
    };

    /* --------------------------------------------------------------
     * "오늘"과 같은 날인지 비교 (날짜만, 시각 무시)
     * ------------------------------------------------------------ */
    OS.isToday = function (date) {
        var t = new Date();
        return date.getFullYear() === t.getFullYear()
            && date.getMonth() === t.getMonth()
            && date.getDate() === t.getDate();
    };

    /* --------------------------------------------------------------
     * 카드 표시/숨김 (DOM display 속성 토글)
     * ------------------------------------------------------------ */
    OS.showCard = function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    };
    OS.hideCard = function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    };

    /* --------------------------------------------------------------
     * 일반 6카드의 값 자리에 무한 진행바를 다시 그려 넣기
     *  (날짜 변경 시 카드 reset에 사용)
     * ------------------------------------------------------------ */
    OS.resetCardToProgress = function (valId) {
        var el = document.getElementById(valId);
        if (!el) return;
        el.classList.remove('ocean-skeleton');
        el.innerHTML = '<div class="ocean-progress-bar"><div class="ocean-progress-bar-fill"></div></div>';
    };

    /* --------------------------------------------------------------
     * 6카드 값 텍스트 설정 (응답 도착 시 진행바를 텍스트로 교체)
     * ------------------------------------------------------------ */
    OS.setCardValue = function (valId, text) {
        var el = document.getElementById(valId);
        if (!el) return;
        el.classList.remove('ocean-skeleton');
        el.textContent = text;
    };

    /* --------------------------------------------------------------
     * 시트 닫기 + 휴대폰 뒤로가기 연동
     * ------------------------------------------------------------
     *
     * [동작 모델: 단순화된 1개 상태]
     *
     *   _historyDummyActive : 지금 우리(바텀시트)가 푸시한 "더미 history state"가
     *                         브라우저 history 스택에 살아있느냐 여부.
     *
     *   ┌──────────────────────────────┐
     *   │ 시트 열기 (showOceanBottomSheet) │
     *   │   - dummy 가 없으면 pushState   │
     *   │   - _historyDummyActive = true  │
     *   └──────────────────────────────┘
     *           │
     *           ├── 사용자가 ✕ 또는 닫기 버튼 클릭
     *           │      → closeSheet(false)
     *           │         ├── 시트 DOM 닫기
     *           │         ├── dummy 가 살아있으면 history.back() 호출
     *           │         │     (그 결과 popstate 가 발화되지만,
     *           │         │      그 시점에는 이미 dummy=false 로 만들어 두므로
     *           │         │      popstate 핸들러는 아무 것도 하지 않음)
     *           │         └── _historyDummyActive = false
     *           │
     *           └── 사용자가 휴대폰 시스템 뒤로가기 버튼
     *                  → 브라우저가 dummy 를 pop → popstate 발화
     *                    ├── _historyDummyActive 가 true 이면 우리 케이스로 인지
     *                    ├── _historyDummyActive = false  (back() 재호출 방지)
     *                    └── closeSheet(true) 호출 → 시트만 닫고 끝
     *
     * [왜 이렇게 단순한가?]
     *  - "내가 push 한 dummy 가 살아있나?" 라는 1개 boolean 만 보면
     *    어느 경로(사용자 닫기/시스템 뒤로가기)인지 항상 정확히 분기됨.
     *  - 닫기 애니메이션(300ms) 중 popstate 가 들어와도 dummy 플래그만 보고 판단하므로
     *    .open 클래스 유무에 의존하지 않아 race 가 없음.
     *
     * [연계]
     *  - showOceanBottomSheet (이 파일 아래쪽) 에서 dummy push
     *  - 헤더의 ✕ 버튼 (ocean_bottom_sheet2.js bindControls) → closeSheet()
     *  - Android WebView/PWA 시스템 뒤로가기 → popstate 표준 경로
     * ------------------------------------------------------------ */
    /**
     * 시트를 닫는다.
     *
     * [뒤로가기 처리]
     *  본 모듈은 더 이상 직접 history.pushState/popstate 를 다루지 않는다.
     *  대신 backbutton.js 의 PopupStack 에 'ocean-bottom-sheet' 항목을 등록해 두면,
     *  시스템 뒤로가기 시 backbutton.js 가 PopupStack.popLast() 를 호출하면서
     *  여기 등록한 closeSheet 콜백이 자동으로 불린다.
     */
    OS.closeSheet = function () {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;

        // 1) 시각적으로 시트 내려가기
        sheet.classList.remove('open');
        setTimeout(function () { sheet.style.display = 'none'; }, 300);

        // 1.5) 시트 슬라이더 정리 — 말풍선 즉시 제거 (드래그 중 닫혔어도 잔상 X)
        if (OS.SheetTL && typeof OS.SheetTL.teardown === 'function') {
            OS.SheetTL.teardown();
        }

        // 1.7) 진행 중인 zone-forecasts fetch 취소 — 닫힌 시트의 STL.setMaxHours 발화 방지.
        //      애니메이션 300ms 윈도우 안에 응답 도착 시 onRelease 자동 발화 가능성 차단.
        if (OS.state && OS.state._zoneFetchAbort) {
            try { OS.state._zoneFetchAbort.abort(); } catch (e) { /* 일부 브라우저 미지원 무시 */ }
            OS.state._zoneFetchAbort = null;
        }

        // 2) PopupStack 에서 본인 제거 (popLast 가 부른 경우엔 이미 pop 되었지만 안전)
        if (window.PopupStack) {
            window.PopupStack.remove('ocean-bottom-sheet');
        }

        // 3) 천기 카드 진행 중 fetch 토큰 무효화 + display:none — 잔여 응답 무시.
        //    INDEX1 등 이 모듈 미로드 환경은 자동 skip (typeof check).
        if (typeof OS.hideWeatherCard === 'function') OS.hideWeatherCard();
    };

    /* --------------------------------------------------------------
     * 핸들(──) 드래그로 시트 닫기
     * ------------------------------------------------------------
     *
     * [동작]
     *  - 시트 상단 핸들 막대를 손가락(또는 마우스)으로 잡고 아래로 끌면
     *    시트가 따라 내려오고, 손을 떼는 순간:
     *      • 충분히 내렸으면 (≥80px) → 닫기
     *      • 빠르게 튕기듯 내렸으면 (속도 ≥0.5 px/ms) → 닫기
     *      • 그 외 → 원위치(스프링백)
     *  - 위로 끌어올리는 동작은 무시 (이미 끝까지 열린 상태이므로)
     *
     * [왜 Pointer Events 인가]
     *  - touch / mouse / pen 을 단일 코드로 처리 → 모바일/데스크톱 동일
     *  - .ocean-sheet-handle 에 touch-action: none 을 줘서
     *    브라우저 기본 스크롤 제스처와 충돌하지 않음
     *
     * [드래그 시작 영역]
     *  - 핸들 div(::before 로 hit area 확장) 만 드래그 시작 가능 →
     *    시트 본문 스크롤은 그대로 동작 (스크롤하다 닫힘 X)
     *
     * [연계]
     *  - DOM: index.html .ocean-sheet-handle, #ocean-bottom-sheet
     *  - CSS: .ocean-bottom-sheet.dragging (드래그 중 transition 끔)
     *  - 닫기: 위에 정의한 OS.closeSheet() 사용
     * ------------------------------------------------------------ */
    OS._dragBound = false;
    OS.bindHandleDrag = function () {
        if (OS._dragBound) return;
        var sheet  = document.getElementById('ocean-bottom-sheet');
        var handle = sheet ? sheet.querySelector('.ocean-sheet-handle') : null;
        if (!handle || !sheet) return;

        var startY = 0;          // 드래그 시작 시점의 손가락 Y
        var startTime = 0;       // 시작 시각 (속도 계산용)
        var lastY = 0;           // 최근 손가락 Y (속도 계산용)
        var lastTime = 0;        // 최근 시각
        var dragging = false;    // 현재 드래그 중인지
        var pointerId = null;    // 캡처한 포인터 ID

        handle.addEventListener('pointerdown', function (e) {
            // 좌클릭/터치만 (마우스 우클릭 등 제외)
            if (e.button != null && e.button !== 0) return;
            dragging = true;
            startY = lastY = e.clientY;
            startTime = lastTime = Date.now();
            pointerId = e.pointerId;
            try { handle.setPointerCapture(pointerId); } catch (err) {}
            sheet.classList.add('dragging');
        });

        handle.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dy = e.clientY - startY;
            // 위로 끌어올리는 건 무시 (transform 음수 방지)
            if (dy < 0) dy = 0;
            sheet.style.transform = 'translateY(' + dy + 'px)';
            lastY = e.clientY;
            lastTime = Date.now();
        });

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('dragging');
            try { if (pointerId != null) handle.releasePointerCapture(pointerId); } catch (err) {}
            pointerId = null;

            var totalDy = (e ? e.clientY : lastY) - startY;
            if (totalDy < 0) totalDy = 0;

            // 속도 계산: 마지막 30ms 의 평균 속도 근사
            var elapsed = Math.max(1, lastTime - startTime);
            var velocity = totalDy / elapsed; // px / ms

            var SHOULD_CLOSE = totalDy >= 80 || velocity >= 0.5;
            if (SHOULD_CLOSE) {
                // 인라인 transform 을 비워서 .ocean-bottom-sheet (open 제거 시) 의
                // translateY(100%) 로 자연스럽게 내려가도록 한다.
                sheet.style.transform = '';
                OS.closeSheet();
            } else {
                // 스프링백 — 원위치 (open 클래스의 translateY(0) 로)
                sheet.style.transform = '';
            }
        }
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        OS._dragBound = true;
    };

    // popstate 처리는 marine.js 의 단일 통합 핸들러가 담당한다.
    // (시트 dummy → 섹션 dummy 순으로 분기)

    /* --------------------------------------------------------------
     * 진입점 — 지도 클릭 시 ocean_map.js가 호출
     *
     * @param {number} lat 위도
     * @param {number} lon 경도
     * @param {Object} [stationInfo] 표준항 마커 정보 (현재 미사용)
     * ------------------------------------------------------------ */
    window.showOceanBottomSheet = function (lat, lon, stationInfo) {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;

        // [시트 열림 가드 — 사용자 합의 Q3 / 모든 진입 경로 커버]
        // 시트가 이미 열린 상태에서 다른 해점/마커/부이 클릭은 조용히 무시.
        // ocean_map.js click handler 외에도 ocean_markers.js, ocean_buoy.js 가
        // 직접 showOceanBottomSheet 를 호출 가능 → 여기서 통합 차단.
        if (sheet.style.display !== 'none' && sheet.classList.contains('open')) {
            return;
        }

        // 상태 초기화: 타임라인 슬라이더 오프셋이 있으면 해당 시각 기준으로 시작
        OS.state.lat = lat;
        OS.state.lon = lon;
        OS.state.date = new Date();
        var tlSlider = document.getElementById('ocean-timeline-slider');
        if (tlSlider) {
            var tlHours = parseInt(tlSlider.value) || 0;
            if (tlHours > 0) {
                OS.state.date = new Date(OS.state.date.getTime() + tlHours * 60 * 60 * 1000);
            }
        }

        // 시트 표시 (살짝 지연 후 transition 클래스 부여)
        sheet.style.display = 'block';
        sheet.scrollTop = 0; // 새로 열 때 스크롤 최상단으로
        setTimeout(function () { sheet.classList.add('open'); }, 10);

        // 휴대폰 시스템 뒤로가기로 시트를 닫을 수 있도록
        // backbutton.js 의 PopupStack 에 등록 (LIFO).
        // 시스템 뒤로가기 → PopupStack.popLast() → OS.closeSheet 가 자동 호출됨.
        if (window.PopupStack) {
            window.PopupStack.push('ocean-bottom-sheet', function () {
                OS.closeSheet();
            });
        }

        // 헤더 컨트롤 1회 바인딩 (2.js 정의)
        if (!OS.state.bound && OS.bindControls) {
            OS.bindControls();
            OS.state.bound = true;
        }

        // 핸들 드래그 닫기 1회 바인딩
        if (OS.bindHandleDrag) OS.bindHandleDrag();

        // [시트 슬라이더 init — loadAllForDate 보다 먼저!]
        // STL.init 은 OS.state.date 를 슬라이더의 firstFrame 시각으로 동기시킴.
        // loadAllForDate 가 OS.state.date 기반으로 카드 fetch 하므로,
        // 슬라이더 시각으로 OS.state.date 를 먼저 맞춰놔야 카드 데이터와 헤더 표시 시각이 일치.
        // (slider value=0 의 firstFrame ≈ now 에 가장 가까운 3h 경계 — real now 와 약간 다름)
        // - 초기 슬라이더 값 = 레이어 타임라인 슬라이더 현재 value (0~72 시간)
        // - 초기 max = 레이어 슬라이더 현재 max (wave/wind 활성 상태였다면 이미 maxForecastHours 반영됨)
        // - max 의 정확한 wave/wind 한계는 Phase 9 (zone-forecasts 비동기 호출) 에서 STL.setMaxHours 로 갱신
        if (OS.SheetTL && typeof OS.SheetTL.init === 'function') {
            var initLayerHours = 0;
            var initZoneMax = 72;
            if (tlSlider) {
                initLayerHours = parseFloat(tlSlider.value) || 0;
                initZoneMax = parseFloat(tlSlider.max) || 72;
            }
            OS.SheetTL.init(initLayerHours, initZoneMax);
        }

        // 헤더 렌더 (2.js) — STL.init 이 OS.state.date 갱신했으니 그 시각으로 표시
        if (OS.renderHeader) OS.renderHeader();

        // 전체 데이터 로딩 시작 (5.js) — OS.state.date = firstFrame 시각, 카드 데이터와 헤더 일치
        if (OS.loadAllForDate) OS.loadAllForDate();

        // [예보 범위 외 가시성 정책 — 안전 가드]
        // 시트 첫 오픈 시 OS.state.date 가 진짜 "now" 라 항상 in-range 이지만,
        // tlSlider.value 가 +수십시간으로 잡힌 경우엔 OS.state.date 도 그만큼 미래. 안전하게 호출.
        if (typeof OS._enforceForecastRangeVisibility === 'function') {
            OS._enforceForecastRangeVisibility();
        }

        // [Phase 9 — zone-forecasts 정확한 max 조회]
        // 시트 슬라이더 max 의 신뢰값은 zone-forecasts 응답의 maxForecastHours.
        // 정책: 캐시 X. 시트 열 때마다 비동기 호출 (40ms 평균, 사용자 인지 X).
        // AbortController 로 닫힐 때 취소 → 닫힌 시트의 setMaxHours 자동 onRelease 폭주 방지.
        var ac = (typeof AbortController === 'function') ? new AbortController() : null;
        OS.state._zoneFetchAbort = ac;
        var fetchOpts = ac ? { signal: ac.signal } : {};
        fetch('/api/ocean/zone-forecasts', fetchOpts)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || typeof data.maxForecastHours !== 'number') return;
                // 응답 도착 시 시트가 이미 닫혀있으면 무동작
                var sheetEl = document.getElementById('ocean-bottom-sheet');
                if (!sheetEl || sheetEl.style.display === 'none' ||
                    !sheetEl.classList.contains('open')) return;

                var newMax = data.maxForecastHours;

                // 시트 슬라이더 max 갱신 — STL 자체가 value 클램프 + onRelease 자동 발화
                if (OS.SheetTL && typeof OS.SheetTL.setMaxHours === 'function') {
                    OS.SheetTL.setMaxHours(newMax);
                }

                // 레이어 슬라이더 max 도 일관성 위해 동기 (wave/wind 비활성 상태에서도)
                var tl2 = document.getElementById('ocean-timeline-slider');
                if (tl2 && typeof window.setTimelineMax === 'function' &&
                    parseFloat(tl2.max) !== newMax) {
                    window.setTimelineMax(newMax);
                }

                // max 갱신 후 범위 재판정 (sheetDate 가 새 max 너머로 밀려난 경우)
                if (typeof OS._enforceForecastRangeVisibility === 'function') {
                    OS._enforceForecastRangeVisibility();
                }
            })
            .catch(function (err) {
                // AbortError (시트 닫힘) 또는 네트워크 실패 — 둘 다 디폴트 max 유지하면 됨
            });
    };

    /* --------------------------------------------------------------
     * (호환) 기존 ocean_map.js의 stub getOceanDate를 더 이상 사용하지 않음.
     *   Step 5에서 stub 자체가 제거됨.
     * ------------------------------------------------------------ */
})();
