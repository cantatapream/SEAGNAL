/**
 * ============================================================================
 * advisory/predictionConfig.js — 특보 예측 운영 설정 (Phase 0: 검증값 베이킹)
 * ============================================================================
 *
 * 분석/검증(local_server/analysis/wave_leadtime)에서 확정된 상수를 운영용으로 고정한다.
 * 예측 엔진(Phase 1)·억제(Phase 2)·UI(Phase 5)가 이 한 파일을 단일 출처로 참조한다.
 *
 * [검증 근거] reports/00_SYSTEM_DESIGN_AND_VALIDATION.md
 *   - 홀드아웃(2026): 재현율 89% · 정밀도 78% · 확률 잘 보정됨
 *   - per-zone 거짓경보 3~7%
 * ============================================================================
 */
'use strict';

// ----------------------------------------------------------------------------
// 1) 청별 위경도↔픽셀 보정 (geoCalib.CALIB 6청, 검증 완료)
//    xOf(lon)=xRefPx+(lon-xRefDeg)*lonPxPerDeg ; yOf(lat)=yRefPx-(lat-yRefDeg)*latPxPerDeg
// ----------------------------------------------------------------------------
const CALIB = {
    jeju: { xRefDeg: 123, xRefPx: 1, lonPxPerDeg: 121.17, yRefDeg: 35.5, yRefPx: 29, latPxPerDeg: 121.33, frame: { x0: 2, x1: 727, y0: 30, y1: 574 } },
    busn: { xRefDeg: 127, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 37, yRefPx: 29, latPxPerDeg: 155.71, frame: { x0: 2, x1: 727, y0: 30, y1: 573 } },
    gwju: { xRefDeg: 124, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 36.5, yRefPx: 29, latPxPerDeg: 129.71, frame: { x0: 2, x1: 727, y0: 30, y1: 482 } },
    gawn: { xRefDeg: 127.5, xRefPx: 1, lonPxPerDeg: 145.4, yRefDeg: 40, yRefPx: 28, latPxPerDeg: 132.29, frame: { x0: 2, x1: 727, y0: 29, y1: 490 } },
    dajn: { xRefDeg: 123, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 39, yRefPx: 29, latPxPerDeg: 182.0, frame: { x0: 2, x1: 727, y0: 30, y1: 574 } },
};

// 청(CSV 지역) → 분석 차트 청코드. degu(대구·경북)는 전용 차트가 빈 APPM이라 gawn 차트 사용.
const OFFICE_CHART = { jeju: 'jeju', busn: 'busn', gwju: 'gwju', gawn: 'gawn', dajn: 'dajn', degu: 'gawn' };

// 청 메타 — CSV 지역명 + 차트 prefix (파고/풍속). KIM 국지 CoWW3.
const OFFICES = {
    jeju: { csvRegion: '제주도',              wavePrefix: 'kim_cww3_jeju_wave_', windPrefix: 'kim_cww3_jeju_wind_', model: 'KIMA' },
    busn: { csvRegion: '부산·울산·경상남도',  wavePrefix: 'kim_cww3_busn_wave_', windPrefix: 'kim_cww3_busn_wind_', model: 'KIMA' },
    gwju: { csvRegion: '광주·전라남도',        wavePrefix: 'kim_cww3_gwju_wave_', windPrefix: 'kim_cww3_gwju_wind_', model: 'KIMA' },
    gawn: { csvRegion: '강원특별자치도',        wavePrefix: 'kim_cww3_gawn_wave_', windPrefix: 'kim_cww3_gawn_wind_', model: 'KIMA' },
    dajn: { csvRegion: '대전·세종·충청남도',  wavePrefix: 'kim_cww3_dajn_wave_', windPrefix: 'kim_cww3_dajn_wind_', model: 'KIMA' },
    degu: { csvRegion: '대구·경상북도',        wavePrefix: 'kim_cww3_gawn_wave_', windPrefix: 'kim_cww3_gawn_wind_', model: 'KIMA' }, // gawn 차트
};

// ----------------------------------------------------------------------------
// 2) 임계 / 등급
// ----------------------------------------------------------------------------
const THRESHOLDS = {
    WIND_KT: 20,        // 풍속 주의보 신호컷(kt). 14m/s≈27kt가 25kt밴드, 검증상 20kt가 무손실 최적
    WAVE_M: 3.0,        // 파고 주의보 신호컷(m)
    WIND_ALARM_KT: 40,  // 경보급
    WAVE_ALARM_M: 5.0,
    RAD_MULT: 1.8,      // 구역 샘플 반경 배수 (H 먼바다 55px·I 앞바다 30px × 1.8)
    MIN_BAND_PIXELS: 12,// 구역 maxBand 인정 최소 픽셀
    LEAD_MAX_H: 96,     // 예보지평 실질 한계(4일). 120h는 빈값
    ONSET_GRACE_H: 6,   // 예상시각 경과 후 해소 유예
    RESOLVED_KEEP_H: 24,// '최근 해소' 유지 기간
};

const GRADES = {
    HIGH: { min: 0.80, key: 'high', label: '높음', emoji: '🔴' },   // 정밀도 ~99%
    WATCH: { min: 0.50, key: 'watch', label: '관심', emoji: '🟡' }, // 가능성
    // <0.50 → 미표시
};
function gradeOf(prob) { if (prob >= GRADES.HIGH.min) return GRADES.HIGH; if (prob >= GRADES.WATCH.min) return GRADES.WATCH; return null; }

// ----------------------------------------------------------------------------
// 3) 확률 보정표 (풍속 최대밴드 kt → 발효확률)
//    probCalib(홀드아웃) 원자료를 단조(monotonic) 보정. <20kt는 신호컷 미만이라 비표출 영역.
//    원자료 노이즈(<15kt 61%·35kt 55%, 소표본) 제거하고 추세에 맞춰 단조화.
// ----------------------------------------------------------------------------
const WIND_PROB_TABLE = [ // [kt 하한, 발효확률]
    [0, 0.05], [15, 0.10], [20, 0.40], [25, 0.63], [30, 0.80], [35, 0.88], [40, 0.96],
];
function windProb(bandKt) {
    let p = 0.05;
    for (const [kt, prob] of WIND_PROB_TABLE) if (bandKt >= kt) p = prob;
    return p;
}
// 파고 보정(보조 신호 — 풍속과 겹쳐 추가효과 작음). 보수적 단조표.
const WAVE_PROB_TABLE = [[0, 0.05], [2.5, 0.20], [3.0, 0.55], [3.5, 0.70], [4.5, 0.85], [5.0, 0.95]];
function waveProb(bandM) { let p = 0.05; for (const [m, prob] of WAVE_PROB_TABLE) if (bandM >= m) p = prob; return p; }

// 결합 확률 (파고 OR 풍속 — 둘 중 높은 쪽 채택; 독립 가정의 단순 max)
function combinedProb(windKt, waveM) { return Math.max(windProb(windKt || 0), waveProb(waveM || 0)); }

module.exports = {
    CALIB, OFFICE_CHART, OFFICES, THRESHOLDS, GRADES,
    gradeOf, windProb, waveProb, combinedProb,
    WIND_PROB_TABLE, WAVE_PROB_TABLE,
};
