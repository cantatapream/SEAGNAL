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
// 2) 임계 / 등급 — 폴리곤+면적 (CALIB_ABS / BEATKMA 검증 반영, 2026-06)
//    · 면적비율 = 구역 내부 바다픽셀 중 ge3(≥GE3_KT)인 비율. 옛 "원형 반경+12픽셀
//      스침"을 폐지하고 "구역이 충분히 덮였을 때만" 표출 → 이웃 번짐 과탐 차단.
//    · 운영점/등급은 어려운음성(이웃발효·자기미발효) 포함 현실가중 정밀도 기준.
// ----------------------------------------------------------------------------
const THRESHOLDS = {
    GE3_KT: 20,         // 면적비율 산정 기준(이 풍속 이상 픽셀을 '거침'으로 카운트)
    WIND_ONSET_KT: 25,  // onset/표출 풍속 밴드컷(이 값 이상 + 면적게이트 통과 시 onset)
    WIND_AREA_MIN: 0.30,// 표출 최소 면적비율(풍속). 미만은 비표출
    WAVE_M: 3.0,        // 파고 주의보 신호컷(m)
    WAVE_AREA_MIN: 0.30,
    WIND_ALARM_KT: 40,  // 경보급(ge5)
    WAVE_ALARM_M: 5.0,
    MIN_BAND_PIXELS: 12,// 구역 maxBand 인정 최소 픽셀
    LEAD_MAX_H: 96,     // 예보지평 실질 한계(4일). 120h는 빈값
    ONSET_GRACE_H: 6,   // 예상시각 경과 후 해소 유예
    RESOLVED_KEEP_H: 24,// '최근 해소' 유지 기간
    // 2사이클 지속성: 직전 사이클에도 잡힌 구역만 표출(노이즈성 1회 신호 억제).
    PERSIST_ENABLED: true,
    PERSIST_MAX_AGE_H: 18, // 직전 상태가 이 시간 내일 때만 '연속'으로 인정
};

// 2단계 등급 — (밴드, 면적). probPct = 현실가중 정밀도(경보 1건당 실제 발효 확률).
//   높음: 강풍(≥30kt) & 넓은면적(≥50%)  → 정밀 ~64%
//   관심: 풍속(≥25kt&면적≥30%) 또는 파고(≥3m&면적≥30%) → 정밀 ~51%
const GRADES = {
    HIGH: { key: 'high', label: '높음', emoji: '🔴', probPct: 64 },
    WATCH: { key: 'watch', label: '관심', emoji: '🟡', probPct: 51 },
};
function gradeOf2(sig) {
    const windKt = sig.windKt || 0, windArea = sig.windArea || 0;
    const waveM = sig.waveM || 0, waveArea = sig.waveArea || 0;
    if (windKt >= 30 && windArea >= 0.50) return GRADES.HIGH;
    if ((windKt >= 25 && windArea >= 0.30) || (waveM >= 3.0 && waveArea >= 0.30)) return GRADES.WATCH;
    return null;
}

module.exports = {
    CALIB, OFFICE_CHART, OFFICES, THRESHOLDS, GRADES,
    gradeOf2,
};
