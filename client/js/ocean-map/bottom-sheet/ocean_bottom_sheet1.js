/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet1.js
 * 역할: 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸
 * [연계]
 *  - 사용하는 파일 : tide.js(전역 조석/천문 함수), ocean_bottom_sheet2~5.js·ocean_sheet_timeline.js(OS 네임스페이스 공유),
 *                    backbutton.js(window.PopupStack), ocean_typhoon.js(window.OceanTyphoon), SunCalc(CDN)
 *  - 서버 API      : GET /api/ocean/zone-forecasts
 *  - 마크업        : index2.html #ocean-bottom-sheet, .ocean-sheet-handle, #ocean-sheet-typhoon-eta, #ocean-timeline-slider
 *  - 나를 쓰는 곳  : window.showOceanBottomSheet — ocean_map.js(handleMapClick)·ocean_markers.js·ocean_buoy.js·ocean_cctv.js·assistant_deeplink.js
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

        // 1) 시각적으로 시트 내려가기 — fade-out 후 display:none.
        //    [중요] 타이머 핸들을 OS.state._closeHideTimer 에 저장해서 새 시트 오픈 시
        //    캔슬할 수 있게 함. 캔슬 안 하면 "close → 300ms 안에 재오픈" 시 이 setTimeout
        //    이 발화해서 새 시트도 hide 됨 (race).
        sheet.classList.remove('open');
        if (OS.state._closeHideTimer) clearTimeout(OS.state._closeHideTimer);
        OS.state._closeHideTimer = setTimeout(function () {
            sheet.style.display = 'none';
            OS.state._closeHideTimer = null;
        }, 300);

        // 1.5) 시트 슬라이더 정리 — 말풍선 즉시 제거
        if (OS.SheetTL && typeof OS.SheetTL.teardown === 'function') {
            OS.SheetTL.teardown();
        }

        // 1.6) [회귀 보강 — 2026-05] 보류 중인 _syncLayerSliderToSheet debounce 캔슬.
        //      250ms 이내 release → close 연쇄에서 timer 가 살아남으면 닫힌 시트의
        //      의도로 oceanOverlaySetTime 이 발화될 수 있음.
        if (typeof OS._cancelSyncLayerDebounce === 'function') {
            OS._cancelSyncLayerDebounce();
        }

        // 1.7) 진행 중인 zone-forecasts fetch 취소 — 닫힌 시트의 setMaxHours 발화 방지
        if (OS.state && OS.state._zoneFetchAbort) {
            try { OS.state._zoneFetchAbort.abort(); } catch (e) { /* 일부 브라우저 미지원 무시 */ }
            OS.state._zoneFetchAbort = null;
        }

        // 1.8) 진행 중인 비동기 fetch 응답이 닫힌 시트를 갱신하지 않도록 epoch 무효화
        //      (다음 sheet open 시 _loadEpoch 재발급, stale 응답은 무시됨)
        if (OS.state) OS.state._loadEpoch = (OS.state._loadEpoch || 0) + 1;

        // 2) PopupStack 에서 본인 제거 (popLast 가 부른 경우엔 이미 pop 되었지만 안전)
        if (window.PopupStack) {
            window.PopupStack.remove('ocean-bottom-sheet');
        }

        // 3) 천기 카드 진행 중 fetch 토큰 무효화 + display:none — 잔여 응답 무시.
        //    INDEX1 등 이 모듈 미로드 환경은 자동 skip (typeof check).
        if (typeof OS.hideWeatherCard === 'function') OS.hideWeatherCard();
        if (typeof OS.hideVsbyCard === 'function') OS.hideVsbyCard();

        // 4) [차등 캐싱 — 2026-05] 비즐겨찾기 해점이면 메모리 조석 캐시 폐기.
        //    즐겨찾기 해점은 메모리 캐시 그대로 유지 → 다음 오픈 시 prefill 없이도 hit.
        //    _tideRenderState 는 어느 경우든 clear (다른 좌표 재오픈 시 stale 차단).
        if (typeof OS.dropMemoryCacheIfNotFavorite === 'function') {
            OS.dropMemoryCacheIfNotFavorite();
        }

        // ❷ 첫 렌더 플래그 reset — 다음 오픈 시 새로 'error' 가 올 수 있으므로
        if (typeof OS.resetTideFirstRender === 'function') {
            OS.resetTideFirstRender();
        }
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
     * 태풍 내습 카운트다운 배지 갱신 (날짜 네비 아래 / 슬라이더 위).
     *   태풍 ON + 이 해점이 강풍반경 진로상(eta/inside)일 때만 표출.
     *   색: 남은시간 적을수록 노랑→빨강 그라데이션. (CSS 가 페이드 깜빡 처리)
     * ------------------------------------------------------------ */
    function updateTyphoonEtaBadge(lat, lon) {
        var el = document.getElementById('ocean-sheet-typhoon-eta');
        if (!el) return;
        var info = (window.OceanTyphoon && window.OceanTyphoon.getArrivalInfo)
            ? window.OceanTyphoon.getArrivalInfo(lat, lon) : null;
        if (!info || (info.status !== 'eta' && info.status !== 'inside')) {
            el.style.display = 'none'; el.textContent = ''; return;
        }
        var ratio, text;
        if (info.status === 'inside') {
            ratio = 1; text = '현재 태풍 강풍반경 영향권';
        } else {
            var h = info.remainMs / 3600000;
            ratio = Math.max(0, Math.min(1, 1 - h / 48)); // 0h→1(빨강), 48h+→0(노랑)
            var m = Math.max(0, Math.round(info.remainMs / 60000));
            var d = Math.floor(m / 1440); m -= d * 1440;
            var hh = Math.floor(m / 60); m -= hh * 60;
            var parts = [];
            if (d > 0) parts.push(d + '일');
            if (hh > 0 || d > 0) parts.push(hh + '시간');
            parts.push(m + '분');
            text = parts.join(' ') + ' 후 내습 예상';
        }
        // 노랑(255,210,74) → 빨강(255,59,59)
        var r = 255, g = Math.round(210 + (59 - 210) * ratio), b = Math.round(74 + (59 - 74) * ratio);
        el.style.color = 'rgb(' + r + ',' + g + ',' + b + ')';
        el.textContent = text;
        el.style.display = '';
    }

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

        // [시트 열림 가드 — 사용자 합의 Q3]
        // 시트가 이미 열린 상태에서 다른 해점/마커/부이 클릭은 조용히 무시.
        // ocean_map.js click handler 외에도 ocean_markers.js, ocean_buoy.js 가 직접
        // showOceanBottomSheet 를 호출 가능 → 여기서 통합 차단. 토스트 X.
        if (sheet.style.display !== 'none' && sheet.classList.contains('open')) {
            return;
        }

        // [close→재오픈 race 차단] 직전 closeSheet 의 fade-out 타이머가 살아있으면 캔슬.
        // 안 그러면 새 시트 오픈 후 ~300ms 내에 그 타이머가 발화해서 display='none' 으로
        // 새 시트가 사라짐.
        if (OS.state._closeHideTimer) {
            clearTimeout(OS.state._closeHideTimer);
            OS.state._closeHideTimer = null;
        }

        // [조석 캐시 처리 — 멀티 데이 캐시 2026-05]
        // 다른 해점으로 시트가 열릴 때만 캐시 reset. 같은 해점이면 누적된 days 그대로
        // 유지해 (재방문 시 API 호출 절대 X) 사용자 의도 만족.
        //   - 같은 해점: 캐시 그대로 두고 _tideRenderState 만 clear (DOM 부분 갱신 차단).
        //     putCachedDay 가 좌표 비교를 하므로 lat/lon 가 같다면 days 가 그대로 유지됨.
        //   - 다른 해점: 캐시 자체 invalidate. 좌표가 즐겨찾기면 localStorage 에서
        //     prefill (이전에 닫힐 때 영속 보관된 days 를 메모리로 복귀 → API skip 가능).
        //   - 좌표는 5소수점 round 로 비교 (부동소수점 noise 방지).
        var prevCache = OS.state._tideMultiDayCache;
        var sameCoord = false;
        if (prevCache) {
            var pLat = Math.round(prevCache.lat * 100000) / 100000;
            var pLon = Math.round(prevCache.lon * 100000) / 100000;
            var nLat = Math.round(lat * 100000) / 100000;
            var nLon = Math.round(lon * 100000) / 100000;
            sameCoord = (pLat === nLat && pLon === nLon);
        }
        if (!sameCoord) {
            OS.state._tideMultiDayCache = null;
            // 즐겨찾기 해점이면 localStorage 에서 prefill — 만료 dayKey 자동 purge 후 복귀.
            if (typeof OS.prefillMemoryCacheFromPersist === 'function') {
                OS.prefillMemoryCacheFromPersist(lat, lon);
            }
            // ❷ 좌표 변경 시 첫 렌더 플래그 reset
            if (typeof OS.resetTideFirstRender === 'function') {
                OS.resetTideFirstRender();
            }
        }
        OS.state._tideRenderState = null;

        // 상태 초기화: 배경 layerSlider 가 옮겨져 있으면 그 시점의 데이터를 표시
        // (사용자가 슬라이더로 미래 시점 해역 상황을 보다가 해점을 클릭하는 흐름을 보존).
        OS.state.lat = lat;
        OS.state.lon = lon;
        updateTyphoonEtaBadge(lat, lon);   // 태풍 내습 카운트다운 배지(해당 시 표출)
        OS.state.date = new Date();
        var tlSlider = document.getElementById('ocean-timeline-slider');
        if (tlSlider) {
            var tlHours = parseFloat(tlSlider.value);
            if (!isNaN(tlHours) && tlHours > 0) {
                OS.state.date = new Date(OS.state.date.getTime() + tlHours * 3600000);
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
        // STL.init 은 OS.state.date 를 슬라이더 시각으로 동기시킴 (value=0 → real now).
        // loadAllForDate 가 OS.state.date 기반으로 카드 fetch 하므로,
        // 슬라이더 시각으로 OS.state.date 를 먼저 맞춰놔야 카드 데이터와 헤더 표시 시각이 일치.
        // - initialLayerHours = 레이어 슬라이더 현재 value
        // - initZoneMax = 레이어 슬라이더 max (wave/wind 활성 시 이미 maxForecastHours 반영)
        //   정확한 wave/wind 한계는 zone-forecasts 비동기 호출 후 STL.setMaxHours 로 갱신
        if (OS.SheetTL && typeof OS.SheetTL.init === 'function') {
            // 시트 슬라이더 시작값을 배경 layerSlider 위치에 맞춤.
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

        // 전체 데이터 로딩 시작 (5.js) — OS.state.date = 슬라이더 시각, 카드 데이터와 헤더 일치
        if (OS.loadAllForDate) OS.loadAllForDate();

        // [예보 범위 외 가시성 안전 가드]
        if (typeof OS._enforceForecastRangeVisibility === 'function') {
            OS._enforceForecastRangeVisibility();
        }

        // [zone-forecasts 정확한 max 비동기 조회 — 캐시 X, 매 시트 오픈마다 호출]
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

                if (OS.SheetTL && typeof OS.SheetTL.setMaxHours === 'function') {
                    OS.SheetTL.setMaxHours(newMax);
                }
                // 레이어 슬라이더 max 도 일관성 위해 동기
                var tl2 = document.getElementById('ocean-timeline-slider');
                if (tl2 && typeof window.setTimelineMax === 'function' &&
                    parseFloat(tl2.max) !== newMax) {
                    window.setTimelineMax(newMax);
                }
                if (typeof OS._enforceForecastRangeVisibility === 'function') {
                    OS._enforceForecastRangeVisibility();
                }
            })
            .catch(function () { /* AbortError or 네트워크 실패 — 디폴트 max 유지 */ });
    };

    /* --------------------------------------------------------------
     * (호환) 기존 ocean_map.js의 stub getOceanDate를 더 이상 사용하지 않음.
     *   Step 5에서 stub 자체가 제거됨.
     * ------------------------------------------------------------ */
})();
