/**
 * ============================================================================
 * 파일명: client/js/ocean-map/map/ocean_overlay_labels.js
 * 역할  : 해양종합정보 색칠 지도 위에 "그 자리 값"을 글자로 얹는 그리기 도구.
 *         풍향·풍속 / 파고·파향 = 색 경계선(등치선)과 그 선 위의 값("8m/s"),
 *         유향·유속 = 일정 간격의 흰 화살표(검정 테두리) + 값("0.6m/s").
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (캔버스 2D 와 넘겨받은 콜백만 쓴다 — 지도·데이터를 직접 모른다)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : ocean_overlay.js (renderGridToOffscreen → drawContourLines,
 *                    _renderLabels → drawContourLabels / drawCurrentLabels)
 * [로드 순서] ocean_bottom_sheet_vsby.js 다음 · ocean_overlay.js 이전 — 순서 변경 금지
 *
 * [확정 시안] 2026-11-18 사용자 확정 (시안 artifact BdhYuqBDtgqr7GcdYmRubt v3)
 *   사용자 원문: "기본으로 할 것은 등차선 / 라벨 밀도는 빽빽 / 단위 보기는 아래 범례를 누르면
 *   라밸도 같이 바뀌도록 / 라벨은 늘 켜지도록 / 단, 유속,유향의 경우는 방위 글자로. 북향과 같은
 *   방향은 제외하고, 화살표가 좀 더 잘 보이도록 해줘. 배경에 가려지지않도록. 라벨 밀도는 보통으로."
 *   "유향유속 라벨을 눌러도 자세한 창 값이 나오지 않도록 해줘. 그냥 보는 표현만"
 *   "그 방향표시에 동그라미 그냥 빼줘. 화살표의 테두리만 검정색으로"
 *   → 라벨은 그림일 뿐 누름 처리가 없다(이 파일에 클릭 코드 없음).
 * ============================================================================
 */
(function () {
    'use strict';

    // 등치선을 긋는 값 — 앱 색 범례(COLOR_SCALES)의 색 경계와 맞춘다. 단위: wind=m/s, wave=m.
    var CONTOUR_THRESHOLDS = {
        wind: [2, 5, 8, 12, 16, 20],
        wave: [0.5, 1, 1.5, 2, 3, 4]
    };
    // 화면 가장자리 여백(px). 검색창·버튼 자리는 따로 o.avoid(화면 사각형 목록)로 받아 피한다.
    var MARGIN = { top: 8, right: 8, bottom: 12, left: 8 };
    // 등치선 라벨 간격 — 시안 「빽빽」(같은 선 위 230/1.35 ≈ 170px), 다른 라벨과는 최소 70px
    var CONTOUR_SAME_GAP = 170, CONTOUR_ANY_GAP = 70;
    // 유향·유속 라벨 간격 — 시안 「보통」(라벨 중심 사이 최소 84px)
    var CURRENT_MIN_PX = 84;
    var CURRENT_STEPS = [0.25, 0.5, 1, 1.5, 2, 3];   // 고를 수 있는 격자 간격(도)
    var FONT = '"Pretendard", "Noto Sans KR", sans-serif';

    /**
     * m/s 를 kts 로 바꾼다 (해양 표준 1.94384).
     * 예: msToKts(10) → 19.4384
     * @param {number} v - m/s
     * @returns {number} kts
     * [연계] ← contourLabelText / currentLabelText (같은 파일) — 범례와 같은 비율을 쓰기 위해
     */
    function msToKts(v) { return v * 1.94384; }

    /**
     * 등치선 라벨 글자를 만든다.
     * 예: contourLabelText('wind', 8, false) → "8m/s" · ('wind', 8, true) → "16kts" · ('wave', 1.5) → "1.5m"
     * @param {string} layer - 'wind' | 'wave'
     * @param {number} th - 등치선 값(wind=m/s, wave=m)
     * @param {boolean} useKts - 범례에서 kts 로 바꿨는가 (wave 는 무시 — m 고정)
     * @returns {string}
     * [연계] ← drawContourLabels (같은 파일) · test_ocean_overlay_labels.js
     */
    function contourLabelText(layer, th, useKts) {
        if (layer === 'wave') return th + 'm';
        return useKts ? Math.round(msToKts(th)) + 'kts' : th + 'm/s';
    }

    /**
     * 유향·유속 라벨 글자를 만든다 (방위 글자는 넣지 않는다 — 사용자 확정).
     * 예: currentLabelText(63, false) → "0.6m/s" · (63, true) → "1.2kts"
     * @param {number} cmps - 유속(cm/s — ocean_overlay.js 의 gridData.crsp 단위)
     * @param {boolean} useKts
     * @returns {string}
     * [연계] ← drawCurrentLabels (같은 파일) · test_ocean_overlay_labels.js
     */
    function currentLabelText(cmps, useKts) {
        var ms = cmps / 100;
        return useKts ? msToKts(ms).toFixed(1) + 'kts' : ms.toFixed(1) + 'm/s';
    }

    /**
     * 라벨끼리 안 겹치는 가장 촘촘한 격자 간격(도)을 고른다.
     * 예: pickGridStep(200, 84) → 0.5 (0.25°=50px 는 좁고 0.5°=100px 부터 됨) · (20, 84) → 3 (마지막 칸)
     * @param {number} pxPerDeg - 화면 가운데에서 경도 1° 가 몇 px 인가
     * @param {number} minPx - 라벨 중심 사이 최소 간격(px)
     * @param {number[]=} steps - 고를 간격 목록(오름차순). 기본 CURRENT_STEPS
     * @returns {number} 간격(도)
     * [연계] ← drawCurrentLabels (같은 파일) · test_ocean_overlay_labels.js
     */
    function pickGridStep(pxPerDeg, minPx, steps) {
        steps = steps || CURRENT_STEPS;
        for (var i = 0; i < steps.length; i++) if (steps[i] * pxPerDeg >= minPx) return steps[i];
        return steps[steps.length - 1];
    }

    /**
     * 값 격자에서 등치선 조각을 찾는다 (marching squares — 칸 네 귀퉁이 값으로 선이 지나는 자리를 잇는다).
     * 예: 2×2 격자 [0,10 / 0,10], 값 5 → 가운데 세로 조각 하나 {th:5, x0:5,y0:0, x1:5,y1:10}(step=10)
     * @param {Float32Array|number[]} values - imgW×imgH 값 (자료 없는 칸은 NaN)
     * @param {number} imgW
     * @param {number} imgH
     * @param {number} step - 값 한 칸이 화면 몇 px 인가 (ocean_overlay.js 의 STEP=4)
     * @param {number[]} thresholds - 선을 그을 값들
     * @returns {Array<{th:number,x0:number,y0:number,x1:number,y1:number}>} 화면 px 좌표 조각
     * [연계] ← drawContourLines (같은 파일) · test_ocean_overlay_labels.js
     *          NaN 칸(육지·자료 밖)은 건너뛰어 선이 거기서 끊긴다.
     */
    function contourSegments(values, imgW, imgH, step, thresholds) {
        var segs = [];
        for (var ti = 0; ti < thresholds.length; ti++) {
            var t = thresholds[ti];
            for (var j = 0; j < imgH - 1; j++) {
                for (var i = 0; i < imgW - 1; i++) {
                    var a = values[j * imgW + i], b = values[j * imgW + i + 1];
                    var c = values[(j + 1) * imgW + i + 1], d = values[(j + 1) * imgW + i];
                    if (a !== a || b !== b || c !== c || d !== d) continue;   // NaN
                    var ua = a >= t, ub = b >= t, uc = c >= t, ud = d >= t;
                    if (ua === ub && ub === uc && uc === ud) continue;
                    var x = i * step, y = j * step;
                    // 변 위 교차점: top(a-b) right(b-c) bottom(d-c) left(a-d)
                    var top = ua !== ub ? [x + step * (t - a) / (b - a), y] : null;
                    var right = ub !== uc ? [x + step, y + step * (t - b) / (c - b)] : null;
                    var bottom = ud !== uc ? [x + step * (t - d) / (c - d), y + step] : null;
                    var left = ua !== ud ? [x, y + step * (t - a) / (d - a)] : null;
                    var pairs;
                    if (top && right && bottom && left) {
                        // 안장(saddle): 가운데 값이 a 쪽과 같으면 b·d 귀퉁이를 잘라내고, 아니면 a·c 를 잘라낸다
                        var center = (a + b + c + d) / 4;
                        pairs = ((center >= t) === ua) ? [[top, right], [bottom, left]] : [[top, left], [right, bottom]];
                    } else {
                        var pts = [top, right, bottom, left].filter(Boolean);
                        pairs = [[pts[0], pts[1]]];
                    }
                    for (var k = 0; k < pairs.length; k++) {
                        segs.push({ th: t, x0: pairs[k][0][0], y0: pairs[k][0][1], x1: pairs[k][1][0], y1: pairs[k][1][1] });
                    }
                }
            }
        }
        return segs;
    }

    /**
     * 등치선을 흰 실선으로 긋고, 라벨 자리 고르기에 쓸 조각 목록을 돌려준다.
     * 예: drawContourLines(gridCtx, values, 300, 500, 4, 'wind') → 선이 그려지고 [{th:8,…},…] 반환
     * @param {CanvasRenderingContext2D} ctx - CSS px 좌표계(dpr 변환이 걸린) 캔버스
     * @param {Float32Array} values
     * @param {number} imgW
     * @param {number} imgH
     * @param {number} step
     * @param {string} layer - 'wind' | 'wave' (그 밖이면 아무것도 안 하고 [] 반환)
     * @returns {Array} contourSegments 결과
     * [연계] ← ocean_overlay.js renderGridToOffscreen — 육지 펀치아웃(applyLandMask) **전에** 불려야
     *          육지 위 선이 함께 지워진다.
     */
    function drawContourLines(ctx, values, imgW, imgH, step, layer) {
        var th = CONTOUR_THRESHOLDS[layer];
        if (!th) return [];
        var segs = contourSegments(values, imgW, imgH, step, th);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (var i = 0; i < segs.length; i++) {
            ctx.moveTo(segs[i].x0, segs[i].y0);
            ctx.lineTo(segs[i].x1, segs[i].y1);
        }
        ctx.stroke();
        ctx.restore();
        return segs;
    }

    /** 둥근 사각형 경로를 만든다. 예: _rr(ctx,0,0,40,18,9) — roundRect 가 없는 옛 브라우저는 사각형. */
    function _rr(c, x, y, w, h, r) {
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    }

    /**
     * 라벨 상자가 화면 여백 안쪽이고, 버튼(o.avoid)과 안 겹치고, 중심과 좌우 14px 이 바다인가.
     * 예: _okSpot(100, 200, [60,188,140,212], o) → true
     * @param {number[]} box - 라벨이 차지하는 [x0, y0, x1, y1]
     * @param {{w:number,h:number,isSea:function,avoid:(number[][]|undefined)}} o
     */
    function _okSpot(x, y, box, o) {
        if (box[0] < MARGIN.left || box[2] > o.w - MARGIN.right) return false;
        if (box[1] < MARGIN.top || box[3] > o.h - MARGIN.bottom) return false;
        var av = o.avoid || [];
        for (var i = 0; i < av.length; i++) {
            if (box[0] < av[i][2] && box[2] > av[i][0] && box[1] < av[i][3] && box[3] > av[i][1]) return false;
        }
        return o.isSea(x, y) && o.isSea(x - 14, y) && o.isSea(x + 14, y);
    }

    /**
     * 등치선 위에 값 라벨(어두운 알약 + 흰 글자)을 선 방향을 따라 눕혀 얹는다.
     * 예: drawContourLabels(labelCtx, segs, {layer:'wind', useKts:false, w, h, isSea}) → 놓은 라벨 수
     * @param {CanvasRenderingContext2D} ctx - 라벨 전용 캔버스(CSS px 좌표계)
     * @param {Array} segs - drawContourLines 가 돌려준 조각
     * @param {{layer:string,useKts:boolean,w:number,h:number,isSea:function(number,number):boolean,avoid:number[][]}} o
     *   - avoid: 피할 화면 사각형 [x0,y0,x1,y1] 목록 (검색창·지도 버튼)
     * @returns {number} 놓은 라벨 수
     * [연계] ← ocean_overlay.js _renderLabels — 단위 전환 때는 선은 두고 이것만 다시 부른다.
     *          같은 선 위 170px·다른 라벨과 70px 떨어뜨려 겹치지 않게 한다.
     */
    function drawContourLabels(ctx, segs, o) {
        var placed = [];   // [x, y, th]
        ctx.save();
        ctx.font = '700 11.5px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            var x = (s.x0 + s.x1) / 2, y = (s.y0 + s.y1) / 2;
            var text = contourLabelText(o.layer, s.th, o.useKts);
            var tw = ctx.measureText(text).width;
            var half = tw / 2 + 6;
            if (!_okSpot(x, y, [x - half, y - half, x + half, y + half], o)) continue;   // 눕혀도 들어가게 정사각형으로 본다
            var clash = false;
            for (var k = 0; k < placed.length; k++) {
                var dist = Math.hypot(placed[k][0] - x, placed[k][1] - y);
                if (dist < CONTOUR_ANY_GAP || (placed[k][2] === s.th && dist < CONTOUR_SAME_GAP)) { clash = true; break; }
            }
            if (clash) continue;
            var ang = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
            if (ang > Math.PI / 2) ang -= Math.PI;     // 글자가 거꾸로 서지 않게
            if (ang < -Math.PI / 2) ang += Math.PI;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            ctx.fillStyle = 'rgba(9,18,40,0.8)';
            _rr(ctx, -tw / 2 - 5, -9, tw + 10, 18, 9);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(text, 0, 0.5);
            ctx.restore();
            placed.push([x, y, s.th]);
        }
        ctx.restore();
        return placed.length;
    }

    /**
     * 흰 화살표를 검정 테두리로 그린다 (배경 색에 묻히지 않게 — 사용자 확정, 동그라미 없음).
     * 예: _arrow(ctx, 100, 100, 1.57, 8.5) → 화면 오른쪽(동쪽)을 가리키는 화살표
     * @param {number} rad - 화면 각(위=0, 시계방향, 라디안)
     */
    function _arrow(c, x, y, rad, size) {
        c.save();
        c.translate(x, y);
        c.rotate(rad);
        c.beginPath();
        c.moveTo(0, -size);
        c.lineTo(size * 0.62, size * 0.55);
        c.lineTo(0, size * 0.22);
        c.lineTo(-size * 0.62, size * 0.55);
        c.closePath();
        c.lineJoin = 'round';
        c.lineWidth = 3;
        c.strokeStyle = '#000';
        c.stroke();
        c.fillStyle = '#fff';
        c.fill();
        c.restore();
    }

    /**
     * 유향·유속 라벨(흰 화살표 + 값)을 일정 위경도 간격으로 깐다.
     * 예: drawCurrentLabels(labelCtx, {w,h, lonRange:[124,131], latRange:[33,36], pxPerDeg:150, …}) → 놓은 수
     * @param {CanvasRenderingContext2D} ctx - 라벨 전용 캔버스(CSS px 좌표계)
     * @param {{w:number,h:number,lonRange:number[],latRange:number[],pxPerDeg:number,useKts:boolean,
     *          toPixel:function(number,number):(number[]|null),
     *          sample:function(number,number):({crsp:number,crdir:number}|null),
     *          screenAngle:function(number,number,number):number,
     *          isSea:function(number,number):boolean, avoid:number[][]}} o
     *   - sample 은 (lon,lat) 의 유속(cm/s)·유향(흘러가는 쪽, 도)을 준다
     *   - screenAngle(lon,lat,deg) 는 그 방위를 화면 각(라디안)으로 바꾼다(지도 회전 반영)
     * @returns {number} 놓은 라벨 수
     * [연계] ← ocean_overlay.js _renderLabels — 격자는 0.25° 배수(소해구 중심과 같은 줄)에 맞춘다.
     */
    function drawCurrentLabels(ctx, o) {
        var step = pickGridStep(o.pxPerDeg, CURRENT_MIN_PX);
        var n0 = Math.ceil((o.lonRange[0] - 0.25) / step), n1 = Math.floor((o.lonRange[1] - 0.25) / step);
        var m0 = Math.ceil((o.latRange[0] - 0.25) / step), m1 = Math.floor((o.latRange[1] - 0.25) / step);
        var count = 0;
        ctx.save();
        ctx.font = '700 12.5px ' + FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (var n = n0; n <= n1; n++) {
            for (var m = m0; m <= m1; m++) {
                var lon = Math.round((0.25 + n * step) * 100) / 100;
                var lat = Math.round((0.25 + m * step) * 100) / 100;
                var px = o.toPixel(lon, lat);
                if (!px) continue;
                var s = o.sample(lon, lat);
                if (!s) continue;
                // 라벨 모양: [화살표(중심 px-18)] [값 글자(px-4 부터)]
                var text = currentLabelText(s.crsp, o.useKts);
                var tw = ctx.measureText(text).width;
                if (!_okSpot(px[0], px[1], [px[0] - 30, px[1] - 12, px[0] - 2 + tw, px[1] + 12], o)) continue;
                var ax = px[0] - 18, ay = px[1];
                _arrow(ctx, ax, ay + 1, o.screenAngle(lon, lat, s.crdir || 0), 8.5);
                ctx.lineWidth = 3.2;
                ctx.strokeStyle = 'rgba(8,18,40,0.78)';
                ctx.strokeText(text, ax + 14, ay + 0.5);
                ctx.fillStyle = '#fff';
                ctx.fillText(text, ax + 14, ay + 0.5);
                count++;
            }
        }
        ctx.restore();
        return count;
    }

    window.OceanOverlayLabels = {
        CONTOUR_THRESHOLDS: CONTOUR_THRESHOLDS,
        contourLabelText: contourLabelText,
        currentLabelText: currentLabelText,
        pickGridStep: pickGridStep,
        contourSegments: contourSegments,
        drawContourLines: drawContourLines,
        drawContourLabels: drawContourLabels,
        drawCurrentLabels: drawCurrentLabels
    };
})();
