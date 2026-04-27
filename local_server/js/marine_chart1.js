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

    // ── 카탈로그: KMA 날씨누리 사이트의 app-ocean-chart-wave-model.js 에서 추출 ──
    // 영역 코드(type) → 변수 옵션(자료 prefix + 라벨) 매핑
    const CATALOG = {
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
            ],
        },
        C: {
            label: '연안(국지)',
            useArea: true,                 // 청 선택 필요
            options: [
                { code: 'kim_cww3_[AREA]_wave_',  label: '해상풍/유의파고' },
                { code: 'kim_cww3_[AREA]_wdpr_',  label: '파주기/파향' },
                { code: 'kim_cww3_[AREA]_wind_',  label: '해상풍(풍향,풍속)' },
                { code: 'kim_cww3_[AREA]_wswl_',  label: '너울파고/파향' },
            ],
        },
        RWW3: {
            label: '파랑실황도',
            options: [
                { code: 'kim_rww3_wave_anal_', label: '파랑실황도' },
            ],
        },
    };

    // 청 코드 (영역=연안일 때만 사용)
    const AREAS = [
        { code: 'dajn', label: '대전청' },
        { code: 'gwju', label: '광주청' },
        { code: 'jeju', label: '제주청' },
        { code: 'busn', label: '부산청' },
        { code: 'gawn', label: '강원청' },
    ];

    // ── 전역 상태 (단일 source of truth) ──
    // 인라인 영역과 전체화면이 모두 이 state 를 공유 → 자동재생 끊김 없음
    const state = {
        category: 'wave',                     // 자료종류 (현재는 wave 만 활성)
        type: 'R3',                           // 영역
        data: 'kim_rww3_wave_ft03_pa4_',      // 자료 prefix (첫 진입 기본값)
        area: 'jeju',                         // 청 코드
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
            refreshDataOptions();   // 영역에 맞는 변수 옵션 채움
            // 변수 드롭다운에 저장된 data 값 적용 (refreshDataOptions 가 만든 옵션 안에서)
            if (el.dataSel && state.data) {
                el.dataSel.value = state.data;
            }
            toggleAreaField();      // 영역=연안일 때만 청 노출
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
     * - 활성 카테고리: 수치파랑(wave) — 정상 동작
     * - 비활성 (폭풍해일/해양순환/해수면온도): "준비 중" 토스트
     */
    function onCategoryClick(btn) {
        const cat = btn.dataset.cat;
        if (btn.dataset.disabled === 'true') {
            // 준비 중 안내 (간단한 토스트)
            showToast(`${btn.textContent.trim()} 자료는 준비 중입니다.`);
            return;
        }
        // 같은 카테고리면 무시
        if (state.category === cat) return;
        state.category = cat;
        // 모든 탭에서 active 제거 후 클릭한 탭 활성화
        el.catTabs.querySelectorAll('.mc-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // 현재는 수치파랑만 — 추후 다른 카테고리 추가 시 여기서 분기
    }

    /**
     * 영역 드롭다운 변경 핸들러.
     * - 변수 옵션을 새로 채우고
     * - 영역=연안 일 때만 청별 드롭다운 노출
     * - 새 자료 prefix 로 데이터 재조회
     * - 즐겨찾기와 일치 여부 갱신
     */
    function onTypeChange() {
        state.type = el.typeSel.value;
        refreshDataOptions();
        toggleAreaField();
        // 데이터 prefix 도 새 영역의 첫 옵션으로 갱신
        if (el.dataSel.options.length > 0) {
            state.data = el.dataSel.options[0].value;
        }
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 변수 드롭다운 변경 핸들러.
     */
    function onDataChange() {
        state.data = el.dataSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    /**
     * 청 드롭다운 변경 핸들러 (영역=연안일 때만 활성).
     */
    function onAreaChange() {
        state.area = el.areaSel.value;
        updateFavButton();
        if (window.MarineChart.fetchList) window.MarineChart.fetchList();
    }

    // ── 즐겨찾기 (localStorage) ─────────────────────────────────────
    /**
     * 현재 옵션(영역/변수/청) 을 localStorage 에 저장.
     * 자료종류(category) 는 추후 다중 활성 시 추가 예정 — 지금은 wave 고정.
     */
    function saveFavorite() {
        const fav = {
            type: state.type,
            data: state.data,
            area: state.area,
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
        if (fav.type !== state.type) return false;
        if (fav.data !== state.data) return false;
        // 연안일 때만 청 비교 (다른 영역에선 area 무관)
        if (state.type === 'C' && fav.area !== state.area) return false;
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
            // 검증: CATALOG 변경으로 무효해진 옵션은 무시
            if (!fav || !fav.type || !CATALOG[fav.type]) return null;
            const opts = CATALOG[fav.type].options;
            const dataValid = opts.some(o => o.code === fav.data);
            if (!dataValid) return null;
            // 연안 자료는 청 코드도 유효성 검증 (외부 변조·구버전 호환 방어)
            if (fav.type === 'C' && fav.area) {
                const areaValid = AREAS.some(a => a.code === fav.area);
                if (!areaValid) return null;
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
        state.type = fav.type;
        state.data = fav.data;
        if (fav.area) state.area = fav.area;
        // DOM 동기
        if (el.typeSel) el.typeSel.value = fav.type;
        if (el.areaSel && fav.area) el.areaSel.value = fav.area;
        // 변수 드롭다운은 refreshDataOptions() 후 값을 세팅해야 함 — init() 에서 처리
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
     * 변수 드롭다운(<select id="mc-data">)의 옵션을 현재 영역에 맞게 새로 채움.
     * 예) 영역=R3 선택 → R3 의 5개 옵션이 변수 드롭다운에 표시
     */
    function refreshDataOptions() {
        const cat = CATALOG[state.type];
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
        CATALOG,
        AREAS,
        FAV_KEY,
        init,
        refreshDataOptions,
        toggleAreaField,
        onCategoryClick,
        onTypeChange,
        onDataChange,
        onAreaChange,
        showToast,
        saveFavorite,
        loadFavorite,
        clearFavorite,
        isFavoriteActive,
        applyFavorite,
        updateFavButton,
    });
})();
