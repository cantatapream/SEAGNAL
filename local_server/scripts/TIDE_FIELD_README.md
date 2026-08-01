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
- 플러드필 알고리즘 본체(고립 판정)는 아직 미구현 — 다음 단계.
- **제주**: 물빠짐 격자 자체가 제주를 대상 해역에서 제외하므로(BADA 갯벌 셀 부재),
  이 기능도 제주 확장 전까지는 서해·남해만 대상.
  - `scripts/build_jeju_bathy_grid.js` — 제주 전용 BADA 격자 1회성 전처리.
    `build_tide_field.js`의 순수 로직(BADA 로드/Z₀ IDW/버킷 앵커)을 그대로 재사용하되
    대상 해역만 JEJU_BBOX로, Z₀ seed 표준항만 제주권(제주·서귀포·성산포·모슬포 등)으로 바꾼다.
    산출물은 `data/tide_field/grid_meta_jeju.json`/`anchors_jeju.json`로 **서해·남해
    grid_meta.json과 별도 파일** — 기존 물빠짐 지도 UI·API에는 영향 없음.
    실행: `node scripts/build_jeju_bathy_grid.js` (`data/bathymetry/`에 실제 BADA
    파일 필요, 서해·남해와 공유). 이 산출물을 쓰는 앵커 재산정·수집 확장은 별도 단계.
