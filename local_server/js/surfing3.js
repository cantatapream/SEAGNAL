/**
 * ============================================================================
 * 파일명: js/surfing3.js
 * 역할: 서핑지수 프론트엔드 - 팝업 열기/닫기 + 이벤트 바인딩 + 날짜 네비게이션
 * ============================================================================
 *
 * [설명]
 * - 마커 클릭 시 해수욕장 팝업을 열고, 닫기/오버레이/뒤로가기로 닫습니다.
 * - 날짜 이전(<)/다음(>) 버튼으로 예보 날짜를 전환합니다.
 * - 팝업 콘텐츠 렌더링은 surfing4.js의 renderPopupContent()에 위임합니다.
 *
 * [로드 순서] surfing2.js 다음 (renderMarkers, selectMarker 등이 등록된 상태)
 *
 * [연계]
 * - surfing1.js → initSurfingMap()에서 s.bindEvents(), s.openPopup() 호출
 * - surfing2.js → s.selectMarker(), s.resetMarkerStyle() 사용
 * - surfing4.js → s.renderPopupContent() 호출 (팝업 내용 채우기)
 * - index.html → #surfing-popup, #surfing-popup-overlay, #surfing-popup-close,
 *                #surfing-popup-beach-name, #surfing-date-prev/next/label,
 *                #surfing-popup-content
 *
 * [팝업 동작 흐름]
 * 1. 사용자가 지도에서 마커 클릭
 * 2. surfing1.js의 singleclick 이벤트 → s.openPopup('경포해수욕장')
 * 3. 해당 해수욕장의 예보 날짜 목록 추출 + 팝업 표시
 * 4. s.renderPopupContent() → surfing4.js가 서핑지수 테이블 + 상세정보 렌더링
 * 5. 사용자가 < > 버튼 클릭 → 날짜 변경 → renderPopupContent() 재호출
 * 6. 닫기(✕)/오버레이/뒤로가기 → closePopup()
 * ============================================================================
 */

(function () {
    'use strict';

    // surfing1.js에서 생성된 공유 상태 객체
    if (!window._surfing) {
        console.error('surfing3.js: window._surfing이 없습니다. surfing1.js를 먼저 로드하세요.');
        return;
    }

    var s = window._surfing;

    // ========================================================================
    // 1. 이벤트 바인딩 (initSurfingMap에서 최초 1회 호출)
    // ========================================================================

    /**
     * 팝업 닫기, 오버레이 클릭, 날짜 이전/다음 버튼 이벤트를 바인딩합니다.
     *
     * [낚시지수와의 차이]
     * - 갯바위/선상 토글 없음 (서핑은 구분 없음)
     * - GPS 내 위치 버튼 없음
     * - 팝업 ID: surfing-popup-* (낚시: fishing-bs-*)
     *
     * [호출 시점]
     * surfing1.js → initSurfingMap() → s.bindEvents()
     */
    function _bindEvents() {
        // --- 팝업 닫기(✕) 버튼 ---
        // index.html의 #surfing-popup-close 요소에 클릭 이벤트 연결
        var closeBtn = document.getElementById('surfing-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                _closePopup();
            });
        }

        // --- 팝업 오버레이 클릭으로 닫기 ---
        // 팝업 뒤의 어두운 배경을 클릭하면 팝업이 닫힙니다
        var overlay = document.getElementById('surfing-popup-overlay');
        if (overlay) {
            overlay.addEventListener('click', function () {
                _closePopup();
            });
        }

        // --- 날짜 이전(<) 버튼 ---
        // 현재 날짜 인덱스가 0보다 크면(첫 번째 날짜가 아니면) 인덱스를 1 감소시키고
        // 팝업 콘텐츠를 새 날짜 데이터로 다시 렌더링합니다
        var prevBtn = document.getElementById('surfing-date-prev');
        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (s.selectedDateIdx > 0) {
                    s.selectedDateIdx--;
                    if (s.renderPopupContent) s.renderPopupContent();
                }
            });
        }

        // --- 날짜 다음(>) 버튼 ---
        // 현재 날짜 인덱스가 마지막이 아니면 인덱스를 1 증가시키고
        // 팝업 콘텐츠를 새 날짜 데이터로 다시 렌더링합니다
        var nextBtn = document.getElementById('surfing-date-next');
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (s.selectedDateIdx < s.availableDates.length - 1) {
                    s.selectedDateIdx++;
                    if (s.renderPopupContent) s.renderPopupContent();
                }
            });
        }
    }

    // ========================================================================
    // 2. 팝업 열기
    // ========================================================================

    /**
     * 특정 해수욕장의 서핑지수 팝업을 엽니다.
     *
     * [동작 순서]
     * 1. 선택된 해수욕장명과 날짜 인덱스를 초기화 (첫 번째 날짜 = 0)
     * 2. 해당 해수욕장의 예보 날짜 목록 추출 및 정렬
     * 3. 팝업 헤더에 해수욕장명 표시
     * 4. 팝업 + 오버레이 DOM에 active 클래스 추가 (CSS transition으로 등장)
     * 5. PopupStack에 등록 (뒤로가기 버튼으로 닫기 지원)
     * 6. surfing4.js의 renderPopupContent() 호출 → 콘텐츠 채우기
     *
     * [팝업 UI 예시]
     * ┌──────────────────────────────────────────────┐
     * │  📍 경포해수욕장                          ✕  │
     * │          < 오늘 04월 02일 (목) >              │
     * │  ┌─ 서핑지수 테이블 ────────────────────┐    │
     * │  │ ... (surfing4.js가 렌더링) ...       │    │
     * │  └──────────────────────────────────────┘    │
     * │  ┌─ 상세정보 테이블 ────────────────────┐    │
     * │  │ ... (surfing4.js가 렌더링) ...       │    │
     * │  └──────────────────────────────────────┘    │
     * │  ─── 해상특보 / 안내 ───────────────────     │
     * └──────────────────────────────────────────────┘
     *
     * @param {string} beachName - 해수욕장명 (예: '경포해수욕장')
     */
    function _openPopup(beachName) {
        // --- 상태 초기화 ---
        s.selectedBeach = beachName;
        s.selectedDateIdx = 0;

        // --- 예보 날짜 목록 추출 ---
        // s.data.beaches['경포해수욕장'].forecasts의 키(YYYYMMDD)를 정렬하여 배열로
        // 예: ['20260402', '20260403', '20260404', '20260405', ...]
        var beaches = s.data && s.data.beaches;
        var beach = beaches && beaches[beachName];
        if (!beach || !beach.forecasts) return;

        s.availableDates = Object.keys(beach.forecasts).sort();
        if (s.availableDates.length === 0) return;

        // --- 팝업 헤더에 해수욕장명 표시 ---
        var nameEl = document.getElementById('surfing-popup-beach-name');
        if (nameEl) nameEl.textContent = beachName;

        // --- 팝업 + 오버레이 활성화 ---
        // CSS .active 클래스 추가 → opacity/transform transition으로 부드럽게 등장
        var popup = document.getElementById('surfing-popup');
        var overlay = document.getElementById('surfing-popup-overlay');
        if (popup) popup.classList.add('active');
        if (overlay) overlay.classList.add('active');

        // --- 뒤로가기 버튼 지원 (PopupStack 등록) ---
        // 앱 내에서 Android 뒤로가기 버튼을 누르면 팝업이 닫히도록
        if (window.PopupStack) {
            window.PopupStack.push('surfing-popup', function () {
                _closePopup();
            });
        }

        // --- 팝업 콘텐츠 렌더링 (surfing4.js에서 정의) ---
        // 서핑지수 테이블 + 상세정보 테이블 + 해상특보 + 면책조항을 HTML로 생성
        if (s.renderPopupContent) {
            s.renderPopupContent();
        }
    }

    // ========================================================================
    // 3. 팝업 닫기
    // ========================================================================

    /**
     * 서핑지수 팝업을 닫고 상태를 초기화합니다.
     *
     * [동작 순서]
     * 1. 팝업 + 오버레이에서 active 클래스 제거 (CSS transition으로 사라짐)
     * 2. 선택된 해수욕장명 초기화
     * 3. 선택 마커 원래 크기로 복원 (surfing2.js의 resetMarkerStyle)
     * 4. PopupStack에서 제거
     *
     * [호출 시점]
     * - 팝업 ✕ 버튼 클릭
     * - 오버레이 클릭
     * - Android 뒤로가기 버튼 (PopupStack 콜백)
     */
    function _closePopup() {
        // --- 팝업 + 오버레이 비활성화 ---
        var popup = document.getElementById('surfing-popup');
        var overlay = document.getElementById('surfing-popup-overlay');
        if (popup) popup.classList.remove('active');
        if (overlay) overlay.classList.remove('active');

        // --- 상태 초기화 ---
        s.selectedBeach = null;

        // --- 선택 마커 복원 ---
        // 팝업을 닫으면 클릭했던 마커가 원래 14px 크기로 돌아갑니다
        if (s.selectedFeature) {
            if (s.resetMarkerStyle) s.resetMarkerStyle(s.selectedFeature);
            s.selectedFeature = null;
        }

        // --- PopupStack에서 제거 ---
        if (window.PopupStack) {
            window.PopupStack.remove('surfing-popup');
        }
    }

    // ========================================================================
    // 4. window._surfing에 함수 등록
    // ========================================================================

    /**
     * surfing1.js의 initSurfingMap()이 아래 함수를 호출합니다.
     *
     * 호출 흐름:
     *   initSurfingMap() → s.bindEvents()    (지도 초기화 시)
     *   마커 클릭       → s.openPopup(name)  (surfing1.js의 singleclick 이벤트)
     *   닫기 동작       → s.closePopup()     (bindEvents에서 등록된 이벤트)
     */
    s.bindEvents = _bindEvents;
    s.openPopup  = _openPopup;
    s.closePopup = _closePopup;

})();
