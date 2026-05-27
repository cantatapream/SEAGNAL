/**
 * ============================================================================
 * 파일명: js/ocean_typhoon.js
 * 역할 : 해양종합 지도(OpenLayers)에 "태풍" 오버레이 + 재생 애니메이션을 표출.
 * ============================================================================
 *
 * [데이터 출처] GET /api/typhoon (routes/typhoon.js → data/typhoon.json)
 *   - active: 현재(최신) 태풍
 *   - bulletins[]: 통보문 회차별 { current, forecast[] } (드롭다운으로 선택)
 *   - 각 프레임: { time(YYYYMMDDHHmm), lat, lon, pressure, windMs, windKmh,
 *                 dir, speedKmh, radStrong(강풍반경), radStorm(폭풍반경),
 *                 radProb(70%확률반경), grade(0~5), size }
 *
 * [표출]
 *   1) 기본 ON: 스크린샷처럼 전체 진로 — 진로선 + 시점별 위치(강도색) +
 *      70%확률반경 원(예보 cone) + 라벨.
 *   2) 재생(▶): "현재 시각" 프레임에서 출발해 예보 시각 흐름을 따라 태풍이
 *      이동 — 위치/강풍·폭풍·확률 반경/강도색이 실제 예보시각 간격에 비례해
 *      부드럽게 보간되며 진행(이동속력 반영). 스크러버로 임의 시점 이동도 가능.
 *
 * [지도 연계]
 *   - window.getOceanMap() 로 ol.Map 인스턴스 획득 (js/ocean_map.js)
 *   - 좌표: 입력 EPSG:4326(경위도) → ol.proj.fromLonLat 로 EPSG:3857 변환
 *   - 토글 버튼: #ocean-typhoon-toggle-btn (index2.html .ocean-overlay-controls)
 *   - 컨트롤 패널: #ocean-typhoon-panel
 * ============================================================================
 */
(function () {
    'use strict';

    var VISIBLE_KEY = 'seagnal_typhoon_visible';
    var UNLOCK_KEY = 'seagnal_typhoon_unlocked';
    var TAP_THRESHOLD = 10;   // 비활성 버튼을 10회 탭하면 기능 활성화(히든 탭)
    var TAP_RESET_MS = 3000;  // 탭 간격이 이보다 길면 카운트 리셋
    var FULL_PLAY_MS = 12000; // 전체 타임라인 재생 시간(스크러버 0→끝)

    var _unlocked = false;
    var _tapCount = 0;
    var _tapTimer = null;

    // 줌 자동조정 기준점: 제주도(최소한 우리나라가 한 화면에 함께 보이도록 fit)
    var JEJU_LON = 126.53, JEJU_LAT = 33.43;
    var FIT_MAX_ZOOM = 8;

    var _pNow = 0;             // 현재 시각에 해당하는 타임라인 위치(0..1)

    var _map = null;
    var _staticLayer = null;   // 진로선 + 점 + 라벨
    var _coneLayer = null;     // 포인트별 70%확률반경 cone (재생 중에는 숨김)
    var _headLayer = null;     // 재생 플레이헤드(태풍 본체 + 보간 영향 원)
    var _staticSrc = null;
    var _coneSrc = null;
    var _headSrc = null;

    var _activeData = null;    // /api/typhoon 응답(현재연도 활성 태풍 + 통보문 인라인)
    var _year = null;          // 선택 연도
    var _typhoonList = [];     // 선택 연도의 태풍 목록 [{seq,name}]
    var _selSeq = null;        // 선택 태풍 seq
    var _bulletinList = [];    // 선택 태풍의 통보문 목록 [{code,label,...}]
    var _selCode = null;       // 선택 통보문 code
    var _tableCache = {};      // (year+'_'+code) -> {current,forecast,...}
    var _yearLoaded = false;   // 전체 연도 목록(dmdw on-demand) 확장 여부 — 표출 시 1회
    var _frames = [];          // 선택 통보문의 시계열 프레임 (시각 오름차순)
    var _visible = false;
    var _playing = false;
    var _p = 0;                // 0..1 (타임라인 위치)
    var _raf = null;
    var _lastTs = 0;
    var _bound = false;

    // ── 강도별 색상 (KMA 범례 근사) ──────────────────────────────────────────
    var GRADE_COLORS = {
        0: [154, 160, 166],  // 열대저압부(TD) — 회색
        1: [59, 130, 246],   // 약 — 파랑
        2: [34, 197, 94],    // 중 — 초록
        3: [234, 179, 8],    // 강 — 노랑
        4: [249, 115, 22],   // 매우 강 — 주황
        5: [239, 68, 68]     // 초강력 — 빨강
    };
    var GRADE_NAMES = { 0: '열대저압부', 1: '약', 2: '중', 3: '강', 4: '매우 강', 5: '초강력' };

    function gradeColor(g) { return GRADE_COLORS[g] || GRADE_COLORS[0]; }
    function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function lerpColor(c1, c2, t) {
        return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
    }

    // "YYYYMMDDHHmm" → 비교용 ms (절대 tz 무관, 단조 증가만 보장)
    function timeToMs(s) {
        if (!s) return NaN;
        var d = String(s).replace(/[^0-9]/g, '');
        if (d.length < 12) return NaN;
        return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12));
    }
    function fmtTime(s) {
        var d = String(s || '').replace(/[^0-9]/g, '');
        if (d.length < 12) return '';
        return d.slice(4, 6) + '.' + d.slice(6, 8) + ' ' + d.slice(8, 10) + ':' + d.slice(10, 12);
    }
    // timeToMs 가 KST 벽시계를 UTC 기준 ms 로 저장하므로, 되읽을 때도 getUTC* 사용.
    function fmtFromMs(ms) {
        if (!isFinite(ms)) return '';
        var d = new Date(ms);
        var mm = d.getUTCMonth() + 1, dd = d.getUTCDate(), hh = d.getUTCHours(), mi = d.getUTCMinutes();
        return mm + '/' + dd + ' ' + (hh < 10 ? '0' + hh : hh) + (mi ? ':' + (mi < 10 ? '0' + mi : mi) : '시');
    }
    // 현재(실시간) KST 벽시계를 timeToMs 와 동일한 ms 기준으로 반환
    function nowKstMs() {
        var d = new Date();
        var kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + 9 * 3600000);
        return Date.UTC(kst.getFullYear(), kst.getMonth(), kst.getDate(), kst.getHours(), kst.getMinutes());
    }
    // 현재 시각이 타임라인(첫~끝 프레임)에서 차지하는 위치 0..1
    function computeNowP() {
        if (_frames.length < 2) return 0;
        var t0 = _frames[0]._t, t1 = _frames[_frames.length - 1]._t;
        if (t1 <= t0) return 0;
        return Math.max(0, Math.min(1, (nowKstMs() - t0) / (t1 - t0)));
    }

    // 경위도(deg)·반경(km) → EPSG:3857 좌표 폴리곤 (구면 측지원, 72분할)
    function geoCircle(lon, lat, km, n) {
        n = n || 72;
        var R = 6371.0088;
        var d = km / R;
        var lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
        var ring = [];
        for (var i = 0; i <= n; i++) {
            var brng = 2 * Math.PI * i / n;
            var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
            var lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
            ring.push(ol.proj.fromLonLat([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]));
        }
        return new ol.geom.Polygon([ring]);
    }

    function pointAt(lon, lat) { return new ol.geom.Point(ol.proj.fromLonLat([lon, lat])); }

    // ── 프레임 구성 ──────────────────────────────────────────────────────────
    function buildFrames(bulletin) {
        var arr = [];
        if (bulletin.current && bulletin.current.lat != null) arr.push(bulletin.current);
        (bulletin.forecast || []).forEach(function (f) { if (f.lat != null) arr.push(f); });
        arr = arr.map(function (f) {
            return Object.assign({}, f, { _t: timeToMs(f.time), _color: gradeColor(f.grade) });
        }).filter(function (f) { return !isNaN(f._t); });
        arr.sort(function (a, b) { return a._t - b._t; });
        return arr;
    }

    // p(0..1) → 보간 프레임 (실제 예보시각 간격 비례)
    function frameAt(p) {
        if (!_frames.length) return null;
        if (_frames.length === 1) return Object.assign({}, _frames[0], { _gradeF: _frames[0].grade, _colorF: _frames[0]._color, _rtMs: _frames[0]._t });
        var t0 = _frames[0]._t, t1 = _frames[_frames.length - 1]._t;
        var rt = t0 + p * (t1 - t0);
        var i = 0;
        while (i < _frames.length - 1 && _frames[i + 1]._t <= rt) i++;
        var A = _frames[i], B = _frames[Math.min(i + 1, _frames.length - 1)];
        var span = (B._t - A._t) || 1;
        var f = Math.max(0, Math.min(1, (rt - A._t) / span));
        function n(a, b) { return (a == null || b == null) ? (a == null ? b : a) : lerp(a, b, f); }
        return {
            lat: lerp(A.lat, B.lat, f),
            lon: lerp(A.lon, B.lon, f),
            pressure: n(A.pressure, B.pressure),
            windMs: n(A.windMs, B.windMs),
            radStrong: n(A.radStrong, B.radStrong),
            radStorm: n(A.radStorm, B.radStorm),
            radProb: n(A.radProb, B.radProb),
            dir: (f < 0.5 ? A.dir : B.dir),
            speedKmh: n(A.speedKmh, B.speedKmh),
            size: (f < 0.5 ? A.size : B.size),
            _gradeF: Math.round(lerp(A.grade, B.grade, f)),
            _colorF: lerpColor(A._color, B._color, f),
            time: (f < 0.5 ? A.time : B.time),
            _rtMs: rt
        };
    }

    // ── 정적 진로 렌더 ────────────────────────────────────────────────────────
    function renderStatic() {
        if (!_staticSrc) return;
        _staticSrc.clear();
        if (_coneSrc) _coneSrc.clear();
        if (!_frames.length) return;

        var coords = _frames.map(function (f) { return ol.proj.fromLonLat([f.lon, f.lat]); });
        // 진로선
        var line = new ol.Feature(new ol.geom.LineString(coords));
        line.setStyle(new ol.style.Style({
            stroke: new ol.style.Stroke({ color: 'rgba(40,40,40,0.85)', width: 2, lineDash: [6, 5] })
        }));
        _staticSrc.addFeature(line);

        // 70% 확률반경 cone (예보 프레임만) — 전체 진로 개요용. 재생 중에는 _coneLayer 를
        // 숨기고, 태풍 본체에 붙은 보간 영향 원이 부드럽게 커지/작아지도록 한다.
        _frames.forEach(function (f) {
            if (f.radProb && f.radProb > 0) {
                var cf = new ol.Feature(geoCircle(f.lon, f.lat, f.radProb));
                cf.setStyle(new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: 'rgba(120,120,120,0.55)', width: 1 }),
                    fill: new ol.style.Fill({ color: 'rgba(150,150,150,0.07)' })
                }));
                _coneSrc.addFeature(cf);
            }
        });

        // 시점별 위치 점(강도색) + 라벨
        _frames.forEach(function (f, idx) {
            var c = f._color;
            var pt = new ol.Feature(pointAt(f.lon, f.lat));
            pt.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: f.isCurrent ? 7 : 5,
                    fill: new ol.style.Fill({ color: rgba(c, 0.95) }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: f.isCurrent ? 2.5 : 1.5 })
                }),
                text: new ol.style.Text({
                    text: fmtTime(f.time),
                    offsetY: -14, font: '11px sans-serif',
                    fill: new ol.style.Fill({ color: '#222' }),
                    stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 })
                })
            }));
            _staticSrc.addFeature(pt);
        });
    }

    // ── 재생 플레이헤드 렌더 ──────────────────────────────────────────────────
    function renderHead(p) {
        if (!_headSrc) return;
        _headSrc.clear();
        var f = frameAt(p);
        if (!f) return;
        var c = f._colorF || gradeColor(f._gradeF || 0);

        // 70% 확률반경 — 이동에 따라 보간되어 점차 커지/작아지는 영향 원(가장 바깥)
        if (f.radProb && f.radProb > 0) {
            var pf = new ol.Feature(geoCircle(f.lon, f.lat, f.radProb));
            pf.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: 'rgba(110,110,110,0.7)', width: 1, lineDash: [4, 4] }),
                fill: new ol.style.Fill({ color: 'rgba(150,150,150,0.06)' })
            }));
            _headSrc.addFeature(pf);
        }
        // 폭풍반경(25m/s) — 진한 색
        if (f.radStorm && f.radStorm > 0) {
            var sf = new ol.Feature(geoCircle(f.lon, f.lat, f.radStorm));
            sf.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: rgba(c, 0.9), width: 1.5 }),
                fill: new ol.style.Fill({ color: rgba(c, 0.28) })
            }));
            _headSrc.addFeature(sf);
        }
        // 강풍반경(15m/s) — 옅은 색
        if (f.radStrong && f.radStrong > 0) {
            var wf = new ol.Feature(geoCircle(f.lon, f.lat, f.radStrong));
            wf.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: rgba(c, 0.7), width: 1.5 }),
                fill: new ol.style.Fill({ color: rgba(c, 0.13) })
            }));
            _headSrc.addFeature(wf);
        }
        // 태풍 본체(소용돌이 느낌의 점)
        var head = new ol.Feature(pointAt(f.lon, f.lat));
        head.setStyle(new ol.style.Style({
            image: new ol.style.Circle({
                radius: 9,
                fill: new ol.style.Fill({ color: rgba(c, 1) }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 })
            }),
            text: new ol.style.Text({
                text: '🌀', font: '15px sans-serif', offsetY: 1
            })
        }));
        _headSrc.addFeature(head);

        // 우상단 날짜·시각 말풍선 라벨 (애니메이션 따라 함께 이동)
        var label = new ol.Feature(pointAt(f.lon, f.lat));
        label.setStyle(new ol.style.Style({
            text: new ol.style.Text({
                text: fmtFromMs(f._rtMs) + ' 기준',
                font: 'bold 12px sans-serif',
                textAlign: 'left', offsetX: 13, offsetY: -14,
                fill: new ol.style.Fill({ color: '#111' }),
                backgroundFill: new ol.style.Fill({ color: 'rgba(255,255,255,0.92)' }),
                backgroundStroke: new ol.style.Stroke({ color: rgba(c, 1), width: 1.5 }),
                padding: [3, 6, 3, 6]
            })
        }));
        _headSrc.addFeature(label);

        updateInfo(f);
        var scr = document.getElementById('tphn-scrubber');
        if (scr && document.activeElement !== scr) scr.value = String(Math.round(p * 1000));
    }

    function updateInfo(f) {
        var el = document.getElementById('tphn-info');
        if (!el) return;
        var g = f._gradeF != null ? f._gradeF : f.grade;
        var parts = [];
        parts.push('<b>' + (f._rtMs ? fmtFromMs(f._rtMs) + ' 기준' : fmtTime(f.time)) + '</b>');
        parts.push('강도 <span class="tphn-grade" style="color:' + rgba(gradeColor(g), 1) + '">' + (GRADE_NAMES[g] || '-') + '</span>');
        if (f.windMs != null) parts.push('최대풍속 ' + Math.round(f.windMs) + 'm/s');
        if (f.pressure != null) parts.push('중심기압 ' + Math.round(f.pressure) + 'hPa');
        if (f.radStrong) parts.push('강풍반경 ' + Math.round(f.radStrong) + 'km');
        if (f.radStorm) parts.push('폭풍반경 ' + Math.round(f.radStorm) + 'km');
        if (f.speedKmh != null && f.dir) parts.push('이동 ' + f.dir + ' ' + Math.round(f.speedKmh) + 'km/h');
        el.innerHTML = parts.join(' · ');
    }

    // ── 지도 포커스 (태풍 현재위치 + 제주도가 한 화면에 보이도록 fit) ─────────
    function focusOnTyphoon() {
        if (!_map || !_frames.length) return;
        var f = frameAt(_p);
        if (!f || f.lon == null || f.lat == null) return;
        var tphn = ol.proj.fromLonLat([f.lon, f.lat]);
        var jeju = ol.proj.fromLonLat([JEJU_LON, JEJU_LAT]);
        var extent = [
            Math.min(tphn[0], jeju[0]), Math.min(tphn[1], jeju[1]),
            Math.max(tphn[0], jeju[0]), Math.max(tphn[1], jeju[1])
        ];
        var size = _map.getSize();
        if (!size) return;
        // 하단 컨트롤 패널/탭 영역만큼 bottom 패딩을 크게 줘서 가림 방지.
        _map.getView().fit(extent, {
            size: size,
            padding: [70, 60, 170, 60],
            maxZoom: FIT_MAX_ZOOM,
            duration: 600
        });
    }

    // ── 재생 제어 ────────────────────────────────────────────────────────────
    function tick(ts) {
        if (!_playing) return;
        if (!_lastTs) _lastTs = ts;
        var dt = ts - _lastTs;
        _lastTs = ts;
        _p += dt / FULL_PLAY_MS;
        if (_p >= 1) { _p = 1; renderHead(_p); pause(); return; }
        renderHead(_p);
        _raf = requestAnimationFrame(tick);
    }
    function play() {
        if (!_frames.length) return;
        if (_p >= 0.999) _p = (_pNow < 0.999 ? _pNow : 0); // 끝이면 현재 시각(없으면 처음)부터
        _playing = true; _lastTs = 0;
        // 재생 중에는 포인트별 고정 cone 을 숨겨 보간 영향 원의 변화가 또렷하게.
        if (_coneLayer) _coneLayer.setVisible(false);
        setPlayBtn(true);
        _raf = requestAnimationFrame(tick);
    }
    function pause() {
        _playing = false;
        if (_raf) cancelAnimationFrame(_raf);
        _raf = null;
        if (_coneLayer) _coneLayer.setVisible(_visible); // 정지 시 전체 진로 cone 복원
        setPlayBtn(false);
    }
    function setPlayBtn(playing) {
        var b = document.getElementById('tphn-play');
        if (b) b.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    }

    // ── 연도 → 태풍명 → 통보문 (드롭다운) ────────────────────────────────────
    function curYearKst() {
        var d = new Date();
        var k = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + 9 * 3600000);
        return k.getFullYear();
    }
    function fetchJSON(url) { return fetch(url).then(function (r) { return r.json(); }); }

    function buildYearOptions() {
        var sel = document.getElementById('tphn-year');
        if (!sel) return;
        var now = curYearKst();
        sel.innerHTML = '';
        for (var y = now; y >= 2001; y--) {
            var o = document.createElement('option');
            o.value = String(y); o.textContent = y + '년';
            sel.appendChild(o);
        }
        sel.value = String(now);
    }

    // 현재연도 활성 캐시에서 (year,seq) 태풍 인라인 데이터 찾기
    function activeTyphoon(year, seq) {
        if (!_activeData || _activeData.year !== year) return null;
        return (_activeData.typhoons || []).find(function (t) { return t.seq === seq; }) || null;
    }

    function populateNames() {
        var sel = document.getElementById('tphn-name');
        if (!sel) return;
        sel.innerHTML = '';
        _typhoonList.forEach(function (t) {
            var o = document.createElement('option');
            o.value = t.seq; o.textContent = t.name;
            sel.appendChild(o);
        });
    }
    function populateBulletins() {
        var sel = document.getElementById('tphn-bulletin');
        if (!sel) return;
        sel.innerHTML = '';
        _bulletinList.forEach(function (b) {
            var o = document.createElement('option');
            o.value = b.code; o.textContent = b.label || b.code;
            sel.appendChild(o);
        });
    }
    function setSelValue(id, v) { var s = document.getElementById(id); if (s && v != null) s.value = v; }

    // 연도 선택 → 태풍 목록 로드(없으면 활성 캐시 사용) → 태풍 선택
    function loadYear(year, preferSeq, preferCode) {
        _year = year;
        return fetchJSON('/api/typhoon/list?year=' + year).then(function (j) {
            _typhoonList = (j && j.typhoons) || [];
            if (!_typhoonList.length && _activeData && _activeData.year === year) {
                _typhoonList = (_activeData.typhoons || []).map(function (t) { return { seq: t.seq, name: t.name }; });
            }
            populateNames();
            var seq = (preferSeq && _typhoonList.some(function (t) { return t.seq === preferSeq; }))
                ? preferSeq : (_typhoonList[0] && _typhoonList[0].seq);
            setSelValue('tphn-name', seq);
            _selSeq = seq || null;
            if (seq) loadTyphoon(year, seq, preferCode);
            else clearTrack();
        }).catch(function (e) { console.warn('[OceanTyphoon] loadYear 실패:', e.message); });
    }

    // 태풍 선택 → 통보문 목록 로드(활성 인라인 우선) → 통보문 선택
    function loadTyphoon(year, seq, preferCode) {
        _selSeq = seq;
        var inline = activeTyphoon(year, seq);
        if (inline) {
            _bulletinList = (inline.bulletins || []).map(function (b) { return { code: b.code, label: b.label, isLatest: b.isLatest }; });
            (inline.bulletins || []).forEach(function (b) { if (b.code) _tableCache[year + '_' + b.code] = b; });
            populateBulletins();
            var code0 = pickCode(preferCode);
            setSelValue('tphn-bulletin', code0);
            if (code0) selectBulletin(year, code0); else clearTrack();
            return Promise.resolve();
        }
        return fetchJSON('/api/typhoon/bulletins?year=' + year + '&seq=' + seq).then(function (j) {
            _bulletinList = (j && j.bulletins) || [];
            populateBulletins();
            var code0 = pickCode(preferCode);
            setSelValue('tphn-bulletin', code0);
            if (code0) selectBulletin(year, code0); else clearTrack();
        }).catch(function (e) { console.warn('[OceanTyphoon] loadTyphoon 실패:', e.message); });
    }
    function pickCode(preferCode) {
        if (preferCode && _bulletinList.some(function (b) { return b.code === preferCode; })) return preferCode;
        return _bulletinList[0] && _bulletinList[0].code;
    }

    // 통보문 선택 → 표 데이터 확보(캐시 or on-demand) → 렌더
    function selectBulletin(year, code) {
        pause();
        _selCode = code;
        var key = year + '_' + code;
        if (_tableCache[key]) { renderBulletin(_tableCache[key]); return; }
        fetchJSON('/api/typhoon/bulletin?year=' + year + '&code=' + encodeURIComponent(code)).then(function (d) {
            if (!d || d.error) return;
            _tableCache[key] = d;
            if (_selCode === code) renderBulletin(d); // 그 사이 다른 선택 안 했을 때만
        }).catch(function (e) { console.warn('[OceanTyphoon] bulletin 실패:', e.message); });
    }

    function renderBulletin(b) {
        _frames = buildFrames(b);
        _pNow = computeNowP();    // 발표시각이 아니라 "현재 시각" 기준 위치에서 시작
        _p = _pNow;
        renderStatic();
        renderHead(_p);
        if (_visible) focusOnTyphoon();
    }
    function clearTrack() {
        _frames = [];
        if (_staticSrc) _staticSrc.clear();
        if (_coneSrc) _coneSrc.clear();
        if (_headSrc) _headSrc.clear();
    }

    function renderLegend() {
        var el = document.getElementById('tphn-legend');
        if (!el) return;
        var html = '';
        [0, 1, 2, 3, 4, 5].forEach(function (g) {
            html += '<span class="tphn-leg-item"><i style="background:' + rgba(gradeColor(g), 1) + '"></i>' + GRADE_NAMES[g] + '</span>';
        });
        el.innerHTML = html;
    }

    // ── 표시/숨김 ────────────────────────────────────────────────────────────
    function setVisible(v) {
        _visible = v;
        if (_staticLayer) _staticLayer.setVisible(v);
        if (_coneLayer) _coneLayer.setVisible(v && !_playing);
        if (_headLayer) _headLayer.setVisible(v);
        var panel = document.getElementById('ocean-typhoon-panel');
        if (panel) panel.style.display = v ? '' : 'none';
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (btn) btn.classList.toggle('active', v);
        if (v) {
            // 표출 시 현재 시각 위치로 갱신 후 태풍+제주도가 보이도록 지도 이동/줌
            _pNow = computeNowP();
            _p = _pNow;
            renderHead(_p);
            focusOnTyphoon();
            // 표출 첫 회: 현재연도 전체 태풍 목록(dmdw)으로 이름 드롭다운 확장(과거 태풍 포함)
            if (!_yearLoaded) { _yearLoaded = true; loadYear(_year, _selSeq, _selCode); }
        } else {
            pause();
        }
        try { localStorage.setItem(VISIBLE_KEY, String(v)); } catch (e) {}
    }

    function applyAvailability() {
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (!btn) return;
        // 잠금(기본) 상태: 항상 비활성 모양 — 10회 탭 전까지는 hasActive 와 무관하게 가림.
        if (!_unlocked) {
            btn.classList.add('tphn-disabled');
            btn.title = '태풍';
            return;
        }
        var has = _activeData && _activeData.hasActive && (_activeData.typhoons || []).length;
        if (!has) {
            btn.classList.add('tphn-disabled');
            btn.title = '현재 태풍 없음';
            if (_visible) setVisible(false);
        } else {
            btn.classList.remove('tphn-disabled');
            btn.title = '태풍 진로';
        }
    }

    // 비활성 버튼 탭 처리 — 10회 누적 시 잠금 해제 + 태풍 현황 표출.
    function handleGateTap() {
        _tapCount++;
        clearTimeout(_tapTimer);
        _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_RESET_MS);
        if (_tapCount < TAP_THRESHOLD) return;
        _tapCount = 0;
        _unlocked = true;
        try { localStorage.setItem(UNLOCK_KEY, 'true'); } catch (e) {}
        applyAvailability();
        // 표출: 활성 태풍이 있으면 오버레이 ON (없으면 패널만 열어 "현재 태풍 없음" 인지 가능)
        setVisible(true);
    }

    // ── 데이터 로드 ──────────────────────────────────────────────────────────
    // /api/typhoon(활성 캐시)로 즉시 기본 표출 + 연도/태풍/통보문 드롭다운 초기화.
    function load() {
        buildYearOptions();
        _year = curYearKst();
        renderLegend();
        return fetchJSON('/api/typhoon').then(function (j) {
            _activeData = j || { hasActive: false, typhoons: [] };
            // 활성 통보문 표를 캐시에 시드(즉시 렌더용)
            (_activeData.typhoons || []).forEach(function (t) {
                (t.bulletins || []).forEach(function (b) { if (b.code) _tableCache[_activeData.year + '_' + b.code] = b; });
            });
            applyAvailability();
            // 잠긴 사용자도 dmdw on-demand 호출 없이, 파일 캐시만으로 기본(활성 최신) 표출.
            primeDefaultFromActive();
        }).catch(function (e) { console.warn('[OceanTyphoon] load 실패:', e.message); });
    }

    // /api/typhoon(파일)만으로 기본 선택 구성 — dmdw 호출 없음
    function primeDefaultFromActive() {
        if (!_activeData || !_activeData.hasActive || !(_activeData.typhoons || []).length) return;
        _year = _activeData.year || curYearKst();
        setSelValue('tphn-year', String(_year));
        _typhoonList = _activeData.typhoons.map(function (t) { return { seq: t.seq, name: t.name }; });
        populateNames();
        var t0 = _activeData.typhoons[0];
        _selSeq = t0.seq; setSelValue('tphn-name', _selSeq);
        _bulletinList = (t0.bulletins || []).map(function (b) { return { code: b.code, label: b.label, isLatest: b.isLatest }; });
        populateBulletins();
        var c0 = t0.bulletins[0] && t0.bulletins[0].code;
        setSelValue('tphn-bulletin', c0);
        if (c0) selectBulletin(_year, c0);
    }

    // 주기 갱신: 활성 캐시/가용성만 조용히 갱신(사용자의 연도/태풍 선택은 건드리지 않음)
    function refreshActive() {
        return fetchJSON('/api/typhoon').then(function (j) {
            _activeData = j || { hasActive: false, typhoons: [] };
            (_activeData.typhoons || []).forEach(function (t) {
                (t.bulletins || []).forEach(function (b) { if (b.code) _tableCache[_activeData.year + '_' + b.code] = b; });
            });
            applyAvailability();
        }).catch(function () { /* ignore */ });
    }

    // ── 초기화 ──────────────────────────────────────────────────────────────
    function ensureLayers(map) {
        if (_staticLayer) return;
        _staticSrc = new ol.source.Vector();
        _coneSrc = new ol.source.Vector();
        _headSrc = new ol.source.Vector();
        _staticLayer = new ol.layer.Vector({ source: _staticSrc, zIndex: 124, visible: _visible });
        _coneLayer = new ol.layer.Vector({ source: _coneSrc, zIndex: 120, visible: _visible });
        _headLayer = new ol.layer.Vector({ source: _headSrc, zIndex: 130, visible: _visible });
        map.addLayer(_coneLayer);
        map.addLayer(_staticLayer);
        map.addLayer(_headLayer);
    }

    function bindUI() {
        if (_bound) return;
        _bound = true;
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (btn) {
            btn.addEventListener('click', function () {
                if (!_unlocked) { handleGateTap(); return; }   // 잠금 상태 → 탭 카운트
                var has = _activeData && _activeData.hasActive && (_activeData.typhoons || []).length;
                if (!has) return;                               // 활성 태풍 없음
                setVisible(!_visible);
            });
        }
        var ySel = document.getElementById('tphn-year');
        if (ySel) ySel.addEventListener('change', function () { loadYear(parseInt(this.value, 10)); });
        var nSel = document.getElementById('tphn-name');
        if (nSel) nSel.addEventListener('change', function () { loadTyphoon(_year, this.value); });
        var bSel = document.getElementById('tphn-bulletin');
        if (bSel) bSel.addEventListener('change', function () { selectBulletin(_year, this.value); });
        var playBtn = document.getElementById('tphn-play');
        if (playBtn) playBtn.addEventListener('click', function () { _playing ? pause() : play(); });
        var scr = document.getElementById('tphn-scrubber');
        if (scr) scr.addEventListener('input', function () { pause(); _p = (+this.value) / 1000; renderHead(_p); });
        var closeBtn = document.getElementById('tphn-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { setVisible(false); });
    }

    function installWhenReady() {
        function tryInit() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map && window.ol) {
                _map = map;
                try { _unlocked = localStorage.getItem(UNLOCK_KEY) === 'true'; } catch (e) { _unlocked = false; }
                ensureLayers(map);
                bindUI();
                try { _visible = localStorage.getItem(VISIBLE_KEY) === 'true'; } catch (e) { _visible = false; }
                // 잠금 해제된 경우에만 직전 표시 상태 복원 (기본은 비활성).
                load().then(function () { if (_unlocked && _visible) setVisible(true); });
                // 5분마다 데이터 갱신(통보문 신규 반영) — 보이는 동안에만
                setInterval(function () { if (_visible) refreshActive(); }, 5 * 60 * 1000);
                return;
            }
            setTimeout(tryInit, 300);
        }
        tryInit();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installWhenReady);
    } else {
        installWhenReady();
    }

    window.OceanTyphoon = { reload: load, show: function () { setVisible(true); }, hide: function () { setVisible(false); } };
})();
