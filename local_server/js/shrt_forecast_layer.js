/**
 * ============================================================================
 * 파일명: js/shrt_forecast_layer.js
 * 역할: KMA 단기예보 (천기 — 강수확률/강수량/적설/하늘상태/강수형태) 오버레이 +
 *       범례 + 슬라이더 + 클릭 시 점데이터 종합 팝업
 * ============================================================================
 *
 * [한 줄 설명]
 *   사용자가 우측 컨트롤의 "천기" 버튼 → **6개 서브버튼** (강수확률/강수량/적설/
 *   하늘상태/강수형태/기온) 중 하나를 누르면, KMA 의 단기예보 PNG raster 가
 *   지도에 깔리고, 하단에 슬라이더+범례가 나타난다.
 *   추가로 지도 위 어느 점이든 클릭하면 그 좌표의 6개 카테고리 종합 정보가
 *   작은 박스로 뜬다 — **클라이언트(브라우저) 가 PNG 를 직접 canvas 로 그려
 *   픽셀 색상을 추출** 후 색상 팔레트와 매칭해서 단계 값으로 변환.
 *   서버는 단순 CORS 프록시 (/api/kma-png-proxy) 만 제공 — 메모리/CPU 부담 0.
 *
 * [데이터 소스]
 *   GET /mmis_marine_api/v1/kma/shrt/netcdf/imgList?shrtType={pop|pcp|sno|sky|pty}
 *     응답: { code, msg, data: { fct_tm_list:[...], img_list:[...] } }
 *     img_list 예: /resources/fct/shrt_gemd_img/YYYYMM/DD/HH/DFS_SHRT_GRD_GEMD_HR{N}_<TYPE>_H{NNN}.png
 *
 *   PNG 본체: 959x1186 RGBA, EPSG:4326 extent [123.277, 31.581, 132.874, 43.450]
 *   특징: 한반도 + 근해 (황해/동해/제주근해 등) 모두 cover. α=0(투명) 약 27%.
 *         marine.kma.go.kr 사이트의 sky/pty/pop/pcp/sno 레이어가 이 raster 사용.
 *
 * [UI 구성]
 *   - 우측 컨트롤 스택의 "천기" 버튼 (이전 이름: "기타 기상")
 *     → 좌측으로 6개 서브버튼 팝아웃 (강수확률/강수량/적설/하늘상태/강수형태/기온)
 *   - 서브버튼 클릭 시 팝아웃 닫힘 + 해당 GEMD raster 표출 + 슬라이더/범례/재생
 *   - 동일 레이어 다시 클릭 시 OFF
 *
 * [범례 색상 — KMA 1:1 매칭]
 *   POP 25 / PCP 30 / SNO 30 단계. KMA marine.kma.go.kr 의 chunk-common.js 에서
 *   추출한 정확한 hex 시퀀스 (보간 없음, 단색 단계 블록). 라벨 위치도 KMA 의
 *   visible-marks 그대로 (0/20/40/60/80/100 또는 비균등).
 *
 * [클릭 팝업 — T2 (클라이언트 sampling 방식)]
 *   - 천기 활성 + 지도 클릭 → window._shrtForecastTryHandleClick(map, evt) 호출
 *   - 활성 상태이고 KMA extent 안이면 박스 표출 + true 반환 → 다음 가드 (특보 등) 차단
 *   - 클라이언트가 직접 5개 카테고리 PNG (CORS 프록시 경유) 를 다운로드 → canvas
 *     로 클릭 좌표 주변 3x3 영역 픽셀 추출 → 색상 팔레트 매칭하여 단계 값 변환.
 *   - 슬라이더 frame 변경 시 popupState.latLon 으로 자동 재샘플링 (재생 중 동기 갱신)
 *   - 외부 클릭 / X 버튼 / 천기 OFF 시 자동 닫기
 *   - 슬라이더 ▶ 재생 시: 0.5초 간격이지만 데이터 (PNG 로드 + 샘플링) 가 끝나야
 *     다음 frame 진행 (data-driven sync). 느릴 땐 자동으로 그만큼 늘어남.
 *   - 슬라이더 드래그 시: 드래그 중에는 fetch 안 함, 손 놓은 위치만 1번 fetch.
 *
 * [잠금 패턴]
 *   기본 토글 클릭 시 토스트 안내 + 차단.
 *   3초 idle 안에 10회 연속 클릭하면 그 세션 동안 잠금 해제.
 *
 * [외부와의 인터페이스]
 *   - window.initShrtForecastLayer(oceanMap)       → 초기화 (한 번만)
 *   - window._shrtForecastDeactivate()             → 다른 overlay 활성 시 강제 OFF
 *   - window._shrtForecastTryHandleClick(map, evt) → handleMapClick 가드 (T5)
 *   - window._shrtForecastHidePointPopup()         → 외부에서 팝업 닫기
 *
 * [CSS 변수]
 *   --shrt-stack-height : 슬라이더+범례 스택 픽셀 높이. 활성 시 px, 비활성 시 0px.
 *                         특보 범례(.warn-active-legend) 가 이 값만큼 위로 상승하여
 *                         천기 스택에 가려지지 않음 (T3).
 *
 * [의존]
 *   - OpenLayers 6+ (ol.layer.Image, ol.source.ImageStatic, ol.proj)
 *   - window._showOceanToast (index2_patch.js)
 *   - window.__getOceanMap (ocean_map.js 가 노출)
 *   - GET /api/kma-png-proxy?path=... (routes/weather.js — CORS 프록시)
 *   - 브라우저 native: HTMLImageElement, Canvas 2D, getImageData
 * ============================================================================
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // 상수 / 설정
    // ─────────────────────────────────────────────────────────────

    var KMA_BASE = 'https://marine.kma.go.kr';
    // netcdf/imgList: GEMD raster (한반도+근해 wider) — sky/pty/pop/pcp/sno 모두 지원
    var IMG_LIST_URL = KMA_BASE + '/mmis_marine_api/v1/kma/shrt/netcdf/imgList';

    // GEMD raster extent (EPSG:4326 lon-lat) — LAND PNG 와 동일 canvas (959x1186)
    var DFS_EXTENT_4326 = [
        123.2770767211914,
        31.580740724291122,
        132.8739022435368,
        43.44957733154297
    ];

    var PLAY_INTERVAL_MS = 500;

    // 5개 카테고리 모두 활성 (잠금 해제 후 사용)
    var ENABLED_TYPES = { sky: true, pty: true, pop: true, pcp: true, sno: true, tmp: true };

    var TYPE_LABELS = {
        pop: '강수확률', pcp: '강수량', sno: '적설',
        sky: '하늘상태', pty: '강수형태', tmp: '기온'
    };

    // [사용량] 천기도 요소 type → 통합 metric key (바텀시트 천기 셀과 동일 key 로 귀결)
    var USAGE_KEY = {
        pop: 'shrt.rain_prob',
        pcp: 'shrt.rain_amount',
        sno: 'shrt.snow',
        sky: 'shrt.sky',
        pty: 'shrt.rain_prob',   // 강수형태도 강수 계열 대표 key 로 통합
        tmp: 'shrt.temp_air'
    };
    /** 현재 활성 천기 요소의 사용량 key 를 +1 (없으면 무시). */
    function _trackShrtUsage(shrtType) {
        if (window.trackUsage && USAGE_KEY[shrtType]) window.trackUsage(USAGE_KEY[shrtType]);
    }

    // 범례 — KMA marine.kma.go.kr chunk-common JS 에서 추출한 정확한 정의 (단계/색상/임계값/visible-marks).
    //   colors[]  : KMA 단계별 색상 (25/30/30) — 단색 블록 균등 폭으로 렌더 (보간 X).
    //   labels[]  : { t: 라벨텍스트, p: 위치% } — KMA visible-marks 기반 비균등 위치 + max 우측 끝 추가.
    //   sky/pty   : 카테고리형 (KMA 표시 동일).
    var SKY_LEGEND = [
        { label: '맑음',     color: 'rgba(255, 255, 255, 0.85)' },
        { label: '구름많음', color: 'rgba(174, 200, 224, 0.85)' },
        { label: '흐림',     color: 'rgba(56,  120, 152, 0.85)' }   // KMA #387898
    ];
    var PTY_LEGEND = [
        { label: '비',     color: '#60d47e' },
        { label: '비/눈', color: '#3dc4e6' },
        { label: '눈',     color: '#8e8ee6' }
    ];

    // POP — 강수확률 25 단계 (4% 간격), 라벨 균등 0/20/40/60/80/100.
    //   KMA visible-marks=[0,5,10,15,20,25] → idx/25*100% 위치, idx 25 는 max (100).
    var POP_COLORS = [
        '#ffea6e', '#ffdc1f', '#f9cd00', '#e0b900', '#ccaa00',
        '#69fc69', '#1ef31e', '#00d500', '#00a400', '#008000',
        '#87d9ff', '#3ec1ff', '#07abff', '#008dde', '#0077b3',
        '#b3b4de', '#8081c7', '#4c4eb1', '#1f219d', '#000390',
        '#da87ff', '#c23eff', '#ad07ff', '#9200e4', '#7f00bf'
    ];
    var POP_LABELS = [
        { t: '0',   p: 0 },
        { t: '20',  p: 20 },
        { t: '40',  p: 40 },
        { t: '60',  p: 60 },
        { t: '80',  p: 80 },
        { t: '100', p: 100 }
    ];

    // PCP — 강수량 30 단계 (비균등 임계값), 라벨 7개 (visible-marks 6 + max=700 우측 끝).
    //   KMA visible-marks=[0,4,9,14,20,25] / 30 = 0/13.33/30/46.67/66.67/83.33%, 700 = 100%.
    //   [임계값] 0/.2/.4/.6/.8/1/1.5/2/3/4/5/6/7/8/9/10/14/18/22/26/30/40/50/60/70/80/160/320/480/640~700
    var PCP_COLORS = [
        '#ffea6e', '#ffdc1f', '#f9cd00', '#e0b900', '#ccaa00',
        '#69fc69', '#1ef31e', '#00d500', '#00a400', '#008000',
        '#87d9ff', '#3ec1ff', '#07abff', '#008dde', '#0077b3',
        '#b3b4de', '#8081c7', '#4c4eb1', '#1f219d', '#000390',
        '#da87ff', '#c23eff', '#ad07ff', '#9200e4', '#7f00bf',
        '#fa8585', '#f63e3e', '#ee0b0b', '#d50000', '#bf0000'   // 마지막 5단계 빨강 (KMA 와 동일)
    ];
    var PCP_LABELS = [
        { t: '0',   p: 0 },
        { t: '0.8', p: 4 / 30 * 100 },
        { t: '4',   p: 9 / 30 * 100 },
        { t: '9',   p: 14 / 30 * 100 },
        { t: '30',  p: 20 / 30 * 100 },
        { t: '80',  p: 25 / 30 * 100 },
        { t: '700', p: 100 }
    ];

    // SNO — 적설 30 단계 (비균등 임계값), 라벨 7개 (visible-marks 6 + max=90 우측 끝).
    //   KMA visible-marks=[0,4,9,14,19,24] / 30 = 0/13.33/30/46.67/63.33/80%, 90 = 100%.
    //   [임계값] 0.1/.2/.4/.6/.8/1/1.5/2/3/4/5/6/7/8/9/10/12/14/16/18/20/25/30/35/40/45/50/60/70/80~90
    var SNO_COLORS = [
        '#ffea6e', '#ffdc1f', '#f9cd00', '#e0b900', '#ccaa00',
        '#69fc69', '#1ef31e', '#00d500', '#00a400', '#008000',
        '#87d9ff', '#3ec1ff', '#07abff', '#008dde', '#0077b3',
        '#b3b4de', '#8081c7', '#4c4eb1', '#1f219d', '#000390',
        '#da87ff', '#c23eff', '#ad07ff', '#9200e4', '#7f00bf',
        '#fa8585', '#f63e3e', '#ee0b0b', '#d50000', '#bf0000'
    ];
    var SNO_LABELS = [
        { t: '0.1', p: 0 },
        { t: '0.8', p: 4 / 30 * 100 },
        { t: '4',   p: 9 / 30 * 100 },
        { t: '9',   p: 14 / 30 * 100 },
        { t: '18',  p: 19 / 30 * 100 },
        { t: '40',  p: 24 / 30 * 100 },
        { t: '90',  p: 100 }
    ];

    // ── TMP — 기온 60단계 (KMA marine.kma.go.kr chunk-common.js 추출) ──
    //   현재 월에 따라 임계값 범위(min~max) 가 동적 변동. 단계 갯수 60 고정.
    //   색상: 보라(저온) → 파랑 → 청 → 녹 → 노랑 → 빨강(고온) — 6 색상군 × 10단계.
    //   visible-marks: [0, 10, 20, 30, 40, 50, 60] = 7개 라벨 (각 군 경계).
    //   step = (max - min) / 60 → 보통 0.5°C 단위.
    var TMP_COLORS = [
        '#e5acff','#da87ff','#cd61ff','#c23eff','#b71fff','#ad07ff','#a000f7','#9200e4','#8700ce','#7f00bf',
        '#cbcce8','#b3b4de','#9a9bd3','#8081c7','#6567bc','#4c4eb1','#3436a7','#1f219d','#0d1096','#000390',
        '#ace5ff','#87d9ff','#61cdff','#3ec1ff','#1fb5ff','#07abff','#009df6','#008dde','#0080c4','#0077b3',
        '#96fe96','#69fc69','#40f940','#1ef31e','#08e908','#00d500','#00bd00','#00a400','#008e00','#008000',
        '#fff09a','#ffea6e','#ffe343','#ffdc1f','#ffd604','#f9cd00','#edc300','#e0b900','#d4b000','#ccaa00',
        '#fcabab','#fa8585','#f86060','#f63e3e','#f32121','#ee0b0b','#e30000','#d50000','#c80000','#bf0000'
    ];

    /**
     * 현재 월에 따라 기온 범례 [min, max] 반환 (KMA chunk-common.js 동적 로직 1:1 동일).
     * step = (max - min) / 60 = 보통 0.5°C 단위.
     * 60단계 → 인덱스 i 의 임계값 = min + i * step.
     */
    function _getTmpRange() {
        var m = (new Date()).getMonth() + 1;   // 1..12
        if (m === 1 || m === 2 || m === 12) return { min: -15, max: 15 };
        if (m === 3 || m === 11)             return { min: -10, max: 20 };
        if (m === 4 || m === 10)             return { min: -5,  max: 25 };
        if (m === 5 || m === 9)              return { min: 5,   max: 35 };
        return { min: 10, max: 40 };           // 6, 7, 8 월
    }

    /** 현재 월의 60단계 임계값 배열 (각 색상이 시작되는 °C). */
    function _getTmpThresholds() {
        var r = _getTmpRange();
        var step = (r.max - r.min) / 60;
        var arr = [];
        for (var i = 0; i < 60; i++) arr.push(Math.round((r.min + step * i) * 10) / 10);
        return arr;
    }

    /** 현재 월의 7개 라벨 ({t,p} 형태). visible-marks=[0,10,20,30,40,50,60] / 60 = 0/16.67/.../100. */
    function _getTmpLabels() {
        var r = _getTmpRange();
        var step = (r.max - r.min) / 60;
        // visible-marks 인덱스 → 표시 위치% + 라벨 텍스트 (해당 인덱스의 °C 값)
        var marks = [0, 10, 20, 30, 40, 50, 60];
        return marks.map(function (idx) {
            var pct = (idx / 60) * 100;
            // 정수면 정수로, 소수면 그대로
            var v = Math.round((r.min + step * idx) * 10) / 10;
            return { t: String(v), p: pct };
        });
    }

    var LEGEND_DEF = {
        sky: { title: '하늘상태', style: 'category', items: SKY_LEGEND },
        pty: { title: '강수형태', style: 'category', items: PTY_LEGEND },
        pop: { title: '강수확률', style: 'gradient', unit: '%',  colors: POP_COLORS, labels: POP_LABELS },
        pcp: { title: '강수량',   style: 'gradient', unit: 'mm', colors: PCP_COLORS, labels: PCP_LABELS },
        sno: { title: '적설',     style: 'gradient', unit: 'cm', colors: SNO_COLORS, labels: SNO_LABELS },
        // 기온 — 동적 라벨이라 함수형 (renderLegend 가 호출 시 생성).
        tmp: { title: '기온',     style: 'gradient', unit: '°C', colors: TMP_COLORS, dynamicLabels: _getTmpLabels }
    };

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    //   (이전: 10회 연속 클릭 잠금 패턴 — 사용자 요구로 폐지)
    // ─────────────────────────────────────────────────────────────

    var state = {
        oceanMap: null,
        activeType: null,
        frames: [],                  // [{ url, label }]
        frameIdx: 0,
        layer: null,
        playing: false,
        playTimer: null,
        preloadedImgs: {}
    };

    var initialized = false;

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    /** document.getElementById 의 짧은 alias — DOM 접근을 가독성 있게. */
    function $(id) { return document.getElementById(id); }

    /**
     * 화면 하단에 짧은 토스트 메시지 표출 (1.8초 후 자동 사라짐).
     *
     * 무엇을 하나?
     *   index2_patch.js 의 전역 _showOceanToast 함수가 있으면 호출, 없으면 console.log.
     *
     * 어디서 쓰이나?
     *   안내 메시지 표출용 (예: 에러/상태 알림 — 잠금 패턴은 폐지됨).
     */
    function _toast(msg) {
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(msg, 'bottom', 1800, false);
        } else {
            console.log('[shrt-toast]', msg);
        }
    }

    /**
     * KMA imgList 응답의 시각 문자열을 사용자 친화 한국어 표기로 변환.
     *
     * 예) "2026.05.03 14:00" → "5.3.(월) 14:00"
     *
     * 어디서 쓰이나?
     *   - 슬라이더 말풍선 (updateTooltip) — frame 시각 표시
     *   - 슬라이더 큰 tick 의 날짜 라벨 (renderTicks)
     *   - 클릭 팝업 헤더 (fmtPopupTm 와는 별개 포맷)
     */
    function fmtFcstTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '.' + (+m[3]) + '.(' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

    /**
     * 슬라이더 트랙의 진행 비율을 CSS 변수 `--shrt-progress` 로 publish.
     *
     * 무엇을 하나?
     *   slider.value 가 min~max 사이 어디인지 % 로 계산해 CSS 변수에 저장.
     *   CSS 의 ::-webkit-slider-runnable-track / progress fill 그라디언트가 이 변수를
     *   참조해 트랙 좌측에 채워진 색을 표시 (현재까지 재생된 위치 시각화).
     *
     * 언제 호출?
     *   - showSliderBar() 초기화 시
     *   - showFrame() 매번 (재생 / 드래그 중 슬라이더 위치 변경 시)
     */
    function setSliderProgress(slider) {
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var val = parseFloat(slider.value) || 0;
        var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.setProperty('--shrt-progress', pct + '%');
    }

    /**
     * 말풍선 위치/화살표 동적 계산.
     *
     * [디자인 의도]
     *   - 말풍선 본체: viewport 좌·우 가장자리 안쪽으로 항상 가두기 (텍스트 잘림 방지)
     *   - 화살표 (::after, --shrt-arrow-x): 슬라이더 thumb 위치를 향해 좌/중/우 동적 이동
     *
     * [폰트 크기 동적 대응]
     *   매 호출 시 tip.getBoundingClientRect().width 로 실제 width 측정 → 폰트 크기
     *   변경 시 자동으로 새 width 반영 (rem 기반 layout 이라 reflow 자동).
     */
    function updateTooltip() {
        var tip = $('shrt-fcst-tooltip');
        var slider = $('shrt-fcst-slider');
        if (!tip || !slider) return;
        var idx = parseInt(slider.value, 10) || 0;
        var frame = state.frames[idx];
        if (!frame) return;
        tip.textContent = frame.label;

        // 1) reset — 정확한 width 측정 위해 transform/left 초기화
        tip.style.left = '0px';
        tip.style.transform = 'none';

        // 2) thumb 의 viewport 절대 좌표
        var sliderRect = slider.getBoundingClientRect();
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = max > min ? ((idx - min) / (max - min)) : 0;
        var thumbHalf = 9;   // thumb 반지름 (px) — CSS thumb width 16의 절반 + border 등 고려
        var thumbXViewport = sliderRect.left + thumbHalf + pct * (sliderRect.width - thumbHalf * 2);

        // 3) 말풍선 측정 (텍스트 변경 후 재측정)
        var tipRect = tip.getBoundingClientRect();
        var tipW = tipRect.width;

        // 4) 말풍선 left = thumb 가운데 정렬, viewport 좌·우 4px padding 안에서 clamping
        var pad = 4;
        var minLV = pad;
        var maxLV = window.innerWidth - tipW - pad;
        var idealLV = thumbXViewport - tipW / 2;
        var clampedLV = Math.max(minLV, Math.min(idealLV, maxLV));

        // 5) wrap (slider-wrap = parent of tooltip) 기준 left 로 변환
        var wrapRect = tip.parentElement.getBoundingClientRect();
        var leftInWrap = clampedLV - wrapRect.left;
        tip.style.left = leftInWrap + 'px';

        // 6) 화살표 x (말풍선 안에서 thumb 가리키는 위치).
        //    말풍선이 가두어졌더라도 화살표는 thumb 방향으로 비스듬히 이동.
        //    좌·우 8px 안쪽으로 clamping (화살표가 말풍선 모서리 밖으로 안 나가게)
        var arrowX = thumbXViewport - clampedLV;
        var arrowMin = 8, arrowMax = tipW - 8;
        arrowX = Math.max(arrowMin, Math.min(arrowX, arrowMax));
        tip.style.setProperty('--shrt-arrow-x', arrowX + 'px');
    }

    /**
     * 해양 지도 OL 인스턴스를 가져옴 (lazy + cached).
     *
     * 무엇을 하나?
     *   ocean_map.js 가 노출한 window.__getOceanMap() 으로 OL Map 객체를 1번만 가져와
     *   state.oceanMap 에 저장 후 재사용.
     *
     * 왜 lazy?
     *   shrt_forecast_layer.js 가 ocean_map.js 보다 먼저 로드될 수 있어서 init 시점엔
     *   map 이 아직 없을 수 있음. 실제로 필요한 시점 (activate / buildOrUpdateLayer) 에
     *   가져와 안전하게 처리.
     *
     * 연계: ocean_map.js (window.__getOceanMap), index2.html script 순서.
     */
    function getOceanMap() {
        if (state.oceanMap) return state.oceanMap;
        if (typeof window.__getOceanMap === 'function') {
            state.oceanMap = window.__getOceanMap();
        }
        return state.oceanMap;
    }

    // ─────────────────────────────────────────────────────────────
    // 레이어 빌드 / 갱신
    // ─────────────────────────────────────────────────────────────

    function buildOrUpdateLayer(url) {
        var map = getOceanMap();
        if (!map || typeof ol === 'undefined') return;

        // crossOrigin 미지정: KMA 가 PNG 응답에 ACAO 헤더를 주지 않아
        // crossOrigin:'anonymous' 로 요청하면 Capacitor WebView 에서 이미지 로드 실패.
        // OL 의 ImageStatic 은 canvas getImageData 를 직접 호출하지 않으므로
        // tainted canvas 여도 화면 표시는 정상 동작.
        var src = new ol.source.ImageStatic({
            url: url,
            imageExtent: DFS_EXTENT_4326,
            projection: 'EPSG:4326'
        });

        if (!state.layer) {
            state.layer = new ol.layer.Image({
                source: src,
                opacity: 0.7,
                zIndex: 50
            });
            map.addLayer(state.layer);
        } else {
            state.layer.setSource(src);
        }
    }

    function removeLayer() {
        var map = getOceanMap();
        if (state.layer && map) map.removeLayer(state.layer);
        state.layer = null;
    }

    function preloadImg(url) {
        if (state.preloadedImgs[url]) return;
        var img = new Image();
        // crossOrigin 미지정 — buildOrUpdateLayer 와 동일 사유 (앱 환경 호환).
        img.src = KMA_BASE + url;
        state.preloadedImgs[url] = img;
    }

    /**
     * @param {number} idx - 표시할 frame 인덱스
     * @param {boolean} [skipSample] - true 면 팝업 본문 sample 스킵 (드래그 중 사용).
     *                                  헤더 시각만 갱신, 지도 PNG 는 정상 표시.
     */
    function showFrame(idx, skipSample) {
        if (!state.frames.length) return;
        if (idx < 0) idx = 0;
        if (idx >= state.frames.length) idx = state.frames.length - 1;
        state.frameIdx = idx;
        var frame = state.frames[idx];
        buildOrUpdateLayer(KMA_BASE + frame.url);
        var slider = $('shrt-fcst-slider');
        if (slider) {
            slider.value = String(idx);
            setSliderProgress(slider);
        }
        updateTooltip();
        // [T2] 팝업이 열려 있으면 새 frame 시각으로 본문 갱신 — skipSample 시 헤더만.
        //   슬라이더 재생 중에도 매 frame 변경 시 함께 동기화 (사용자 요구).
        if (popupState && popupState.box && popupState.latLon) {
            refreshPopupContents(skipSample);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 데이터 fetch
    // ─────────────────────────────────────────────────────────────

    // ── imgList 통합 캐시 (5분 TTL) ──
    //   activate 와 클릭 팝업 sampling 양쪽이 같은 캐시 공유. 한 번 받으면 5분간 즉답.
    //   _imgListCache[shrtType] = { ts, frames, fctMap }
    //   _imgListInflight[shrtType] = Promise — 동시 호출 시 dedup (같은 fetch 한 번만)
    var _imgListCache = {};
    var _imgListInflight = {};
    var IMG_LIST_TTL_MS = 5 * 60 * 1000;

    /**
     * 한 카테고리의 imgList entry 를 가져옴 (캐시 + dedup).
     *
     * 동작:
     *   1) 캐시 valid (TTL 5분 안) 이면 즉시 entry 반환
     *   2) 같은 카테고리 fetch 가 이미 진행 중이면 그 Promise 재사용 (네트워크 중복 방지)
     *   3) 그 외 새로 fetch + 캐시 저장 + entry 반환
     *
     * @returns {Promise<{ts, frames:[{url,fct_tm,label}], fctMap:{fct_tm→url}}>}
     *
     * 호출자:
     *   - fetchImgList()      — activate 시 frame 배열 추출
     *   - _samplePointForType — 팝업 sampling 시 fctMap 활용
     *   - prefetchAllImgLists — 천기 토글 시 6개 동시 prefetch
     */
    function _getImgListEntry(shrtType) {
        var c = _imgListCache[shrtType];
        if (c && (Date.now() - c.ts) < IMG_LIST_TTL_MS) return Promise.resolve(c);
        if (_imgListInflight[shrtType]) return _imgListInflight[shrtType];

        var url = IMG_LIST_URL + '?shrtType=' + encodeURIComponent(shrtType);
        var p = fetch(url, { credentials: 'omit' })
            .then(function (r) { if (!r.ok) throw new Error('imgList ' + shrtType + ' ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || j.code !== '0000' || !j.data) throw new Error('imgList ' + shrtType + ' bad');
                var times = j.data.fct_tm_list || [];
                var imgs  = j.data.img_list || [];
                var n = Math.min(times.length, imgs.length);
                var frames = [], fctMap = {};
                for (var i = 0; i < n; i++) {
                    frames.push({ url: imgs[i], fct_tm: times[i], label: fmtFcstTm(times[i]) });
                    fctMap[times[i]] = imgs[i];
                }
                var entry = { ts: Date.now(), frames: frames, fctMap: fctMap };
                _imgListCache[shrtType] = entry;
                return entry;
            })
            .finally(function () { delete _imgListInflight[shrtType]; });
        _imgListInflight[shrtType] = p;
        return p;
    }

    /**
     * KMA imgList API 호출 — 활성 카테고리의 frame 목록을 가져옴.
     *
     * [통합 캐시 사용]
     *   _getImgListEntry 경유 → 5분 캐시 + dedup. 같은 카테고리 재활성화 즉답.
     *
     * 반환 frame 형식:
     *   - url: KMA PNG 경로 (지도 raster 표출용)
     *   - label: "5.3.(월) 14:00" 화면 표시용
     *   - fct_tm: KMA 원본 "2026.05.03 14:00" — 팝업 sampling 키 매칭용
     */
    function fetchImgList(shrtType) {
        return _getImgListEntry(shrtType).then(function (entry) { return entry.frames; });
    }

    /**
     * 모든 카테고리의 imgList 를 백그라운드 prefetch.
     *
     * [언제 호출?]
     *   사용자가 "천기" 토글 버튼을 눌러 서브버튼 popup 이 열리는 시점.
     *   사용자가 서브버튼을 고르는 데 보통 1-2초 걸리는 그 시간 동안 미리 캐시 채움.
     *
     * [효과]
     *   사용자가 어떤 서브버튼을 선택하든 imgList 캐시 적중 → activate 즉답.
     *
     * [비용]
     *   각 imgList ~30 KB JSON × 카테고리 수. 사용자가 천기 안 쓰고 닫아도 다운로드 발생하지만
     *   180 KB 정도라 모바일 데이터 부담 매우 작음.
     *
     * [에러 처리]
     *   각 fetch 가 독립적으로 실패해도 다른 fetch 영향 X (.catch noop).
     *   실제 사용 시 그 카테고리만 다시 fetch 하면 됨.
     */
    function prefetchAllImgLists() {
        var types = Object.keys(ENABLED_TYPES).filter(function (t) { return ENABLED_TYPES[t]; });
        types.forEach(function (t) { _getImgListEntry(t).catch(function () {}); });
    }

    // ─────────────────────────────────────────────────────────────
    // 재생
    // ─────────────────────────────────────────────────────────────

    function setPlayBtnIcon(playing) {
        var btn = $('shrt-fcst-play-btn');
        if (!btn) return;
        btn.innerHTML = playing
            ? '<i class="fa-solid fa-pause"></i>'
            : '<i class="fa-solid fa-play"></i>';
        btn.classList.toggle('playing', !!playing);
    }
    /**
     * [재생 동기화 — 사용자 요구]
     *   재생 버튼 ▶ 누르면 0.5초 간격으로 다음 frame 으로 진행하되, 데이터 (PNG +
     *   팝업 sampling) 가 0.5초 안에 끝나지 않으면 다음 frame 을 안 넘김.
     *
     * 동작:
     *   1) 다음 frame 결정 → showFrame(next) 호출 (지도 PNG 갱신 + 팝업 sample 시작)
     *   2) waitForFrameDataReady(next) → PNG 로드 + 팝업 sample 완료 대기
     *   3) 동시에 최소 PLAY_INTERVAL_MS 만큼 wait
     *   4) Promise.all → 둘 다 끝나면 다시 다음 frame 으로 setTimeout (재귀)
     *
     * 캐시 적중 시: 즉시 끝남 → 0.5초 간격 그대로 유지
     * 캐시 미스 시: 데이터 로드가 0.5초 넘으면 자동으로 그만큼 늘어남 → 사용자에게 데이터와 화면 일치 보장
     */
    function _waitMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /**
     * 한 frame 의 모든 데이터가 준비될 때까지 대기.
     * - 지도 PNG: ImageStatic 의 onload 콜백을 hook 하기 어려워, image preload 사용.
     * - 팝업 데이터: 팝업이 열려 있으면 refreshPopupContents() 의 Promise 를 기다림.
     * - 팝업 닫혔으면 PNG preload 만 기다림.
     */
    function waitForFrameDataReady(idx) {
        var frame = state.frames[idx];
        if (!frame) return Promise.resolve();
        // 지도 PNG preload — 이미 캐시되어 있으면 즉답
        var pngP = new Promise(function (resolve) {
            var pre = state.preloadedImgs[frame.url];
            if (pre && pre.complete) return resolve();
            if (pre) { pre.addEventListener('load', resolve); pre.addEventListener('error', resolve); return; }
            var img = new Image();
            img.onload = function () { resolve(); };
            img.onerror = function () { resolve(); };
            img.src = KMA_BASE + frame.url;
            state.preloadedImgs[frame.url] = img;
        });
        // 팝업 데이터 — 열려 있으면 sample 완료 기다림
        var popupP = (popupState.box && popupState.latLon)
            ? refreshPopupContents()
            : Promise.resolve();
        return Promise.all([pngP, popupP]);
    }

    function startPlay() {
        if (state.playing || !state.frames.length) return;
        state.playing = true;
        // [사용량] 천기도 재생 시작도 1건 — 현재 활성 요소의 통합 key 로 +1
        _trackShrtUsage(state.activeType);
        setPlayBtnIcon(true);
        // 재생 시작 → 말풍선 표출 (1초 fade-in, opacity transition)
        var bar = $('shrt-fcst-slider-bar');
        if (bar) bar.classList.remove('tooltip-suppressed');

        // 재귀 형태의 데이터-기반 재생 루프 (setInterval 대신 setTimeout 체이닝).
        // setInterval 은 데이터 로드 시간 무시하고 강제 진행 → 화면-데이터 불일치.
        function _step() {
            if (!state.playing) return;
            var next = state.frameIdx + 1;
            if (next >= state.frames.length) next = 0;
            showFrame(next);   // 지도 + 팝업 sample 시작 (showFrame 안에서 refreshPopupContents 호출)
            // 데이터 준비 + 최소 간격 둘 다 기다림 → 둘 중 늦은 쪽이 다음 frame timing 결정
            Promise.all([
                waitForFrameDataReady(next),
                _waitMs(PLAY_INTERVAL_MS)
            ]).then(function () {
                if (state.playing) _step();
            });
        }
        _step();
    }
    function stopPlay() {
        if (!state.playing) return;
        state.playing = false;
        setPlayBtnIcon(false);
        // 진행 중인 _step 의 Promise 는 state.playing 을 다음 사이클에서 false 로 보고 종료.
        // 정지 → 정량형이면 말풍선 1초 fade-out, 카테고리형은 그대로 표출
        var bar = $('shrt-fcst-slider-bar');
        var def = state.activeType ? LEGEND_DEF[state.activeType] : null;
        if (bar && def && def.style === 'gradient') {
            bar.classList.add('tooltip-suppressed');
        }
    }
    function togglePlay() { state.playing ? stopPlay() : startPlay(); }

    // ─────────────────────────────────────────────────────────────
    // 범례 / 슬라이더
    // ─────────────────────────────────────────────────────────────

    function renderLegend(shrtType) {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        var def = LEGEND_DEF[shrtType];
        if (!def) { lg.innerHTML = ''; lg.style.display = 'none'; return; }

        var html = '';
        if (def.style === 'gradient') {
            // KMA 사이트 동일 형식 — 단계 블록(discrete band):
            //   1) 색상 바: N 개 단색 블록 (균등 폭, 하드 엣지). 보간 없음 → 지도 raster 의
            //      실제 픽셀 색상과 1:1 매칭 (지도에 없는 중간색이 범례에 표시되는 문제 해결).
            //   2) 라벨: M 개 (색상 갯수와 독립), 균등 위치. 단위(%/mm/cm) 는 라벨에 직접 부착.
            //   3) 별도 헤더 / 우하단 단위 표시 없음.
            var colors = def.colors || [];
            // 동적 라벨 (예: 기온 — 월별 변동) 또는 정적 라벨
            var labels = def.dynamicLabels ? def.dynamicLabels() : (def.labels || []);
            var unit = def.unit || '';

            var blocksHtml = '';
            for (var bi = 0; bi < colors.length; bi++) {
                blocksHtml += '<div class="shrt-fcst-grad-block" style="background:' + colors[bi] + ';"></div>';
            }
            html += '<div class="shrt-fcst-grad-bar">' + blocksHtml + '</div>';

            // 라벨 — KMA visible-marks 기반 비균등 위치 ({t,p} 객체 배열).
            //   p: 위치% (0~100). 0% → 좌가장자리 정렬, 100% → 우가장자리 정렬, 그 외 중심정렬.
            html += '<div class="shrt-fcst-grad-labels">';
            for (var li = 0; li < labels.length; li++) {
                var lab = labels[li];
                var pct = lab.p;
                var tx;
                if (pct <= 0)        tx = '0';
                else if (pct >= 100) tx = '-100%';
                else                 tx = '-50%';
                html += '<span style="left:' + pct + '%;transform:translateX(' + tx + ');">'
                      +   lab.t + unit
                      + '</span>';
            }
            html += '</div>';
            lg.classList.add('gradient-mode');
        } else {
            // 카테고리형: swatch + label 가로 정렬 (sky, pty)
            for (var i = 0; i < def.items.length; i++) {
                var it = def.items[i];
                html += '<div class="shrt-fcst-legend-row">'
                      +   '<span class="shrt-swatch" style="background:' + it.color + ';"></span>'
                      +   '<span>' + it.label + '</span></div>';
            }
            lg.classList.remove('gradient-mode');
        }
        lg.innerHTML = html;
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    /**
     * [P3] 로딩 상태 범례 — imgList 응답 전 임시 표출.
     *
     * 무엇을 하나?
     *   범례 박스 자리에 "데이터를 불러오는 중…" 메시지 표시. activate 진입 즉시 호출.
     *   응답 도착 후 renderLegend() 가 정상 범례로 덮어씀.
     *
     * 디자인:
     *   기존 카테고리형 (sky/pty) 범례 스타일과 동일한 어두운 박스 + 흰톤 텍스트.
     *   gradient-mode 클래스는 빼서 카테고리형 컴팩트 박스로 표시.
     */
    function renderLegendLoading(shrtType) {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        lg.classList.remove('gradient-mode');
        lg.innerHTML = '<div class="shrt-fcst-legend-loading">데이터를 불러오는 중…</div>';
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    /**
     * [P3] 에러 상태 범례 — imgList 호출 실패 시 사용자에게 알림.
     *
     * @param {string} shrtType - 카테고리 (참고용, 메시지 결정에는 사용 X)
     * @param {string} msg - 표시할 에러 메시지
     */
    function renderLegendError(shrtType, msg) {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        lg.classList.remove('gradient-mode');
        lg.innerHTML = '<div class="shrt-fcst-legend-loading">' + msg + '</div>';
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    function hideLegend() {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        lg.style.display = 'none';
        lg.setAttribute('aria-hidden', 'true');
        lg.innerHTML = '';
    }
    function showSliderBar(frameCount) {
        var bar = $('shrt-fcst-slider-bar');
        var slider = $('shrt-fcst-slider');
        if (!bar || !slider) return;
        slider.min = '0';
        slider.max = String(Math.max(0, frameCount - 1));
        slider.value = '0';
        setSliderProgress(slider);
        bar.style.display = '';
        bar.setAttribute('aria-hidden', 'false');
        renderTicks();
        updateTooltip();
    }

    // 시간 눈금 동적 생성:
    //   1) 모든 frame 위치에 작은 tick (height 3px, 옅은 색)
    //   2) 12h 단위 (00시 / 12시) 에만 큰 tick (height 6px) + 텍스트 라벨
    //      - 자정엔 "M/D" (예: "5/2")
    //      - 정오엔 "12시"
    //   1h 단위 텍스트는 모바일 화면에서 겹치므로 생략 — tick line 만 표시.
    function renderTicks() {
        var ticksEl = $('shrt-fcst-ticks');
        if (!ticksEl) return;
        ticksEl.innerHTML = '';
        if (!state.frames.length) return;
        var n = state.frames.length;
        var labelsAdded = {};
        var frag = document.createDocumentFragment();

        for (var i = 0; i < n; i++) {
            var f = state.frames[i];
            var m = /(\d+)\.(\d+)\.\(.\)\s+(\d{2}):(\d{2})/.exec(f.label);
            if (!m) continue;
            var hh = +m[3];
            var pct = (i / Math.max(1, n - 1)) * 100;
            var isMajor = (hh === 0 || hh === 12);

            var tick = document.createElement('div');
            tick.className = 'shrt-fcst-tick ' + (isMajor ? 'major' : 'minor');
            tick.style.left = pct + '%';
            frag.appendChild(tick);

            // 자정만 날짜 라벨 표시 (정오 "12시" 라벨은 제거 — 사용자 요구).
            // 정오엔 큰 tick 만 표시되어 시각적 reference 역할.
            if (isMajor && hh === 0) {
                var key = m[1] + '-' + m[2] + '-' + hh;
                if (!labelsAdded[key]) {
                    labelsAdded[key] = 1;
                    var label = document.createElement('div');
                    label.className = 'shrt-fcst-tick-label top';
                    label.style.left = pct + '%';
                    label.textContent = +m[1] + '/' + +m[2];
                    frag.appendChild(label);
                }
            }
        }
        ticksEl.appendChild(frag);
    }
    function hideSliderBar() {
        var bar = $('shrt-fcst-slider-bar');
        if (!bar) return;
        bar.style.display = 'none';
        bar.setAttribute('aria-hidden', 'true');
    }

    /**
     * [T3] 천기 스택의 시각적 점유 높이를 CSS 변수 `--shrt-stack-height` 로 publish.
     *
     * 무엇을 하나?
     *   천기 활성 시 화면 하단에 슬라이더 + 범례 두 요소가 절대 위치로 떠있다.
     *   이 둘 중 *가장 위에 있는 픽셀 좌표* (top) 부터 메인탭 바 위까지의 거리를 잰다.
     *   그 값만큼 `.warn-active-legend` (특보 범례) 가 위로 상승해 가려지지 않음.
     *
     * 왜 그냥 height 합산이 아니라 bounding rect 인가?
     *   카테고리형(sky/pty) 에서 슬라이더와 범례 사이에 갭이 있어 단순 합산은 underestimate.
     *   bounding rect 로 실제 화면상 점유 영역을 측정하면 정확하다.
     *
     * 언제 호출?
     *   - activate() 직후 — frames 로드 완료 후 requestAnimationFrame 으로 1tick 양보 후
     *   - 또는 외부에서 스택 갱신이 필요하면 직접 호출
     *
     * 천기 OFF 시 clearShrtStackHeight() 가 0px 로 reset → 특보 범례 원위치.
     */
    function updateShrtStackHeight() {
        var bar = $('shrt-fcst-slider-bar');
        var lg  = $('shrt-fcst-legend');
        var mainTabRaw = getComputedStyle(document.documentElement).getPropertyValue('--main-tab-height');
        var mainTabH = parseFloat(mainTabRaw) || 68;

        var topMost = window.innerHeight;     // 가장 위 (작은 y) 좌표 추적용
        var found = false;
        function track(el) {
            if (!el || el.style.display === 'none' || !el.offsetHeight) return;
            var rect = el.getBoundingClientRect();
            if (rect.top < topMost) topMost = rect.top;
            found = true;
        }
        track(bar);
        track(lg);

        var stackH = 0;
        if (found) {
            // 메인탭 바 위까지의 거리 = (viewport 높이 - main tab) - topMost
            var tabBarTop = window.innerHeight - mainTabH;
            stackH = Math.max(0, tabBarTop - topMost);
        }
        document.documentElement.style.setProperty('--shrt-stack-height', stackH + 'px');
    }
    function clearShrtStackHeight() {
        document.documentElement.style.setProperty('--shrt-stack-height', '0px');
    }

    // ─────────────────────────────────────────────────────────────
    // 활성화 / 비활성화
    // ─────────────────────────────────────────────────────────────

    /**
     * 천기 레이어 비활성화 — 모든 자원 정리 + UI 원복.
     *
     * 무엇을 정리?
     *   1) 재생 중이면 정지 (stopPlay)
     *   2) 지도 PNG 레이어 제거 (removeLayer)
     *   3) 슬라이더 바 / 범례 / 활성 서브버튼 표시 해제
     *   4) 말풍선 fade-out 클래스 제거
     *   5) state.activeType / frames / frameIdx 초기화
     *   6) [T3] CSS 변수 --shrt-stack-height 0px → 특보 범례 원위치 복귀
     *   7) [T2] 열린 클릭 팝업 닫기 (window._shrtForecastHidePointPopup 호출)
     *
     * 언제 호출?
     *   - 사용자가 활성 카테고리 버튼 다시 클릭 시 (토글 OFF)
     *   - 다른 카테고리로 전환 시 (activate 가 먼저 deactivate 호출)
     *   - 다른 ocean overlay 활성 시 (window._shrtForecastDeactivate 경유)
     *   - imgList 응답이 비었을 때 (안전 fallback)
     *
     * 연계: stopPlay, removeLayer, hideSliderBar, hideLegend, clearShrtStackHeight,
     *      window._shrtForecastHidePointPopup
     */
    function deactivate() {
        stopPlay();
        removeLayer();
        hideSliderBar();
        hideLegend();
        var items = document.querySelectorAll('.ocean-other-wx-item.active');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        // [P2] 천기 토글 버튼 active 클래스 제거 — 다른 버튼들과 동일한 패턴.
        //   특보구역(ocean_warn_zone.js)/CCTV(ocean_cctv.js)/특보 ON 버튼이
        //   .active 클래스로 시각적 ON 상태 표시하는 것과 일관성 유지.
        var toggleBtn = $('ocean-other-wx-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('active');
        // tooltip-suppressed 클래스 제거 (다음 카테고리형 활성 시 즉시 보이도록)
        var bar = $('shrt-fcst-slider-bar');
        if (bar) bar.classList.remove('tooltip-suppressed');
        state.activeType = null;
        state.frames = [];
        state.frameIdx = 0;
        // [T3] 천기 OFF → 특보 범례 위치 변수 초기화 (특보 범례가 원위치로 복귀)
        clearShrtStackHeight();
        // [T2] 클릭 팝업도 함께 닫기 (천기가 꺼지면 컨텍스트가 없어지므로).
        //   hidePointPopup 은 이 모듈 하단에 정의 → window 노출본 사용.
        if (typeof window._shrtForecastHidePointPopup === 'function') {
            window._shrtForecastHidePointPopup();
        }
    }

    /**
     * 천기 레이어 활성화 — 한 카테고리의 PNG/슬라이더/범례 + 클릭 팝업 인프라 가동.
     *
     * 무엇을 하나?
     *   1) 같은 카테고리 재클릭이면 deactivate (토글 OFF)
     *   2) 다른 카테고리면 deactivate 후 새로 시작
     *   3) [Mutual Exclusion] 유향유속/풍향풍속/파고파향 overlay 가 켜져있으면 끔
     *   4) 활성 서브버튼 표시 (.active 클래스)
     *   5) 정량형(pop/pcp/sno) 은 말풍선 처음 숨김, 카테고리형(sky/pty) 은 처음부터 보임
     *   6) imgList API 호출 → frame 배열 받아 슬라이더/범례/지도 PNG 표출
     *   7) 모든 frame PNG preload (백그라운드)
     *   8) [T3] requestAnimationFrame 으로 스택 높이 측정 → 특보 범례 위치 조정
     *
     * @param {string} shrtType - 'sky' | 'pty' | 'pop' | 'pcp' | 'sno'
     *
     * 연계:
     *   - window.oceanOverlayTurnOff (ocean_overlay.js)
     *   - fetchImgList → KMA imgList API
     *   - showSliderBar / renderLegend / showFrame / preloadImg / updateShrtStackHeight
     */
    function activate(shrtType) {
        if (state.activeType === shrtType) { deactivate(); return; }
        deactivate();

        // [사용량] 천기도 요소 버튼을 눌러 실제 활성화되는 분기에서만 +1 (재클릭 OFF 는 위에서 return)
        _trackShrtUsage(shrtType);

        // [Mutual Exclusion] 다른 ocean overlay (current/wind/wave) 가 활성 상태면 끔
        // ocean_overlay.js 가 export 한 turn-off 핸들러 사용.
        if (typeof window.oceanOverlayTurnOff === 'function') {
            try { window.oceanOverlayTurnOff(); } catch (e) {}
        }

        // [C-cache] 사용자가 의식적으로 천기 카테고리를 활성화 → 캐시 무효화 + 강제 새 fetch.
        //   사유: 평상시 5분 TTL 캐시가 있지만, 사용자가 KMA 점진 발표를 기다리거나
        //         stale 데이터 의심 시 OFF→ON 토글로 즉시 갱신을 원할 수 있음.
        //   동작: 해당 카테고리만 캐시/inflight 무효화. 다른 카테고리는 그대로
        //         (popup/바텀시트 sampling 에서 공유되므로 부분 무효화로 충분).
        delete _imgListCache[shrtType];
        delete _imgListInflight[shrtType];

        state.activeType = shrtType;

        var btn = document.querySelector('.ocean-other-wx-item[data-shrt="' + shrtType + '"]');
        if (btn) btn.classList.add('active');
        // [P2] 천기 토글 버튼도 active 표시 — 천기 레이어가 ON 상태임을 시각적으로 보여줌.
        //   서브버튼 popup 닫혀도 토글 버튼이 active 상태로 남아있어 사용자가
        //   "천기 켜져있구나" 인지 가능 (다른 버튼과 동일 패턴).
        var toggleBtn = $('ocean-other-wx-toggle-btn');
        if (toggleBtn) toggleBtn.classList.add('active');

        // [말풍선 노출 정책]
        // - 카테고리형(sky/pty): 항상 표출 (현재처럼)
        // - 정량형(pop/pcp/sno): 처음엔 숨김, 재생 시작 시 표출, 정지 시 1초 fade-out
        var bar = $('shrt-fcst-slider-bar');
        var def = LEGEND_DEF[shrtType];
        if (bar && def && def.style === 'gradient') {
            bar.classList.add('tooltip-suppressed');
        } else if (bar) {
            bar.classList.remove('tooltip-suppressed');
        }

        // [P3 — 즉시 로딩 UI]
        //   imgList 응답 전이라도 슬라이더 바와 범례 영역을 미리 띄워 사용자에게
        //   "로딩 중" 시각 피드백 제공. 응답 후 정상 데이터로 자연스럽게 전환.
        //   슬라이더는 max=0 으로 비활성 — 사용자 input 무시.
        showSliderBar(0);
        renderLegendLoading(shrtType);
        requestAnimationFrame(updateShrtStackHeight);

        fetchImgList(shrtType).then(function (frames) {
            if (state.activeType !== shrtType) return;
            if (!frames.length) {
                console.warn('[shrt] no frames for', shrtType);
                deactivate();
                return;
            }
            state.frames = frames;
            state.frameIdx = 0;
            showSliderBar(frames.length);
            renderLegend(shrtType);
            showFrame(0);
            for (var i = 0; i < frames.length; i++) preloadImg(frames[i].url);
            // [T3] DOM 이 그려진 직후 (microtask) 스택 높이 측정 → CSS 변수 반영.
            requestAnimationFrame(updateShrtStackHeight);
        }).catch(function (e) {
            console.error('[shrt] activate failed:', e);
            // 에러 시: 로딩 메시지를 에러로 교체
            renderLegendError(shrtType, '기상청 단기예보 데이터를 일시적으로 불러올 수 없습니다.');
            // 슬라이더는 그대로 두고 사용자가 다른 카테고리 선택하거나 토글 OFF 할 수 있게.
        });
    }

    // ─────────────────────────────────────────────────────────────
    // UI 바인딩
    // ─────────────────────────────────────────────────────────────

    /**
     * UI 이벤트 바인딩 — 페이지 로드 시 1번만 호출 (initShrtForecastLayer 에서).
     *
     * 무엇을 바인딩?
     *   1) 우측 컨트롤 "천기" 토글 버튼 click — 잠금 해제 패턴 (10회 연속 클릭) 또는
     *      잠금 해제 후엔 5개 서브버튼 popup 토글.
     *   2) document click — popup 영역 외부 클릭 시 popup 자동 닫힘.
     *   3) 5개 서브버튼 (.ocean-other-wx-item) click — activate(shrtType) 호출.
     *   4) 슬라이더 input — 드래그 중 헤더만 갱신 + 200ms debounce sample.
     *   5) 슬라이더 change — 손 놓은 시점에 sample 1번 (debounce 해제 후 즉시).
     *   6) 재생 버튼 click — togglePlay (재생 ↔ 정지 전환).
     *
     * 연계: ENABLED_TYPES, activate/deactivate, stopPlay/togglePlay, refreshPopupContents.
     */
    function bindUi() {
        var wrap = $('ocean-other-wx-wrap');
        var toggleBtn = $('ocean-other-wx-toggle-btn');
        var popup = $('ocean-other-wx-popup');
        if (!wrap || !toggleBtn || !popup) return;

        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            // [잠금 패턴 폐지 — 사용자 요구] 바로 popup 토글.
            var willOpen = !wrap.classList.contains('popup-open');
            wrap.classList.toggle('popup-open');
            popup.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
            // [P3] popup 이 새로 열리는 시점에만 prefetch (이미 열려있다 닫는 경우 제외)
            if (willOpen) prefetchAllImgLists();
        });

        document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) {
                wrap.classList.remove('popup-open');
                popup.setAttribute('aria-hidden', 'true');
            }
        });

        var items = popup.querySelectorAll('.ocean-other-wx-item');
        items.forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                var t = item.getAttribute('data-shrt');
                wrap.classList.remove('popup-open');
                popup.setAttribute('aria-hidden', 'true');
                if (!ENABLED_TYPES[t]) return;
                activate(t);
            });
        });

        var slider = $('shrt-fcst-slider');
        if (slider) {
            // [드래그 debounce + 말풍선 표시 — 사용자 요구]
            //   드래그 중:
            //     - 본문 sample 안 함 (네트워크/CPU 절약, 헤더 시각만 갱신)
            //     - 말풍선은 강제 표시 (사용자가 어느 시간으로 가는지 알 수 있도록)
            //   손 놓은 후 (debounce 200ms 또는 'change' 이벤트):
            //     - 그 위치 1번 sample
            //     - 정량형이고 재생 중 아니면 1초 fade-out 다시 적용
            //
            // [드래그 + 말풍선 표시 — 사용자 요구]
            //   드래그 중 (손/마우스 잡고 있는 동안):
            //     - 본문 sample 안 함 (네트워크/CPU 절약, 헤더 시각만 갱신)
            //     - 말풍선은 항상 표시 (시각 정보 보이게)
            //   손 놓은 시점:
            //     - 마지막 위치 1번 sample
            //     - 정량형이고 재생 중 아니면 1초 fade-out 다시 적용
            //
            // [pointerdown/up 으로 드래그 상태 명시 추적]
            //   이전엔 input 핸들러의 200ms debounce 안에서 _restoreTooltipPolicy 호출 →
            //   사용자가 잡고 가만히 있으면 200ms 후 말풍선 사라지는 버그.
            //   pointerdown/up 으로 명확히 추적하여 손 떼는 순간만 정책 복원.
            //
            // 이벤트 흐름:
            //   - pointerdown: _inDrag = true, 말풍선 강제 표시
            //   - input (드래그 도중 매번): _inDrag 면 헤더/지도만 갱신, sample skip
            //                              _inDrag 아니면 (예: 키보드 조작) 즉시 sample
            //   - pointerup: _inDrag = false, sample 1번 + 정책 복원
            //   - pointercancel: 안전망 — 정책 복원
            //   - change (fallback): pointer 이벤트 안 발화 시 sample + 복원
            var _dragSampleTimer = null;
            var _inDrag = false;

            /**
             * 드래그 종료 후 말풍선 정책 복원 — 정량형이고 재생 중 아니면 fade-out.
             * 카테고리형(sky/pty)은 항상 표시 정책이라 무영향.
             */
            function _restoreTooltipPolicy() {
                var bar = $('shrt-fcst-slider-bar');
                if (!bar) return;
                if (state.playing) return;   // 재생 중이면 그대로 표시
                var def = state.activeType ? LEGEND_DEF[state.activeType] : null;
                if (def && def.style === 'gradient') {
                    bar.classList.add('tooltip-suppressed');
                }
            }

            /** 드래그 종료 처리 — sample 1번 + 정책 복원 + idle timer 정리. */
            function _onDragEnd() {
                _inDrag = false;
                clearTimeout(_dragSampleTimer);
                if (popupState.box && popupState.latLon) refreshPopupContents();
                _restoreTooltipPolicy();
            }

            slider.addEventListener('pointerdown', function () {
                _inDrag = true;
                stopPlay();
                // 드래그 시작 → 말풍선 강제 표시 (재생 fade-out 정책 일시 무력화)
                var bar = $('shrt-fcst-slider-bar');
                if (bar) bar.classList.remove('tooltip-suppressed');
            });
            slider.addEventListener('pointerup',     _onDragEnd);
            slider.addEventListener('pointercancel', _onDragEnd);

            slider.addEventListener('input', function () {
                stopPlay();
                var bar = $('shrt-fcst-slider-bar');
                if (bar) bar.classList.remove('tooltip-suppressed');
                var idx = parseInt(slider.value, 10) || 0;
                showFrame(idx, true);   // skipSample=true → 본문은 정지, 헤더/지도만 갱신
                if (!_inDrag) {
                    // 키보드 등 pointer 외 조작 — 즉시 sample (드래그 아님)
                    clearTimeout(_dragSampleTimer);
                    _dragSampleTimer = setTimeout(function () {
                        if (popupState.box && popupState.latLon) refreshPopupContents();
                        _restoreTooltipPolicy();
                    }, 200);
                }
                // _inDrag 인 동안엔 idle 타이머 동작 안 함 — pointerup 까지 대기
            });
            // 안전망: pointer 이벤트 미지원 환경 또는 pointerup 누락 시 change 가 마무리.
            slider.addEventListener('change', function () {
                if (_inDrag) return;   // pointerup 이 처리한 경우는 skip
                clearTimeout(_dragSampleTimer);
                if (popupState.box && popupState.latLon) refreshPopupContents();
                _restoreTooltipPolicy();
            });
        }
        var playBtn = $('shrt-fcst-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!state.frames.length) return;
                togglePlay();
            });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // [T2] 클릭 팝업 — 클라이언트 PNG 샘플링 방식 (서버 메모리 부담 0)
    //
    //   [철학]   해상일기도와 동일 — 브라우저가 직접 KMA PNG 를 다운로드 + 픽셀 추출.
    //            서버는 단순 CORS 프록시 (/api/kma-png-proxy) 만 제공.
    //
    //   [트리거] 천기 레이어 활성 상태 + 지도 클릭 → handleMapClick 가 우리 가드 호출.
    //
    //   [동작 흐름]
    //     1) 클릭 좌표 → KMA extent 안인지 확인 (밖이면 우리 처리 X)
    //     2) 그 좌표를 PNG 픽셀 좌표 (959 × 1186) 로 변환
    //     3) 활성 frame 의 5개 카테고리 PNG URL 을 imgList 캐시에서 lookup
    //     4) 5장 모두 <img crossOrigin="anonymous"> 로 동시 로드
    //        (브라우저 HTTP 캐시 적중 시 즉답 — Cache-Control: max-age=3600)
    //     5) 각 이미지의 클릭 좌표 주변 3x3 영역을 캔버스에 그려 픽셀 추출 (mode-filter)
    //     6) 픽셀 RGB 를 색상 팔레트와 매칭 → 단계 값 / 카테고리 라벨 결정
    //     7) 종합해서 박스 본문 표시
    //
    //   [성능]
    //     - 캔버스: 3 × 3 전용 (이미지 전체 그리기 대신 source-crop 으로 9픽셀만 복사)
    //     - 메모리: 캔버스 36 byte, 이미지 5장은 브라우저가 자체 관리
    //     - CPU: drawImage(3x3 crop) ≈ 1 ms × 5 = 5 ms (현대폰 기준)
    //
    //   [캐시]
    //     - imgList 응답 (URL 매핑): 5분 TTL, 카테고리별 메모리 캐시
    //     - PNG 자체: 브라우저 HTTP 캐시 (1시간) — 우리가 별도 캐시 안 씀
    //
    //   [재생 동기]
    //     - 슬라이더 ▶ 재생 시 매 frame 마다 sample 재호출.
    //     - 0.5 초 / frame 이지만 데이터 (5 PNG 로드 + 샘플링) 가 끝나야 다음 frame 진행.
    //     - 캐시 적중 시 ~5–50 ms → 0.5 초 간격 그대로 유지.
    //     - 캐시 미스 시 ~500 ms 다운로드 → 자연스럽게 1초 간격으로 늘어남.
    //
    //   [드래그]
    //     - 슬라이더 input 이벤트 (드래그 중) 에는 sample 안 함, 헤더 시각만 갱신.
    //     - 손 놓은 시점 (change 이벤트 또는 input 후 짧은 idle) 에 1번 sample.
    //
    //   [닫기] 외부 클릭 / X 버튼 / 천기 레이어 OFF / 카테고리 변경.
    // ─────────────────────────────────────────────────────────────

    // ── 색상 팔레트 (서버 services/shrt_fcst_point.js 의 팔레트와 1:1 동일) ──
    // 각 정량형 카테고리의 단계별 RGB 와 임계값 매핑 — 픽셀 RGB 와 가장 가까운 단계
    // 를 찾아 그 임계값을 반환하기 위함.
    var POP_THRESHOLDS = [0,4,8,12,16,20,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88,92,96];
    var PCP_THRESHOLDS = [0,0.2,0.4,0.6,0.8,1,1.5,2,3,4,5,6,7,8,9,10,14,18,22,26,30,40,50,60,70,80,160,320,480,640];
    var SNO_THRESHOLDS = [0.1,0.2,0.4,0.6,0.8,1,1.5,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80];

    function _hex2rgb(h) {
        var v = parseInt(h.replace('#',''), 16);
        return [(v>>16)&0xff, (v>>8)&0xff, v&0xff];
    }
    var _POP_RGB = POP_COLORS.map(_hex2rgb);
    var _PCP_RGB = PCP_COLORS.map(_hex2rgb);
    var _SNO_RGB = SNO_COLORS.map(_hex2rgb);
    var _TMP_RGB = TMP_COLORS.map(_hex2rgb);   // 60단계 기온 RGB (월 무관, 색상은 인덱스 기준)

    // 카테고리형 (sky/pty) 팔레트 — 라벨과 매칭 (rgba 의 rgb 부분만 사용).
    var _SKY_PALETTE = [
        { rgb: [255, 255, 255], label: '맑음' },
        { rgb: [174, 200, 224], label: '구름많음' },
        { rgb: [56,  120, 152], label: '흐림' }
    ];
    var _PTY_PALETTE = [
        { rgb: [0x60, 0xd4, 0x7e], label: '비' },
        { rgb: [0x3d, 0xc4, 0xe6], label: '비/눈' },
        { rgb: [0x8e, 0x8e, 0xe6], label: '눈' }
    ];

    // ── imgList 캐시는 모듈 상단 _getImgListEntry() 와 통합 (단계 3 작업) ──
    //   더 이상 별도 _fetchImgListFor 없음. _samplePointForType 가 _getImgListEntry 직접 호출.

    // ── 이미지 로더 캐시 (LRU) ──
    //   같은 URL 의 PNG 를 두 번 다운로드 안 함. 브라우저 HTTP 캐시도 있지만 거기까지
    //   가지 않고 우리 메모리에서 HTMLImageElement 를 재사용하면 더 빠름.
    //
    //   [메모리 안전 — 중요]
    //     무한히 캐시하면 슬라이더 재생 시 모든 frame 의 PNG (5MB × 200) 가 메모리에
    //     남아 모바일 폰 OOM. Map 의 insert-order 를 활용한 LRU 로 캡 둠.
    //     20 entry × ~5MB ≈ 100MB 상한 (모바일 폰에서 안전 범위).
    //     evict 시 가장 오래된 (앞에 추가된) entry 의 Promise 참조만 끊음 → GC 대상.
    //
    //   [재방문 시 빠르게]
    //     같은 key 재요청 시 delete + set 으로 Map 끝으로 이동 (LRU 'touch').
    //     자주 쓰이는 PNG 는 evict 안 됨.
    var _imgElemCache = new Map();
    var IMG_CACHE_MAX = 20;
    function _loadImgViaProxy(kmaPath) {
        // 캐시 적중 — Map 끝으로 이동 (LRU touch)
        if (_imgElemCache.has(kmaPath)) {
            var existing = _imgElemCache.get(kmaPath);
            _imgElemCache.delete(kmaPath);
            _imgElemCache.set(kmaPath, existing);
            return existing;
        }
        // path 만 query 로 보내면 서버 라우트가 marine.kma.go.kr 에 fetch + CORS 헤더 부착
        var proxyUrl = '/api/kma-png-proxy?path=' + encodeURIComponent(kmaPath);
        var p = new Promise(function (resolve, reject) {
            var img = new Image();
            img.crossOrigin = 'anonymous';   // canvas getImageData 가능하도록 CORS 모드
            img.onload = function () { resolve(img); };
            img.onerror = function () {
                _imgElemCache.delete(kmaPath);   // 실패 시 다음에 재시도 가능
                reject(new Error('img load fail: ' + kmaPath));
            };
            img.src = proxyUrl;
        });
        _imgElemCache.set(kmaPath, p);
        // LRU 한도 초과 시 가장 오래된 entry 제거
        if (_imgElemCache.size > IMG_CACHE_MAX) {
            var oldestKey = _imgElemCache.keys().next().value;
            _imgElemCache.delete(oldestKey);
        }
        return p;
    }

    // ── 작은 캔버스 (3 × 3) ──
    //   매 sampling 마다 새 캔버스 만들지 않고 재사용. 3 × 3 만 그려도 되므로 작음.
    var _sampleCanvas = null, _sampleCtx = null;
    function _getSampleCtx() {
        if (!_sampleCanvas) {
            _sampleCanvas = document.createElement('canvas');
            _sampleCanvas.width = 3;
            _sampleCanvas.height = 3;
            _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
        }
        return _sampleCtx;
    }

    /**
     * 이미지의 (x, y) 주변 3 × 3 영역에서 픽셀 색을 추출.
     * α=0 픽셀은 무시. 알파>0 픽셀들 중 가장 빈도 높은 RGB 를 채택 (anti-aliasing 완화).
     * 반환: { r, g, b, a }  또는  null (모두 α=0 인 영역)
     */
    function _sampleImgArea(img, cx, cy) {
        var ctx = _getSampleCtx();
        ctx.clearRect(0, 0, 3, 3);
        // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — img 의 (cx-1, cy-1, 3, 3) 영역만
        // 캔버스 (0, 0, 3, 3) 으로 복사. 이미지 전체 그리기보다 훨씬 빠름.
        try {
            ctx.drawImage(img, cx - 1, cy - 1, 3, 3, 0, 0, 3, 3);
        } catch (e) {
            return null;   // tainted canvas 등의 보안 에러
        }
        var data = ctx.getImageData(0, 0, 3, 3).data;   // 9 픽셀 × 4 byte = 36 byte
        var counts = {}, alphaSum = 0, alphaCnt = 0;
        for (var i = 0; i < 9; i++) {
            var off = i * 4;
            var a = data[off + 3];
            if (a === 0) continue;
            var r = data[off], g = data[off + 1], b = data[off + 2];
            var key = r + ',' + g + ',' + b;
            counts[key] = (counts[key] || 0) + 1;
            alphaSum += a; alphaCnt++;
        }
        if (alphaCnt === 0) return null;
        var bestKey = '0,0,0', bestN = -1;
        for (var k in counts) if (counts[k] > bestN) { bestN = counts[k]; bestKey = k; }
        var parts = bestKey.split(',');
        return { r: +parts[0], g: +parts[1], b: +parts[2], a: Math.round(alphaSum / alphaCnt) };
    }

    /** RGB → 가장 가까운 팔레트 색상 인덱스 (유클리드 거리). 거리 너무 크면 -1 (매칭 실패). */
    function _matchRgb(r, g, b, paletteRgb, maxDist) {
        var bestI = -1, bestD = Infinity;
        for (var i = 0; i < paletteRgb.length; i++) {
            var p = paletteRgb[i];
            var d = (r - p[0])*(r - p[0]) + (g - p[1])*(g - p[1]) + (b - p[2])*(b - p[2]);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        var thr = (maxDist || 60); thr = thr * thr;
        if (bestD > thr) return -1;
        return bestI;
    }

    /** lon/lat → PNG 픽셀 좌표 (extent 안에 있을 때만 반환). */
    function _lonLatToPx(lon, lat, w, h) {
        var EX = DFS_EXTENT_4326;   // [lonMin, latMin, lonMax, latMax]
        if (lon < EX[0] || lon > EX[2] || lat < EX[1] || lat > EX[3]) return null;
        var x = Math.round((lon - EX[0]) / (EX[2] - EX[0]) * (w - 1));
        var y = Math.round((EX[3] - lat) / (EX[3] - EX[1]) * (h - 1));
        if (x < 0 || x >= w || y < 0 || y >= h) return null;
        return { x: x, y: y };
    }

    /**
     * 한 카테고리의 점 데이터 추출 — imgList 캐시 → 이미지 로드 → 픽셀 sampling → 매칭.
     * @returns {Promise<Object>} 정량형: { value, rgb, alpha, bandIdx } 또는 { value: null, reason }
     *                             카테고리형: { label, rgb } 또는 { label: null, reason }
     */
    /**
     * "YYYY.MM.DD HH:mm" 형식의 KMA fct_tm 문자열을 epoch ms 로 변환.
     * 매칭 실패 시 null. (정시 외 다른 단위가 들어올 수도 있어 robust 하게 분/초까지 파싱.)
     */
    function _parseFctTmMs(s) {
        if (!s) return null;
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    }

    /**
     * imgList.frames 배열에서 targetFctTm 과 시간 차가 가장 작은 frame 을 찾되,
     * 차이가 maxDeltaMs 를 넘으면 null 반환 (너무 멀어 부정확).
     *
     * 왜 필요한가?
     *   사용자(또는 바텀시트) 가 요청한 fctTm 이 imgList 에 정확히 없을 때 —
     *   예: 현재시각 20:18 → round("20:00") 인데 KMA 는 21:00 부터만 제공.
     *   이런 경우 가장 가까운 frame 의 데이터로 fallback.
     *
     *   maxDeltaMs 제한은 너무 먼 시각 (예: imgList 끝 + 24시간) 을 매핑해서
     *   사용자에게 잘못된 데이터를 보여주는 것을 방지.
     */
    function _findNearestFrame(frames, targetFctTm, maxDeltaMs) {
        if (!frames || !frames.length) return null;
        var t = _parseFctTmMs(targetFctTm);
        if (t == null) return null;
        var best = null, bestDelta = Infinity;
        for (var i = 0; i < frames.length; i++) {
            var ft = _parseFctTmMs(frames[i].fct_tm);
            if (ft == null) continue;
            var d = Math.abs(ft - t);
            if (d < bestDelta) { best = frames[i]; bestDelta = d; }
        }
        if (bestDelta > maxDeltaMs) return null;
        return best;
    }

    /**
     * 가까운 frame fallback 의 거리 한도 — 90 분.
     * 근거:
     *   KMA 단기예보는 1시간 단위 frame. 현재시각이 발표 직후 갭에 있어도 보통 60분 안.
     *   90분 제한 = 1.5 frame 거리 — 자연스러운 가까운 fallback.
     *   이보다 멀면 사용자가 의도적으로 먼 시각을 본 것 → 데이터 없음 표시가 옳음.
     */
    var FCTTM_FALLBACK_MAX_DELTA_MS = 90 * 60 * 1000;

    function _samplePointForType(shrtType, fctTm, lon, lat) {
        return _getImgListEntry(shrtType).then(function (list) {
            var imgPath = list.fctMap[fctTm];
            // [A-fctTm fallback] 정확 매칭 실패 시 가장 가까운 frame 으로 (90분 안에서)
            //   사유: KMA imgList 는 미래 frame 만 제공. 현재시각 20:18 round → 20:00 인데
            //         imgList 첫 frame 이 21:00 이면 정확 매칭 실패. 21:00 데이터를 fallback.
            //         거리 90분 초과는 사용자 의도적 먼 시각 → null 반환 (카드 hide).
            if (!imgPath) {
                var nearest = _findNearestFrame(list.frames, fctTm, FCTTM_FALLBACK_MAX_DELTA_MS);
                if (nearest) imgPath = nearest.url;
            }
            if (!imgPath) return { value: null, label: null, reason: 'no_url' };
            return _loadImgViaProxy(imgPath).then(function (img) {
                var px = _lonLatToPx(lon, lat, img.naturalWidth, img.naturalHeight);
                if (!px) return { value: null, label: null, reason: 'out_of_extent' };
                var s = _sampleImgArea(img, px.x, px.y);
                if (!s) return { value: null, label: null, reason: 'no_data' };
                if (shrtType === 'sky') {
                    var skyIdx = _matchRgb(s.r, s.g, s.b, _SKY_PALETTE.map(function(p){return p.rgb;}), 80);
                    return (skyIdx < 0) ? { label: null, reason: 'palette_mismatch', rgb: [s.r,s.g,s.b] }
                                        : { label: _SKY_PALETTE[skyIdx].label, rgb: [s.r,s.g,s.b] };
                }
                if (shrtType === 'pty') {
                    var ptyIdx = _matchRgb(s.r, s.g, s.b, _PTY_PALETTE.map(function(p){return p.rgb;}), 80);
                    return (ptyIdx < 0) ? { label: null, reason: 'palette_mismatch', rgb: [s.r,s.g,s.b] }
                                        : { label: _PTY_PALETTE[ptyIdx].label, rgb: [s.r,s.g,s.b] };
                }
                // 정량형 (pop/pcp/sno/tmp)
                //   tmp 는 임계값이 월별 동적 — _getTmpThresholds() 호출. 색상 팔레트는 고정.
                var pal, thr;
                if      (shrtType === 'pop') { pal = _POP_RGB; thr = POP_THRESHOLDS; }
                else if (shrtType === 'pcp') { pal = _PCP_RGB; thr = PCP_THRESHOLDS; }
                else if (shrtType === 'sno') { pal = _SNO_RGB; thr = SNO_THRESHOLDS; }
                else /* tmp */               { pal = _TMP_RGB; thr = _getTmpThresholds(); }
                var idx = _matchRgb(s.r, s.g, s.b, pal);
                if (idx < 0) return { value: null, reason: 'palette_mismatch', rgb: [s.r,s.g,s.b] };
                return { value: thr[idx], rgb: [s.r,s.g,s.b], alpha: s.a, bandIdx: idx };
            });
        });
    }

    /** 6개 카테고리 동시 sampling — Promise.all 로 병렬. 실패한 카테고리는 null. */
    function samplePointAt(lat, lon, fctTm) {
        var types = ['sky','pty','pop','pcp','sno','tmp'];
        return Promise.all(types.map(function (t) {
            return _samplePointForType(t, fctTm, lon, lat).catch(function () { return null; });
        })).then(function (arr) {
            return { fct_tm: fctTm, lat: lat, lon: lon,
                     sky: arr[0], pty: arr[1], pop: arr[2], pcp: arr[3], sno: arr[4], tmp: arr[5] };
        });
    }

    /**
     * [외부 노출] 바텀시트 천기 카드 등 다른 모듈이 점데이터 sampling 사용하도록.
     * 동일한 캐시 (imgList + image cache) 활용 → 천기 popup 과 시너지.
     */
    window._shrtForecastSamplePointAt = samplePointAt;
    /** [외부 노출] 임의 시각 → KMA 가장 가까운 정시 frame 의 fct_tm 문자열. */
    window._shrtForecastNearestFctTm = function (date) {
        var d = new Date(date);
        if (isNaN(d.getTime())) d = new Date();
        // 30분 이상이면 다음 정시로 올림, 미만이면 내림 (가장 가까운 정시)
        if (d.getMinutes() >= 30) d.setHours(d.getHours() + 1);
        d.setMinutes(0, 0, 0);
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate())
             + ' ' + pad(d.getHours()) + ':00';
    };
    /**
     * [외부 노출] imgList 캐시 + inflight Promise 전체 무효화 (6 카테고리 모두).
     * 다음 sample 호출 시 KMA 에 새 fetch.
     *
     * 호출자: 바텀시트 천기 카드 (해점 클릭/날짜 nav 시 forceRefresh).
     *         사용자 의도적 갱신 시 stale 캐시 우회 — KMA 점진 발표 진행 즉시 반영.
     */
    window._shrtForecastInvalidateImgListCache = function () {
        var keys = Object.keys(_imgListCache);
        for (var i = 0; i < keys.length; i++) delete _imgListCache[keys[i]];
        keys = Object.keys(_imgListInflight);
        for (var j = 0; j < keys.length; j++) delete _imgListInflight[keys[j]];
    };

    var popupState = {
        box: null,
        latLon: null,
        pixelXY: null,
        lastFctTm: null,
        currentFetchToken: 0,    // 동시성 제어 — frame 빠르게 변경 시 오래된 응답 무시
        outsideClickHandler: null
    };

    /** 한국어 요일 + 시간 포맷팅: "5월 3일 (월) 14:00" 형태 */
    function fmtPopupTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일','월','화','수','목','금','토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '월 ' + (+m[3]) + '일 (' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

    /**
     * 작은 숫자 포맷 헬퍼 — 0 이면 '0', 그 외엔 소수점 1자리.
     * 예) 0 → '0', 0.5 → '0.5', 4 → '4', 12.34 → '12.3'
     */
    function _fmtNum(v) {
        if (v == null) return '';
        if (v === 0) return '0';
        return String(Math.round(v * 10) / 10);
    }

    /**
     * "강수량" 라인의 본문 문자열 빌드 — 8가지 데이터 유무 조합 처리.
     *
     * [입력]
     *   pty: { label: '비'|'비/눈'|'눈' }  또는 null  (강수형태)
     *   pcp: { value: number }              또는 null  (강수량 mm)
     *   pop: { value: number }              또는 null  (강수확률 %)
     *
     * [출력 케이스]
     *   pty ✓ pcp ✓ pop ✓ → "비 0.5mm (60%)"
     *   pty ✓ pcp ✓ pop ✗ → "비 0.5mm"
     *   pty ✓ pcp ✗ pop ✓ → "비 (60%)"
     *   pty ✓ pcp ✗ pop ✗ → "비"
     *   pty ✗ pcp ✓ pop ✓ → "강수 0.5mm (60%)"
     *   pty ✗ pcp ✓ pop ✗ → "강수 0.5mm"
     *   pty ✗ pcp ✗ pop ✓ → "강수확률 60%"
     *   pty ✗ pcp ✗ pop ✗ → "강수 정보 없음"
     *
     * [의도]
     *   사용자가 "0%" 와 "데이터 없음" 을 명확히 구분할 수 있도록.
     *   기존 코드는 모두 null 일 때 "없음 0mm (0%)" 식으로 어색.
     */
    function _buildRainText(pty, pcp, pop) {
        var hasPty = !!(pty && pty.label);
        var hasPcp = !!(pcp && pcp.value != null);
        var hasPop = !!(pop && pop.value != null);
        var ptyText = hasPty ? pty.label : '강수';
        var pcpText = hasPcp ? (_fmtNum(pcp.value) + 'mm') : null;
        var popText = hasPop ? (pop.value + '%') : null;

        // 8가지 케이스 (pty 기준 분기)
        if (hasPty) {
            // 비/눈/비눈 정보 있음
            if (hasPcp && hasPop)  return ptyText + ' ' + pcpText + ' (' + pop.value + '%)';
            if (hasPcp && !hasPop) return ptyText + ' ' + pcpText;
            if (!hasPcp && hasPop) return ptyText + ' (' + pop.value + '%)';
            return ptyText;   // pty 만 있음
        }
        // pty 없음 — "강수" 일반 표현
        if (hasPcp && hasPop)  return '강수 ' + pcpText + ' (' + pop.value + '%)';
        if (hasPcp && !hasPop) return '강수 ' + pcpText;
        if (!hasPcp && hasPop) return '강수확률 ' + pop.value + '%';
        return '강수 정보 없음';
    }

    /**
     * 박스 본문 HTML 빌드 — 6개 카테고리 종합 (사용자 명세).
     *
     * 라인 구성:
     *   · 하늘 상태 : sky.label  ('맑음'/'구름많음'/'흐림') or '정보 없음'
     *   · 강수량   : _buildRainText(pty, pcp, pop) — 8 케이스 분기
     *   · 적설     : sno.value cm or '예보 없음'
     *   · 기온     : tmp.value °C or '정보 없음'
     *
     * [데이터 없음 표현]
     *   - 하늘 상태/기온: '정보 없음'
     *   - 적설: '예보 없음' (사용자 명세 — 적설은 보통 봄/여름 데이터 없음이 정상)
     */
    function buildPopupBodyHtml(data) {
        var skyLabel = (data.sky && data.sky.label) || '정보 없음';
        var rainStr  = _buildRainText(data.pty, data.pcp, data.pop);
        var snoStr;
        if (data.sno && data.sno.value != null) {
            snoStr = _fmtNum(data.sno.value) + 'cm';
        } else {
            snoStr = '예보 없음';
        }
        // 기온 — tmp.value 가 있으면 °C 부착, 없으면 '정보 없음'
        var tmpStr;
        if (data.tmp && data.tmp.value != null) {
            tmpStr = _fmtNum(data.tmp.value) + '°C';
        } else {
            tmpStr = '정보 없음';
        }
        return '<div class="shrt-fcst-point-row">'
            +    '<span class="shrt-fcst-point-row-label">하늘 상태</span>'
            +    '<span class="shrt-fcst-point-row-value">' + skyLabel + '</span>'
            +  '</div>'
            +  '<div class="shrt-fcst-point-row">'
            +    '<span class="shrt-fcst-point-row-label">강수량</span>'
            +    '<span class="shrt-fcst-point-row-value">' + rainStr + '</span>'
            +  '</div>'
            +  '<div class="shrt-fcst-point-row">'
            +    '<span class="shrt-fcst-point-row-label">적설</span>'
            +    '<span class="shrt-fcst-point-row-value">' + snoStr + '</span>'
            +  '</div>'
            +  '<div class="shrt-fcst-point-row">'
            +    '<span class="shrt-fcst-point-row-label">기온</span>'
            +    '<span class="shrt-fcst-point-row-value">' + tmpStr + '</span>'
            +  '</div>';
    }

    /** 박스 DOM 생성 + 외부클릭 핸들러 등록. */
    function ensurePopupBox() {
        if (popupState.box) return popupState.box;
        var box = document.createElement('div');
        box.className = 'shrt-fcst-point-box';
        box.innerHTML = ''
            + '<div class="shrt-fcst-point-box-header">'
            +   '<span class="shrt-fcst-point-box-title">불러오는 중…</span>'
            +   '<button type="button" class="shrt-fcst-point-box-close" aria-label="닫기">&times;</button>'
            + '</div>'
            + '<div class="shrt-fcst-point-box-body">'
            +   '<div class="shrt-fcst-point-loading">데이터를 불러오는 중입니다…</div>'
            + '</div>';
        document.body.appendChild(box);
        popupState.box = box;
        var closeBtn = box.querySelector('.shrt-fcst-point-box-close');
        if (closeBtn) closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            hidePointPopup();
        });
        // 외부 클릭 닫기 — 박스 안 / 지도 안 클릭은 무시 (handleMapClick 가 이동 처리)
        popupState.outsideClickHandler = function (e) {
            if (!popupState.box) return;
            if (popupState.box.contains(e.target)) return;
            var mapEl = document.getElementById('ocean-map');
            if (mapEl && mapEl.contains(e.target)) return;
            hidePointPopup();
        };
        document.addEventListener('click', popupState.outsideClickHandler);
        return box;
    }

    function positionPopupBox(box, mapPixelXY) {
        var mapEl = document.getElementById('ocean-map');
        var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var pageX = rect.left + (mapPixelXY[0] || 0);
        var pageY = rect.top  + (mapPixelXY[1] || 0);
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var left = pageX + 12, top = pageY + 12;
        if (left + bw + 12 > vw) left = pageX - bw - 12;
        if (top + bh + 12 > vh)  top  = pageY - bh - 12;
        if (left < 8) left = 8;
        if (top < 8)  top  = 8;
        box.style.left = left + 'px';
        box.style.top  = top + 'px';
    }

    /**
     * 박스 내용 갱신 — 클라이언트가 직접 5 PNG sample 후 본문 빌드.
     *
     * @param {boolean} headerOnly - true 면 헤더 시각만 갱신 (드래그 중 사용)
     * @returns {Promise<void>} 데이터 로드+sampling 완료 시 resolve. 슬라이더 재생 동기화에 사용.
     */
    function refreshPopupContents(headerOnly) {
        if (!popupState.box || !popupState.latLon) return Promise.resolve();
        var frame = state.frames[state.frameIdx];
        if (!frame) return Promise.resolve();
        var fctTm = frame.fct_tm || frame.label;
        var box = popupState.box;
        var titleEl = box.querySelector('.shrt-fcst-point-box-title');
        var bodyEl  = box.querySelector('.shrt-fcst-point-box-body');
        if (titleEl) titleEl.textContent = fmtPopupTm(fctTm);
        if (headerOnly) return Promise.resolve();   // 드래그 중: 본문 그대로

        // 동시성 제어 — frame 이 빠르게 바뀔 때 오래된 응답이 새 데이터를 덮지 않도록
        var token = ++popupState.currentFetchToken;
        popupState.lastFctTm = fctTm;
        var lat = popupState.latLon[0], lon = popupState.latLon[1];

        return samplePointAt(lat, lon, fctTm)
            .then(function (data) {
                if (!popupState.box || token !== popupState.currentFetchToken) return;
                if (bodyEl) bodyEl.innerHTML = buildPopupBodyHtml(data);
            })
            .catch(function (e) {
                if (!popupState.box || token !== popupState.currentFetchToken) return;
                if (bodyEl) bodyEl.innerHTML = '<div class="shrt-fcst-point-loading">데이터 오류: '
                    + (e && e.message ? e.message : '알 수 없음') + '</div>';
            });
    }

    /**
     * 외부 진입점 — handleMapClick 에서 호출.
     * 천기 활성 + KMA extent 안이면 박스 띄우고 true 반환 (클릭 소비).
     */
    window._shrtForecastTryHandleClick = function (map, evt) {
        if (!state.activeType) return false;
        if (!state.frames || !state.frames.length) return false;
        if (typeof ol === 'undefined' || !evt || !evt.coordinate) return false;
        var ll = ol.proj.toLonLat(evt.coordinate);
        var lon = ll[0], lat = ll[1];
        if (lon < DFS_EXTENT_4326[0] || lon > DFS_EXTENT_4326[2] ||
            lat < DFS_EXTENT_4326[1] || lat > DFS_EXTENT_4326[3]) return false;

        popupState.latLon = [lat, lon];
        popupState.pixelXY = evt.pixel ? [evt.pixel[0], evt.pixel[1]] : [0, 0];
        var box = ensurePopupBox();
        box.style.visibility = 'hidden';
        box.style.display = '';
        var titleEl = box.querySelector('.shrt-fcst-point-box-title');
        if (titleEl) titleEl.textContent = '불러오는 중…';
        var bodyEl = box.querySelector('.shrt-fcst-point-box-body');
        if (bodyEl) bodyEl.innerHTML = '<div class="shrt-fcst-point-loading">데이터를 불러오는 중입니다…</div>';
        requestAnimationFrame(function () {
            if (!popupState.box) return;
            positionPopupBox(popupState.box, popupState.pixelXY);
            popupState.box.style.visibility = '';
        });
        refreshPopupContents();
        return true;
    };

    function hidePointPopup() {
        if (popupState.outsideClickHandler) {
            document.removeEventListener('click', popupState.outsideClickHandler);
            popupState.outsideClickHandler = null;
        }
        if (popupState.box && popupState.box.parentNode) {
            popupState.box.parentNode.removeChild(popupState.box);
        }
        popupState.box = null;
        popupState.latLon = null;
        popupState.pixelXY = null;
        popupState.lastFctTm = null;
        popupState.currentFetchToken++;
    }
    window._shrtForecastHidePointPopup = hidePointPopup;

    // ─────────────────────────────────────────────────────────────
    // 초기화
    // ─────────────────────────────────────────────────────────────

    window.initShrtForecastLayer = function (oceanMap) {
        if (initialized) return;
        initialized = true;
        if (oceanMap) state.oceanMap = oceanMap;
        bindUi();
    };

    // [Mutual Exclusion 반대방향] ocean_overlay.js 가 토글 ON 시 호출하여
    // 우리 모듈이 활성 상태면 끄기. 활성 아니면 no-op.
    window._shrtForecastDeactivate = function () {
        if (state.activeType) deactivate();
    };
})();
