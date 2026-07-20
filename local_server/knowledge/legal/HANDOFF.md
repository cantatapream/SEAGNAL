# 🔁 나리야 — 인계인수서 (HANDOFF) · 작업 연속성 문서

> **⚠️ 어떤 Claude 계정이든, 이 저장소에서 작업을 시작하기 전에 이 파일을 가장 먼저 정독한다.**
> 마스터플랜(MASTER_PLAN.md)은 "무엇을/왜"를, 이 HANDOFF는 **"지금 어디까지 됐고, 지금 뭘 하는 중이고, 다음에 뭘 해야 하는지"**를 담는다.
> **규칙**: ①세션 시작 = 이 파일 + `_LESSONS.md` 정독 → ②작업 착수 전 [작업 로그]에 **착수 항목** append → ③작업 후 **완료 항목** append(진행률·다음). 상세·누락없이. (도구: `python3 _dashboard/loop/handoff.py start "..."` / `... done "..."`)

---

## A. 현재 상태 스냅샷 (마지막 갱신: 2026-07-20)

### 지금까지 완료
- **데이터층(A~D)**: 70법 수집·무결성검증 완료 · concept 923개 · 감사 5차(70/70)
- **승급 대전환**: canonical **81 → 490** (draft 793 → 403). auto_promote + grounding 재검증(`draft_reverify.js`)
- **리뷰큐 자동 트리아지**(`review_resolve.js`): 미승인 97 → resolved 31(자동확정)·needs_collect 12·human 54
- **B안 관리자 검토 시스템**: `routes/legal.js`(승인·값교정→canonical + 원본서빙 `/api/legal/src`) · `legal_review.html` · 앱 AI탭. main 머지
- **canonical 안전필터**: 선구축·스위치 OFF(`answerCanonicalOnly`). index.json에 status 색인 완료
- **서식 원본 보존**: `forms_manifest.json`(flSeq 280)

### 지금 진행 중 / 막힌 것
- **초안 재검증 미완 33법** — `draft_reverify.js` 10그룹 중 ~45법 성공, **33법이 usage credits 소진(11:50 UTC 리셋)으로 미처리**. reverify 마커(`_dashboard/fix3/reverify_<slug>.done`) 없는 법이 대상.
- **needs_collect 수집 트랙 미착수** — `collect_queue.json`의 `review_resolve_collect`(12건) + `holes`(86) DRF 재수집 대기. ⚠공유 타법 파일 쓰기라 **직렬 단독**.
- **사람 검수 큐 132건** (아래 D 분야별).

### 다음 할 일 (우선순위)
1. **[크레딧 리셋 후] 재검증 미완 33법 재개** — `draft_reverify.js`를 미완법만 재편성한 임시그룹으로. **모델: sonnet·medium (fable 금지)**.
2. 재검증 완료 후 후속 파이프라인(직렬): `merge_review_gen.py`(카드병합) → `lint_index.py`(index) → `human_workload.py`(집계). *커밋까지 자동.*
3. **needs_collect 수집**(직렬 단독, DRF OC=hyoo1431) → 수집법만 `wiki_rebuild.js` → 재검증.
4. **canonical 필터 ON** (검증 충분 시): index 재빌드 → `POST /api/legal/config {answerCanonicalOnly:true}`. 절차는 MASTER_PLAN E절.
5. **Phase E 답변엔진** 착수(되물음·다중법·점진공개·인용).

### ⚠️ 주의사항 (반드시 지킬 것)
- **fable 모델 금지**(사용자 명시 지시 전까지). 검증=sonnet·medium, 부트=sonnet·low. (L-12)
- **공유파일 쓰기는 단독 직렬**: review_queue.md·raw/15 타법·graph 허브. 병렬 에이전트는 자기 파일만. (L-1)
- **승급 판정은 원문 grounding**: raw와 grep EXACT 일치일 때만 canonical. 별표 이미지 OCR값·AI 추론매핑은 사람(수치카드). (L-2, _SCHEMA 5절)
- 한도/크레딧 실패는 마커를 안 남김 → **미완 마커만 재개**.
- 매 작업 커밋·푸시(브랜치 `claude/llm-wiki-maritime-legal-4f05zo`). main 반영은 fast-forward push.

## B. 핵심 수치 (한눈에)
| 항목 | 값 |
|---|---|
| canonical / draft / review-pending | 490 / 403 / (재빌드 반영) |
| 재검증 완료 법 | 37/70 (33법 미완) |
| 리뷰큐 미승인(사람 검수) | 132건 |
| collect_queue(수집대기) | review_resolve 12 + holes 86 |

## C. 실행 방법 (스크립트·인자)
- 재검증: `Workflow(scriptPath='_dashboard/loop/draft_reverify.js', args={groupsPath:.../audit7_groups.json, groupIndex:N})` — 미완법은 python으로 임시그룹 재편성. **model sonnet/medium(스크립트에 반영됨)**.
- 리뷰 트리아지: `review_resolve.js`(args {groups:{...idx}}) → `apply_resolutions.py`로 직렬 적용.
- 카드병합: `python3 _dashboard/loop/merge_review_gen.py`
- 색인: `python3 _dashboard/loop/lint_index.py`
- 집계: `python3 _dashboard/loop/human_workload.py`
- 법목록: `scratchpad/all_laws.json`(70) · 그룹 `scratchpad/audit7_groups.json`(10×7)

## D. 분야별 사람 검수량 (2026-07-20, `human_workload.json`)
| 분야 | 건수 | 성격 |
|---|---|---|
| 별표 OCR 값확정 | 66 | 원본 이미지 대조 후 값 확정(진짜 사람) |
| 법리·유권해석 | 9 | 법제처 유권해석·실무 |
| 판례 확인 | 6 | 판례·해석례 |
| 입법연혁(의도 vs 누락) | 3 | 개정이유·입법공백 |
| 제품설계 판단 | 1 | 좌표매핑 등 |
| (수집대기) | 25 | ※AI 수집 트랙 — 사람 몫 아님 |
| 기타 해석 | 22 | 재분류 필요 |

---

## 작업 로그 (append-only · 최신이 위)
> 형식: `### [YYYY-MM-DD HH:MM KST] 🟢착수 / ✅완료 — 제목` + 무엇을·어떻게·진행률·다음.

### [2026-07-20 21:51 KST] ✅완료 — 자율fire(21시): 재검증 재개 대기
37/70·canonical491. 미완33법 중 2그룹 sonnet/medium 재개 in-flight. 비차단으로 완주 대기, 추가launch 자제(크레딧). 다음: 완료시 카드병합·index·나머지3그룹.


### [2026-07-20 21:49 KST] 🟢착수 — 재검증 미완 33법 재개 대기
크레딧 리셋(11:50 UTC) 후 sonnet/medium으로 draft_reverify 미완33법 재편성 실행 예정. fable 금지.


### [2026-07-20] ✅완료 — 인계인수 시스템 구축 + 모델정책 + 재검증 부분완료
- **한 일**: ①초안 재검증 10그룹 실행(canonical 240→490, 33법 크레딧 미완) ②OCR 수치카드 66 병합 ③index status 재빌드 ④모델정책(fable 금지·sonnet medium) 문서화·스크립트 반영 ⑤이 HANDOFF 시스템·`handoff.py`·CLAUDE.md 규칙 신설.
- **진행률**: 승급 대전환 ~진행중(재검증 37/70). 사람 검수 132건 확정.
- **다음**: 크레딧 리셋(11:50 UTC) 후 재검증 미완 33법 재개(sonnet/medium) → 후속 파이프라인 → 수집 트랙.
