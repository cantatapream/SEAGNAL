# 너울 (swell) — 해양생활 탭

해안선을 **소해구별 너울 위험등급 색**으로 칠해 보여주는 화면입니다.
바다 전체가 아니라 **해안선만** 칠합니다 — 너울은 먼바다보다 해안에 부딪힐 때 위험하기 때문입니다.

| 색 | 등급 |
|---|---|
| 초록 | 관심 |
| 연노랑 | 주의 |
| 주황 | 경계 |
| 빨강 | 위험 |
| 회색 | 그 구역의 예측값을 받지 못함 |

## 파일

| 파일 | 하는 일 |
|---|---|
| `swell.js` | 지도를 만들고, 해안선 조각에 등급 색을 입힌다. 진입 함수 `window.initSwellMap()` |

## 자료가 오는 길

```
기상청 GeoServer (WFS)
   └ mmis:marine_zone_swell — 소해구 3,381개의 등급·파고·파주기
        ↓  3시간 간격 19개 예보시각, 생산시각(baseTm) 바뀔 때만 수집
   local_server/services/swell_smallzone.js   (수집·캐시)
        ↓
   local_server/routes/swell_smallzone.js     GET /api/swell-smallzone?coast=1
        ↓  해안에 닿는 소해구 424개의 등급만
   swell.js  +  client/coastline_segments.json (해안선 조각 1,934개, 조각마다 소해구 번호)
        ↓
   해안선이 등급 색으로 칠해진 지도
```

`coastline_segments.json` 은 `local_server/scripts/build_coastline_segments.js` 로 만듭니다.
해안선(`client/land_mask_korea.json`)과 대해구 경계(`client/marine_zone_area.json`)에서
**변하지 않는 계산**(이 해안선 점은 몇 번 소해구인가)만 미리 해 둔 파일이라,
해안선이나 해구 정의가 바뀌지 않는 한 다시 만들 필요가 없습니다.

```bash
node local_server/scripts/build_coastline_segments.js
```

실측(2026-09-10): 해안선 점 19,984개 → 조각 1,934개 · 소해구 424개 · 388KB(gzip 112KB)

## 연계

- **마크업**: `client/index2.html` 의 `#swell-section` (`#swell-map`, `#swell-publish-time`,
  `#swell-my-location-btn`, `#swell-notice-btn`, `#swell-disclaimer`)
- **호출처**: `client/js/forecast/alerts/marine.js` 의 `_onSectionActivated('swell-section')`
- **스타일**: 새 CSS 를 만들지 않고 이안류 탭의 `.fishing-legend` · `.fishing-guide-*` 를 그대로 씁니다.

## 알아둘 것 (한계)

- 등급은 **해구(약 15×18.5km) 단위 예측값**입니다. 그 구역에 닿는 해안선에 같은 색을 입히므로,
  한 색 구간 안에서도 지형(만·곶·방파제)에 따라 실제 위험은 다를 수 있습니다.
- 예보시각을 지정하지 않으면 **지금 시각에 가장 가까운 예보**를 보여줍니다
  (`services/swell_smallzone.js` 의 `nearestFrame()`).
- 서버가 기상청에서 자료를 아직 못 받았으면 해안선이 전부 회색으로 보입니다.
  `GET /api/swell-smallzone/status` 로 수집 상태를 확인할 수 있습니다.

## 설계 배경

연안 위험도 전반의 설계는 `client/js/ocean-map/coastal-risk/coastal_risk.design.md` §6.4 참고.
