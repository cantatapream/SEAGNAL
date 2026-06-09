/**
 * ============================================================================
 * 파일명: js/vsby_forecast_layer.js
 * 역할: KMA RDPS 시정예측 (visibility, 안개) PNG raster 오버레이 +
 *       범례 + 슬라이더/재생 + 클릭 시 픽셀 샘플링 팝업
 * ============================================================================
 *
 * [한 줄 설명]
 *   우측 컨트롤의 "시정예측" 버튼을 누르면, KMA RDPS 시정 예측 PNG raster 가
 *   지도에 깔리고, 하단에 슬라이더 + 재생 버튼 + 범례가 나타난다.
 *   추가로 지도 위 어느 점이든 클릭하면 그 좌표의 시정(km) 값이 작은 박스로 뜬다.
 *   **클라이언트(브라우저) 가 PNG 를 직접 canvas 로 그려 픽셀 색상을 추출** 후
 *   색상 팔레트와 매칭해서 시정 km 값으로 변환한다.
 *
 *   ※ 이 모듈은 js/shrt_forecast_layer.js (천기) 의 메커니즘을 그대로 복제한
 *      것이다 — ImageStatic raster + 슬라이더 + 범례 + 클릭 픽셀 샘플링.
 *      다만 천기와 달리 단일 카테고리(시정)라 서브버튼 popup 없이 토글 버튼
 *      하나로 ON/OFF 한다.
 *
 * [데이터 소스] (라이브 캡처 확인)
 *   GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/mdl/rdps/imgList  (쿼리 없음)
 *     응답: { code:'0000', msg:'성공',
 *             data: { fct_tm_list:["2026.06.09 15:00", ...](KST 시단위),
 *                     img_list:["/resources/mdl/khope/mvis/img/.../..._VIS_31.png", ...] } }
 *     fct_tm_list[i] ↔ img_list[i] (1:1). 시각은 이미 KST 이고 "지금" 근처부터
 *     시작 → 슬라이더가 자연스럽게 현재→미래 (약 90 프레임, +96h) 로 흐른다.
 *
 *   PNG 본체: 'https://marine.kma.go.kr' + img_list[i]
 *   [WebView 호환 — 천기와 동일 정책]
 *     - 화면 표시(ImageStatic): crossOrigin 미지정으로 **직접** 로드. crossOrigin:'anonymous'
 *       로 요청하면 Capacitor WebView(앱)에서 이미지 로드가 실패하기 때문.
 *     - 클릭 픽셀 샘플링: same-origin 프록시 /api/kma-png-proxy?path= 경유로 로드
 *       (same-origin 이라 canvas 가 tainted 되지 않아 getImageData 가능).
 *
 * [실패 처리]
 *   manifest fetch 실패 또는 frame 0개 → 토스트 안내 후 레이어 graceful OFF.
 *   crash 하지 않는다.
 *
 * [PNG 지도 배치 — ★ 보정 필요 ★]
 *   PNG 는 회전/투영된 격자 (중국–일본–러시아 광역) 라 정축 lon/lat 가 아니다.
 *   정확한 투영/extent 가 아직 확정되지 않아 파일 상단 CONFIG 블록에 첫 추정값을
 *   둔다 (VSBY_PROJECTION / VSBY_IMAGE_EXTENT). 앱에서 해안선과 맞춰 보정해야 한다.
 *   v1 은 시각적으로 어긋나는 것이 정상 (의도된 미보정 상태).
 *
 * [범례 색상 — 시정(km)]
 *   저 km = 나쁨(안개). 좌→우: 0.0(자홍) … 20.0(흰색). KMA 공식 범례 기준 근사 hex.
 *   가로 stepped 블록 + km 라벨. 천기 gradient 범례와 동일 DOM/CSS 패턴 차용.
 *
 * [클릭 팝업]
 *   - 시정예측 활성 + 지도 클릭 → window._vsbyForecastTryHandleClick(map, evt) 호출.
 *   - extent 안이면 클릭 좌표를 PNG 픽셀로 변환 → 3x3 영역 픽셀 추출 → 팔레트
 *     최근접 매칭 → 그 stop 의 km 값으로 "시정 약 N km" 표시. 투명/무데이터 →
 *     "정보 없음". 슬라이더 frame 변경 시 재샘플링 (천기와 동일).
 *
 * [외부와의 인터페이스]
 *   - window.initVsbyForecastLayer(oceanMap)       → 초기화 (한 번만)
 *   - window._vsbyForecastDeactivate()             → 다른 overlay 활성 시 강제 OFF
 *   - window._vsbyForecastTryHandleClick(map, evt) → handleMapClick 가드
 *   - window._vsbyForecastHidePointPopup()         → 외부에서 팝업 닫기
 *
 * [CSS 변수]
 *   --shrt-stack-height : 천기와 공유 (슬라이더+범례 스택 높이 → 특보 범례 상승).
 *
 * [의존]
 *   - OpenLayers 6+ (ol.layer.Image, ol.source.ImageStatic, ol.proj)
 *   - window._showOceanToast (index2_patch.js)
 *   - window.__getOceanMap (ocean_map.js 가 노출)
 *   - 브라우저 native: HTMLImageElement, Canvas 2D, getImageData
 * ============================================================================
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // ★★ TODO_CALIBRATE: 시정 PNG 지도 배치 — 앱에서 해안선과 맞춰 보정 필요 ★★
    //
    //   PNG 는 RDPS Lambert 투영의 회전/투영 격자라 정축 lon/lat 가 아니다.
    //   아래 두 값이 배치의 단일 진실 공급원 (single source of truth) — ImageStatic
    //   생성과 클릭 lon/lat→픽셀 변환 양쪽이 모두 이 값을 참조한다. 보정 시 여기만 고친다.
    //
    //   추후 RDPS Lambert 정밀 정합이 필요하면 proj4 를 로드해 커스텀 projection 을
    //   정의하고 VSBY_PROJECTION 을 그 코드로 교체하면 된다 (v1 은 EPSG:4326).
    // ─────────────────────────────────────────────────────────────
    var VSBY_PROJECTION = 'EPSG:4326';                     // 추후 RDPS Lambert 로 교체 가능
    var VSBY_IMAGE_EXTENT = [113.0, 18.0, 152.0, 53.0];    // [minLon,minLat,maxLon,maxLat] 첫 추정값
    // ─────────────────────────────────────────────────────────────

    var KMA_BASE = 'https://marine.kma.go.kr';
    // RDPS 시정 manifest — 쿼리 파라미터 없음 (라이브 캡처 확인).
    var IMG_LIST_URL = KMA_BASE + '/mmis_marine_api/v1/kma/mdl/rdps/imgList';

    var PLAY_INTERVAL_MS = 500;

    // ── 시정 범례 (km) ──
    //   저 km = 나쁨(안개), 고 km = 좋음. KMA 공식 범례 기준 근사 hex (추후 정밀 보정 가능).
    //   stops[i].v = 시정 km 값 (클릭 팝업이 최근접 색상의 v 를 그대로 표시).
    //   stops[i].color = 그 단계 색상 (범례 블록 + 픽셀 매칭 팔레트 공용).
    var VSBY_STOPS = [
        { v: 0.0,  color: '#ff2bd6' },   // 자홍 — 가장 나쁜 시정 (짙은 안개)
        { v: 0.2,  color: '#e60000' },   // 빨강
        { v: 0.6,  color: '#ff7f00' },   // 주황
        { v: 1.0,  color: '#ffb547' },   // 옅은 주황
        { v: 2.0,  color: '#ffe800' },   // 노랑
        { v: 3.0,  color: '#c8d600' },   // 연두빛 노랑
        { v: 5.0,  color: '#16b41a' },   // 초록
        { v: 7.0,  color: '#6fdf6f' },   // 옅은 초록
        { v: 10.0, color: '#1fb6d6' },   // 청록
        { v: 14.0, color: '#2f7be6' },   // 파랑
        { v: 20.0, color: '#ffffff' }    // 흰색 — 시정 매우 좋음
    ];

    // 범례 라벨 — 색상 stop 과 1:1 (균등 위치). km 단위는 라벨 우측 끝에만 1회 표기.
    var VSBY_COLORS = VSBY_STOPS.map(function (s) { return s.color; });

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    // ─────────────────────────────────────────────────────────────

    var state = {
        oceanMap: null,
        active: false,
        frames: [],                  // [{ url, fct_tm, label }]
        frameIdx: 0,
        layer: null,
        playing: false,
        preloadedImgs: {}
    };

    var initialized = false;

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    /** document.getElementById 의 짧은 alias. */
    function $(id) { return document.getElementById(id); }

    /** 화면 하단에 짧은 토스트 (있으면 전역 _showOceanToast, 없으면 console). */
    function _toast(msg) {
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(msg, 'bottom', 1800, false);
        } else {
            console.log('[vsby-toast]', msg);
        }
    }

    /**
     * KMA fct_tm 문자열을 사용자 친화 표기로 변환.
     * 예) "2026.06.09 15:00" → "6.9.(화) 15:00"  (이미 KST)
     */
    function fmtFcstTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '.' + (+m[3]) + '.(' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

    /** 슬라이더 진행 비율을 CSS 변수 --vsby-progress 로 publish. */
    function setSliderProgress(slider) {
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var val = parseFloat(slider.value) || 0;
        var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.setProperty('--vsby-progress', pct + '%');
    }

    /** 말풍선 위치/화살표 동적 계산 (천기 updateTooltip 과 동일 로직). */
    function updateTooltip() {
        var tip = $('vsby-fcst-tooltip');
        var slider = $('vsby-fcst-slider');
        if (!tip || !slider) return;
        var idx = parseInt(slider.value, 10) || 0;
        var frame = state.frames[idx];
        if (!frame) return;
        tip.textContent = frame.label;

        tip.style.left = '0px';
        tip.style.transform = 'none';

        var sliderRect = slider.getBoundingClientRect();
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = max > min ? ((idx - min) / (max - min)) : 0;
        var thumbHalf = 9;
        var thumbXViewport = sliderRect.left + thumbHalf + pct * (sliderRect.width - thumbHalf * 2);

        var tipRect = tip.getBoundingClientRect();
        var tipW = tipRect.width;

        var pad = 4;
        var minLV = pad;
        var maxLV = window.innerWidth - tipW - pad;
        var idealLV = thumbXViewport - tipW / 2;
        var clampedLV = Math.max(minLV, Math.min(idealLV, maxLV));

        var wrapRect = tip.parentElement.getBoundingClientRect();
        var leftInWrap = clampedLV - wrapRect.left;
        tip.style.left = leftInWrap + 'px';

        var arrowX = thumbXViewport - clampedLV;
        var arrowMin = 8, arrowMax = tipW - 8;
        arrowX = Math.max(arrowMin, Math.min(arrowX, arrowMax));
        tip.style.setProperty('--vsby-arrow-x', arrowX + 'px');
    }

    /** 해양 지도 OL 인스턴스 lazy + cached 획득. */
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

        // [중요] crossOrigin 미지정 — KMA PNG 를 crossOrigin:'anonymous' 로 요청하면
        //   Capacitor WebView(앱)에서 이미지 로드가 실패한다(천기와 동일 이슈).
        //   화면 표시는 tainted canvas 여도 정상이므로 crossOrigin 없이 직접 로드.
        //   (클릭 픽셀 샘플링은 same-origin 프록시 /api/kma-png-proxy 로 별도 처리)
        var src = new ol.source.ImageStatic({
            url: url,
            imageExtent: VSBY_IMAGE_EXTENT,
            projection: VSBY_PROJECTION
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
        // 표시 ImageStatic 과 동일하게 crossOrigin 없이 직접 로드(WebView 호환·캐시 공유).
        var img = new Image();
        img.src = KMA_BASE + url;
        state.preloadedImgs[url] = img;
    }

    /**
     * @param {number} idx - 표시할 frame 인덱스
     * @param {boolean} [skipSample] - true 면 팝업 본문 샘플 스킵 (드래그 중).
     */
    function showFrame(idx, skipSample) {
        if (!state.frames.length) return;
        if (idx < 0) idx = 0;
        if (idx >= state.frames.length) idx = state.frames.length - 1;
        state.frameIdx = idx;
        var frame = state.frames[idx];
        buildOrUpdateLayer(KMA_BASE + frame.url);
        var slider = $('vsby-fcst-slider');
        if (slider) {
            slider.value = String(idx);
            setSliderProgress(slider);
        }
        updateTooltip();
        if (popupState && popupState.box && popupState.latLon) {
            refreshPopupContents(skipSample);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 데이터 fetch (manifest)
    // ─────────────────────────────────────────────────────────────

    // imgList 캐시 (5분 TTL) — activate 와 클릭 팝업 샘플링이 공유.
    var _imgListCache = null;       // { ts, frames, fctMap }
    var _imgListInflight = null;    // Promise (동시 호출 dedup)
    var IMG_LIST_TTL_MS = 5 * 60 * 1000;

    /**
     * RDPS 시정 manifest 를 가져옴 (캐시 + dedup).
     * @returns {Promise<{ts, frames:[{url,fct_tm,label}], fctMap:{fct_tm→url}}>}
     */
    function _getImgListEntry() {
        if (_imgListCache && (Date.now() - _imgListCache.ts) < IMG_LIST_TTL_MS) {
            return Promise.resolve(_imgListCache);
        }
        if (_imgListInflight) return _imgListInflight;

        var p = fetch(IMG_LIST_URL, { credentials: 'omit' })
            .then(function (r) { if (!r.ok) throw new Error('vsby imgList ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || j.code !== '0000' || !j.data) throw new Error('vsby imgList bad');
                var times = j.data.fct_tm_list || [];
                var imgs  = j.data.img_list || [];
                var n = Math.min(times.length, imgs.length);
                var frames = [], fctMap = {};
                for (var i = 0; i < n; i++) {
                    frames.push({ url: imgs[i], fct_tm: times[i], label: fmtFcstTm(times[i]) });
                    fctMap[times[i]] = imgs[i];
                }
                var entry = { ts: Date.now(), frames: frames, fctMap: fctMap };
                _imgListCache = entry;
                return entry;
            })
            .finally(function () { _imgListInflight = null; });
        _imgListInflight = p;
        return p;
    }

    function fetchImgList() {
        return _getImgListEntry().then(function (entry) { return entry.frames; });
    }

    // ─────────────────────────────────────────────────────────────
    // 재생
    // ─────────────────────────────────────────────────────────────

    function setPlayBtnIcon(playing) {
        var btn = $('vsby-fcst-play-btn');
        if (!btn) return;
        btn.innerHTML = playing
            ? '<i class="fa-solid fa-pause"></i>'
            : '<i class="fa-solid fa-play"></i>';
        btn.classList.toggle('playing', !!playing);
    }

    function _waitMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /** 한 frame 데이터 준비 대기 — PNG preload + (열려있으면) 팝업 샘플. */
    function waitForFrameDataReady(idx) {
        var frame = state.frames[idx];
        if (!frame) return Promise.resolve();
        var pngP = new Promise(function (resolve) {
            var pre = state.preloadedImgs[frame.url];
            if (pre && pre.complete) return resolve();
            if (pre) { pre.addEventListener('load', resolve); pre.addEventListener('error', resolve); return; }
            // 표시 ImageStatic 과 동일하게 crossOrigin 없이 로드(WebView 호환·캐시 공유).
            var img = new Image();
            img.onload = function () { resolve(); };
            img.onerror = function () { resolve(); };
            img.src = KMA_BASE + frame.url;
            state.preloadedImgs[frame.url] = img;
        });
        var popupP = (popupState.box && popupState.latLon)
            ? refreshPopupContents()
            : Promise.resolve();
        return Promise.all([pngP, popupP]);
    }

    function startPlay() {
        if (state.playing || !state.frames.length) return;
        state.playing = true;
        setPlayBtnIcon(true);
        var bar = $('vsby-fcst-slider-bar');
        if (bar) bar.classList.remove('tooltip-suppressed');

        // 데이터-기반 재생 루프 (setTimeout 체이닝) — 천기와 동일.
        function _step() {
            if (!state.playing) return;
            var next = state.frameIdx + 1;
            if (next >= state.frames.length) next = 0;
            showFrame(next);
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
    }
    function togglePlay() { state.playing ? stopPlay() : startPlay(); }

    // ─────────────────────────────────────────────────────────────
    // 범례 / 슬라이더
    // ─────────────────────────────────────────────────────────────

    /** 시정 범례 렌더 — N 색상 단색 블록(보간 X) + km 라벨 (천기 gradient 패턴). */
    function renderLegend() {
        var lg = $('vsby-fcst-legend');
        if (!lg) return;

        var blocksHtml = '';
        for (var bi = 0; bi < VSBY_COLORS.length; bi++) {
            blocksHtml += '<div class="vsby-fcst-grad-block" style="background:' + VSBY_COLORS[bi] + ';"></div>';
        }
        var html = '<div class="vsby-fcst-grad-bar">' + blocksHtml + '</div>';

        // 라벨 — 색상 stop 과 1:1, 균등 위치. km 단위는 우측 끝 라벨에만 부착.
        html += '<div class="vsby-fcst-grad-labels">';
        var n = VSBY_STOPS.length;
        for (var li = 0; li < n; li++) {
            var pct = (li / (n - 1)) * 100;
            var tx;
            if (pct <= 0)        tx = '0';
            else if (pct >= 100) tx = '-100%';
            else                 tx = '-50%';
            var labelText = String(VSBY_STOPS[li].v);
            if (li === n - 1) labelText += 'km';
            html += '<span style="left:' + pct + '%;transform:translateX(' + tx + ');">'
                  +   labelText
                  + '</span>';
        }
        html += '</div>';

        lg.innerHTML = html;
        lg.classList.add('gradient-mode');
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    function renderLegendLoading() {
        var lg = $('vsby-fcst-legend');
        if (!lg) return;
        lg.classList.remove('gradient-mode');
        lg.innerHTML = '<div class="vsby-fcst-legend-loading">데이터를 불러오는 중…</div>';
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    function renderLegendError(msg) {
        var lg = $('vsby-fcst-legend');
        if (!lg) return;
        lg.classList.remove('gradient-mode');
        lg.innerHTML = '<div class="vsby-fcst-legend-loading">' + msg + '</div>';
        lg.style.display = '';
        lg.setAttribute('aria-hidden', 'false');
    }

    function hideLegend() {
        var lg = $('vsby-fcst-legend');
        if (!lg) return;
        lg.style.display = 'none';
        lg.setAttribute('aria-hidden', 'true');
        lg.innerHTML = '';
    }

    function showSliderBar(frameCount) {
        var bar = $('vsby-fcst-slider-bar');
        var slider = $('vsby-fcst-slider');
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

    /** 시간 눈금 — 모든 frame minor tick + 자정에만 날짜 라벨 (천기와 동일). */
    function renderTicks() {
        var ticksEl = $('vsby-fcst-ticks');
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
            tick.className = 'vsby-fcst-tick ' + (isMajor ? 'major' : 'minor');
            tick.style.left = pct + '%';
            frag.appendChild(tick);

            if (isMajor && hh === 0) {
                var key = m[1] + '-' + m[2] + '-' + hh;
                if (!labelsAdded[key]) {
                    labelsAdded[key] = 1;
                    var label = document.createElement('div');
                    label.className = 'vsby-fcst-tick-label top';
                    label.style.left = pct + '%';
                    label.textContent = +m[1] + '/' + +m[2];
                    frag.appendChild(label);
                }
            }
        }
        ticksEl.appendChild(frag);
    }

    function hideSliderBar() {
        var bar = $('vsby-fcst-slider-bar');
        if (!bar) return;
        bar.style.display = 'none';
        bar.setAttribute('aria-hidden', 'true');
    }

    /**
     * 스택 점유 높이를 CSS 변수 --shrt-stack-height 로 publish (천기와 공유).
     * 특보 범례(.warn-active-legend) 가 이 값만큼 위로 상승해 가려지지 않음.
     */
    function updateStackHeight() {
        var bar = $('vsby-fcst-slider-bar');
        var lg  = $('vsby-fcst-legend');
        var mainTabRaw = getComputedStyle(document.documentElement).getPropertyValue('--main-tab-height');
        var mainTabH = parseFloat(mainTabRaw) || 68;

        var topMost = window.innerHeight;
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
            var tabBarTop = window.innerHeight - mainTabH;
            stackH = Math.max(0, tabBarTop - topMost);
        }
        document.documentElement.style.setProperty('--shrt-stack-height', stackH + 'px');
    }
    function clearStackHeight() {
        document.documentElement.style.setProperty('--shrt-stack-height', '0px');
    }

    // ─────────────────────────────────────────────────────────────
    // 활성화 / 비활성화
    // ─────────────────────────────────────────────────────────────

    /** 시정예측 레이어 비활성화 — 자원 정리 + UI 원복. */
    function deactivate() {
        stopPlay();
        removeLayer();
        hideSliderBar();
        hideLegend();
        var toggleBtn = $('ocean-vsby-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('active');
        var bar = $('vsby-fcst-slider-bar');
        if (bar) bar.classList.remove('tooltip-suppressed');
        state.active = false;
        state.frames = [];
        state.frameIdx = 0;
        clearStackHeight();
        hidePointPopup();
    }

    /** 시정예측 레이어 활성화 — manifest 로드 → PNG/슬라이더/범례 표출. */
    function activate() {
        if (state.active) { deactivate(); return; }

        // [Mutual Exclusion] 천기 / 조류·바람·파고 overlay 가 켜져있으면 끔.
        if (typeof window._shrtForecastDeactivate === 'function') {
            try { window._shrtForecastDeactivate(); } catch (e) {}
        }
        if (typeof window.oceanOverlayTurnOff === 'function') {
            try { window.oceanOverlayTurnOff(); } catch (e) {}
        }

        // 사용자 의도적 ON → 캐시 무효화 + 강제 새 fetch (천기와 동일 정책).
        _imgListCache = null;
        _imgListInflight = null;

        state.active = true;

        var toggleBtn = $('ocean-vsby-toggle-btn');
        if (toggleBtn) toggleBtn.classList.add('active');

        // 즉시 로딩 UI (응답 전 슬라이더/범례 영역 미리 표출).
        showSliderBar(0);
        renderLegendLoading();
        requestAnimationFrame(updateStackHeight);

        fetchImgList().then(function (frames) {
            if (!state.active) return;
            if (!frames.length) {
                console.warn('[vsby] no frames');
                _toast('시정예측 데이터를 불러올 수 없습니다.');
                deactivate();
                return;
            }
            state.frames = frames;
            state.frameIdx = 0;
            showSliderBar(frames.length);
            renderLegend();
            showFrame(0);
            for (var i = 0; i < frames.length; i++) preloadImg(frames[i].url);
            requestAnimationFrame(updateStackHeight);
        }).catch(function (e) {
            console.error('[vsby] activate failed:', e);
            _toast('시정예측 데이터를 일시적으로 불러올 수 없습니다.');
            // 부분 UI 정리하고 완전 OFF (graceful).
            deactivate();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // UI 바인딩
    // ─────────────────────────────────────────────────────────────

    function bindUi() {
        var toggleBtn = $('ocean-vsby-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                activate();
            });
        }

        var slider = $('vsby-fcst-slider');
        if (slider) {
            var _dragSampleTimer = null;
            var _inDrag = false;

            function _onDragEnd() {
                _inDrag = false;
                clearTimeout(_dragSampleTimer);
                if (popupState.box && popupState.latLon) refreshPopupContents();
            }

            slider.addEventListener('pointerdown', function () {
                _inDrag = true;
                stopPlay();
                var bar = $('vsby-fcst-slider-bar');
                if (bar) bar.classList.remove('tooltip-suppressed');
            });
            slider.addEventListener('pointerup',     _onDragEnd);
            slider.addEventListener('pointercancel', _onDragEnd);

            slider.addEventListener('input', function () {
                stopPlay();
                var bar = $('vsby-fcst-slider-bar');
                if (bar) bar.classList.remove('tooltip-suppressed');
                var idx = parseInt(slider.value, 10) || 0;
                showFrame(idx, true);   // skipSample=true → 본문 정지, 헤더/지도만 갱신
                if (!_inDrag) {
                    clearTimeout(_dragSampleTimer);
                    _dragSampleTimer = setTimeout(function () {
                        if (popupState.box && popupState.latLon) refreshPopupContents();
                    }, 200);
                }
            });
            slider.addEventListener('change', function () {
                if (_inDrag) return;
                clearTimeout(_dragSampleTimer);
                if (popupState.box && popupState.latLon) refreshPopupContents();
            });
        }
        var playBtn = $('vsby-fcst-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!state.frames.length) return;
                togglePlay();
            });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 클릭 팝업 — 클라이언트 PNG 픽셀 샘플링 (천기와 동일 철학)
    //   PNG 는 same-origin 프록시(/api/kma-png-proxy)로 로드 → canvas 비-tainted → getImageData 가능.
    // ─────────────────────────────────────────────────────────────

    function _hex2rgb(h) {
        var v = parseInt(h.replace('#', ''), 16);
        return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    }
    var _VSBY_RGB = VSBY_COLORS.map(_hex2rgb);

    // 이미지 로더 캐시 (LRU) — 같은 URL PNG 두 번 다운로드 안 함.
    var _imgElemCache = new Map();
    var IMG_CACHE_MAX = 20;
    function _loadImg(kmaPath) {
        if (_imgElemCache.has(kmaPath)) {
            var existing = _imgElemCache.get(kmaPath);
            _imgElemCache.delete(kmaPath);
            _imgElemCache.set(kmaPath, existing);
            return existing;
        }
        var p = new Promise(function (resolve, reject) {
            var img = new Image();
            // [중요] same-origin 프록시 경유 — crossOrigin:'anonymous' 직접요청은 앱 WebView 에서
            //   이미지 로드가 실패한다. 프록시(same-origin)면 canvas 가 tainted 되지 않아
            //   getImageData 도 가능(천기와 동일 방식).
            img.onload = function () { resolve(img); };
            img.onerror = function () {
                _imgElemCache.delete(kmaPath);
                reject(new Error('img load fail: ' + kmaPath));
            };
            img.src = '/api/kma-png-proxy?path=' + encodeURIComponent(kmaPath);
        });
        _imgElemCache.set(kmaPath, p);
        if (_imgElemCache.size > IMG_CACHE_MAX) {
            var oldestKey = _imgElemCache.keys().next().value;
            _imgElemCache.delete(oldestKey);
        }
        return p;
    }

    // 3x3 샘플 캔버스 (재사용).
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

    /** (cx,cy) 주변 3x3 픽셀 추출 — α=0 무시, 최빈 RGB 반환. null = 무데이터. */
    function _sampleImgArea(img, cx, cy) {
        var ctx = _getSampleCtx();
        ctx.clearRect(0, 0, 3, 3);
        try {
            ctx.drawImage(img, cx - 1, cy - 1, 3, 3, 0, 0, 3, 3);
        } catch (e) {
            return null;
        }
        var data = ctx.getImageData(0, 0, 3, 3).data;
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

    /** RGB → 가장 가까운 팔레트 인덱스 (유클리드). 거리 너무 크면 -1. */
    function _matchRgb(r, g, b, paletteRgb, maxDist) {
        var bestI = -1, bestD = Infinity;
        for (var i = 0; i < paletteRgb.length; i++) {
            var p = paletteRgb[i];
            var d = (r - p[0]) * (r - p[0]) + (g - p[1]) * (g - p[1]) + (b - p[2]) * (b - p[2]);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        var thr = (maxDist || 60); thr = thr * thr;
        if (bestD > thr) return -1;
        return bestI;
    }

    /**
     * lon/lat → PNG 픽셀 좌표 (extent 안에 있을 때만).
     * ★ VSBY_IMAGE_EXTENT 를 정축 lon/lat 로 가정한 단순 선형 매핑 (보정 필요).
     */
    function _lonLatToPx(lon, lat, w, h) {
        var EX = VSBY_IMAGE_EXTENT;   // [lonMin, latMin, lonMax, latMax]
        if (lon < EX[0] || lon > EX[2] || lat < EX[1] || lat > EX[3]) return null;
        var x = Math.round((lon - EX[0]) / (EX[2] - EX[0]) * (w - 1));
        var y = Math.round((EX[3] - lat) / (EX[3] - EX[1]) * (h - 1));
        if (x < 0 || x >= w || y < 0 || y >= h) return null;
        return { x: x, y: y };
    }

    /**
     * 한 frame 의 시정 점 데이터 추출.
     * @returns {Promise<{ value:number|null, rgb?, reason? }>}
     */
    function _samplePoint(fctTm, lon, lat) {
        return _getImgListEntry().then(function (list) {
            var imgPath = list.fctMap[fctTm];
            if (!imgPath) return { value: null, reason: 'no_url' };
            return _loadImg(imgPath).then(function (img) {
                var px = _lonLatToPx(lon, lat, img.naturalWidth, img.naturalHeight);
                if (!px) return { value: null, reason: 'out_of_extent' };
                var s = _sampleImgArea(img, px.x, px.y);
                if (!s) return { value: null, reason: 'no_data' };
                var idx = _matchRgb(s.r, s.g, s.b, _VSBY_RGB);
                if (idx < 0) return { value: null, reason: 'palette_mismatch', rgb: [s.r, s.g, s.b] };
                return { value: VSBY_STOPS[idx].v, rgb: [s.r, s.g, s.b] };
            });
        });
    }

    var popupState = {
        box: null,
        latLon: null,
        pixelXY: null,
        currentFetchToken: 0,
        outsideClickHandler: null
    };

    /** 한국어 요일 + 시간 포맷팅: "6월 9일 (화) 15:00" */
    function fmtPopupTm(s) {
        if (!s) return '';
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return s;
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return (+m[2]) + '월 ' + (+m[3]) + '일 (' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
    }

    /** km 값 포맷: 0 → '0', 0.2 → '0.2', 5 → '5'. */
    function _fmtKm(v) {
        if (v == null) return '';
        return String(Math.round(v * 10) / 10);
    }

    function buildPopupBodyHtml(data) {
        var valStr;
        if (data && data.value != null) {
            valStr = '시정 약 ' + _fmtKm(data.value) + ' km';
        } else {
            valStr = '정보 없음';
        }
        return '<div class="vsby-fcst-point-row">'
            +    '<span class="vsby-fcst-point-row-label">시정</span>'
            +    '<span class="vsby-fcst-point-row-value">' + valStr + '</span>'
            +  '</div>';
    }

    function ensurePopupBox() {
        if (popupState.box) return popupState.box;
        var box = document.createElement('div');
        box.className = 'vsby-fcst-point-box';
        box.innerHTML = ''
            + '<div class="vsby-fcst-point-box-header">'
            +   '<span class="vsby-fcst-point-box-title">불러오는 중…</span>'
            +   '<button type="button" class="vsby-fcst-point-box-close" aria-label="닫기">&times;</button>'
            + '</div>'
            + '<div class="vsby-fcst-point-box-body">'
            +   '<div class="vsby-fcst-point-loading">데이터를 불러오는 중입니다…</div>'
            + '</div>';
        document.body.appendChild(box);
        popupState.box = box;
        var closeBtn = box.querySelector('.vsby-fcst-point-box-close');
        if (closeBtn) closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            hidePointPopup();
        });
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
     * 박스 내용 갱신 — 클라이언트가 직접 PNG 샘플 후 본문 빌드.
     * @param {boolean} headerOnly - true 면 헤더 시각만 갱신 (드래그 중).
     * @returns {Promise<void>}
     */
    function refreshPopupContents(headerOnly) {
        if (!popupState.box || !popupState.latLon) return Promise.resolve();
        var frame = state.frames[state.frameIdx];
        if (!frame) return Promise.resolve();
        var fctTm = frame.fct_tm || frame.label;
        var box = popupState.box;
        var titleEl = box.querySelector('.vsby-fcst-point-box-title');
        var bodyEl  = box.querySelector('.vsby-fcst-point-box-body');
        if (titleEl) titleEl.textContent = fmtPopupTm(fctTm);
        if (headerOnly) return Promise.resolve();

        var token = ++popupState.currentFetchToken;
        var lat = popupState.latLon[0], lon = popupState.latLon[1];

        return _samplePoint(fctTm, lon, lat)
            .then(function (data) {
                if (!popupState.box || token !== popupState.currentFetchToken) return;
                if (bodyEl) bodyEl.innerHTML = buildPopupBodyHtml(data);
            })
            .catch(function (e) {
                if (!popupState.box || token !== popupState.currentFetchToken) return;
                if (bodyEl) bodyEl.innerHTML = '<div class="vsby-fcst-point-loading">데이터 오류: '
                    + (e && e.message ? e.message : '알 수 없음') + '</div>';
            });
    }

    /**
     * 외부 진입점 — handleMapClick 가드.
     * 시정 활성 + extent 안이면 박스 띄우고 true 반환 (클릭 소비).
     */
    window._vsbyForecastTryHandleClick = function (map, evt) {
        if (!state.active) return false;
        if (!state.frames || !state.frames.length) return false;
        if (typeof ol === 'undefined' || !evt || !evt.coordinate) return false;
        var ll = ol.proj.toLonLat(evt.coordinate);
        var lon = ll[0], lat = ll[1];
        if (lon < VSBY_IMAGE_EXTENT[0] || lon > VSBY_IMAGE_EXTENT[2] ||
            lat < VSBY_IMAGE_EXTENT[1] || lat > VSBY_IMAGE_EXTENT[3]) return false;

        popupState.latLon = [lat, lon];
        popupState.pixelXY = evt.pixel ? [evt.pixel[0], evt.pixel[1]] : [0, 0];
        var box = ensurePopupBox();
        box.style.visibility = 'hidden';
        box.style.display = '';
        var titleEl = box.querySelector('.vsby-fcst-point-box-title');
        if (titleEl) titleEl.textContent = '불러오는 중…';
        var bodyEl = box.querySelector('.vsby-fcst-point-box-body');
        if (bodyEl) bodyEl.innerHTML = '<div class="vsby-fcst-point-loading">데이터를 불러오는 중입니다…</div>';
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
        popupState.currentFetchToken++;
    }
    window._vsbyForecastHidePointPopup = hidePointPopup;

    // ─────────────────────────────────────────────────────────────
    // 초기화
    // ─────────────────────────────────────────────────────────────

    window.initVsbyForecastLayer = function (oceanMap) {
        if (initialized) return;
        initialized = true;
        if (oceanMap) state.oceanMap = oceanMap;
        bindUi();
    };

    // [Mutual Exclusion 반대방향] 다른 overlay 가 ON 될 때 호출하여 활성이면 끔.
    window._vsbyForecastDeactivate = function () {
        if (state.active) deactivate();
    };
})();
