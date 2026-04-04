/**
 * ============================================================================
 * 파일명: js/ocean_condition1.js
 * 역할: 해황예보도 - 상수 정의, 전역 상태 관리, 초기화 진입점
 * ============================================================================
 *
 * [설명]
 * 해황예보도 기능의 핵심 상수와 전역 상태를 관리합니다.
 * 탭 최초 진입 시 initOceanForecast()가 호출되어 전체 초기화를 시작합니다.
 *
 * [로딩 순서]
 * ocean_condition1.js (이 파일) → 상수/상태 정의 + 초기화 함수
 * ocean_condition2.js → API 호출, 데이터 로드
 * ocean_condition3.js → 날짜/시간 버튼 생성 및 제어
 * ocean_condition4.js → 이미지 표출 및 전체화면 모달
 * ocean_condition5.js → 즐겨찾기, 토스트 메시지
 *
 * [연계 파일]
 * - index.html → #ocean-forecast-section 섹션 HTML
 * - js/marine.js → _onSectionActivated()에서 initOceanForecast() 호출
 * - routes/ocean_condition.js → 백엔드 API 엔드포인트
 * - style.css → .ocean-forecast-* 스타일
 * ============================================================================
 */

// ============================================================================
// 전역 상태 객체 (해황예보도 모듈 전체에서 공유)
// ============================================================================

/**
 * 해황예보도의 모든 상태를 하나의 객체로 관리
 * - 각 ocean_condition*.js 파일에서 이 객체를 읽고 씁니다
 * - 다른 모듈(marine.js 등)과의 충돌을 방지하기 위해 window에 등록
 */
window.OceanForecast = {
    // ── 초기화 상태 ──
    initialized: false,   // 초기화 완료 여부 (중복 초기화 방지)
    loading: false,       // 데이터 로딩 중 여부

    // ── 지역 관련 ──
    areas: {},            // 지역 코드 목록 { korea: '전국', busan: '부산', ... }
    currentArea: 'korea', // 현재 선택된 지역코드

    // ── 데이터 관련 ──
    items: [],            // 현재 지역의 예보 아이템 배열
                          // [{ ofcFrcstYmd, ofcFrcstTm, imgFileNm, ... }, ...]
    dateMap: {},          // 날짜별 시간 목록 정리
                          // { '20260404': ['09','12','15','18','21'], '20260405': ['00','03',...] }

    // ── 선택 상태 ──
    selectedDate: null,   // 현재 선택된 날짜 (예: '20260404')
    selectedTime: null,   // 현재 선택된 시간 (예: '09')

    // ── 즐겨찾기 ──
    favoriteArea: null,   // localStorage에 저장된 즐겨찾기 지역코드 (null이면 미설정)

    // ── 발표 시점 ──
    publishDate: null     // 첫 번째 아이템의 날짜 = 발표 기준일 (예: '20260404')
};

// ============================================================================
// 상수 정의
// ============================================================================

/** localStorage 키: 즐겨찾기 지역 저장용 */
const OCEAN_FAV_KEY = 'seagnal_ocean_forecast_fav';

/** 요일 한글 매핑 (Date.getDay() 인덱스에 대응) */
const OCEAN_DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 시간대 목록 (3시간 간격, 하루 8개) */
const OCEAN_TIME_SLOTS = ['00', '03', '06', '09', '12', '15', '18', '21'];

// ============================================================================
// 초기화 함수
// ============================================================================

/**
 * 해황예보도 탭 초기화 (진입점)
 *
 * marine.js의 _onSectionActivated('ocean-forecast-section')에서 호출됩니다.
 * 최초 1회만 실행되며, 이후 탭 재진입 시에는 스킵됩니다.
 *
 * [초기화 순서]
 * 1. 즐겨찾기 확인 → 기본 지역 결정
 * 2. 지역 목록 API 호출 → 드롭다운 구성
 * 3. 선택된 지역의 예보 데이터 로드
 * 4. 날짜/시간 버튼 생성 + 현재 시각 기준 자동 선택
 * 5. 이미지 표출
 */
window.initOceanForecast = async function () {
    // 중복 초기화 방지
    if (window.OceanForecast.initialized) return;

    const state = window.OceanForecast;

    try {
        // 1. 즐겨찾기 확인 (localStorage에서 저장된 지역코드 읽기)
        state.favoriteArea = localStorage.getItem(OCEAN_FAV_KEY) || null;
        state.currentArea = state.favoriteArea || 'korea';

        // 2. 지역 목록 API 호출 → 드롭다운 구성
        //    (ocean_condition2.js의 loadOceanAreas 함수)
        await window.loadOceanAreas();

        // 3. 드롭다운에서 현재 지역 선택 상태 반영
        const selectEl = document.getElementById('ocean-forecast-area-select');
        if (selectEl) selectEl.value = state.currentArea;

        // 4. 제목 텍스트 갱신 ("전국 해황예보도" 등)
        window.updateOceanForecastTitle();

        // 5. 즐겨찾기 별표 아이콘 상태 갱신
        window.updateOceanFavIcon();

        // 6. 선택된 지역의 예보 데이터 로드 + 날짜/시간 버튼 생성 + 이미지 표출
        //    (ocean_condition2.js의 loadOceanData 함수)
        await window.loadOceanData(state.currentArea);

        // 7. 이벤트 리스너 등록
        bindOceanEvents();

        state.initialized = true;

    } catch (err) {
        console.error('[해황예보도] 초기화 실패:', err);
        // 에러 시 "데이터 준비 중" 메시지 표시
        const emptyEl = document.getElementById('ocean-forecast-empty');
        if (emptyEl) emptyEl.style.display = 'block';
    }
};

// ============================================================================
// 이벤트 리스너 등록
// ============================================================================

/**
 * 해황예보도 UI 요소들의 이벤트 리스너를 등록
 * - 지역 드롭다운 변경
 * - 즐겨찾기 별표 클릭
 */
function bindOceanEvents() {
    // 지역 드롭다운 변경 시 → 해당 지역 데이터 로드
    const selectEl = document.getElementById('ocean-forecast-area-select');
    if (selectEl) {
        selectEl.addEventListener('change', async function () {
            const state = window.OceanForecast;
            state.currentArea = this.value;
            // 제목 텍스트 갱신 (예: "부산 해황예보도")
            window.updateOceanForecastTitle();
            // 즐겨찾기 아이콘 갱신 (현재 지역이 즐겨찾기인지 확인)
            window.updateOceanFavIcon();
            // 해당 지역 데이터 로드
            await window.loadOceanData(state.currentArea);
        });
    }

    // 즐겨찾기 별표 클릭
    const favBtn = document.getElementById('ocean-forecast-fav-btn');
    if (favBtn) {
        favBtn.addEventListener('click', function () {
            window.toggleOceanFavorite();
        });
    }
}

/**
 * 셀렉터 라벨 텍스트 갱신
 * 드롭다운에서 선택된 지역의 한글명 + "해황예보도"로 라벨을 변경합니다.
 * 예: "전국 해황예보도", "제주 해황예보도"
 * (바다갈라짐의 "지역 바다갈라짐 시간" 라벨과 동일한 역할)
 */
window.updateOceanForecastTitle = function () {
    const titleText = document.getElementById('ocean-forecast-title-text');
    if (titleText) {
        // 지역명 없이 "해황예보도"만 표시 (지역은 드롭다운에서 확인)
        titleText.textContent = '해황예보도';
    }
};
