/**
 * ============================================================================
 * 파일명: js/marine_chart1.js
 * 역할: 해상일기도(KMA 날씨누리) — 카탈로그/상태/DOM 바인딩/드롭다운
 * ============================================================================
 *
 * [개요]
 * 특보정보 메인탭 → "해상일기도" 서브탭에서 표출되는 화면의 기반 모듈.
 * 5개 파일(marine_chart1~5.js) 중 첫 번째.
 *
 *   1 (이 파일) — 카탈로그/상태/init/드롭다운
 *   2          — 데이터 fetch / 이미지 render / 시간 점프 / 재생
 *   3          — 전체화면 진입/종료 / 백버튼
 *   4          — 컨트롤 페이드 (5초 타이머)
 *   5          — 핀치줌·팬·탭 제스처
 *
 * [전역 노출]
 *   window.MarineChart = {
 *     state, el, CATALOG, AREAS,        // 이 파일이 정의
 *     init(), refreshDataOptions(),
 *     onTypeChange(), onDataChange(),
 *     onAreaChange(), onCategoryClick()
 *   };
 *   (다른 파일은 같은 window.MarineChart 에 메서드를 추가)
 *
 * [연계]
 *   - HTML: index2.html 의 #marine-chart-section, #mc-fullscreen
 *   - 서브탭 진입 훅: marine.js의 _onSectionActivated() 에서 init() 호출
 *   - 백엔드: routes/marine_chart.js (GET /api/marine-chart/list)
 *
 * [초보자 안내]
 *   "카탈로그" 는 KMA 사이트의 드롭다운 옵션을 그대로 옮긴 상수표예요.
 *   사용자가 드롭다운을 바꿀 때마다 이 표를 보고 변수 옵션을 다시 채웁니다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 카탈로그: KMA 날씨누리 사이트의 각 카테고리별 JS/HTML 에서 추출 ──
    // 카테고리(wave/surge/current/sst) → 영역(type) → 변수 옵션 매핑
    const CATALOG_WAVE = {
        G6: {
            label: '전구(6시간간격)',
            options: [
                { code: 'kim_gww3_glob_wave_ft06_pb4_', label: '해상풍과 파고' },
                { code: 'kim_gww3_glob_wdpr_ft06_pa4_', label: '최대파주기와 평균파향' },
                { code: 'kim_gww3_glob_wind_ft06_pa4_', label: '해상풍(풍향,풍속)' },
            ],
        },
        A6: {
            label: '아시아(6시간간격)',
            options: [
                { code: 'kim_gww3_asia_wave_ft06_pa4_', label: '해상풍과 파고' },
                { code: 'kim_gww3_asia_wdpr_ft06_pa4_', label: '최대파주기와 평균파향' },
                { code: 'kim_gww3_asia_wind_ft06_pa4_', label: '해상풍(풍향,풍속)' },
            ],
        },
        R3: {
            label: '지역(3시간간격)',
            options: [
                { code: 'kim_rww3_wave_ft03_pa4_', label: '해상풍과 파고' },
                { code: 'kim_rww3_wdpr_ft03_pa4_', label: '최대파주기와 평균파향' },
                { code: 'kim_rww3_wind_ft03_pa4_', label: '해상풍(풍향,풍속)' },
                { code: 'kim_rww3_total_ft03_pa4_', label: '3시간 해상풍과 파고' },
                { code: 'kim_rww3_total_ft12_pa4_', label: '12시간 해상풍과 파고' },
                // 해역별 시계열 4종 — KMA 공식과 동등 노출
                { code: 'kim_rww3_series01_wavhgt_pa4_', label: '해역별 파고시계열(앞바다)' },
                { code: 'kim_rww3_series01_wind_pa4_',   label: '해역별 해상풍시계열(앞바다)' },
                { code: 'kim_rww3_series02_wavhgt_pa4_', label: '해역별 파고시계열(먼바다)' },
                { code: 'kim_rww3_series02_wind_pa4_',   label: '해역별 해상풍시계열(먼바다)' },
            ],
        },
        C: {
            label: '연안(국지)',
            useArea: true,                 // 청 선택 필요
            options: [
                { code: 'kim_cww3_[AREA]_wave_',  label: '해상풍/유의파고' },
                { code: 'kim_cww3_[AREA]_wdpr_',  label: '파주기/파향' },
                { code: 'kim_cww3_[AREA]_wind_',  label: '해상풍(풍향,풍속)' },
                // BUOY 스펙트럼 — 부이(STN) 추가 드롭다운 노출
                { code: 'kim_cww3_[AREA]_total_spec_[STN]_pa4_', label: 'BUOY 스펙트럼 예상종합장', useStn: true },
                { code: 'kim_cww3_[AREA]_wswl_',  label: '너울파고/파향' },
                // 너울파고 시계열 — 강원청 전용
                { code: 'kim_cww3_[AREA]_wavhgt_swell_point_pa4_', label: '해역별 너울파고 시계열', gawnOnly: true },
            ],
        },
        RWW3: {
            label: '파랑실황도',
            options: [
                { code: 'kim_rww3_wave_anal_', label: '파랑실황도' },
            ],
        },
    };

    // 폭풍해일 카탈로그 (cht_surge_height)
    // 변수: 폭풍해일모델 / 해일고종합 / 시계열-지방(지)청
    // "시계열-지방청" 변수만 추가로 지방청 드롭다운 (useSurgeStn) 노출.
    const CATALOG_SURGE = {
        S: {
            label: '단기',
            options: [
                { code: 'kim_rtsm_post_grph_ft03_surg_pa4_',     label: '폭풍해일모델' },
                { code: 'kim_rtsm_post_grph_ft03_surg_all_pa4_', label: '해일고종합' },
                { code: 'kim_rtsm_jibang',                        label: '시계열-지방(지)청', useSurgeStn: true },
            ],
        },
    };

    // 폭풍해일 시계열용 지방청 코드 (data='kim_rtsm_jibang' 일 때만)
    const SURGE_STNS = [
        { code: 'kim_rtsm_post_grph_series06_pa4_', label: '강원청' },
        { code: 'kim_rtsm_post_grph_series07_pa4_', label: '광주청(1)' },
        { code: 'kim_rtsm_post_grph_series08_pa4_', label: '광주청(2)' },
        { code: 'kim_rtsm_post_grph_series09_pa4_', label: '대구청' },
        { code: 'kim_rtsm_post_grph_series10_pa4_', label: '대전청' },
        { code: 'kim_rtsm_post_grph_series11_pa4_', label: '부산청(1)' },
        { code: 'kim_rtsm_post_grph_series12_pa4_', label: '부산청(2)' },
        { code: 'kim_rtsm_post_grph_series13_pa4_', label: '수도권청(1)' },
        { code: 'kim_rtsm_post_grph_series14_pa4_', label: '수도권청(2)' },
        { code: 'kim_rtsm_post_grph_series15_pa4_', label: '전주지청' },
        { code: 'kim_rtsm_post_grph_series16_pa4_', label: '제주청' },
    ];

    // 해양순환 카탈로그 (cht_current)
    // 변수: 해류 / 수온 / 염분 — 모두 수심(000/010/020/050/075/100) 동반
    const CATALOG_CURRENT = {
        S: {
            label: '단기',
            options: [
                { code: 'glosea_post_grph_nwpacific_current_', label: '해류',  useDepth: true },
                { code: 'glosea_post_grph_nwpacific_temp_',    label: '수온',  useDepth: true },
                { code: 'glosea_post_grph_nwpacific_salt_',    label: '염분',  useDepth: true },
            ],
        },
    };
    const CURRENT_DEPTHS = [
        { code: '000', label: '표층' },
        { code: '010', label: '10m' },
        { code: '020', label: '20m' },
        { code: '050', label: '50m' },
        { code: '100', label: '100m' },
    ];

    // 해수면온도 카탈로그 (cht_seavis)
    // 영역 → 변수(평균기간)
    const CATALOG_SST = {
        ea020lc: {
            label: '동아시아',
            options: [
                { code: 'sst-1dm',  label: '1일평균온도' },
                { code: 'sst-5dm',  label: '5일평균온도' },
                { code: 'sst-10dm', label: '10일평균온도' },
            ],
        },
        ko020lc: {
            label: '한반도',
            options: [
                { code: 'sst-1dm',  label: '1일평균온도' },
                { code: 'sst-5dm',  label: '5일평균온도' },
                { code: 'sst-10dm', label: '10일평균온도' },
            ],
        },
    };

    // 카테고리 → CATALOG 매핑 (헬퍼)
    const CATALOG_BY_CAT = {
        wave: CATALOG_WAVE,
        surge: CATALOG_SURGE,
        current: CATALOG_CURRENT,
        sst: CATALOG_SST,
    };

    // 청 코드 (영역=연안일 때만 사용)
    const AREAS = [
        { code: 'dajn', label: '대전청' },
        { code: 'gwju', label: '광주청' },
        { code: 'jeju', label: '제주청' },
        { code: 'busn', label: '부산청' },
        { code: 'gawn', label: '강원청' },
    ];

    // 부이(STN) 코드 — BUOY 스펙트럼 변수 선택 시만 사용. 청별로 다름.
    // KMA 공식 app-ocean-chart-wave-model.js 의 STNS 그대로.
    const STNS = {
        dajn: [{ code: 'B22101', label: '덕적도' }, { code: 'B22108', label: '외연도' }],
        gwju: [{ code: 'B22102', label: '칠발도' }, { code: 'B22103', label: '거문도' }],
        jeju: [{ code: 'B22107', label: '마라도' }],
        busn: [{ code: 'B22104', label: '거제도' }, { code: 'B22106', label: '포항' }],
        gawn: [{ code: 'B22105', label: '동해' }],
    };

    // ── 전역 상태 (단일 source of truth) ──
    // 인라인 영역과 전체화면이 모두 이 state 를 공유 → 자동재생 끊김 없음
    // ── 카테고리별 기본 상태 (전환 시 메모리 유지) ──
    // 각 카테고리는 별도의 type/data/area/stn 을 갖고, 사용자가 카테고리를 바꿔도
    // 직전 선택을 기억함.
    const CATEGORY_DEFAULTS = {
        wave: {
            type: 'R3',
            data: 'kim_rww3_wave_ft03_pa4_',
            area: 'jeju',          // 청 코드 (연안일 때)
            stn:  'B22107',        // 부이 코드 (BUOY 스펙트럼)
        },
        surge: {
            type: 'S',
            data: 'kim_rtsm_post_grph_ft03_surg_pa4_',
            area: '',
            stn:  'kim_rtsm_post_grph_series06_pa4_', // 시계열-지방청 기본=강원청
        },
        current: {
            type: 'S',
            data: 'glosea_post_grph_nwpacific_current_',
            area: '000',           // 수심 (해양순환은 area 가 수심)
            stn:  '',
        },
        sst: {
            type: 'ea020lc',       // 영역 (해수면온도는 type 이 영역코드)
            data: 'sst-1dm',
            area: '',
            stn:  '',
        },
    };

    const state = {
        category: 'wave',                     // 자료종류 (wave/surge/current/sst)
        type: 'R3',                           // 영역 (현재 카테고리의 type)
        data: 'kim_rww3_wave_ft03_pa4_',      // 자료 prefix (첫 진입 기본값)
        area: 'jeju',                         // area (wave=청, current=수심, 그 외=빈값)
        stn: 'B22107',                        // 부이/지방청 코드
        // 카테고리별 직전 선택 보존 — 카테고리 전환 시 메모리에서 복원
        memo: JSON.parse(JSON.stringify(CATEGORY_DEFAULTS)),
        list: [],                             // 가용 시각 목록
        currentIndex: 0,                      // 현재 표시 중인 인덱스
        playing: false,                       // 자동재생 여부
        playTimer: null,                      // setInterval id
        playIntervalMs: 600,                  // 자동재생 간격
        initialized: false,                   // init() 1회만
        fetchAbort: null,                     // AbortController — fetchList race condition 방지
    };

    // ── DOM 참조 캐시 (init 시 1회 채움) ──
    const el = {};

    // ── 즐겨찾기 — localStorage 키 ──
    const FAV_KEY = 'seagnal_marine_chart_fav';

    /**
     * 섹션 진입 시 1회 호출. DOM 참조 + 이벤트 바인딩 + 첫 데이터 로드.
     * marine.js 의 _onSectionActivated('marine-chart-section') 에서 호출.
     */
    function init() {
        // 인라인 영역 DOM
        el.section       = document.getElementById('marine-chart-section');
        el.catTabs       = document.getElementById('mc-category-tabs');
        el.typeSel       = document.getElementById('mc-type');
        el.dataSel       = document.getElementById('mc-data');
        el.areaSel       = document.getElementById('mc-area');
        el.areaField     = document.getElementById('mc-field-area');
        el.stnSel        = document.getElementById('mc-stn');
        el.stnField      = document.getElementById('mc-field-stn');

        // 재생 속도 칩 그룹 (인라인 + 풀스크린)
        el.speedChips    = document.getElementById('mc-speed-chips');
        el.fsSpeedChips  = document.getElementById('mc-fs-speed-chips');

        // 카테고리별 컨트롤 그룹 wrapper
        el.controlsWave    = document.getElementById('mc-controls-wave');
        el.controlsSurge   = document.getElementById('mc-controls-surge');
        el.controlsCurrent = document.getElementById('mc-controls-current');
        el.controlsSst     = document.getElementById('mc-controls-sst');

        // 폭풍해일 컨트롤
        el.surgeDataSel  = document.getElementById('mc-surge-data');
        el.surgeStnSel   = document.getElementById('mc-surge-stn');
        el.surgeStnField = document.getElementById('mc-field-surge-stn');

        // 해양순환 컨트롤
        el.currentDataSel  = document.getElementById('mc-current-data');
        el.currentDepthSel = document.getElementById('mc-current-depth');

        // 해수면온도 컨트롤
        el.sstRegionSel = document.getElementById('mc-sst-region');
        el.sstPeriodSel = document.getElementById('mc-sst-period');
        el.timeValue     = document.getElementById('mc-time-value');
        el.timeJump      = document.getElementById('mc-time-jump');
        el.image         = document.getElementById('mc-image');
        el.imageWrap     = el.image && el.image.parentElement;
        el.imageLoading  = document.getElementById('mc-image-loading');
        el.imageError    = document.getElementById('mc-image-error');
        el.playPrev      = document.getElementById('mc-play-prev');
        el.playToggle    = document.getElementById('mc-play-toggle');
        el.playNext      = document.getElementById('mc-play-next');
        el.slider        = document.getElementById('mc-slider');
        el.stepLabel     = document.getElementById('mc-step-label');
        el.favBtn        = document.getElementById('mc-fav-btn');

        // 전체화면 오버레이 DOM (3~5번 파일이 사용)
        el.fullscreen    = document.getElementById('mc-fullscreen');
        el.fsTop         = document.getElementById('mc-fs-top');
        el.fsBottom      = document.getElementById('mc-fs-bottom');
        el.fsStage       = document.getElementById('mc-fs-stage');
        el.fsImage       = document.getElementById('mc-fs-image');
        el.fsClose       = document.getElementById('mc-fs-close');
        el.fsTime        = document.getElementById('mc-fs-time');
        el.fsStep        = document.getElementById('mc-fs-step');
        el.fsPrev        = document.getElementById('mc-fs-prev');
        el.fsToggle      = document.getElementById('mc-fs-toggle');
        el.fsNext        = document.getElementById('mc-fs-next');
        el.fsSlider      = document.getElementById('mc-fs-slider');

        if (!el.section) return; // 섹션 없으면 (다른 페이지) 무시

        // 첫 1회만 이벤트 바인딩 + 즐겨찾기 적용
        if (!state.initialized) {
            applyFavorite();        // localStorage 의 저장값을 state 에 반영
            // 모든 카테고리 컨트롤 초기화 (memo 의 기본값으로 옵션 채움)
            refreshDataOptions();   // wave 변수 옵션
            if (el.dataSel && state.data) el.dataSel.value = state.data;
            toggleAreaField();
            applyVariableConstraints();
            // 폭풍해일/해양순환/해수면온도 옵션 미리 채워둠 (전환 시 즉시 사용)
            refreshSurgeDataOptions();
            refreshCurrentDataOptions();
            refreshCurrentDepthOptions();
            refreshSstPeriodOptions();
            // 카테고리 전환 시각화 (현재 카테고리만 노출)
            switchControlGroup(state.category);
            updateFavButton();      // 별 활성 상태 표시
            bindEvents();
            state.initialized = true;
        }

        // 첫 진입 시 자동 데이터 로드 (저장된 즐겨찾기 반영된 상태로)
        if (state.list.length === 0 && window.MarineChart.fetchList) {
            window.MarineChart.fetchList();
        }
    }

    /**
     * 모든 인터랙티브 요소에 이벤트 핸들러 바인딩.
     * (재진입 시 중복 바인딩 방지를 위해 init() 에서 1회만 호출)
     */
    function bindEvents() {
        // 자료종류 4탭 (수치파랑/폭풍해일/해양순환/해수면온도)
        if (el.catTabs) {
            el.catTabs.addEventListener('click', (e) => {
                const btn = e.target.closest('.mc-cat-btn');
                if (!btn) return;
                onCategoryClick(btn);
            });
        }

        // 영역 드롭다운 → 변수 옵션 갱신 + 청 표시 토글 + 데이터 재조회
        if (el.typeSel) {
            el.typeSel.addEventListener('change', onTypeChange);
        }

        // 변수 드롭다운 → 데이터 재조회
        if (el.dataSel) {
            el.dataSel.addEventListener('change', onDataChange);
        }

        // 청 드롭다운 (연안일 때만 노출) → 데이터 재조회
        if (el.areaSel) {
            el.areaSel.addEventListener('change', onAreaChange);
        }

        // 부이(STN) 드롭다운 (BUOY 스펙트럼 변수일 때만 노출)
        if (el.stnSel) {
            el.stnSel.addEventListener('change', onStnChange);
        }

        // 폭풍해일
        if (el.surgeDataSel) el.surgeDataSel.addEventListener('change', onSurgeDataChange);
        if (el.surgeStnSel)  el.surgeStnSel.addEventListener('change', onSurgeStnChange);

        // 해양순환
        if (el.currentDataSel)  el.currentDataSel.addEventListener('change', onCurrentDataChange);
        if (el.currentDepthSel) el.currentDepthSel.addEventListener('change', onCurrentDepthChange);

        // 해수면온도
        if (el.sstRegionSel) el.sstRegionSel.addEventListener('change', onSstRegionChange);
        if (el.sstPeriodSel) el.sstPeriodSel.addEventListener('change', onSstPeriodChange);

        // 시간 점프 7개 버튼 (-48H/-24H/-12H/현재/+12H/+24H/+48H)
        if (el.timeJump) {
            el.timeJump.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-jump]');
                if (!btn) return;
                const hours = parseInt(btn.dataset.jump, 10);
                if (window.MarineChart.jumpHours) {
                    window.MarineChart.jumpHours(hours);
                }
            });
        }

        // 즐겨찾기 별표 — 토글 동작
        // [동작] ☆ → 클릭 → ★ (저장 + "추가" 토스트)
        //        ★ → 클릭 → ☆ (해제 + "해제" 토스트)
        // [판정 기준] 데이터 일치 여부(loadFavorite + state 비교) — DOM 클래스가
        //              아닌 실제 저장값 기준이라 시각 ↔ 데이터 어긋남 방지.
        if (el.favBtn) {
            el.favBtn.addEventListener('click', () => {
                if (isFavoriteActive()) {
                    clearFavorite();
                    showToast('즐겨찾기에서 해제되었습니다');
                } else {
                    saveFavorite();
                    showToast('다음부터는 이 옵션부터 화면이 시작합니다');
                }
                updateFavButton();
            });
        }
    }

    /**
     * 자료종류 카테고리 탭 클릭 핸들러.
     * 4개 카테고리(wave/surge/current/sst) 모두 활성. 전환 시:
     *   1) 현재 카테고리의 type/data/area/stn 을 state.memo 에 보관
     *   2) 새 카테고리의 직전 상태를 state.memo 에서 복원
     *   3) 자동재생 정지, 컨트롤 그룹 전환, fetchList 트리거
     */
    function onCategoryClick(btn) {
        const cat = btn.dataset.cat;
        if (btn.dataset.disabled === 'true') return; // 안전장치 (현재는 모두 활성)
        if (state.category === cat) return;          // 같은 카테고리면 무시

        // 1) 현재 카테고리 상태를 memo 에 저장
        state.memo[state.category] = {
            type: state.type,
            data: state.data,
            area: state.area,
            stn:  state.stn,
        };

        // 2) 새 카테고리로 전환 + 직전 상태 복원
        state.category = cat;
        const restored = state.memo[cat] || CATEGORY_DEFAULTS[cat];
        state.type = restored.type;
        state.data = restored.data;
        state.area = restored.area;
        state.stn  = restored.stn;

        // 3) 자동재생 정지 (다른 자료 보고 있으니 기존 재생 의미 없음)
        if (window.MarineChart.pause) window.MarineChart.pause();

        // 4) 시각 토글 + 컨트롤 그룹 전환 + 데이터 재조회
        el.catTabs.querySelectorAll('.mc-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchControlGroup(cat);
        applyCategoryUiState(cat);
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 카테고리 컨트롤 그룹 가시성 전환.
     * 활성 카테고리의 .mc-controls-* 만 표시, 나머지 hidden.
     */
    function switchControlGroup(cat) {
        const map = {
            wave:    el.controlsWave,
            surge:   el.controlsSurge,
            current: el.controlsCurrent,
            sst:     el.controlsSst,
        };
        Object.entries(map).forEach(([k, node]) => {
            if (!node) return;
            if (k === cat) node.removeAttribute('hidden');
            else node.setAttribute('hidden', '');
        });
    }

    /**
     * 카테고리별 UI 동기 — DOM 의 select 값을 state 와 일치시키고 옵션 채움.
     */
    function applyCategoryUiState(cat) {
        if (cat === 'wave') {
            if (el.typeSel) el.typeSel.value = state.type;
            refreshDataOptions();
            if (el.dataSel) el.dataSel.value = state.data;
            toggleAreaField();
            if (el.areaSel) el.areaSel.value = state.area || 'jeju';
            applyVariableConstraints();
        } else if (cat === 'surge') {
            refreshSurgeDataOptions();
            if (el.surgeDataSel) el.surgeDataSel.value = state.data;
            applySurgeConstraints();
        } else if (cat === 'current') {
            refreshCurrentDataOptions();
            refreshCurrentDepthOptions();
            if (el.currentDataSel)  el.currentDataSel.value  = state.data;
            if (el.currentDepthSel) el.currentDepthSel.value = state.area || '000';
        } else if (cat === 'sst') {
            if (el.sstRegionSel) el.sstRegionSel.value = state.type;
            refreshSstPeriodOptions();
            if (el.sstPeriodSel) el.sstPeriodSel.value = state.data;
        }
    }

    // ── 폭풍해일 핸들러 ─────────────────────────────────────────────
    function refreshSurgeDataOptions() {
        if (!el.surgeDataSel) return;
        const opts = CATALOG_SURGE.S.options;
        el.surgeDataSel.innerHTML = opts.map(o =>
            `<option value="${o.code}">${o.label}</option>`
        ).join('');
    }
    function refreshSurgeStnOptions() {
        if (!el.surgeStnSel) return;
        el.surgeStnSel.innerHTML = SURGE_STNS.map(s =>
            `<option value="${s.code}">${s.label}</option>`
        ).join('');
        // 현재 stn 이 SURGE_STNS 에 없으면 첫 번째로
        const exists = SURGE_STNS.some(s => s.code === state.stn);
        if (!exists) state.stn = SURGE_STNS[0].code;
        el.surgeStnSel.value = state.stn;
    }
    function applySurgeConstraints() {
        // 시계열-지방청(useSurgeStn) 변수일 때만 지방청 드롭다운 노출
        const opt = CATALOG_SURGE.S.options.find(o => o.code === state.data);
        const showStn = !!(opt && opt.useSurgeStn);
        if (el.surgeStnField) {
            if (showStn) el.surgeStnField.removeAttribute('hidden');
            else el.surgeStnField.setAttribute('hidden', '');
        }
        if (showStn) refreshSurgeStnOptions();
    }
    function onSurgeDataChange() {
        state.data = el.surgeDataSel.value;
        applySurgeConstraints();
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }
    function onSurgeStnChange() {
        state.stn = el.surgeStnSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    // ── 해양순환 핸들러 ─────────────────────────────────────────────
    function refreshCurrentDataOptions() {
        if (!el.currentDataSel) return;
        const opts = CATALOG_CURRENT.S.options;
        el.currentDataSel.innerHTML = opts.map(o =>
            `<option value="${o.code}">${o.label}</option>`
        ).join('');
    }
    function refreshCurrentDepthOptions() {
        if (!el.currentDepthSel) return;
        el.currentDepthSel.innerHTML = CURRENT_DEPTHS.map(d =>
            `<option value="${d.code}">${d.label}</option>`
        ).join('');
    }
    function onCurrentDataChange() {
        state.data = el.currentDataSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }
    function onCurrentDepthChange() {
        state.area = el.currentDepthSel.value;  // 해양순환에선 area 가 수심
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    // ── 해수면온도 핸들러 ───────────────────────────────────────────
    function refreshSstPeriodOptions() {
        if (!el.sstPeriodSel) return;
        const region = CATALOG_SST[state.type];
        if (!region) return;
        el.sstPeriodSel.innerHTML = region.options.map(o =>
            `<option value="${o.code}">${o.label}</option>`
        ).join('');
    }
    function onSstRegionChange() {
        state.type = el.sstRegionSel.value;
        refreshSstPeriodOptions();
        // 새 region 의 첫 옵션으로 동기 (옵션 코드는 region 마다 동일하나 안전)
        if (el.sstPeriodSel.options.length > 0) {
            state.data = el.sstPeriodSel.options[0].value;
        }
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }
    function onSstPeriodChange() {
        state.data = el.sstPeriodSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 영역 드롭다운 변경 핸들러.
     */
    function onTypeChange() {
        state.type = el.typeSel.value;
        refreshDataOptions();
        toggleAreaField();
        if (el.dataSel.options.length > 0) {
            state.data = el.dataSel.options[0].value;
        }
        // 변수가 바뀌었으니 청·부이 드롭다운 가용성도 재평가
        applyVariableConstraints();
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 변수 드롭다운 변경 핸들러.
     * 변수에 따라 청 드롭다운 옵션이 바뀌거나(너울 시계열 → 강원청만) 부이
     * 드롭다운이 노출(BUOY 스펙트럼) 될 수 있어 제약 재평가 필요.
     */
    function onDataChange() {
        state.data = el.dataSel.value;
        applyVariableConstraints();
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 청 드롭다운 변경 핸들러 (영역=연안일 때만 활성).
     * 청이 바뀌면 그 청의 부이 옵션으로 부이 드롭다운 갱신.
     */
    function onAreaChange() {
        state.area = el.areaSel.value;
        refreshStnOptions();
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 부이(STN) 드롭다운 변경 핸들러 (BUOY 스펙트럼 변수일 때만 활성).
     */
    function onStnChange() {
        state.stn = el.stnSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 현재 변수의 메타정보 반환 (useStn, gawnOnly, useSurgeStn, useDepth 등).
     * 현재 카테고리의 CATALOG 객체에서 옵션 검색.
     */
    function getCurrentDataConfig() {
        const catalog = CATALOG_BY_CAT[state.category] || CATALOG_WAVE;
        const cat = catalog[state.type];
        if (!cat) return null;
        return cat.options.find(o => o.code === state.data) || null;
    }

    /**
     * 변수 제약사항을 청·부이 드롭다운에 반영.
     * - gawnOnly 변수 → 청 옵션 [강원청] 만, state.area='gawn' 강제
     * - useStn 변수 → 부이 드롭다운 노출 + 현재 청의 부이 옵션 채움
     * - 그 외 → 청 옵션 5개 전체 복원, 부이 드롭다운 숨김
     */
    function applyVariableConstraints() {
        const cfg = getCurrentDataConfig();
        const gawnOnly = !!(cfg && cfg.gawnOnly);
        const useStn = !!(cfg && cfg.useStn);
        refreshAreaOptions(gawnOnly);
        toggleStnField(useStn);
        if (useStn) refreshStnOptions();
    }

    /**
     * 청 드롭다운(<select id="mc-area">) 의 옵션을 갱신.
     * @param {boolean} gawnOnly true 면 강원청 1개, false 면 5개 전체.
     */
    function refreshAreaOptions(gawnOnly) {
        if (!el.areaSel) return;
        const list = gawnOnly
            ? AREAS.filter(a => a.code === 'gawn')
            : AREAS;
        el.areaSel.innerHTML = list.map(a =>
            `<option value="${a.code}">${a.label}</option>`
        ).join('');
        if (gawnOnly) {
            // gawnOnly 변수는 강원청만 가능 → state.area 강제 동기화
            state.area = 'gawn';
            el.areaSel.value = 'gawn';
        } else {
            // 5개 복원: 이전 선택을 우선 유지, 없으면 첫 번째
            const exists = list.some(a => a.code === state.area);
            if (exists) {
                el.areaSel.value = state.area;
            } else {
                state.area = list[0].code;
                el.areaSel.value = state.area;
            }
        }
    }

    /**
     * 부이(STN) 드롭다운 옵션을 현재 청에 맞게 갱신.
     */
    function refreshStnOptions() {
        if (!el.stnSel) return;
        const list = STNS[state.area] || [];
        el.stnSel.innerHTML = list.map(s =>
            `<option value="${s.code}">${s.label}</option>`
        ).join('');
        const exists = list.some(s => s.code === state.stn);
        if (!exists && list.length > 0) {
            state.stn = list[0].code;
        }
        if (list.length > 0) el.stnSel.value = state.stn;
    }

    /**
     * 부이 드롭다운 노출/숨김 토글.
     */
    function toggleStnField(show) {
        if (!el.stnField) return;
        if (show) el.stnField.removeAttribute('hidden');
        else el.stnField.setAttribute('hidden', '');
    }

    // ── 즐겨찾기 (localStorage) ─────────────────────────────────────
    /**
     * 현재 옵션(영역/변수/청) 을 localStorage 에 저장.
     * 자료종류(category) 는 추후 다중 활성 시 추가 예정 — 지금은 wave 고정.
     */
    function saveFavorite() {
        const fav = {
            cat:  state.category,    // 카테고리 (wave/surge/current/sst)
            type: state.type,
            data: state.data,
            area: state.area,
            stn:  state.stn,
        };
        try {
            localStorage.setItem(FAV_KEY, JSON.stringify(fav));
        } catch (e) {
            // 시크릿 모드 등에서 차단되면 무시 (사용자 경고 X — 동작은 정상)
            console.warn('[marine_chart] localStorage 저장 실패:', e);
        }
    }

    /**
     * localStorage 의 즐겨찾기 항목 삭제 (해제).
     * 시크릿 모드 등에서 차단되면 무시 — 다음 진입 시 그냥 기본값으로 시작.
     */
    function clearFavorite() {
        try {
            localStorage.removeItem(FAV_KEY);
        } catch (e) {
            console.warn('[marine_chart] localStorage 삭제 실패:', e);
        }
    }

    /**
     * 현재 state(영역/변수/청) 가 저장된 즐겨찾기와 일치하는지 판정.
     * - 일치 = 사용자가 보기에 별이 ★ 채워진 상태
     * - 불일치 = ☆ 비활성
     * updateFavButton 의 매칭 로직과 동일 — 클릭 핸들러에서 재사용.
     */
    function isFavoriteActive() {
        const fav = loadFavorite();
        if (!fav) return false;
        const favCat = fav.cat || 'wave';
        if (favCat !== state.category) return false;
        if (fav.type !== state.type) return false;
        if (fav.data !== state.data) return false;
        // wave 의 연안일 때만 청 비교
        if (state.category === 'wave' && state.type === 'C' && fav.area !== state.area) return false;
        // wave BUOY 스펙트럼(useStn) — 부이 비교
        const cfg = getCurrentDataConfig();
        if (cfg && cfg.useStn && fav.stn !== state.stn) return false;
        // surge 시계열 / current depth — area/stn 도 비교
        if (cfg && cfg.useSurgeStn && fav.stn !== state.stn) return false;
        if (cfg && cfg.useDepth && fav.area !== state.area) return false;
        return true;
    }

    /**
     * localStorage 에서 즐겨찾기 읽기. 없거나 손상되면 null.
     */
    function loadFavorite() {
        try {
            const raw = localStorage.getItem(FAV_KEY);
            if (!raw) return null;
            const fav = JSON.parse(raw);
            // 카테고리 호환 — 구 버전 즐겨찾기는 cat 필드 없이 wave 가정
            const favCat = fav.cat || 'wave';
            const catalog = CATALOG_BY_CAT[favCat];
            if (!catalog) return null;
            // 검증: CATALOG 변경으로 무효해진 옵션은 무시
            if (!fav || !fav.type || !catalog[fav.type]) return null;
            const opts = catalog[fav.type].options;
            const optMatch = opts.find(o => o.code === fav.data);
            if (!optMatch) return null;
            // 연안 자료(wave) 는 청 코드도 유효성 검증
            if (favCat === 'wave' && fav.type === 'C' && fav.area) {
                const areaValid = AREAS.some(a => a.code === fav.area);
                if (!areaValid) return null;
            }
            // 너울 시계열(gawnOnly) — area='gawn' 이어야 유효
            if (optMatch.gawnOnly && fav.area !== 'gawn') return null;
            // BUOY 스펙트럼(useStn) — wave 카테고리 부이 검증
            if (favCat === 'wave' && optMatch.useStn && fav.stn) {
                const stnList = STNS[fav.area] || [];
                const stnValid = stnList.some(s => s.code === fav.stn);
                if (!stnValid) return null;
            }
            // 폭풍해일 시계열(useSurgeStn) — 지방청 코드 검증
            if (optMatch.useSurgeStn && fav.stn) {
                const stnValid = SURGE_STNS.some(s => s.code === fav.stn);
                if (!stnValid) return null;
            }
            // 해양순환(useDepth) — 수심 검증
            if (optMatch.useDepth && fav.area) {
                const depthValid = CURRENT_DEPTHS.some(d => d.code === fav.area);
                if (!depthValid) return null;
            }
            return fav;
        } catch (e) {
            return null;
        }
    }

    /**
     * 저장된 즐겨찾기를 state·DOM 에 반영. init() 의 첫 fetchList 직전에 호출.
     */
    function applyFavorite() {
        const fav = loadFavorite();
        if (!fav) return;
        const favCat = fav.cat || 'wave';
        state.category = favCat;
        state.type = fav.type;
        state.data = fav.data;
        if (fav.area) state.area = fav.area;
        if (fav.stn)  state.stn  = fav.stn;
        // 카테고리 탭 시각 동기
        if (el.catTabs) {
            el.catTabs.querySelectorAll('.mc-cat-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.cat === favCat);
            });
        }
        // DOM 동기 (wave 일 때만 typeSel/areaSel 적용 — 다른 카테고리는 별도 select 사용)
        if (favCat === 'wave') {
            if (el.typeSel) el.typeSel.value = fav.type;
            if (el.areaSel && fav.area) el.areaSel.value = fav.area;
        }
        // 변수·부이 드롭다운은 refreshDataOptions / refreshStnOptions 후 적용 — init() 의
        // applyVariableConstraints 흐름에서 처리됨
    }

    /**
     * 별 버튼 활성/비활성 시각화.
     * 활성 판정은 isFavoriteActive() 단일 함수에 위임 → 클릭 핸들러와 일관.
     */
    function updateFavButton() {
        if (!el.favBtn) return;
        const matches = isFavoriteActive();
        el.favBtn.classList.toggle('is-active', matches);
        // FontAwesome 아이콘 토글 (외곽선 ↔ 채움)
        const icon = el.favBtn.querySelector('i');
        if (icon) {
            if (matches) {
                icon.classList.remove('fa-regular');
                icon.classList.add('fa-solid');
            } else {
                icon.classList.remove('fa-solid');
                icon.classList.add('fa-regular');
            }
        }
    }

    /**
     * 변수 드롭다운(<select id="mc-data">)의 옵션을 현재 카테고리·영역에 맞게 새로 채움.
     * 예) wave + R3 → R3 의 9개 옵션이 변수 드롭다운에 표시
     */
    function refreshDataOptions() {
        const catalog = CATALOG_BY_CAT[state.category] || CATALOG_WAVE;
        const cat = catalog[state.type];
        if (!cat || !el.dataSel) return;
        const html = cat.options.map(o =>
            `<option value="${o.code}">${o.label}</option>`
        ).join('');
        el.dataSel.innerHTML = html;
    }

    /**
     * 영역=연안(C) 일 때만 청 드롭다운(<label id="mc-field-area">)을 노출,
     * 그 외엔 숨김.
     */
    function toggleAreaField() {
        if (!el.areaField) return;
        const isCoastal = state.type === 'C';
        if (isCoastal) {
            el.areaField.removeAttribute('hidden');
        } else {
            el.areaField.setAttribute('hidden', '');
        }
    }

    /**
     * 짧은 토스트 메시지 (준비 중 자료 등 안내용).
     * SEAGNAL 에 별도 토스트 시스템이 있다면 그걸 쓰고, 없으면 alert 폴백.
     */
    function showToast(msg) {
        // 가능한 SEAGNAL 의 기존 알림 채널 사용 시도
        if (typeof window.showAppToast === 'function') {
            window.showAppToast(msg);
            return;
        }
        // 폴백: 비차단 알림 영역이 없다면 console + 짧은 자체 toast
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;left:50%;top:24%;transform:translateX(-50%);' +
                          'background:rgba(0,0,0,0.85);color:#fff;padding:10px 18px;' +
                          'border-radius:8px;z-index:200000;font-size:0.9rem;pointer-events:none;' +
                          'box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.3s;';
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, 1800);
        setTimeout(() => { t.remove(); }, 2200);
    }

    // ── 전역 노출 ──
    window.MarineChart = window.MarineChart || {};
    Object.assign(window.MarineChart, {
        state,
        el,
        CATALOG: CATALOG_WAVE,           // 호환성용 별칭 (외부 코드가 wave 카탈로그 참조 가능)
        CATALOG_WAVE,
        CATALOG_SURGE,
        CATALOG_CURRENT,
        CATALOG_SST,
        CATALOG_BY_CAT,
        AREAS,
        STNS,
        SURGE_STNS,
        CURRENT_DEPTHS,
        FAV_KEY,
        init,
        refreshDataOptions,
        refreshAreaOptions,
        refreshStnOptions,
        toggleAreaField,
        toggleStnField,
        applyVariableConstraints,
        getCurrentDataConfig,
        onCategoryClick,
        onTypeChange,
        onDataChange,
        onAreaChange,
        onStnChange,
        showToast,
        saveFavorite,
        loadFavorite,
        clearFavorite,
        isFavoriteActive,
        applyFavorite,
        updateFavButton,
    });
})();
