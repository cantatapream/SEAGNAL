/**
 * ============================================================================
 * windPalette.js — 해상풍(풍속) 차트 색상 → 풍속(knots) 분류
 * ============================================================================
 *
 * 해상풍 차트(kim_cww3_<office>_wind_ / kim_rww3_wind_ft03_pa4_)는 풍속을 5kt 간격
 * 이산 색상 음영으로 표시하고 그 위에 풍향 바람깃을 오버레이한다. (조사 에이전트 확인)
 * 범례 단위 knots, 눈금 0~50kt.
 *
 * 풍랑특보 풍속 기준:
 *   - 주의보: 풍속 ≥ 14m/s (≈27.2kt) — 5kt 양자화상 25~30kt 밴드에 걸침
 *   - 경보  : 풍속 ≥ 21m/s (≈40.8kt) — 40~45kt 밴드
 * 색 해상도 ±5kt(±2.6m/s) 한계가 있으므로 임계는 밴드 단위로 본다(WARN_KT/ALARM_KT).
 *
 * 무채색(바람깃·격자·해안선)·육지(크림)는 wave palette 와 동일하게 제외.
 * ============================================================================
 */
'use strict';

const { isGray, isLand } = require('./palette');

// [kt하한, R, G, B] — 범례 실측(조사 에이전트). m/s = kt*0.514444
const WIND_ANCHORS = [
    [0, 217, 242, 255],
    [5, 179, 229, 255],
    [10, 204, 255, 204],
    [15, 153, 255, 153],
    [20, 255, 255, 153],
    [25, 242, 242, 102],   // 25~30kt — 14m/s(27kt) 가 이 밴드
    [30, 255, 204, 76],
    [35, 255, 127, 76],
    [40, 242, 76, 54],     // 40~45kt — 21m/s(41kt) 가 이 밴드
    [45, 204, 25, 25],
];

// 임계(knots): 주의보=25kt 밴드부터(≥14m/s 포착 민감), 경보=40kt 밴드.
const WARN_KT = 25;
const ALARM_KT = 40;

/** 픽셀 → 풍속 등급(kt 하한). 분류 대상 아니면 null. */
function classify(r, g, b) {
    if (isLand(r, g, b)) return null;
    if (isGray(r, g, b)) return null;
    let best = null, bestD = Infinity;
    for (const [kt, ar, ag, ab] of WIND_ANCHORS) {
        const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
        if (d < bestD) { bestD = d; best = kt; }
    }
    if (bestD > 9000) return null;
    return best;
}

module.exports = { classify, WIND_ANCHORS, WARN_KT, ALARM_KT, ktToMs: (kt) => +(kt * 0.514444).toFixed(1) };
