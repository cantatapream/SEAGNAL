/**
 * ============================================================================
 * 파일명: js/shrt_forecast_layer.js
 * 역할: KMA 단기예보 PNG 래스터 오버레이 (강수확률/강수량/적설/하늘상태/강수형태)
 * ============================================================================
 *
 * [데이터 소스]
 *   - imgList (시간대별 PNG 경로):
 *       GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/shrt/imgList?shrtType={pop|pcp|sno|sky|pty}
 *       응답: { code, msg, data: { fct_tm_list:[...], img_list:[...] } }
 *   - PNG 본체:
 *       https://marine.kma.go.kr + img_list[i]
 *       포맷: 959x1186 RGBA (투명 배경)
 *       지리범위 (EPSG:4326 lon-lat): [123.2770767211914, 31.580740724291122,
 *                                      132.8739022435368,  43.44957733154297]
 *       — DFS 격자(동네예보) 기반 한반도+근해 영역. PNG aspect 정확히 일치.
 *
 * [UI 구성]
 *   - 우측 컨트롤 stack 의 "기타 기상" 버튼 (#ocean-other-wx-toggle-btn)
 *     클릭 시 좌측으로 5개 서브버튼 팝아웃
 *   - 서브버튼 클릭 시 팝아웃 닫힘 + 해당 레이어 표출 + 슬라이더/범례/재생버튼 표출
 *   - 동일 레이어 다시 클릭 시 OFF
 *
 * [의존]
 *   - OpenLayers (ol.layer.Image, ol.source.ImageStatic, ol.proj)
 *   - window.oceanMap (ocean_map.js 가 빌드 후 전역 노출)
 *
 * [상태]
 *   현재 1단계: sky(하늘상태) 레이어만 활성. 나머지 4개 버튼은 클릭하면 안내 후 무시.
 *   추후 단계에서 카테고리별 색상 매핑/범례 정의를 추가하여 활성화.
 * ============================================================================
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // 상수 / 설정
    // ─────────────────────────────────────────────────────────────

    var KMA_BASE = 'https://marine.kma.go.kr';
    var IMG_LIST_URL = KMA_BASE + '/mmis_marine_api/v1/kma/shrt/imgList';

    // DFS 단기예보 PNG 의 EPSG:4326 extent (lon-lat).
    // — chunk-common 번들 분석 + PNG aspect 검증으로 확정.
    var DFS_EXTENT_4326 = [
        123.2770767211914,
        31.580740724291122,
        132.8739022435368,
        43.44957733154297
    ];

    // 재생 간격 (ms) — 너무 빠르면 PNG 로드 못 따라감
    var PLAY_INTERVAL_MS = 500;

    // 활성 레이어 일람 (1단계 sky 만 ON)
    var ENABLED_TYPES = { sky: true };

    var TYPE_LABELS = {
        pop: '강수확률',
        pcp: '강수량',
        sno: '적설',
        sky: '하늘상태',
        pty: '강수형태'
    };

    // sky(하늘상태) 범례 — KMA 단기예보 SKY 카테고리:
    //   1=맑음, 3=구름많음, 4=흐림  (2 는 정의되지 않아 미사용)
    // marine.kma.go.kr 의 sky 색상과 동일한 톤으로 매핑.
    var LEGEND_DEF = {
        sky: {
            title: '하늘상태',
            items: [
                { label: '맑음',     color: 'rgba(255, 255, 255, 0.95)' },
                { label: '구름많음', color: 'rgba(174, 200, 224, 0.95)' },
                { label: '흐림',     color: 'rgba( 99, 138, 178, 0.95)' }
            ]
        }
        // pop/pcp/sno/pty 는 추후 단계에서 추가
    };

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    // ─────────────────────────────────────────────────────────────

    var state = {
        oceanMap: null,
        activeType: null,            // 'sky' | 'pop' | ... | null
        frames: [],                  // [{ url, label }]
        frameIdx: 0,
        layer: null,                 // ol.layer.Image
        playing: false,
        playTimer: null,
        preloadedImgs: {}            // url → HTMLImageElement (간단 캐시)
    };

    var initialized = false;

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    function $(id) { return document.getElementById(id); }

    function fmtFcstTm(s) {
        // "2026.05.02 14:00" → "5.2.(금) 14:00"
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

    function updateTooltip() {
        var tip = $('shrt-fcst-tooltip');
        var slider = $('shrt-fcst-slider');
        if (!tip || !slider) return;
        var idx = parseInt(slider.value, 10) || 0;
        var frame = state.frames[idx];
        tip.textContent = frame ? frame.label : '';
        // 슬라이더 thumb 위치에 정렬
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = max > min ? ((idx - min) / (max - min)) : 0;
        var w = slider.getBoundingClientRect().width;
        var thumbHalf = 9;
        var left = thumbHalf + pct * (w - thumbHalf * 2);
        tip.style.left = left + 'px';
    }

    function getOceanMap() {
        if (state.oceanMap) return state.oceanMap;
        // ocean_map.js 는 클로저 내부에 oceanMap 을 두지만, 외부 접근용으로
        // window.oceanMap 등을 명시적으로 노출하지는 않는다. 우회:
        //   ol.Map 인스턴스는 #ocean-map 에 attach 되므로 ol.Map.fromTarget 비슷한
        //   접근이 안 되는 OL 버전 대비, ocean_map.js 가 노출하는 setter 가 있으면 사용.
        if (window.__getOceanMap && typeof window.__getOceanMap === 'function') {
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

        var src = new ol.source.ImageStatic({
            url: url,
            crossOrigin: 'anonymous',
            imageExtent: DFS_EXTENT_4326,
            projection: 'EPSG:4326'
        });

        if (!state.layer) {
            state.layer = new ol.layer.Image({
                source: src,
                opacity: 0.7,
                zIndex: 50           // 베이스맵(<10) 위, 마커/팝업(<200) 아래
            });
            map.addLayer(state.layer);
        } else {
            state.layer.setSource(src);
        }
    }

    function removeLayer() {
        var map = getOceanMap();
        if (state.layer && map) {
            map.removeLayer(state.layer);
        }
        state.layer = null;
    }

    function preloadFrame(url) {
        if (state.preloadedImgs[url]) return;
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = KMA_BASE + url;     // url 은 /resources/... 로 시작
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
        return fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'omit'
        }).then(function (r) {
            if (!r.ok) throw new Error('imgList HTTP ' + r.status);
            return r.json();
        }).then(function (j) {
            if (!j || j.code !== '0000' || !j.data) {
                throw new Error('imgList bad response: ' + (j && j.msg));
            }
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
    // 재생 컨트롤
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
        if (state.playing) return;
        if (!state.frames.length) return;
        state.playing = true;
        setPlayBtnIcon(true);
        state.playTimer = setInterval(function () {
            var next = state.frameIdx + 1;
            if (next >= state.frames.length) next = 0;   // loop
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

    function togglePlay() {
        if (state.playing) stopPlay();
        else startPlay();
    }

    // ─────────────────────────────────────────────────────────────
    // 범례
    // ─────────────────────────────────────────────────────────────

    function renderLegend(shrtType) {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        var def = LEGEND_DEF[shrtType];
        if (!def) {
            lg.innerHTML = '';
            lg.style.display = 'none';
            lg.setAttribute('aria-hidden', 'true');
            return;
        }
        var html = '<div class="shrt-fcst-legend-title">' + def.title + '</div>';
        for (var i = 0; i < def.items.length; i++) {
            var it = def.items[i];
            html += '<div class="shrt-fcst-legend-row">'
                  +   '<span class="shrt-swatch" style="background:' + it.color + ';"></span>'
                  +   '<span>' + it.label + '</span>'
                  + '</div>';
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

    // ─────────────────────────────────────────────────────────────
    // 슬라이더 표출/숨김
    // ─────────────────────────────────────────────────────────────

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
        updateTooltip();
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
        // 서브버튼 active 해제
        var items = document.querySelectorAll('.ocean-other-wx-item.active');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        state.activeType = null;
        state.frames = [];
        state.frameIdx = 0;
    }

    function activate(shrtType) {
        // 같은 타입 재클릭 → OFF
        if (state.activeType === shrtType) {
            deactivate();
            return;
        }
        // 다른 타입으로 전환 — 일단 정리 후 재구성
        deactivate();
        state.activeType = shrtType;

        // 서브버튼 active 표시
        var btn = document.querySelector('.ocean-other-wx-item[data-shrt="' + shrtType + '"]');
        if (btn) btn.classList.add('active');

        fetchImgList(shrtType).then(function (frames) {
            if (state.activeType !== shrtType) return;   // 도중 취소
            if (!frames.length) {
                console.warn('[shrt] no frames for', shrtType);
                deactivate();
                return;
            }
            state.frames = frames;
            state.frameIdx = 0;

            // 슬라이더/범례 표출
            showSliderBar(frames.length);
            renderLegend(shrtType);

            // 첫 프레임 즉시 표출 + 백그라운드 프리로드
            showFrame(0);
            for (var i = 0; i < frames.length; i++) preloadFrame(frames[i].url);
        }).catch(function (e) {
            console.error('[shrt] fetch failed:', e);
            deactivate();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 팝아웃 토글 + 서브버튼 바인딩
    // ─────────────────────────────────────────────────────────────

    // [잠금 해제 패턴] 일반 사용자에게는 토스트로 미구현 안내,
    // 토글 버튼을 10회 연속 클릭하면 그 세션 동안 잠금 해제 (개발/검수용).
    // — 마지막 클릭으로부터 RESET_MS 이상 지나면 카운터 초기화.
    var UNLOCK_CLICKS = 10;
    var RESET_MS = 3000;
    var _unlocked = false;
    var _clickCount = 0;
    var _resetTimer = null;

    function _toast(msg) {
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(msg, 'bottom', 1800, false);
        } else {
            // 폴백 — _showOceanToast 가 아직 init 전인 초반 클릭
            console.log('[shrt-toast]', msg);
        }
    }

    function bindUi() {
        var wrap = $('ocean-other-wx-wrap');
        var toggleBtn = $('ocean-other-wx-toggle-btn');
        var popup = $('ocean-other-wx-popup');
        if (!wrap || !toggleBtn || !popup) return;

        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();

            // 잠금 상태: 토스트만 띄우고 클릭 카운트 누적 — 10회 도달 시 해제
            if (!_unlocked) {
                _clickCount++;
                clearTimeout(_resetTimer);
                _resetTimer = setTimeout(function () { _clickCount = 0; }, RESET_MS);

                if (_clickCount >= UNLOCK_CLICKS) {
                    _unlocked = true;
                    _clickCount = 0;
                    clearTimeout(_resetTimer);
                    _toast('기타 기상 잠금 해제됨 (검수 모드)');
                    // 첫 해제 클릭은 그대로 팝아웃 열기
                    wrap.classList.add('popup-open');
                    popup.setAttribute('aria-hidden', 'false');
                    return;
                }
                _toast('미구현 상태입니다.');
                return;
            }

            // 잠금 해제 후 일반 토글 동작
            wrap.classList.toggle('popup-open');
            popup.setAttribute('aria-hidden', wrap.classList.contains('popup-open') ? 'false' : 'true');
        });

        // 팝업 외부 클릭 시 닫힘
        document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) {
                wrap.classList.remove('popup-open');
                popup.setAttribute('aria-hidden', 'true');
            }
        });

        // 서브버튼 클릭
        var items = popup.querySelectorAll('.ocean-other-wx-item');
        items.forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                var t = item.getAttribute('data-shrt');
                wrap.classList.remove('popup-open');
                popup.setAttribute('aria-hidden', 'true');

                if (!ENABLED_TYPES[t]) {
                    alert(TYPE_LABELS[t] + ' 레이어는 준비 중입니다. (현재 단계: 하늘상태만 활성)');
                    return;
                }
                activate(t);
            });
        });

        // 슬라이더 입력
        var slider = $('shrt-fcst-slider');
        if (slider) {
            slider.addEventListener('input', function () {
                stopPlay();
                showFrame(parseInt(slider.value, 10) || 0);
            });
        }

        // 재생/일시정지
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
    // 초기화 — ocean_map.js 가 buildMap 직후 호출
    // ─────────────────────────────────────────────────────────────

    window.initShrtForecastLayer = function (oceanMap) {
        if (initialized) return;
        initialized = true;
        if (oceanMap) state.oceanMap = oceanMap;
        bindUi();
    };
})();
