/**
 * ============================================================================
 * 파일명: js/ocean_warn_vsby.js
 * 역할 : 해역별 특보 현황 아코디언의 각 특보구역 카드에 "시정(visibility) 뱃지"
 *        를 부착하고, 뱃지 클릭 시 그 특보구역의 소해구(小海區) 폴리곤을 시정
 *        값에 따라 색칠/텍스트 표시하는 클라이언트 모듈.
 * ============================================================================
 *
 * [로드 방식]
 *   index2.html 을 수정할 수 없으므로 ocean_warn_active1.js 가 <script> 를
 *   동적으로 주입해 이 파일을 로드한다 (중복 주입 방지 가드 있음).
 *
 * [서버 API — 같은 origin, 이미 구현됨]
 *   GET /api/vsby-smallzone?zone={특보구역코드}
 *     → { success, zone, name, baseTm, cells: { "144-9":[{t,v}, ...], ... } }
 *       cells 키 = "부모대해구-소해구(1..9)", v = 시정 km 원값(최대 100).
 *
 * [매핑 데이터]
 *   /assets/zone_grid_map.json  — 특보구역코드 → { name, region, majorZones,
 *                                  smallZones:[...], viewBox:[lonMin,latMin,lonMax,latMax] }
 *   카드의 한글 해역명 ↔ zone_grid_map[code].name 을 정규화 비교해 코드 결정.
 *
 * [표시 규칙 — 명세 그대로]
 *   - 20km 상한 클램프: v ≥ 20 → "20km", 색 계산도 20 으로.
 *   - 색상: VSBY_STOPS (vsby_forecast_layer.js 와 동일) — 가장 큰 stop ≤ v.
 *   - fill: v ≤ 10km → 버킷색 반투명, v > 10km → 채움 없음(투명).
 *   - 텍스트: 항상 km 라벨 표시 (예 "3.2km", ≥20 → "20km").
 *   - 뱃지: 소해구 시정 min~max 범위 ("시정 0.2~5km", 동일값이면 단일).
 *
 * [소해구 폴리곤 기하 — 클라이언트 계산]
 *   대해구(0.5°×0.5° box) 를 3×3 분할. s in 1..9, r=floor((s-1)/3) (row0=북),
 *   c=(s-1)%3 (col0=서). marine_zone_area.json (CRS84) 의 marine_zone_no 로
 *   부모 box 를 얻는다. ocean_map.js 와 동일 정적 파일 /marine_zone_area.json.
 *
 * [지도]
 *   window.__getOceanMap() 으로 OL Map 획득. 투영 EPSG:3857 → lon/lat 는
 *   ol.proj.fromLonLat 로 변환. 전용 VectorLayer 한 장에 폴리곤+라벨을 그린다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 색상 stop (vsby_forecast_layer.js VSBY_STOPS 와 동일) ──
    var VSBY_STOPS = [
        { v: 0.0,  color: '#ff2bd6' },
        { v: 0.2,  color: '#e60000' },
        { v: 0.6,  color: '#ff7f00' },
        { v: 1.0,  color: '#ffb547' },
        { v: 2.0,  color: '#ffe800' },
        { v: 3.0,  color: '#c8d600' },
        { v: 5.0,  color: '#16b41a' },
        { v: 7.0,  color: '#6fdf6f' },
        { v: 10.0, color: '#1fb6d6' },
        { v: 14.0, color: '#2f7be6' },
        { v: 20.0, color: '#ffffff' }
    ];

    var VSBY_CLAMP_MAX = 20;     // 20km 상한
    var VSBY_FILL_MAX = 10;      // v > 10km 면 채움 없음
    var LAYER_ZINDEX = 60;       // 시정예측 raster(50) 위, 일반 UI 아래

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    // ─────────────────────────────────────────────────────────────
    var state = {
        gridMap: null,        // zone_grid_map.json (code → meta)
        gridMapPromise: null,
        nameToCode: null,     // 정규화 해역명 → 특보구역코드
        parentBox: null,      // marine_zone_no → [lonMin,latMin,lonMax,latMax]
        parentBoxPromise: null,
        zoneCache: {},        // code → Promise<{cells, baseTm}>
        summaryCache: {},     // code → {min,max,time} | null(데이터없음) | 'error'(서버장애) | undefined(미계산/진행중)
        errRetryAt: {},       // code → 다음 'error' 재시도 허용 epoch ms (장애 시 폭주 방지 쿨다운)
        upstreamOk: true,     // 상류(KMA) 가용성 — false 면 캐시값이 있어도 시정 뱃지를 회색 처리
        upstreamCheckedAt: 0, // 마지막 상류 헬스 확인 epoch ms (폴링 TTL 판정)
        refreshTimer: null,   // 요약 도착 후 ZoneAvg.refreshAll 디바운스 타이머
        layer: null,          // 현재 그려진 OL VectorLayer
        activeCode: null,     // 현재 토글 ON 인 특보구역 코드 (없으면 null)
        observer: null
    };

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    /** 한글 해역명 정규화 — 공백·중점·마침표·괄호 제거 후 비교용. */
    function _normName(s) {
        return ('' + (s || '')).replace(/[\s·.()]/g, '').trim();
    }

    /** hex → "r,g,b" (rgba() 조립용). */
    function _hexToRgb(hex) {
        var v = parseInt(hex.replace('#', ''), 16);
        return ((v >> 16) & 0xff) + ',' + ((v >> 8) & 0xff) + ',' + (v & 0xff);
    }

    /** km 값 → 버킷 stop 인덱스 (가장 큰 stop ≤ v). */
    function _bucketIndex(v) {
        var idx = 0;
        for (var i = 0; i < VSBY_STOPS.length; i++) {
            if (VSBY_STOPS[i].v <= v) idx = i; else break;
        }
        return idx;
    }

    /** km 라벨 — 20 이상은 "20km", 그 외 소수1자리 정리 후 "Nkm". */
    function _fmtKm(v) {
        if (v == null || !isFinite(v)) return '';
        if (v >= VSBY_CLAMP_MAX) return VSBY_CLAMP_MAX + 'km';
        var r = Math.round(v * 10) / 10;
        return r + 'km';
    }

    /** 20 상한 클램프 (색/범위 계산용 숫자). */
    function _clamp(v) {
        if (v == null || !isFinite(v)) return null;
        return v >= VSBY_CLAMP_MAX ? VSBY_CLAMP_MAX : v;
    }

    /** "YYYY.MM.DD HH:mm" → epoch ms (KST 가정, 비교용으로만 사용). */
    function _parseTm(s) {
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s || '');
        if (!m) return NaN;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    }

    // ─────────────────────────────────────────────────────────────
    // 데이터 로딩 — zone_grid_map / 대해구 box
    // ─────────────────────────────────────────────────────────────

    function _loadGridMap() {
        if (state.gridMap) return Promise.resolve(state.gridMap);
        if (state.gridMapPromise) return state.gridMapPromise;
        state.gridMapPromise = fetch('/assets/zone_grid_map.json')
            .then(function (r) { if (!r.ok) throw new Error('grid_map ' + r.status); return r.json(); })
            .then(function (j) {
                state.gridMap = j || {};
                var n2c = {};
                Object.keys(state.gridMap).forEach(function (code) {
                    var meta = state.gridMap[code];
                    if (meta && meta.name) n2c[_normName(meta.name)] = code;
                });
                state.nameToCode = n2c;
                return state.gridMap;
            })
            .catch(function (e) {
                console.warn('[vsby-badge] zone_grid_map 로드 실패:', e.message);
                state.gridMap = {};
                state.nameToCode = {};
                return state.gridMap;
            });
        return state.gridMapPromise;
    }

    /** marine_zone_area.json → marine_zone_no(string) → [lonMin,latMin,lonMax,latMax]. */
    function _loadParentBoxes() {
        if (state.parentBox) return Promise.resolve(state.parentBox);
        if (state.parentBoxPromise) return state.parentBoxPromise;
        state.parentBoxPromise = fetch('/marine_zone_area.json')
            .then(function (r) { if (!r.ok) throw new Error('marine_zone ' + r.status); return r.json(); })
            .then(function (geo) {
                var box = {};
                var feats = (geo && geo.features) || [];
                for (var i = 0; i < feats.length; i++) {
                    var f = feats[i];
                    var no = f && f.properties && f.properties.marine_zone_no;
                    if (no == null) continue;
                    var g = f.geometry;
                    if (!g || !g.coordinates) continue;
                    // MultiPolygon → 첫 polygon 첫 ring 의 bbox.
                    var ring = (g.type === 'MultiPolygon')
                        ? g.coordinates[0][0]
                        : (g.type === 'Polygon' ? g.coordinates[0] : null);
                    if (!ring) continue;
                    var lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
                    for (var p = 0; p < ring.length; p++) {
                        var lon = ring[p][0], lat = ring[p][1];
                        if (lon < lonMin) lonMin = lon;
                        if (lon > lonMax) lonMax = lon;
                        if (lat < latMin) latMin = lat;
                        if (lat > latMax) latMax = lat;
                    }
                    box[String(no)] = [lonMin, latMin, lonMax, latMax];
                }
                state.parentBox = box;
                return box;
            })
            .catch(function (e) {
                console.warn('[vsby-badge] marine_zone_area 로드 실패:', e.message);
                state.parentBox = {};
                return state.parentBox;
            });
        return state.parentBoxPromise;
    }

    var UPSTREAM_TTL_MS = 60 * 1000;   // 상류 헬스 폴링 주기(클라이언트)

    /** 상류(KMA) 헬스 플래그를 적용 — 변화 시 평균박스 재합류로 회색/정상 전환. */
    function _applyUpstream(upstream) {
        if (!upstream) return;
        state.upstreamCheckedAt = Date.now();
        var ok = (upstream.ok !== false);
        if (ok !== state.upstreamOk) {
            state.upstreamOk = ok;
            _scheduleBadgeRefresh();
        }
    }

    /**
     * 상류 헬스를 주기적으로 확인(TTL 경과 시에만). zone 데이터는 zoneCache 로
     * 영구 캐시되어 헬스 갱신을 못 싣기 때문에, status 엔드포인트를 별도 폴링해
     * 장애↔회복 전환을 따라간다. (논블로킹 — 결과 도착 시 refreshAll 로 반영)
     */
    function _ensureUpstreamHealth() {
        if (Date.now() - state.upstreamCheckedAt < UPSTREAM_TTL_MS) return;
        state.upstreamCheckedAt = Date.now();   // 중복 요청 방지(선반영)
        fetch('/api/vsby-smallzone/status')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { if (j) _applyUpstream(j.upstream); })
            .catch(function () { /* 헬스 확인 실패는 무시 — 기존 상태 유지 */ });
    }

    /** 특보구역 시정 시계열 fetch (코드 단위 캐시). */
    function _loadZoneCells(code) {
        if (state.zoneCache[code]) return state.zoneCache[code];
        var p = fetch('/api/vsby-smallzone?zone=' + encodeURIComponent(code))
            .then(function (r) { if (!r.ok) throw new Error('vsby ' + r.status); return r.json(); })
            .then(function (j) {
                if (j && j.upstream) _applyUpstream(j.upstream);   // 첫 진입 즉시성
                if (!j || !j.success || !j.cells) return { cells: {}, baseTm: null };
                return { cells: j.cells, baseTm: j.baseTm || null };
            })
            .catch(function (e) {
                // 실패는 캐시에서 제거해 다음 클릭 때 재시도 가능하게.
                delete state.zoneCache[code];
                throw e;
            });
        state.zoneCache[code] = p;
        return p;
    }

    // ─────────────────────────────────────────────────────────────
    // 시간 인덱스 선택 (now 에 가장 가까운 frame)
    // ─────────────────────────────────────────────────────────────

    /**
     * cells 의 어떤 한 셀의 시계열을 골라 now 에 가장 가까운 인덱스를 결정.
     * 모든 셀이 동일 시각열을 공유한다는 전제(서버가 동일 baseTm 기반 생성)이며,
     * 셀마다 길이가 달라도 인덱스 기반으로 안전하게 접근.
     *
     * @returns {{index:number, t:string}|null}
     */
    function _pickNearestTimeIndex(cells) {
        var keys = Object.keys(cells || {});
        for (var k = 0; k < keys.length; k++) {
            var series = cells[keys[k]];
            if (Array.isArray(series) && series.length) {
                var now = Date.now();
                var bestI = 0, bestD = Infinity;
                for (var i = 0; i < series.length; i++) {
                    var t = _parseTm(series[i] && series[i].t);
                    if (!isFinite(t)) continue;
                    var d = Math.abs(t - now);
                    if (d < bestD) { bestD = d; bestI = i; }
                }
                return { index: bestI, t: series[bestI] && series[bestI].t };
            }
        }
        return null;
    }

    /** 특정 셀 시계열에서 index(없으면 t매칭) 의 v 추출. */
    function _valueAt(series, index, t) {
        if (!Array.isArray(series) || !series.length) return null;
        if (t) {
            for (var i = 0; i < series.length; i++) {
                if (series[i] && series[i].t === t) return series[i].v;
            }
        }
        var clampIdx = Math.max(0, Math.min(index, series.length - 1));
        var rec = series[clampIdx];
        return rec ? rec.v : null;
    }

    // ─────────────────────────────────────────────────────────────
    // 뱃지 — min~max 범위 계산 + DOM 부착
    // ─────────────────────────────────────────────────────────────

    /**
     * 특보구역 시정 요약 계산.
     * @returns {Promise<{min:number, max:number, time:string}|null>}
     *          소해구/데이터 없으면 null.
     */
    function _computeZoneSummary(code) {
        return _loadZoneCells(code).then(function (data) {
            var cells = data.cells || {};
            var pick = _pickNearestTimeIndex(cells);
            if (!pick) return null;
            var min = Infinity, max = -Infinity, found = false;
            var keys = Object.keys(cells);
            for (var i = 0; i < keys.length; i++) {
                var v = _clamp(_valueAt(cells[keys[i]], pick.index, pick.t));
                if (v == null) continue;
                found = true;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!found) return null;
            return { min: min, max: max, time: pick.t };
        });
    }

    /** 뱃지 텍스트 — "시정 0.2~5km" 또는 동일값이면 "시정 5km". */
    function _badgeText(summary) {
        var loStr = _fmtKm(summary.min);
        var hiStr = _fmtKm(summary.max);
        if (loStr === hiStr) return '시정 ' + hiStr;
        // 동일 단위(km) 이므로 앞 숫자는 단위 생략해 "0.2~5km" 형태로.
        var lo = loStr.replace(/km$/, '');
        return '시정 ' + lo + '~' + hiStr;
    }

    /**
     * 카드 헤더에서 해역명 추출.
     *
     * 두 종류의 카드를 모두 지원한다(둘 다 같은 아코디언에 섞여 있을 수 있음):
     *   (A) 해역별 특보현황 — render.js createAlertElement:
     *        .alert-card > .alert-header > h3.zone-name > span(해역명)
     *   (B) 해역별 기상현황 — windy.js createStatusCard:
     *        .weather-status-card > div > div(nameRow) > span(해역명) (+ .zone-avg-box 등)
     *
     * (A) 는 `.zone-name span` 으로 정확히 잡히지만 (B) 는 `.zone-name` 자체가
     * 없어 과거 구현이 빈 문자열을 반환 → 뱃지 미부착의 근본 원인이었다.
     * 따라서 정규화 후 nameToCode 에 존재하는 텍스트를 가진 요소를 탐색하는
     * 폴백을 둔다.
     */
    function _zoneNameOfCard(card) {
        // (A) 특보 카드 — .zone-name 의 첫 span(추가 정보 span 제외).
        var nameEl = card.querySelector('.zone-name');
        if (nameEl) {
            var span = nameEl.querySelector('span');
            var t = (span ? span.textContent : nameEl.textContent) || '';
            if (t && state.nameToCode && state.nameToCode[_normName(t)]) return t;
            if (t) return t; // 매칭 안 돼도 일단 반환(상위에서 코드 없으면 skip)
        }
        // (B) 기상현황 카드 등 — 매칭되는 텍스트를 가진 요소를 탐색.
        if (state.nameToCode) {
            var nodes = card.querySelectorAll('span, h3, h4, strong, b, div');
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                // 자식 요소가 또 있는 컨테이너는 건너뛰고 말단 텍스트 노드 위주로.
                var txt = (node.textContent || '').trim();
                if (!txt || txt.length > 40) continue;
                if (state.nameToCode[_normName(txt)]) return txt;
            }
        }
        return '';
    }

    /** 카드 안에서 뱃지를 끼워 넣을 위치(부모, 기준노드) 결정. */
    function _badgeAnchor(card) {
        // (A) 특보 카드: .alert-header 안, .alert-badges 앞.
        var header = card.querySelector('.alert-header');
        if (header) {
            var badgeBox = header.querySelector('.alert-badges');
            return { parent: header, before: badgeBox || null };
        }
        // (B) 기상현황 카드: 해역명 span 의 부모(nameRow) 끝에 부착.
        var zname = _zoneNameOfCard(card);
        if (zname && state.nameToCode) {
            var nodes = card.querySelectorAll('span, h3, h4, strong, b');
            for (var i = 0; i < nodes.length; i++) {
                if (_normName(nodes[i].textContent || '') === _normName(zname)
                    && state.nameToCode[_normName(zname)]) {
                    var parent = nodes[i].parentElement || card;
                    return { parent: parent, before: null };
                }
            }
        }
        // 폴백: 카드의 첫 번째 요소(헤더로 추정) 끝.
        var first = card.firstElementChild || card;
        return { parent: first, before: null };
    }

    /** 카드 하나에 시정 뱃지 부착 (이미 있으면 skip). */
    // [일원화] 시정 뱃지는 평균박스(zone_avg.createBox)가 makeBadge 로 같은 줄에 합류.
    //   기존의 카드 헤더 근접 삽입은 폐지(스타일/위치 불일치 해소). 관찰자 인프라는 무해 유지.
    function _attachBadgeToCard(card) { /* no-op */ }

    /**
     * [공개] zone_avg.createBox 가 호출 — 그 특보구역의 시정 뱃지(.zone-avg-badge vsby) 반환.
     *   매핑(smallZones) 없거나 gridMap 미로드 시 null → 평균박스에 시정 미표시(먼바다 제외).
     */
    function makeBadge(zoneName) {
        if (!state.nameToCode) return null;
        var code = state.nameToCode[_normName(zoneName)];
        if (!code) return null;
        var meta = state.gridMap[code];
        if (!meta || !meta.smallZones || !meta.smallZones.length) return null;

        // 상류(KMA) 헬스를 주기 확인(TTL 경과 시에만 실제 요청).
        _ensureUpstreamHealth();
        // 상류 장애 시: 우리 서버에 캐시된 시정값이 있어도 회색 비활성 "--km" 뱃지로
        //   표시(사용자 요청). 클릭하면 색칠 팝업 대신 안내 토스트만 띄운다.
        if (state.upstreamOk === false) {
            return _makeDisabledBadge(code);
        }

        // [동기 렌더링] 시정 값을 비동기로 받은 뒤 innerHTML 을 교체하면(폭 0→실제폭),
        //   무한 깜빡임 애니메이션 중인 요소의 폭 변화가 안드로이드 WebView 에서
        //   배경 알약 페인트를 무효화하지 못해 "글자보다 좁은 알약"(뱃지 잘림)이
        //   생긴다. 파고/풍속 배지가 멀쩡한 이유는 완성된 내용으로 DOM 에 들어가
        //   폭이 변하지 않기 때문 — 시정도 동일하게, 값이 준비된 뒤에만 최종
        //   내용으로 한 번에 만들어 반환한다.
        var summary = state.summaryCache[code];
        if (summary === undefined) {
            // 아직 값이 없음 → 백그라운드 로드 후 refreshAll 로 재합류. 이번엔
            //   시정을 빼고(null) 반환 → 파고/풍속 배지는 정상 표시됨.
            _ensureSummary(code);
            return null;
        }
        if (summary === null) return null;   // 데이터 없는 구역 → 시정 미표시
        if (summary === 'error') {
            // 기상청 외부 서버 장애(504 등)로 시정 값을 못 받음 → 회색 비활성 "--km"
            //   뱃지로 표시. (데이터 없음[null]과 달리 뱃지는 띄우되 클릭/색칠은 막는다.)
            //   쿨다운 경과 시 백그라운드 재시도 — 서버 복구되면 다음 갱신에 정상 표시.
            _ensureSummary(code);
            return _makeDisabledBadge(code);
        }

        var val = _badgeText(summary).replace(/^시정\s*/, '');   // "0.2~5km" / "20km"
        var badge = document.createElement('span');
        badge.className = 'zone-avg-badge vsby';
        badge.style.cursor = 'pointer';
        badge.dataset.vsbyCode = code;
        badge.title = '클릭하면 소해구별 시정을 지도로 표시합니다';
        badge.innerHTML = '<span class="lbl">시정</span> ' + val;
        // 클릭 리스너를 배지에 직접 부착한다. (이전엔 'click 리스너가 잘림을
        //   유발한다'고 보고 document 위임으로 옮겼으나 — 5개 독립분석 결과
        //   클릭은 잘림과 무관(상관관계였을 뿐, 진짜 원인은 합성 레이어 사각
        //   백킹 잔상)으로 확정. 위임은 오히려 박스의 stopPropagation 에 막혀
        //   시정 팝업이 안 뜨고 파고/풍속 툴팁만 뜨는 부작용을 냈다.)
        //   여기서 e.stopPropagation() 으로 박스 툴팁 핸들러로의 버블을 끊어야
        //   시정 팝업이 정상 동작한다.
        badge.addEventListener('click', function (e) {
            e.stopPropagation();
            _onBadgeClick(code, badge);
        });
        return badge;
    }

    /**
     * 회색 비활성 시정 뱃지 ("--km") — 서버 장애로 값을 못 받은 구역용.
     *   클릭해도 소해구 팝업은 띄우지 않고, 일시적 장애임을 토스트로만 안내한다.
     */
    function _makeDisabledBadge(code) {
        var badge = document.createElement('span');
        badge.className = 'zone-avg-badge vsby vsby-disabled';
        badge.dataset.vsbyCode = code;
        badge.title = '시정 데이터를 일시적으로 불러올 수 없습니다';
        badge.innerHTML = '<span class="lbl">시정</span> --km';
        badge.addEventListener('click', function (e) {
            e.stopPropagation();
            if (typeof window._showOceanToast === 'function') {
                window._showOceanToast('시정 데이터를 일시적으로 불러올 수 없습니다.', 'bottom', 1800, false);
            }
        });
        return badge;
    }

    /** 시정 요약을 1회 비동기 로드해 summaryCache 에 저장하고 refreshAll 예약. */
    function _ensureSummary(code) {
        var cur = state.summaryCache[code];
        // 진행중(undefined 마커)·정상값·데이터없음(null)은 재요청 불필요.
        if (code in state.summaryCache && cur !== 'error') return;
        // 'error'(서버 장애)는 쿨다운(60초) 경과 후에만 재시도해 요청 폭주를 막는다.
        if (cur === 'error' && Date.now() < (state.errRetryAt[code] || 0)) return;

        state.summaryCache[code] = undefined;      // 진행중 마커
        _computeZoneSummary(code).then(function (summary) {
            state.summaryCache[code] = summary || null;   // 값 있으면 객체, 없으면 null(데이터없음)
            delete state.errRetryAt[code];
            _scheduleBadgeRefresh();
        }).catch(function () {
            // fetch 실패(504/네트워크 등) → 데이터 없음(null)과 구분해 'error' 로 표시.
            state.summaryCache[code] = 'error';
            state.errRetryAt[code] = Date.now() + 60000;   // 60초 후 재시도 허용
            _scheduleBadgeRefresh();                        // 회색 뱃지로 재합류
        });
    }

    /** 여러 구역의 요약이 도착할 때 묶어서 평균박스를 1회만 다시 그린다(디바운스). */
    function _scheduleBadgeRefresh() {
        if (state.refreshTimer) return;
        state.refreshTimer = setTimeout(function () {
            state.refreshTimer = null;
            if (window.ZoneAvg && typeof window.ZoneAvg.refreshAll === 'function') {
                try { window.ZoneAvg.refreshAll(); } catch (e) {}
            }
        }, 150);
    }

    // 시정 뱃지를 부착할 아코디언 컨테이너 — 해역별 특보현황 + 해역별 기상현황.
    //   특보현황: render.js createAlertElement → .alert-card
    //   기상현황: windy.js  createStatusCard   → .weather-status-card
    //   (두 카드의 DOM 구조가 달라서 카드 셀렉터·해역명 추출을 둘 다 지원해야 한다.)
    var BADGE_CONTAINER_IDS = ['alert-content', 'marine-status-content'];
    var CARD_SELECTOR = '.alert-card, .weather-status-card';

    /** 대상 컨테이너들 내 모든 카드 스캔. */
    function _scanCards() {
        if (!state.nameToCode) return;
        var seen = 0, attached = 0;
        for (var ci = 0; ci < BADGE_CONTAINER_IDS.length; ci++) {
            var container = document.getElementById(BADGE_CONTAINER_IDS[ci]);
            if (!container) continue;
            var cards = container.querySelectorAll(CARD_SELECTOR);
            for (var i = 0; i < cards.length; i++) {
                var done = cards[i].dataset.vsbyBadgeDone === '1';
                _attachBadgeToCard(cards[i]);
                seen++;
                if (!done && cards[i].querySelector('.vsby-zone-badge')) attached++;
            }
        }
        if (window.__VSBY_DEBUG) {
            console.warn('[vsby-badge] scan: cards=' + seen + ' newBadges=' + attached
                + ' nameToCode=' + (state.nameToCode ? Object.keys(state.nameToCode).length : 0));
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 소해구 폴리곤 그리기
    // ─────────────────────────────────────────────────────────────

    function _getMap() {
        if (typeof window.__getOceanMap === 'function') return window.__getOceanMap();
        if (typeof window.getOceanMap === 'function') return window.getOceanMap();
        return null;
    }

    /** 셀 키 "P-s" 분해 — parent = 마지막 '-' 앞, sub = 뒤(1..9). */
    function _splitCellKey(key) {
        var idx = key.lastIndexOf('-');
        if (idx < 0) return null;
        var parent = key.slice(0, idx);
        var sub = parseInt(key.slice(idx + 1), 10);
        if (!parent || !(sub >= 1 && sub <= 9)) return null;
        return { parent: parent, sub: sub };
    }

    /**
     * 부모 box + sub(1..9) → 소해구 4326 ring [[lon,lat]...] (닫힌 사각형).
     * r=floor((s-1)/3) (row0=북/top), c=(s-1)%3 (col0=서/left).
     */
    function _subRing(box, sub) {
        var lonMin = box[0], latMin = box[1], lonMax = box[2], latMax = box[3];
        var dlon = (lonMax - lonMin) / 3;
        var dlat = (latMax - latMin) / 3;
        var r = Math.floor((sub - 1) / 3);
        var c = (sub - 1) % 3;
        var sLonMin = lonMin + c * dlon;
        var sLonMax = lonMin + (c + 1) * dlon;
        var sLatMax = latMax - r * dlat;
        var sLatMin = latMax - (r + 1) * dlat;
        return [
            [sLonMin, sLatMin],
            [sLonMax, sLatMin],
            [sLonMax, sLatMax],
            [sLonMin, sLatMax],
            [sLonMin, sLatMin]
        ];
    }

    /** lon/lat ring → EPSG:3857 ring. */
    function _ringTo3857(ring) {
        var out = [];
        for (var i = 0; i < ring.length; i++) {
            out.push(ol.proj.fromLonLat(ring[i]));
        }
        return out;
    }

    /** feature 별 style 함수 — fill(≤10km) + 항상 km 텍스트. */
    function _cellStyleFn(feature) {
        var v = feature.get('vsbyV');          // 클램프된 km 값
        var color = feature.get('vsbyColor');  // 버킷 hex
        var label = feature.get('vsbyLabel');  // km 라벨 문자열

        var styleOpts = {
            stroke: new ol.style.Stroke({
                color: 'rgba(255,255,255,0.55)',
                width: 1
            }),
            text: new ol.style.Text({
                text: label || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            })
        };
        // v ≤ 10km → 채움, v > 10km → 채움 없음(투명).
        if (v != null && v <= VSBY_FILL_MAX) {
            styleOpts.fill = new ol.style.Fill({
                color: 'rgba(' + _hexToRgb(color) + ',0.55)'
            });
        }
        return new ol.style.Style(styleOpts);
    }

    /**
     * 특보구역 소해구 폴리곤 레이어 빌드 후 지도에 추가.
     * @returns {Promise<void>}
     */
    function _drawZone(code) {
        var map = _getMap();
        if (!map || typeof ol === 'undefined') return Promise.reject(new Error('map/ol 없음'));

        return Promise.all([_loadParentBoxes(), _loadZoneCells(code)]).then(function (res) {
            var parentBox = res[0];
            var cells = res[1].cells || {};
            var pick = _pickNearestTimeIndex(cells);
            if (!pick) throw new Error('시정 데이터 없음');

            var meta = state.gridMap[code];
            var smallZones = (meta && meta.smallZones) || Object.keys(cells);

            var features = [];
            for (var i = 0; i < smallZones.length; i++) {
                var key = smallZones[i];
                var parts = _splitCellKey(key);
                if (!parts) continue;
                var box = parentBox[parts.parent];
                if (!box) continue;
                var series = cells[key];
                var rawV = _valueAt(series, pick.index, pick.t);
                if (rawV == null) continue;          // 데이터 없는 셀은 그리지 않음
                var v = _clamp(rawV);
                var color = VSBY_STOPS[_bucketIndex(v)].color;

                var ring3857 = _ringTo3857(_subRing(box, parts.sub));
                var feat = new ol.Feature({
                    geometry: new ol.geom.Polygon([ring3857])
                });
                feat.set('vsbyV', v);
                feat.set('vsbyColor', color);
                feat.set('vsbyLabel', _fmtKm(v));
                features.push(feat);
            }

            _removeLayer();
            state.layer = new ol.layer.Vector({
                source: new ol.source.Vector({ features: features }),
                style: _cellStyleFn,
                zIndex: LAYER_ZINDEX
            });
            map.addLayer(state.layer);
            state.activeCode = code;

            // 프레이밍 — zone_grid_map 에 viewBox 가 있으면 그것으로, 없으면(현 데이터에
            // viewBox 키 없음) 실제 그려진 소해구 폴리곤 extent 로 자동 프레이밍.
            if (meta && Array.isArray(meta.viewBox) && meta.viewBox.length === 4) {
                _fitToExtentLonLat(map, meta.viewBox);
            } else if (features.length) {
                _fitToFeatures(map, state.layer.getSource());
            }
        });
    }

    /** lon/lat [minLon,minLat,maxLon,maxLat] 로 프레이밍. */
    function _fitToExtentLonLat(map, vb) {
        try {
            var sw = ol.proj.fromLonLat([vb[0], vb[1]]);
            var ne = ol.proj.fromLonLat([vb[2], vb[3]]);
            var extent = [
                Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1]),
                Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])
            ];
            map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 350, maxZoom: 11 });
        } catch (e) { /* noop — 프레이밍 실패는 비치명적 */ }
    }

    /** 그려진 feature 들의 extent 로 프레이밍. */
    function _fitToFeatures(map, source) {
        try {
            var extent = source.getExtent();
            if (extent && isFinite(extent[0])) {
                map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 350, maxZoom: 11 });
            }
        } catch (e) { /* noop */ }
    }

    function _removeLayer() {
        var map = _getMap();
        if (state.layer && map) {
            try { map.removeLayer(state.layer); } catch (e) {}
        }
        state.layer = null;
        state.activeCode = null;
    }

    /** 모든 뱃지의 active 표시 갱신. */
    function _refreshBadgeActiveState() {
        var badges = document.querySelectorAll('.zone-avg-badge.vsby');
        for (var i = 0; i < badges.length; i++) {
            var b = badges[i];
            if (b.dataset.vsbyCode === state.activeCode) b.classList.add('active');
            else b.classList.remove('active');
        }
    }

    function _onBadgeClick(code, badge) {
        if (state.activeCode === code) { _closePopup(); return; }
        _showZonePopup(code).catch(function (e) {
            console.warn('[vsby-badge] 시정 팝업 실패:', e && e.message);
            _closePopup();
            if (typeof window._showOceanToast === 'function') {
                window._showOceanToast('시정 정보를 표시할 수 없습니다.', 'bottom', 1800, false);
            }
        });
    }

    // 특보구역 소해구 색칠 feature 빌드 (현재시각 기준).
    function _buildZoneFeatures(code) {
        return Promise.all([_loadParentBoxes(), _loadZoneCells(code)]).then(function (res) {
            var parentBox = res[0];
            var cells = res[1].cells || {};
            var pick = _pickNearestTimeIndex(cells);
            var meta = state.gridMap[code];
            var smallZones = (meta && meta.smallZones) || Object.keys(cells);
            var features = [];
            if (pick) {
                for (var i = 0; i < smallZones.length; i++) {
                    var parts = _splitCellKey(smallZones[i]);
                    if (!parts) continue;
                    var box = parentBox[parts.parent];
                    if (!box) continue;
                    var rawV = _valueAt(cells[smallZones[i]], pick.index, pick.t);
                    if (rawV == null) continue;
                    var v = _clamp(rawV);
                    var feat = new ol.Feature({ geometry: new ol.geom.Polygon([_ringTo3857(_subRing(box, parts.sub))]) });
                    feat.set('vsbyV', v);
                    feat.set('vsbyColor', VSBY_STOPS[_bucketIndex(v)].color);
                    feat.set('vsbyLabel', _fmtKm(v));
                    features.push(feat);
                }
            }
            return { features: features, meta: meta, time: pick && pick.t };
        });
    }

    function _legendHTML() {
        var h = '<span class="vsby-pop-legend-label">시정(km)</span>';
        for (var i = 0; i < VSBY_STOPS.length; i++) {
            h += '<span class="vsby-pop-chip" style="background:' + VSBY_STOPS[i].color + '" title="' + VSBY_STOPS[i].v + 'km"></span>';
        }
        h += '<span class="vsby-pop-legend-sub">≤10km 색 / &gt;10km 투명</span>';
        return h;
    }

    // [팝업] viewBox 영역을 크롭한 자체 ol.Map 에 소해구 색칠 표출.
    //   해양종합정보 탭의 지도(__getOceanMap)에 의존하지 않으므로 어느 탭에서도 동작.
    function _showZonePopup(code) {
        if (typeof ol === 'undefined') return Promise.reject(new Error('ol 없음'));
        return _buildZoneFeatures(code).then(function (built) {
            _closePopup();
            var meta = built.meta || {};
            var overlay = document.createElement('div');
            overlay.className = 'vsby-pop-overlay';
            overlay.addEventListener('click', function (e) { if (e.target === overlay) _closePopup(); });
            var boxEl = document.createElement('div');
            boxEl.className = 'vsby-pop-box';
            boxEl.addEventListener('click', function (e) { e.stopPropagation(); });
            var head = document.createElement('div');
            head.className = 'vsby-pop-head';
            head.innerHTML = '<span class="vsby-pop-title">' + (meta.name || code) + ' · 시정</span>'
                + '<span class="vsby-pop-time">' + (built.time || '') + '</span>';
            var closeBtn = document.createElement('button');
            closeBtn.type = 'button'; closeBtn.className = 'vsby-pop-close'; closeBtn.textContent = '×';
            closeBtn.addEventListener('click', _closePopup);
            head.appendChild(closeBtn);
            var mapDiv = document.createElement('div');
            mapDiv.className = 'vsby-pop-map';
            // 범례 제거 — 폴리곤이 색칠되고 km 텍스트도 표기되므로 불필요(사용자 요청).
            boxEl.appendChild(head); boxEl.appendChild(mapDiv);
            overlay.appendChild(boxEl);
            document.body.appendChild(overlay);
            state.popupEl = overlay;

            var vLayer = new ol.layer.Vector({
                source: new ol.source.Vector({ features: built.features }),
                style: _cellStyleFn, zIndex: 5
            });
            var layers = [];
            // 베이스맵(OSM) — 빌드에 없으면 가드해 벡터만 표시(팝업 자체는 항상 뜸).
            var hasOsm = false;
            try { if (ol.source && ol.source.OSM) { layers.push(new ol.layer.Tile({ source: new ol.source.OSM(), opacity: 0.9 })); hasOsm = true; } } catch (e) {}
            layers.push(vLayer);
            // OL 기본 저작권 컨트롤은 끄고(중앙/우측에 떠 보이는 문제), 직접 좌측하단에 고정 표기.
            var ctrls; try { ctrls = ol.control.defaults.defaults({ attribution: false }); } catch (e) { try { ctrls = ol.control.defaults({ attribution: false }); } catch (e2) { ctrls = undefined; } }
            var mapOpts = {
                target: mapDiv,
                layers: layers,
                view: new ol.View({ projection: 'EPSG:3857', center: ol.proj.fromLonLat([128, 36]), zoom: 6 })
            };
            if (ctrls) mapOpts.controls = ctrls;
            var map = new ol.Map(mapOpts);
            if (hasOsm) {
                var attr = document.createElement('div');
                attr.className = 'vsby-pop-attr';
                attr.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
                mapDiv.appendChild(attr);
            }
            state.popupMap = map;
            setTimeout(function () {
                try { map.updateSize(); } catch (e) {}
                if (meta && Array.isArray(meta.viewBox) && meta.viewBox.length === 4) _fitToExtentLonLat(map, meta.viewBox);
                else if (built.features.length) _fitToFeatures(map, vLayer.getSource());
            }, 40);
            if (!built.features.length) {
                var em = document.createElement('div'); em.className = 'vsby-pop-empty'; em.textContent = '시정 데이터 없음';
                mapDiv.appendChild(em);
            }
            state.activeCode = code;
            _refreshBadgeActiveState();
            // 하드웨어 뒤로가기 버튼으로 닫히도록 팝업 스택에 등록(backbutton.js).
            try { if (window.PopupStack) window.PopupStack.push('vsby-zone-popup', _closePopup); } catch (e) {}
        });
    }

    function _closePopup() {
        try { if (window.PopupStack) window.PopupStack.remove('vsby-zone-popup'); } catch (e) {}
        if (state.popupMap) { try { state.popupMap.setTarget(null); } catch (e) {} state.popupMap = null; }
        if (state.popupEl && state.popupEl.parentNode) state.popupEl.parentNode.removeChild(state.popupEl);
        state.popupEl = null;
        state.activeCode = null;
        _refreshBadgeActiveState();
    }

    // ─────────────────────────────────────────────────────────────
    // CSS 주입
    // ─────────────────────────────────────────────────────────────
    function _injectCss() {
        if (document.getElementById('vsby-zone-badge-style')) return;
        var st = document.createElement('style');
        st.id = 'vsby-zone-badge-style';
        st.textContent = ''
            + '.vsby-zone-badge{'
            +   'display:inline-flex;align-items:center;'
            +   'font-size:0.72rem;font-weight:600;line-height:1;'
            +   'padding:4px 8px;border-radius:6px;cursor:pointer;'
            +   'color:#cdeefd;background:rgba(31,182,214,0.15);'
            +   'border:1px solid rgba(31,182,214,0.4);'
            +   'margin-right:4px;flex-shrink:0;white-space:nowrap;'
            +   'transition:background .15s,border-color .15s;'
            + '}'
            + '.vsby-zone-badge:hover{'
            +   'background:rgba(31,182,214,0.3);border-color:rgba(31,182,214,0.6);'
            + '}'
            + '.vsby-zone-badge.active{'
            +   'background:rgba(31,182,214,0.55);border-color:#1fb6d6;color:#fff;'
            + '}'
            // ── 평균박스에 합류한 시정 펄 (.zone-avg-badge 와 동일 모양) ──
            //    파고(하늘색)·풍속(주황)과 확실히 구분되도록 보라색 사용.
            + '.zone-avg-box .zone-avg-badge.vsby{'
            +   '--zab-strong:rgba(186,104,200,0.9);--zab-faded:rgba(186,104,200,0.15);'
            +   'background:rgba(186,104,200,0.18);color:#e1bee7;cursor:pointer;'
            + '}'
            + '.zone-avg-box .zone-avg-badge.vsby.active{'
            +   'background:rgba(186,104,200,0.5);border-color:#ba68c8;color:#fff;'
            + '}'
            // ── 서버 장애 시 회색 비활성 뱃지 ("--km") ──
            //    보라색 기본 스타일을 덮어쓰도록 셀렉터 specificity 를 한 단계 높임.
            + '.zone-avg-box .zone-avg-badge.vsby.vsby-disabled{'
            +   '--zab-strong:rgba(140,150,160,0.85);--zab-faded:rgba(140,150,160,0.15);'
            +   'background:rgba(140,150,160,0.18);color:#9aa6b2;'
            +   'border-color:rgba(140,150,160,0.4);cursor:default;opacity:0.8;'
            + '}'
            // ── 시정 팝업(자체 미니 해구도) ──
            + '.vsby-pop-overlay{position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,0.55);'
            +   'display:flex;align-items:center;justify-content:center;padding:16px;}'
            + '.vsby-pop-box{width:min(92vw,560px);max-height:88vh;display:flex;flex-direction:column;'
            +   'background:#0f1722;border:1px solid #243246;border-radius:12px;overflow:hidden;'
            +   'box-shadow:0 12px 40px rgba(0,0,0,0.5);}'
            + '.vsby-pop-head{display:flex;align-items:center;gap:8px;padding:12px 14px;'
            +   'background:#16202f;border-bottom:1px solid #243246;}'
            + '.vsby-pop-title{font-size:0.95rem;font-weight:700;color:#eaf2fb;}'
            + '.vsby-pop-time{font-size:0.72rem;color:#8aa0bf;}'
            + '.vsby-pop-close{margin-left:auto;width:28px;height:28px;border-radius:6px;border:0;'
            +   'background:#243246;color:#cdd9ea;font-size:18px;line-height:1;cursor:pointer;}'
            + '.vsby-pop-close:hover{background:#2f4259;}'
            + '.vsby-pop-map{position:relative;width:100%;height:min(60vh,420px);background:#16202f;}'
            // OL 기본 저작권 표기는 숨기고, 직접 만든 표기를 지도 좌측 하단 코너에 딱 붙임.
            + '.vsby-pop-map .ol-attribution{display:none!important;}'
            + '.vsby-pop-attr{position:absolute;left:0;bottom:0;z-index:10;'
            +   'font-size:0.6rem;line-height:1.5;color:#cdd9ea;'
            +   'background:rgba(15,23,34,0.72);padding:1px 7px;border-radius:0 6px 0 0;'
            +   'pointer-events:auto;}'
            + '.vsby-pop-attr a{color:#9ec5ff;text-decoration:none;}'
            + '.vsby-pop-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
            +   'color:#8aa0bf;font-size:0.85rem;}'
            + '.vsby-pop-legend{display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding:8px 12px;'
            +   'background:#0f1722;border-top:1px solid #243246;}'
            + '.vsby-pop-legend-label{font-size:0.72rem;color:#aebfd6;margin-right:4px;}'
            + '.vsby-pop-chip{width:13px;height:13px;border-radius:2px;display:inline-block;}'
            + '.vsby-pop-legend-sub{font-size:0.68rem;color:#7d8ea8;margin-left:6px;}';
        document.head.appendChild(st);
    }

    // ─────────────────────────────────────────────────────────────
    // 부트스트랩
    // ─────────────────────────────────────────────────────────────

    function _startObserver() {
        if (!state.observers) state.observers = {};
        var observedAny = false;
        for (var ci = 0; ci < BADGE_CONTAINER_IDS.length; ci++) {
            var id = BADGE_CONTAINER_IDS[ci];
            if (state.observers[id]) { observedAny = true; continue; }
            var container = document.getElementById(id);
            if (!container) continue;
            var ob = new MutationObserver(function () {
                // 카드가 다시 그려지면 재스캔 (renderApp 이 카드 DOM 교체).
                _scanCards();
            });
            ob.observe(container, { childList: true, subtree: true });
            state.observers[id] = ob;
            observedAny = true;
        }
        if (observedAny) _scanCards();   // 초기 1회
        // 두 컨테이너 모두 관찰되기 전까지는 false 로 보고해 재시도 루프 유지.
        return Object.keys(state.observers).length >= BADGE_CONTAINER_IDS.length;
    }

    function _boot() {
        _injectCss();
        // 매핑 로드 후, 평균박스(zone_avg)를 다시 그려 시정 뱃지를 합류시킨다.
        //   (첫 렌더 때 gridMap 미로드면 makeBadge 가 null 이라 시정이 빠질 수 있어,
        //    로드 완료 시 refreshAll 로 보강.)
        _loadGridMap().then(function () {
            if (window.ZoneAvg && typeof window.ZoneAvg.refreshAll === 'function') {
                try { window.ZoneAvg.refreshAll(); } catch (e) {}
            }
            // 특보/기상 데이터 갱신 시 평균박스 재생성으로 시정 자동 합류 → 별도 관찰 불필요.
        });
    }

    // 외부 연동 API — zone_avg 가 makeBadge 호출, 디버깅용 clear.
    window.OceanWarnVsby = {
        makeBadge: makeBadge,
        clear: function () { _closePopup(); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }
})();
