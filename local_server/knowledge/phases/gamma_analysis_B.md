# 옵션 γ — v5 측정 자동화 시점 B (결과 분석·diff·ROI 산출)

> **위치:** 자유변칙 v5 러너 완주 직후, 다음 패치 사이클 진입 전.
> **목적:** `/tmp/freevar.log` (또는 동등 stdout) 한 입력으로 v3 비교·5축 분류·ROI 랭킹·A 게이트 평가를 한 패스에 산출.
> **전제:** `phase2b_eval_freevar_runner.py` 가 정상 완주(종합 블록 출력 도달).
> **출력물:** `analyze_v5.py` (단일 실행 스크립트, 표준 라이브러리만 사용).
> **불수정:** 코드·jsonl 미수정. 본 문서 + 스크립트 2 파일만 신규.

---

## 1. 사용법

### 1.1 기본 실행

```bash
# 러너 종료 후, 기본 경로(/tmp/freevar.log) 로드
python3 knowledge/phases/analyze_v5.py
```

stdout 에 마크다운 리포트 + `/tmp/v5_analysis_report.md` 저장.

### 1.2 옵션

| 옵션 | 효과 | 기본값 |
|------|------|--------|
| `--log=<path>` | 러너 로그 경로 지정 | `/tmp/freevar.log` |
| `--out=<path>` | 마크다운 리포트 저장 경로 | `/tmp/v5_analysis_report.md` |
| `--stdin` | stdin 으로 로그 수신 (파이프) | off |
| `-h`, `--help` | 도움말 표시 | — |

### 1.3 파이프 예시

```bash
cat /tmp/freevar.log | python3 knowledge/phases/analyze_v5.py --stdin --out=/tmp/v5_rep.md
# 또는 tail
tail -300 /tmp/freevar.log | python3 knowledge/phases/analyze_v5.py --stdin
```

### 1.4 자동화 호출 시퀀스

```bash
# 러너 종료 신호 후 (v5_measurement_synthesis §9 참고)
mv /tmp/freevar.log /home/user/SEAGNAL/local_server/knowledge/phases/freevar_v5.log
python3 knowledge/phases/analyze_v5.py \
    --log=/home/user/SEAGNAL/local_server/knowledge/phases/freevar_v5.log \
    --out=/home/user/SEAGNAL/local_server/knowledge/phases/v5_result_summary.md
```

`/loop` 로 러너 종료 감시 → 본 스크립트 자동 트리거 가능.

---

## 2. v3 베이스라인 (스크립트 hardcoded)

마스터플랜 §7 변경이력 (2026-05-30) 두 라인에서 발췌.

### 2.1 직군별 PASS%

| 직군 | v2 자유변칙 | v3 자유변칙 | 비고 |
|------|-------------|-------------|------|
| angler | 74% | 74% | v3 소폭 개선 보고, 정확치 미공개 → v2 그대로 보수 |
| fishery | 74% | 74% | 동상 |
| marine_leisure | **56%** | **69%** | #23 효과 +13%p ✅ |
| coast_guard | **78%** | **70%** | v3 회귀 -8 (LLM 비결정성+#22 부작용) |
| navy | 76% | 76% | — |
| mof | **81%** | **78%** | v3 회귀 -3 |
| local_gov | 65% | 65% | DoD 위반 잔존 |
| public_org | 74% | 70% | v3 회귀 -4 |

### 2.2 카테고리별 PASS%

| cat | 라벨 | v2 | v3 | Δ | 비고 |
|-----|------|----|----|---|------|
| 1 | 기본 | 85% | 89% | +4 | 도구 가드 |
| 2 | 연속 | 48% | **43%** | -5 | #22 회귀 ❌ |
| 3 | 다중 | 60% | 58% | -2 | 정체 |
| 4 | 정량 | 15% | **28%** | +13 | #21 효과 ✅ |
| 5 | 비도메인 | 98% | 96% | -2 | 가드 |
| 6 | 메타 | 84% | 79% | -5 | 회귀 추적 |
| 7 | 환각 | 98% | 96% | -2 | LG-7-02 신규 |
| 8 | 변칙 | 98% | 100% | +2 | 가드 |

### 2.3 종합

| 항목 | v2 | v3 |
|------|----|----|
| 종합 PASS | 320/440 (72%) | 321/440 (72%) |
| 지연 p50 | 1328ms | (미기록) |
| 지연 p95 | 6712ms | (미기록) |
| CoT 누수 | 0 | 0 |
| 환각 의심 | 6 | (LG-7-02 신규) |

---

## 3. 산출 항목 (리포트 섹션별)

스크립트가 자동으로 출력하는 마크다운 리포트는 다음 10개 섹션을 포함한다.

| § | 제목 | 내용 |
|---|------|------|
| 1 | 직군별 v3 → v5 비교 | 표 + 텍스트 막대 차트 + floor(70%) 통과 |
| 2 | 카테고리별 v3 → v5 비교 | 표 + 차트 + 실패수 |
| 3 | 지연 DoD 게이트 | p50/p95/평균 vs DoD 임계 |
| 4 | 결함 5축 분류 | A_tool / A_multitool / B_halluc / C_continuity / D_decision / E_meta |
| 5 | v3 대비 회귀·회복 카테고리 | ±3pp 임계 |
| 6 | 신규 환각 / CoT 누수 샘플 | 0건이면 "불변식 보존" |
| 7 | 다음 패치 ROI 랭킹 | 6 패치 후보 × ROI 점수 |
| 8 | A 게이트 평가 | P0~P5 |
| 9 | 통합 권고 | A 게이트 + B ROI 합성 |
| 10 | 마스터플랜 §7 등재안 | 한 줄 |

---

## 4. ROI 점수 산식

```
ROI(patch) = Σ_{c ∈ targets(patch)} fail_count[c] × effect[c, patch]  −  cost(patch)
```

### 4.1 effect 가중치 (v2→v3 실측 환산)

| 패치 | 표적 cat | effect | 근거 |
|------|----------|--------|------|
| P_quant_v2 | cat4 | 0.20 | #21 cat4 +13%p → 보수적 감쇠 |
| P_quant_v2 | cat1 | 0.02 | 부차 효과 |
| P_continuity_v2 | cat2 | 0.20 | #22 회귀 후 #27 회복 trend |
| P_continuity_v2 | cat6 | 0.04 | 후속쌍 부차 효과 |
| P_multitool | cat3 | 0.30 | 다중 도구 가설 최대 |
| P_multitool | cat2 | 0.05 | 부차 |
| P_meta_v2 | cat6 | 0.20 | 메타 템플릿 효과 가설 |
| P_halluc_v2 | cat7 | 0.20 | 도메인 분류기 가설 |
| P_jikgun_floor | cat1/2/3 | 0.05 | 직군 floor hint 전반 |

### 4.2 risk (불변식)

| 패치 | risk | 사유 |
|------|------|------|
| P_continuity_v2 | **중** | #22 전례 — cat5/7/8 회귀 가능 |
| 나머지 | 낮음 | — |

### 4.3 cost (LoC + 회귀 가중)

| 패치 | cost |
|------|------|
| P_continuity_v2 | 2.5 |
| P_halluc_v2 | 1.5 |
| P_quant_v2 | 1.5 |
| P_multitool | 1.0 |
| P_meta_v2 | 1.0 |
| P_jikgun_floor | 1.0 |

---

## 5. A 게이트 평가 규칙

`v5_measurement_synthesis.md` §6.3 와 동일.

| 레벨 | 조건 | 권고 |
|------|------|------|
| P0 | CoT > 0 또는 환각 신규 ≥ 2 | **즉시 롤백** + 가드 정규식 점검, 다른 패치 보류 |
| P1 | 직군 PASS < 60% 1개 이상 | 해당 직군 전용 디지스트 보강 |
| P2 | 카테고리 PASS < 30% 1개 이상 | ROI 1위 1개만 적용 |
| P3 | 직군 floor 70% 미달 1~2개 | 직군 × 카테고리 매트릭스 표적 패치 |
| P4 | p95 > 5000ms 또는 평균 > 2500ms | 도구 다이어트(별도 트랙) |
| P5 | 전부 통과 | **DoD 충족 → Phase 3 착수** |

**합성 규칙:** A 게이트는 하드 컷오프, B ROI 는 동일 게이트 내 자원 배분.

---

## 6. 리포트 샘플 출력 (시뮬레이션)

> 아래는 임의의 v5 가정치(종합 75%, p95 4900ms) 로 스크립트를 돌렸을 때 산출되는 실제 출력 발췌이다. 실제 v5 결과 주입 시 모든 셀이 자동 갱신된다.

### 6.1 직군별 표 (샘플)

```
| 직군 | v2 | v3 | v5 | Δ(v3→v5) | floor(70%) |
|------|----|----|----|----------|------------|
| angler | 74% | 74% | **76%** | +2pp | ✅ |
| fishery | 74% | 74% | **78%** | +4pp | ✅ |
| marine_leisure | 56% | 69% | **72%** | +3pp | ✅ |
| coast_guard | 78% | 70% | **74%** | +4pp | ✅ |
| navy | 76% | 76% | **76%** | +0pp | ✅ |
| mof | 81% | 78% | **80%** | +2pp | ✅ |
| local_gov | 65% | 65% | **70%** | +5pp | ✅ |
| public_org | 74% | 70% | **72%** | +2pp | ✅ |
```

### 6.2 차트 (샘플)

```
            angler  76% |██████████████████████
           fishery  78% |███████████████████████
    marine_leisure  72% |█████████████████████
       coast_guard  74% |██████████████████████
              navy  76% |██████████████████████
               mof  80% |████████████████████████
         local_gov  70% |█████████████████████
        public_org  72% |█████████████████████
```

### 6.3 ROI 랭킹 (샘플)

```
| 순위 | 패치 | ROI | 불변식 risk | 산식 |
|------|------|-----|-------------|------|
| 1 | P_multitool | **10.5** | 낮음 | cat3×0.3×33=9.9; cat2×0.05×32=1.6 |
| 2 | P_continuity_v2 | **4.5** | 중 | cat2×0.2×32=6.4; cat6×0.04×16=0.6 |
| 3 | P_jikgun_floor | **2.5** | 낮음 | cat1×0.05×5=0.2; cat2×0.05×32=1.6; cat3×0.05×33=1.7 |
| 4 | P_meta_v2 | **2.2** | 낮음 | cat6×0.2×16=3.2 |
| 5 | P_quant_v2 | **1.4** | 낮음 | cat4×0.2×14=2.8; cat1×0.02×5=0.1 |
| 6 | P_halluc_v2 | **-1.5** | 낮음 | cat7×0.2×0=0.0 |
```

### 6.4 통합 권고 (샘플)

```
- 다음 사이클 패치 후보 top3 (불변식 risk 낮음 우선):
  1. **P_multitool** (ROI 10.5)
  2. **P_jikgun_floor** (ROI 2.5)
  3. **P_meta_v2** (ROI 2.2)
- 격리 규칙: P_continuity_v2 + P_quant_v2 동시 금지. P_continuity_v2 + P_multitool 동시 가능.
```

### 6.5 마스터플랜 §7 등재안 (샘플)

```
v5 — 440 케이스 PASS 331/440 (75%), p95 4900ms, CoT 0/환각 1, 다음 패치 P_multitool 채택.
```

---

## 7. 한계·주의

- **베이스라인 hardcode**: 마스터플랜 §7 의 카테고리·직군 PASS% 가 일부만 명시 → v3 직군 수치 일부(angler/fishery/navy/local_gov) 는 v2 값을 보수적으로 그대로 사용. 본 비교의 Δ 는 *최소 변동* 의 보수 추정이다.
- **로그 파싱 의존**: 러너가 종합 블록(`==== 종합 PASS ... ====`) 까지 도달해야 동작. 중단된 로그는 `[error] 직군별 종합 블록을 찾지 못함` 으로 거부.
- **ROI effect 보수**: 새 패치 effect 는 ≤ 0.30 으로 강감쇠. 실측치 1회 누적 후 다음 사이클에서 재캘리.
- **risk_to_invariant**: P_continuity_v2 만 *중*. P0 위반 시 본 스크립트의 권고는 무효 — 가드 패치만 단독 사이클.
- **A 게이트 vs B ROI 충돌**: 항상 A 게이트 우선(`v5_measurement_synthesis.md` §11 합성 원칙).
- **단일 실행 노이즈**: 러너 `--n=1`(단일) → v5 ± 2pp 안의 변동은 노이즈로 인정. 다음 라운드 다수결 검증 권장.

---

## 8. 파일 명세

| 파일 | 경로 | 라인 수 | 의존성 |
|------|------|---------|--------|
| 실행 스크립트 | `local_server/knowledge/phases/analyze_v5.py` | ~330 | 표준 라이브러리만 |
| 본 문서 | `local_server/knowledge/phases/gamma_analysis_B.md` | — | — |

코드/jsonl 미수정. 신규 2 파일.

---

(끝)
