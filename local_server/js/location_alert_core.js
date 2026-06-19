/**
 * ============================================================================
 * location_alert_core.js — 위치 기반 해상특보 안전 경보: 순수 지오/문구 로직
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md
 *
 * 단말(브라우저/Capacitor)에서 도는 순수 계산 모듈. 외부 의존성·네트워크 없음.
 *  - 어느 특보구역 안인지 판정(섬 제외, GPS 오차 반경 반영)
 *  - 가장 가까운 무특보 구역(및 2단계일 때 '주의보·예비특보' 구역)까지 방위·거리
 *  - 직선 경로 상 육지·섬 가로막힘(개략) 판정
 *  - 상황별 푸시 제목/본문 문구 생성
 *
 * 좌표 규약: 내부적으로 [경도, 위도] (GeoJSON 표준). 사용자 위치는 {lat, lng} 허용.
 * 거리: 미터/해리(1해리=1852m). 방위: 진북 기준 0~360°(시계방향).
 *
 * Node(테스트)·브라우저 양쪽에서 사용: module.exports + window 전역.
 * ============================================================================
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.LocationAlertCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const NM_M = 1852;            // 1 해리(미터)
    const DEG2RAD = Math.PI / 180;
    const R_EARTH = 6371000;      // 지구 반경(m)

    // ── 좌표 헬퍼 ────────────────────────────────────────────────────────────
    /** 다양한 입력을 [lng, lat] 로 정규화. */
    function toLngLat(p) {
        if (Array.isArray(p)) return [p[0], p[1]];
        if (p && typeof p === 'object') return [p.lng != null ? p.lng : p.lon, p.lat];
        throw new Error('invalid point');
    }

    // ── 거리·방위 ────────────────────────────────────────────────────────────
    function haversineMeters(a, b) {
        const [lon1, lat1] = toLngLat(a), [lon2, lat2] = toLngLat(b);
        const dLat = (lat2 - lat1) * DEG2RAD, dLon = (lon2 - lon1) * DEG2RAD;
        const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
        return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
    }

    /** 진북 기준 초기 방위각(0~360°). */
    function bearingDeg(from, to) {
        const [lon1, lat1] = toLngLat(from), [lon2, lat2] = toLngLat(to);
        const φ1 = lat1 * DEG2RAD, φ2 = lat2 * DEG2RAD, Δλ = (lon2 - lon1) * DEG2RAD;
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        return (Math.atan2(y, x) / DEG2RAD + 360) % 360;
    }

    // ── 점-다각형 포함 판정 ───────────────────────────────────────────────────
    /** ray-casting: 점이 단일 링(폐곡선) 내부인지. ring = [[lng,lat],...] */
    function pointInRing(pt, ring) {
        const [x, y] = pt;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /** polygon = [exterior, hole1, ...]. 외곽 안 && 구멍 밖. */
    function pointInPolygon(pt, polygon) {
        if (!polygon || !polygon.length) return false;
        if (!pointInRing(pt, polygon[0])) return false;
        for (let h = 1; h < polygon.length; h++) {
            if (pointInRing(pt, polygon[h])) return false; // 구멍(섬) 안 → 제외
        }
        return true;
    }

    /** Polygon/MultiPolygon geometry 안에 점이 있는지(구멍 반영). */
    function pointInGeometry(pt, geom) {
        if (!geom) return false;
        if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
        if (geom.type === 'MultiPolygon')
            return geom.coordinates.some(poly => pointInPolygon(pt, poly));
        return false;
    }

    /** 섬 구멍이 반영된 geometry 선택: _holedGeometry 우선, 없으면 geometry. */
    function seaGeometry(feature) {
        const hg = feature.properties && feature.properties._holedGeometry;
        return hg || feature.geometry;
    }

    // ── 점-선분 최단거리(평면 근사; 위도 보정) ───────────────────────────────
    function _scale(lat) { return { kx: Math.cos(lat * DEG2RAD), ky: 1 }; }

    /** 점 pt 에서 선분 a-b 까지 최단점(근사)과 그 점. 반환 {point:[lng,lat]} */
    function closestPointOnSegment(pt, a, b) {
        const lat0 = pt[1];
        const { kx } = _scale(lat0);
        const px = pt[0] * kx, py = pt[1];
        const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return [cx / kx, cy]; // 다시 경도로 환원
    }

    /** geometry 외곽선들 위에서 pt 에 가장 가까운 점 + 미터거리. (구멍 무시: 진입은 외곽) */
    function nearestPointOnGeometry(pt, geom) {
        const p = toLngLat(pt);
        let best = null, bestD = Infinity;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
            const ext = poly[0];
            for (let i = 0; i < ext.length - 1; i++) {
                const c = closestPointOnSegment(p, ext[i], ext[i + 1]);
                const d = haversineMeters(p, c);
                if (d < bestD) { bestD = d; best = c; }
            }
        }
        return best ? { point: best, distM: bestD } : null;
    }

    // ── 구역 판정 ────────────────────────────────────────────────────────────
    /**
     * 현재 위치가 속한 특보구역 feature 를 찾음(섬 제외).
     * GPS 오차(accuracyM) 반영: 구역 안이지만 경계에서 오차 반경보다 가까우면 grayZone=true.
     * @returns {{feature, grayZone:boolean}|null}
     */
    function locateZone(pt, features, accuracyM) {
        const p = toLngLat(pt);
        for (const f of features) {
            const geom = seaGeometry(f);
            if (pointInGeometry(p, geom)) {
                const edge = nearestPointOnGeometry(p, f.geometry); // 외곽까지 거리
                const margin = (accuracyM || 0);
                const grayZone = edge ? (edge.distM < margin) : false;
                return { feature: f, grayZone };
            }
        }
        return null; // 어느 바다 구역에도 없음(육지/외해)
    }

    // ── 최근접 대상 구역 ─────────────────────────────────────────────────────
    /**
     * predicate(true)인 구역들 중 pt 에서 가장 가까운 구역 + 방위/거리/경로 육지여부.
     * @param features 전체 구역
     * @param predicate (feature) => boolean   (예: 무특보 구역)
     * @returns {{name, bearing, distM, distNm, landOnPath}|null}
     */
    function nearestZoneBy(pt, features, predicate) {
        const p = toLngLat(pt);
        let best = null;
        for (const f of features) {
            if (!predicate(f)) continue;
            const np = nearestPointOnGeometry(p, f.geometry);
            if (!np) continue;
            if (!best || np.distM < best.np.distM) best = { f, np };
        }
        if (!best) return null;
        return {
            name: best.f.properties.name,
            warnCode: best.f.properties.WarnCode,
            bearing: Math.round(bearingDeg(p, best.np.point)),
            distM: best.np.distM,
            distNm: best.np.distM / NM_M,
            landOnPath: segmentCrossesLand(p, best.np.point, features),
        };
    }

    /**
     * 직선 경로 p→q 가 육지·섬을 가로지르는지(개략).
     * 표본점이 '어느 바다 구역에도 속하지 않으면' 육지/섬으로 간주(섬=구멍, 본토=구역밖).
     * 한계: 구역 사이 외해 공백은 오탐 가능, 약 200m 미만 암초는 미탐(설계 문서에 명시).
     */
    function segmentCrossesLand(p, q, features, samples) {
        const N = samples || 24;
        const a = toLngLat(p), b = toLngLat(q);
        // 끝단 부근(자기 구역 경계)은 제외하고 중간 구간만 검사
        for (let i = 3; i <= N - 3; i++) {
            const t = i / N;
            const s = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const inSea = features.some(f => pointInGeometry(s, seaGeometry(f)));
            if (!inSea) return true;
        }
        return false;
    }

    // ── 특보 등급 분류 ───────────────────────────────────────────────────────
    // tier: 'severe'(경보·태풍주의보·태풍경보=전면금지) | 'advisory'(풍랑주의보=조건부)
    //       | 'prelim'(예비특보) | 'none'(무특보)
    /**
     * @param warnings 해당 구역의 현재 특보 배열. 각 항목 {type:'풍랑'|'태풍'..., level:'예비'|'주의보'|'경보'}
     * @returns 'severe'|'advisory'|'prelim'|'none'
     */
    function classifyTier(warnings) {
        if (!warnings || !warnings.length) return 'none';
        let tier = 'none';
        const rank = { none: 0, prelim: 1, advisory: 2, severe: 3 };
        for (const w of warnings) {
            let t = 'none';
            if (w.level === '예비') t = 'prelim';
            else if (w.type === '태풍') t = 'severe';            // 태풍주의보·경보 = 전면금지
            else if (w.level === '경보') t = 'severe';           // 풍랑경보 등 = 전면금지
            else if (w.level === '주의보') t = 'advisory';       // 풍랑주의보 = 조건부
            if (rank[t] > rank[tier]) tier = t;
        }
        return tier;
    }

    // ── 문구 생성 ────────────────────────────────────────────────────────────
    function fmtNm(nm) {
        return nm < 10 ? `${nm.toFixed(1)}해리` : `${Math.round(nm)}해리`;
    }
    function targetLine(label, t) {
        return `🧭 ${label} : ${t.name} ${t.bearing}° - ${fmtNm(t.distNm)}`;
    }
    function footer(targets) {
        const land = targets.some(t => t && t.landOnPath);
        return land
            ? '⚠️ 경로상 육지·섬이 있으니 항행 장애물에 유의하여 항행하세요.'
            : '🌊 항행 안전에 유의하여 항행하세요.';
    }

    /**
     * 상황별 푸시 {title, body} 생성.
     * @param ctx {
     *   zoneName, warnType('풍랑'|'태풍'...), tier('prelim'|'advisory'|'severe'),
     *   event('publish'(발효예정)|'active'(발효중)),
     *   timeText(발효 예정시각 문자열; 예비/발효예정에 사용),
     *   nearestClear(무특보 대상 또는 null), nearestLower(주의보·예비특보 대상 또는 null)
     * }
     */
    // 예측 기상 줄: { day, summary } → "🌬️ 20일 예측 기상 : ..." (없으면 '')
    function forecastLine(fc) {
        return (fc && fc.summary)
            ? ('🌬️ ' + (fc.day != null ? fc.day + '일 ' : '') + '예측 기상 : ' + fc.summary)
            : '';
    }

    function buildMessage(ctx) {
        const z = ctx.zoneName, wt = ctx.warnType || '풍랑';
        const fcLine = forecastLine(ctx.forecast);

        if (ctx.tier === 'prelim') {
            const lines = [
                `현재 위치하신 해역에 ${wt} 예비특보가 발표되었습니다.`,
                `🕒 발효 예정시각 : ${ctx.timeText || '미정'}`,
            ];
            if (fcLine) lines.push(fcLine);
            lines.push('');
            lines.push('현지 해상·기상 상황을 살피고 안전에 유의하세요.');
            return {
                title: `📍 [위치기반 안전정보] 현재 해역 ${wt} 예비특보 발표`,
                body: lines.join('\n'),
            };
        }

        if (ctx.tier === 'advisory') {
            const verbTitle = ctx.event === 'active' ? '발효' : '발효 예정';
            const sent = ctx.event === 'active'
                ? `위치하신 해역에 ${wt}주의보가 발효 중입니다.`
                : `위치하신 해역에 ${wt}주의보가 ${ctx.timeText || ''} 발효 예정입니다.`;
            const lines = [sent];
            if (fcLine) lines.push(fcLine);
            if (ctx.nearestClear) lines.push(targetLine('최근접 특보 미발표 해역', ctx.nearestClear));
            lines.push('');
            lines.push('발효 시 선박 톤수·운항 시기, 수상레저 종사 여부 등에 따라 조업·활동이 제한될 수 있으니 안전한 해역으로 이동을 고려하세요.');
            lines.push('');
            lines.push(footer([ctx.nearestClear]));
            return { title: `📍 [위치기반 안전정보] 현재 해역 ${wt}주의보 ${verbTitle}`, body: lines.join('\n') };
        }

        // severe (경보·태풍)
        const verbTitle = ctx.event === 'active' ? '발효' : '발표';
        const lines = [];
        if (ctx.event === 'active') {
            lines.push('현재 위치하신 해역은 조업 및 해상활동이 전면 제한되는 구역입니다.');
            lines.push('즉시 안전한 해역·항포구로 이동하세요.');
        } else {
            lines.push(`현재 위치하신 해역에 ${wt}경보가 ${ctx.timeText || ''} 발효 예정입니다.`);
            lines.push('해당 해역에서 조업 및 해상활동이 전면 제한되므로 사전에 안전한 해역·항포구로 이동하세요.');
        }
        if (fcLine) lines.push(fcLine);
        if (ctx.nearestClear) lines.push(targetLine('최근접 특보 미발표 해역', ctx.nearestClear));
        // 두 목표가 다른 구역일 때만 '주의보·예비특보 해역' 줄 추가 (구역명 기준 — runtime 예측자와 일관)
        if (ctx.nearestLower && (!ctx.nearestClear || ctx.nearestLower.name !== ctx.nearestClear.name)) {
            lines.push(targetLine('최근접 주의보·예비특보 해역', ctx.nearestLower));
        }
        lines.push(footer([ctx.nearestClear, ctx.nearestLower]));
        return { title: `📍 [위치기반 긴급경보🚨] 현재 해역 ${wt}경보 ${verbTitle}`, body: lines.join('\n') };
    }

    return {
        NM_M, haversineMeters, bearingDeg,
        pointInRing, pointInPolygon, pointInGeometry, seaGeometry,
        closestPointOnSegment, nearestPointOnGeometry,
        locateZone, nearestZoneBy, segmentCrossesLand,
        classifyTier, fmtNm, buildMessage,
    };
});
