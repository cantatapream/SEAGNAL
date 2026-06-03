# Phase 4 — 자율 성장(수집·검수·반영) 파이프라인

> 상위: `../00_MASTER_PLAN.md` (Phase 4 §3, 저장방식 §9, 교차관심사 §8).
> **핵심 원칙(불변식):** 모델 자가학습 아님 = **자동 수집 + RAG 활용 + 사람 검수**. 사람 승인 없이는 정본(`knowledge/`)·그래프·RAG 인덱스에 **단 한 글자도 반영되지 않는다.**
> 입력 전제: 직군 8종(`jikgun/*.md`, `_SCHEMA.md` 강제) / 그래프(`graph/build_graph.js`→`graph.json`) / 데이터 카탈로그(`data_catalog.json`).
> 작성일: 2026-06-03.

---

## 0. 무엇을 수집하나 (수집 대상)

| 대상 | 원천 섹션 | 비고 |
|---|---|---|
| **직군 동향**(시점형) | `jikgun/*.md` §`최근 관심·언급 주제` | 수집일·출처·(비공식) 표기 강제. **만료 대상.** |
| **GAP 외부연동 검증** | `jikgun/*.md` §`GAP 보완 후보` | 외부 URL 생존·딥링크 유효성 점검 |
| **용어·동의어 보강** | `jikgun/*.md` §`전문용어·동의어` | 신규 은어/구어 후보(STT·그래프 Term) |
| **임계치·규정 갱신** | `jikgun/_thresholds.json`, §`의사결정 요인` | 법규/기준 변경 추적 |

> **수집 대상 아님(불변식):** 실시간 기상수치(특보·부이·예보·조석 등 `data_catalog.json` 등재 데이터셋·온디맨드 — 카탈로그가 단일 출처, 갯수는 빌드시점 기준이며 하드코딩하지 않음)는 **이미 런타임 캐시/온디맨드**로 별도 파이프라인이 처리한다. Phase 4는 **"지속형 직군 지식 MD"의 성장만** 담당한다(혼선 방지).

---

## 1. 소스 화이트리스트 (기관·URL·주기)

> **화이트리스트 외 도메인은 수집 금지.** 정본 파일 `knowledge/phase4_sources.json`(예정)로 단일 관리. 신규 소스 추가도 **관리자 승인 대상**.

| ID | 기관/소스 | URL(루트) | 주기 | 신뢰도 기본값 | 주 용도 |
|---|---|---|---|---|---|
| `src.khoa` | 국립해양조사원 | khoa.go.kr | 주 1회 | 0.9 | 조석/지수/수심 공지·기준 |
| `src.kma` | 기상청 | kma.go.kr | 주 1회 | 0.9 | 특보기준·해상예보 정책 |
| `src.mof` | 해양수산부 | mof.go.kr | 주 1회 | 0.9 | 정책·중기 동향(mof 직군) |
| `src.kcg` | 해양경찰청 | kcg.go.kr | 주 1회 | 0.9 | 안전·단속 동향(coast_guard) |
| `src.navy` | 대한민국 해군(공개) | navy.mil.kr | 월 1회 | 0.8 | 공개 일반 정보(navy) |
| `src.gov_portal` | 지자체/공공 포털 | data.go.kr 등 | 월 1회 | 0.8 | local_gov/public_org GAP |
| `src.assoc` | 수협·낚시·레저 협회(공개) | (개별 등재) | 월 1회 | 0.6 | 어업/낚시/레저 동향 |
| `src.news` | 지정 언론(해양 섹션) | (개별 등재) | 주 1회 | **0.4 (비공식)** | 동향 단서, 단독 반영 금지 |

규칙:
- **공식 기관(.go.kr/.mil.kr) ≥ 0.8, 협회 0.6, 언론 ≤ 0.4(비공식).**
- 언론·비공식 단독 출처는 **검수 큐에 올릴 수는 있으나 승인 권고 등급 아님**(공식 교차확인 필요).
- 수집 로봇은 `robots.txt` 준수, rate-limit, User-Agent 명시. 로그인/유료 소스 금지.

---

## 2. 변경 제안 포맷 (JSON)

> 수집 로봇이 생성하는 **불변 메타 4종(출처·수집일·신뢰도·diff)** 강제. 메타 누락 시 검수 큐 진입 거부(스키마 검증).
> 저장: 볼륨 스테이징 `data/knowledge/proposals/<id>.json` (정본 아님 — §9 런타임 작업본).

```json
{
  "proposal_id": "P4-20260603-001",
  "created_at": "2026-06-03T09:00:00+09:00",
  "status": "pending",                 // pending | approved | rejected | reverted
  "target": {
    "file": "knowledge/jikgun/fishery.md",
    "section": "최근 관심·언급 주제",     // _SCHEMA.md 필수 섹션명
    "node": "Topic | Term | Gap | ProactiveRule | none"  // 그래프 영향 노드 타입
  },
  "source": {                          // [필수] 출처 메타
    "src_id": "src.khoa",
    "url": "https://www.khoa.go.kr/...",
    "title": "원문 제목",
    "official": true
  },
  "collected_at": "2026-06-03",        // [필수] 수집일
  "confidence": 0.9,                   // [필수] 신뢰도(소스 기본값±근거)
  "expires_at": "2026-12-03",          // 시점형 만료(§6). 지속형이면 null
  "diff": {                            // [필수] 사람이 읽는 unified diff + 구조 변경
    "op": "add | update | remove",
    "before": "기존 줄(없으면 null)",
    "after": "- 새 동향 — 한줄 — https://... (2026-06-03)",
    "unified": "@@ ... @@\n- old\n+ new"
  },
  "rationale": "왜 제안하는가(1-2줄)",
  "duplicate_of": null,                // 기존 항목과 중복 시 proposal_id
  "review": {                          // 승인/반려 시 채워짐
    "reviewer": null, "decided_at": null, "note": null
  }
}
```

검증 게이트(큐 진입 전 자동):
- `source.url`이 화이트리스트(§1) 도메인인가
- `collected_at`/`confidence`/`diff` 비어있지 않은가
- `target.file`이 실제 직군 파일이고 `section`이 `_SCHEMA.md` 필수 섹션(10종, 제목·순서 고정)인가
- `node: ProactiveRule` 제안은 `section`이 `나리야 선제 제안·개인화 규칙`이고 규칙 ID가 `TR-<직군약어>-NN`(CG/FISH/LEIS/MOF/NAVY/GOV/ORG/ANGL) 규약·트리거 4요소를 지키는가(P3 기계추출 보장)
- diff 적용 후에도 `_SCHEMA.md` 섹션 순서·표 칼럼·frontmatter(`source_review` 포함)가 깨지지 않는가(드라이런)

---

## 3. 검수 큐·승인 워크플로 (관리자 탭 연계)

> **관리자 격리 불변식 준수:** 검수 API는 **관리자 전용**(`/api/admin/p4/*`). 나리야 도구/응답으로 절대 노출하지 않음(TOOL_CATALOG 미포함, 회귀 보안검사 대상).
> **기존 admin 구조 정합(중요):** 신규 라우트는 `routes/admin.js`에 등재하며, 거기 선언된 `router.use('/api/admin', adminAuth.requireAdminToken)`(`services/admin_auth.js`)에 의해 `X-Admin-Token` 헤더 검증을 **자동 상속**한다. 즉 P4 엔드포인트도 토큰 없으면 401. 클라이언트 UI 탭은 기존 관리자 화면 자산(`js/admin_collect.js` 등 admin 번들)에 추가하고, 로그인으로 받은 토큰을 동봉한다. **별도 인증/세션 체계를 새로 만들지 않는다.**

큐 상태기계: `pending → (approve|reject)`; 승인분은 반영 후 `approved`; 사후 문제 시 `reverted`.

관리자 탭(`관리자 > 지식 검수`) 화면 요소:
- 제안 리스트: 직군·섹션·신뢰도·수집일·만료일·소스(공식/비공식 뱃지) 필터
- 상세: **원문 링크 + diff 미리보기(before/after)** + 그래프 영향 노드 표시
- 액션: **승인 / 반려(사유) / 보류 / 일괄(동일 소스 묶음)**
- 안전장치: 비공식(신뢰도 ≤ 0.4) 단독 제안은 **"교차확인 필요" 경고** 후에만 승인 가능

워크플로:
1. 로봇이 제안 JSON 생성 → 스키마 검증 통과분만 큐 등록(`pending`).
2. 관리자가 탭에서 검토 → 승인/반려. **승인은 사람 1인 이상 필수**(자동 승인 경로 없음).
3. 승인 시 §4 반영 잡 트리거. 반려 시 사유 기록·아카이브.

---

## 4. 반영(MD/그래프 diff·커밋)·롤백·버전관리

> 저장방식(§9): **리포=검수된 정본/이력, 볼륨=런타임 작업본/수집 스테이징.** 반영의 최종 종착지는 항상 리포 커밋.

반영 단계(승인 1건당):
1. **MD 패치**: `diff.unified`를 대상 `jikgun/*.md`에 적용. frontmatter `updated:` 갱신.
2. **스키마 재검증**: `_SCHEMA.md`(섹션·표 칼럼·규칙ID·동향 수집일/비공식 표기) 통과 확인. 실패 시 자동 중단·제안 `pending` 복귀.
3. **그래프 재빌드**: `node graph/build_graph.js` → `graph.json` 재생성(Topic/Term/Gap/Rule 노드·엣지 반영). 무결성 정적검사.
4. **커밋**: `feat(p4): <직군> <섹션> 반영 [P4-...]` — 본문에 출처 URL·수집일·신뢰도·proposal_id 기록(추적성). **1 제안 = 1 커밋**(롤백 단위).
5. **게이트**: `python3 knowledge/phases/phase0_runner.py`(골든 무회귀 + 🔒 보안격리) + 직군 sentinel 스팟체크. 실패 시 자동 롤백(아래).

**버전관리·롤백:**
- 정본 이력은 **git**(커밋=원자 단위). 각 커밋이 proposal_id로 역추적 가능.
- 볼륨 스테이징은 적용된 proposal JSON을 `applied/`로 이동(상태 `approved`).
- **롤백**: 문제 커밋을 `git revert <sha>` → 그래프 재빌드 → RAG 재인덱싱 → 게이트 재실행. proposal 상태 `reverted`. **1 제안 1 커밋 원칙 덕분에 단건 무손실 롤백 보장.**
- 일괄 반영 시에도 커밋은 제안별로 분리(통째 revert 부작용 방지).

---

## 5. RAG 인덱스 갱신

> Phase 2b 임베딩 자산(`services/topic_embedding.js` — 토픽/도구 임베딩, 디스크 캐시)을 갱신 대상으로 삼는다.

- 반영된 직군 MD의 **변경 섹션만 증분 재임베딩**(Topic·Term 신규/변경분). 전체 재임베딩은 주기 배치(야간).
- 임베딩 캐시(`topic_embeddings.json` 등) 갱신 + 룰베이스 다이제스트 로더(`detectJikgun`/`JIKGUN_KB`)가 새 MD를 읽도록 배포 동기화.
- 만료(§6)된 동향은 인덱스에서 **제외/강등**(검색 후보에서 빠지거나 가중치↓).
- 갱신 후 직군 평가셋(`phase2b_eval*.jsonl`)으로 **무회귀 확인**(적중률 ≥ 이전).

---

## 6. 시점형 만료 정책

- 동향(`최근 관심·언급 주제`)·GAP URL은 **시점형** → 제안에 `expires_at` 필수(기본: 동향 6개월, GAP URL 검증 3개월).
- 만료 도래 시 로봇이 **재검증 제안**(`op: update` 또는 `remove`)을 큐에 자동 등록 → 사람 검수.
- 만료·미재검증 항목은 RAG에서 **자동 강등**하되 MD 본문에선 `(만료, YYYY-MM-DD)` 표기로 남겨 이력 보존(조용한 삭제 금지).
- frontmatter `source_review: required`인 직군은 만료 우선 점검 대상.
- 자동화 전까지는 §8 교차관심사대로 **수동 점검**으로 운영, 본 파이프라인이 이를 단계적 대체.

---

## 7. 한 사이클 시퀀스 (수집→검수→반영→RAG→노출)

```
[1] 주기 트리거(cron, §1 주기)
      └─ 수집 로봇: 화이트리스트 소스 크롤 → 후보 추출
[2] 제안 생성
      └─ §2 JSON(출처·수집일·신뢰도·diff·만료) → 스키마 검증 → 중복 제거
      └─ 볼륨 스테이징 data/knowledge/proposals/ 에 기록 (정본 무변경)
[3] 검수 큐 등록 (status=pending)
      └─ 관리자 탭 '지식 검수'에 노출 (관리자 격리 🔒)
[4] 사람 검수  ★필수★
      ├─ 반려 → 사유 기록·아카이브 (끝)
      └─ 승인 → [5]
[5] 반영 잡
      ├─ MD 패치 → _SCHEMA 재검증
      ├─ graph/build_graph.js 재빌드 → graph.json 무결성검사
      └─ git 커밋 (1제안=1커밋, 출처메타 포함)
[6] RAG 인덱스 갱신
      └─ 변경 섹션 증분 재임베딩 + 다이제스트 로더 동기화
[7] 게이트 검증
      ├─ phase0_runner.py (골든 무회귀 + 🔒보안) + 직군 sentinel
      ├─ 통과 → 배포 동기화 → 나리야 응답에 노출 (status=approved)
      └─ 실패 → git revert → 재빌드·재인덱싱 (status=reverted)
[8] 만료 관리(§6)
      └─ expires_at 도래분 재검증 제안을 [2]로 환류
```

DoD(마스터플랜 §3): 새 동향 1건이 **수집→검수→반영→RAG 노출까지 한 사이클 통과 + 롤백 가능**.

---

## 8. 자체 검토 (2차 pass)

| 점검 항목 | 결과 | 근거 |
|---|---|---|
| **사람 검수 필수**(모델 자가학습 아님) | ✅ | §3 자동 승인 경로 없음, §7 [4] ★필수★ 게이트. 로봇은 제안만, 정본 변경은 승인 후 §4에서만. 비공식 단독은 교차확인 경고. |
| **출처 메타 누락 없음** | ✅ | §2 출처·수집일·신뢰도·diff 4종 필수, 스키마 검증으로 누락 시 큐 진입 거부. 커밋 본문에도 메타 기록. |
| **롤백 가능** | ✅ | §4 1제안=1커밋 원자 단위 → `git revert` 단건 무손실. 그래프 재빌드·RAG 재인덱싱·게이트 재실행까지 롤백 절차 포함. 일괄도 커밋 분리. |
| 관리자 격리 불변식 | ✅ | §3 `/api/admin/p4/*` 전용, 나리야 도구 미노출(보안 회귀검사 대상). |
| 기존 admin 구조 정합 | ✅ | §3 `routes/admin.js` 등재 → `requireAdminToken`(`services/admin_auth.js`, `X-Admin-Token`) 자동 상속, UI는 기존 admin 번들에 탭 추가. 인증 체계 신설 없음. |
| 거짓 생성 금지 / 신선도 | ✅ | §6 만료 강등 + 조용한 삭제 금지, 비공식 신뢰도 강등으로 환각 유입 차단. |

**잔여(착수 시 확정):** 수집 로봇 구현체, `phase4_sources.json` 소스별 셀렉터, 관리자 탭 UI, 증분 재임베딩 트리거 연결.

---

## 9. 산출물·경로

| 항목 | 경로 | 상태 |
|---|---|---|
| 본 파이프라인 문서 | `knowledge/phases/phase4_pipeline.md` | ✅(설계) |
| 소스 화이트리스트(정본) | `knowledge/phase4_sources.json` | ⏳ |
| 제안 스테이징(런타임 작업본) | `data/knowledge/proposals/` | ⏳(볼륨) |
| 반영 정본/이력 | `knowledge/jikgun/*.md` + git | (기존) |
| 그래프/임베딩 갱신 | `graph/build_graph.js`, `services/topic_embedding.js` | (기존) |
| 무회귀 게이트 | `knowledge/phases/phase0_runner.py`, `phase2b_*` | (기존) |
| 검수 API(관리자) | `routes/admin.js`(`/api/admin/p4/*` 추가, `requireAdminToken` 상속) | (기존 확장) |
| 검수 UI 탭 | `js/admin_collect.js` 등 admin 번들에 '지식 검수' 탭 추가 | (기존 확장) |
| 관리자 인증 | `services/admin_auth.js`(`X-Admin-Token`) — 신설 없이 재사용 | (기존) |
