/**
 * ============================================================================
 * 파일명: js/ocean_typhoon.js
 * 역할 : 해양종합 지도(OpenLayers)에 "태풍" 오버레이 + 재생 애니메이션을 표출.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/ocean-map/map/ocean_map.js(window.getOceanMap),
 *                    OpenLayers(ol) 벤더, PopupStack(js/core/backbutton.js)
 *  - 서버 API      : GET /api/typhoon, /api/typhoon/list, /api/typhoon/bulletins,
 *                    /api/typhoon/bulletin, /api/typhoon/image, /api/ocean/zone-forecasts,
 *                    /api/typhoon/foreign (해외 기관 — 출처 드롭다운에서 고를 때)
 *  - 마크업        : index2.html #ocean-typhoon-toggle-btn, #ocean-typhoon-panel,
 *                    #tphn-* (스크러버·통보문·이미지·가이드 모달 등)
 *  - 나를 쓰는 곳  : window.OceanTyphoon 소비 — ocean_map.js,
 *                    ocean_bottom_sheet1.js, assistant_deeplink.js
 * ============================================================================
 *
 * [데이터 출처] GET /api/typhoon (routes/typhoon.js → data/typhoon.json)
 *   - active: 현재(최신) 태풍
 *   - bulletins[]: 통보문 회차별 { current, forecast[] } (드롭다운으로 선택)
 *   - 각 프레임: { time(YYYYMMDDHHmm), lat, lon, pressure, windMs, windKmh,
 *                 dir, speedKmh, radStrong(강풍반경), radStorm(폭풍반경),
 *                 radProb(70%확률반경), grade(0~5), size }
 *
 * [해외 출처(JTWC)만 오는 것 — 2026-09-25 추가]
 *   - swath: 34노트 위험구역 도형 [[경도,위도], …]. JTWC 가 발표한 그대로 그린다.
 *            예보가 빗나갈 가능성이 이미 들어 있어, 기상청의 70%확률반경 자리를 대신한다.
 *   - past : 지나온 실제 경로 [{ time, lat, lon, windMs, grade }, …]
 *   둘 다 서버가 JTWC 구글어스 파일(.kmz)에서 꺼내 준다(services/jtwc_kmz.js).
 *   못 받으면 아예 없다 — 없으면 안 그린다(지어내지 않는다).
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
    var _trackLayer = null, _probLayer = null, _strongLayer = null, _stormLayer = null, _trailLayer = null, _headLayer = null, _pointLayer = null;
    var _trackSrc = null, _probSrc = null, _strongSrc = null, _stormSrc = null, _trailSrc = null, _headSrc = null, _pointSrc = null;
    // 34노트 위험구역(JTWC 전용) — 기관이 발표한 도형을 그대로 그린다. 우리가 계산하지 않는다.
    var _swathLayer = null, _swathSrc = null;
    var _prevBasemap = null;  // 태풍 ON 직전 베이스맵(끄면 복원)
    var LAYER_KEY = 'seagnal_typhoon_layers';
    var _layerOn = { track: true, prob: true, strong: false, storm: false, swath: true };
    var RELAX_MIN_ZOOM = 3;   // 태풍 ON 시 minZoom 완화(더 넓게 축소 가능; 기본 6 → 3)
    var _origMinZoom = null;  // 원래 minZoom 백업(끄면 복원)
    var _moveBubble = null, _moveEl = null;  // 재생 중 이동 말풍선(ol.Overlay)
    var _landPopup = null, _landEl = null;   // 육지 클릭 시 강풍반경 도달시간 팝업(ol.Overlay)
    var _pointBubbles = [];   // 정지(기본) 시 포인트별 말풍선 풀(ol.Overlay)
    var _playbackMode = false; // true=재생(이동 말풍선만), false=기본(포인트별 말풍선 + 사전 범위)
    var _koreaBuoy = null;     // 우리 해역 진입 시 진로선 최근접 부이 관측 {name,type,obs} (해구도 표출 시에만 사용)
    var _enrichToken = 0;      // 비동기 해구도/부이 enrich 경합 방지 토큰
    var _debugKorea = false;   // [디버그] 트리거/72h게이트/강풍반경 거리 무시하고 최근접 해구·부이 강제 표출
    var _demoActive = false;   // demoFocus(테스트/시연)로 표출 중인지 — OFF 시 기본 전도(전도 중앙) 복귀 게이트

    var _activeData = null;    // /api/typhoon 응답(현재연도 활성 태풍 + 통보문 인라인)

    // ── 자료 출처 ────────────────────────────────────────────────────────────
    // 기관마다 태풍을 다르게 본다. 기본은 한국(기상청)이고, 사용자가 드롭다운으로 바꾼다.
    // 'kma'   : 기존 경로(/api/typhoon…) — 통보문 회차·중심기압·70%확률반경까지 다 있음
    // 'jtwc'  : /api/typhoon/foreign?src=jtwc — 서버가 우리 프레임 형식으로 바꿔 준다.
    //           중심기압·70%확률반경이 없고, 반경은 네 방향 값을 옮긴 근사다(라우트 주석 참조).
    // 'jma'   : /api/typhoon/foreign?src=jma — 일본 기상청. 기상청과 발표 방식이 같아
    //           70%확률반경·예상 시점 중심기압이 그대로 있고, 풍속도 10분 평균이다.
    var SOURCES = {
        kma:  { label: '한국(기상청)', note: '자료: 기상청 방재기상플랫폼 통보문 · 10분마다 수집' },
        jtwc: { label: '미국(JTWC)',
                // [출처표기] JTWC 자료는 미국 정부 공공저작물이다. 중계 업체를 거치지 않고
                //   metoc.navy.mil 의 공개 통보문을 직접 읽으므로 그 사실을 그대로 적는다.
                note: '자료: 미국 합동태풍경보센터(JTWC) 공개 통보문·구글어스 파일 · 미국 정부 공공저작물 · 6시간마다 갱신 · 풍속은 1분 평균(기상청은 10분 평균)' },
        jma:  { label: '일본(JMA/RSMC)',
                // [출처표기] 일본 기상청 자료는 「공공데이터 이용규약(제1.0판)」 적용이라
                //   출처를 적고, 가공했으면 가공했다고 밝혀야 한다 — 둘 다 여기에 적는다.
                //   (https://www.jma.go.jp/jma/kishou/info/coment.html)
                note: '자료: 일본 기상청 홈페이지(www.jma.go.jp) 태풍정보를 우리 화면 형식으로 가공해 작성 · 풍속은 10분 평균(우리 기상청과 같음)' }
    };
    var _src = 'kma';          // 지금 보고 있는 출처
    var _foreignData = null;   // 해외 출처 응답 캐시
    var _year = null;          // 선택 연도
    var _typhoonList = [];     // 선택 연도의 태풍 목록 [{seq,name}]
    var _selSeq = null;        // 선택 태풍 seq
    var _bulletinList = [];    // 선택 태풍의 통보문 목록 [{code,label,...}]
    var _selCode = null;       // 선택 통보문 code
    var _curBulletin = null;   // 현재 표출 통보문(rem/other/code 등) — i버튼·이미지 팝업용
    var _tableCache = {};      // (year+'_'+code) -> {current,forecast,...}
    var _suppressAutoYear = false; // setVisible 의 자동 loadYear 1회 억제 — demoFocus 가 직접 로드할 때 사용
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
    var SWATH_C = [0, 150, 160];    // 34노트 위험구역(JTWC) — 청록색(JTWC 예보도 그림과 같은 계열)
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
    // 비대칭 반경 부가표기: 장반경 대비 단반경(가항측)이 작을 때 "(○쪽 XXkm)" 반환.
    function asymNote(rLong, rShort, edStr) {
        if (!rShort || !edStr || rShort >= rLong) return '';
        var deg = dirToDeg(edStr), dir = (deg == null) ? '' : dir16(deg);
        return ' <span style="opacity:0.85">(' + (dir ? dir + '쪽 ' : '') + Math.round(rShort) + 'km)</span>';
    }
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
        if (o.radStrong) more += '<div style="color:' + cssRgb(STRONG_C) + '">강풍반경 ' + Math.round(o.radStrong) + 'km' + asymNote(o.radStrong, o.radStrongS, o.radStrongD) + '</div>';
        if (o.radStorm) more += '<div style="color:' + cssRgb(STORM_C) + '">폭풍반경 ' + Math.round(o.radStorm) + 'km' + asymNote(o.radStorm, o.radStormS, o.radStormD) + '</div>';
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
            if (wv != null) more += '<div class="tphn-b-sub">예상파고(추정) 약 ' + wv + 'm</div>';
        }
        more += '<button type="button" class="tphn-guide-btn"><i class="fa-solid fa-life-ring"></i> 행동요령</button>';
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
        // insertFirst:false → 추가 순서 = DOM 순서. bringBubbleToFront(appendChild)가 실제로 최상단으로 올린다.
        return new ol.Overlay({ element: el, offset: [12, -12], positioning: 'bottom-left', stopEvent: false, insertFirst: false });
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
        selectGuideTab('sea'); // 열 때마다 기본=해상 탭으로 초기화(예측 가능·일관)
        gm.style.display = 'flex';
        if (window.PopupStack) window.PopupStack.push('tphn-guide', closeGuideModal);
    }
    function closeGuideModal() {
        var gm = document.getElementById('tphn-guide-modal');
        if (gm) gm.style.display = 'none';
        if (window.PopupStack) window.PopupStack.remove('tphn-guide');
    }
    // 행동요령 모달 탭 전환(해상/육상) — 해당 블록만 보이고 탭 버튼 활성표시. 기본=해상.
    function selectGuideTab(which) {
        var tabs = document.querySelectorAll('#tphn-guide-modal .tphn-guide-tab');
        var panes = document.querySelectorAll('#tphn-guide-modal .tphn-guide-pane');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === which);
        for (var j = 0; j < panes.length; j++) panes[j].style.display = (panes[j].getAttribute('data-pane') === which) ? '' : 'none';
    }
    function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    // 통보문 안내(i) 팝업 — rem(발표/종료 안내, '|' 구분) + other(참고사항).
    function renderNoteBody() {
        var body = document.getElementById('tphn-note-body'); if (!body) return;
        var b = _curBulletin || {}, html = '';
        var rem = String(b.rem || '').replace(/\|\s*$/, '').trim();
        if (rem) rem.split('|').forEach(function (s) { s = s.trim(); if (s) html += '<div class="tphn-note-line">※ ' + escHtml(s) + '</div>'; });
        if (b.other) html += '<div class="tphn-note-line" style="margin-top:10px;color:#8fc0ff;font-weight:600;">' + escHtml(b.other) + '</div>';
        body.innerHTML = html || '<div class="tphn-note-line" style="color:#9fb0c8;">안내 정보가 없습니다.</div>';
    }
    function openNoteModal() {
        var m = document.getElementById('tphn-note-modal'), body = document.getElementById('tphn-note-body');
        if (!m || !body) return;
        m.style.display = 'flex';
        if (window.PopupStack) window.PopupStack.push('tphn-note', closeNoteModal);
        var b = _curBulletin || {};
        // 활성 캐시(typhoon.json)가 구버전이라 rem/other 가 없으면 신선 통보문을 받아 보강.
        if (!b.rem && !b.other && _selCode) {
            body.innerHTML = '<div class="tphn-note-line" style="color:#888;">불러오는 중…</div>';
            fetchJSON('/api/typhoon/bulletin?year=' + _year + '&code=' + encodeURIComponent(_selCode)).then(function (d) {
                if (d && !d.error) {
                    if (_curBulletin) { _curBulletin.rem = d.rem; _curBulletin.other = d.other; }
                    else _curBulletin = d;
                }
                renderNoteBody();
            }).catch(function () { renderNoteBody(); });
        } else {
            renderNoteBody();
        }
    }
    function closeNoteModal() {
        var m = document.getElementById('tphn-note-modal'); if (m) m.style.display = 'none';
        if (window.PopupStack) window.PopupStack.remove('tphn-note');
    }
    // 통보문 이미지 팝업 — 서버 프록시(/api/typhoon/image)로 dmdw 이미지 표출 + 다운로드.
    function openImgModal() {
        var m = document.getElementById('tphn-img-modal'), img = document.getElementById('tphn-img-el'), msg = document.getElementById('tphn-img-msg');
        if (!m || !img) return;
        // 기상청은 통보문 파일명으로, 해외는 태풍 번호(seq)로 그림을 부른다.
        var fileName, url;
        if (_src === 'kma') {
            fileName = bulletinImageName(_selCode || (_curBulletin && _curBulletin.code));
            if (!fileName) return;
            url = '/api/typhoon/image?fileName=' + encodeURIComponent(fileName);
        } else {
            if (!_selSeq) return;
            fileName = _selSeq;
            url = '/api/typhoon/foreign/image?src=' + encodeURIComponent(_src)
                + '&seq=' + encodeURIComponent(_selSeq);
        }
        img.style.display = 'none'; if (msg) { msg.style.display = ''; msg.textContent = '불러오는 중…'; }
        img.onload = function () { img.style.display = ''; if (msg) msg.style.display = 'none'; };
        img.onerror = function () { img.style.display = 'none'; if (msg) { msg.style.display = ''; msg.textContent = '이미지를 불러올 수 없습니다.'; } };
        img.setAttribute('data-fn', fileName);
        img.src = url;
        m.style.display = 'flex';
        if (window.PopupStack) window.PopupStack.push('tphn-img', closeImgModal);
    }
    function closeImgModal() {
        var m = document.getElementById('tphn-img-modal'); if (m) m.style.display = 'none';
        if (window.PopupStack) window.PopupStack.remove('tphn-img');
    }
    // 통보문 이미지 다운로드. Capacitor 네이티브 WebView 는 <a download> 가 안 먹히므로
    //   시스템 브라우저(@capacitor/browser)로 attachment URL 을 열어 내려받게 한다(앱 공통 패턴).
    function downloadImg() {
        var img = document.getElementById('tphn-img-el'), fileName = img && img.getAttribute('data-fn');
        if (!fileName) return;
        var rel = (_src === 'kma')
            ? '/api/typhoon/image?download=1&fileName=' + encodeURIComponent(fileName)
            : '/api/typhoon/foreign/image?download=1&src=' + encodeURIComponent(_src)
              + '&seq=' + encodeURIComponent(fileName);
        function anchor() {
            var a = document.createElement('a');
            a.href = rel; a.download = fileName.replace(/[\]]/g, '_'); a.target = '_blank';
            document.body.appendChild(a); a.click(); a.remove();
        }
        var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
        if (isNative && Browser && Browser.open) {
            try { var p = Browser.open({ url: window.location.origin + rel }); if (p && p.catch) p.catch(anchor); return; }
            catch (e) { /* 폴백 */ }
        }
        anchor();
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
    // ── 재생 슬라이더 손잡이 위 말풍선(파고·파향 타임라인과 동일 로직/스타일) ────
    var _scrubFade = null;
    function scrubTimeText(p) {
        if (!_frames.length) return '';
        var t0 = _frames[0]._t, t1 = _frames[_frames.length - 1]._t;
        var d = new Date(t0 + p * (t1 - t0));
        var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
        var hh = d.getUTCHours(), mi = d.getUTCMinutes();
        return (d.getUTCMonth() + 1) + '.' + d.getUTCDate() + '.(' + DAYS[d.getUTCDay()] + ') '
            + (hh < 10 ? '0' + hh : hh) + ':' + (mi < 10 ? '0' + mi : mi);
    }
    function updateScrubTooltip(p) {
        var tip = document.getElementById('tphn-scrub-tooltip');
        var sl = document.getElementById('tphn-scrubber');
        if (!tip || !sl) return;
        tip.textContent = scrubTimeText(p);
        tip.style.left = '0px';
        var r = sl.getBoundingClientRect();
        var min = parseFloat(sl.min) || 0, max = parseFloat(sl.max) || 1000, val = parseFloat(sl.value) || 0;
        var pct = (max > min) ? (val - min) / (max - min) : 0;
        var thumbHalf = 9;
        var thumbX = r.left + thumbHalf + pct * (r.width - thumbHalf * 2);
        var tipW = tip.getBoundingClientRect().width;
        var pad = 4;
        var clamped = Math.max(pad, Math.min(thumbX - tipW / 2, window.innerWidth - tipW - pad));
        var pr = tip.parentElement.getBoundingClientRect();
        tip.style.left = (clamped - pr.left) + 'px';
        var arrowX = Math.max(8, Math.min(thumbX - clamped, tipW - 8));
        tip.style.setProperty('--tl-arrow-x', arrowX + 'px');
    }
    function showScrubTip() { var t = document.getElementById('tphn-scrub-tooltip'); if (t) { clearTimeout(_scrubFade); t.classList.add('visible'); } }
    function fadeScrubTip() { clearTimeout(_scrubFade); _scrubFade = setTimeout(function () { var t = document.getElementById('tphn-scrub-tooltip'); if (t) t.classList.remove('visible'); }, 1000); }
    // 현재 시각이 타임라인(첫~끝 프레임)에서 차지하는 위치 0..1
    function computeNowP() {
        if (_frames.length < 2) return 0;
        var t0 = _frames[0]._t, t1 = _frames[_frames.length - 1]._t;
        if (t1 <= t0) return 0;
        // 통보문 구간 전체가 과거(지금 > 마지막 예보시각)면 예보 끝점이 아니라
        //   관측 현재위치(프레임0)를 기준으로 둔다 — 과거 통보문 열람 시 "그 통보문의
        //   실제 위치"로 지도가 포커스되게 함. (라이브 태풍은 t1 이 미래라 영향 없음)
        if (nowKstMs() > t1) return 0;
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

    // ── 비대칭(위험/가항반원) 반경 헬퍼 ───────────────────────────────────────
    var DIR16_DEG = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
    function dirToDeg(d) { if (d == null) return null; var v = DIR16_DEG[String(d).trim().toUpperCase()]; return v == null ? null : v; }
    function angDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
    // 방위(deg)에서의 반경 — ed(가항측, 0°) → rShort, 반대(위험측, 180°) → rLong 로 코사인 S-커브 보간.
    //   2반원 하드컷(±90°에서 r 점프)으로 인한 톱니/노치 없이 매끈한 비대칭 달걀형이 되도록.
    function radAt(rLong, rShort, edDeg, brngDeg) {
        if (edDeg == null || rShort == null || !(rShort > 0) || rShort >= rLong) return rLong;
        var s = (1 - Math.cos(Math.PI * angDiff(brngDeg, edDeg) / 180)) / 2;   // 0..1 S-커브
        return rShort + (rLong - rShort) * s;
    }
    // 사분면 — JTWC 는 북동·남동·남서·북서 네 방향 거리를 준다. 경계는 정북·정동·정남·정서.
    var QUADS = [{ a: 0, b: 90, k: 'ne' }, { a: 90, b: 180, k: 'se' },
                 { a: 180, b: 270, k: 'sw' }, { a: 270, b: 360, k: 'nw' }];
    /**
     * 네 방향 거리에서 임의 방위의 반경을 낸다 — 사분면 안에서는 그 값 그대로(계단).
     * 예: quadRadAt({ne:111, se:0, sw:0, nw:130}, 10) → 111  ·  (…, 350) → 130
     * [왜 계단인가 — 2026-09-25 실측] 처음에는 이웃 사분면을 S-커브로 이었는데, JTWC 가
     *   공개하는 구글어스 파일(.kmz)의 반경 도형을 재어 보니 **사분면마다 90°짜리 일정한
     *   호**였다(25/12Z 34노트 = 북동 130 · 남동 56 · 남서 74 · 북서 130 km, 사분면 안에서
     *   거리 변화 2km 미만). 즉 JTWC 가 그리는 모양 자체가 계단이다. 매끈하게 이으면
     *   우리가 없는 값을 지어내는 셈이고, 0인 사분면 쪽에서는 최대 130km 까지 벌어졌다.
     * @param {Object} q - {ne, se, sw, nw} 거리(km)
     * @param {number} brngDeg - 방위(도)
     * @returns {number} 그 방위의 반경(km)
     */
    function quadRadAt(q, brngDeg) {
        var b = ((brngDeg % 360) + 360) % 360;
        var k = b < 90 ? 'ne' : b < 180 ? 'se' : b < 270 ? 'sw' : 'nw';
        return q[k] || 0;
    }
    /**
     * 네 방향 거리로 만드는 링 — 사분면마다 90°짜리 호를 따로 그린다.
     * [왜 따로 두나] 일정 간격으로 방위를 훑으면 90°·180°·270° 의 '턱'이 잘려 모양이 뭉개진다.
     *   사분면 경계를 점으로 정확히 찍어야 JTWC 도형과 같아진다. 거리가 0인 사분면은
     *   중심으로 접힌다 — JTWC 도형도 그렇게 그려져 있다.
     * @param {number} lon @param {number} lat
     * @param {Object} q - {ne, se, sw, nw} 거리(km)
     * @param {number} [n] - 사분면당 나눔 수(기본 18 = 5°)
     * @returns {Array} 지도 좌표 링
     */
    function quadRing(lon, lat, q, n) {
        n = n || 18;
        var ring = [];
        QUADS.forEach(function (s) {
            var r = q[s.k] || 0;
            for (var i = 0; i <= n; i++) {
                var deg = s.a + (s.b - s.a) * i / n;
                ring.push(ol.proj.fromLonLat(destPoint(lon, lat, deg * Math.PI / 180, r)));
            }
        });
        ring.push(ring[0]);
        return ring;
    }
    // 방위별 반경 — 네 방향 값이 있으면 그걸 쓰고, 없으면 기존 장·단반경 방식.
    function radPick(quad, rLong, rShort, edDeg, brngDeg) {
        return quad ? quadRadAt(quad, brngDeg) : radAt(rLong, rShort, edDeg, brngDeg);
    }

    // 비대칭 달걀형 원 링 — bearing 별 반경 적용(edDeg/rShort 없으면 균일 원).
    //   네 방향 값(JTWC)이 있으면 사분면 계단 링으로 그린다 — quadRing 주석 참조.
    function asymRing(lon, lat, rLong, rShort, edDeg, quad, n) {
        if (quad) return quadRing(lon, lat, quad);
        n = n || 72;
        var ring = [];
        for (var i = 0; i <= n; i++) {
            var deg = 360 * i / n;
            ring.push(ol.proj.fromLonLat(destPoint(lon, lat, deg * Math.PI / 180, radPick(quad, rLong, rShort, edDeg, deg))));
        }
        return ring;
    }

    // 진로를 따라 반경만큼 좌우로 벌린 회랑(corridor) + 시점별 (비대칭)원 캡 → 단일 MultiPolygon.
    //   cfg = { long, short, dir } — long=장반경(필수), short=단반경, dir=단반경 방위(가항측). short/dir 없으면 균일 원.
    function swathCorridorGeom(pts, cfg) {
        var lk = cfg.long, sk = cfg.short, dk = cfg.dir, qk = cfg.quad;
        var P = [];
        pts.forEach(function (p) { if (p && p.lon != null && p[lk] != null && p[lk] > 0) P.push(p); });
        if (P.length === 0) return null;
        function rL(p) { return p[lk]; }
        function rS(p) { return sk ? p[sk] : null; }
        function eD(p) { return dk ? dirToDeg(p[dk]) : null; }
        function qD(p) { return qk ? (p[qk] || null) : null; }   // 네 방향 값(JTWC). 기상청 프레임엔 없다 → null
        if (P.length === 1) return new ol.geom.MultiPolygon([[orientCW(asymRing(P[0].lon, P[0].lat, rL(P[0]), rS(P[0]), eD(P[0]), qD(P[0])))]]);
        var left = [], right = [];
        for (var i = 0; i < P.length; i++) {
            var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
            var brg = bearingRad(a.lon, a.lat, b.lon, b.lat);
            var brgDeg = brg * 180 / Math.PI;
            // 좌/우 수직 방향 각각의 (비대칭) 반경 — 가항측이면 단반경으로 회랑이 좁아짐.
            var rl = radPick(qD(P[i]), rL(P[i]), rS(P[i]), eD(P[i]), ((brgDeg - 90) % 360 + 360) % 360);
            var rr = radPick(qD(P[i]), rL(P[i]), rS(P[i]), eD(P[i]), ((brgDeg + 90) % 360 + 360) % 360);
            left.push(ol.proj.fromLonLat(destPoint(P[i].lon, P[i].lat, brg - Math.PI / 2, rl)));
            right.push(ol.proj.fromLonLat(destPoint(P[i].lon, P[i].lat, brg + Math.PI / 2, rr)));
        }
        var ring = left.concat(right.reverse());
        ring.push(ring[0]);
        // 각 시점 (비대칭)원도 합쳐(둥근 캡 + 굴곡부 빈틈 메움). 모든 링 winding 통일(CW) → nonzero 단일 채움.
        var polys = [[orientCW(ring)]];
        for (var k = 0; k < P.length; k++) polys.push([orientCW(asymRing(P[k].lon, P[k].lat, rL(P[k]), rS(P[k]), eD(P[k]), qD(P[k])))]);
        return new ol.geom.MultiPolygon(polys);
    }
    // 링 부호면적(>0=CCW). 모든 링을 CW(음의 면적)로 통일해 swath 합집합 채움을 깔끔하게.
    function ringSignedArea(r) {
        var a = 0;
        for (var i = 0, n = r.length; i < n; i++) { var p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
        return a / 2;
    }
    function orientCW(r) { return ringSignedArea(r) > 0 ? r.slice().reverse() : r; }

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
            radStrongS: n(A.radStrongS, B.radStrongS),
            radStrongD: (f < 0.5 ? A.radStrongD : B.radStrongD),
            radStorm: n(A.radStorm, B.radStorm),
            radStormS: n(A.radStormS, B.radStormS),
            radStormD: (f < 0.5 ? A.radStormD : B.radStormD),
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

    /**
     * 지금 고른 태풍의 '도형 자료'(위험구역·지나온 경로)를 준다. 기상청이면 없다.
     * [왜 따로 계산하나] 이 둘은 통보문이 아니라 태풍 단위로 온다(서버가 .kmz 에서 꺼낸다).
     *   따로 변수에 담아 두면 출처·태풍을 바꿀 때 지우는 것을 잊기 쉬워, 그때그때 찾는다.
     * @returns {Object|null} { swath, past } 를 가진 태풍 객체
     * [연계] ← renderStatic (같은 파일) · 서버 /api/typhoon/foreign 응답의 swath·past
     */
    function currentShapes() {
        if (_src === 'kma') return null;
        return foreignTyphoon(_selSeq);
    }

    /**
     * 지나온 실제 경로를 그린다 — 실선 + 시점별 작은 점(강도색).
     * [왜 예보와 다르게 그리나] 예보 경로는 점선·큰 점이다. 같은 모양이면 "이미 지나간 곳"과
     *   "앞으로 갈 곳"이 구분되지 않는다.
     * [현재 위치와 잇기] 마지막 과거 지점과 현재 위치 사이가 끊겨 보이지 않도록 현재 위치를 잇는다.
     * @param {Array} past - [{ lat, lon, grade }, …] 시각 오름차순
     * [연계] ← renderStatic (같은 파일) · _trackSrc(예측경로 레이어와 같은 자리 — 같은 체크박스로 켜고 끈다)
     */
    function renderPastTrack(past) {
        var pts = past.filter(function (q) { return q && q.lat != null && q.lon != null; });
        if (!pts.length) return;
        var coords = pts.map(function (q) { return ol.proj.fromLonLat([q.lon, q.lat]); });
        var cur = _frames[0];
        if (cur && cur.lon != null) coords.push(ol.proj.fromLonLat([cur.lon, cur.lat]));
        if (coords.length >= 2) {
            var ln = new ol.Feature(new ol.geom.LineString(coords));
            ln.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: 'rgba(70,70,70,0.8)', width: 2 })
            }));
            _trackSrc.addFeature(ln);
        }
        pts.forEach(function (q) {
            var pt = new ol.Feature(pointAt(q.lon, q.lat));
            pt.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 4,
                    fill: new ol.style.Fill({ color: rgba(gradeColor(q.grade), 0.9) }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1 })
                })
            }));
            _trackSrc.addFeature(pt);
        });
    }

    // ── 정적 진로 렌더 ────────────────────────────────────────────────────────
    function renderStatic() {
        if (!_trackSrc) return;
        _trackSrc.clear(); _probSrc.clear(); _strongSrc.clear(); _stormSrc.clear(); _pointSrc.clear();
        _swathSrc.clear();
        if (!_frames.length) return;

        // ⓪ 34노트 위험구역 — JTWC 가 발표한 도형 그대로(우리가 계산하지 않는다).
        //    기상청에는 이 자료가 없어 그려지지 않는다.
        var shp = currentShapes();
        if (shp && shp.swath && shp.swath.length >= 4) {
            _swathSrc.addFeature(new ol.Feature(new ol.geom.Polygon([
                shp.swath.map(function (c) { return ol.proj.fromLonLat(c); })
            ])));
        }
        // ⓪-2 지나온 실제 경로 — 예보(점선)와 구분되게 실선 + 작은 점으로.
        if (shp && shp.past && shp.past.length) renderPastTrack(shp.past);

        // 전체 진로 영역(매끈한 회랑) — 70%(아래)·강풍(중)·폭풍(위)은 레이어 zIndex 로 순서 보장
        // 경로 오차 범위 — 기상청의 70% 확률반경. JTWC 는 이 값을 발표하지 않는다.
        var probG = swathCorridorGeom(_frames, { long: 'radProb' });
        if (probG) _probSrc.addFeature(new ol.Feature(probG));
        var strongG = swathCorridorGeom(_frames, { long: 'radStrong', short: 'radStrongS', dir: 'radStrongD', quad: 'radQuad34' });
        if (strongG) _strongSrc.addFeature(new ol.Feature(strongG));
        var stormG = swathCorridorGeom(_frames, { long: 'radStorm', short: 'radStormS', dir: 'radStormD', quad: 'radQuad50' });
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
            var g = f.grade != null ? f.grade : 0;
            var pt = new ol.Feature(pointAt(f.lon, f.lat));
            pt.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: f.isCurrent ? 11 : 9,
                    fill: new ol.style.Fill({ color: rgba(c, 0.95) }),
                    stroke: new ol.style.Stroke({ color: f.isCurrent ? '#d00' : '#fff', width: f.isCurrent ? 3 : 1.5 })
                }),
                // 강도(1~5)를 원 안에 숫자로. 열대저압부(0)는 표기 안 함.
                text: g >= 1 ? new ol.style.Text({ text: String(g), font: 'bold 11px sans-serif', fill: new ol.style.Fill({ color: '#fff' }) }) : undefined
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
    /**
     * 팝업에 실제 표시될 관측값이 하나라도 있는지 판정.
     * 표출 규칙(popupHtml)과 동일 기준 — 파고 3종(유의/최대/평균) 중 하나,
     * 또는 B타입이면 풍향·풍속 중 하나. 전부 null(QC 결측 등)이면 false.
     */
    function buoyObsUsable(o, type) {
        if (!o) return false;
        if (o.waveHeightSig != null || o.waveHeightMax != null || o.waveHeightAvg != null) return true;
        if (type === 'B' && (o.windSpeed != null || o.windDirection != null)) return true;
        return false;
    }

    function enrichKoreaWaters() {
        var token = ++_enrichToken;
        _koreaBuoy = null;
        _frames.forEach(function (f) { f._zoneFc = null; });
        var dbg = _debugKorea;
        // 강풍반경 북단이 31°N 에 닿는 후보 프레임만 해구도 조회. (디버그: 전 프레임 강제)
        var cand = dbg ? _frames.slice() : _frames.filter(function (f) { return f.radStrong && (f.lat + f.radStrong / KM_PER_DEG) >= KOREA_TRIG_LAT; });
        if (!cand.length) { refreshBubbleContents(); return; }

        // 진로선 최근접 부이(B/C) 선택 — 좌표는 BUOY_LOCATIONS, 관측은 fetchMarineBuoyData.
        //   [결측 폴백] 최근접 부이라도 해당 시각 관측값이 전부 결측(QC 탈락 등)이면
        //   팝업에 헤더만 남는 문제가 있어(예: 남해465), 거리순으로 훑어
        //   "표시 가능한 실측값이 있는" 첫 부이를 선택한다. 전 부이 결측이면
        //   _koreaBuoy 를 세팅하지 않아 부이 섹션 자체를 표출하지 않는다.
        try {
            if (typeof BUOY_LOCATIONS === 'object' && typeof fetchMarineBuoyData === 'function') {
                var cands = [];
                Object.keys(BUOY_LOCATIONS).forEach(function (id) {
                    var b = BUOY_LOCATIONS[id];
                    if (!b || (b.type !== 'B' && b.type !== 'C') || b.lat == null || b.lon == null) return;
                    cands.push({ id: id, name: b.name, type: b.type, dist: pointToTrackKm(b.lat, b.lon) });
                });
                cands.sort(function (a, b) { return a.dist - b.dist; });
                if (cands.length) {
                    fetchMarineBuoyData().then(function (obsMap) {
                        if (token !== _enrichToken || !obsMap) return;
                        for (var i = 0; i < cands.length; i++) {
                            var c = cands[i];
                            var obs = obsMap[c.id];
                            if (buoyObsUsable(obs, c.type)) {
                                _koreaBuoy = { name: c.name, type: c.type, obs: obs };
                                refreshBubbleContents();
                                return;
                            }
                        }
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
            + body;
        _landEl.innerHTML = h;
        _landEl.style.display = '';
        setBubbleZ(_landEl, '600');
        bringBubbleToFront(_landEl);
        _landPopup.setPosition(ol.proj.fromLonLat([lon, lat]));
        if (window.PopupStack) window.PopupStack.push('tphn-land', hideLandPopup);
        return true;
    }

    // 레이어별 채움 스타일.
    //   OL 은 MultiPolygon 의 각 폴리곤을 "따로" 반투명 채움 → 겹친 원들이 이중 채색돼
    //   진해지면서 원 테두리가 드러난다. 커스텀 렌더러로 모든 링을 한 path 에 모아
    //   nonzero 로 "단 한 번" 채워 겹쳐도 진해지지 않는 매끈한 합집합으로 렌더한다.
    //   (모든 링 winding 은 orientCW 로 통일되어 구멍도 생기지 않음)
    function swathStyle(strokeC, fillC) {
        function drawRings(ctx, arr) {
            if (!arr || !arr.length) return;
            if (typeof arr[0][0] === 'number') { // arr = 링([[x,y],...])
                for (var i = 0; i < arr.length; i++) { var p = arr[i]; if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
                ctx.closePath();
            } else {
                for (var j = 0; j < arr.length; j++) drawRings(ctx, arr[j]); // 폴리곤/멀티폴리곤 재귀
            }
        }
        return new ol.style.Style({
            renderer: function (coords, state) {
                var ctx = state.context;
                ctx.save();
                ctx.beginPath();
                drawRings(ctx, coords);
                ctx.fillStyle = fillC;
                ctx.fill('nonzero');
                ctx.restore();
            }
        });
    }

    // ── 재생 플레이헤드 렌더 ──────────────────────────────────────────────────
    function renderHead(p) {
        if (!_headSrc) return;
        _headSrc.clear();
        if (_trailSrc) _trailSrc.clear();
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
            if (_layerOn.prob) { var gp = swathCorridorGeom(passedPts, { long: 'radProb' }); if (gp) _probSrc.addFeature(new ol.Feature(gp)); }
            if (_layerOn.strong) { var gw = swathCorridorGeom(passedPts, { long: 'radStrong', short: 'radStrongS', dir: 'radStrongD', quad: 'radQuad34' }); if (gw) _strongSrc.addFeature(new ol.Feature(gw)); }
            if (_layerOn.storm) { var gs = swathCorridorGeom(passedPts, { long: 'radStorm', short: 'radStormS', dir: 'radStormD', quad: 'radQuad50' }); if (gs) _stormSrc.addFeature(new ol.Feature(gs)); }
        }

        // 진행 자취 중심선: 지나온 경로 + 현재 위치 (굵은 실선, 강도색).
        //   포인트 원/숫자에 가려지지 않도록 별도 _trailLayer(zIndex 128)에 추가.
        var passed = [];
        _frames.forEach(function (fr) { if (fr._t <= f._rtMs) passed.push(ol.proj.fromLonLat([fr.lon, fr.lat])); });
        passed.push(ol.proj.fromLonLat([f.lon, f.lat]));
        if (passed.length >= 2 && _trailSrc) {
            var trail = new ol.Feature(new ol.geom.LineString(passed));
            trail.setStyle(new ol.style.Style({ stroke: new ol.style.Stroke({ color: rgba(c, 0.95), width: 3.5 }) }));
            _trailSrc.addFeature(trail);
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
        if (_playing) { updateScrubTooltip(p); showScrubTip(); } // 재생 중 손잡이 위 말풍선 표출
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
        fadeScrubTip();
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

    // 최신 통보문 rem 에 "종료" 가 있으면 종료된 태풍으로 간주(되살아나면 새 통보문 rem 으로 자동 해제).
    function typhoonEnded(t) {
        var b = t && t.bulletins && t.bulletins[0];
        return !!(b && b.rem && b.rem.indexOf('종료') >= 0);
    }

    // [N 배지] "새 태풍 등장" 신호 — 첫 태풍단계(TYP) 통보문 발표 후 2일(48시간)까지만 표시.
    var NEW_BADGE_MS = 48 * 3600 * 1000;
    // 12자리 KST 발표시각("202607071600") → epoch ms (크롤러 tmFcToMs 와 동일 규칙)
    function tmFcToMs(s) {
        var d = String(s || '').replace(/[^0-9]/g, '');
        if (d.length < 12) return 0;
        return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12)) - 9 * 3600000;
    }
    /**
     * 태풍의 "등장 시각" = 첫 태풍단계(TYP) 통보문 발표시각.
     * 통보문 목록은 최신순이라 뒤에서부터(오래된 순) 훑으며 TD(열대저압부) 단계는 건너뛴다.
     * (수집 상한으로 목록이 잘려도, 잘릴 만큼 통보문이 많은 태풍은 이미 2일을
     *  훌쩍 넘긴 태풍이라 배지 판정 결과는 달라지지 않는다)
     */
    function firstTypBulletinMs(t) {
        var bs = (t && t.bulletins) || [];
        for (var i = bs.length - 1; i >= 0; i--) {
            if (bs[i] && bs[i].kind !== 'TD') return tmFcToMs(bs[i].tmFc) || null;
        }
        return null;
    }

    /**
     * 기본 선택 태풍 결정 (활성 캐시 인라인 데이터 대상):
     *   ① 활성(미종료) 태풍 우선 — 종료된 태풍이 최신 발생이어도 기본 선택에서 제외
     *   ② 활성이 복수면 최신 통보문의 현재 위치가 제주(33.5N,126.53E)에 가장 가까운
     *      태풍(한반도에 먼저 도달할 가능성이 높은 것) 선택
     *   ③ 전부 종료면 목록 첫 태풍(최신 발생) 폴백 — 종료 태풍도 조회는 가능해야 함
     */
    var JEJU = { lat: 33.5, lon: 126.53 };
    function pickDefaultTyphoon(typhoons) {
        var list = typhoons || [];
        var actives = list.filter(function (t) { return !typhoonEnded(t); });
        if (!actives.length) return list[0] || null;
        if (actives.length === 1) return actives[0];
        var best = null, bestD = Infinity;
        actives.forEach(function (t) {
            var cur = t.bulletins && t.bulletins[0] && t.bulletins[0].current;
            if (!cur || cur.lat == null || cur.lon == null) return;
            // 근사 평면 거리(경도는 위도 보정) — 순위 비교 용도로 충분
            var dLat = cur.lat - JEJU.lat;
            var dLon = (cur.lon - JEJU.lon) * Math.cos(JEJU.lat * Math.PI / 180);
            var d = dLat * dLat + dLon * dLon;
            if (d < bestD) { bestD = d; best = t; }
        });
        return best || actives[0];   // 위치 정보가 전무하면 활성 중 최신 발생
    }
    // 통보문 code → dmdw 통보문 이미지 파일명 (태풍정보 RTKO63 / TD정보 RTKO64, 호수 2자리).
    function bulletinImageName(code) {
        var p = String(code || '').split('_'); // [oTypInfo, oTmFc, oTdSeq, oTmSeq]
        if (p.length < 3) return '';
        var pre = p[0] === '3' ? 'RTKO64' : 'RTKO63';
        var seq = String(p[2]); if (+seq < 10) seq = '0' + (+seq);
        return pre + '_' + p[1] + ']' + seq + '_ko.png';
    }
    function populateNames() {
        var sel = document.getElementById('tphn-name');
        if (!sel) return;
        sel.innerHTML = '';
        _typhoonList.forEach(function (t) {
            var o = document.createElement('option');
            // 최신 통보문 rem 에 "종료" 가 있으면 (종료) 표기. 되살아나면(새 통보문 rem) 자동 제거.
            o.value = t.seq; o.textContent = t.name + (t.ended ? '(종료)' : '');
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
                _typhoonList = (_activeData.typhoons || []).map(function (t) { return { seq: t.seq, name: t.name, ended: typhoonEnded(t) }; });
            }
            // [종료 라벨] /api/typhoon/list 응답에는 ended 정보가 없어, 그대로 그리면
            //   먼저 표시된 "(종료)" 라벨이 사라지는 깜빡임이 생긴다. 활성 캐시와 같은
            //   연도면 ended 를 병합해 라벨을 안정적으로 유지한다.
            //   - 캐시에 있는 태풍: 통보문 rem 기준(typhoonEnded)
            //   - 캐시에 없는 태풍: 마지막 통보문이 활성 유지창(72h)보다 오래됐다는 뜻
            //     → 종료로 간주해 "(종료)" 표기 (예: 올해 지난 1~8호 태풍)
            if (_activeData && _activeData.year === year) {
                _typhoonList.forEach(function (t) {
                    var a = (_activeData.typhoons || []).find(function (x) { return x.seq === t.seq; });
                    t.ended = a ? typhoonEnded(a) : true;
                });
            }
            populateNames();
            // 기본 선택: ① 사용자가 보던 태풍(preferSeq) > ② 활성 우선(복수면 제주 최근접)
            //           > ③ 병합된 ended 기준 첫 미종료 > ④ 목록 첫 태풍(최신 발생)
            var seq = null;
            if (preferSeq && _typhoonList.some(function (t) { return t.seq === preferSeq; })) {
                seq = preferSeq;
            } else {
                var def = (_activeData && _activeData.year === year) ? pickDefaultTyphoon(_activeData.typhoons) : null;
                if (def && _typhoonList.some(function (t) { return t.seq === def.seq; })) {
                    seq = def.seq;
                } else {
                    var firstActive = _typhoonList.find(function (t) { return t.ended === false; });
                    seq = (firstActive || _typhoonList[0] || {}).seq;
                }
            }
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
            // 통보문 목록은 "태풍단계(TYP)"만 노출 — 열대저압부(TD) 단계는 아직 태풍이 아니므로 제외.
            _bulletinList = (inline.bulletins || []).filter(function (b) { return b.kind !== 'TD'; }).map(function (b) { return { code: b.code, label: b.label, isLatest: b.isLatest }; });
            (inline.bulletins || []).forEach(function (b) { if (b.code) _tableCache[year + '_' + b.code] = b; });
            // 활성 캐시에 태풍단계 통보문이 하나라도 있으면 그대로 표출.
            //   단, 캐시가 승격 전(TD만) 상태라 TYP 통보문이 0개면 → 아래 신선 조회로 폴백한다.
            //   (TD→태풍 승격 직후, 앱이 옛 캐시를 붙들고 있어 "빈 목록+빈 지도"로 보이던 문제 해결.)
            if (_bulletinList.length) {
                populateBulletins();
                var code0 = pickCode(preferCode);
                setSelValue('tphn-bulletin', code0);
                if (code0) selectBulletin(year, code0); else clearTrack();
                return Promise.resolve();
            }
            // (폴백) 캐시엔 TD 통보문뿐 → 서버에서 최신 통보문 목록을 다시 받아온다(승격분 반영).
        }
        return fetchJSON('/api/typhoon/bulletins?year=' + year + '&seq=' + seq).then(function (j) {
            // 통보문 목록은 "태풍단계(TYP)"만 노출 — 열대저압부(TD) 단계 제외.
            _bulletinList = (((j && j.bulletins) || []).filter(function (b) { return b.kind !== 'TD'; }));
            populateBulletins();
            var code0 = pickCode(preferCode);
            setSelValue('tphn-bulletin', code0);
            if (code0) selectBulletin(year, code0); else clearTrack();
        }).catch(function (e) { console.warn('[OceanTyphoon] loadTyphoon 실패:', e.message); });
    }
    // ── 해외 출처(JTWC 등) ────────────────────────────────────────────────────
    /**
     * 출처를 바꾼다 — 드롭다운에서 고르거나, 처음 켤 때 호출된다.
     * 예: setSource('jtwc') → JTWC 자료로 지도·드롭다운을 새로 채운다.
     * @param {string} src - 'kma' | 'jtwc'
     * [연계] ← 출처 드롭다운(#tphn-source) change · installControls (같은 파일)
     *          → loadForeign / loadYear (같은 파일)
     */
    /**
     * "70%반경"·"위험구역" 체크박스의 잠금을 지금 출처에 맞춘다.
     * 예: 기상청·일본 → 70%반경만 / 미국 → 위험구역만 켤 수 있음
     * [왜] 기관마다 경로 오차를 다른 방식으로 발표한다.
     *   한국·일본은 '70% 확률반경'(태풍 중심이 들어올 범위)을 숫자로 준다.
     *   미국(JTWC)은 그 숫자 대신 '34노트 위험구역' 도형(.kmz)을 준다 — 예보 오차까지
     *   넣어 초속 17m 이상 바람이 닿을 수 있는 범위다. 서로 바꿔 쓸 수 없으므로, 그
     *   기관이 실제로 발표하는 쪽만 켜지게 한다(없는 칸을 켜 두면 빈 화면이 된다).
     * [연계] ← setSource (같은 파일) · index2.html #tphn-ly-prob · #tphn-ly-swath
     */
    var PROB_SOURCES = ['kma', 'jma'];    // 70% 확률반경을 발표하는 기관
    var SWATH_SOURCES = ['jtwc'];         // 위험구역 도형을 발표하는 기관
    function applyProbControl() {
        lockLayerChk('tphn-ly-prob', PROB_SOURCES.indexOf(_src) >= 0,
            '이 기관은 70% 확률반경을 발표하지 않습니다 (대신 "위험구역"을 보세요)');
        lockLayerChk('tphn-ly-swath', SWATH_SOURCES.indexOf(_src) >= 0,
            '이 기관은 34노트 위험구역 도형을 발표하지 않습니다 (대신 "70%반경"을 보세요)');
    }

    /** 레이어 체크박스 하나를 켤 수 있게/없게 한다. 잠그면 흐려지고 why 가 설명으로 붙는다. */
    function lockLayerChk(id, on, why) {
        var chk = document.getElementById(id);
        if (!chk) return;
        chk.disabled = !on;
        var lab = chk.parentNode;
        if (!lab) return;
        lab.style.opacity = on ? '' : 0.45;
        lab.title = on ? '' : why;
    }

    /**
     * 통보문 이미지 버튼을 띄울지 정한다 — 그림이 실제로 있는 때만 띄운다.
     * 예: 기상청 → 항상 / JTWC 태풍 → 그 태풍의 예보도가 있으면 띄움
     * [왜 태풍마다 보나] 목록에 올랐어도 그림이 없는 태풍이 있을 수 있다.
     *   서버가 태풍마다 imageName 을 채워 주고(없으면 빈 값), 여기서는 그것만 본다.
     * [연계] ← setSource / selectForeignTyphoon (같은 파일) · 서버 응답의 imageName
     */
    function applyImageBtn() {
        var btn = document.getElementById('tphn-img-btn');
        if (!btn) return;
        var on;
        if (_src === 'kma') {
            on = true;
        } else {
            var t = foreignTyphoon(_selSeq);
            on = !!(t && t.imageName);
        }
        btn.style.display = on ? '' : 'none';
    }

    function setSource(src) {
        if (!SOURCES[src]) src = 'kma';
        _src = src;
        pause();
        clearTrack();
        // 기상청에만 있는 조작은 해외 출처에서 잠근다(연도 이동·70%확률반경).
        var ySel = document.getElementById('tphn-year');
        if (ySel) ySel.disabled = (src !== 'kma');
        applyImageBtn();
        applyProbControl();
        renderSourceNote();
        if (src === 'kma') { loadYear(_year, null, null); return; }
        loadForeign(src);
    }

    /**
     * 해외 기관 자료를 받아 드롭다운·지도를 채운다.
     * 서버(routes/typhoon_foreign.js)가 기상청과 같은 프레임 형식으로 바꿔 주므로
     * 그리는 코드(renderBulletin)는 그대로 쓴다.
     * @param {string} src - 'jtwc'
     * [연계] ← setSource (같은 파일) → GET /api/typhoon/foreign
     */
    function loadForeign(src) {
        return fetchJSON('/api/typhoon/foreign?src=' + encodeURIComponent(src)).then(function (j) {
            if (!j || !j.success) {
                var why = (j && j.reason === 'no_key') ? '아직 연결되지 않았습니다'
                        : (j && j.reason === 'upstream') ? '자료를 받지 못했습니다'
                        : '이 출처는 아직 준비 중입니다';
                _foreignData = null;
                _typhoonList = []; _bulletinList = [];
                populateNames(); populateBulletins();
                clearTrack();
                renderSourceNote(why);
                return;
            }
            _foreignData = j;
            _typhoonList = (j.typhoons || []).map(function (t) {
                return { seq: t.seq, name: t.name, ended: false };
            });
            populateNames();
            if (!_typhoonList.length) {
                _bulletinList = []; populateBulletins(); clearTrack();
                renderSourceNote('지금 활동 중인 태풍이 없습니다');
                return;
            }
            renderSourceNote();
            // 기상청 경로와 같은 규칙으로 고른다 — 제주에서 가장 가까운 태풍.
            //   JTWC 는 전 세계 태풍을 한꺼번에 주므로(대서양·동태평양·인도양까지),
            //   받은 순서의 첫 번째를 집으면 우리와 무관한 태풍이 기본이 된다.
            var d0 = pickDefaultTyphoon(_foreignData.typhoons) || _foreignData.typhoons[0];
            selectForeignTyphoon(d0.seq);
        }).catch(function (e) {
            console.warn('[OceanTyphoon] loadForeign 실패:', e.message);
            renderSourceNote('자료를 받지 못했습니다');
        });
    }

    /** 해외 출처에서 태풍 하나를 골라 통보(자문) 드롭다운과 지도를 채운다. */
    function selectForeignTyphoon(seq) {
        var t = foreignTyphoon(seq);
        if (!t) { clearTrack(); return; }
        _selSeq = seq;
        setSelValue('tphn-name', seq);
        _bulletinList = (t.bulletins || []).map(function (b) {
            return { code: b.code, label: b.label, isLatest: b.isLatest };
        });
        populateBulletins();
        var b0 = (t.bulletins || [])[0];
        if (!b0) { clearTrack(); return; }
        _selCode = b0.code;
        setSelValue('tphn-bulletin', b0.code);
        applyImageBtn();   // 태풍마다 예보도 유무가 다를 수 있다
        renderBulletin(b0);
    }

    /**
     * 해외 출처를 조용히 다시 받아온다 — 사용자가 고른 태풍은 그대로 둔다.
     * 예: JTWC 를 켜 둔 채 5분이 지나면, 새 자문이 나왔을 때만 화면을 다시 그린다.
     * [왜] 상류(JTWC)는 6시간마다 갱신되는데, 지금까지는 출처를 바꿀 때만 받아와서
     *   패널을 켜 둔 채로는 자료가 멈춰 있었다(기상청 쪽에만 주기 갱신이 있었다).
     * [연계] ← bindUI 의 5분 setInterval · → fetchJSON('/api/typhoon/foreign')
     */
    function refreshForeign() {
        return fetchJSON('/api/typhoon/foreign?src=' + encodeURIComponent(_src)).then(function (j) {
            if (!j || !j.success || !(j.typhoons || []).length) return;   // 실패하면 보던 화면을 유지
            _foreignData = j;
            _typhoonList = j.typhoons.map(function (t) {
                return { seq: t.seq, name: t.name, ended: false };
            });
            populateNames();
            var t = foreignTyphoon(_selSeq);
            if (!t) return;                       // 보던 태풍이 목록에서 빠졌으면 화면을 건드리지 않는다
            setSelValue('tphn-name', _selSeq);
            var b0 = (t.bulletins || [])[0];
            if (!b0 || b0.code === _selCode) return;   // 새 자문이 없으면 다시 그리지 않는다(재생 위치 보존)
            selectForeignTyphoon(_selSeq);
        }).catch(function () { /* ignore */ });
    }

    /** 해외 응답 캐시에서 태풍 하나 찾기. 없으면 null. */
    function foreignTyphoon(seq) {
        if (!_foreignData) return null;
        return (_foreignData.typhoons || []).find(function (t) { return t.seq === seq; }) || null;
    }

    /** 해외 출처에서 통보(자문) 하나를 골라 그린다. */
    function selectForeignBulletin(code) {
        var t = foreignTyphoon(_selSeq);
        if (!t) return;
        var b = (t.bulletins || []).find(function (x) { return x.code === code; });
        if (!b) return;
        _selCode = code;
        renderBulletin(b);
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
        _curBulletin = b;         // i버튼(안내)·이미지 팝업에서 rem/other/code 참조
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
        [_trackSrc, _probSrc, _strongSrc, _stormSrc, _trailSrc, _headSrc, _pointSrc, _swathSrc].forEach(function (s) { if (s) s.clear(); });
        _pointBubbles.forEach(function (ov) { ov.setPosition(undefined); });
        if (_moveBubble) _moveBubble.setPosition(undefined);
    }

    function renderLegend() {
        var el = document.getElementById('tphn-legend');
        if (!el) return;
        var html = '';
        [0, 1, 2, 3, 4, 5].forEach(function (g) {
            // 색상 원 안에 강도 숫자(1~5) — 지도 포인트와 동일. 열대저압부(0)는 숫자 없음.
            html += '<span class="tphn-leg-item"><i style="background:' + rgba(gradeColor(g), 1) + '">' + (g >= 1 ? g : '') + '</i>' + GRADE_NAMES[g] + '</span>';
        });
        el.innerHTML = html;
        renderSourceNote();
    }

    /**
     * 범례 아래에 "이 화면이 어느 기관 자료인가"를 한 줄로 적는다.
     * 예: 미국(JTWC) 선택 → "자료: JTWC … 풍속은 1분 평균(기상청은 10분 평균)"
     * [왜] 기관마다 풍속 기준·제공 항목이 달라, 출처를 안 적으면 숫자가 서로 틀린 것처럼 보인다.
     * [연계] ← renderLegend / setSource (같은 파일)
     */
    function renderSourceNote(extra) {
        var el = document.getElementById('tphn-source-note');
        if (!el) {
            var leg = document.getElementById('tphn-legend');
            if (!leg || !leg.parentNode) return;
            el = document.createElement('div');
            el.id = 'tphn-source-note';
            el.className = 'tphn-source-note';
            leg.parentNode.insertBefore(el, leg.nextSibling);
        }
        var base = (SOURCES[_src] || SOURCES.kma).note;
        el.textContent = extra ? (base + ' — ' + extra) : base;
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
                // [태풍 시연 OFF] demoFocus(테스트/데모)로 연 태풍을 끌 때는, 처음 해양종합정보를
                //   열었을 때처럼 대한민국 전도(한반도 중앙)로 지도를 되돌린다(사용자 요청).
                //   일반 사용/10탭 잠금해제 경로의 OFF 는 보던 위치를 유지(리셋 안 함).
                if (_demoActive && typeof window.oceanResetDefaultView === 'function') {
                    window.oceanResetDefaultView(true);
                }
                _demoActive = false;   // 시연 상태 소진(다음 일반 OFF 는 리셋하지 않음)
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
            // 현재연도 전체 태풍 목록(dmdw)으로 이름 드롭다운 확장(과거 태풍 포함).
            //   [일부 목록 버그 수정] 재표출 시 위 primeDefaultFromActive() 가 드롭다운을
            //   활성 캐시(최근 72h 태풍 2~3개)로만 다시 채우는데, 예전엔 첫 표출에만
            //   확장해서 두 번째 표출부터 일부 목록만 남았다. 매 표출마다 확장한다
            //   (서버 5분 캐시로 가볍고, 현재 선택은 preferSeq/preferCode 로 유지).
            //   demoFocus 경로는 직접 loadYear 를 부르므로 1회 억제(_suppressAutoYear).
            if (_src !== 'kma') { loadForeign(_src); }
            else if (_suppressAutoYear) { _suppressAutoYear = false; }
            else { loadYear(_year, _selSeq, _selCode); }
        } else {
            pause();
        }
    }

    function applyAvailability() {
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (!btn) return;
        // 활성 태풍이 있으면 활성. 없을 때는 10회 탭으로 잠금해제(_unlocked, 세션 한정) 시에도 활성.
        var has = _activeData && _activeData.hasActive && (_activeData.typhoons || []).length;
        var canShow = has || _unlocked;
        // N 배지는 "새 태풍 등장" 신호 — 미종료 태풍 중 첫 태풍단계(TYP) 통보문 발표가
        //   2일(48시간) 이내인 것이 있을 때만 표시. 2일이 지나면 태풍이 계속 활성이어도
        //   배지를 뗀다(사용자 요구). 종료된 태풍은 시간과 무관하게 제외.
        //   (버튼 활성/조회 가능 여부는 has 그대로 — 배지와 무관)
        var hasNew = has && (_activeData.typhoons || []).some(function (t) {
            if (typhoonEnded(t)) return false;
            var first = firstTypBulletinMs(t);
            return !!first && (Date.now() - first) <= NEW_BADGE_MS;
        });
        var nBadge = document.getElementById('tphn-n-badge');
        if (nBadge) nBadge.style.display = hasNew ? 'flex' : 'none';
        if (!canShow) {
            btn.classList.add('tphn-disabled');
            btn.title = '현재 태풍 없음';
            if (_visible) setVisible(false);
        } else {
            btn.classList.remove('tphn-disabled');
            btn.title = has ? '태풍 진로' : '태풍 진로 (활성 없음 — 과거 통보문 조회)';
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
            // [가드] demoFocus(시연)가 이미 특정 통보문을 표출/로드 중이면 기본(활성 최신)으로
            //   되돌려 덮지 않는다(느린 네트워크에서 load() 가 늦게 끝나는 경합 대비).
            if (!_demoActive) primeDefaultFromActive();
        }).catch(function (e) { console.warn('[OceanTyphoon] load 실패:', e.message); });
    }

    // /api/typhoon(파일)만으로 기본 선택 구성 — dmdw 호출 없음
    function primeDefaultFromActive() {
        if (!_activeData || !_activeData.hasActive || !(_activeData.typhoons || []).length) return;
        _year = _activeData.year || curYearKst();
        setSelValue('tphn-year', String(_year));
        _typhoonList = _activeData.typhoons.map(function (t) { return { seq: t.seq, name: t.name, ended: typhoonEnded(t) }; });
        populateNames();
        // 활성(미종료) 태풍 우선 — 종료 태풍이 최신 발생이어도 기본으로 띄우지 않는다.
        //   활성 복수면 제주 최근접(한반도 도달 가능성 우선). 전부 종료면 최신 발생 폴백.
        var t0 = pickDefaultTyphoon(_activeData.typhoons) || _activeData.typhoons[0];
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
        _swathSrc = new ol.source.Vector();
        _probSrc = new ol.source.Vector();
        _strongSrc = new ol.source.Vector();
        _stormSrc = new ol.source.Vector();
        _trackSrc = new ol.source.Vector();
        _trailSrc = new ol.source.Vector();
        _headSrc = new ol.source.Vector();
        _pointSrc = new ol.source.Vector();
        // 채움은 유형별 색(원·말풍선과 동일), 반투명 유지 → 배경 지도 희미하게 비침.
        // updateWhileInteracting/Animating: 재생 중 지도 드래그·애니메이션 동안에도 벡터를
        //   계속 재렌더(드래그 중 태풍·반경이 멈췄다 순간이동하던 문제 방지).
        var uw = { updateWhileInteracting: true, updateWhileAnimating: true };
        // 위험구역이 가장 넓으므로 맨 아래(114) — 그 위에 70%(116)·강풍(118)·폭풍(120)이 얹힌다.
        _swathLayer = new ol.layer.Vector(Object.assign({ source: _swathSrc, zIndex: 114, style: swathStyle(rgba(SWATH_C, 0.95), rgba(SWATH_C, 0.20)) }, uw));
        _probLayer = new ol.layer.Vector(Object.assign({ source: _probSrc, zIndex: 116, style: swathStyle(rgba(PROB_C, 0.95), rgba(PROB_C, 0.30)) }, uw));
        _strongLayer = new ol.layer.Vector(Object.assign({ source: _strongSrc, zIndex: 118, style: swathStyle(rgba(STRONG_C, 0.95), rgba(STRONG_C, 0.32)) }, uw));
        _stormLayer = new ol.layer.Vector(Object.assign({ source: _stormSrc, zIndex: 120, style: swathStyle(rgba(STORM_C, 0.95), rgba(STORM_C, 0.36)) }, uw));
        _trackLayer = new ol.layer.Vector(Object.assign({ source: _trackSrc, zIndex: 124 }, uw));
        // 자취선(지나온 경로 실선)은 포인트(140)보다 아래에 — 포인트 원/숫자가 가려지지 않도록.
        _trailLayer = new ol.layer.Vector(Object.assign({ source: _trailSrc, zIndex: 128 }, uw));
        _pointLayer = new ol.layer.Vector(Object.assign({ source: _pointSrc, zIndex: 140 }, uw)); // 강도숫자 포인트
        // 이동 태풍(🌀) 헤드만 포인트(140)보다 위 → 재생 중 포인트 숫자에 가려지지 않음.
        _headLayer = new ol.layer.Vector(Object.assign({ source: _headSrc, zIndex: 150 }, uw));
        map.addLayer(_swathLayer);
        map.addLayer(_probLayer); map.addLayer(_strongLayer); map.addLayer(_stormLayer);
        map.addLayer(_trackLayer); map.addLayer(_trailLayer); map.addLayer(_headLayer); map.addLayer(_pointLayer);
        _moveBubble = makeBubbleOverlay(); map.addOverlay(_moveBubble); _moveEl = _moveBubble.getElement();
        // 육지 클릭 팝업(강풍반경 도달시간) — 클릭 차단(stopEvent), 닫기·행동요령 버튼 처리.
        _landEl = document.createElement('div');
        _landEl.className = 'tphn-bubble tphn-land-pop';
        _landEl.style.display = 'none';
        _landEl.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.tphn-land-close')) { hideLandPopup(); return; }
            if (e.target.closest && e.target.closest('.tphn-guide-btn')) { openGuideModal(); }
        });
        _landPopup = new ol.Overlay({ element: _landEl, offset: [12, -12], positioning: 'bottom-left', stopEvent: false, insertFirst: false });
        map.addOverlay(_landPopup);
        try { var s = JSON.parse(localStorage.getItem(LAYER_KEY)); if (s) _layerOn = Object.assign(_layerOn, s); } catch (e) {}
        applyLayerVisibility();
    }

    function applyLayerVisibility() {
        // 기본(정지): 포인트별 말풍선 + 사전 범위 표출 / 재생: 사전 범위·포인트 말풍선 숨기고 이동 헤드만.
        var pb = _playbackMode;
        // swath(회랑)는 정지=전체 / 재생=시작~현재까지 자라나는 항적. 두 경우 모두 토글대로 표시.
        // 위험구역은 기관이 발표한 도형 한 장이라 재생 중에도 그대로 둔다(자라나지 않는다).
        if (_swathLayer) _swathLayer.setVisible(_visible && _layerOn.swath);
        if (_probLayer) _probLayer.setVisible(_visible && _layerOn.prob);
        if (_strongLayer) _strongLayer.setVisible(_visible && _layerOn.strong);
        if (_stormLayer) _stormLayer.setVisible(_visible && _layerOn.storm);
        if (_trackLayer) _trackLayer.setVisible(_visible && _layerOn.track);
        if (_pointLayer) _pointLayer.setVisible(_visible && _layerOn.track);
        if (_trailLayer) _trailLayer.setVisible(_visible && pb); // 자취선(재생 모드에서만)
        if (_headLayer) _headLayer.setVisible(_visible && pb);   // 이동 헤드(재생 모드에서만)
        updateBubbleVisibility();
    }

    function bindUI() {
        if (_bound) return;
        _bound = true;
        var btn = document.getElementById('ocean-typhoon-toggle-btn');
        if (btn) {
            btn.addEventListener('click', function () {
                var has = _activeData && _activeData.hasActive && (_activeData.typhoons || []).length;
                // 활성 태풍 있거나 잠금해제(10탭) 상태면 토글, 아니면 탭 카운트.
                if (!has && !_unlocked) { handleGateTap(); return; }
                if (!_visible && window.trackUsage) window.trackUsage('ocean.typhoon');  // [사용량] 켤 때만 1회
                setVisible(!_visible);
            });
        }
        var ySel = document.getElementById('tphn-year');
        if (ySel) ySel.addEventListener('change', function () {
            if (_src !== 'kma') return;              // 해외 출처는 연도 이동이 없다(활성 태풍만 제공)
            loadYear(parseInt(this.value, 10));
        });
        // 관리자 모드 기기인가 — 아래 디버그 줄(tphn-dbg-row)이 쓴다.
        var isAdmin = false;
        try { isAdmin = localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { }

        // [출처 전환] 모든 사용자에게 보인다. 기본값은 한국(기상청) 그대로다.
        var srcSel = document.getElementById('tphn-source');
        if (srcSel) srcSel.addEventListener('change', function () { setSource(this.value); });
        var nSel = document.getElementById('tphn-name');
        if (nSel) nSel.addEventListener('change', function () {
            if (_src !== 'kma') { selectForeignTyphoon(this.value); return; }
            loadTyphoon(_year, this.value);
        });
        var bSel = document.getElementById('tphn-bulletin');
        if (bSel) bSel.addEventListener('change', function () {
            if (_src !== 'kma') { selectForeignBulletin(this.value); return; }
            selectBulletin(_year, this.value);
        });
        var playBtn = document.getElementById('tphn-play');
        if (playBtn) playBtn.addEventListener('click', function () {
            if (!_playing && window.trackUsage) window.trackUsage('ocean.typhoon');  // [사용량] 태풍 기능 내 동작은 모두 '태풍' 하나로 집계
            _playing ? pause() : play();
        });
        var resetBtn = document.getElementById('tphn-reset');
        if (resetBtn) resetBtn.addEventListener('click', function () { if (_frames.length) resetView(); });
        var scr = document.getElementById('tphn-scrubber');
        if (scr) {
            scr.addEventListener('input', function () { pause(); setPlaybackMode(true); _p = (+this.value) / 1000; renderHead(_p); updateScrubTooltip(_p); showScrubTip(); });
            scr.addEventListener('mousedown', function () { updateScrubTooltip((+this.value) / 1000); showScrubTip(); });
            scr.addEventListener('touchstart', function () { updateScrubTooltip((+this.value) / 1000); showScrubTip(); }, { passive: true });
            scr.addEventListener('mouseup', fadeScrubTip);
            scr.addEventListener('touchend', fadeScrubTip);
        }
        var closeBtn = document.getElementById('tphn-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { setVisible(false); });

        // 행동요령 팝업 — 열기는 말풍선/육지팝업 내부 .tphn-guide-btn 클릭에서 openGuideModal 로 처리.
        //   닫기(× / 배경)는 closeGuideModal → PopupStack 연동으로 하드웨어 뒤로가기 지원.
        var guideModal = document.getElementById('tphn-guide-modal');
        var guideClose = document.getElementById('tphn-guide-close');
        if (guideClose) guideClose.addEventListener('click', closeGuideModal);
        if (guideModal) guideModal.addEventListener('click', function (e) { if (e.target === guideModal) closeGuideModal(); });
        // 해상/육상 탭 전환(추가형) — 모달 열기/닫기·PopupStack 동작은 변경하지 않음. 기본 선택은 openGuideModal()에서 보장.
        var guideTabs = document.querySelectorAll('#tphn-guide-modal .tphn-guide-tab');
        for (var gi = 0; gi < guideTabs.length; gi++) {
            guideTabs[gi].addEventListener('click', function () { selectGuideTab(this.getAttribute('data-tab')); });
        }

        // 통보문 안내(i) 팝업
        var infoBtn = document.getElementById('tphn-info-btn');
        if (infoBtn) infoBtn.addEventListener('click', openNoteModal);
        var noteClose = document.getElementById('tphn-note-close');
        if (noteClose) noteClose.addEventListener('click', closeNoteModal);
        var noteModal = document.getElementById('tphn-note-modal');
        if (noteModal) noteModal.addEventListener('click', function (e) { if (e.target === noteModal) closeNoteModal(); });

        // 통보문 이미지 팝업(지도 이모지 버튼) — 태풍 기능 내 동작이므로 '태풍' 하나로 집계
        var imgBtn = document.getElementById('tphn-img-btn');
        if (imgBtn) imgBtn.addEventListener('click', function () {
            if (window.trackUsage) window.trackUsage('ocean.typhoon');
            openImgModal();
        });
        var imgClose = document.getElementById('tphn-img-close');
        if (imgClose) imgClose.addEventListener('click', closeImgModal);
        var imgClose2 = document.getElementById('tphn-img-close2');
        if (imgClose2) imgClose2.addEventListener('click', closeImgModal);
        var imgModal = document.getElementById('tphn-img-modal');
        if (imgModal) imgModal.addEventListener('click', function (e) { if (e.target === imgModal) closeImgModal(); });
        var imgDl = document.getElementById('tphn-img-download');
        if (imgDl) imgDl.addEventListener('click', downloadImg);

        // [디버그] 해역표출 강제 토글 — 관리자 모드 기기에서만 노출(시그널 통합관리자 센터에서 체크).
        var dbgRow = document.getElementById('tphn-dbg-row');
        if (dbgRow && !isAdmin) dbgRow.style.display = 'none';
        var dbgChk = document.getElementById('tphn-dbg-korea');
        if (dbgChk) dbgChk.addEventListener('change', function () {
            _debugKorea = dbgChk.checked;
            if (_frames.length) enrichKoreaWaters();
        });

        // 레이어 토글 체크박스 (dmdw 상세정보 레이어 대응)
        [['tphn-ly-track', 'track'], ['tphn-ly-prob', 'prob'], ['tphn-ly-swath', 'swath'], ['tphn-ly-strong', 'strong'], ['tphn-ly-storm', 'storm']]
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
                setInterval(function () {
                    if (!_visible) return;
                    refreshActive();                        // 버튼 활성 상태는 출처와 무관하게 계속 본다
                    if (_src !== 'kma') refreshForeign();   // 해외 출처도 같이 갱신
                }, 5 * 60 * 1000);
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

    // [관리자 시연 전용] 지정한 "실제 통보문"(연도+호수+코드)을 그대로 불러와 표출 + 지도 이동.
    //   - 가짜 데이터를 주입하지 않는다. 사용자가 드롭다운으로 과거 통보문을 고르는 것과 동일한
    //     실데이터 경로(loadYear→loadTyphoon→selectBulletin→renderBulletin)를 그대로 태운다.
    //     → 실제 태풍명/통보문 라벨·정보(ⓘ)·통보문 이미지·예상 진로·지도 포커스가 모두 정상 표출.
    //   - 현재 활성 태풍이 없어 버튼이 비활성이어도 강제로 잠금해제·활성화한다.
    //   - 호출: js/assistant_deeplink.js (테스트 푸시 딥링크의 demoTphn/dtYear/dtSeq/dtCode[/dtGuide]).
    //   - demo.openGuide 가 truthy 면(위치기반 반경 시연) 행동요령(해상/육상 2탭) 팝업까지 자동 표출.
    function demoFocus(demo) {
        try {
            if (!demo) return;
            // [초기화 레이스 방어] 해양종합정보 지도는 탭 첫 진입 시 lazy 생성(marine.js 200ms 지연)이고,
            //   이 모듈의 tryInit 폴러(300ms)가 그 뒤에 _map 을 잡으며 _unlocked/_visible 을 리셋한다.
            //   그보다 먼저 demoFocus 가 실행되면(알림 인앱 전환 직후 등) _map=null 인 채 절반만 표출되다
            //   tryInit 리셋에 덮여 "태풍이 아예 안 나오는" 증상이 된다 → 초기화 완료까지 재시도(최대 ~12초).
            if (!_map) {
                demo.__waitTries = (demo.__waitTries || 0) + 1;
                if (demo.__waitTries <= 40) setTimeout(function () { demoFocus(demo); }, 300);
                return;
            }
            _demoActive = true;      // 시연 표출 중 표시 → 이 태풍을 끄면 기본 전도(전도 중앙)로 복귀
            _unlocked = true;        // 세션 한정 잠금해제 → 버튼 활성화 허용
            _suppressAutoYear = true; // setVisible 의 자동 loadYear 1회 억제(아래에서 직접 로드 — 경합 방지)
            applyAvailability();     // 버튼에서 'tphn-disabled' 제거(활성화)
            setVisible(true);        // 레이어 ON (활성 태풍이 없어도 패널/버튼 표시)
            var year = parseInt(demo.year, 10) || curYearKst();
            _year = year;
            setSelValue('tphn-year', String(year));
            // 실제 연도/호수/통보문코드로 dmdw 실데이터 로드 → 실제 라벨·정보·이미지 + 지도 포커스
            loadYear(year, demo.seq != null ? String(demo.seq) : null, demo.code || null);
            // [위치기반 반경 시연] 행동요령 2탭 팝업 자동 표출(추가형 — openGuide 없으면 미호출).
            if (demo.openGuide) openGuideModal();
        } catch (e) { /* 시연 실패는 조용히 무시 */ }
    }

    window.OceanTyphoon = {
        reload: load,
        show: function () { setVisible(true); },
        hide: function () { setVisible(false); },
        isVisible: function () { return _visible; },
        // 지도·모듈 초기화(tryInit) 완료 여부 — 딥링크(assistant_deeplink)가 demoFocus 호출 타이밍 게이트로 사용.
        isReady: function () { return !!_map; },
        demoFocus: demoFocus,   // 위치기반 태풍 반경 알림 탭: 실제 통보문을 강제 활성화 표출 + 지도 이동
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
