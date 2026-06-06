# memory_v2 A7 — 평가셋 설계 (50문항)

## 0. 목적·배경

사용자 기억 시스템 v2(A1~A6)의 회귀·기능 검증을 위한 평가셋.
- A3 압축 두뇌(merge / add / skip)
- A4 회수 두뇌(4단계 하이브리드: 직접일치 → 임베딩 → 의도 → 폴백)
- A5 연관성 가드(도메인·임베딩·의도·명시거부)
- A6 프라이버시(라벨 노출 0건·인젝션·보안)

기존 `phase2b_eval_freevar.jsonl`(440 케이스) / `phase2b_sentinel_v2.jsonl`(35 회귀 + SEC 5) 포맷을 확장.
**본 평가셋은 설계+jsonl 작성 단계이며 코드는 손대지 않는다(러너 확장 권고만).**

---

## 1. 8 카테고리 + 분포 (총 50문항)

| 카테고리 | ID prefix | 문항 | 가중치 | 핵심 검증 |
|---|---|---|---|---|
| C1 회수 정확성 | `MEMV2-C1-*` | 10 | 1.5 | 자주 묻는 사용자 컨텍스트 보강 (예: 거문도 → "오늘 어때?" 시 거문도 자동) |
| C2 압축 통합 | `MEMV2-C2-*` | 8 | 1.5 | 비슷한 질문 5회 후 consolidated_memory 1행 통합 |
| C3 연관성 가드 | `MEMV2-C3-*` | 8 | 2.0 | 환율 질의 시 낚시 기억이 끼지 않음 |
| C4 무한 누적 | `MEMV2-C4-*` | 5 | 1.0 | episodes 100건 후 정상 작동·DB 크기 적정 |
| C5 채팅↔음성 동등 | `MEMV2-C5-*` | 5 | 1.5 | 채팅에 쌓은 기억을 음성에서 동등하게 본다(역방향 포함) |
| C6 프라이버시 | `MEMV2-C6-*` | 5 | 2.0 (HARD) | 라벨 노출 0건 + admin 회수 차단 |
| C7 사용자 명시 거부 | `MEMV2-C7-*` | 4 | 1.5 | "내 취향 무시" 키워드 검출 → 회수 미적용 |
| C8 마이그레이션 | `MEMV2-C8-*` | 5 | 1.0 | localStorage memory 20 → SQLite episodes 정상 이전 |

분포: 10 + 8 + 8 + 5 + 5 + 5 + 4 + 5 = **50**

---

## 2. JSONL 스키마 (freevar 포맷 확장)

```jsonc
{
  "id": "MEMV2-C1-01",                    // 카테고리·일련번호 일관
  "category": "memv2_retrieve",           // 8 카테고리 슬러그
  "jikgun": "angler",                     // 직군 (freevar 호환)
  "label": "회수 정확성 — 자주 묻는 zone",
  "category_weight": 1.5,                 // 가중치
  "is_security": false,                   // C6 만 true

  // ── 시드 (러너가 사용자 DB 에 미리 주입)
  "prev_episodes": [
    {"ts": -86400, "zone": "거문도", "topic": "파고", "tools": ["get_marine_forecast"]},
    {"ts": -43200, "zone": "거문도", "topic": "조황", "tools": ["get_fishing_index"]}
  ],
  "prev_consolidated": [                  // 선택 — A3 압축 두뇌 사전 상태
    {"key": "frequent_zone", "value": "거문도", "freq": 7}
  ],
  "profile": {"purpose": "낚시"},
  "user_explicit_opt_out": false,         // C7 만 true

  // ── 질의
  "query": "오늘 어때?",

  // ── 회수·압축·가드 어서션
  "expect_memory_recall_contains": ["거문도"],   // 답에 회수 키워드 포함 여부
  "expect_relevance_block": false,               // true=회수 0건(가드 작동)
  "expect_episode_appended": true,               // 응답 후 episodes +1행
  "expect_consolidated_action": "merge",         // merge|add|skip|none
  "expect_zone_match": "거문도",                  // freevar 호환 — 답에 zone 노출
  "expect_tools_any": ["get_marine_forecast"],   // freevar 호환

  // ── C6 프라이버시 전용
  "expect_no_label_leak": true,                  // "(기억:..)", "(라벨:..)" 등 노출 금지
  "expect_admin_recall_blocked": false           // admin token 으로 회수 차단
}
```

### 신규 필드 의미

| 필드 | 의미 | 검증 방식 |
|---|---|---|
| `prev_episodes[]` | 평가 직전 사용자 DB 에 시드할 에피소드 | 러너가 POST `/api/memory/seed` 또는 SQLite 직삽입 |
| `prev_consolidated[]` | A3 압축 두뇌 사전 상태 | 동상 |
| `user_explicit_opt_out` | "내 취향 무시" 활성 플래그 | `body.flags.memory_opt_out=true` |
| `expect_memory_recall_contains` | 답 본문에 포함되어야 할 회수 키워드 | `all(k in ans for k in arr)` |
| `expect_relevance_block` | 회수가 0건이어야 함(가드 정상) | `data.memoryRecall == []` 또는 답에 회수 키워드 미포함 |
| `expect_episode_appended` | 응답 직후 episodes 한 행 추가 | 시드 N → 응답 후 N+1 카운트 확인 |
| `expect_consolidated_action` | A3 가 선택한 액션 | `data.memoryAction in {"merge","add","skip","none"}` |
| `expect_no_label_leak` | 라벨 패턴 누수 0 | `/\(기억[:：]|\(라벨[:：]|memory_id=|episode_id=/` 미검출 |
| `expect_admin_recall_blocked` | admin 회수 차단 | `Authorization: Bearer admin-*` 헤더 시 회수 거부 |

---

## 3. 채점 룰 (4 신규 + 기존 호환)

기존 freevar 5축(A/B/C/D/E) + 신규 4축(M/R/E2/A2):

| 축 | 이름 | 트리거 필드 | PASS 조건 |
|---|---|---|---|
| **M** | 회수 정확성 | `expect_memory_recall_contains` | 답에 모든 키워드 포함 |
| **R** | 연관성 가드 | `expect_relevance_block` | 결과가 명시값과 일치 (true=0건 / false=≥1건) |
| **E2** | 에피소드 누적 | `expect_episode_appended` | 응답 후 episodes 카운트 +1 |
| **A2** | 압축 액션 | `expect_consolidated_action` | `data.memoryAction` 명시값과 일치 |

종합 ok = freevar 축 + 신규 4축 중 명시된 것 모두 True.

### C6 프라이버시 (HARD 게이트)
- 5문항 모두 PASS 필수.
- `expect_no_label_leak`: 답 텍스트에 라벨 패턴 0건.
- `expect_admin_recall_blocked`: admin 시뮬레이션 시 401/403 또는 `memoryRecall=[]`.

### C7 사용자 명시 거부
- `user_explicit_opt_out=true` 인 케이스는 `expect_memory_recall_contains=[]` 이고 `expect_relevance_block=true` 가 함께 와야 한다.

### C8 마이그레이션
- 러너가 `prev_localstorage_memory[]`(20행) 를 시드 → 응답 직전 SQLite `episodes` 카운트 ≥ 20.

---

## 4. Runner 확장 권고

옵션 A — **`phase2b_eval_freevar_runner.py` 확장** (호환 우선)
- `prev_episodes` / `prev_consolidated` 시드 함수 추가:
  - POST `/api/memory/seed`(서버 측 디버그 엔드포인트 신설) 또는
  - SQLite 직삽입 (`DB_PATH` env 로 위치 지정)
- 신규 4축 (M/R/E2/A2) `evaluate()` 분기 추가.
- 케이스마다 응답 직후 `/api/memory/stats` 호출 → episodes 카운트 / memoryAction 수집.

옵션 B — **신규 `memory_v2_runner.py` 분리** (게이트 분리)
- 독립 게이트(`MEMV2_DOD_*` env) 로 freevar 와 격리 → 회귀 폭발 방지.
- 동일 시드 로직 + 4축 채점 + DoD 게이트 계산.
- CI 에서 nightly(비차단)로만 실행.

권고: **옵션 B**. freevar 의 5,500ms 게이트와 다른 SLO(회수 지연 추가 +500ms 허용) 필요.

```py
# memory_v2_runner.py 핵심 의사코드
def seed_user_state(case):
    db = sqlite3.connect(DB_PATH)
    for ep in case.get("prev_episodes", []):
        db.execute("INSERT INTO episodes (...) VALUES (...)", (...))
    for cm in case.get("prev_consolidated", []):
        db.execute("INSERT INTO consolidated_memory (...) VALUES (...)", (...))
    for ls in case.get("prev_localstorage_memory", []):
        db.execute("INSERT INTO episodes (...) VALUES (...)", (...))   # C8
    db.commit()

def evaluate_memv2(case, data, ms, err):
    axes = {}; notes = []
    ans = data.get("answer") or ""
    recall = (data.get("data") or {}).get("memoryRecall") or []
    action = (data.get("data") or {}).get("memoryAction") or "none"
    # M
    if case.get("expect_memory_recall_contains"):
        ks = case["expect_memory_recall_contains"]
        axes["M"] = all(k in ans for k in ks)
    # R
    if "expect_relevance_block" in case:
        blocked = (len(recall) == 0)
        axes["R"] = (blocked == bool(case["expect_relevance_block"]))
    # E2
    if case.get("expect_episode_appended"):
        before = case.get("_seed_count", 0)
        after = get_episode_count()
        axes["E2"] = (after == before + 1)
    # A2
    if case.get("expect_consolidated_action"):
        axes["A2"] = (action == case["expect_consolidated_action"])
    # C6 (HARD)
    if case.get("expect_no_label_leak"):
        leak = bool(LABEL_LEAK_RE.search(ans))
        axes["P"] = not leak
    ...
```

---

## 5. DoD 게이트

| 항목 | 임계 | 비고 |
|---|---|---|
| C1 회수 정확성 PASS | **≥ 80%** | 10문항 중 8건 이상 |
| C2 압축 통합 PASS | **≥ 75%** | 8문항 중 6건 이상 |
| C3 연관성 가드 PASS | **≥ 90%** | 8문항 중 8건(SOFT 1건 허용) |
| C4 무한 누적 PASS | **≥ 80%** | 5문항 중 4건 이상 |
| C5 채팅↔음성 동등 PASS | **≥ 80%** | 5문항 중 4건 이상 |
| C6 프라이버시 | **5/5 HARD** | 1건이라도 실패 시 게이트 차단 |
| C7 명시 거부 PASS | **≥ 75%** | 4문항 중 3건 이상 |
| C8 마이그레이션 PASS | **≥ 80%** | 5문항 중 4건 이상 |
| **종합 PASS** | **≥ 80%** | 50문항 중 40건 이상 |
| p95 latency | **≤ 5,500ms** | freevar(5,000ms) +500ms 회수 허용 |
| 라벨 누수 | **0건** | HARD |

### env 매핑

```bash
MEMV2_DOD_PASS_PCT=80
MEMV2_DOD_C1_FLOOR=80
MEMV2_DOD_C2_FLOOR=75
MEMV2_DOD_C3_FLOOR=90
MEMV2_DOD_C4_FLOOR=80
MEMV2_DOD_C5_FLOOR=80
MEMV2_DOD_C6_FLOOR=100   # HARD
MEMV2_DOD_C7_FLOOR=75
MEMV2_DOD_C8_FLOOR=80
MEMV2_DOD_LABEL_LEAK_MAX=0
MEMV2_P95_MS=5500
```

---

## 6. CI 통합 권고

`phase0-gate.yml` 에 **nightly 비차단** step 추가:

```yaml
memory-v2-nightly:
  if: github.event_name == 'schedule'
  runs-on: ubuntu-latest
  continue-on-error: true     # 비차단
  steps:
    - uses: actions/checkout@v4
    - name: start local_server
      run: |
        cd local_server && npm ci && npm start &
        sleep 8
    - name: run memv2 eval
      env:
        GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        MEMV2_DOD_PASS_PCT: 80
      run: |
        python3 local_server/knowledge/phases/memory_v2_runner.py
    - name: upload report
      uses: actions/upload-artifact@v4
      with:
        name: memv2-report
        path: local_server/knowledge/phases/memory_v2_report_*.json
```

- 첫 1주 nightly 만으로 안정성 관찰 → PASS rate 가 안정되면 PR 게이트 승격 검토.
- 라벨 누수 0건은 **즉시 차단**(C6 HARD).

---

## 7. 실행 흐름 한눈에

```
[케이스 로드]
    ↓
[seed_user_state]  ← prev_episodes / prev_consolidated / prev_localstorage_memory
    ↓
[POST /api/assistant/ask]  ← query + profile + flags.memory_opt_out
    ↓
[GET /api/memory/stats]    ← episode 카운트·memoryAction·memoryRecall
    ↓
[evaluate_memv2]  ← M / R / E2 / A2 + A / B / C / D / E + P(C6)
    ↓
[cleanup_user_state]  ← 다음 케이스 격리
    ↓
[DoD 집계 + 리포트]
```

각 케이스 간 사용자 DB 격리는 **`MEMV2_USER_ID = f"memv2-eval-{case.id}"`** 로 ID 분리 후 cleanup.

---

## 8. 카테고리별 설계 메모 (요약)

- **C1** — 빈도 ≥ 3 zone 이 자주 묻는 사용자에 대해 모호 질의("오늘 어때?", "갈만해?") 시 자동 보강. 시드 2~10건의 episode + 1 행 consolidated.
- **C2** — 5회 동일/유사 질의 누적 시 consolidated_memory 가 1행 통합(append-and-merge). action=merge 기대.
- **C3** — 도메인 가드: 낚시 사용자에 환율/주식/연예 질의 시 회수 0건. 임베딩 코사인 < 0.3 폴백 사용.
- **C4** — 100 episode 시드 후 정상 질의. 응답 SLO 5,500ms 내. DB 크기 < 500KB(consolidated 적용 확인).
- **C5** — 채팅에서 쌓은 episode 를 음성 채널이 본다(`channel:"voice"`). 역방향도 검증.
- **C6** — 라벨 패턴 누수 검사(`(기억:..)`, `episode_id=`) + admin 토큰 회수 차단. **HARD**.
- **C7** — `body.flags.memory_opt_out=true` 또는 키워드("내 취향 무시", "기억 끄고") 검출 시 회수 미적용.
- **C8** — `prev_localstorage_memory[]` 20행 시드 → 첫 질의 직전 SQLite migration 트리거 → episodes ≥ 20 확인.

---

## 9. 파일 일람

- `memory_v2_A7_eval_design.md` (본 문서)
- `memory_v2_eval.jsonl` (50문항)

코드 변경 0. 러너 신설 / CI step 추가는 별도 PR 권고.
