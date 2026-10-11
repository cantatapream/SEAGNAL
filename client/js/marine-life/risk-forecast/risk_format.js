/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_format.js
 * 역할  : 서버가 계산한 점수·배수를 글자와 표시색으로 바꾼다. 점수 판정은 하지 않는다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] ocean_map.js 다음 · risk_api.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    var RGB = [[47,179,107],[242,194,48],[251,146,60],[224,50,44]];
    /**
     * 상대 배수를 배 또는 증감률 문장으로 표시한다.
     * 예: fmt(1.54) → +54%
     * @param {number} rr - 서버 상대 배수
     * @returns {string} 배수 문구
     * [연계] RiskSheet → 화면 문장
     */
    function fmt(rr) {
        if (!Number.isFinite(rr)) return '자료 없음';
        if (rr >= 2) return '약 ' + (rr >= 10 ? Math.round(rr) : Math.round(rr * 10) / 10) + '배';
        var p = Math.round((rr - 1) * 100);
        return (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + '%';
    }
    /**
     * 상대 배수의 방향을 빼고 변화량을 표시한다.
     * 예: amt(.58) → 42%
     * @param {number} rr - 서버 상대 배수
     * @returns {string} 방향 없는 변화량
     * [연계] RiskSheet → 비교 문장
     */
    function amt(rr) { return rr >= 2 ? fmt(rr) : Math.round(Math.abs(rr - 1) * 100) + '%'; }
    /**
     * 배수에 해당하는 문장 강조색 클래스를 선택한다.
     * 예: tone(4) → o
     * @param {number} rr - 서버 상대 배수
     * @returns {string} g·y·o·r
     * [연계] RiskSheet → CSS 강조색
     */
    function tone(rr) { return rr < 1.5 ? 'g' : rr < 4 ? 'y' : rr < 8 ? 'o' : 'r'; }
    /**
     * 서버 점수를 확정된 색 기준 사이에서 보간한다.
     * 예: col(2) → 주황 RGB
     * @param {number|null} s - 서버 점수, 점수 재계산 없음
     * @returns {string} RGB 표시색
     * [연계] RiskMapLayer·RiskSheet → 색
     */
    function col(s) {
        if (!Number.isFinite(s)) return 'rgb(120,130,145)';
        s = Math.max(0, Math.min(3, s));
        var stops = [0, Math.log2(1.5), 2, 3];
        for (var i = 1; i < stops.length; i++) if (s <= stops[i]) {
            var t = (s - stops[i-1]) / (stops[i] - stops[i-1]);
            return 'rgb(' + RGB[i-1].map(function (v, j) { return Math.round(v + (RGB[i][j] - v) * t); }).join(',') + ')';
        }
    }
    /**
     * sRGB를 WCAG 상대 휘도로 바꾼다.
     * 예: luminance([255,255,255]) → 1
     * @param {number[]} rgb - 0~255 R·G·B
     * @returns {number} 상대 휘도
     * [연계] ink·서식 시험 → 명암비
     */
    function luminance(rgb) {
        var c = rgb.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
    }
    /**
     * 배경과 명암비 4.5 이상인 숫자 글자색을 선택한다.
     * 예: ink(col(2)) → 어두운 글자색
     * @param {string} bg - rgb(r,g,b) 배경
     * @returns {string} 흰색·짙은색·검정색
     * [연계] RiskSheet → 위험지수 상자
     */
    function ink(bg) {
        var l = luminance((bg.match(/[\d.]+/g) || [0,0,0]).slice(0,3).map(Number));
        var white=1.05/(l+0.05),dark=(l+0.05)/(luminance([16,21,31])+0.05);
        return Math.max(white,dark)<4.5?'#000000':white>dark?'#ffffff':'#10151f';
    }
    /**
     * API 문자열을 HTML 본문과 속성에 안전하게 넣는다.
     * 예: escape('<b>') → &lt;b&gt;
     * @param {unknown} v - API 문자열 또는 숫자
     * @returns {string} 이스케이프 문자열
     * [연계] RiskSheet → HTML 템플릿
     */
    function escape(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    /**
     * 행사 출처의 HTTP·HTTPS 링크만 허용한다.
     * 예: safeURL('javascript:x') → 빈 문자열
     * @param {unknown} v - 출처 URL
     * @returns {string} 허용 URL 또는 빈 문자열
     * [연계] RiskSheet → 행사 링크
     */
    function safeURL(v) {
        try { var u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; }
    }
    /**
     * 좌표를 정수 초 DMS로 표시하며 초 올림을 처리한다.
     * 예: dms(35.5,true) → 35°30′00″N
     * @param {number} v - 위경도; lat가 true이면 위도
     * @returns {string} DMS 좌표
     * [연계] RiskSheet → 지점 위치
     */
    function dms(v, lat) {
        if (!Number.isFinite(v)) return '좌표 없음';
        var secs = Math.round(Math.abs(v) * 3600), d = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
        return d + '°' + String(m).padStart(2,'0') + '′' + String(s).padStart(2,'0') + '″' + (lat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E'));
    }
    /**
     * 서버 ISO 시각을 한국 시간의 날짜·요일·시각으로 표시한다.
     * 예: time('2026-10-09T15:00:00Z') → 10월10일 00:00
     * @param {string} v - ISO 시각
     * @returns {string} KST 시각 문구
     * [연계] RiskSlider → 말풍선
     */
    function time(v) {
        var d = new Date(v), k = new Date(d.getTime() + 9*3600000);
        if (!Number.isFinite(k.getTime())) return '';
        return "'" + String(k.getUTCFullYear()).slice(-2) + '. ' + (k.getUTCMonth()+1) + '. ' + k.getUTCDate() + '.(' + ['일','월','화','수','목','금','토'][k.getUTCDay()] + ') ' + String(k.getUTCHours()).padStart(2,'0') + ':' + String(k.getUTCMinutes()).padStart(2,'0');
    }
    /**
     * 방위각을 가장 가까운 16방위 한국어로 표시한다.
     * 예: direction(45) → 북동
     * @param {number} deg - 방위각(도)
     * @returns {string} 16방위 명칭
     * [연계] RiskSheet → 해구 부제목
     */
    function direction(deg) { return ['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'][Math.round(((deg%360)+360)%360 / 22.5) % 16]; }
    w.RiskFormat = {fmt:fmt, amt:amt, tone:tone, col:col, ink:ink, escape:escape, safeURL:safeURL, dms:dms, time:time, direction:direction, luminance:luminance};
})(window);
