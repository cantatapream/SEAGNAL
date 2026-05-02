/**
 * ============================================================================
 * 파일명: js/shrt_forecast_layer.js
 * 역할: KMA 단기예보 GEMD raster 오버레이 (강수확률/강수량/적설/하늘상태/강수형태)
 * ============================================================================
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
 * [기존 LAND PNG (DFS_SHRT_GRD_GRB5_*) 와의 차이]
 *   - LAND 는 한반도 본토만 (α=0 80%) → 해상 영역에 데이터 없음
 *   - GEMD 는 한반도 + 근해 모두 (α=0 27%) → 별도 zone polygon fill 불필요
 *
 * [UI 구성]
 *   - 우측 컨트롤 stack 의 "기타 기상" 버튼 → 좌측으로 5개 서브버튼 팝아웃
 *   - 서브버튼 클릭 시 팝아웃 닫힘 + 해당 GEMD raster 표출 + 슬라이더/범례/재생
 *   - 동일 레이어 다시 클릭 시 OFF
 *
 * [잠금 패턴]
 *   기본 토글 클릭 시 토스트 안내 + 차단.
 *   3초 idle 안에 10회 연속 클릭하면 그 세션 동안 잠금 해제.
 *
 * [의존]
 *   - OpenLayers 6+ (ol.layer.Image, ol.source.ImageStatic, ol.proj)
 *   - window._showOceanToast (index2_patch.js)
 *   - window.__getOceanMap (ocean_map.js 가 노출)
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

    // 범례 — KMA raster 픽셀 sampling 으로 추출한 정확한 색상 (12 frame 합산 통계).
    // sky 는 해상 단기예보에 DB02 미사용 → 3단계만 (marine.kma.go.kr 와 동일)
    var SKY_LEGEND = [
        { label: '맑음',     color: 'rgba(255, 255, 255, 0.85)' },
        { label: '구름많음', color: 'rgba(174, 200, 224, 0.85)' },
        { label: '흐림',     color: 'rgba(56,  120, 152, 0.85)' }   // KMA #387898
    ];
    // pty: 강수형태 3종 — KMA raster 색상 추출
    var PTY_LEGEND = [
        { label: '비',     color: '#60d47e' },   // 녹  (KMA raster 비율 99%)
        { label: '비/눈', color: '#3dc4e6' },   // 청록
        { label: '눈',     color: '#8e8ee6' }    // 보라
    ];
    // pop: 강수확률 0/20/40/60/80/100% — KMA raster 색상 + 임계값별 매핑
    var POP_LEGEND = [
        { label: '0',         color: '#ffea6e' },   // 연노랑 (베이스)
        { label: '20',        color: '#ffdc1f' },   // 진노랑
        { label: '40',        color: '#69fc69' },   // 연녹
        { label: '60',        color: '#00a400' },   // 진녹
        { label: '80',        color: '#1f219d' },   // 남
        { label: '100 (%)',   color: '#8e8ee6' }    // 보라 (raster 외삽)
    ];
    // pcp: 강수량 0/0.8/4/9/30/80/700 mm — KMA raster + 임계값
    var PCP_LEGEND = [
        { label: '0.0',       color: '#ffffff' },   // 흰 (무강수)
        { label: '0.8',       color: '#ffea6e' },   // 연노랑
        { label: '4.0',       color: '#ffdc1f' },   // 진노랑
        { label: '9.0',       color: '#69fc69' },   // 연녹
        { label: '30',        color: '#00a400' },   // 진녹
        { label: '80',        color: '#3ec1ff' },   // 청
        { label: '700 (mm)',  color: '#1f219d' }    // 남 (raster #1f219d 빈도 매우 낮음 → 극값)
    ];
    // sno: 적설 0.1/0.8/4/9/18/40/90 cm
    var SNO_LEGEND = [
        { label: '0.1',       color: '#ffffff' },
        { label: '0.8',       color: '#ffea6e' },
        { label: '4.0',       color: '#ffdc1f' },
        { label: '9.0',       color: '#69fc69' },
        { label: '18',        color: '#00a400' },
        { label: '40',        color: '#3ec1ff' },
        { label: '90 (cm)',   color: '#1f219d' }
    ];
    var LEGEND_DEF = {
        sky: { title: '하늘상태', items: SKY_LEGEND },
        pty: { title: '강수형태', items: PTY_LEGEND },
        pop: { title: '강수확률', items: POP_LEGEND },
        pcp: { title: '강수량',   items: PCP_LEGEND },
        sno: { title: '적설',     items: SNO_LEGEND }
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
                    frames.push({ url: imgs[i], label: fmtFcstTm(times[i]) });
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
        // 사용자 요청: 제목(예: "하늘상태") 미표시. 항목만 가로로 나열.
        // CSS .shrt-fcst-legend 가 display:flex 라 자동으로 가로 정렬.
        var html = '';
        for (var i = 0; i < def.items.length; i++) {
            var it = def.items[i];
            html += '<div class="shrt-fcst-legend-row">'
                  +   '<span class="shrt-swatch" style="background:' + it.color + ';"></span>'
                  +   '<span>' + it.label + '</span></div>';
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
        state.activeType = null;
        state.frames = [];
        state.frameIdx = 0;
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
                    _toast('기타 기상 잠금 해제됨 (검수 모드)');
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
