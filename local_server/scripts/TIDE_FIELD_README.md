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
