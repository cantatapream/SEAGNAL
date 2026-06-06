# SEAGNAL 나리야 — 지식·계획 추적 루트(Route)

이 폴더는 음성비서 **나리야**의 AI 고도화 작업을 **채팅이 아니라 파일로** 추적하기 위한 단일 출처(single source of truth)입니다.
대화는 휘발되지만 이 폴더는 남습니다. 모든 계획·진행·산출물은 여기에서 시작해 찾을 수 있어야 합니다.

---

## 폴더 구조

```
local_server/knowledge/
├── README.md              ← (이 파일) 폴더 사용법 + 전체 인덱스
├── 00_MASTER_PLAN.md      ← 마스터 플랜: Phase 0~4 상세 설계 + 상태 + 산출물 경로
├── jikgun/                ← 직군별 지식베이스 (Phase 2 산출물)
│   ├── coast_guard.md     ← 해양경찰
│   ├── fishery.md         ← 어업종사자
│   ├── marine_leisure.md  ← 레저스포츠 활동자
│   ├── mof.md             ← 해양수산부
│   ├── navy.md            ← 해군
│   ├── local_gov.md       ← 지방자치단체
│   ├── public_org.md      ← 공공기관
│   ├── angler.md          ← 기타(낚시객)
│   └── _SCHEMA.md         ← 직군 파일 공통 스키마(필수 준수)
└── phases/                ← 단계별 산출물(요약/결과 리포트)
    ├── phase0_diagnostics.md  ← Phase 0 진단 배터리 결과
    └── plan_review.md         ← 마스터 플랜 독립 검토 리포트
```

---

## 핵심 원칙 — "경로만 둔다"

- **마스터 플랜(`00_MASTER_PLAN.md`)에는 산출물 본문을 넣지 않습니다.** 산출물은 각자 별도 파일로 만들고, 플랜에는 **"→ 참고: `경로`"** 형태로 링크만 둡니다.
- 새 산출물이 생기면: ① `jikgun/` 또는 `phases/`(또는 새 하위폴더)에 파일 생성 → ② `00_MASTER_PLAN.md`의 해당 단계 "산출물" 칸에 **경로 한 줄 추가** → ③ 이 README의 인덱스에도 추가.
- 이렇게 하면 플랜 문서는 항상 짧고 읽기 쉽게 유지되고, 내용은 파일로 누적됩니다.

## 상태 표기 규칙

| 표기 | 의미 |
|---|---|
| ✅ | 완료 |
| 🚧 | 진행 중 |
| ⏳ | 예정 |
| ⛔ | 보류/차단 |
| 🔁 | 반복·주기 작업 |

## 갱신 규칙

- 작업이 한 단계 끝날 때마다 `00_MASTER_PLAN.md`의 상태·산출물 경로·변경이력을 갱신합니다.
- 의사결정은 플랜 하단 "의사결정 로그"에 한 줄씩 누적합니다(번복 방지).

---

## 인덱스 (현재 존재하는 문서)

| 문서 | 내용 | 경로 |
|---|---|---|
| 마스터 플랜 | Phase 0~4 상세 설계·상태(v2) | `local_server/knowledge/00_MASTER_PLAN.md` |
| 플랜 검토 리포트 | 독립 검토(적합성 72/100)·권고 | `local_server/knowledge/phases/plan_review.md` |
| 직군 공통 스키마 | 8종 형식·규칙ID·트리거 규약 | `local_server/knowledge/jikgun/_SCHEMA.md` |
| Phase 0 진단 | 나리야 데이터 적재 진단 결과 | `local_server/knowledge/phases/phase0_diagnostics.md` |
| 직군: 해양경찰 | 관심사·매핑·선제규칙·GAP | `local_server/knowledge/jikgun/coast_guard.md` |
| 직군: 어업종사자 | 〃 | `local_server/knowledge/jikgun/fishery.md` |
| 직군: 레저스포츠 | 〃 | `local_server/knowledge/jikgun/marine_leisure.md` |
| 직군: 해양수산부 | 〃 | `local_server/knowledge/jikgun/mof.md` |
| 직군: 해군 | 〃 | `local_server/knowledge/jikgun/navy.md` |
| 직군: 지방자치단체 | 〃 | `local_server/knowledge/jikgun/local_gov.md` |
| 직군: 공공기관 | 〃 | `local_server/knowledge/jikgun/public_org.md` |
| 직군: 기타(낚시객) | 〃 | `local_server/knowledge/jikgun/angler.md` |
