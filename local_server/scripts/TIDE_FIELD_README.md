# 물빠짐(갯벌 노출) 예측 시스템 — 운영 가이드

서해·남해 시간별 물빠짐(갯벌 노출) 예측 파이프라인. 4단계로 구성된다.

## 파일 구성
- `services/tide_field_common.js` — 공용 상수·유틸 (해역 게이팅, 표준항, Z₀ 모델, 설정). **단일 소스**.
- `scripts/build_tide_field.js` — Phase 0 오프라인 전처리 (격자/연결성/앵커/Z₀ 산출).
- `services/tide_field_collector.js` — Phase 1 앵커 곡선 배치 수집기 (scheduler 가 호출).
- `routes/tide_field.js` — Phase 2 예측 엔진 API.
- `js/tide_field.js` — Phase 3 프론트 "물빠짐" 레이어.

## 물리 모델
- KHOA 조위 η: 약최저저조면(chart datum) 기준, +cm.
- BADA2024 수심 d: 평균해수면(MSL) 기준, +m.
- Z₀(평균해면고) ≈ 표준항 연간 조석표 MTL(고+저조 평균).
- 물깊이(t) = d + η(t) − Z₀ (m). 드러남 조건: η < Z₀ − d.

## 운영 실행 순서 (Fly.io 볼륨, BADA 파일 존재 환경)

1. **전처리 (1회 또는 BADA/조석표 갱신 시)**
   ```
   cd local_server
   node scripts/build_tide_field.js
   # 또는: npm run build-tide-field
   ```
   환경변수:
   - `TIDE_FIELD_YEAR=2026` — Z₀ 산출 조석표 연도 (기본: 올해 KST).
   - `TIDE_FIELD_DRYRUN=1` — BADA 미존재 시 합성 격자로 로직 검증 (수심 null).

   산출물:
   - `data/tide_field/grid_meta.json` — 셀(lon,lat,depth,z0,comp) + 메타.
   - `data/tide_field/anchors.json` — 수집 대상 앵커 리스트.

   > BADA 파일(`data/bathymetry/`)이 없으면 가짜 수심을 만들지 않고 빈 메타
   > (`meta.empty=true, reason=no_bathymetry`)를 남긴 뒤 종료한다(크래시 아님).
   > 이 경우 `/api/tide-field*` 는 503(준비중)을 반환한다.

2. **배치 수집** — scheduler 가 **KST 23:30 1일 1회** 자동 실행.
   - 오늘~+2일(KST) 앵커 1분 조위곡선을 동시성 풀(앵커 5개씩)로 수집.
   - 롤링 윈도우: 없거나 부분수집(loadedPages<5/failedPages)분만 재호출.
   - 저장: `data/tide_field/curves/{anchorId}_{YYYYMMDD}.json` (curves/ 는 .gitignore).
   - 수동 트리거(운영, 소량 권장):
     ```
     node -e "require('./services/tide_field_collector').collectTideField({limitAnchors:3}).then(console.log)"
     ```

3. **API 확인**
   ```
   curl 'http://localhost:3001/api/tide-field/meta'
   curl 'http://localhost:3001/api/tide-field?time=2026-06-09T03:00:00Z'
   ```

4. **프론트** — 해양종합정보 지도 우측 "물빠짐" 버튼 ON → 2색 레이어 + 시간 슬라이더.

## 주의
- 개발 중 대규모 라이브 수집 금지(쿼터/네트워크). `limitAnchors` 로 소량 검증.
- TideBED API 키는 `services/tide_collector.js` 가 관리(3키 라운드로빈). 노출 금지.

## 확장 — 간출암 잠김경고 (hazard_rocks)

해양안전 지도의 간출암 마커에 "3시간 이내 잠김" 경고(빨간 펄스 테두리 + 카운트다운)를
띄우는 기능. 이 물빠짐 파이프라인을 그대로 재사용/확장한다.

- **서해·남해**: 위 앵커 곡선(`data/tide_field/curves/`)을 그대로 재사용 — 신규 수집 없음.
- **제주**: 물빠짐이 애초에 대상 해역에서 제외(BADA 갯벌 셀 기반이라 제주와 무관)하므로,
  전용 앵커(제주 간출암 위치 기준 0.1° 버킷, 17개)를 별도로 두고 수집한다.
  - `scripts/build_hazard_rock_anchors.js` — 전처리. 산출물 `data/hazard_rocks/anchors.json`.
  - `services/hazard_rocks_tide_collector.js` — 배치 수집. `data/hazard_rocks/curves/`.
    TideBED 키를 물빠짐과 공유하므로 **동시 발사 금지** — scheduler 가 물빠짐 수집이
    끝난 직후 이어서(순차) 호출한다(같은 KST 23:30 슬롯).
- **동해**(위도≥36·경도≥128): TideBED 자체가 이 해역을 제공하지 않는다(사용자 확인,
  2026-08-01). `client/tide_data/tide_data_{year}.js`(연간 조석표, 표준항 만조/간조
  극값)를 표준항 IDW 보간 후 반정현파(half-cosine)로 두 극값 사이를 근사해 교차시각을
  해석적으로 구한다 — 새 수집 없음(기존 정적 데이터 재사용).
- **잠김시각 계산**: `services/hazard_rocks_submersion.js` 의 `computeAllCrossings()` 가
  간출암마다 VALSOU(간출 높이)와 η(t)의 상향 교차(=잠김) 시각을 오늘~+2일 윈도우
  전체에서 찾아 `data/hazard_rocks/submersion.json` 에 저장한다. 무거운 연산(분단위×3일
  ×전체 암초)이라 scheduler 가 제주 앵커 수집 직후 1회만 호출한다.
- **API**: `GET /api/hazard-rocks/submersion` (`routes/hazard_rocks.js`) — 저장된 결과와
  "지금"을 빼는 가벼운 연산만. `{ warnings: { rockId: etaMin(분) } }`, 0<etaMin≤180만 포함.
- **프론트**: `client/js/marine-life/safety/hazard_rocks.js` 가 간출암 등 레이어가 켜져
  있는 동안 이 API 를 1분마다 폴링해, 낱개로 보이는(클러스터 안 뭉친) 간출암 마커에만
  경고를 얹는다.

## 확장 — 노출암 고립판정 (해안선 기반, 진행 중)

노출암(항상 마른 땅)이 물에 잠기는 게 아니라, 밀물에 **연결 경로(갯벌)가 잠겨 접근이
끊기는** "고립" 위험을 판정하는 별도 기능. 물빠짐 격자의 시간별 노출/침수 상태 위에서
해안선을 시작점으로 플러드필해, 그 시각에 노출암까지 마른 땅으로 이어지는지 본다.

- `scripts/build_coastline_cells.js` — 1회성 전처리. KHOA 전자해도
  `TL_COALNE_ARTIF`(인공해안선)·`TL_COALNE_NATURE`(자연해안선) shapefile(EPSG:5179)을
  물빠짐과 같은 `CELL_DEG`(0.0015°) 격자로 래스터화해 "항상 마른 땅" 시드 셀을 뽑는다.
  해안선은 약최고고조면 기준(밀물 최고조에도 안 잠기는 경계)이라 보정 없이 그대로 시드로
  쓸 수 있다. 산출물: `data/tide_field/coastline_cells.json`
  (`{generated_at, cell_deg, count, cells:["gx_gy",...]}`).
  실행: `node scripts/build_coastline_cells.js <인공해안선.shp> <자연해안선.shp>`
  (원본 shapefile은 용량 문제로 저장소에 포함하지 않음).
- `services/hazard_rocks_isolation.js` — 플러드필 알고리즘 본체(순수 함수, 데이터
  소스 비의존 — `isExposedFn(cellKey)` 콜백을 주입받아 그 시각 노출 상태를
  판단하므로 실제 tide_field 연동과 분리해 단위 검증 가능). 해안선 시드에
  `NEIGHBOR_BUFFER_CELLS`(현재 1칸)만큼 버퍼를 더해 해안선·BADA 격자 간 정합
  오차를 흡수하고, `classifyRocks()`가 암초 주변 `searchRadiusCells`(현재
  2칸)까지 도달 가능 셀이 있는지로 고립 여부를 정한다.
  - **핵심 물리 원칙(2026-08 확정)**: 해안선 셀 자체는 정의상(약최고고조면 기준)
    버퍼 없이 항상 마른 땅이지만, 버퍼로 넓힌 인접 후보 셀은 반드시 그 시각의
    `isExposedFn` 조석 판정을 통과해야만 "도달 가능"으로 인정한다 — 버퍼는
    해안선-BADA 격자 간 정합 오차를 흡수하는 용도일 뿐, 조석 검사를 우회하는
    용도가 아니다. 최초 구현은 버퍼 셀을 무조건 도달 가능으로 처리하는 버그가
    있어 "76%가 항상 연결"이라는 물리적으로 말이 안 되는 결과를 냈고(사용자가
    직접 지적해 발견), 조석 검사를 강제하도록 수정했다(커밋 `926610fc`).
  - **검증 완료**: 버그 수정 후 실제 프로덕션 조위(`/api/tide-field?time=&bbox=`,
    now/+6h/+12h/+18h 4개 시점, 서해·남해 전역 35,363칸, `budget_dropped` 재분할
    수집)로 재검증 — 노출 셀 수가 시점마다 약 3배 진폭으로 실제 변하는 것을
    확인했고, 처리 성능도 실측(35,363칸 플러드필 ≈0.3초)했다. 알고리즘 자체는
    구조적으로 정상 동작하는 것으로 판단.
  - 아직 tide_field 실시각 노출 판정과의 운영 배선(API 연동)은 미착수.

### BADA2024 근접-해안 신뢰도 문제 (2026-08 발견·검증)

고립판정은 노출암 주변 수심이 정확해야 의미가 있는데, **BADA2024 수심 데이터는
해안선에 가까울수록(간출지/조간대 근방) 신뢰도가 떨어진다**는 것을 세 가지 방법으로
독립 검증했다:
1. BADA 좌표 자체가 해안선과 median 138m 떨어져 있음(원시 좌표 대조).
2. KHOA 실제 전자해도 OCR 판독 대조 시, 근접-해안 표본에서 최대 60%까지
   "육지 vs 수심" 판정이 BADA와 충돌.
3. 근접-해안 표본의 16.7%는 반경 내 BADA 커버리지 자체가 없음.

**결론**: 노출암 주변 BADA 값을 그대로 믿을 수 없고, 특히 해안선에 가까운(연안
근접) 지점은 실제 전자해도를 직접 판독(OCR)해서 검증해야 한다.

#### OCR 검증 방법론 (KHOA 전자해도 직접 판독)

- **왜 OCR인가**: BADA2024는 갯벌 셀 기반 격자라 해안 근접부 정합 오차가 크고,
  Gemini 비전 기반 자동 판독(구 `routes/ocean5.js`, 이번 세션에 삭제·커밋
  `c68ff864` — BADA2024 도입으로 대체된 레거시)도 신뢰도가 검증되지 않았다.
  대신 클로드가 **앱에 이미 반영된 KHOA 전자해도 이미지를 직접 읽어(Read 도구)**
  판독하는 방식을 채택 — 다수 지점에 대해 실측 가능하고 근거를 검증할 수 있다.
- **타일 정렬 정밀화**: KHOA WMS 줌16 타일 1개(≈611m)만 받으면 조회 좌표가 타일
  아무 데나 걸려 "가장 가까운 숫자"를 잘못 고를 위험이 큼 → 3×3 타일을 스티칭한 뒤
  Mercator 투영 픽셀 계산으로 조회 좌표를 정중앙(빨간 크로스헤어)에 오도록 정밀
  크롭(약 500m 창). 데이터가 없으면 줌12 광역(≈9.8km) 이미지로 폴백해 등심선을
  더 넓게 탐색한다. 재사용 스크립트: 스크래치패드의 `fetch_one.js`(타일 확보)·
  `stitch_one.py`(스티칭+정밀 크롭).
- **색상 판정 규칙(확정)**: 황토색/베이지 = 진짜 육지(항상 안 잠김, `verdict=land`).
  **초록색 = 간출지(조간대) — 육지가 아니다!** 밀물에 잠기고 썰물에 드러나는
  지형이라 반드시 `water_reading`으로 분류해야 한다. 파란색 = 항상 물.
  → 초기 판독 프롬프트가 "노란/베이지=육지"만 명시하고 초록을 명시적으로
  제외하지 않아, 60개 표본의 "land" 판정 25건 중 18건(72%)이 실은 초록
  간출지를 육지로 오분류한 것으로 드러났다(사용자가 육안 재확인을 요청해 발견).
  이후 모든 배치 프롬프트에 "초록=간출지, 절대 land 아님" 규칙을 명시 반영.
- **모델 비교 결론**:
  - **하이쿠(Haiku) 대체 시도 → 기각**: 동일 표본 재판독 시 소넷 대비 43% 판정
    불일치, 토큰 절감 효과도 뚜렷하지 않아 채택하지 않음.
  - **오퍼스(Opus) 대체 시도 → 채택**: 동일 5개 표본을 오퍼스로 재판독한 결과
    토큰 소모량이 소넷과 비슷하거나 오히려 더 적었고(오퍼스 평균 약
    35,900토큰/곳 vs 소넷 약 39,500토큰/곳), 경계 사례(간출지 vs 육지 애매 지점)
    판독 정확도도 더 안정적으로 확인됨(2026-08-02). **오퍼스를 메인 데이터로
    채택하고, 소넷 판독 결과는 비교·검증용 보조자료로만 남기기로 결정.**
    단, 오퍼스는 토큰당 단가가 소넷보다 높아 계정 사용한도 소모 속도는
    더 빠를 수 있음(비용까지 동일하다는 뜻은 아님).
- **후보 선정 설계(방향 전환)**: 처음엔 "지금 고립 상태인가"만 봤으나, 실제
  안전상 의미 있는 건 조석에 따라 **연결↔고립이 전환되는** 지점이라는 방향으로
  전환. 2단계 후보 설계:
  1. (미착수) 정밀 조석-스윕 물리 기반 스크리닝 — 서해·남해·제주 전체 노출암
     3,130개에 대해 플러드필만으로(OCR 없이) 저렴하게 "실제로 전환되는" 후보를
     찾는다.
  2. (진행 중) 해안선 300m 이내 근접 안전망 — BADA가 특히 부정확한 근접-해안
     구간을 OCR로 직접 검증. 300m 기준으로 2,377개 후보 중 지역별(서해·남해·
     제주) 비례 층화 500개를 뽑아 판독 진행 중(2026-08-02 기준: 소넷 2배치
     250개씩 + 오퍼스 2배치 250개씩, 총 4개 워크플로우 병렬 실행). 오퍼스
     결과가 메인, 소넷 결과는 비교용.
- **애매 판정 처리 원칙**: `readingBasis`가 `color_zone_only`/`symbol_only`/`none`
  이거나 `verdict`가 `hazard_zone_no_data`/`no_data_uniform`인 경우는 AI가 확신
  없이 최선 추정한 것으로 간주 — 판독 이미지를 삭제하지 않고 그대로 보존한 뒤,
  배치 완료 시 이런 항목만 모아 이미지와 근거(note)를 사용자에게 제시해 수동
  판단을 받는다(자동 확정하지 않음).
- **다음 계획(미착수, 기록만)**: 고립판정 데이터가 전부 종합되면, 노출암 마커에
  기존 간출암(k=1)의 "몇 시간 후 잠김" 표시와 같은 방식으로 "해안선까지 거리를
  고려했을 때 늦어도 O시까지는 이탈해야 함" 시각을 계산해 표출한다.

- **제주**: 물빠짐 격자 자체가 제주를 대상 해역에서 제외하므로(BADA 갯벌 셀 부재),
  이 기능도 제주 확장 전까지는 서해·남해만 대상.
  - `scripts/build_jeju_bathy_grid.js` — 제주 전용 BADA 격자 1회성 전처리.
    `build_tide_field.js`의 순수 로직(BADA 로드/Z₀ IDW/버킷 앵커)을 그대로 재사용하되
    대상 해역만 JEJU_BBOX로, Z₀ seed 표준항만 제주권(제주·서귀포·성산포·모슬포 등)으로 바꾼다.
    산출물은 `data/tide_field/grid_meta_jeju.json`/`anchors_jeju.json`로 **서해·남해
    grid_meta.json과 별도 파일** — 기존 물빠짐 지도 UI·API에는 영향 없음.
    실행: `node scripts/build_jeju_bathy_grid.js` (`data/bathymetry/`에 실제 BADA
    파일 필요, 서해·남해와 공유). 산출물은 생성됐으나(964칸, 23앵커, 로컬만 —
    미커밋) 이 산출물을 쓰는 앵커 재산정·수집 확장(Task #14)은 아직 착수 전.

### 유지보수 — 정기 갱신 필요 (최소 연 1회)

간출암/노출암/세암/암암 데이터(`client/hazard_rocks.json`)와 이를 기반으로 한
해안선·BADA 격자·OCR 검증 결과는 한 번 만들고 끝이 아니다. KHOA 전자해도·
해안선·수심 원본이 갱신되면 최소 연 1회는 아래를 다시 점검·갱신해야 한다:
- 원본 간출암/노출암/세암/암암 좌표(`client/hazard_rocks.json`) 최신판 확보.
- 해안선 shapefile(`TL_COALNE_ARTIF`/`TL_COALNE_NATURE`) 최신판으로
  `build_coastline_cells.js` 재실행 — 매립·침식으로 해안선이 바뀔 수 있음.
- BADA 수심 격자(서해·남해 `build_tide_field.js`, 제주 `build_jeju_bathy_grid.js`)
  최신 BADA 원본으로 재빌드.
- 위 OCR 근접-해안 검증(300m 안전망)도 원본이 바뀌면 값이 달라질 수 있으므로
  **재실행 필요** — 특히 새로 추가/이동된 간출암·노출암 지점은 검증 이력이
  없으므로 반드시 재판독 대상에 포함.
