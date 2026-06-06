# 옵션 γ — v5 측정 자동화 합성 R2 (사전점검 → 실행 → 분석 파이프라인 정합)

> **목적:** γ-A(`preflight_v5.sh`/`run_v5.sh`) + γ-B(`analyze_v5.py`) 두 산출물을 단일 파이프라인으로 묶고, 두 산출물 간 정합 격차·결정·SOP 갱신 의사코드를 본 문서에 박제한다.
> **상위 SOP:** `v5_measurement_synthesis.md`(이전 라운드 합성, 단일 운용 정본).
> **본 문서:** 합성·결정 전용. **신규 .md 1개**. 기존 산출물·코드 일체 수정 금지. 직접 측정 실행 금지.
> **작성 시각:** 2026-06-04.

---

## 0. 한 그림 — γ 통합 파이프라인

```
                 ┌──────────── γ-A ──────────────┐    ┌────── γ-B ──────┐
[사람 한 줄]──▶│ preflight_v5.sh   C1~C5 게이트│──▶│ analyze_v5.py    │──▶ v5_result_summary.md
   │           │       │PASS=0 / FAIL=1        │    │  stdin/--log=    │      ROI top3
   │           │       ▼                       │    │  → /tmp/v5_..md  │      A 게이트(P0~P5)
   │           │ run_v5.sh  (BG + 폴링)        │    │                  │      마스터플랜 §7 한 줄
   │           │  └─[--auto-restart] 1회 복구  │    │                  │
   │           └─── /tmp/freevar.log ──────────┘──▶─┘                  │
   │              (러너 stdout 원형)                    파서 입력 동일   │
   └─────────────────────────── 메타: /tmp/freevar_meta.txt ────────────┘
```

---

## 1. 파이프라인 정합성 — 러너 stdout vs 파서 입력

### 1.1 결론

**`run_v5.sh` 가 만든 `/tmp/freevar.log` 는 `analyze_v5.py` 의 `parse_log()` 가 그대로 소비 가능하다.** 두 도구는 동일 러너(`phase2b_eval_freevar_runner.py`)의 stdout 형식을 가정으로 만들어졌고, `run_v5.sh` 는 형식 변환·필터링·접두어 부착 없이 `nohup python3 -u … > /tmp/freevar.log 2>&1` 으로 raw 파이프만 한다(L88). 즉 파서 입력 파일은 러너 원형 그대로다.

### 1.2 필드·구분자·줄 단위 매핑 검증

| # | 러너 출력(`phase2b_eval_freevar_runner.py` 실제 라인) | `run_v5.sh` 처리 | `analyze_v5.py` 정규식 | 매칭 |
|---|--------------------------------------------------------|------------------|-----------------------|------|
| 헤더 | `=== Phase 2b 자유 변칙 평가 — N 케이스 직렬 실행 ===` (L169) | grep `=== Phase 2b`(L132) | (분석은 사용 안 함; 검출만) | OK |
| 진행 | `  [10/440] 경과 35s …` (L182) | awk `[n/440]` n,t 추출(L123) | (분석은 진행 라인 사용 안 함) | OK — 라인 형식이 양쪽 동일 패턴 가정 |
| 직군 PASS | `  angler            PASS 41/55  (74%)` (L215, 16자 ljust) | — | `RE_JIKGUN_LINE`: `^\s*([a-z_]+)\s+PASS\s+(\d+)\s*/\s*(\d+)\s*\((\d+)%\)\s*$`(L121) | **OK** — `\s+` 가 16자 공백 패딩 흡수 |
| 카테고리 헤더 | `  직군             | 기본 연속 다중 정량 비도 메타 환각 변칙`(L219) | — | `RE_CAT_HEADER`: `^\s*직군\s*\|`(L124) | OK |
| 카테고리 행 | `  angler           | 5/7 3/7 6/10 …`(L222~226, `pass:>2d/total:<2d ` 형식, 셀당 공백 1) | — | `RE_CAT_ROW` → `RE_CELL`: `(\d+)\s*/\s*(\d+)`(L126~128) | **OK** — 8 셀 순서대로 추출 후 `cat_order[idx]` 매핑 |
| SLO | `지연 SLO  p50=1328ms  p95=6712ms  평균=1990ms  n=440`(L229) | — | `RE_SLO` 동일 토큰(L129) | OK |
| 카운트 | `실패 119건 · CoT 누수 의심 0건 · 환각 의심 6건`(L231) | — | `RE_FAIL` 동일 토큰(L132) | OK |
| 종합 | `==== 종합 PASS 320/440 (72%) · 소요 2232s ====`(L247) | grep `종합 PASS|==== 종합`(L128) | `RE_TOTAL`(L135) | **OK** — `run_v5.sh` 종료 트리거와 동일 토큰 |
| CoT 샘플 | `[CoT 누수 샘플]` + `  CG-7-02 (coast_guard): 'thinking: …'` | — | `RE_COT_SAMPLE_HDR`(L138) + `RE_SAMPLE_LINE`(L141) | OK |
| 환각 샘플 | `[환각 의심 샘플]` + 동일 형식 | — | `RE_HALLUC_SAMPLE_HDR`(L139) | OK |
| 실패 샘플 | `[실패 샘플 — 처음 10건]` | — | `RE_FAIL_SAMPLE_HDR`(L140) | OK |

**잠재 라인 충돌 한 곳:** `RE_JIKGUN_LINE` 은 카테고리 섹션에 들어가지 않은 일반 `angler … PASS x/y (z%)` 라인도 잡는다. 카테고리 행은 `|` 가 들어 있고 `PASS` 가 없으므로 충돌 없음. 본 파서가 `section != "cat"` 가드(L191)도 추가로 걸어 안전.

### 1.3 인코딩·줄끝·버퍼링

- `-u`(unbuffered, `run_v5.sh` L88 + SOP §2.1) 으로 stdout 즉시 flush → tail/폴링이 헤더·진행 라인을 놓치지 않음.
- 파일 인코딩 UTF-8 (한국어 라벨 직접 매칭). `analyze_v5.py` 는 `read_text(encoding="utf-8", errors="replace")`(L530)로 안전 폴백.
- 줄끝 `\n` 단일. `--stdin` 경로(L523)는 파이프 입력도 동일하게 splitlines.

**합성 결정 D1:** *러너 stdout → `/tmp/freevar.log` → analyze_v5.py* 의 파이프라인은 **변환 단계 0** 으로 운영한다. 어떤 미들웨어(awk/sed)도 끼우지 않는다. `run_v5.sh` 가 보존본을 만들 때도 `cp/mv` 만 사용한다(현 구현이 이미 그러함).

---

## 2. C3 임베딩 경로 불일치 흡수 — SOP 정정 박제

### 2.1 사실 관계

| 출처 | 명시 경로 |
|------|----------|
| `v5_measurement_synthesis.md` §1.1 C3 (L31) | `data/topic_embeddings.json data/tool_embeddings.json` |
| 실제 코드 `services/topic_embedding.js` (γ-A 조사) | `knowledge/graph/topic_embeddings.json`, `knowledge/graph/tool_embeddings.json` |
| `preflight_v5.sh` C3 (L86~87) | `knowledge/graph/{topic,tool}_embeddings.json` ← 실측 경로로 정정 사용 |
| `gamma_runtime_A.md` §2 (L40) | `knowledge/graph/{topic,tool}_embeddings.json` ← 실측 경로 정착 |

→ **SOP(synthesis.md §1.1) 한 칸이 잘못된 경로를 명시**. γ-A 스크립트는 SOP 와 다른 실측 경로를 자동 사용했다. 두 도구가 동시에 신뢰 가능하려면 SOP 측을 정정해야 한다.

### 2.2 합성 결정 D2 (정본화)

**`knowledge/graph/{topic,tool}_embeddings.json` 가 정본**. `data/topic_embeddings.json` 표기는 SOP 오타로 폐기. 후속 측정·자동화·문서 갱신은 모두 `knowledge/graph/` 경로를 사용한다.

근거: 코드 = 단일 진실 원본(`services/topic_embedding.js` L27, L171), 파일 시스템 실측, `preflight_v5.sh` 통과 조건이 코드를 기준으로 잡혀 있음.

### 2.3 `v5_measurement_synthesis.md` 갱신 의사코드 (적용 금지 — 본 라운드는 합성만)

```text
# 적용 대상: /home/user/SEAGNAL/local_server/knowledge/phases/v5_measurement_synthesis.md
# 라인 31 (§1.1 C3 행), 변경 1곳.

old:
| C3 | 임베딩 캐시 hit | `ls -la data/topic_embeddings.json data/tool_embeddings.json` | 두 파일, 169 topic / 19~20 tool |

new:
| C3 | 임베딩 캐시 hit | `ls -la knowledge/graph/topic_embeddings.json knowledge/graph/tool_embeddings.json` | 두 파일, 169 topic / 19~20 tool (코드 정본: services/topic_embedding.js L27,L171; gamma_synthesis_R2 §2.2 결정 D2) |
```

> 본 라운드 산출은 *합성*. 위 의사코드는 다음 사이클(별 라운드)에서 1줄 패치로 적용. 합성·운용 분리 원칙.

---

## 3. 3단계 실행 SOP (end-to-end 명령 시퀀스)

> **표준 한 줄**: `bash knowledge/phases/run_v5.sh` 만 쓰면 preflight 가 내부 호출된다. 아래는 *명시적 단계별* 시퀀스로, 자동화/디버그/CI 어느 쪽에도 그대로 옮길 수 있다.

### 3.1 표준 시퀀스 (사람·자동화 공통)

```bash
cd /home/user/SEAGNAL/local_server

# (1) 사전점검 — C1~C5 게이트. exit 0 만 다음 단계 진행.
bash knowledge/phases/preflight_v5.sh
RC=$?
[ "$RC" = "0" ] || { echo "[abort] preflight FAIL rc=$RC"; exit "$RC"; }

# (2) BG 실행 + 폴링 + 자동 복구. /tmp/freevar.log 에 stdout 그대로 적재.
bash knowledge/phases/run_v5.sh --auto-restart
RC=$?
[ "$RC" = "0" ] || { echo "[abort] run FAIL rc=$RC"; exit "$RC"; }

# (3) 분석 + 리포트 — /tmp/freevar.log 자동 로드.
python3 knowledge/phases/analyze_v5.py \
    --log=/tmp/freevar.log \
    --out=knowledge/phases/v5_result_summary.md
```

### 3.2 보관 시퀀스 (R2 권고 — 측정 1건당 영구본 1쌍 + 리포트 1)

```bash
# (4) 영구 보관본 + 리포트 한 묶음 (run_v5.sh 종료 후 안내 명령)
TS=$(date -u +%Y%m%dT%H%M%SZ)
cp /tmp/freevar.log      knowledge/phases/freevar_v5_${TS}.log
cp /tmp/freevar_meta.txt knowledge/phases/freevar_v5_${TS}_meta.txt
python3 knowledge/phases/analyze_v5.py \
    --log=knowledge/phases/freevar_v5_${TS}.log \
    --out=knowledge/phases/v5_result_summary_${TS}.md
```

### 3.3 stdin 경로 (CI / 단발 점검)

```bash
# 측정 로그가 임시 파이프에 있을 때(예: nohup 없이 포어그라운드 측정)
python3 knowledge/phases/phase2b_eval_freevar_runner.py \
  | tee /tmp/freevar.log \
  | python3 knowledge/phases/analyze_v5.py --stdin --out=/tmp/v5_rep.md
```

> `--stdin` 은 `analyze_v5.py` L516 에서 처리. tee 분기 시 진행 라인도 콘솔 + 파일 양쪽으로 본다.

### 3.4 실패 시 분기

| 단계 | 종료 코드 | 의미 | 다음 행동 |
|------|-----------|------|-----------|
| preflight | 1 | C1~C5 중 FAIL | `gamma_runtime_A.md` §7 트러블슈팅 표 → 항목 조치 후 (1) 재실행 |
| run | 1 | preflight 재진입 시 FAIL | 동상 |
| run | 2 | 헤더 미출력 30s | 서버/모듈 임포트 점검 (`tail /tmp/freevar.log`) |
| run | 3 | MAX_RUN_S 초과 | 외부 의존성(Gemini quota/marine.kma) 점검 후 재시도 |
| run | 4 | 자동 재가동 실패 | `node server.js` 수동 기동 후 §3.1 (1)부터 |
| run | 5 | stall + 재시작 비활성/소진 | `--auto-restart` 없이 두 번 죽었다 — 환경 결함 라벨링 |
| run | 6 | 러너 PID 사망 + 종합 블록 없음 | 비정상 — `/tmp/freevar.log` 마지막 30 라인 검토 (이미 자동 출력) |
| analyze | 2 | 로그 파일 없음 | 경로/권한 확인. `--log=` 명시 |
| analyze | 3 | 직군별 종합 블록 미발견 | 측정 중단 로그 — 분석 의미 없음. 재측정 |

---

## 4. A 게이트(P0~P5) × ROI 합성식

### 4.1 격차 — γ-B 코드와 SOP §6.3 의 미세 차이

| 항목 | γ-B `analyze_v5.py` (코드 사실) | SOP §6.3 합성 규칙 | 격차 |
|------|-------------------------------|-------------------|------|
| P0 | `cot > 0 or halluc >= 2` (L275~276) | 동상 | OK |
| P1 | `직군 PASS < 60% 1개 이상` (L281) | 동상 | OK |
| P2 | `카테고리 PASS < 30% 1개 이상` (L286) | 동상 | OK |
| P3 | `직군 floor 70% 미달 1~2개` 표기 / **코드는 1~2 개수 상한 미적용** (L291) | "1~2개" 라는 수량 한정 | **차이** — 코드는 "1개 이상이면 위반" 으로만 평가. "3개 이상은 다른 의미"는 인간 판정 영역 |
| P4 | `p95 > 5000ms OR avg > 2500ms` (L296) | 동상 | OK |
| P5 | `not P0 and all jik≥70 and all cat≥70(cat4 제외) and overall≥85 and p95≤5000` (L301~307) | "직군 ≥70·카테고리 ≥40·p95 ≤5000" | **차이** — 코드는 카테고리 floor 70% (cat4 만 별도), SOP §6.3 P5 행은 40%. **코드가 더 엄격**, DoD 본문(synthesis §10)과 일치 |

### 4.2 합성 결정 D3 — A 게이트 우선, ROI 무효화 분기

**A 게이트 P0 위반 시 ROI 산출은 표시만 하고 채택은 차단한다.** 이는 γ-B §9 통합 권고가 이미 구현한 정책이다(L470: `if g.get("P0"): … 다른 패치 전면 보류 … 가드 패치만 진행`). 본 합성에서 이를 공식화한다.

**합성식 (의사코드 — 합성 검증 전용, 코드 미수정):**

```python
gates = gate_status(parsed)            # γ-B L265
g = {lvl: met for lvl, met, _ in gates}
roi = roi_table(parsed)                # γ-B L244

if g["P0"]:                            # 불변식 위반 (최고 우선)
    action = "rollback_only"
    candidates = ["P_halluc_v2"]       # 가드 단독 사이클
    roi_published = "informational_only"  # 표시는 하되 채택 금지
elif g["P5"]:                          # DoD 완전 통과
    action = "phase3_entry"
    candidates = []
    roi_published = "skip"
else:
    # P1~P4 는 자원 배분 단계 — ROI 가 결정권
    action = "next_patch_cycle"
    # 불변식 risk == 0 우선, 부족하면 risk 포함
    safe_top3 = [r for r in roi if r[2] == 0][:3] or roi[:3]
    candidates = safe_top3
    # γ-B §9 격리 규칙은 후처리로 합성 (P_continuity_v2 + P_quant_v2 금지)
    if g["P4"]:
        candidates += [("track_b_latency", "tool diet (#31)")]
```

### 4.3 게이트 × ROI 결합 표 (확정 정책)

| 게이트 상태 | A 게이트 액션 | B ROI 사용법 | 마스터플랜 §7 등재 |
|-------------|---------------|--------------|--------------------|
| P0 위반 | 즉시 롤백 + 가드 정규식 점검, 다른 패치 전면 보류 | **무효화** (표시만, 채택 금지) | "v5 — … CoT N/환각 N, 불변식 위반 - 롤백 우선." (analyze §10 자동 부착 — γ-B L497) |
| P1 위반 | 해당 직군 전용 디지스트·임계표 보강 | risk=0 ∩ 표적 카테고리 일치 ROI 1위 채택 (대개 `P_jikgun_floor`) | 동상 |
| P2 위반 | ROI 1위 1개만 적용 (카테고리 절대 침몰) | risk=0 ROI 1위 1건 단독 | 동상 |
| P3 위반 | 직군 × 카테고리 매트릭스 표적 | risk=0 ROI top1~2 + 격리 규칙 적용 (가능 쌍만) | 동상 |
| P4 위반 | 도구 다이어트 별도 트랙 (#31) | 별도 트랙 — 동일 사이클 PR 분리 권고 | 별도 한 줄 |
| P5 통과 | DoD 충족, Phase 3 진입 | **사용 안 함** (다음 사이클 자유변칙은 머지 차단 조건) | "v5 — … DoD 충족, Phase 3 진입." |

**ROI 무효화 의미:** "무효화" 는 *값 계산 자체* 가 아니라 *채택 가능 후보 리스트로의 진입* 을 막는 의미다. 리포트에는 ROI 표가 그대로 출력되되, §9 통합 권고 블록이 `P_halluc_v2 / 가드 단독` 으로 고정 출력된다(γ-B L471 이 이미 구현). 합성식 D3 는 이 동작을 정책으로 박제한다.

---

## 5. 자동 재시작과 분위수 — γ-A `--auto-restart` 가 통계에 미치는 영향

### 5.1 메커니즘

`run_v5.sh --auto-restart` 가 1회 작동(L197 또는 L229)하면:

1. `/tmp/freevar.log` → `/tmp/freevar_aborted_<ts>.log` 로 이동 (L211 / L236).
2. 러너 재시작 → 새 `/tmp/freevar.log` 생성, **처음부터 다시**.
3. `analyze_v5.py` 가 읽는 입력은 **재시작 후 새 로그만**.

결과: 첫 회의 부분 진행분 latency 표본은 영구 보존본에 들어가지 않고, 두 번째 회의 440 케이스 전체 latency 가 SLO 분위수(p50/p95/평균)를 결정한다. 러너 자체가 라인 `[i/440]` 카운터를 0부터 다시 시작하므로 i 충돌 없음.

### 5.2 분위수 왜곡 — 두 가지 결

| 결 | 왜곡 형태 | 검출 가능성 |
|----|-----------|-------------|
| **A: 깨끗한 재시작** (서버 재가동 직후 정상) | 두 번째 회 latency 만 집계. p50/p95/평균 모두 *재시작 후 환경* 을 정확히 반영. SOP 의 "정본은 마지막 완주 1회" 원칙과 정합. | latency 분위수만으로는 재시작 발생 자체를 검출 불가 |
| **B: 잠재 후속 영향** (warmup·캐시 hit 차이) | 재시작 직후 임베딩 캐시는 워밍업 상태이므로 cat3(다중 도구) 의 첫 ~20 케이스가 느릴 수 있음. p95 가 비합리적으로 한 케이스에 끌릴 위험 | p95 vs p50 격차가 평소 대비 2배 이상이면 재시작 그림자 의심 |

### 5.3 raw vs net 차이로 검출 가능한가

**γ-B 의 분석기는 단일 입력(로그 1개)만 본다.** 따라서 raw(첫 회 + 두 번째 회) vs net(두 번째 회만) 비교를 자동으로 하지 못한다. 단, **재시작 발생 사실은 외부 시그널로 확실히 잡힌다**:

| 시그널 출처 | 검출 방법 |
|------------|-----------|
| `/tmp/freevar_aborted_*.log` 존재 | `ls -1 /tmp/freevar_aborted_*.log 2>/dev/null | wc -l` ≥ 1 |
| `run_v5.sh` 콘솔 로그 | "러너 재시작 (1회 한정)" 문자열 (L210) |
| `freevar_meta.txt` | `--auto-restart` 시 `capture_meta()` 가 두 번 호출되어 start_utc 가 갱신됨 (L213) |
| 영구 보관본 파일 수 | 재시작 1회 발생 → `freevar_aborted_*.log` 1개 + `freevar.log` 1개 |

### 5.4 합성 결정 D4 — 메타 한 행 추가 + 분위수 신뢰도 라벨

**`run_v5.sh` 의 `capture_meta()` 가 출력하는 `/tmp/freevar_meta.txt` 에 `restart_count=N` 한 줄을 새 라운드에서 추가하는 것을 다음 사이클 1줄 패치로 권고.** 본 라운드는 합성만 — 즉 의사코드만 박제:

```text
# 적용 대상: run_v5.sh capture_meta() (L96~107)
# 변경: 메타에 RESTART_COUNT 변수 echo. start_runner 내부 카운터 +1.

# 코드 변경 의사코드 (합성 박제):
RESTART_COUNT=${RESTART_COUNT:-0}     # 전역 카운터, 초기화 0
start_runner() {
  ...                                  # 기존 동일
  RESTART_COUNT=$((RESTART_COUNT + 1))
}
capture_meta() {
  {
    ...                                # 기존 동일
    echo "restart_count=$RESTART_COUNT" # 1=첫 가동, 2=1회 재시작
  } > "$META"
}
```

**분석기 측은 두 옵션 중 하나:**

- (옵션 a) `analyze_v5.py` 가 meta 파일을 동시 읽기 (`--meta=<path>` 신규 옵션). restart_count > 1 이면 리포트 §3 지연 게이트 위쪽에 *"분위수 신뢰도: 재시작 1회 — p95 ±10% 해석 폭"* 한 줄 부착.
- (옵션 b) 분석기는 그대로, 운용자가 `freevar_v5_meta.txt` 영구본을 직접 확인.

**합성 권고: (b)** — 분석기 코드 무수정 원칙 유지. 메타 한 줄 추가만으로 인간 판정 충분. 단, 다음 사이클에서 (a) 도입 시 5분 작업.

### 5.5 자동 재시작이 발생한 측정의 신뢰도 정책

| 결과 | 라벨 |
|------|------|
| `restart_count = 1` (단발 가동, 재시작 없음) | **정본** |
| `restart_count = 2` (1회 재시작 후 완주) | **잠정 정본** — 동일 패치로 1회 재측정 권고 (특히 cat3 p95 변동 추적) |
| `restart_count ≥ 3` 또는 두 번째도 실패 | **무효** (synthesis §3.5 "이전 회는 메타에 discarded") |

---

## 6. 마스터플랜 §6 next-actions 권고 — 통합 PR 패턴 반복

### 6.1 단일 사이클(48h) 표준 루프

```
[γ 파이프라인 1 회]
  ├─ Step 1  preflight_v5.sh           ← C1~C5 PASS 보장
  ├─ Step 2  run_v5.sh --auto-restart  ← 35~45분 정상 완주
  ├─ Step 3  analyze_v5.py             ← v5_result_summary.md 생성
  │                                       (직군/카테고리/지연/ROI/A게이트/권고)
  └─ Step 4  결정 분기:
        ├─ P0 위반 → α 패턴 가드 단독 PR (P_halluc_v2 또는 가드 정규식)
        ├─ P5 통과 → Phase 3 진입 PR (DoD #25 등재)
        └─ 그 외 → analyze §9 권고의 risk=0 ROI top3 채택 + 격리 규칙 적용
[α 통합 PR 1 건] (필요 시)
  ├─ 동시 패치 ≤ 3건 (synthesis §6.4)
  ├─ 단일 작업 분기 + 자유변칙 320/440 무회귀 + 평가셋 10/10 무회귀 검증
  └─ 마스터플랜 §7 한 줄 등재 (analyze_v5.py §10 자동 산출)
[다음 사이클]
  ├─ git pull, 다시 [γ 파이프라인 1 회]
  └─ 회귀 감지 시 §6.5 부분 측정으로 1건씩 격리
```

### 6.2 권고되는 다음 액션 순서 (마스터플랜 §6 등재용)

1. **(R2-운영)** 본 합성 D2 의 SOP 정정 패치 1줄(`v5_measurement_synthesis.md` §1.1 C3) — 다음 사이클 첫 PR에 포함, 측정 의존성 정정.
2. **(R2-측정 1회)** `bash knowledge/phases/run_v5.sh` 1회 실행 → `analyze_v5.py` 자동 후속 → `v5_result_summary.md` 생성. **본 합성 산출물 검증 + 실측 첫 사이클**.
3. **(R2-패치 선정)** 분석 리포트 §9 통합 권고의 risk=0 ROI top3 채택. 격리 규칙(§6.4) 준수 — `P_continuity_v2 + P_quant_v2` 동시 금지, `P_continuity_v2 + P_multitool` 동시 가능.
4. **(R2-α PR)** 위 top3 를 단일 PR(자유변칙 무회귀 + 평가셋 무회귀)로 묶어 머지. α 패턴 반복.
5. **(R2-루프)** 머지 직후 (2)로 복귀 → 다음 사이클. P5 도달까지 반복.
6. **(R2-가드 트랙)** 어느 사이클에서든 P0 위반 발생 시 (3·4)를 폐기하고 가드 단독 사이클로 분기. ROI 결과는 정보 표시만 채택 금지.

### 6.3 게이트 도달 시 분기

| 조건 | 다음 액션 | 산출 |
|------|-----------|------|
| 1 회 측정으로 P5 즉시 통과 | Phase 3 진입 PR + 자유변칙을 머지 차단 조건으로 CI 등재 | `MASTER_PLAN.md` §6 #25 closed, Phase 3 kickoff doc |
| 2~3 사이클로 점진 도달 | 각 사이클 후 `v5_result_summary_<TS>.md` 누적 → `v3→v5→v6→…` 회복 trend 표 갱신 | synthesis §7 라이프사이클 표 v5/v6 칼럼 채움 |
| P0 위반 반복 (가드 회귀 잔존) | #28 (LG-7-02 환각) 류 디버그를 단독 트랙으로 분리. ROI 활동 보류 | 별도 디버그 노트 |
| 5 사이클 누적해도 P5 미도달 | DoD 임계 재검토 (synthesis §10) — 카테고리 floor 70% 가 현 LLM 한계와 정합하는지 | 마스터플랜 §6 재정렬 PR |

---

## 7. 산출물 위치 요약

| 신규 1 | 경로 | 비고 |
|--------|------|------|
| 본 문서 | `/home/user/SEAGNAL/local_server/knowledge/phases/gamma_synthesis_R2.md` | 합성 R2 — 파이프라인 정합 + 3단계 SOP + A 게이트·ROI 결합식 + 분위수 정책 |

| 기존 (참조만, 수정 금지) | 경로 |
|-------------------------|------|
| γ-A 사전점검 | `knowledge/phases/preflight_v5.sh` |
| γ-A 실행 자동화 | `knowledge/phases/run_v5.sh` |
| γ-A 사용법 | `knowledge/phases/gamma_runtime_A.md` |
| γ-B 분석 | `knowledge/phases/analyze_v5.py` |
| γ-B 사용법 | `knowledge/phases/gamma_analysis_B.md` |
| 상위 SOP (D2 의사코드 적용 대상) | `knowledge/phases/v5_measurement_synthesis.md` (§1.1 C3 1줄) |

---

## 8. 합성 후 곧바로 할 일 한 줄

```bash
cd /home/user/SEAGNAL/local_server && bash knowledge/phases/run_v5.sh --auto-restart && \
python3 knowledge/phases/analyze_v5.py --out=knowledge/phases/v5_result_summary.md
```

이 한 줄이 본 합성의 *실측 첫 사이클* 이다. preflight 가 SOP 의 잘못된 `data/topic_embeddings.json` 경로가 아닌 코드 실측 `knowledge/graph/{topic,tool}_embeddings.json` 경로를 점검하므로 C3 가 정확히 평가된다(D2). 종료 후 `v5_result_summary.md` 에 직군·카테고리·지연·ROI·A 게이트·통합 권고가 자동 채워진다.

---

(끝)
