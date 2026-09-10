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
        ↓  해안에 닿는 소해구 233개의 등급만
   swell.js  +  client/coastline_segments.json (해안선 조각 1,123개, 조각마다 소해구 번호)
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

### ⚠ 우리나라 해안만 남긴다

`land_mask_korea.json` 은 이름과 달리 **잘라낸 상자 안의 모든 육지**를 담고 있습니다 —
일본 규슈·고토열도, 중국 산둥, 북한 해안이 함께 들어 있습니다. 기상청 너울 모델이
일본 앞바다까지 덮고 있어서, 이대로 두면 **일본 해안선에도 색이 칠해집니다.**
(2026-09-10 실서비스 배포 직후 실제로 그렇게 나온 것을 확인하고 고쳤습니다.)

그래서 **국립해양조사원 전자해도 해안선**(`local_server/data/tide_field/coastline_cells.json`,
우리나라 것만 담고 있음)에서 **5km 이내인 조각만** 남깁니다. 이 자료가 못 담는
울릉도·독도는 좌표 상자로 따로 살립니다(`EXTRA_KEEP_BOXES`).

실측(2026-09-10):

| 항목 | 값 |
|---|---|
| 해안선 점 | 19,984개(격자 밖 10개 제외) |
| 걸러낸 조각 (일본·중국·북한) | 811개 |
| 남은 조각 | **1,123개** · 소해구 **233개** |
| 파일 크기 | 218KB (gzip 약 63KB) |
| 실서비스 등급 보유 소해구 | 223 / 233 (95.7%) → 회색으로 보이는 조각 1.3% |

남은 것이 우리 해안이 맞는지 표본 확인: 부산 239점 · 여수 580점 · 인천 444점 ·
제주 397점 · 목포·신안 1,913점 · 울릉도 59점 · 백령도·대청도·연평도 · 흑산도·가거도.
걸러진 것: 일본 규슈 0점 · 고토열도 0점 · 쓰시마 0점(전부 제거됨).

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
