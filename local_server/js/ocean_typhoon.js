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

    var TAP_THRESHOLD = 10;   // 비활성 버튼을 10회 탭하면 기능 활성화(히든 탭, 세션 한정)
    var TAP_RESET_MS = 3000;  // 탭 간격이 이보다 길면 카운트 리셋
    var FULL_PLAY_MS = 12000; // 전체 타임라인 재생 시간(스크러버 0→끝)

    var _unlocked = false;
    var _tapCount = 0;
    var _tapTimer = null;

    // 줌 자동조정 기준: 태풍 + "우리나라(제주~본토)"가 한 화면에 함께 보이도록 fit
    var KOREA_W = 124.5, KOREA_E = 131.0, KOREA_S = 33.0, KOREA_N = 38.6;
    var FIT_MAX_ZOOM = 7;

    var _pNow = 0;             // 현재 시각에 해당하는 타임라인 위치(0..1)

    var _map = null;
    // dmdw 상세정보 레이어 대응: 예측경로(track) / 70%확률반경(prob) / 강풍반경(strong) / 폭풍반경(storm)
    var _trackLayer = null, _probLayer = null, _strongLayer = null, _stormLayer = null, _headLayer = null, _pointLayer = null;
    var _trackSrc = null, _probSrc = null, _strongSrc = null, _stormSrc = null, _headSrc = null, _pointSrc = null;
    var _prevBasemap = null;  // 태풍 ON 직전 베이스맵(끄면 복원)
    var LAYER_KEY = 'seagnal_typhoon_layers';
    var _layerOn = { track: true, prob: true, strong: false, storm: false };
    var RELAX_MIN_ZOOM = 3;   // 태풍 ON 시 minZoom 완화(더 넓게 축소 가능; 기본 6 → 3)
    var _origMinZoom = null;  // 원래 minZoom 백업(끄면 복원)
    var _moveBubble = null, _moveEl = null;  // 재생 중 이동 말풍선(ol.Overlay)
    var _landPopup = null, _landEl = null;   // 육지 클릭 시 강풍반경 도달시간 팝업(ol.Overlay)
    var _pointBubbles = [];   // 정지(기본) 시 포인트별 말풍선 풀(ol.Overlay)
    var _playbackMode = false; // true=재생(이동 말풍선만), false=기본(포인트별 말풍선 + 사전 범위)
    var _koreaBuoy = null;     // 우리 해역 진입 시 진로선 최근접 부이 관측 {name,type,obs} (해구도 표출 시에만 사용)
    var _enrichToken = 0;      // 비동기 해구도/부이 enrich 경합 방지 토큰
    var _debugKorea = false;   // [디버그] 트리거/72h게이트/강풍반경 거리 무시하고 최근접 해구·부이 강제 표출

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
    var RED_GRADE = 1;        // 강도 1(약) 이상이면 강도·풍속을 빨강+볼드. 0(열대저압부)은 흰색.
    var RED_COLOR = '#ff3b3b';
    // 반경 유형별 색(지도 원과 말풍선 텍스트가 동일 색을 쓰도록)
    var STRONG_C = [232, 160, 0];   // 강풍반경 — 황색
    var STORM_C = [43, 108, 214];   // 폭풍반경 — 청색
    var PROB_C = [60, 165, 110];    // 70% 확률반경 — 녹색
    function cssRgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

    // 기상청 강도별 예상 피해(현상) 척도
    var DAMAGE_DESC = { 0: '', 1: '간판이 날아갈 정도', 2: '지붕이 날아갈 정도', 3: '기차가 탈선할 정도', 4: '사람·큰 돌이 날아갈 정도', 5: '건물이 붕괴될 정도' };
    // 보퍼트 풍력계급 기준 외해 추정 파고(m) — 풍속(m/s)로 근사
    function beaufortWaveM(ms) {
        if (ms == null || isNaN(ms)) return null;
        if (ms < 10.8) return 2; if (ms < 13.9) return 3; if (ms < 17.2) return 4;
        if (ms < 20.8) return 5.5; if (ms < 24.5) return 7; if (ms < 28.5) return 9;
        if (ms < 32.7) return 11.5; return 14;
    }

    // ── 우리 해역(해구도) 진입 판정/표출 상수 ───────────────────────────────────
    var KOREA_TRIG_LAT = 31.0;   // 488~501 남단 = 제주 남쪽 바깥먼바다 남단. 강풍반경 북단이 이 위도에 닿으면 후보.
    var ZONE_MATCH_H = 1.6;      // 해구도 tm 과 프레임시각 차가 이 시간(h) 이내여야 72h 예측범위 내로 인정(3h 격자).
    var KMA_TZ_MS = 9 * 3600000; // 태풍/부이(KST) ↔ 해구도 tm(UTC) 9시간 보정.
    var KM_PER_DEG = 111;
    // 16방위(한글)
    var DIR16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
    function dir16(deg) { if (deg == null || isNaN(deg)) return ''; return DIR16[Math.round(deg / 22.5) % 16]; }
    function dirStr(deg) { var s = dir16(deg); return s ? (s + ' ' + Math.round(deg) + '°') : (Math.round(deg) + '°'); }
    function haversineKm(la1, lo1, la2, lo2) {
        var R = 6371, r = Math.PI / 180;
        var dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
        var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    // 점(la,lo) 에서 진로선(프레임 폴리라인) 까지 최소거리 km — 등거리원통 근사로 세그먼트별 계산.
    function pointToTrackKm(la, lo) {
        if (_frames.length === 0) return Infinity;
        if (_frames.length === 1) return haversineKm(la, lo, _frames[0].lat, _frames[0].lon);
        var min = Infinity;
        for (var i = 0; i < _frames.length - 1; i++) {
            var a = _frames[i], b = _frames[i + 1];
            var cl = Math.cos(la * Math.PI / 180);
            var ax = a.lon * cl, ay = a.lat, bx = b.lon * cl, by = b.lat, px = lo * cl, py = la;
            var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
            var t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            var qx = ax + t * dx, qy = ay + t * dy;
            var d = haversineKm(la, lo, qy, qx / (cl || 1));
            if (d < min) min = d;
        }
        return min;
    }
    // KST 벽시계 "YYYYMMDDHHmm" → "M월 D일 HH시" (그대로 표시용)
    function kstTmLabel(tm) {
        var s = String(tm || '').replace(/[^0-9]/g, ''); if (s.length < 10) return '';
        var hh = s.slice(8, 10), mi = s.slice(10, 12) || '00';
        return (+s.slice(4, 6)) + '월 ' + (+s.slice(6, 8)) + '일 ' + hh + (mi !== '00' ? ':' + mi : '시');
    }
    // 해구도 tm(UTC "YYYYMMDDHHmm") → KST "M월 D일 HH시" 라벨
    function utcTmToKstLabel(tm) {
        var s = String(tm || '').replace(/[^0-9]/g, ''); if (s.length < 10) return '';
        var ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +(s.slice(10, 12) || 0)) + KMA_TZ_MS;
        var d = new Date(ms);
        return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + (d.getUTCHours() < 10 ? '0' : '') + d.getUTCHours() + '시';
    }

    // 말풍선 HTML (각 반경은 지도 원과 동일 색, 강도·풍속은 TD 흰색 / 강도1↑ 빨강+볼드)
    function bubbleHTML(o, header) {
        var g = o._gradeF != null ? o._gradeF : (o.grade != null ? o.grade : 0);
        var em = g >= RED_GRADE;
        var gStyle = 'color:' + (em ? RED_COLOR : '#ffffff') + ';font-weight:' + (em ? '800' : '600');
        var h = '<div class="tphn-b-h">' + header + '</div>';
        var spd = o.windMs != null ? Math.round(o.windMs) + 'm/s · ' + Math.round(o.windMs * 3.6) + 'km/h' : '';
        h += '<div class="tphn-b-grade tphn-blink" style="' + gStyle + '">강도 ' + (GRADE_NAMES[g] || '-') + (spd ? ' · ' + spd : '') + '</div>';
        // 헤더+강도 2줄 외 나머지 — 흐린 말풍선에선 CSS(.tphn-faint .tphn-b-more)로 숨김.
        var more = '';
        if (o.pressure != null) more += '<div class="tphn-b-sub">중심기압 ' + Math.round(o.pressure) + 'hPa</div>';
        if (o.radStrong) more += '<div style="color:' + cssRgb(STRONG_C) + '">강풍반경 ' + Math.round(o.radStrong) + 'km</div>';
        if (o.radStorm) more += '<div style="color:' + cssRgb(STORM_C) + '">폭풍반경 ' + Math.round(o.radStorm) + 'km</div>';
        if (o.radProb) more += '<div style="color:' + cssRgb(PROB_C) + '">태풍 위치 70% 확률 반경 ' + Math.round(o.radProb) + 'km</div>';
        // 예상 피해 — 70% 반경 라인 바로 아래.
        var dmg = DAMAGE_DESC[g];
        if (dmg) more += '<div class="tphn-b-dmg">예상 피해: ' + dmg + '</div>';
        // 파고: 우리 해역(해구도 예측 범위) 진입 시 해구도 예측 + 진로 최근접 부이 관측, 아니면 보퍼트 추정.
        if (o._zoneFc) {
            var z = o._zoneFc;
            more += '<div class="tphn-b-zone tphn-blink">' + z.lzone + ' 해구 예상 기상(' + utcTmToKstLabel(z.tm) + ' 기준)' + (_debugKorea ? ' [디버그]' : '') + '</div>';
            more += '<div class="tphn-b-sub">유의파고 ' + (z.wh != null ? z.wh.toFixed(1) : '-') + 'm'
                + (z.wp != null ? ' · 파주기 ' + Math.round(z.wp) + 's' : '') + '</div>';
            more += '<div class="tphn-b-sub">파향 ' + dirStr(z.waveDir) + ' · 풍향 ' + dirStr(z.windDir)
                + ' · 풍속 ' + (z.ws != null ? z.ws.toFixed(1) : '-') + 'm/s</div>';
            if (_koreaBuoy && _koreaBuoy.obs) {
                var bo = _koreaBuoy.obs, isB = _koreaBuoy.type === 'B';
                more += '<div class="tphn-b-buoy tphn-blink">' + _koreaBuoy.name + ' 부이 관측 정보(' + kstTmLabel(bo.tm) + ' 기준)</div>';
                var wparts = [];
                if (bo.waveHeightSig != null) wparts.push('유의 ' + bo.waveHeightSig.toFixed(1) + 'm');
                if (bo.waveHeightMax != null) wparts.push('최대 ' + bo.waveHeightMax.toFixed(1) + 'm');
                if (bo.waveHeightAvg != null) wparts.push('평균 ' + bo.waveHeightAvg.toFixed(1) + 'm');
                if (wparts.length) more += '<div class="tphn-b-sub">파고 ' + wparts.join(' / ') + '</div>';
                if (isB && (bo.windSpeed != null || bo.windDirection != null)) {
                    more += '<div class="tphn-b-sub">풍향 ' + (bo.windDirection != null ? dirStr(bo.windDirection) : '-')
                        + ' · 풍속 ' + (bo.windSpeed != null ? bo.windSpeed.toFixed(1) + 'm/s' : '-') + '</div>';
                }
            }
        } else {
            var wv = beaufortWaveM(o.windMs);
            if (wv != null) more += '<div class="tphn-b-sub">예상파고(외해 추정) 약 ' + wv + 'm</div>';
        }
        more += '<button type="button" class="tphn-guide-btn"><i class="fa-solid fa-life-ring"></i> 해상 종사자 행동요령</button>';
        h += '<div class="tphn-b-more">' + more + '</div>';
        return h;
    }
    function makeBubbleOverlay() {
        var el = document.createElement('div');
        el.className = 'tphn-bubble';
        // 말풍선 클릭. stopEvent:false 라 지도 드래그/줌은 통과(전파 막지 않음).
        //   지도 클릭은 handleMapClick 가 .tphn-bubble 타깃이면 무시 → 바텀시트 안 뜸.
        //   - 행동요령 버튼이면 팝업 열기.
        //   - 그 외엔 단일 선택 토글: 흐린 걸 누르면 그것만 진하게(나머지 흐림),
        //     진한 걸 다시 누르면 흐려짐. 진한 말풍선은 z-index↑ + 최상단으로.
        el.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.tphn-guide-btn')) { openGuideModal(); return; }
            var wasFaint = el.classList.contains('tphn-faint');
            _pointBubbles.forEach(function (ov) { var e2 = ov.getElement(); e2.classList.add('tphn-faint'); setBubbleZ(e2, '1'); });
            if (wasFaint) { el.classList.remove('tphn-faint'); setBubbleZ(el, '500'); bringBubbleToFront(el); }
        });
        return new ol.Overlay({ element: el, offset: [12, -12], positioning: 'bottom-left', stopEvent: false });
    }
    // 진한(클릭된) 말풍선을 항상 최상단에 그린다.
    //   OL8 은 오버레이를 .ol-overlay-container 래퍼로 감싸고 getElement()는 내부 요소를 돌려준다.
    //   적층은 "래퍼"의 DOM 순서/ z-index 가 좌우하므로 el.parentNode(=래퍼)를 조작해야 한다.
    function bringBubbleToFront(el) {
        var w = el && el.parentNode;                         // .ol-overlay-container 래퍼
        if (w && w.parentNode) w.parentNode.appendChild(w);  // 컨테이너 맨 뒤 = 최상단
    }
    function setBubbleZ(el, z) { var w = el && el.parentNode; if (w) w.style.zIndex = z; }
    // 행동요령 팝업 열기/닫기 — backbutton.js 의 PopupStack 에 등록해 하드웨어 뒤로가기로 닫힘.
    function openGuideModal() {
        var gm = document.getElementById('tphn-guide-modal');
        if (!gm) return;
        gm.style.display = 'flex';
        if (window.PopupStack) window.PopupStack.push('tphn-guide', closeGuideModal);
    }
    function closeGuideModal() {
        var gm = document.getElementById('tphn-guide-modal');
        if (gm) gm.style.display = 'none';
        if (window.PopupStack) window.PopupStack.remove('tphn-guide');
    }
    function hideLandPopup() {
        if (_landEl) _landEl.style.display = 'none';
        if (_landPopup) _landPopup.setPosition(undefined);
        if (window.PopupStack) window.PopupStack.remove('tphn-land');
    }
    function updateBubbleVisibility() {
        var pb = _playbackMode;
        _pointBubbles.forEach(function (ov, i) {
            ov.getElement().style.display = (_visible && !pb && i < _frames.length && _layerOn.track) ? '' : 'none';
        });
        if (_moveEl) _moveEl.style.display = (_visible && pb) ? '' : 'none';
    }
    function setPlaybackMode(on) { _playbackMode = on; applyLayerVisibility(); }

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
    // 상대일 라벨(오늘/내일/모레/글피/그글피) — 그 외 날짜는 라벨 없음
    var REL_DAY = { 0: '오늘', 1: '내일', 2: '모레', 3: '글피', 4: '그글피' };
    // "M월 D일(상대어) HH시" 라벨. 프레임·현재 모두 KST-as-UTC-ms 공간이라 getUTC*/Date.UTC 로 비교.
    function dateTimeLabel(ms) {
        if (!isFinite(ms)) return '';
        var d = new Date(ms);
        var mm = d.getUTCMonth() + 1, dd = d.getUTCDate(), hh = d.getUTCHours(), mi = d.getUTCMinutes();
        var fDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        var n = new Date(nowKstMs());
        var nDay = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
        var rel = REL_DAY[Math.round((fDay - nDay) / 86400000)];
        var hStr = (hh < 10 ? '0' + hh : hh) + (mi ? ':' + (mi < 10 ? '0' + mi : mi) : '시');
        return mm + '월 ' + dd + '일' + (rel ? '(' + rel + ')' : '') + ' ' + hStr;
    }
    // 현재 시각이 타임라인(첫~끝 프레임)에서 차지하는 위치 0..1
    function computeNowP() {
        if (_frames.length < 2) return 0;
        var t0 = _frames[0]._t, t1 = _frames[_frames.length - 1]._t;
        if (t1 <= t0) return 0;
        return Math.max(0, Math.min(1, (nowKstMs() - t0) / (t1 - t0)));
    }

    // 경위도(deg)·반경(km) → EPSG:3857 좌표 링(구면 측지원, 72분할)
    function geoCircleRing(lon, lat, km, n) {
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
        return ring;
    }
    function geoCircle(lon, lat, km, n) { return new ol.geom.Polygon([geoCircleRing(lon, lat, km, n)]); }

    // 시작점에서 방위(rad)·거리(km) 만큼 떨어진 지점의 경위도
    function destPoint(lon, lat, brng, km) {
        var R = 6371.0088, d = km / R, la1 = lat * Math.PI / 180, lo1 = lon * Math.PI / 180;
        var la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brng));
        var lo2 = lo1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
        return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
    }
    function bearingRad(lon1, lat1, lon2, lat2) {
        var la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180, dlo = (lon2 - lon1) * Math.PI / 180;
        var y = Math.sin(dlo) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
        return Math.atan2(y, x);
    }

    // 진로를 따라 반경만큼 좌우로 벌린 매끈한 회랑(corridor) + 시작/끝 둥근 캡 → 단일 MultiPolygon.
    // pts: 시간순 프레임 배열. 정적=전체, 재생=시작~현재까지(자라나는 항적).
    function swathCorridorGeom(pts, key) {
        var P = [];
        pts.forEach(function (p) { if (p && p.lon != null && p[key] != null && p[key] > 0) P.push(p); });
        if (P.length === 0) return null;
        if (P.length === 1) return new ol.geom.MultiPolygon([[geoCircleRing(P[0].lon, P[0].lat, P[0][key])]]);
        var left = [], right = [];
        for (var i = 0; i < P.length; i++) {
            var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
            var brg = bearingRad(a.lon, a.lat, b.lon, b.lat);
            var r = P[i][key];
            left.push(ol.proj.fromLonLat(destPoint(P[i].lon, P[i].lat, brg - Math.PI / 2, r)));
            right.push(ol.proj.fromLonLat(destPoint(P[i].lon, P[i].lat, brg + Math.PI / 2, r)));
        }
        var ring = left.concat(right.reverse());
        ring.push(ring[0]);
        var polys = [[ring]];
        // 각 시점 원도 합쳐(둥근 캡 + 굴곡부 빈틈 메움) — 단일 fill 이라 겹쳐도 진해지지 않음
        for (var k = 0; k < P.length; k++) polys.push([geoCircleRing(P[k].lon, P[k].lat, P[k][key])]);
        return new ol.geom.MultiPolygon(polys);
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
        if (!_trackSrc) return;
        _trackSrc.clear(); _probSrc.clear(); _strongSrc.clear(); _stormSrc.clear(); _pointSrc.clear();
        if (!_frames.length) return;

        // 전체 진로 영역(매끈한 회랑) — 70%(아래)·강풍(중)·폭풍(위)은 레이어 zIndex 로 순서 보장
        var probG = swathCorridorGeom(_frames, 'radProb');
        if (probG) _probSrc.addFeature(new ol.Feature(probG));
        var strongG = swathCorridorGeom(_frames, 'radStrong');
        if (strongG) _strongSrc.addFeature(new ol.Feature(strongG));
        var stormG = swathCorridorGeom(_frames, 'radStorm');
        if (stormG) _stormSrc.addFeature(new ol.Feature(stormG));

        // ② 예측경로: 진로선 + 시점별 위치 점(강도색) + 라벨, ① 실제위치(현재) 강조
        var coords = _frames.map(function (f) { return ol.proj.fromLonLat([f.lon, f.lat]); });
        var line = new ol.Feature(new ol.geom.LineString(coords));
        line.setStyle(new ol.style.Style({
            stroke: new ol.style.Stroke({ color: 'rgba(40,40,40,0.85)', width: 2, lineDash: [6, 5] })
        }));
        _trackSrc.addFeature(line);

        _frames.forEach(function (f) {
            var c = f._color;
            var pt = new ol.Feature(pointAt(f.lon, f.lat));
            pt.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: f.isCurrent ? 7 : 5,
                    fill: new ol.style.Fill({ color: rgba(c, 0.95) }),
                    stroke: new ol.style.Stroke({ color: f.isCurrent ? '#d00' : '#fff', width: f.isCurrent ? 3 : 1.5 })
                })
            }));
            _pointSrc.addFeature(pt); // 포인트는 전용 최상단 레이어에
        });

        // 포인트별 말풍선(HTML 오버레이) — 기본(정지) 상태에서 각 포인트에 모두 표출.
        // 헤더: 최초=발표위치 / 이후=예상위치 + 시각.
        _frames.forEach(function (f, i) {
            var ov = _pointBubbles[i];
            if (!ov) { ov = makeBubbleOverlay(); _map.addOverlay(ov); _pointBubbles[i] = ov; }
            ov.getElement().innerHTML = bubbleHTML(f, bubbleHeader(f));
            // 최종 예상 위치(마지막)만 진하게+최상단, 나머지는 흐리게(배경 비침 → 시인성). 클릭 시 진하게.
            var op = (i === _frames.length - 1);
            ov.getElement().classList.toggle('tphn-faint', !op);
            setBubbleZ(ov.getElement(), op ? '500' : '1');
            ov.setPosition(ol.proj.fromLonLat([f.lon, f.lat]));
        });
        for (var i = _frames.length; i < _pointBubbles.length; i++) _pointBubbles[i].setPosition(undefined);
        // 기본 진한 말풍선(마지막)을 최상단으로.
        if (_frames.length && _pointBubbles[_frames.length - 1]) bringBubbleToFront(_pointBubbles[_frames.length - 1].getElement());
        updateBubbleVisibility();
    }
    function bubbleHeader(f) {
        return dateTimeLabel(timeToMs(f.time)) + (f.isCurrent ? ' 발표위치' : ' 예상위치');
    }
    // enrich(해구도/부이) 후 포인트 말풍선 내용만 갱신(흐림 상태는 유지).
    //   이동 말풍선은 재생 루프가 매 프레임 다시 그리므로 여기서 건드리지 않음.
    function refreshBubbleContents() {
        _frames.forEach(function (f, i) {
            var ov = _pointBubbles[i];
            if (ov) ov.getElement().innerHTML = bubbleHTML(f, bubbleHeader(f));
        });
    }

    // ── 우리 해역 진입 시 해구도 예측 + 진로 최근접 부이 데이터로 파고 표출 ──────
    //   - 트리거/대상: 강풍반경에 걸친(중심 within radStrong) 해구 중 태풍 중심 최근접 1개.
    //   - 72h 게이트: 해구도 tm 이 프레임시각(±1.6h) 안에 있어야 유효(예측범위 내). 밖이면 보퍼트 유지.
    //   - 부이: 해구도가 표출될 때만, 진로선 최근접 B/C 부이 관측 표출.
    function enrichKoreaWaters() {
        var token = ++_enrichToken;
        _koreaBuoy = null;
        _frames.forEach(function (f) { f._zoneFc = null; });
        var dbg = _debugKorea;
        // 강풍반경 북단이 31°N 에 닿는 후보 프레임만 해구도 조회. (디버그: 전 프레임 강제)
        var cand = dbg ? _frames.slice() : _frames.filter(function (f) { return f.radStrong && (f.lat + f.radStrong / KM_PER_DEG) >= KOREA_TRIG_LAT; });
        if (!cand.length) { refreshBubbleContents(); return; }

        // 진로선 최근접 부이(B/C) 선택 — 좌표는 BUOY_LOCATIONS, 관측은 fetchMarineBuoyData.
        try {
            if (typeof BUOY_LOCATIONS === 'object' && typeof fetchMarineBuoyData === 'function') {
                var best = null;
                Object.keys(BUOY_LOCATIONS).forEach(function (id) {
                    var b = BUOY_LOCATIONS[id];
                    if (!b || (b.type !== 'B' && b.type !== 'C') || b.lat == null || b.lon == null) return;
                    var d = pointToTrackKm(b.lat, b.lon);
                    if (!best || d < best.dist) best = { id: id, name: b.name, type: b.type, dist: d };
                });
                if (best) {
                    fetchMarineBuoyData().then(function (obsMap) {
                        if (token !== _enrichToken) return;
                        var obs = obsMap && obsMap[best.id];
                        if (obs) { _koreaBuoy = { name: best.name, type: best.type, obs: obs }; refreshBubbleContents(); }
                    }).catch(function () { });
                }
            }
        } catch (e) { /* 부이 실패는 무시 — 해구도만 표출 */ }

        // 후보 프레임별 해구도 예측 조회(시각별).
        cand.forEach(function (f) {
            var utcMs = timeToMs(f.time) - KMA_TZ_MS;
            fetchJSON('/api/ocean/zone-forecasts?time=' + encodeURIComponent(new Date(utcMs).toISOString())).then(function (d) {
                if (token !== _enrichToken || !d || !d.success || !d.zones) return;
                var pick = null;
                Object.keys(d.zones).forEach(function (lz) {
                    var z = d.zones[lz];
                    if (z.lat == null || z.lon == null) return;
                    var dist = haversineKm(f.lat, f.lon, z.lat, z.lon);
                    if (!dbg && f.radStrong && dist > f.radStrong) return; // 강풍반경에 걸친 해구만 (디버그: 거리 무시)
                    if (!pick || dist < pick.dist) pick = { lzone: lz, dist: dist, z: z };
                });
                if (!pick) return;
                // 72h 예측범위 게이트: 해구도 tm 이 프레임시각과 ±ZONE_MATCH_H 이내인가. (디버그: 게이트 무시)
                if (!dbg) {
                    var s = String(pick.z.tm).replace(/[^0-9]/g, '');
                    var tmMs = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +(s.slice(10, 12) || 0));
                    if (Math.abs(tmMs - utcMs) > ZONE_MATCH_H * 3600000) return; // 범위 밖 → 보퍼트 유지
                }
                f._zoneFc = { lzone: pick.lzone, wh: pick.z.wh, wp: pick.z.wp, waveDir: pick.z.waveDir, ws: pick.z.ws, windDir: pick.z.windDir, tm: pick.z.tm };
                refreshBubbleContents();
            }).catch(function () { });
        });
    }

    // ── 육지 클릭: 강풍반경 도달(상륙)까지 남은 시간 ─────────────────────────────
    //   예측 경로를 따라 위치·강풍반경을 선형보간하며, 클릭 지점이 강풍반경 안에
    //   들어오는 가장 이른 시각을 찾는다. 반환: {status, etaMs}
    //     status: 'inside'(이미 영향권) | 'eta'(etaMs 에 도달) | 'none'(경로상 도달 없음)
    function landArrivalInfo(lat, lon) {
        if (_frames.length === 0) return { status: 'none' };
        var nowMs = nowKstMs();
        var STEP = 10 * 60000; // 10분 간격 샘플
        // 시작: max(now, 첫 프레임). 끝: 마지막 프레임.
        var startMs = Math.max(nowMs, _frames[0]._t);
        var endMs = _frames[_frames.length - 1]._t;
        if (endMs < startMs) return { status: 'none' };
        function interpAt(ms) {
            // ms 가 속한 세그먼트에서 lat/lon/radStrong 선형보간.
            if (ms <= _frames[0]._t) return { lat: _frames[0].lat, lon: _frames[0].lon, rad: _frames[0].radStrong || 0 };
            for (var i = 0; i < _frames.length - 1; i++) {
                var a = _frames[i], b = _frames[i + 1];
                if (ms >= a._t && ms <= b._t) {
                    var t = (b._t - a._t) ? (ms - a._t) / (b._t - a._t) : 0;
                    return {
                        lat: a.lat + (b.lat - a.lat) * t,
                        lon: a.lon + (b.lon - a.lon) * t,
                        rad: (a.radStrong || 0) + ((b.radStrong || 0) - (a.radStrong || 0)) * t
                    };
                }
            }
            var L = _frames[_frames.length - 1];
            return { lat: L.lat, lon: L.lon, rad: L.radStrong || 0 };
        }
        // 시작 시점에 이미 강풍반경 안인가.
        var s0 = interpAt(startMs);
        if (s0.rad > 0 && haversineKm(lat, lon, s0.lat, s0.lon) <= s0.rad) return { status: 'inside' };
        for (var ms = startMs; ms <= endMs; ms += STEP) {
            var p = interpAt(ms);
            if (p.rad > 0 && haversineKm(lat, lon, p.lat, p.lon) <= p.rad) return { status: 'eta', etaMs: ms };
        }
        return { status: 'none' };
    }
    // 남은 시간(ms) → "약 N일 M시간" / "약 N시간 M분" / "약 N분"
    function fmtRemain(ms) {
        var m = Math.max(0, Math.round(ms / 60000));
        var d = Math.floor(m / 1440); m -= d * 1440;
        var h = Math.floor(m / 60); m -= h * 60;
        if (d > 0) return '약 ' + d + '일 ' + h + '시간';
        if (h > 0) return '약 ' + h + '시간 ' + (m ? m + '분' : '');
        return '약 ' + m + '분';
    }
    function showLandArrival(lon, lat) {
        if (!_landPopup || !_visible || _frames.length === 0) return false;
        var info = landArrivalInfo(lat, lon);
        var body;
        if (info.status === 'inside') {
            body = '<div class="tphn-b-zone" style="color:#ff6b6b">이미 강풍반경 영향권</div>';
        } else if (info.status === 'eta') {
            var nowMs = nowKstMs();
            body = '<div class="tphn-b-zone" style="color:#ffd24a">강풍반경 도달까지 ' + fmtRemain(info.etaMs - nowMs) + '</div>'
                + '<div class="tphn-b-sub">예상 도달 ' + fmtFromMs(info.etaMs) + '</div>';
        } else {
            body = '<div class="tphn-b-sub">내습 예상 시점 산출불가</div>';
        }
        var h = '<div class="tphn-b-h">태풍 내습 예상 <span class="tphn-land-close" style="float:right;cursor:pointer;padding:0 4px">&times;</span></div>'
            + body
            + '<div class="tphn-b-more" style="display:block">'
            + '<button type="button" class="tphn-guide-btn"><i class="fa-solid fa-life-ring"></i> 해상 종사자 행동요령</button></div>';
        _landEl.innerHTML = h;
        _landEl.style.display = '';
        setBubbleZ(_landEl, '600');
        bringBubbleToFront(_landEl);
        _landPopup.setPosition(ol.proj.fromLonLat([lon, lat]));
        if (window.PopupStack) window.PopupStack.push('tphn-land', hideLandPopup);
        return true;
    }

    // 레이어별 채움 스타일 — 테두리 없이 fill 만(회랑 내부 포인트 원 윤곽이 남지 않도록).
    function swathStyle(strokeC, fillC) {
        return new ol.style.Style({ fill: new ol.style.Fill({ color: fillC }) });
    }

    // ── 재생 플레이헤드 렌더 ──────────────────────────────────────────────────
    function renderHead(p) {
        if (!_headSrc) return;
        _headSrc.clear();
        var f = frameAt(p);
        if (!f) return;
        var c = f._colorF || gradeColor(f._gradeF || 0);

        // 재생 모드: 시작~현재까지 "자라나는" 회랑 항적을 swath 레이어에 그림.
        // (정적 모드에서는 renderStatic 이 전체 회랑을 채워두므로 여기서 건드리지 않음)
        if (_playbackMode) {
            var passedPts = [];
            _frames.forEach(function (fr) { if (fr._t <= f._rtMs) passedPts.push(fr); });
            passedPts.push(f); // 현재(보간) 시점 — 회랑 끝이 점점 커지며 진행
            _probSrc.clear(); _strongSrc.clear(); _stormSrc.clear();
            if (_layerOn.prob) { var gp = swathCorridorGeom(passedPts, 'radProb'); if (gp) _probSrc.addFeature(new ol.Feature(gp)); }
            if (_layerOn.strong) { var gw = swathCorridorGeom(passedPts, 'radStrong'); if (gw) _strongSrc.addFeature(new ol.Feature(gw)); }
            if (_layerOn.storm) { var gs = swathCorridorGeom(passedPts, 'radStorm'); if (gs) _stormSrc.addFeature(new ol.Feature(gs)); }
        }

        // 진행 자취 중심선: 지나온 경로 + 현재 위치 (굵은 실선, 강도색)
        var passed = [];
        _frames.forEach(function (fr) { if (fr._t <= f._rtMs) passed.push(ol.proj.fromLonLat([fr.lon, fr.lat])); });
        passed.push(ol.proj.fromLonLat([f.lon, f.lat]));
        if (passed.length >= 2) {
            var trail = new ol.Feature(new ol.geom.LineString(passed));
            trail.setStyle(new ol.style.Style({ stroke: new ol.style.Stroke({ color: rgba(c, 0.95), width: 3.5 }) }));
            _headSrc.addFeature(trail);
        }

        // 태풍 본체(강도색 점 + 소용돌이)
        var head = new ol.Feature(pointAt(f.lon, f.lat));
        head.setStyle(new ol.style.Style({
            image: new ol.style.Circle({ radius: 9, fill: new ol.style.Fill({ color: rgba(c, 1) }), stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }) }),
            text: new ol.style.Text({ text: '🌀', font: '15px sans-serif', offsetY: 1 })
        }));
        _headSrc.addFeature(head);

        // 이동 말풍선(HTML 오버레이) — 현재 시각 + 상세
        if (_moveEl) {
            _moveEl.innerHTML = bubbleHTML(f, dateTimeLabel(f._rtMs) + ' 기준');
            _moveBubble.setPosition(ol.proj.fromLonLat([f.lon, f.lat]));
        }
        var scr = document.getElementById('tphn-scrubber');
        if (scr && document.activeElement !== scr) scr.value = String(Math.round(p * 1000));
    }

    // ── 지도 포커스 (태풍 현재위치 + 제주도가 한 화면에 보이도록 fit) ─────────
    function focusOnTyphoon() {
        if (!_map || !_frames.length) return;
        var f = frameAt(_p);
        if (!f || f.lon == null || f.lat == null) return;
        // 태풍 현재위치 + 우리나라(제주~본토) 박스를 모두 포함하는 extent → 거리 가늠 가능
        var pts = [
            ol.proj.fromLonLat([f.lon, f.lat]),
            ol.proj.fromLonLat([KOREA_W, KOREA_S]),
            ol.proj.fromLonLat([KOREA_E, KOREA_N])
        ];
        var xs = pts.map(function (p) { return p[0]; });
        var ys = pts.map(function (p) { return p[1]; });
        var extent = [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
        var size = _map.getSize();
        if (!size) return;
        _map.getView().fit(extent, {
            size: size,
            padding: [60, 50, 160, 50], // top,right,bottom(패널),left
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
        setPlaybackMode(true);  // 사전 범위·포인트 말풍선 숨기고 이동 헤드 표시
        renderHead(_p);
        setPlayBtn(true);
        _raf = requestAnimationFrame(tick);
    }
    function pause() {
        _playing = false;
        if (_raf) cancelAnimationFrame(_raf);
        _raf = null;
        setPlayBtn(false);
        // 정지해도 재생 모드 유지(이동 위치 그대로). 기본(포인트 말풍선) 복귀는 통보문/태풍 재선택 시.
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
        _playbackMode = false;    // 새 통보문 선택 → 기본(포인트별 말풍선 + 사전 범위) 모드
        _frames = buildFrames(b);
        _pNow = computeNowP();    // 발표시각이 아니라 "현재 시각" 기준 위치에서 시작
        _p = _pNow;
        renderStatic();
        renderHead(_p);
        applyLayerVisibility();
        enrichKoreaWaters();   // 우리 해역 진입 시 해구도/부이로 파고 표출(비동기, 완료 후 말풍선 갱신)
        if (_visible) focusOnTyphoon();
    }
    // 되돌리기(처음으로) — 재생/스크럽 후 최초 진입(기본 정지) 화면으로 복귀.
    function resetView() {
        pause();
        _playbackMode = false;
        hideLandPopup();
        closeGuideModal();
        _pNow = computeNowP();
        _p = _pNow;
        renderStatic();
        renderHead(_p);
        applyLayerVisibility();
        enrichKoreaWaters();
        focusOnTyphoon();
        var sc = document.getElementById('tphn-scrubber');
        if (sc) sc.value = Math.round(_p * 1000);
    }
    function clearTrack() {
        _frames = [];
        [_trackSrc, _probSrc, _strongSrc, _stormSrc, _headSrc, _pointSrc].forEach(function (s) { if (s) s.clear(); });
        _pointBubbles.forEach(function (ov) { ov.setPosition(undefined); });
        if (_moveBubble) _moveBubble.setPosition(undefined);
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
        // 태풍 ON: minZoom 완화(더 넓게 축소) + 베이스맵을 세계지도(OSM)로 / OFF: 원복
        if (_map) {
            var view = _map.getView();
            if (v) {
                if (_origMinZoom === null) _origMinZoom = view.getMinZoom();
                if (RELAX_MIN_ZOOM < _origMinZoom) view.setMinZoom(RELAX_MIN_ZOOM);
                // 직전 베이스맵 기억 후 세계지도로 자동 전환
                if (window.oceanGetBasemap && window.oceanSetBasemap) {
                    if (window.oceanGetBasemap() !== 'osm') _prevBasemap = window.oceanGetBasemap();
                    window.oceanSetBasemap('osm');
                }
            } else {
                if (_origMinZoom !== null) view.setMinZoom(_origMinZoom);
                // 직전 베이스맵으로 복원
                if (_prevBasemap && window.oceanSetBasemap) { window.oceanSetBasemap(_prevBasemap); }
                _prevBasemap = null;
            }
        }
        applyLayerVisibility();
        var panel = document.getElementById('ocean-typhoon-panel');
        if (panel) panel.style.display = v ? '' : 'none';
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (btn) btn.classList.toggle('active', v);
        if (v) {
            // 껐다 켜면 "처음 켰을 때"처럼 초기화: 최신 태풍·최신 통보문·현재시각·정지(기본) 상태로 리셋.
            if (_activeData && _activeData.hasActive) {
                primeDefaultFromActive();      // 기본 선택 재구성 + 정적 렌더(_playbackMode=false)
            } else {
                _playbackMode = false;
                _pNow = computeNowP(); _p = _pNow;
                renderHead(_p);
            }
            focusOnTyphoon();
            // 표출 첫 회: 현재연도 전체 태풍 목록(dmdw)으로 이름 드롭다운 확장(과거 태풍 포함)
            if (!_yearLoaded) { _yearLoaded = true; loadYear(_year, _selSeq, _selCode); }
        } else {
            pause();
        }
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
        _unlocked = true; // 세션 동안만 유지(영속 X) — 앱 재시작 시 다시 비활성
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
        if (_trackLayer) return;
        _probSrc = new ol.source.Vector();
        _strongSrc = new ol.source.Vector();
        _stormSrc = new ol.source.Vector();
        _trackSrc = new ol.source.Vector();
        _headSrc = new ol.source.Vector();
        _pointSrc = new ol.source.Vector();
        // 채움은 유형별 색(원·말풍선과 동일), 반투명 유지 → 배경 지도 희미하게 비침.
        _probLayer = new ol.layer.Vector({ source: _probSrc, zIndex: 116, style: swathStyle(rgba(PROB_C, 0.95), rgba(PROB_C, 0.30)) });
        _strongLayer = new ol.layer.Vector({ source: _strongSrc, zIndex: 118, style: swathStyle(rgba(STRONG_C, 0.95), rgba(STRONG_C, 0.32)) });
        _stormLayer = new ol.layer.Vector({ source: _stormSrc, zIndex: 120, style: swathStyle(rgba(STORM_C, 0.95), rgba(STORM_C, 0.36)) });
        _trackLayer = new ol.layer.Vector({ source: _trackSrc, zIndex: 124 });
        _headLayer = new ol.layer.Vector({ source: _headSrc, zIndex: 130 });
        _pointLayer = new ol.layer.Vector({ source: _pointSrc, zIndex: 140 }); // 포인트는 모든 레이어 위
        map.addLayer(_probLayer); map.addLayer(_strongLayer); map.addLayer(_stormLayer);
        map.addLayer(_trackLayer); map.addLayer(_headLayer); map.addLayer(_pointLayer);
        _moveBubble = makeBubbleOverlay(); map.addOverlay(_moveBubble); _moveEl = _moveBubble.getElement();
        // 육지 클릭 팝업(강풍반경 도달시간) — 클릭 차단(stopEvent), 닫기·행동요령 버튼 처리.
        _landEl = document.createElement('div');
        _landEl.className = 'tphn-bubble tphn-land-pop';
        _landEl.style.display = 'none';
        _landEl.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.tphn-land-close')) { hideLandPopup(); return; }
            if (e.target.closest && e.target.closest('.tphn-guide-btn')) { openGuideModal(); }
        });
        _landPopup = new ol.Overlay({ element: _landEl, offset: [12, -12], positioning: 'bottom-left', stopEvent: false });
        map.addOverlay(_landPopup);
        try { var s = JSON.parse(localStorage.getItem(LAYER_KEY)); if (s) _layerOn = Object.assign(_layerOn, s); } catch (e) {}
        applyLayerVisibility();
    }

    function applyLayerVisibility() {
        // 기본(정지): 포인트별 말풍선 + 사전 범위 표출 / 재생: 사전 범위·포인트 말풍선 숨기고 이동 헤드만.
        var pb = _playbackMode;
        // swath(회랑)는 정지=전체 / 재생=시작~현재까지 자라나는 항적. 두 경우 모두 토글대로 표시.
        if (_probLayer) _probLayer.setVisible(_visible && _layerOn.prob);
        if (_strongLayer) _strongLayer.setVisible(_visible && _layerOn.strong);
        if (_stormLayer) _stormLayer.setVisible(_visible && _layerOn.storm);
        if (_trackLayer) _trackLayer.setVisible(_visible && _layerOn.track);
        if (_pointLayer) _pointLayer.setVisible(_visible && _layerOn.track);
        if (_headLayer) _headLayer.setVisible(_visible && pb); // 이동 헤드는 재생 모드에서만
        updateBubbleVisibility();
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
        var resetBtn = document.getElementById('tphn-reset');
        if (resetBtn) resetBtn.addEventListener('click', function () { if (_frames.length) resetView(); });
        var scr = document.getElementById('tphn-scrubber');
        if (scr) scr.addEventListener('input', function () { pause(); setPlaybackMode(true); _p = (+this.value) / 1000; renderHead(_p); });
        var closeBtn = document.getElementById('tphn-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { setVisible(false); });

        // 행동요령 팝업 — 열기는 말풍선/육지팝업 내부 .tphn-guide-btn 클릭에서 openGuideModal 로 처리.
        //   닫기(× / 배경)는 closeGuideModal → PopupStack 연동으로 하드웨어 뒤로가기 지원.
        var guideModal = document.getElementById('tphn-guide-modal');
        var guideClose = document.getElementById('tphn-guide-close');
        if (guideClose) guideClose.addEventListener('click', closeGuideModal);
        if (guideModal) guideModal.addEventListener('click', function (e) { if (e.target === guideModal) closeGuideModal(); });

        // [디버그] 해역표출 강제 토글 — 트리거/게이트/거리 무시하고 최근접 해구·부이 표출.
        var dbgChk = document.getElementById('tphn-dbg-korea');
        if (dbgChk) dbgChk.addEventListener('change', function () {
            _debugKorea = dbgChk.checked;
            if (_frames.length) enrichKoreaWaters();
        });

        // 레이어 토글 체크박스 (dmdw 상세정보 레이어 대응)
        [['tphn-ly-track', 'track'], ['tphn-ly-prob', 'prob'], ['tphn-ly-strong', 'strong'], ['tphn-ly-storm', 'storm']]
            .forEach(function (pair) {
                var el = document.getElementById(pair[0]);
                if (!el) return;
                el.checked = !!_layerOn[pair[1]];
                el.addEventListener('change', function () {
                    _layerOn[pair[1]] = this.checked;
                    applyLayerVisibility();
                    try { localStorage.setItem(LAYER_KEY, JSON.stringify(_layerOn)); } catch (e) {}
                });
            });
    }

    function installWhenReady() {
        function tryInit() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map && window.ol) {
                _map = map;
                _unlocked = false;   // 항상 비활성으로 시작 — 10회 탭 전까지 잠금(영속 X)
                _visible = false;
                ensureLayers(map);
                bindUI();
                load();
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

    window.OceanTyphoon = {
        reload: load,
        show: function () { setVisible(true); },
        hide: function () { setVisible(false); },
        isVisible: function () { return _visible; },
        // 육지 클릭 처리: 태풍 ON + 실제 육지일 때만 강풍반경 도달시간 팝업 표출. consumed 시 true.
        tryHandleLandClick: function (lon, lat) {
            if (!_visible || _frames.length === 0) return false;
            if (!(window.isOceanLand && window.isOceanLand(lat, lon) === true)) return false;
            return showLandArrival(lon, lat);
        },
        // 해점(바다) 도달정보 — 바텀시트 내습 배지용. 태풍 OFF/프레임 없으면 null.
        //   반환 {status:'inside'|'eta'|'none', etaMs?, remainMs?}
        getArrivalInfo: function (lat, lon) {
            if (!_visible || _frames.length === 0) return null;
            var info = landArrivalInfo(lat, lon);
            if (info.status === 'eta') info.remainMs = Math.max(0, info.etaMs - nowKstMs());
            return info;
        }
    };
})();
