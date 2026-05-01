/**
 * ============================================================================
 * 파일명: js/shrt_forecast_layer.js
 * 역할: KMA 단기예보 PNG (육상) + 해상예특보구역 polygon fill (해상) 합성 오버레이
 * ============================================================================
 *
 * [완성 단계: 5개 카테고리 × (육상 PNG + 해상 zone polygon fill) 합성]
 *   - 카테고리: 강수확률(pop) / 강수량(pcp) / 적설(sno) / 하늘상태(sky) / 강수형태(pty)
 *   - 육상: marine.kma.go.kr 의 DFS_SHRT_GRD_GRB5_*.png (한반도 + 도서)
 *   - 해상: sea/sterm/list 의 sky_sts_cd / prcpt_yn 으로 44개 zone polygon fill
 *
 * [데이터 소스]
 *   1) PNG 시간 리스트:   GET /mmis_marine_api/v1/kma/shrt/imgList?shrtType=
 *   2) PNG 본체:          GET /resources/fct/shrt_img/YYYYMM/DD/HH/DFS_SHRT_GRD_GRB5_*.png
 *      extent (EPSG:4326): [123.277, 31.581, 132.874, 43.450]
 *   3) 해상 zone 데이터:  GET /mmis_marine_api/v1/kma/fct/sea/sterm/list
 *                         ?annc_time={KSTYYYYMMDDhhmm}&ef_no={0~7}&zoom=15
 *      발표: KST 05/11/17/23 (6h 간격), ef_no 0~7 = 12h 단위 오전/오후
 *      필드: sky_sts_cd (DB01-04), sky_sts_nm, prcpt_yn (Y/N)
 *   4) 해상 zone polygon: /api/warn-zones (SEAGNAL 자체 GeoJSON, 44개)
 *
 * [잠금 패턴]
 *   기본은 토글 클릭 시 토스트 안내 + 차단. 3초 idle 안에 10회 연속 클릭하면
 *   세션 한정으로 잠금 해제.
 *
 * [의존]
 *   - OpenLayers 6+ (ol.layer.Image, ol.source.ImageStatic, ol.layer.Vector,
 *     ol.format.GeoJSON, ol.style.*)
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
    var IMG_LIST_URL  = KMA_BASE + '/mmis_marine_api/v1/kma/shrt/imgList';
    var SEA_LIST_URL  = KMA_BASE + '/mmis_marine_api/v1/kma/fct/sea/sterm/list';
    var SEA_DETAIL_URL = KMA_BASE + '/mmis_marine_api/v1/kma/fct/sea/sterm/detail';

    // DFS 단기예보 PNG extent (EPSG:4326 lon-lat)
    var DFS_EXTENT_4326 = [
        123.2770767211914,
        31.580740724291122,
        132.8739022435368,
        43.44957733154297
    ];

    var PLAY_INTERVAL_MS = 500;

    // 5개 카테고리 모두 활성 — 잠금 해제 후 사용.
    var ENABLED_TYPES = { sky: true, pty: true, pop: true, pcp: true, sno: true };

    var TYPE_LABELS = {
        pop: '강수확률', pcp: '강수량', sno: '적설',
        sky: '하늘상태', pty: '강수형태'
    };

    // ── 색상 팔레트 ───────────────────────────────────────────────
    // sky 카테고리: KMA 표준 SKY 코드 DB01~DB04 (4개 정의되어 있으나
    // 해상 단기예보 sterm 응답에는 DB02 가 발표되지 않음 — 2024개 응답
    // 전수 조사 결과 DB01/DB03/DB04 만 등장. marine.kma.go.kr 도 범례를
    // 3개로 표시. 향후 등장 시 대비해 색상 정의는 유지하고 범례만 3개 노출.)
    var SKY_COLOR = {
        DB01: 'rgba(255, 255, 255, 0.85)',    // 맑음
        DB02: 'rgba(220, 232, 244, 0.85)',    // 구름조금 (해상 sterm 미사용)
        DB03: 'rgba(174, 200, 224, 0.85)',    // 구름많음
        DB04: 'rgba(99,  138, 178, 0.85)'     // 흐림
    };
    // sky 범례 — 해상 단기예보 실제 발표 카테고리 3종만 (marine.kma.go.kr 와 동일)
    var SKY_LEGEND = [
        { code: 'DB01', label: '맑음',     color: SKY_COLOR.DB01 },
        { code: 'DB03', label: '구름많음', color: SKY_COLOR.DB03 },
        { code: 'DB04', label: '흐림',     color: SKY_COLOR.DB04 }
    ];
    // pty (강수형태) — 해상은 prcpt_yn 만 있어 binary. 육상 PNG 가 정밀 표현.
    var PTY_LEGEND = [
        { label: '강수 없음', color: 'rgba(255,255,255,0.0)' },
        { label: '비/눈',     color: 'rgba(99,138,178,0.55)' }
    ];
    // pop / pcp / sno — 해상 정량 데이터 없음. 해상 zone 은 prcpt_yn 만으로 단순 fill.
    var POP_LEGEND = [
        { label: '강수 가능성',   color: 'rgba(99,138,178,0.45)' },
        { label: '(육상 정량은 PNG 참고)', color: null }
    ];
    var PCP_LEGEND = [
        { label: '강수 영역',     color: 'rgba(99,138,178,0.45)' },
        { label: '(육상 정량은 PNG 참고)', color: null }
    ];
    var SNO_LEGEND = [
        { label: '강수 영역',     color: 'rgba(99,138,178,0.45)' },
        { label: '(해상 적설 데이터 없음)', color: null }
    ];

    var LEGEND_DEF = {
        sky: { title: '하늘상태', items: SKY_LEGEND },
        pty: { title: '강수형태', items: PTY_LEGEND },
        pop: { title: '강수확률', items: POP_LEGEND },
        pcp: { title: '강수량',   items: PCP_LEGEND },
        sno: { title: '적설',     items: SNO_LEGEND }
    };

    // ── zone 이름 정규화 매핑 (warn_zones.geojson ↔ KMA kor_nm) ──
    // 대부분 일치. 차이: 가운뎃점/마침표, "인천·경기" vs "경기" 표기.
    function normalizeZoneName(s) {
        if (!s) return '';
        return s.replace(/[\s.·]/g, '');
    }
    // 정규화 후에도 다른 2건은 수동 매핑.
    var MANUAL_NAME_MAP = {
        // local geojson name → KMA kor_nm
        '인천경기북부앞바다': '경기북부앞바다',
        '인천경기남부앞바다': '인천경기남부앞바다'   // KMA 의 정규화 결과와 동일
    };

    // ── 잠금 해제 패턴 ───────────────────────────────────────────
    var UNLOCK_CLICKS = 10;
    var RESET_MS = 3000;

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    // ─────────────────────────────────────────────────────────────

    var state = {
        oceanMap: null,
        activeType: null,            // 'sky' | 'pop' | ... | null
        frames: [],                  // [{ url, label, kstDate, ampm }]
        frameIdx: 0,
        layer: null,                 // ol.layer.Image (PNG)
        zoneLayer: null,             // ol.layer.Vector (해상 zone polygon)
        zoneFeaturesByName: null,    // normalizedName → ol.Feature[]
        zoneGeoJsonLoaded: false,
        playing: false,
        playTimer: null,
        preloadedImgs: {},
        // 해상 sterm 데이터: ef_no(0..7) → { zoneName(norm) → {sky_sts_cd, prcpt_yn, sky_sts_nm} }
        seaByEfNo: null,
        // ef_no(0..7) → "YYYY.MM.DD 오전/오후" (annc_nm)
        efNoToAnncNm: null,
        annc_time: null
    };

    var _unlocked = false;
    var _clickCount = 0;
    var _resetTimer = null;

    var initialized = false;

    // ─────────────────────────────────────────────────────────────
    // 공통 유틸
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
        // "2026.05.02 14:00" → { label, kstDate(Date), ampm('오전'|'오후') }
        if (!s) return null;
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return null;
        var year = +m[1], mon = +m[2], day = +m[3], hh = +m[4], mm = +m[5];
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(year, mon - 1, day, hh, mm);
        var label = mon + '.' + day + '.(' + DAYS[d.getDay()] + ') ' + m[4] + ':' + m[5];
        var ampm = (hh < 12) ? '오전' : '오후';
        var anncNm = year + '.' + m[2] + '.' + m[3] + ' ' + ampm;
        return { label: label, kstDate: d, ampm: ampm, anncNm: anncNm };
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
        if (typeof window.__getOceanMap === 'function') {
            state.oceanMap = window.__getOceanMap();
        }
        return state.oceanMap;
    }

    // ─────────────────────────────────────────────────────────────
    // 가장 최근 sterm 발표시각 결정 (KST 05/11/17/23, 6h 간격)
    // ─────────────────────────────────────────────────────────────
    function getLatestAnncTimeKST() {
        // KMA 발표시각 KST 05, 11, 17, 23.
        // 발행 후 약간 지연(검증)이 있을 수 있으므로 안전마진 -10분 적용 후 가장 최근 시각 채택.
        var now = new Date();
        var kstNow = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000);
        kstNow.setMinutes(kstNow.getMinutes() - 10);

        var SCHEDULE = [23, 17, 11, 5];
        var y = kstNow.getFullYear(), mo = kstNow.getMonth(), d = kstNow.getDate();
        var h = kstNow.getHours();
        for (var i = 0; i < SCHEDULE.length; i++) {
            if (h >= SCHEDULE[i]) {
                return _fmtAnnc(y, mo + 1, d, SCHEDULE[i]);
            }
        }
        // 새벽 0~04시 → 전날 23시 발표
        var prev = new Date(y, mo, d - 1);
        return _fmtAnnc(prev.getFullYear(), prev.getMonth() + 1, prev.getDate(), 23);
    }
    function _fmtAnnc(y, m, d, h) {
        function pad2(n) { return String(n).padStart(2, '0'); }
        return '' + y + pad2(m) + pad2(d) + pad2(h) + '00';
    }

    // ─────────────────────────────────────────────────────────────
    // PNG 레이어 빌드 / 갱신
    // ─────────────────────────────────────────────────────────────

    function buildOrUpdateImageLayer(url) {
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
                zIndex: 50
            });
            map.addLayer(state.layer);
        } else {
            state.layer.setSource(src);
        }
    }

    function removeImageLayer() {
        var map = getOceanMap();
        if (state.layer && map) map.removeLayer(state.layer);
        state.layer = null;
    }

    function preloadImg(url) {
        if (state.preloadedImgs[url]) return;
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = KMA_BASE + url;
        state.preloadedImgs[url] = img;
    }

    // ─────────────────────────────────────────────────────────────
    // 해상 zone polygon 레이어
    // ─────────────────────────────────────────────────────────────

    function ensureZoneLayer() {
        var map = getOceanMap();
        if (!map || state.zoneLayer) return Promise.resolve();
        if (state.zoneGeoJsonLoaded) return Promise.resolve();

        return fetch('/api/warn-zones')
            .then(function (r) { return r.ok ? r.json() : Promise.reject('warn-zones HTTP ' + r.status); })
            .then(function (gj) {
                var features = new ol.format.GeoJSON().readFeatures(gj, {
                    dataProjection:    'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });
                // ground=='sea' 인 44개만 이용
                features = features.filter(function (f) {
                    return f.get('ground') === 'sea';
                });

                // 정규화된 name → feature 매핑 캐시
                state.zoneFeaturesByName = {};
                features.forEach(function (f) {
                    var n = normalizeZoneName(f.get('name'));
                    (state.zoneFeaturesByName[n] = state.zoneFeaturesByName[n] || []).push(f);
                });

                var src = new ol.source.Vector({ features: features });
                state.zoneLayer = new ol.layer.Vector({
                    source: src,
                    zIndex: 49,                           // PNG 보다 약간 아래 (PNG 가 land 만 cover, 해상에는 PNG 가 거의 투명이므로 zone fill 이 자연스럽게 보임)
                    style: zoneStyleFn
                });
                map.addLayer(state.zoneLayer);
                state.zoneGeoJsonLoaded = true;
            });
    }

    // 현재 활성 타입 + 현재 ef_no 의 데이터를 기반으로 feature 의 fill 색을 결정.
    function zoneStyleFn(feature) {
        var data = _currentZoneData(feature);
        if (!data) {
            return new ol.style.Style({
                fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),
                stroke: null
            });
        }
        var color = _zoneFillColor(state.activeType, data);
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: color }),
            stroke: null     // outline 은 ocean_warn_zone.js 가 별도로 그림
        });
    }

    function _currentZoneData(feature) {
        if (!state.seaByEfNo || !state.efNoToAnncNm) return null;
        var frame = state.frames[state.frameIdx];
        if (!frame) return null;
        var ef = _frameToEfNo(frame);
        if (ef == null) return null;
        var byZone = state.seaByEfNo[ef];
        if (!byZone) return null;
        var localName = feature.get('name');
        var key = MANUAL_NAME_MAP[normalizeZoneName(localName)] || normalizeZoneName(localName);
        return byZone[normalizeZoneName(key)] || null;
    }

    function _zoneFillColor(type, zoneData) {
        if (type === 'sky') {
            return SKY_COLOR[zoneData.sky_sts_cd] || 'rgba(0,0,0,0)';
        }
        // pty/pop/pcp/sno: 해상 정량 데이터 없음. prcpt_yn=Y zone 만 단색 fill.
        var hasPrec = zoneData.prcpt_yn === '1' || zoneData.prcpt_yn === 'Y';
        if (type === 'pty')      return hasPrec ? 'rgba(99,138,178,0.55)' : 'rgba(0,0,0,0)';
        if (type === 'pop')      return hasPrec ? 'rgba(99,138,178,0.45)' : 'rgba(0,0,0,0)';
        if (type === 'pcp')      return hasPrec ? 'rgba(99,138,178,0.45)' : 'rgba(0,0,0,0)';
        if (type === 'sno')      return hasPrec ? 'rgba(99,138,178,0.45)' : 'rgba(0,0,0,0)';
        return 'rgba(0,0,0,0)';
    }

    function _frameToEfNo(frame) {
        // frame.anncNm = "YYYY.MM.DD 오전/오후" — efNoToAnncNm 의 값과 매칭
        if (!state.efNoToAnncNm) return null;
        var keys = Object.keys(state.efNoToAnncNm);
        for (var i = 0; i < keys.length; i++) {
            if (state.efNoToAnncNm[keys[i]] === frame.anncNm) return +keys[i];
        }
        // 매칭 없음 (frame 시각이 발표 cover 범위 밖) → null 반환 → fill 안 함
        return null;
    }

    function refreshZoneStyle() {
        if (!state.zoneLayer) return;
        // OL 6+: getSource().changed() 로 style 재평가 트리거
        state.zoneLayer.changed();
    }

    function removeZoneLayer() {
        var map = getOceanMap();
        if (state.zoneLayer && map) map.removeLayer(state.zoneLayer);
        state.zoneLayer = null;
        state.zoneGeoJsonLoaded = false;
        state.zoneFeaturesByName = null;
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
                    var f = fmtFcstTm(times[i]);
                    if (!f) continue;
                    f.url = imgs[i];
                    frames.push(f);
                }
                return frames;
            });
    }

    // 발표시각 + ef_no 0..7 list 호출 (병렬). 데이터 없는 발표시각이면 한 단계 이전으로 fallback.
    function fetchSeaSterm(annc_time) {
        var fetches = [];
        for (var ef = 0; ef < 8; ef++) (function (e) {
            var u = SEA_LIST_URL + '?annc_time=' + annc_time + '&ef_no=' + e + '&zoom=15';
            fetches.push(fetch(u, { credentials: 'omit' })
                .then(function (r) { return r.json(); })
                .then(function (j) { return { ef: e, items: (j && j.data) || [] }; })
                .catch(function () { return { ef: e, items: [] }; }));
        })(ef);

        return Promise.all(fetches).then(function (results) {
            var byEf = {};
            results.forEach(function (r) {
                var byZone = {};
                r.items.forEach(function (it) {
                    byZone[normalizeZoneName(it.kor_nm)] = {
                        sky_sts_cd: it.sky_sts_cd,
                        sky_sts_nm: it.sky_sts_nm,
                        prcpt_yn:   it.prcpt_yn
                    };
                });
                byEf[r.ef] = byZone;
            });
            return byEf;
        });
    }

    // detail 호출로 ef_no(0..7) → annc_nm 매핑 얻기 (단일 zone 으로 충분).
    function fetchEfNoTimeMap(annc_time) {
        // 임의 zone (44개 중 어느 것이든 동일 매핑)
        var sampleZone = '12B20220';
        var u = SEA_DETAIL_URL + '?zone_id=' + sampleZone + '&annc_time=' + annc_time;
        return fetch(u, { credentials: 'omit' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var map = {};
                ((j && j.data) || []).forEach(function (it) {
                    map[it.ef_no] = it.annc_nm;
                });
                return map;
            }).catch(function () { return {}; });
    }

    // 데이터 있는 가장 최근 발표시각 찾기 (현재 시각 → fallback 최대 4단계).
    function findValidAnncTime() {
        var candidates = [];
        var t = getLatestAnncTimeKST();
        candidates.push(t);
        // 6시간 단위 4단계 fallback
        for (var i = 1; i <= 4; i++) {
            candidates.push(_shiftAnncHours(t, -6 * i));
        }

        function tryNext(idx) {
            if (idx >= candidates.length) return Promise.resolve(null);
            var at = candidates[idx];
            return fetch(SEA_LIST_URL + '?annc_time=' + at + '&ef_no=0&zoom=15', { credentials: 'omit' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (j && j.data && j.data.length > 0) return at;
                    return tryNext(idx + 1);
                })
                .catch(function () { return tryNext(idx + 1); });
        }
        return tryNext(0);
    }

    function _shiftAnncHours(at, dh) {
        // at = "YYYYMMDDhhmm"
        var y = +at.substr(0,4), mo = +at.substr(4,2)-1, d = +at.substr(6,2),
            h = +at.substr(8,2), mi = +at.substr(10,2);
        var dt = new Date(y, mo, d, h, mi);
        dt.setHours(dt.getHours() + dh);
        return _fmtAnnc(dt.getFullYear(), dt.getMonth()+1, dt.getDate(), dt.getHours());
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
    // 프레임 표출
    // ─────────────────────────────────────────────────────────────

    function showFrame(idx) {
        if (!state.frames.length) return;
        if (idx < 0) idx = 0;
        if (idx >= state.frames.length) idx = state.frames.length - 1;
        state.frameIdx = idx;
        var frame = state.frames[idx];
        buildOrUpdateImageLayer(KMA_BASE + frame.url);
        refreshZoneStyle();
        var slider = $('shrt-fcst-slider');
        if (slider) {
            slider.value = String(idx);
            setSliderProgress(slider);
        }
        updateTooltip();
    }

    // ─────────────────────────────────────────────────────────────
    // 범례
    // ─────────────────────────────────────────────────────────────

    function renderLegend(shrtType) {
        var lg = $('shrt-fcst-legend');
        if (!lg) return;
        var def = LEGEND_DEF[shrtType];
        if (!def) { lg.innerHTML = ''; lg.style.display = 'none'; return; }
        var html = '<div class="shrt-fcst-legend-title">' + def.title + '</div>';
        for (var i = 0; i < def.items.length; i++) {
            var it = def.items[i];
            html += '<div class="shrt-fcst-legend-row">';
            if (it.color) {
                html += '<span class="shrt-swatch" style="background:' + it.color + ';"></span>';
            } else {
                html += '<span class="shrt-swatch" style="visibility:hidden"></span>';
            }
            html += '<span>' + it.label + '</span></div>';
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
        removeImageLayer();
        // zone layer 는 유지하되 style 만 무효 — 카테고리 전환 시 재사용
        if (state.zoneLayer) {
            state.activeType = null;
            state.zoneLayer.changed();
        }
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
        state.activeType = shrtType;

        var btn = document.querySelector('.ocean-other-wx-item[data-shrt="' + shrtType + '"]');
        if (btn) btn.classList.add('active');

        // 1) zone layer 준비 (1회만)
        // 2) PNG imgList + 해상 sterm + ef_no 매핑 병렬 fetch
        // 3) 모두 준비되면 첫 프레임 표출
        Promise.all([
            ensureZoneLayer(),
            fetchImgList(shrtType),
            findValidAnncTime().then(function (at) {
                if (!at) return { byEf: {}, efMap: {}, at: null };
                return Promise.all([fetchSeaSterm(at), fetchEfNoTimeMap(at)])
                    .then(function (rs) { return { byEf: rs[0], efMap: rs[1], at: at }; });
            })
        ]).then(function (results) {
            if (state.activeType !== shrtType) return;   // 도중 취소
            var frames    = results[1];
            var seaResult = results[2];

            if (!frames.length) {
                console.warn('[shrt] no frames for', shrtType);
                deactivate();
                return;
            }
            state.frames = frames;
            state.frameIdx = 0;
            state.seaByEfNo = seaResult.byEf;
            state.efNoToAnncNm = seaResult.efMap;
            state.annc_time = seaResult.at;

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

            // 잠금 상태: 토스트 + 클릭 누적, 10회 도달 시 해제
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

        // 서브버튼 클릭
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
    // 초기화
    // ─────────────────────────────────────────────────────────────

    window.initShrtForecastLayer = function (oceanMap) {
        if (initialized) return;
        initialized = true;
        if (oceanMap) state.oceanMap = oceanMap;
        bindUi();
    };
})();
