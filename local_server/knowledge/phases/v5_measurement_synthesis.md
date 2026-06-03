# v5 측정 종합 운용 문서 (옵션 가 합성: A + B)

> **목적:** 자유변칙 v5 전체측정(440 케이스)을 가동·완주·해석·다음 패치 결정까지 한 문서로 수행한다.
> **출처:** `v5_measurement_frame_A.md`(운영 SOP 시점) + `v5_measurement_frame_B.md`(결함 패턴·ROI 시점). 두 원문은 출처 참조만, 본 문서가 단일 운용 정본.
> **베이스라인:** v2 320/440(72%) → v3 321/440(72%, 부분상쇄) → v4 sentinel 16/20(80%) → v5 미수.
> **흐름:** SOP → 체크리스트 → 측정 → 비교표 → 결함 5축 분류 → ROI → 우선순위 → 게이트.
> **작성 시각:** 2026-06-03.

---

## 0. 한눈에 보는 v5 사이클

```
[§1 사전 체크]──▶[§2 러너 BG 가동]──▶[§3 모니터링]──▶[§4 캡처·비교표]──▶[§5 5축 분류·회귀 diff]──▶[§6 ROI·우선순위]──▶[§7 게이트 판정]
```

소요 예상 35~45분(`PACING_S=3.0` 직렬). 60분 초과 → §3.4 강제 종료. 동시 패치 상한 3건(§6.4).

---

## 1. 측정 시작 전 체크리스트 (C1~C5)

> 모두 PASS 가 아니면 측정 보류 — 결함이 *우리* 패치인지 *환경* 인지 구분 못한다(2026-05-30 marine.kma 403 사례).

### 1.1 서버·데이터 사전 점검

| # | 항목 | 확인 명령(요지) | 합격 기준 |
|---|------|-----------------|-----------|
| C1 | 로컬 서버 살아있음 | `curl -s http://127.0.0.1:3001/api/health` | HTTP 200 + `ok:true` |
| C2 | marine.kma 데이터 적재 | `ls -la data/marine_buoys.json data/marine_vs.json data/marine_wh_buoys.json` | 3 파일 ≥ 1KB, mtime ≤ 24h |
| C3 | 임베딩 캐시 hit | `ls -la data/topic_embeddings.json data/tool_embeddings.json` | 두 파일, 169 topic / 19~20 tool |
| C4 | 직군 임계표 로드 | `cat knowledge/jikgun/_thresholds.json | head -3` | 9 직군 키 모두 존재 |
| C5 | 평가셋 무회귀 | `python3 knowledge/phases/phase2b_eval_runner.py --n=3` | PASS 10/10 |

> C2 실패: 적재 잡 먼저. 측정은 가능하나 *판정 권한* 상실.
> C5 실패: 골든 깨짐 — 자유변칙 측정 의미 없음. 즉시 차단.

### 1.2 입력 자산

| 항목 | 확인 | 비고 |
|------|------|------|
| `phase2b_eval_freevar.jsonl` 라인 수 | `wc -l` = **440** | 변경 시 코드 회귀 신호 |
| 직군 분포 | 8 직군 × 55 = 440 (angler/fishery/marine_leisure/coast_guard/navy/mof/local_gov/public_org) | — |
| 러너 SHA | `git log -1 --format=%h knowledge/phases/phase2b_eval_freevar_runner.py` | v3 시점 SHA 와 동일 여부 기록 |

### 1.3 환경 변수·외부 키

- `GEMINI_API_KEY` quota 여유 ≥ 1500 req (440 × ~3 호출 ≒ 1320).
- `KMA_DMDW_USER_ID/PWD`, `TIDEBED_KEY` 활성 — 가드만으로 거짓 PASS 방지.
- 시계: `date` — UTC/KST 혼선 점검(시정·예보 timestamp 비교용).

---

## 2. 측정 실행 SOP

### 2.1 표준 가동(BG)

```bash
cd /home/user/SEAGNAL/local_server
mv -f /tmp/freevar.log /tmp/freevar_prev_$(date +%Y%m%d_%H%M%S).log 2>/dev/null
nohup python3 -u knowledge/phases/phase2b_eval_freevar_runner.py \
  > /tmp/freevar.log 2>&1 &
echo $! > /tmp/freevar.pid
disown
```

> `-u`(unbuffered) 필수. PID 파일은 §3.4/§3.5 에서 사용.

### 2.2 부분 측정(스팟 디버그용 — 본측정 금지)

- 1 직군만: `--jikgun=local_gov`
- 상위 N건: `--limit=20`
- 부분 PASS율로 전체를 추정하지 않는다.

### 2.3 가동 직후 메타 캡처

```bash
{
  echo "=== v5 measurement meta ==="
  date -u +"start_utc=%Y-%m-%dT%H:%M:%SZ"
  git -C /home/user/SEAGNAL rev-parse HEAD
  git -C /home/user/SEAGNAL status --porcelain | head -20
  cat /tmp/freevar.pid
} > /tmp/freevar_meta.txt
```

→ §4.6 "측정 컨텍스트" 행으로 사용.

---

## 3. 진행 모니터링

### 3.1 실시간 tail

```bash
tail -f /tmp/freevar.log
```

기대 패턴(LOG_EVERY=10): 헤더 → `[10/440] 경과 35s …` … `[440/440] 경과 2230s …` → 종합 블록.

### 3.2 폴링 주기

| 단계 | 간격 | 확인 |
|------|------|------|
| 0~30s | 1회 | 헤더 출력 여부 |
| 30s~5분 | 60s | [10/440] [20/440] 누락 없이 진행 |
| 5분~30분 | 5분 | 케이스당 ~5s 비례 |
| 30분~ | 1분 | 종합 블록 등장 감지 |

> `tail -n 30 /tmp/freevar.log` 로 충분. `cat` 금지(수십 MB 가능).

### 3.3 비정상 신호·대응

| 신호 | 해석 | 대응 |
|------|------|------|
| 30s 안에 헤더 없음 | 서버 미가동 / EVAL 경로 오류 | §3.4 종료 → §1 재점검 |
| `HTTP 429` >5건/100케이스 | Gemini quota | 중단, 키 교체 후 §3.5 재시작 |
| `HTTP 5xx` 다발 | 서버 죽음 | 중단, 재가동, 처음부터 |
| `fetch failed` 다발 | 외부 KMA 장애 | 중단(§1 C2 재점검) — 결과는 *환경 결함* 라벨 |
| 케이스당 평균 > 8s | LLM 지연·다중도구 폭주 | 종료 안 함, p95 악화 신호로 기록 |
| 진행 라인 5분간 없음 | 서버 hang / timeout 미작동 | 즉시 종료 |

### 3.4 강제 종료

```bash
PID=$(cat /tmp/freevar.pid)
kill -TERM $PID; sleep 5
ps -p $PID > /dev/null && kill -KILL $PID
tail -n 50 /tmp/freevar.log | grep -E '^\s*\[' | tail -1
```

### 3.5 재시작 (체크포인트 없음 — 처음부터)

1. `/tmp/freevar.log` → `/tmp/freevar_aborted_<ts>.log` 보존.
2. §1.1 체크리스트 재실행(특히 C2/C3).
3. §2.1 표준 가동.
4. 정본은 *마지막 완주 1회*. 이전 회는 메타에 `discarded: <사유>`.

### 3.6 진행률 한 줄 헬퍼

```bash
awk '/^  \[[0-9]+\/440\]/ {n=$1; t=$3} END {gsub(/[\[\]\/440]/,"",n); gsub(/s/,"",t); if(n>0) printf "done=%s/440 elapsed=%ss eta=%.0fs\n", n, t, (440-n)*t/n}' /tmp/freevar.log
```

---

## 4. v3 → v5 비교 표 템플릿 (측정 직후 채움)

### 4.1 종합

| 항목 | v3 (2026-05-30) | v5 (TBD) | Δ | 메모 |
|------|-----------------|----------|---|------|
| 종합 PASS | 321/440 (72%) | __/440 (__%) | __ | Δ = v5_pct − v3_pct |
| 지연 p50 | 1328ms (v2 기준) | __ms | __ | v3 미기록 시 v2 사용 |
| 지연 p95 | 6712ms (v2 기준) | __ms | __ | DoD 5000ms 게이트 |
| 지연 평균 | __ms | __ms | __ | n 도 기록 |
| CoT 누수 | 0 | __ | __ | 0 유지가 항구성 가드 |
| 환각 의심 | 6 (v2) | __ | __ | LG-7-02 류 재발 여부 |
| 실패 건수 | 119 | __ | __ | = total − pass |
| 소요 분 | 37.2 | __ | __ | ±5분 이상 차이 → 환경 의심 |

### 4.2 직군별 PASS%

| 직군 | v2 | v3 | v5 | Δ(v3→v5) | 임계(70%) |
|------|----|----|----|----------|-----------|
| angler | 74% | __% | __% | __ | __ |
| fishery | 74% | __% | __% | __ | __ |
| marine_leisure | 56% | **69%** | __% | __ | __ |
| coast_guard | **78%** | 70% | __% | __ | __ |
| navy | 76% | __% | __% | __ | __ |
| mof | **81%** | 78% | __% | __ | __ |
| local_gov | 65% | __% | __% | __ | DoD 위험 직군 |
| public_org | 74% | 70% | __% | __ | __ |

> v3 빈칸은 측정 종합 블록 행을 그대로 옮기고, 부재 시 `n/a` 표기 + v5↔v2 보조비교.

### 4.3 카테고리별 PASS% (8 카테고리)

| 카테고리 | v2 | v3 | v5 | Δ(v3→v5) | DoD | 결함 축 |
|----------|----|----|----|----------|-----|---------|
| 1.기본 | 85% | 89% | __% | __ | ≥ 90% | A_tool |
| 2.연속 | 48% | 43% | __% | __ | +10pp | C_continuity |
| 3.다중 | 60% | 58% | __% | __ | +10pp | A_multitool |
| 4.정량 | 15% | **28%** | __% | __ | ≥ 40% | D_decision |
| 5.비도 | 98% | 96% | __% | __ | 유지 | (가드) |
| 6.메타 | 84% | 79% | __% | __ | 회복 | E_meta |
| 7.환각 | 98% | 96% | __% | __ | ≥ 98% | B_halluc |
| 8.변칙 | 98% | 100% | __% | __ | 유지 | (가드) |

> **A·B 정합 확인:** A 의 카테고리 1~8 ↔ B 의 5축 매핑(A_tool=cat1·3, C_continuity=cat2, D_decision=cat4, E_meta=cat6, B_halluc=cat7). cat5/8 은 양측 모두 *가드 카테고리* 로 동일 처리.

### 4.4 지연 분포

```
지연 SLO  p50=__ms  p95=__ms  평균=__ms  n=__
```

| 지표 | v5 | DoD | 통과 |
|------|----|-----|------|
| p50 | __ms | ≤ 2000ms | __ |
| p95 | __ms | ≤ 5000ms (R2-06 게이트) | __ |
| 평균 | __ms | ≤ 2500ms | __ |

### 4.5 CoT·환각 샘플 캡처 (불변식 가드)

| 종류 | 건수 | 샘플 ID | 응답 일부(120자) | 비고 |
|------|------|---------|------------------|------|
| CoT 누수 | __ | __ | __ | >0 → #5/#24 회귀, **P0 즉시 롤백** |
| 환각 의심 신규 | __ | __ | __ | LG-7-02 류 재발 여부 |

### 4.6 측정 컨텍스트(메타)

| 키 | 값 |
|----|----|
| 시작(UTC) | __ |
| 종료(UTC) | __ |
| git HEAD | __ |
| dirty 파일 | __ |
| C1~C5 결과 | __ |
| 비정상 신호 | __ |

---

## 5. 결함 5축 분류기 + 회귀 자동 추출

> 입력 가정: `phase2b_eval_freevar_v5_results.jsonl` (케이스당 1행, 키 `{id, jikgun, category, label, pass, tools_called, response, latency_ms, halluc_suspect, cot_leak, prev_id, expect_*}`).

### 5.1 5축 분류기 (한 패스)

```
for each line r in v5_results:
  jb[r.jikgun].push(r); cb[r.category].push(r); idx[r.id] = r
  if not r.pass:
    fail.push(r); jbf[r.jikgun]++; cbf[r.category]++
    # A_tool — 도구 미사용/오선택
    if r.expect_tools_any and not any(t in r.tools_called for t in r.expect_tools_any):
      bucket["A_tool"].push(r)
    # A_multitool — 다중도구 누락
    if r.expect_tools_all and not all(t in r.tools_called for t in r.expect_tools_all):
      bucket["A_multitool"].push(r)
    # B_halluc — 비기상·도메인외 단정
    if r.halluc_suspect or HALLUC_RE.search(r.response):
      bucket["B_halluc"].push(r)
    # C_continuity — 후속 zone 전파 실패
    if r.prev_id and r.expect_zone_match and r.expect_zone_match not in r.response:
      bucket["C_continuity"].push(r)
    # D_decision — 가부결론 첫 줄 없음
    if r.expect_decision and not DECISION_RE.match(r.response):
      bucket["D_decision"].push(r)
    # E_meta — 메타·자기요약(cat6 후속쌍)
    if r.category == 6 and r.prev_id:
      bucket["E_meta"].push(r)
  # CoT 누수는 PASS 여부와 별개 (가드 회귀 감시)
  if COT_RE.search(r.response): cot.push(r)
```

- `HALLUC_RE` = `"사망자|법령 제\d+|매뉴얼|통계|GDP|인구|평균기온"` 비기상 키워드 + 숫자 단정.
- `DECISION_RE` = `"^(가능|불가|위험|안전|주의|보류)"` (#21 임계표 효과 검증).
- `COT_RE` = `"내부 사고|메타 코멘트|\[focus\]|\[memory\]|단계 1\.|먼저 계획"` (#5·#24 항구성).

### 5.2 직군 outlier(variance gate)

```
mean_j = avg(jb_pass_rate)
sigma_j = stdev(jb_pass_rate)
outlier = {j | jb_pass_rate[j] < mean_j − 1.5·sigma_j}
floor_violation = outlier ∩ {pass_rate < 70%}   # DoD #25
```

> v3 outlier: marine_leisure 69%, local_gov 65%.

### 5.3 회귀·회복·신규 환각/CoT 자동 추출

```python
# diff_v3_v5.py — 자유변칙 v3 vs v5 차분
from pathlib import Path
import json
from collections import Counter

V3 = Path("phase2b_eval_freevar_v3_results.jsonl")
V5 = Path("phase2b_eval_freevar_v5_results.jsonl")
OUT = Path("v5_regression_diff.md")

def load(p):
    return {json.loads(l)["id"]: json.loads(l) for l in p.read_text().splitlines() if l.strip()}

def axis(r):
    if r.get("prev_id") and r.get("expect_zone_match") and r["expect_zone_match"] not in r.get("response",""):
        return "C_continuity"
    if r.get("expect_tools_all") and not all(t in r.get("tools_called",[]) for t in r["expect_tools_all"]):
        return "A_multitool"
    if r.get("expect_decision") and not r.get("response","").startswith(("가능","불가","위험","안전","주의","보류")):
        return "D_decision"
    if r.get("halluc_suspect"): return "B_halluc"
    if r.get("category") == 6 and r.get("prev_id"): return "E_meta"
    if r.get("expect_tools_any") and not any(t in r.get("tools_called",[]) for t in r["expect_tools_any"]):
        return "A_tool"
    return "?"

def main():
    v3, v5 = load(V3), load(V5)
    reg, rec, new_h, new_c = [], [], [], []
    for i in sorted(set(v3) | set(v5)):
        a, b = v3.get(i), v5.get(i)
        if not (a and b): continue
        if a.get("pass") and not b.get("pass"):
            reg.append({"id": i, "jikgun": b["jikgun"], "cat": b["category"], "axis": axis(b),
                        "tools_v3": a.get("tools_called"), "tools_v5": b.get("tools_called")})
        if not a.get("pass") and b.get("pass"):
            rec.append({"id": i, "jikgun": b["jikgun"], "cat": b["category"]})
        if b.get("halluc_suspect") and not a.get("halluc_suspect"):
            new_h.append(i)
        if "내부 사고" in b.get("response","") and "내부 사고" not in a.get("response",""):
            new_c.append(i)
    rc_cat = Counter(r["cat"] for r in reg)
    rc_jik = Counter(r["jikgun"] for r in reg)
    rc_ax  = Counter(r["axis"] for r in reg)
    lines = ["# v3 → v5 회귀·회복 차분",
             f"- 회귀 {len(reg)}건 / 회복 {len(rec)}건 / 신규환각 {len(new_h)} / 신규CoT {len(new_c)}",
             "## 회귀 카테고리 분포", *[f"- cat{c}: {n}" for c,n in rc_cat.most_common()],
             "## 회귀 직군 분포", *[f"- {j}: {n}" for j,n in rc_jik.most_common()],
             "## 회귀 축 분포",   *[f"- {a}: {n}" for a,n in rc_ax.most_common()],
             "## 회귀 케이스 목록",
             *[f"- {r['id']} [{r['jikgun']}/cat{r['cat']}/{r['axis']}] tools v3={r['tools_v3']} → v5={r['tools_v5']}" for r in reg],
             "## 신규 환각 / CoT 누수 (불변식)",
             *[f"- 환각 신규: {i}" for i in new_h],
             *[f"- CoT 신규: {i}" for i in new_c]]
    OUT.write_text("\n".join(lines), encoding="utf-8")

if __name__ == "__main__": main()
```

**판정 게이트:** `new_halluc == 0 and new_cot == 0` 가 아니면 v5 결과는 **불변식 위반** — 다음 패치 사이클 보류, 단독 가드 패치만 진행.

### 5.4 5개 자동 리포트 섹션

1. 카테고리 행렬: `fail_rate[c] × Δ` 표.
2. 직군 floor 위반표: outlier 직군 + 실패 카테고리 분포.
3. 회귀 케이스 목록: id·jikgun·category·축.
4. 신규 환각·CoT 누수 목록: 0 이면 "불변식 보존".
5. 축별 top-N: 실패가 모인 `(jikgun, category)` 셀.

---

## 6. 패치 ROI 계산 + 우선순위

### 6.1 ROI 공식

```
ROI(patch) = Σ_{c ∈ targets(patch)} fail_count[c] × effect[c, patch] × decay[c]
            − cost(patch) − risk(patch)
```

- `fail_count[c]` : v5 에서 카테고리 c 실패 케이스 수.
- `effect[c, patch]` : 가설 패치 회복률 (0~1). 과거 실측 보정:
  - #21(임계표) → cat4 +13%p → effect ≈ 0.20 감쇠.
  - #22(focus 결정론) → cat2 −5%p **회귀** → effect ≈ −0.10 (음수).
  - #23(직군 floor) → marine_leisure +13%p → effect ≈ 0.20.
  - #27(args 매핑) → cat2 회복 기대 — v5 측정으로 확정.
- `decay[c]` : 이미 PASS 높은 카테고리(변칙 100%)는 ≤ 0.1 강감쇠.
- `cost` : 구현 LoC × 0.001 + 회귀 위험 가중.
- `risk` : 다른 카테고리 회귀 확률 × 그 카테고리 PASS%. 불변식 카테고리(5·7·8) 는 risk ↑↑.

### 6.2 카테고리 × 가설패치 ROI 매트릭스 (v3 실측 → v5 fail_count 주입 시 자동 재계산)

| 카테고리 (실패수) | P_quant_v2 | P_continuity_v2 | P_multitool | P_meta_v2 | P_halluc_v2 | P_jikgun_floor |
|---|---|---|---|---|---|---|
| 4 정량 (28 fail) | **+5.6** | 0 | 0 | 0 | 0 | 0 |
| 2 연속 (45 fail) | 0 | **+9.0** | 0 | 0 | 0 | 0 |
| 3 다중 (17 fail) | 0 | 0 | **+5.1** | 0 | 0 | 0 |
| 6 메타 (17 fail) | 0 | +1.7 | 0 | **+3.4** | 0 | 0 |
| 7 환각 (≤2 fail) | 0 | 0 | 0 | 0 | +0.4 | 0 |
| 직군 floor 위반(가중) | +1 | +2 | +1 | 0 | 0 | **+4** |
| **ROI 합** | **6.6** | **12.7** | **6.1** | **3.4** | **0.4** | **4.0** |
| 회귀 risk (불변식) | 낮음 | **중**(#22 전례) | 낮음 | 낮음 | 낮음 | 낮음 |
| **B의 권고 순위** | 2 | **1(가드 동시)** | 3 | 5 | 6 | 4 |

### 6.3 통합 우선순위 — A 의 P0~P5 (게이트) × B 의 ROI ranking

> **합성 규칙:** A 의 P0~P5 는 **조건부 게이트**(가드/플로어/카테고리 임계의 하드 컷오프), B 의 ROI 는 **게이트 통과 후 자원 배분**. 따라서 위에서 아래로 **A 게이트를 먼저** 적용, P5 진입 직전 단계에서 **B ROI rank 로 다음 패치 후보를 정렬**한다.

| 순위 | 조건 (A) | 액션 | B ROI 후보(통과 시) |
|------|----------|------|---------------------|
| **P0** | CoT 누수 > 0 또는 환각 의심 신규 ≥ 2 | §5.3 게이트 위반 — **즉시 롤백 + 가드 재점검**, 다른 패치 보류 | (단독) P_halluc_v2 / 가드 정규식 |
| **P1** | 직군 PASS < 60% 1개 이상 | 해당 직군 전용 디지스트·임계표 보강(#23 류) | **P_jikgun_floor** (ROI 4.0) |
| **P2** | 카테고리 PASS < 30% 1개 이상 | ROI 가장 큰 1개만(#21 류) | **P_quant_v2** (ROI 6.6) — cat4 < 30% 시 |
| **P3** | 직군 floor 70% 미달 1~2개 | 직군 × 카테고리 매트릭스 → 표적 패치 | **P_jikgun_floor** + 분포에 따라 P_continuity_v2 |
| **P4** | 지연 p95 > 5000ms 또는 평균 > 2500ms | 도구 호출 다이어트(다중 임계·timeout 단축·web_search 조기차단·synth 분기) | (별도 트랙) #31 후보 |
| **P5** | 전부 통과 (직군 ≥70%·카테고리 ≥40%·p95 ≤5000) | **DoD 충족 → 자유변칙 게이트화** (머지 차단 조건 등재) | — |

> **A·B 정합:** A 의 P0(불변식)와 B 의 `risk_to_invariant == 0` 필터는 완전 일치. 충돌은 P2 와 ROI 1위가 다를 때 — 본 문서는 **A 게이트 우선**(절대치 임계가 ROI 계산보다 견고).

### 6.4 동시 적용·격리 규칙

- 단일 사이클(48h) **최대 3건** — 초과 시 회귀 원인 분리 불가.
- 불변식 카테고리(5·7·8) `risk ≠ 0` 패치는 **단독 사이클 격리**, 회귀 시 즉시 롤백.
- **격리 쌍**: `P_continuity_v2 + P_quant_v2` 는 args 주입 경로 겹쳐 분리.
- **동시 가능 쌍**: `P_continuity_v2 + P_multitool`.

### 6.5 롤백 결정

- 직전 라운드 N건 중 어느 것이 회귀를 일으켰는지 모르면 → **N건 전체 롤백 + 1건씩 재적용** 하며 단일 직군 부분 측정으로 가설 검증.
- 부분 측정은 *방향성*; 최종 채택은 전체 440 재측정으로.

---

## 7. 누적 결함 라이프사이클 표 (v5 측정 후 갱신)

| 결함 id | 최초 관측 | 적용 패치 | 적용 시점 | 측정 효과 | 잔여 | 다음 패치 후보 |
|---|---|---|---|---|---|---|
| **#1** focus 후속 전파 실패 | v1 8-agent | deriveFocus(query)+detectZone | v1→v2 | 평가셋 PASS 10/10 | cat2 48% | #22 로 이어짐 |
| **#3** 메타·자기요약 약함 | v1 8-agent | synth 메타 규칙 | v1→v2 | 평가셋 회귀 0 | cat6 84%→79% | **P_meta_v2** |
| **#4** 정량임계 부재 | v1 8-agent | synth 의사결정 규칙 | v1→v2 | 평가셋 유지 | cat4 15% | #21 로 이어짐 |
| **#5** CoT 누수(coast_guard Q5) | v1 8-agent | synth "내부 사고 금지" | v1→v2 | **CoT 0/440** | 0 (가드 항구성) | 모니터만 |
| **#21** 정량 임계 판정기 | v2 cat4 15% | `_thresholds.json` 9직군 + synth 임계표 + 가부결론 한 줄 먼저 | v2→v3 | **cat4 +13%p** ✅ | sentinel LG-4-01/MOF-4-01 decision word 부재 | **P_quant_v2** — 정량 수치만 있어도 발동 |
| **#22** focus 후속 전파 강화 | v2 cat2 48% | 대명사 검출 + zone 결정론 주입 | v2→v3 | **cat2 −5%p** ❌ 회귀 | sentinel ANG-2-01b 잔존 | **P_continuity_v2** — focus TTL + 도구별 args 매핑 + 갈등시 query 우선 |
| **#23** 직군 floor 보강 | v2 marine_leisure 56% | leisure 해변→get_surfing_index / local_gov 모호→GPS·전국 | v2→v3 | **marine_leisure +13%p** ✅ / local_gov 65→? | local_gov v3 65% 잔존, sentinel LG-1-01 "관내"→web_search | **P_jikgun_floor** — local_gov 행정구역 fuzzy |
| **#24** memory 출력 누수(ANG-6-03b) | v2 | synth 컨텍스트 격리 + 후처리 라벨 라인 제거 | v2→v3 | **누수 사라짐** ✅ | 0 (가드 항구성) | 모니터만 |
| **#27** #22 회귀 디버그 (args 매핑) | v3 cat2 −5%p | `FOCUS_ZONE_ARG` 도구별 매핑 + focus.buoy→buoyName + PRONOUN_RE 보수화 | v3→v4 | sentinel cat2 75% (v3 43% 대비 회복) | **v5 cat2 실측이 핵심** | (부족시) P_continuity_v2 |
| **#28** LG-7-02 환각 추적 | v3 신규 환각 | synth "비기상 거절" 규칙 | v3→v4 | sentinel 환각 0 | **v5 환각 카운트 미수** | (재발시) P_halluc_v2 — 도메인 분류기 |
| **#29** #22 vs marine_leisure trade-off | v3 | 분석 액션 (패치 없음) | v3→v4 분석 | sentinel 부분 회복 | **v5 직군×cat 매트릭스 확정** | — |
| **#30 (v5 신규 후보)** cat3 다중도구 60% 정체 | v3 60→58% | — | — | — | v5 측정 후 확정 | **P_multitool** — planQuery 카테고리별 hint |
| **#31 (v5 신규 후보)** p95 ≥5000ms DoD 미달 | sentinel 6588ms | — | — | — | v5 p95 미수 | 임베딩 캐시·web_search 조기차단·synth 짧은 응답 분기 |

### 7.1 라이프사이클 상태 요약

- **완전 해결(가드 항구성):** #5(CoT) · #24(memory). 모니터만.
- **명확한 회복:** #21(cat4 +13) · #23(marine_leisure +13).
- **trade-off 잔존:** #22 / #27. v5 cat2 측정치가 효과 확정.
- **신규 회귀 추적:** #28(LG-7-02). v5 환각 카운트.
- **신규 후보:** #30 다중도구 · #31 p95.

---

## 8. 결과 요약 템플릿 + 산출물 배치

### 8.1 결과 요약(3~5줄)

```
v5: PASS __/440 (__%). v3 대비 Δ=__pp.
직군 floor: __(__%) — DoD 70% __합/미달.
카테고리 우선순위 잔여: 연속 __% / 다중 __% / 정량 __%.
신규 결함 후보: <케이스 ID 또는 패턴 키워드>.
지연 p95 __ms — DoD __합/미달.
불변식: CoT __ / 환각 신규 __ — (보존 / 위반).
```

### 8.2 산출물 폴더

```
phases/
  v5_measurement_frame_A.md      ← 출처(운영 SOP 시점)
  v5_measurement_frame_B.md      ← 출처(결함·ROI 시점)
  v5_measurement_synthesis.md    ← (본 문서, 단일 운용 정본)
  v5_result_summary.md           ← 완료 후 §4 표 채운 정본
  v5_regression_diff.md          ← §5.3 스크립트 산출
  freevar_v5.log                 ← /tmp/freevar.log 영구 보관
  freevar_v5_meta.txt            ← /tmp/freevar_meta.txt 영구 보관
```

→ §7(00_MASTER_PLAN)에 한 줄 등재: `v5 — 440 케이스 PASS __/__ (__%), 직군 floor __, p95 __ms, 다음 패치 P_ 채택`.

---

## 9. 자동화 호출 시퀀스 (v5 종료 직후)

```
1. diff_v3_v5.py            # §5.3 회귀·회복·신규 환각/CoT
2. 카테고리·직군 행렬 갱신    # §4.2 / §4.3 / §5.2
3. ROI 매트릭스 재계산       # §6.2 (fail_count 주입)
4. 라이프사이클 v5 칼럼 채움  # §7
5. A 게이트 P0~P5 평가       # §6.3
6. 패치 top3 (격리 규칙) 출력 # §6.4
7. DoD 게이트 판정           # 아래 §10
```

`/loop` 로 러너 종료 신호 후 자동 트리거.

---

## 10. 다음 사이클 진입 게이트 (Phase 3 vs v6 재측정)

```
if v5_pass >= 85% and jikgun_floor >= 70% and category_floor >= 70%
   and new_halluc == 0 and new_cot == 0 and p95 <= 5000:
    → Phase 3 착수 (DoD #25 통과, 자유변칙 머지 차단 조건 등재)
else:
    → 상위 ROI 3건 (§6.3 A 게이트 + §6.2 B ROI 정렬) → v6 측정
```

---

## 11. 한계·주의 (A·B 공통 + 합성 시 주의)

- 러너는 **단일 실행** — 비결정성 보호 없음(`--n=3` 다수결과 다름). v5 PASS 가 v3 와 ±2pp 안이면 노이즈 가능성 인정.
- `PACING_S=3.0` + 직렬 → 케이스간 LLM 상태 누수 없음(서버측 memory 비움 가정). 임베딩 캐시는 공유.
- v3 카테고리/직군 수치는 일부만 §7(00_MASTER_PLAN)에 명시. v5 표 채울 때 빈칸은 `n/a`, v5↔v2 보조.
- **A 게이트와 B ROI 가 충돌**(예: P2 카테고리 < 30% 이지만 ROI 1위가 P_continuity_v2)할 때는 **A 게이트 우선**. ROI 는 동일 게이트 내 후보 정렬용.
- B 의 ROI effect 가중은 **과거 패치 실측 1회씩**만 학습 — 새 패치 effect 는 보수적으로 ≤ 0.2 적용.
- 본 문서는 *측정 + 해석 + 의사결정* 까지. PR/머지/롤아웃은 후속 합의.

---

(끝)
