# 간출암·노출암 핸드오프 — 개략 (바로 이어서 할 일)

> 상세 배경·시행착오·전체 히스토리는 [`HAZARD_ROCKS_HANDOFF.md`](./HAZARD_ROCKS_HANDOFF.md) 참고.
> 이 파일은 **"지금 뭘 하고 있었고, 다음에 뭘 하면 되는지"** 만 빠르게 파악하기 위한 것.

## ✅ 완료됨 (2026-08-03): 노출암 300m 근접 1,000개 OCR 판독 + 사람 검토

**최종 데이터**: `local_server/data/hazard_rocks/nearshore_isolation_review_1000.json`(커밋됨, 1000건)
- 오퍼스 메인 판독(4개 배치: 1차 250×2 + 2차 250×2) + 애매 판정 283건(1차 96 + 2차 187) 전부
  사람이 이미지 보고 직접 검토·병합 완료. `source` 필드로 `ai_opus`(AI 그대로) vs
  `human_reviewed`(사람 보정) 구분, 사람 보정분은 `aiVerdict_orig`로 원래 AI 판정도 보존.
- 최종 판정 분포: water_reading 881 / land 115 / hold 4(타일 로드 실패로 판단보류, 재수집 필요:
  r2552, r4114, r4115 — 좌표는 이 파일에서 `verdict=hold`로 검색).
- **`alwaysIsolatedFlag: true`인 레코드 10건** — 사람이 검토하며 "수심값은 특정 못 해도 이 지점은
  밀물에 항상 고립된다"고 memo에 남긴 것들. 값 자체보다 이 판단(항상 고립)을 우선 반영할 것.
- **사람 검토 중 확정된 새 원칙(2026-08-03, 사용자 지시)**: AI가 `land`로 판정한 것은 이번
  283건 검토에서 단 한 건도 뒤집히지 않았다(전부 확인 사살) — **앞으로는 AI가 land로 판정한
  건은 별도 사람 검토 없이 그대로 채택**하면 된다. 애매 판정 검토는 `water_reading`인데
  `readingBasis`가 `color_zone_only`/`none`/`symbol_only`인 것(초록 간출지-육지 경계 애매 케이스)
  위주로만 하면 됨 — 검토량이 앞으로는 더 줄어들 것.

## 다음 단계 (순서대로, 아직 미착수)
1. **Task #19** — 노출암 전체 3,130개 정밀 조석-스윕 스크리닝(플러드필만, OCR 없이) — 이 300m
   근접 1,000개 OCR 결과와 union해서 최종 고립판정 후보군 확정.
2. **Task #16** — 고립판정을 실제 tide_field API에 배선해서 프론트에 경고 표시(서해·남해 우선,
   제주 확장 포함) — `nearshore_isolation_review_1000.json`을 실사용 데이터로 소비.
3. **Task #14** — 제주는 격자(`grid_meta_jeju.json`/`anchors_jeju.json`, 로컬에만 있고 미커밋)를
   기반으로 앵커 재산정·수집 확장 필요.
4. **Task #17** — 노출암 마커에 "늦어도 O시까지 이탈" 시각 표시(해안거리+잠김시각 반영).
5. **Task #18** — 노출암/간출암 마커 탭 시 당일+익일(최대 3일) 조석 곡선 팝업, 하루씩 넘겨보기
   (이미 수집된 데이터 재사용, 새 수집 불필요).

## 이 1,000개 파이프라인을 다시 돌려야 한다면 (재현법)
스크래치패드(`/tmp/claude-*/.../scratchpad/`)는 세션마다 사라지므로, 아래 스크립트들이 없을 수
있음 — 로직만 재구현하면 됨:
1. `client/hazard_rocks.json`(k=0 필터) + `local_server/data/tide_field/coastline_cells.json`으로
   해안선 300m 이내 노출암 후보 재계산(CELL_DEG=0.0015, cellKey=`round(lon/0.0015)_round(lat/0.0015)`).
2. `nearshore_isolation_review_1000.json`에 이미 있는 id는 제외.
3. 지역(서해/남해/제주) 비례 층화로 다음 배치 선정.
4. `/api/ocean/depth?lat=&lon=`로 BADA 수심 참고값 조회(판독에는 안 씀, 참고용 note에만 넣음).
5. KHOA WMS z16 3×3 스티칭 + z12 광역 폴백으로 정밀 크롭 이미지 생성(§6.4 상세문서 참고) 후
   Workflow로 판독 — **모델은 `claude-opus-5`로 고정**(소넷 대비 토큰 비슷하거나 적고 정확도
   우위, 상세 문서 §6.4 참고).
6. 프롬프트 색상 규칙 필수: **황토색/베이지=육지, 초록색=간출지(육지 아님, 반드시
   water_reading), 파란색=물**.
7. 결과 중 `water_reading`+애매 근거(color_zone_only/none/symbol_only)만 사람 검토(land는 검토
   불필요, 위 새 원칙 참고) → HTML 검토 페이지(base64 이미지 내장, Artifact 배포, 16MB 넘으면
   분할) → 사람이 검토 → JSON 받아서 병합.

## 잊지 말 것
- **오퍼스가 메인, 소넷은 비교용**(2026-08-02 확정).
- **애매한 water_reading은 자동 확정하지 말고 이미지 보존 + 사람 검토, land는 검토 불필요**
  (2026-08-03 갱신된 원칙).
- scheduler.js의 서해·남해/제주 TideBED 수집 로그는 통일된 형식("TideBED 앵커 곡선 수집")으로
  이미 커밋됨(`ea24b036`).
- 커밋 시 `local_server/data/tide_field/anchors.json`/`grid_meta.json`는 **로컬 테스트용이라
  커밋하지 않는다**(기존 결정 유지) — 단 `nearshore_isolation_review_1000.json`은 실제 결과물이라
  커밋 대상(이미 커밋됨).
