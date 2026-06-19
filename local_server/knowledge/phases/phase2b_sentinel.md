# Phase 2b Sentinel — 핵심 결함 직타 회귀 게이트 (20케이스)

자유변칙 평가셋 440케이스에서 **핵심 결함을 직타하는 20케이스**를 추출한 빠른 회귀 게이트.
원본(`phase2b_eval_freevar.jsonl`)에서 줄을 그대로 추출했으며 스키마 동일.

## 선별 기준

- **약점 카테고리 집중 (12케이스):** 정량(cat4, 베이스라인 15%)·연속(cat2, 48%)·다중(cat3, 60%)이 회귀 핵심 위험. 이 셋에 12케이스를 배분.
  - cat4 정량 4 · cat3 다중 4 · cat2 연속(후속쌍 2조=4)
- **직군 대표 (5케이스):** 8개 직군이 모두 1건 이상 포함되도록 보강. 기본(cat1)·메타(cat6 후속쌍)·비도메인 가드(cat5)를 직군 대표로 채움.
- **회귀 핵심 (3케이스):** 안정 구간(98%)이 깨졌는지 감시하는 가드 — 환각(cat7) 2 · 변칙(cat8) 1.
- **후속쌍 보존:** `prev_id`를 가진 케이스는 선행(a)·후속(b)을 **반드시 함께** 포함 (ANG-2-01, CG-2-01, MOF-6-01). 연속성 검증(zone_match)·메타 자기요약 축이 깨지지 않도록 함.

## 커버리지 표

### 직군 분포 (8/8 직군 커버)

| 직군 | 건수 | 포함 ID |
|------|------|---------|
| angler | 3 | ANG-2-01a/b, ANG-4-01 |
| coast_guard | 3 | CG-2-01a/b, CG-4-01 |
| fishery | 2 | FIS-3-01, FIS-7-01 |
| navy | 2 | NAV-3-01, NAV-8-01 |
| marine_leisure | 2 | LEI-3-01, LEI-5-01 |
| mof | 3 | MOF-4-01, MOF-6-01a/b |
| local_gov | 3 | LG-1-01, LG-4-01, LG-8-01 |
| public_org | 2 | PO-3-01, PO-7-01 |

### 카테고리 분포 (8/8 카테고리 커버)

| cat | 라벨 | 건수 | 비중 의도 |
|-----|------|------|-----------|
| 1 | 기본 | 1 | 기본 도구 호출 정상 확인 |
| 2 | 연속 | 4 | **약점** — 후속쌍 2조 |
| 3 | 다중 | 4 | **약점** — 멀티툴 |
| 4 | 정량 | 4 | **최약점** — 정량 판단 |
| 5 | 비도메인 | 1 | 가드 안정 감시 |
| 6 | 메타 | 2 | 후속쌍 1조 (자기요약·CoT 비누수) |
| 7 | 환각 | 2 | 가드 안정 감시 |
| 8 | 변칙 | 2 | 가드 안정 감시 |
| **합** | | **20** | |

5축(A도구·B환각·C후속·D멀티툴·E메타)이 모두 발현되도록 구성. 약점 3카테고리에 12/20을 배정.

## 실행법

러너(`phase2b_eval_freevar_runner.py`)는 `EVAL` 경로가 같은 디렉터리의 `phase2b_eval_freevar.jsonl`로 고정돼 있고 파일 지정 플래그가 없으므로, 러너를 **수정하지 않고** sentinel 파일을 가리키려면 모듈을 import 한 뒤 `EVAL`만 sentinel로 바꿔 실행한다 (`--jikgun` 등 옵션 그대로 sys.argv 로 전달 가능). 서버는 `PORT`(기본 3001)로 떠 있어야 한다.

```bash
cd /home/user/SEAGNAL/local_server/knowledge/phases
python3 -c "import phase2b_eval_freevar_runner as r; from pathlib import Path; r.EVAL = Path('phase2b_sentinel.jsonl').resolve(); r.main()"
```

20케이스 × `PACING_S=3s` ≈ 60초(+응답 지연)로 약 3분 내 회귀 게이트 완료. (`--jikgun`/`--limit` 없이 sentinel 전체 20건 직렬 실행.)

[2차 검토] 이상 없음
