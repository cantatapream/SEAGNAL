# 간출암·노출암 핸드오프 — 개략 (바로 이어서 할 일)

> 상세 배경·시행착오·전체 히스토리는 [`HAZARD_ROCKS_HANDOFF.md`](./HAZARD_ROCKS_HANDOFF.md) 참고.
> 이 파일은 **"지금 뭘 하고 있었고, 다음에 뭘 하면 되는지"** 만 빠르게 파악하기 위한 것.

## 지금 이 순간 진행 중인 것 (2026-08-02 세션 기준)

**노출암 고립판정 — 해안선 300m 이내 근접 노출암 OCR 판독**, 총 1000개 목표 중:
- **1차 500개**: 완료. 소넷 2배치(비교용) + 오퍼스 2배치(메인) 4개 워크플로우 모두 완료.
  애매 판정 96건은 HTML 검토 페이지로 사람이 직접 판정 → `hazard_rocks_500_final.json`(스크래치패드)로 병합 완료.
- **2차 500개**: 오퍼스 전용 2개 워크플로우 launch됨(Task `w0fun5u3d`, `wptdfiww0`) — **완료 여부 확인 필요**.
  완료됐다면 1차와 똑같이: 애매 판정(readingBasis∈{color_zone_only,none,symbol_only} 또는 verdict∈{hazard_zone_no_data,no_data_uniform}) 골라서
  `hazard_rock_review.html` 같은 검토 페이지 다시 만들고, 사람 판정 받은 뒤 병합.

### 재현에 필요한 스크래치패드 파일 (세션 스크래치패드, `/tmp/claude-*/.../scratchpad/`)
⚠ 스크래치패드는 세션마다 경로가 바뀔 수 있음 — 새 세션에서는 이 파일들이 없을 수 있으니, 아래 "처음부터 재현하는 법"도 같이 봐둘 것.

- `fetch_one.js` / `stitch_one.py` — KHOA 전자해도 좌표 중심 정밀 크롭(z16 3×3 스티칭) + 광역(z12) 폴백 이미지 생성. **재사용 핵심 스크립트.**
- `select_next500.py`(1차용, 이미 실행됨) / `select_and_fetch_next500.js`(2차용) — 300m 이내 후보 재계산 + BADA 수심 조회 + 이미 처리분 제외 + 지역 비례 층화 500개 선정.
- `workflow_500c_batch1_opus.js` / `workflow_500c_batch2_opus.js` — 2차 500개 오퍼스 판독 워크플로우 스크립트(각 250개).
- `hazard_rocks_500_final.json` — 1차 500개 최종본(오퍼스 메인 + 사람 96건 보정 반영).
- `build_review_page.py` — 애매 판정 이미지+메타데이터를 base64로 내장한 HTML 검토 페이지 생성기(Artifact로 배포).

### 처음부터 재현하는 법(스크래치패드가 사라졌을 때)
1. `client/hazard_rocks.json`(k=0 필터) + `local_server/data/tide_field/coastline_cells.json`으로 해안선 300m 이내 노출암 후보 재계산(`select_next500.py` 로직 참고 — CELL_DEG=0.0015, cellKey=`round(lon/0.0015)_round(lat/0.0015)`).
2. `hazard_rocks_500_final.json`(1차분)에 이미 있는 id는 제외.
3. 지역(서해/남해/제주) 비례 층화로 다음 500개(또는 필요한 만큼) 선정.
4. `/api/ocean/depth?lat=&lon=`로 BADA 수심 참고값 조회(판독에는 안 씀, 참고용 note에만 넣음).
5. `fetch_one.js`+`stitch_one.py` 재사용해 Workflow 스크립트 작성 — **모델은 `claude-opus-5`로 고정**(소넷 대비 토큰 비슷하거나 적고 정확도 우위, 특히 초록색 간출지 vs 육지 경계 판정에서 확실히 낫다는 게 실측으로 확인됨. 상세 문서 참고).
6. 프롬프트의 색상 규칙 필수 포함: **황토색/베이지=육지, 초록색=간출지(육지 아님, 반드시 water_reading), 파란색=물**.
7. 결과 중 애매 판정만 골라 HTML 검토 페이지(`build_review_page.py` 패턴) 생성 → Artifact로 배포 → 사람이 검토 → JSON 다운로드/복사 받아서 병합.

## 완료 후 다음 단계 (순서대로)
1. 1000개(1차+2차) 다 끝나면 종합 통계 정리해서 사용자에게 보고.
2. **Task #19** — 노출암 전체 3,130개 정밀 조석-스윕 스크리닝(플러드필만, OCR 없이) — 아직 미착수. 300m 근접 OCR 결과와 union해서 최종 고립판정 후보군 확정.
3. **Task #16** — 고립판정을 실제 tide_field API에 배선해서 프론트에 경고 표시(서해·남해 우선, 제주 확장 포함).
4. **Task #14** — 제주는 격자(`grid_meta_jeju.json`/`anchors_jeju.json`, 로컬에만 있고 미커밋)를 기반으로 앵커 재산정·수집 확장 필요.
5. **Task #17** — 노출암 마커에 "늦어도 O시까지 이탈" 시각 표시(해안거리+잠김시각 반영).
6. **Task #18** — 노출암/간출암 마커 탭 시 당일+익일(최대 3일) 조석 곡선 팝업, 하루씩 넘겨보기(이미 수집된 데이터 재사용, 새 수집 불필요).

## 잊지 말 것
- **오퍼스가 메인, 소넷은 비교용**(2026-08-02 확정) — 이후 배치도 오퍼스로 진행.
- **애매 판정은 자동 확정하지 말고 이미지 보존 + 사람 검토** 원칙 유지.
- scheduler.js의 서해·남해/제주 TideBED 수집 로그는 통일된 형식("TideBED 앵커 곡선 수집")으로 이미 커밋됨(`ea24b036`) — 검색 키워드 통일 완료.
- 커밋 시 `local_server/data/tide_field/anchors.json`/`grid_meta.json`는 **로컬 테스트용이라 커밋하지 않는다**(기존 결정 유지).
