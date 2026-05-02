/**
 * ============================================================================
 * 파일명: js/shrt_forecast_layer.js
 * 역할: KMA 단기예보 (천기 — 강수확률/강수량/적설/하늘상태/강수형태) 오버레이 +
 *       범례 + 슬라이더 + 클릭 시 점데이터 종합 팝업
 * ============================================================================
 *
 * [한 줄 설명]
 *   사용자가 우측 컨트롤의 "천기" 버튼 → 5개 서브버튼 중 하나를 누르면, KMA 의
 *   단기예보 PNG raster 가 지도에 깔리고, 하단에 슬라이더+범례가 나타난다.
 *   추가로 지도 위 어느 점이든 클릭하면 그 좌표의 5개 카테고리 종합 정보가
 *   작은 박스로 뜬다 (서버 /api/shrt-fcst-point 가 PNG 픽셀을 sampling).
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
 *     → 좌측으로 5개 서브버튼 팝아웃 (강수확률/강수량/적설/하늘상태/강수형태)
 *   - 서브버튼 클릭 시 팝아웃 닫힘 + 해당 GEMD raster 표출 + 슬라이더/범례/재생
 *   - 동일 레이어 다시 클릭 시 OFF
 *
 * [범례 색상 — KMA 1:1 매칭]
 *   POP 25 / PCP 30 / SNO 30 단계. KMA marine.kma.go.kr 의 chunk-common.js 에서
 *   추출한 정확한 hex 시퀀스 (보간 없음, 단색 단계 블록). 라벨 위치도 KMA 의
 *   visible-marks 그대로 (0/20/40/60/80/100 또는 비균등).
 *
 * [클릭 팝업 — T2]
 *   - 천기 활성 + 지도 클릭 → window._shrtForecastTryHandleClick(map, evt) 호출
 *   - 활성 상태이고 KMA extent 안이면 박스 표출 + true 반환 → 다음 가드 (특보 등) 차단
 *   - 슬라이더 frame 변경 시 popupState.latLon 으로 자동 재호출 (재생 중 동기 갱신)
 *   - 외부 클릭 / X 버튼 / 천기 OFF 시 자동 닫기
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
 *   - GET /api/shrt-fcst-point (routes/weather.js + services/shrt_fcst_point.js)
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
    var ENABLED_TYPES = { sky: true, pty: true, pop: true, pcp: true, sno: true };

    var TYPE_LABELS = {
        pop: '강수확률', pcp: '강수량', sno: '적설',
        sky: '하늘상태', pty: '강수형태'
    };

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

    var LEGEND_DEF = {
        sky: { title: '하늘상태', style: 'category', items: SKY_LEGEND },
        pty: { title: '강수형태', style: 'category', items: PTY_LEGEND },
        pop: { title: '강수확률', style: 'gradient', unit: '%',  colors: POP_COLORS, labels: POP_LABELS },
        pcp: { title: '강수량',   style: 'gradient', unit: 'mm', colors: PCP_COLORS, labels: PCP_LABELS },
        sno: { title: '적설',     style: 'gradient', unit: 'cm', colors: SNO_COLORS, labels: SNO_LABELS }
    };

    // ── 잠금 해제 패턴 ───────────────────────────────────────────
    var UNLOCK_CLICKS = 10;
    var RESET_MS = 3000;

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
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

    var _unlocked = false;
    var _clickCount = 0;
    var _resetTimer = null;
    var initialized = false;

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    function $(id) { return document.getElementById(id); }

    function _toast(msg) {
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(msg, 'bottom', 1800, false);
        } else {
            console.log('[shrt-toast]', msg);
        }
    }

    function fmtFcstTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '.' + (+m[3]) + '.(' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

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

    function showFrame(idx) {
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
        // [T2] 클릭 팝업이 열려 있으면 그 좌표의 데이터를 새 frame 시각으로 자동 갱신.
        //   슬라이더 재생 중에도 매 frame 변경 시 함께 동기화 (사용자 요구).
        if (popupState && popupState.box && popupState.latLon) {
            refreshPopupContents();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 데이터 fetch
    // ─────────────────────────────────────────────────────────────

    function fetchImgList(shrtType) {
        var url = IMG_LIST_URL + '?shrtType=' + encodeURIComponent(shrtType);
        return fetch(url, { credentials: 'omit' })
            .then(function (r) { if (!r.ok) throw new Error('imgList ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || j.code !== '0000' || !j.data) throw new Error('imgList bad: ' + (j && j.msg));
                var times = j.data.fct_tm_list || [];
                var imgs  = j.data.img_list || [];
                var n = Math.min(times.length, imgs.length);
                var frames = [];
                for (var i = 0; i < n; i++) {
                    // url: KMA PNG 경로
                    // label: 화면 표시용 한국어 포맷 ("5.3.(월) 14:00")
                    // fct_tm: KMA 원본 포맷 ("2026.05.03 14:00") — 서버 점데이터 호출 시 사용
                    frames.push({ url: imgs[i], label: fmtFcstTm(times[i]), fct_tm: times[i] });
                }
                return frames;
            });
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
    function startPlay() {
        if (state.playing || !state.frames.length) return;
        state.playing = true;
        setPlayBtnIcon(true);
        // 재생 시작 → 말풍선 표출 (1초 fade-in, opacity transition)
        var bar = $('shrt-fcst-slider-bar');
        if (bar) bar.classList.remove('tooltip-suppressed');
        state.playTimer = setInterval(function () {
            var next = state.frameIdx + 1;
            if (next >= state.frames.length) next = 0;
            showFrame(next);
        }, PLAY_INTERVAL_MS);
    }
    function stopPlay() {
        if (!state.playing) return;
        state.playing = false;
        setPlayBtnIcon(false);
        clearInterval(state.playTimer);
        state.playTimer = null;
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
            var labels = def.labels || [];
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

    function deactivate() {
        stopPlay();
        removeLayer();
        hideSliderBar();
        hideLegend();
        var items = document.querySelectorAll('.ocean-other-wx-item.active');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
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

    function activate(shrtType) {
        if (state.activeType === shrtType) { deactivate(); return; }
        deactivate();

        // [Mutual Exclusion] 다른 ocean overlay (current/wind/wave) 가 활성 상태면 끔
        // ocean_overlay.js 가 export 한 turn-off 핸들러 사용.
        if (typeof window.oceanOverlayTurnOff === 'function') {
            try { window.oceanOverlayTurnOff(); } catch (e) {}
        }

        state.activeType = shrtType;

        var btn = document.querySelector('.ocean-other-wx-item[data-shrt="' + shrtType + '"]');
        if (btn) btn.classList.add('active');

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
            //   rAF 으로 한 frame 양보 → offsetHeight 가 정확한 px 값 반환.
            requestAnimationFrame(updateShrtStackHeight);
        }).catch(function (e) {
            console.error('[shrt] activate failed:', e);
            deactivate();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // UI 바인딩
    // ─────────────────────────────────────────────────────────────

    function bindUi() {
        var wrap = $('ocean-other-wx-wrap');
        var toggleBtn = $('ocean-other-wx-toggle-btn');
        var popup = $('ocean-other-wx-popup');
        if (!wrap || !toggleBtn || !popup) return;

        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!_unlocked) {
                _clickCount++;
                clearTimeout(_resetTimer);
                _resetTimer = setTimeout(function () { _clickCount = 0; }, RESET_MS);
                if (_clickCount >= UNLOCK_CLICKS) {
                    _unlocked = true;
                    _clickCount = 0;
                    clearTimeout(_resetTimer);
                    _toast('천기 잠금 해제됨 (검수 모드)');
                    wrap.classList.add('popup-open');
                    popup.setAttribute('aria-hidden', 'false');
                    return;
                }
                _toast('미구현 상태입니다.');
                return;
            }
            wrap.classList.toggle('popup-open');
            popup.setAttribute('aria-hidden', wrap.classList.contains('popup-open') ? 'false' : 'true');
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
            slider.addEventListener('input', function () {
                stopPlay();
                showFrame(parseInt(slider.value, 10) || 0);
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
    // [T2] 클릭 팝업 — 5개 카테고리 종합 정보 박스
    //
    //   [트리거] 천기 레이어 활성 상태 + 지도 클릭 (handleMapClick 가 우리 가드 호출).
    //   [내용]   서버 /api/shrt-fcst-point 호출 → sky/pty/pop/pcp/sno 종합 박스 표시.
    //   [위치]   .warn-active-box 와 동일 패턴 — 클릭 픽셀 +12px 우하단, viewport
    //            가장자리 침범 시 반대쪽으로 flip.
    //   [재생 동기] 슬라이더 frame 변경 시 popupState.lastLatLon 으로 자동 재호출.
    //   [닫기]   외부 클릭 / X 버튼 / 천기 레이어 OFF / 카테고리 변경.
    // ─────────────────────────────────────────────────────────────
    var popupState = {
        box: null,           // DOM 요소
        latLon: null,        // [lat, lon] - frame 변경 시 재호출용
        pixelXY: null,       // [px, py] - 박스 위치
        lastFctTm: null,     // 마지막으로 fetch 한 시각 (중복 호출 방지)
        outsideClickHandler: null
    };

    /** 한국어 요일 + 시간 포맷팅: "5.3 (월) 14:00" 형태 */
    function fmtPopupTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일','월','화','수','목','금','토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '월 ' + (+m[3]) + '일 (' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

    /**
     * [T2] 천기 점 데이터 응답을 박스 본문 HTML 로 빌드.
     *
     * [표출 정책 — 사용자 명세]
     *   · 하늘 상태 : sky.label
     *   · 강수량   : pty.label + pcp.value mm + (pop.value%)
     *               예) "비/눈 0mm (0%)" — pty 가 null 이면 "없음" 으로 표시
     *   · 적설     : sno.value cm  또는 "예보 없음" (값 null/no_data/palette_mismatch 모두 동일 처리)
     */
    function buildPopupBodyHtml(data) {
        function nv(x) { return (x == null) ? null : x; }

        // 1) 하늘 상태
        var skyLabel = (data.sky && data.sky.label) || '예보 없음';

        // 2) 강수량 (pty + pcp + pop)
        var ptyLabel = (data.pty && data.pty.label) || '없음';
        var pcpVal   = (data.pcp && data.pcp.value != null) ? data.pcp.value : 0;
        var popVal   = (data.pop && data.pop.value != null) ? data.pop.value : 0;
        var pcpStr   = (pcpVal === 0) ? '0' : (Math.round(pcpVal * 10) / 10);
        var rainStr  = ptyLabel + ' ' + pcpStr + 'mm (' + popVal + '%)';

        // 3) 적설
        var snoStr;
        if (data.sno && data.sno.value != null) {
            var v = data.sno.value;
            snoStr = ((v === 0) ? '0' : (Math.round(v * 10) / 10)) + 'cm';
        } else {
            snoStr = '예보 없음';
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
            +  '</div>';
    }

    /** [T2] 박스 하나 생성 후 body 에 부착하고 외부클릭 핸들러 등록. */
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

        // X 버튼
        var closeBtn = box.querySelector('.shrt-fcst-point-box-close');
        if (closeBtn) closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            hidePointPopup();
        });

        // [외부 클릭 닫기] 박스 영역 밖 + 지도 영역 밖 클릭 시 박스 닫기.
        //   - 박스 안 클릭 → 무시 (사용자가 박스 안 콘텐츠 클릭한 것)
        //   - 지도 안 클릭 → 무시 (handleMapClick → _shrtForecastTryHandleClick 이
        //                         박스를 새 위치로 이동시키므로 여기서 닫으면 충돌)
        //   - 그 외 (탭바, 헤더, 사이드 컨트롤 등) 클릭 → 닫기
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

    /**
     * [T2] 박스를 클릭 픽셀 +12px 우하단에 배치 (viewport clamping).
     *
     * 좌표 인자는 지도 컨테이너 기준의 픽셀 좌표 (evt.pixel).
     * 화면 우/하단 침범 시 반대쪽으로 flip — .warn-active-box 와 동일.
     */
    function positionPopupBox(box, mapPixelXY) {
        var mapEl = document.getElementById('ocean-map');
        var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var pageX = rect.left + (mapPixelXY[0] || 0);
        var pageY = rect.top  + (mapPixelXY[1] || 0);
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var left = pageX + 12;
        var top  = pageY + 12;
        if (left + bw + 12 > vw) left = pageX - bw - 12;
        if (top + bh + 12 > vh)  top  = pageY - bh - 12;
        if (left < 8) left = 8;
        if (top < 8)  top  = 8;
        box.style.left = left + 'px';
        box.style.top  = top + 'px';
    }

    /**
     * [T2] 서버 /api/shrt-fcst-point 호출 → 박스 내용 갱신.
     *   - 같은 fctTm 으로 짧은 시간 안에 중복 호출 방지 (popupState.lastFctTm)
     *   - 호출 중에는 "불러오는 중" 메시지 유지, 응답 후 본문 교체
     */
    function refreshPopupContents() {
        if (!popupState.box || !popupState.latLon) return;
        var frame = state.frames[state.frameIdx];
        if (!frame) return;
        var fctTm = frame.fct_tm || frame.label;   // imgList 응답 그대로 사용
        var lat = popupState.latLon[0];
        var lon = popupState.latLon[1];
        var url = '/api/shrt-fcst-point?lat=' + encodeURIComponent(lat)
                + '&lon=' + encodeURIComponent(lon)
                + '&fct_tm=' + encodeURIComponent(fctTm);
        var box = popupState.box;
        var titleEl = box.querySelector('.shrt-fcst-point-box-title');
        var bodyEl  = box.querySelector('.shrt-fcst-point-box-body');
        if (titleEl) titleEl.textContent = fmtPopupTm(fctTm);
        // 같은 fctTm/좌표 재호출이면 body 그대로 — frame 변경시에만 갱신 의미
        popupState.lastFctTm = fctTm;
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!popupState.box || popupState.lastFctTm !== fctTm) return;  // 그 사이 닫혔거나 다른 frame 으로 진행됨
                if (!j || !j.ok || !j.data) {
                    if (bodyEl) bodyEl.innerHTML = '<div class="shrt-fcst-point-loading">데이터를 불러올 수 없습니다.</div>';
                    return;
                }
                if (bodyEl) bodyEl.innerHTML = buildPopupBodyHtml(j.data);
            })
            .catch(function (e) {
                if (!popupState.box) return;
                if (bodyEl) bodyEl.innerHTML = '<div class="shrt-fcst-point-loading">네트워크 오류: ' + (e && e.message ? e.message : '알 수 없음') + '</div>';
            });
    }

    /**
     * [T2] 외부 진입점 — handleMapClick 에서 호출.
     *
     * 천기 레이어 활성 상태이면 그 좌표에 박스를 띄우고 true 반환 (클릭 소비됨).
     * 비활성 상태면 false 반환 → 호출자가 다음 가드 (특보 / 바텀시트) 진행.
     *
     * @param {ol.Map} map - OpenLayers 맵 객체
     * @param {ol.MapBrowserEvent} evt - 'click' 이벤트
     * @returns {boolean} 처리 여부
     */
    window._shrtForecastTryHandleClick = function (map, evt) {
        if (!state.activeType) return false;            // 천기 OFF — 다음 가드로
        if (!state.frames || !state.frames.length) return false;
        if (typeof ol === 'undefined' || !evt || !evt.coordinate) return false;
        var ll = ol.proj.toLonLat(evt.coordinate);
        var lon = ll[0], lat = ll[1];
        // KMA extent 바깥 — 천기 데이터가 없는 영역. 우리 가드 비활성화 → 다음 가드로.
        if (lon < 123.27 || lon > 132.88 || lat < 31.58 || lat > 43.45) return false;

        popupState.latLon = [lat, lon];
        popupState.pixelXY = evt.pixel ? [evt.pixel[0], evt.pixel[1]] : [0, 0];
        var box = ensurePopupBox();
        // 박스 위치 — 첫 렌더 후 offsetWidth/Height 가 측정되므로 일단 보이지 않게 둠
        box.style.visibility = 'hidden';
        box.style.display = '';
        var titleEl = box.querySelector('.shrt-fcst-point-box-title');
        if (titleEl) titleEl.textContent = '불러오는 중…';
        var bodyEl = box.querySelector('.shrt-fcst-point-box-body');
        if (bodyEl) bodyEl.innerHTML = '<div class="shrt-fcst-point-loading">데이터를 불러오는 중입니다…</div>';
        // 다음 microtask 에 위치 계산 (offsetWidth 측정 가능)
        requestAnimationFrame(function () {
            if (!popupState.box) return;
            positionPopupBox(popupState.box, popupState.pixelXY);
            popupState.box.style.visibility = '';
        });
        refreshPopupContents();
        return true;
    };

    /** [T2] 박스 닫기 + 외부클릭 핸들러 해제 + 상태 초기화. */
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
    }
    // 모듈 외부 (deactivate) 도 부를 수 있게 노출
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
