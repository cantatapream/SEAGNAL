# 간출암·노출암 핸드오프 — 개략 (바로 이어서 할 일)

> 상세 배경·시행착오·전체 히스토리는 [`HAZARD_ROCKS_HANDOFF.md`](./HAZARD_ROCKS_HANDOFF.md) 참고.
> 이 파일은 **"지금 뭘 하고 있었고, 다음에 뭘 하면 되는지"** 만 빠르게 파악하기 위한 것.

## ✅ 완료됨 (2026-08-03): Task #19 — 노출암 전체 정밀 조석-스윕 스크리닝

**최종 데이터**:
- `local_server/data/hazard_rocks/isolation_sweep_full.json` — 서해·남해 in-scope 노출암 2,985개
  전부, 프로덕션 tide-field API(72시간 창, 1시간 간격 72샘플)로 해안선 플러드필
  (`services/hazard_rocks_isolation.js`)을 실행해 시각별 고립/연결 상태를 기록한 원본.
- `local_server/data/hazard_rocks/isolation_candidates_final.json` — 위 스윕 + 300m 근접
  1,000개 OCR 결과를 union한 **최종 우선순위 후보 718개**.
- 재사용 스크립트: `hazard_rocks_task19_sweep.js`(스윕 실행) +
  `hazard_rocks_task19_finalize.js`(union). 로컬 서버 불필요 — 프로덕션
  `https://seagnal-server.fly.dev` API를 직접 호출한다(로컬 grid_meta.json은
  빈 스텁이라 사용 불가).

**분류 결과**: always_connected 2,276 / always_isolated(비근접-해안) 702 /
transition(연결↔고립 전환) 7. **핵심 발견**: 근접-해안(300m 이내, 1,000개 리뷰 대상) 904건은
스윕에서 **100%가 always_connected로 나옴** — 사람이 이미 "항상 고립"로 판단해둔 9건
(`alwaysIsolatedFlag`, 3083 1건은 동해라 대상 밖이라 제외)조차 예외 없이 전부 포함됨. 원인은
BADA 근접-해안 부정확 문제(§6.3)와 동일 — 해안선 시드 버퍼(150m)+고립판정 탐색반경(2칸≈
276~390m)이 근접-해안 지점을 조위와 무관하게 트리비얼하게 "연결"로 만든다. **따라서 근접-해안
구간은 물리 스윕을 신뢰하지 말고 사람/OCR 판단(`alwaysIsolatedFlag`)을 그대로 채택** —
`isolation_candidates_final.json`에 이미 이 원칙으로 반영됨. 최종 718개 우선순위 후보 =
transition 7 + always_isolated_far(비근접-해안) 702 + always_isolated_nearshore_human 9.

## ✅ 완료됨 (2026-08-03, 이전 세션): 노출암 300m 근접 1,000개 OCR 판독 + 사람 검토

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

## 🔧 진행 중 (2026-08-03): Task #14 — 제주 노출암 고립판정용 촘촘 격자·수집 배선

**한 일**: 제주는 그동안 "간출암(k=1) 잠김경고"용 17개 지점 곡선만 매일 밤 수집되고 있었고,
노출암(k=0) 고립판정 플러드필에 필요한 "촘촘한 수심 격자"(서해·남해와 동일 밀도)는 없었다.
아래를 새로 만들어 배선함:
- `services/jeju_isolation_tide_collector.js` — `scripts/build_jeju_bathy_grid.js`가 만드는
  `anchors_jeju.json`(촘촘 격자 앵커)을 순회하며 TideBED 곡선을 수집(`data/tide_field/curves_jeju/`).
  `ensureGridBuilt()`가 격자 없으면 `build_jeju_bathy_grid.main()`을 자동 실행(서해·남해
  `tide_field_collector.ensureBuilt()`와 동일 패턴).
- `scheduler.js` — KST 23:30 배치 체인에 제주 간출암(17개) 수집 직후 이어서(TideBED 키
  순차 공유) 새 수집기 호출하도록 연결.

**중요**: BADA 수심 원본(`data/bathymetry/`)이 있어야 실제 격자가 만들어지는데, 이 파일은
운영 볼륨(Fly.io)에만 있고 이 저장소·로컬 개발환경엔 없다(서해·남해 grid_meta.json도 동일
제약). **하지만 수동 명령 실행이 필요 없다** — `ensureGridBuilt()`가 서해·남해와 동일하게
"격자 없으면 자동 빌드 시도" 패턴이라, 이 코드가 배포되면 다음 KST 23:30 배치(또는 서버 재기동)
때 운영 서버가 스스로 BADA 원본으로 제주 격자를 만들고 곧바로 수집을 시작한다. 로컬에서
BADA 없이 실행하면 크래시 없이 안전하게 skip하는 것까지 확인함.

**아직 남은 것**: 격자·수집 배선은 끝났지만, **Task #19(조석-스윕 플러드필 계산)와 그 계산을
쓰는 API(Task #16)는 아직 제주까지 확장 안 됨** — 지금은 수집 인프라만 준비된 상태. 격자·곡선이
실제로 쌓이기 시작하면(배포 후 며칠), 서해·남해 스윕과 같은 방식으로 제주도 플러드필 계산에
포함시키는 작업이 이어져야 함.

## 다음 단계 (순서대로, 아직 미착수)
1. **Task #16** — 고립판정을 실제 tide_field API에 배선해서 프론트에 경고 표시(서해·남해 우선,
   제주 확장 포함) — `isolation_candidates_final.json`(718개 우선순위 후보)을 실사용 데이터로
   소비. 근접-해안(904건 중 9건 always_isolated_nearshore_human)은 사람 판단을, 나머지
   (transition 7 + always_isolated_far 702)는 스윕 결과를 그대로 신뢰해도 됨.
2. **Task #14 나머지** — 위 제주 격자·수집이 실제로 운영에서 채워지면(자동), 서해·남해와
   동일한 방식(Task #19 스크립트 재사용/확장)으로 제주 노출암 스윕을 실행해 `isolation_
   candidates_final.json`에 제주 145개도 합쳐 넣는다.
3. **Task #17** — 노출암 마커에 "늦어도 O시까지 이탈" 시각 표시(해안거리+잠김시각 반영).
4. **Task #18** — 노출암/간출암 마커 탭 시 당일+익일(최대 3일) 조석 곡선 팝업, 하루씩 넘겨보기
   (이미 수집된 데이터 재사용, 새 수집 불필요).

## 이 파이프라인을 더 돌려야 한다면 (다음 배치 실행법)
핵심 스크립트 3개 + HTML 템플릿은 이제 **저장소에 커밋돼 있어**(2026-08-03부터) 스크래치패드가
사라져도 그대로 재사용 가능:
- `local_server/scripts/hazard_rocks_ocr_fetch.js` — KHOA 타일 확보
- `local_server/scripts/hazard_rocks_ocr_stitch.py` — 정밀 크롭
- `local_server/scripts/hazard_rocks_ocr_build_review.py` +
  `hazard_rocks_ocr_review_template.html` — 검토 페이지 생성기. **`verdict=land`는 코드에서
  자동 제외**돼 사람에게 다시 안 물어본다(§6.7 상세문서 참고, 이 필터를 우회하지 말 것).

절차:
1. `client/hazard_rocks.json`(k=0 필터) + `local_server/data/tide_field/coastline_cells.json`으로
   해안선 300m 이내 노출암 후보 재계산(CELL_DEG=0.0015, cellKey=`round(lon/0.0015)_round(lat/0.0015)`).
2. `nearshore_isolation_review_1000.json`에 이미 있는 id는 제외.
3. 지역(서해/남해/제주) 비례 층화로 다음 배치 선정.
4. `/api/ocean/depth?lat=&lon=`로 BADA 수심 참고값 조회(판독에는 안 씀, 참고용 note에만 넣음).
5. `hazard_rocks_ocr_fetch.js`+`_stitch.py` 재사용해 Workflow로 판독 — **모델은 `claude-opus-5`로
   고정**(소넷 대비 토큰 비슷하거나 적고 정확도 우위, 상세 문서 §6.4 참고). 로컬 서버(포트 3001)의
   `/api/ocean/khoa-wms` 프록시가 떠 있어야 함.
6. 프롬프트 색상 규칙 필수: **황토색/베이지=육지, 초록색=간출지(육지 아님, 반드시
   water_reading), 파란색=물**.
7. 결과 JSON을 `hazard_rocks_ocr_build_review.py --results ... --image-dir ... --out ...`에
   넘기면 land 자동 제외된 애매 판정만으로 검토 페이지가 나온다(16MB 넘으면 자동 분할) →
   Artifact로 배포 → 사람이 검토 → JSON 받아서 병합.

## 잊지 말 것
- **오퍼스가 메인, 소넷은 비교용**(2026-08-02 확정).
- **애매한 water_reading은 자동 확정하지 말고 이미지 보존 + 사람 검토, land는 검토 불필요**
  (2026-08-03 갱신된 원칙).
- scheduler.js의 서해·남해/제주 TideBED 수집 로그는 통일된 형식("TideBED 앵커 곡선 수집")으로
  이미 커밋됨(`ea24b036`).
- 커밋 시 `local_server/data/tide_field/anchors.json`/`grid_meta.json`는 **로컬 테스트용이라
  커밋하지 않는다**(기존 결정 유지) — 단 `nearshore_isolation_review_1000.json`·
  `isolation_sweep_full.json`·`isolation_candidates_final.json`은 실제 결과물이라 커밋 대상
  (이미 커밋됨).
- **Task #19 스윕은 로컬 tide_field 데이터가 아니라 프로덕션 API(`https://seagnal-server.fly.dev`)를
  직접 호출한다** — 로컬 `grid_meta.json`은 `cell_count:0`(no_bathymetry) 빈 스텁이라 로컬
  서버로는 스윕 불가.
- **근접-해안(300m 이내)에서 물리 스윕(플러드필)은 신뢰하지 말 것** — 해안선 버퍼+탐색반경이
  근접-해안 지점을 조위와 무관하게 트리비얼하게 "연결"로 만든다(2026-08-03 실측 확인, 사람이
  "항상 고립"로 판단해둔 9건 전부가 스윕에서 "always_connected"로 나옴). 근접-해안은 반드시
  OCR/사람 판단(`nearshore_isolation_review_1000.json`)을 우선한다.
