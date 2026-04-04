/**
 * ============================================================================
 * 파일명: js/ocean_condition2.js
 * 역할: 해황예보도 - API 호출 및 데이터 로드
 * ============================================================================
 *
 * [설명]
 * 백엔드 API를 호출하여 지역 목록과 예보 데이터를 가져오고,
 * 받아온 데이터를 전역 상태(OceanForecast)에 저장합니다.
 * 데이터 로드 후 날짜/시간 버튼 생성과 이미지 표출을 트리거합니다.
 *
 * [호출하는 API]
 * - GET /api/ocean-condition/areas → 20개 지역 코드 목록
 * - GET /api/ocean-condition/data/:areaCode → 특정 지역의 예보 데이터
 *
 * [연계 파일]
 * - ocean_condition1.js → OceanForecast 전역 상태 참조
 * - ocean_condition3.js → 데이터 로드 후 buildOceanDateButtons() 호출
 * - ocean_condition4.js → 데이터 로드 후 showOceanImage() 호출
 * - routes/ocean_condition.js → 백엔드 API (캐시된 데이터 제공)
 * ============================================================================
 */

// ============================================================================
// 지역 목록 로드
// ============================================================================

/**
 * 백엔드에서 지역 코드 목록을 가져와 드롭다운(<select>)에 옵션을 추가
 *
 * [동작]
 * 1. /api/ocean-condition/areas 호출
 * 2. 응답: { areas: { korea: '전국', busan: '부산', ... } }
 * 3. OceanForecast.areas에 저장
 * 4. <select> 요소에 <option> 태그 동적 생성
 *
 * [호출 위치] ocean_condition1.js → initOceanForecast()
 */
window.loadOceanAreas = async function () {
    const state = window.OceanForecast;

    try {
        const response = await fetch('/api/ocean-condition/areas');
        const json = await response.json();
        state.areas = json.areas || {};
    } catch (err) {
        console.error('[해황예보도] 지역 목록 로드 실패:', err);
        // 실패 시 하드코딩된 기본 목록 사용 (오프라인 대비)
        state.areas = { korea: '전국' };
    }

    // 드롭다운 옵션 생성
    const selectEl = document.getElementById('ocean-forecast-area-select');
    if (!selectEl) return;

    selectEl.innerHTML = ''; // 기존 옵션 초기화

    // 각 지역코드에 대해 <option> 태그 생성
    for (const [code, name] of Object.entries(state.areas)) {
        const option = document.createElement('option');
        option.value = code;    // 예: 'korea'
        option.textContent = name; // 예: '전국'
        selectEl.appendChild(option);
    }
};

// ============================================================================
// 예보 데이터 로드
// ============================================================================

/**
 * 특정 지역의 해황예보도 데이터를 백엔드에서 가져와 화면에 반영
 *
 * [동작]
 * 1. 로딩 스피너 표시
 * 2. /api/ocean-condition/data/{areaCode} 호출
 * 3. 응답에서 item 배열 추출 → OceanForecast.items에 저장
 * 4. 날짜별 시간 목록 정리 (dateMap 생성)
 * 5. 날짜/시간 버튼 생성 (ocean_condition3.js)
 * 6. 현재 시각 기준 자동 선택 + 이미지 표출 (ocean_condition4.js)
 * 7. 로딩 스피너 숨김
 *
 * @param {string} areaCode - 지역코드 (예: 'korea', 'busan')
 *
 * [호출 위치]
 * - ocean_condition1.js → initOceanForecast() (최초 로드)
 * - ocean_condition1.js → 드롭다운 change 이벤트 (지역 변경)
 */
window.loadOceanData = async function (areaCode) {
    const state = window.OceanForecast;
    const loadingEl = document.getElementById('ocean-forecast-loading');
    const emptyEl = document.getElementById('ocean-forecast-empty');
    const imageEl = document.getElementById('ocean-forecast-image');
    const publishEl = document.getElementById('ocean-forecast-publish-label');

    // 로딩 상태 표시
    state.loading = true;
    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    if (imageEl) imageEl.style.display = 'none';
    if (publishEl) publishEl.style.display = 'none';

    try {
        // 백엔드 API 호출 (캐시된 JSON 데이터)
        const response = await fetch('/api/ocean-condition/data/' + areaCode);

        // 캐시 미준비 상태 처리 (서버 시작 직후 등)
        if (!response.ok) {
            throw new Error('데이터 준비 중');
        }

        const json = await response.json();

        // API 응답에서 아이템 배열 추출
        // 구조: { body: { items: { item: [...] } } }
        const items = json?.body?.items?.item || [];

        if (items.length === 0) {
            throw new Error('예보 데이터 없음');
        }

        // 전역 상태에 저장
        state.items = items;
        state.publishDate = items[0].ofcFrcstYmd; // 첫 아이템의 날짜 = 발표 기준일

        // ── 날짜별 시간 목록 정리 (dateMap 생성) ──
        // 예: { '20260404': ['09','12','15','18','21'], '20260405': ['00','03',...] }
        state.dateMap = {};
        for (const item of items) {
            const date = item.ofcFrcstYmd; // 예: '20260404'
            const time = item.ofcFrcstTm;  // 예: '09'
            if (!state.dateMap[date]) {
                state.dateMap[date] = [];
            }
            state.dateMap[date].push(time);
        }

        // ── 날짜/시간 버튼 생성 (ocean_condition3.js) ──
        window.buildOceanDateButtons();

        // ── 현재 시각 기준 자동 선택 + 이미지 표출 ──
        window.autoSelectOceanTime();

    } catch (err) {
        console.error('[해황예보도] 데이터 로드 실패:', err);
        // "데이터 준비 중" 메시지 표시
        if (emptyEl) emptyEl.style.display = 'block';
        // 버튼 영역 비우기
        const dateBtns = document.getElementById('ocean-forecast-date-btns');
        const timeBtns = document.getElementById('ocean-forecast-time-btns');
        if (dateBtns) dateBtns.innerHTML = '';
        if (timeBtns) timeBtns.innerHTML = '';
    } finally {
        // 로딩 스피너 숨김
        state.loading = false;
        if (loadingEl) loadingEl.style.display = 'none';
    }
};
