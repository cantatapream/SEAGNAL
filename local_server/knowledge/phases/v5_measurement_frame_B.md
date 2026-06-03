# 자유변칙 v5 전체측정(440) 분석 프레임 — 시점 B

> **시점:** v5 측정 결과 수신 직후, 다음 패치 사이클 진입 전.
> **목적:** 결함 패턴 자동 분류 → 패치 ROI 계산 → 다음 패치 우선순위 확정.
> **전제:** v5 = v4(#27·#28 패치 후) 의 자유변칙 440 전체측정. Sentinel 20케이스 80% 통과 후 정식 측정. 베이스라인 = v2 320/440 (72%) → v3 321/440 (72%, 부분상쇄) → v4 sentinel 16/20(80%) → v5 미수.
> **독립 산출물 명시:** 시점 A worker 의 결과와 비교·정렬하지 않음.

---

## 1. 결함 패턴 식별 알고리즘

v5 결과 jsonl(가정: `phase2b_eval_freevar_v5_results.jsonl`, 케이스당 1행 `{id, jikgun, category, label, pass, tools_called, response, latency_ms, halluc_suspect, cot_leak, prev_id, expect_*}`) 을 입력으로 한다.

### 1.1 5축 분류기 (한 패스로 모든 축 산출)

```
for each line r in v5_results:
  jb[r.jikgun].push(r); cb[r.category].push(r); idx[r.id] = r
  if not r.pass:
    fail.push(r); jbf[r.jikgun]++; cbf[r.category]++
    # 축 A 도구미사용/오선택
    if r.expect_tools_any and not any(t in r.tools_called for t in r.expect_tools_any):
      bucket["A_tool"].push(r)
    if r.expect_tools_all and not all(t in r.tools_called for t in r.expect_tools_all):
      bucket["A_multitool"].push(r)
    # 축 B 환각 (도메인 외 정량 단정·미수집 사실 단정)
    if r.halluc_suspect or HALLUC_RE.search(r.response):
      bucket["B_halluc"].push(r)
    # 축 C 연속성 (prev_id 있고 zone_match 실패)
    if r.prev_id and r.expect_zone_match and r.expect_zone_match not in r.response:
      bucket["C_continuity"].push(r)
    # 축 D 정량판단 (expect_decision=true 인데 가부 결론 첫 줄 없음)
    if r.expect_decision and not DECISION_RE.match(r.response):
      bucket["D_decision"].push(r)
    # 축 E 메타·자기요약 (category 6 후속쌍)
    if r.category == 6 and r.prev_id:
      bucket["E_meta"].push(r)
  # CoT 누수는 PASS 여부와 별개로 항상 검사 (가드 회귀 감시)
  if COT_RE.search(r.response): cot.push(r)
```

`HALLUC_RE` = "사망자|법령 제\d+|매뉴얼|통계|GDP|인구|평균기온" 등 비기상 키워드 + 숫자 단정 패턴 (#28 가드 우회 잔존).
`DECISION_RE` = "^(가능|불가|위험|안전|주의|보류)" 첫 줄 매칭 (#21 임계표 효과 검증).
`COT_RE` = "내부 사고|메타 코멘트|\[focus\]|\[memory\]|단계 1\.|먼저 계획" (#5·#24 항구성).

### 1.2 카테고리별 실패율 계산

```
fail_rate[c] = cbf[c] / |cb[c]|
delta[c] = fail_rate_v5[c] − fail_rate_v3[c]   # 회귀/회복
```

출력 표(자동 생성):

| cat | 라벨 | v3 PASS% | v5 PASS% (측정후) | Δ | 우선 축 |
|-----|------|----------|-------------------|---|---------|
| 1 | 기본 | 89% | — | — | A_tool |
| 2 | 연속 | 43% | — | — | C_continuity |
| 3 | 다중 | 58% | — | — | A_multitool |
| 4 | 정량 | 28% | — | — | D_decision |
| 5 | 비도메인 | 100% | — | — | (가드) |
| 6 | 메타 | 79% | — | — | E_meta |
| 7 | 환각 | 96% | — | — | B_halluc |
| 8 | 변칙 | 100% | — | — | (가드) |

### 1.3 직군 편차 (variance gate)

```
mean_j = avg(jb_pass_rate)
sigma_j = stdev(jb_pass_rate)
outlier = {j | jb_pass_rate[j] < mean_j − 1.5·sigma_j}   # 직군 floor 위반 후보
```

v3 기준 `marine_leisure 69%`·`local_gov 65%` 가 outlier 였음. v5 에서 다시 계산해 `outlier ∩ {<70%}` 가 DoD #25(직군 floor ≥70%) 위반 직군.

### 1.4 회귀 케이스 자동 추출 (v3 PASS → v5 FAIL)

```
regressed = {id : v3[id].pass and not v5[id].pass}
recovered = {id : not v3[id].pass and v5[id].pass}
# 분포 진단
reg_by_cat = groupby(regressed, .category)
reg_by_jik = groupby(regressed, .jikgun)
# 패치 부작용 후보
# regressed 가 특정 카테고리에 집중 → 직전 패치(#27·#28)의 trade-off 의심
```

### 1.5 신규 환각 / 신규 CoT 누수

```
new_halluc = {id : v5[id] ∈ bucket["B_halluc"] and v3[id] ∉ bucket["B_halluc"]}
new_cot = {id : v5[id] ∈ cot and v3[id] ∉ cot}
# 불변식 위반 — 0 이 아니면 즉시 트랙1 패치(타 작업 보류)
```

v3 의 LG-7-02("산업재해 사망자 113명") 같은 도메인 외 환각이 v5 에서 어디로 이동했는지가 #28 패치(synth "비기상 거절") 의 실효성 척도.

### 1.6 산출 — 5개 자동 리포트 섹션

1. **카테고리 행렬**: `fail_rate[c] × Δ` 표.
2. **직군 floor 위반표**: outlier 직군 + 해당 직군의 실패 카테고리 분포.
3. **회귀 케이스 목록**: id·jikgun·category·축 라벨.
4. **신규 환각·CoT 누수 목록**: 0 이면 "불변식 보존" 한 줄.
5. **축별 top-N**: 실패가 가장 많이 모인 (jikgun, category) 셀.

---

## 2. 패치 ROI 추정

### 2.1 ROI 공식

```
ROI(patch) = Σ_{c ∈ targets(patch)} fail_count[c] × effect[c, patch] × decay[c]
            − cost(patch) − risk(patch)
```

- `fail_count[c]` : v5 에서 카테고리 c 의 실패 케이스 수 (관측치, 가중치 1).
- `effect[c, patch]` : 가설 패치가 c 의 실패를 회복시킬 비율 (0~1). 과거 패치 실측에서 보정:
  - #21(임계표) → cat4 +13%p (v2→v3 측정치) → effect ≈ 0.20 적용 (감쇠).
  - #22(focus 결정론) → cat2 −5%p **회귀** → effect ≈ −0.10 (역효과 가능, 음수 기록).
  - #23(직군 floor) → marine_leisure +13%p → effect ≈ 0.20.
  - #27(args 매핑) → cat2 회복 기대 (v5 측정으로 확정).
- `decay[c]` : 이미 PASS 가 높은 카테고리(예: 변칙 100%)에서는 추가 패치 효과 0.1 미만으로 강감쇠.
- `cost(patch)` : 구현 LoC × 0.001 + 회귀 위험 가중치.
- `risk(patch)` : 다른 카테고리 회귀 확률 × 그 카테고리 PASS% (불변식 카테고리는 risk ↑↑).

### 2.2 우선순위 ranking 규칙

```
candidates = [
  P_quant_v2,     # 정량 임계표 확장 (직군별 임계 추가·복합조건)
  P_continuity_v2,# 연속성 PRONOUN_RE 확장 + focus TTL 도입
  P_multitool,    # 다중도구 plan hint 카테고리별 강화 (cat3)
  P_meta_v2,      # 메타 자기요약 템플릿 (cat6 후속쌍)
  P_halluc_v2,    # 환각 가드 정규식 확장 + 도메인 분류기
  P_jikgun_floor, # 최저직군 전용 hint
]
rank = sorted(candidates, key=ROI, reverse=True)
gate = filter(rank, ROI > 0 and risk_to_invariant == 0)
top3 = gate[:3]   # 동시 패치 상한 3건 (회귀 추적 가능 한도)
```

### 2.3 카테고리 × 가설패치 예상효과 매트릭스 (v5 미수 — 가정 패치 후 시뮬레이션 양식)

| 카테고리 (실패수 예시) | P_quant_v2 | P_continuity_v2 | P_multitool | P_meta_v2 | P_halluc_v2 | P_jikgun_floor |
|---|---|---|---|---|---|---|
| 4 정량 (28 fail) | **+5.6** | 0 | 0 | 0 | 0 | 0 |
| 2 연속 (45 fail) | 0 | **+9.0** | 0 | 0 | 0 | 0 |
| 3 다중 (17 fail) | 0 | 0 | **+5.1** | 0 | 0 | 0 |
| 6 메타 (17 fail) | 0 | +1.7 | 0 | **+3.4** | 0 | 0 |
| 7 환각 (≤2 fail) | 0 | 0 | 0 | 0 | +0.4 | 0 |
| 직군 floor 위반(가중) | +1 | +2 | +1 | 0 | 0 | **+4** |
| **ROI 합** | **6.6** | **12.7** | **6.1** | **3.4** | **0.4** | **4.0** |
| 회귀 risk (불변식) | 낮음 | **중**(#22 전례) | 낮음 | 낮음 | 낮음 | 낮음 |
| **권고 순위** | 2 | **1(단, 회귀 가드 동시)** | 3 | 5 | 6 | 4 |

(셀 수치는 v3 측정치를 effect 로 환산한 산식 결과. v5 실측 fail_count 가 들어오면 자동 재계산.)

### 2.4 패치 동시 적용 규칙

- 단일 사이클(48h) 내 **최대 3건**. 그 이상이면 회귀 원인 분리 불가.
- **불변식 카테고리(5·7·8) risk ≠ 0 인 패치는 단독 사이클로 격리** — 회귀 시 즉시 롤백.
- **trade-off 자명한 쌍은 분리**: P_continuity_v2 + P_multitool 동시 가능, P_continuity_v2 + P_quant_v2 는 args 주입 경로 겹쳐 격리.

---

## 3. 회귀 케이스 자동 추출 스크립트 의사코드

```python
# diff_v3_v5.py — 자유변칙 v3 vs v5 회귀·회복 자동 추출
from pathlib import Path
import json

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
    ids = sorted(set(v3) | set(v5))
    reg, rec, new_h, new_c = [], [], [], []
    for i in ids:
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
    # 분포 집계
    from collections import Counter
    rc_cat = Counter(r["cat"] for r in reg)
    rc_jik = Counter(r["jikgun"] for r in reg)
    rc_ax  = Counter(r["axis"] for r in reg)
    # 마크다운 리포트 출력
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

**판정 게이트**: `new_halluc == 0 and new_cot == 0` 가 아니면 v5 결과는 **불변식 위반** 로 분류해 다음 패치 사이클을 보류하고 단독 패치만 진행.

---

## 4. v5 까지 누적 결함 라이프사이클 표

| 결함 id | 최초 관측 | 적용 패치 | 적용 시점 | 측정 효과 | 잔여 | 다음 패치 후보 |
|---|---|---|---|---|---|---|
| **#1 focus 후속 전파 실패** | v1 8-agent(angler Q5/fishery Q4/mof Q4) | deriveFocus(query) + detectZoneDeterministic | v1→v2 | 회귀 0 (PASS 10/10 유지) | cat2 자유변칙 48% | **#22** 로 이어짐 |
| **#3 메타·자기요약 약함** | v1 8-agent | synth 프롬프트 메타 규칙(memory 1-2줄 요약) | v1→v2 | 평가셋 회귀 0 | cat6 자유변칙 84% (v3 79%) | **P_meta_v2** 템플릿 |
| **#4 의사결정 정량임계 부재** | v1 8-agent | synth 프롬프트 의사결정 규칙 (cat4) | v1→v2 | 평가셋 PASS 유지 | cat4 자유변칙 15% | **#21** 로 이어짐 |
| **#5 CoT 누수 의심(coast_guard Q5)** | v1 8-agent | synth "내부 사고 한 글자도 금지" | v1→v2 | **CoT 누수 0건/440** (v2·v3) | 0 (가드 항구성) | 모니터만 |
| **#21 정량 임계 판정기** | v2 자유변칙 cat4 15% | `_thresholds.json` 9직군 + synth 임계표 + 가부결론 한 줄 먼저 | v2→v3 | **cat4 15→28% (+13%p)** ✅ | sentinel: LG-4-01·MOF-4-01 정량 미발동 (decision word 부재) | **P_quant_v2** — decision 키워드 외 정량 수치만 있어도 발동 |
| **#22 focus 후속 전파 강화** | v2 자유변칙 cat2 48% | 대명사 검출(거기/그곳/방금) + focus.zone 결정론적 args 주입 | v2→v3 | **cat2 48→43% (-5%p)** ❌ **회귀** + sentinel ANG-2-01b 잔존 | 잔여 cat2 실패 + #27 도 잔여 | **P_continuity_v2** — focus TTL + 도구별 args 매핑 완전화 + zone 갈등시 query 우선 룰 |
| **#23 직군 floor 보강** | v2 marine_leisure 56% | leisure 해변→get_surfing_index 우선 / local_gov 모호지명→GPS·전국 | v2→v3 | **marine_leisure 56→69% (+13%p)** ✅ / local_gov 65→? | local_gov 여전히 floor 70% 미달 (v3 65%) + sentinel LG-1-01 "관내"→web_search | **P_jikgun_floor** — local_gov 전용 hint(관내·우리시 → 행정구역 fuzzy) |
| **#24 memory 출력 누수(ANG-6-03b)** | v2 (프라이버시 불변식 회색지대) | synth 컨텍스트 격리 + 응답 후처리 라벨 라인 제거 🔒 | v2→v3 | **memory 누수 ANG-6-03b 사라짐** ✅ | 0 (가드 항구성) | 모니터만 |
| **#27 #22 회귀 디버그 (args 매핑)** | v3 cat2 -5%p 회귀 | `FOCUS_ZONE_ARG` 도구별 매핑(zone/place/location/beach/harbor) + focus.buoy→buoyName + PRONOUN_RE 보수화("그 때" 제외) | v3→v4 | sentinel cat2 75% (v3 43% 대비 회복) | v5 자유변칙 cat2 측정치 미수 — **회복 폭이 핵심 지표** | (효과 충분시) 신규 없음 / (부족시) **P_continuity_v2** |
| **#28 LG-7-02 환각 추적** | v3 신규 환각 ("산업재해 사망자 113명") | synth "비기상·비도메인 정보 거절" 규칙 | v3→v4 | sentinel 환각 의심 0 | v5 자유변칙 환각 의심 카운트 미수 + LG-7-02 자체 재측정 필요 | (재발시) **P_halluc_v2** — 도메인 분류기를 응답 직전 한번 더 |
| **#29 #22 vs marine_leisure trade-off** | v3 (#22 회귀 + #23 회복) | (분석 액션) 직군×카테고리 회귀·회복 매트릭스 | v3→v4 분석 | sentinel 부분 회복 | **v5 전체측정으로 직군×cat 매트릭스 최종 확정** | 분석 액션 — 패치 없음 |
| (v5 신규 후보) **#30 cat3 다중도구 60% 정체** | v3 cat3 60→58% | — | — | — | v5 측정 후 잔존 확인 | **P_multitool** — planQuery 카테고리별 hint 강화 |
| (v5 신규 후보) **#31 p95 ≥5000ms DoD 미달** | sentinel p95 6588ms | — | — | — | v5 p95 미수 (DoD #25 게이트 5000ms) | 임베딩 캐시 hit·web_search 조기차단·synth 짧은 응답 분기 |

### 4.1 라이프사이클 상태 요약

- **완전 해결(가드 항구성)**: #5(CoT) · #24(memory 누수). 모니터만.
- **명확한 회복**: #21(cat4 +13) · #23(marine_leisure +13).
- **trade-off 잔존**: #22 / #27. v5 cat2 측정치가 효과 확정.
- **신규 회귀 추적중**: #28(LG-7-02). v5 환각 카운트.
- **신규 후보(v5 측정 후 확정)**: #30 다중도구 · #31 p95 DoD.

### 4.2 다음 패치 사이클 진입 조건

```
if v5_pass >= 85% and jikgun_floor >= 70% and category_floor >= 70%
   and new_halluc == 0 and new_cot == 0 and p95 <= 5000:
    → Phase 3 착수 (DoD #25 통과)
else:
    → 상위 ROI 3건 적용 → v6 측정
```

---

## 5. 자동화 호출 시퀀스 (v5 결과 수신 직후)

```
1. diff_v3_v5.py           # §3 회귀·회복·신규 환각/CoT 출력
2. 카테고리·직군 행렬 갱신   # §1.2, §1.3
3. ROI 매트릭스 자동 계산   # §2.3 (fail_count 자리 v5 실측 주입)
4. 라이프사이클 표의 v5 칼럼 채움  # §4
5. 다음 패치 top3 + 격리 규칙 출력 # §2.4
6. DoD 게이트 판정          # §4.2
```

`/loop` 호출로 v5 측정 종료 신호(러너 종료) 후 자동 트리거 가능.

---

[2차 검토 — 셀프] 표·의사코드는 모두 v3 측정치 실수 기반. v5 값은 가정 없이 자리만 비워둠. ROI 가중치는 과거 패치 실측(#21 +13/#22 -5/#23 +13) 환산이며, 새 가설 패치 effect 는 보수적 감쇠. 불변식 카테고리(5·7·8) 회귀 risk 게이트가 모든 단계에 들어있음. 신규 md 단일 파일, 코드/jsonl 미수정.
