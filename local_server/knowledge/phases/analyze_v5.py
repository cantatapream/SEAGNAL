#!/usr/bin/env python3
"""
analyze_v5.py — 자유변칙 v5 측정 결과 자동 분석기 (옵션 γ — 시점 B 산출물)

[목적]
- v5 러너(phase2b_eval_freevar_runner.py) 의 stdout 로그(/tmp/freevar.log 또는 stdin)를
  파싱해 v3 베이스라인(마스터플랜 §7) 과 자동 비교한다.
- 직군·카테고리·지연·불변식(CoT/환각) 5축 차분 → 결함 5축 분류 →
  다음 패치 ROI 점수 산출 → 마크다운 리포트 자동 작성.
- 직접 실행/측정 수행 금지. 본 파일은 *측정 종료 후* 후처리 전용.

[입력]
- 기본: /tmp/freevar.log
- --log=<path> 로 다른 로그 지정 가능
- --stdin 으로 표준입력 파이프(`cat … | analyze_v5.py --stdin`)

[베이스라인]
- v2/v3 직군·카테고리 PASS% 는 hardcoded (마스터플랜 §7 변경이력 2026-05-30 두 라인 발췌).
- 별도 jsonl 파싱 불필요 — 러너 로그만으로 자동 산출.

[출력]
- stdout: 요약 표(직군/카테고리/지연/불변식) + ROI 랭킹 + 권고
- --out=<path> : 마크다운 리포트 파일로 저장 (기본 /tmp/v5_analysis_report.md)

[제약]
- 한국어 주석, 간결한 텍스트 차트, 표준 라이브러리만 사용.
- v3 결과 jsonl 부재 환경에서도 동작 — 베이스라인 수치는 상수로 내장.

[사용]
  python3 analyze_v5.py                       # /tmp/freevar.log 자동 로드
  python3 analyze_v5.py --log=/tmp/x.log
  cat /tmp/freevar.log | python3 analyze_v5.py --stdin
"""
from __future__ import annotations
import re, sys, os
from pathlib import Path
from collections import OrderedDict

# ──────────────────────────────────────────────────────────────────────────────
# 1) v2/v3 베이스라인 (마스터플랜 §7 2026-05-30 변경이력 두 라인 발췌)
# ──────────────────────────────────────────────────────────────────────────────
# 직군별 PASS% — v2 자유변칙 320/440(72%), v3 자유변칙 321/440(72%)
BASELINE_JIKGUN = {
    # jikgun_slug : (v2_pct, v3_pct)
    "angler":          (74, 74),  # v3 소폭 개선 표기 — 정확치는 미공개, v2 그대로 보수
    "fishery":         (74, 74),
    "marine_leisure":  (56, 69),  # #23 효과 +13%p
    "coast_guard":     (78, 70),  # v3 회귀 -8
    "navy":            (76, 76),
    "mof":             (81, 78),  # v3 회귀 -3
    "local_gov":       (65, 65),  # v3 잔존
    "public_org":      (74, 70),  # v3 회귀 -4
}

# 카테고리별 PASS% — 1.기본 2.연속 3.다중 4.정량 5.비도메인 6.메타 7.환각 8.변칙
BASELINE_CATEGORY = {
    1: ("기본",  85, 89),
    2: ("연속",  48, 43),   # #22 회귀 -5
    3: ("다중",  60, 58),
    4: ("정량",  15, 28),   # #21 효과 +13
    5: ("비도",  98, 96),   # 가드
    6: ("메타",  84, 79),
    7: ("환각",  98, 96),   # 가드
    8: ("변칙",  98, 100),  # 가드
}

# DoD 임계 (마스터플랜 §6 #25)
DOD_JIKGUN_FLOOR = 70   # 직군 PASS% ≥ 70
DOD_CATEGORY_FLOOR = 70 # 카테고리 PASS% ≥ 70 (cat4 는 +10pp 목표 보조)
DOD_OVERALL = 85        # 종합 PASS% ≥ 85 (Phase 3 진입)
DOD_P95_MS = 5000       # 지연 p95 ≤ 5000ms (R2-06)
DOD_P50_MS = 2000
DOD_AVG_MS = 2500

# ROI 가중치 — 마스터플랜 §7 / v5_measurement_frame_B §2.1 의 실측 환산
ROI_EFFECT = {
    # patch        : { cat: effect (0~1, 음수=역효과) }
    "P_quant_v2":     {4: 0.20, 1: 0.02},
    "P_continuity_v2":{2: 0.20, 6: 0.04},
    "P_multitool":    {3: 0.30, 2: 0.05},
    "P_meta_v2":      {6: 0.20},
    "P_halluc_v2":    {7: 0.20},
    "P_jikgun_floor": {1: 0.05, 2: 0.05, 3: 0.05},  # 특정 직군 전반에 작은 회복
}
ROI_RISK_INVARIANT = {  # 불변식(5/7/8) 회귀 위험. 0=낮음, 1=중, 2=높음.
    "P_quant_v2": 0,
    "P_continuity_v2": 1,   # #22 전례
    "P_multitool": 0,
    "P_meta_v2": 0,
    "P_halluc_v2": 0,
    "P_jikgun_floor": 0,
}
ROI_COST = {  # 구현 cost (LoC 환산 + 회귀 가중)
    "P_quant_v2": 1.5,
    "P_continuity_v2": 2.5,
    "P_multitool": 1.0,
    "P_meta_v2": 1.0,
    "P_halluc_v2": 1.5,
    "P_jikgun_floor": 1.0,
}

# ──────────────────────────────────────────────────────────────────────────────
# 2) 러너 로그 파서
# ──────────────────────────────────────────────────────────────────────────────
# 러너 출력 형식 (phase2b_eval_freevar_runner.py 참고):
#
#   === Phase 2b 자유 변칙 평가 — 440 케이스 직렬 실행 ===
#     [10/440] 경과 35s …
#     …
#   ======= 직군별 종합 =======
#     angler            PASS 41/55  (74%)
#     …
#   ======= 직군 × 카테고리 (...) =======
#     직군             |  기본  연속  다중  정량  비도  메타  환각  변칙
#     angler           |  …
#   지연 SLO  p50=1328ms  p95=6712ms  평균=1990ms  n=440
#   실패 119건 · CoT 누수 의심 0건 · 환각 의심 6건
#   …
#   ==== 종합 PASS 320/440 (72%) · 소요 2232s ====

RE_JIKGUN_LINE = re.compile(
    r"^\s*([a-z_]+)\s+PASS\s+(\d+)\s*/\s*(\d+)\s*\((\d+)%\)\s*$"
)
RE_CAT_HEADER = re.compile(r"^\s*직군\s*\|")
RE_CAT_ROW = re.compile(
    r"^\s*([a-z_]+)\s*\|\s*(.+)$"
)
RE_CELL = re.compile(r"(\d+)\s*/\s*(\d+)")
RE_SLO = re.compile(
    r"지연\s*SLO\s*p50\s*=\s*(\d+)\s*ms\s*p95\s*=\s*(\d+)\s*ms\s*평균\s*=\s*(\d+)\s*ms\s*n\s*=\s*(\d+)"
)
RE_FAIL = re.compile(
    r"실패\s+(\d+)건\s*·\s*CoT\s*누수\s*의심\s*(\d+)건\s*·\s*환각\s*의심\s*(\d+)건"
)
RE_TOTAL = re.compile(
    r"종합\s*PASS\s*(\d+)\s*/\s*(\d+)\s*\((\d+)%\)\s*·\s*소요\s*(\d+)s"
)
RE_COT_SAMPLE_HDR = re.compile(r"\[CoT 누수 샘플\]")
RE_HALLUC_SAMPLE_HDR = re.compile(r"\[환각 의심 샘플\]")
RE_FAIL_SAMPLE_HDR = re.compile(r"\[실패 샘플")
RE_SAMPLE_LINE = re.compile(r"^\s*([A-Z]+-\d+-\d+[a-z]?)\s*\(([a-z_]+).*?\):\s*(.*)$")

def parse_log(text: str) -> dict:
    """러너 stdout 텍스트 → 구조화 dict."""
    out = {
        "jikgun": OrderedDict(),    # slug → {"pass":n, "total":n, "pct":n}
        "jikgun_cat": OrderedDict(),# slug → {cat: {"pass":n, "total":n}}
        "slo": None,                # {"p50":, "p95":, "avg":, "n":}
        "counts": None,             # {"fail":, "cot":, "halluc":}
        "total": None,              # {"pass":, "total":, "pct":, "elapsed_s":}
        "cot_samples": [],          # [(id, jikgun, ans_short), ...]
        "halluc_samples": [],
        "fail_samples": [],
    }
    section = None     # None | "cat" | "cot" | "halluc" | "fail"
    cat_order = [1,2,3,4,5,6,7,8]
    for line in text.splitlines():
        # 섹션 헤더
        if "직군별 종합" in line:
            section = None; continue
        if RE_CAT_HEADER.search(line):
            section = "cat"; continue
        if RE_COT_SAMPLE_HDR.search(line):
            section = "cot"; continue
        if RE_HALLUC_SAMPLE_HDR.search(line):
            section = "halluc"; continue
        if RE_FAIL_SAMPLE_HDR.search(line):
            section = "fail"; continue

        # SLO·실패카운트·종합 — 어느 섹션에서나 잡힘
        m = RE_SLO.search(line)
        if m:
            out["slo"] = {"p50": int(m.group(1)), "p95": int(m.group(2)),
                          "avg": int(m.group(3)), "n":   int(m.group(4))}
            continue
        m = RE_FAIL.search(line)
        if m:
            out["counts"] = {"fail": int(m.group(1)),
                             "cot":  int(m.group(2)),
                             "halluc": int(m.group(3))}
            continue
        m = RE_TOTAL.search(line)
        if m:
            out["total"] = {"pass": int(m.group(1)), "total": int(m.group(2)),
                            "pct":  int(m.group(3)), "elapsed_s": int(m.group(4))}
            continue

        # 직군 PASS 라인
        m = RE_JIKGUN_LINE.match(line)
        if m and section != "cat":
            slug = m.group(1)
            out["jikgun"][slug] = {"pass": int(m.group(2)),
                                   "total": int(m.group(3)),
                                   "pct": int(m.group(4))}
            continue

        # 카테고리 매트릭스
        if section == "cat":
            m = RE_CAT_ROW.match(line)
            if m and "직군" not in m.group(1):
                slug = m.group(1)
                cells = RE_CELL.findall(m.group(2))
                row = {}
                for idx, (p, t) in enumerate(cells[:8]):
                    row[cat_order[idx]] = {"pass": int(p), "total": int(t)}
                if row:
                    out["jikgun_cat"][slug] = row
            continue

        # 샘플 라인
        if section in ("cot", "halluc", "fail"):
            m = RE_SAMPLE_LINE.match(line)
            if m:
                tup = (m.group(1), m.group(2), m.group(3)[:120])
                if section == "cot":    out["cot_samples"].append(tup)
                elif section == "halluc": out["halluc_samples"].append(tup)
                else: out["fail_samples"].append(tup)
    return out

# ──────────────────────────────────────────────────────────────────────────────
# 3) v3 vs v5 비교 산출
# ──────────────────────────────────────────────────────────────────────────────
def cat_pct(parsed: dict) -> dict:
    """카테고리별 종합 PASS% 산출 (직군 합산)."""
    sums = {c: [0, 0] for c in BASELINE_CATEGORY}  # cat → [pass, total]
    for slug, row in parsed["jikgun_cat"].items():
        for c, s in row.items():
            sums[c][0] += s["pass"]
            sums[c][1] += s["total"]
    out = {}
    for c, (p, t) in sums.items():
        pct = round(p * 100 / t) if t else 0
        out[c] = {"pass": p, "total": t, "pct": pct}
    return out

def fail_counts(parsed: dict) -> dict:
    """카테고리별 실패 케이스 수 — ROI 입력."""
    cp = cat_pct(parsed)
    return {c: cp[c]["total"] - cp[c]["pass"] for c in cp}

# ──────────────────────────────────────────────────────────────────────────────
# 4) ROI 산출
# ──────────────────────────────────────────────────────────────────────────────
def roi_table(parsed: dict) -> list:
    """패치별 ROI 점수 산출 → [(patch, score, risk, detail), ...]."""
    fc = fail_counts(parsed)
    rows = []
    for patch, effect_map in ROI_EFFECT.items():
        score = 0.0
        detail = []
        for cat, eff in effect_map.items():
            f = fc.get(cat, 0)
            contrib = f * eff
            score += contrib
            detail.append(f"cat{cat}×{eff}×{f}={contrib:.1f}")
        score -= ROI_COST.get(patch, 0)
        risk = ROI_RISK_INVARIANT.get(patch, 0)
        rows.append((patch, round(score, 1), risk, "; ".join(detail)))
    rows.sort(key=lambda r: r[1], reverse=True)
    return rows

# ──────────────────────────────────────────────────────────────────────────────
# 5) A 게이트 (마스터플랜 §6.3 P0~P5)
# ──────────────────────────────────────────────────────────────────────────────
def gate_status(parsed: dict) -> list:
    """A 게이트 평가 → [(level, condition_met, reason)] 우선순위 순."""
    gates = []
    counts = parsed.get("counts") or {}
    cp = cat_pct(parsed)
    jk = parsed["jikgun"]
    slo = parsed.get("slo") or {}
    total = parsed.get("total") or {}

    # P0 — 불변식 (CoT 누수 > 0 또는 환각 신규 ≥ 2)
    cot = counts.get("cot", -1); halluc = counts.get("halluc", -1)
    p0_violation = (cot > 0) or (halluc >= 2)
    gates.append(("P0", p0_violation,
        f"CoT={cot}, 환각의심={halluc} — {'불변식 위반(즉시 롤백)' if p0_violation else '보존'}"))

    # P1 — 직군 PASS < 60% 1개 이상
    p1 = [s for s, st in jk.items() if st["pct"] < 60]
    gates.append(("P1", bool(p1),
        f"<60% 직군: {p1 if p1 else '없음'}"))

    # P2 — 카테고리 PASS < 30% 1개 이상
    p2 = [c for c, st in cp.items() if st["pct"] < 30]
    gates.append(("P2", bool(p2),
        f"<30% 카테고리: {p2 if p2 else '없음'}"))

    # P3 — 직군 floor 70% 미달 1~2개
    p3 = [s for s, st in jk.items() if st["pct"] < DOD_JIKGUN_FLOOR]
    gates.append(("P3", bool(p3),
        f"<70% 직군: {p3 if p3 else '없음'}"))

    # P4 — 지연 p95 > 5000ms 또는 평균 > 2500ms
    p4 = (slo.get("p95", 0) > DOD_P95_MS) or (slo.get("avg", 0) > DOD_AVG_MS)
    gates.append(("P4", p4,
        f"p95={slo.get('p95')}ms, 평균={slo.get('avg')}ms"))

    # P5 — 전부 통과
    all_jik_ok = all(st["pct"] >= DOD_JIKGUN_FLOOR for st in jk.values())
    all_cat_ok = all(st["pct"] >= DOD_CATEGORY_FLOOR for c, st in cp.items()
                     if c not in (4,))  # cat4 는 별도 +10pp 게이트
        # 종합 ≥ 85
    overall_ok = (total.get("pct", 0) >= DOD_OVERALL)
    p5 = (not p0_violation) and all_jik_ok and all_cat_ok and overall_ok \
         and (slo.get("p95", 9999) <= DOD_P95_MS)
    gates.append(("P5", p5,
        f"종합={total.get('pct')}% · 직군 all≥70={all_jik_ok} · 카테고리 all≥70={all_cat_ok} · p95 OK={slo.get('p95',9999)<=DOD_P95_MS}"))

    return gates

# ──────────────────────────────────────────────────────────────────────────────
# 6) 리포트 생성
# ──────────────────────────────────────────────────────────────────────────────
def render_chart(values: list, max_width: int = 30) -> list:
    """텍스트 막대 (값 비율 → █). [(label, pct), ...] → 행 리스트."""
    if not values: return []
    mx = max(v for _, v in values) or 1
    out = []
    for lab, v in values:
        bar = "█" * int(v / mx * max_width)
        out.append(f"  {lab:>16s} {v:>3d}% |{bar}")
    return out

def render_report(parsed: dict) -> str:
    L = []
    push = L.append
    total = parsed.get("total") or {}
    slo = parsed.get("slo") or {}
    counts = parsed.get("counts") or {}
    cp = cat_pct(parsed)
    fc = fail_counts(parsed)

    push("# 자유변칙 v5 측정 분석 리포트")
    push("")
    push(f"- 종합 PASS: **{total.get('pass','?')}/{total.get('total','?')} ({total.get('pct','?')}%)** · 소요 {total.get('elapsed_s','?')}s")
    push(f"- 지연: p50={slo.get('p50','?')}ms · p95={slo.get('p95','?')}ms · 평균={slo.get('avg','?')}ms · n={slo.get('n','?')}")
    push(f"- 불변식: CoT 누수={counts.get('cot','?')} · 환각 의심={counts.get('halluc','?')}")
    push("")

    # 직군별 v3 → v5 비교 표
    push("## 1. 직군별 v3 → v5 비교")
    push("")
    push("| 직군 | v2 | v3 | v5 | Δ(v3→v5) | floor(70%) |")
    push("|------|----|----|----|----------|------------|")
    for slug, st in parsed["jikgun"].items():
        v2, v3 = BASELINE_JIKGUN.get(slug, (0, 0))
        delta = st["pct"] - v3
        flag = "✅" if st["pct"] >= DOD_JIKGUN_FLOOR else "❌"
        push(f"| {slug} | {v2}% | {v3}% | **{st['pct']}%** | {delta:+d}pp | {flag} |")
    push("")

    # 차트
    push("### 직군 PASS% 차트")
    push("```")
    chart_rows = render_chart([(s, st["pct"]) for s, st in parsed["jikgun"].items()])
    L.extend(chart_rows)
    push("```")
    push("")

    # 카테고리별 v3 → v5
    push("## 2. 카테고리별 v3 → v5 비교")
    push("")
    push("| cat | 라벨 | v2 | v3 | v5 | Δ | 실패수 |")
    push("|-----|------|----|----|----|---|--------|")
    for c, info in cp.items():
        label, v2, v3 = BASELINE_CATEGORY[c]
        delta = info["pct"] - v3
        fail = fc[c]
        push(f"| {c} | {label} | {v2}% | {v3}% | **{info['pct']}%** | {delta:+d}pp | {fail} |")
    push("")
    push("### 카테고리 PASS% 차트")
    push("```")
    chart_rows = render_chart([(BASELINE_CATEGORY[c][0], info["pct"]) for c, info in cp.items()])
    L.extend(chart_rows)
    push("```")
    push("")

    # 지연 / DoD 게이트
    push("## 3. 지연 DoD 게이트")
    push("")
    push("| 지표 | v5 | DoD | 통과 |")
    push("|------|----|-----|------|")
    p50, p95, avg = slo.get("p50",0), slo.get("p95",0), slo.get("avg",0)
    push(f"| p50  | {p50}ms | ≤{DOD_P50_MS}ms | {'✅' if p50<=DOD_P50_MS else '❌'} |")
    push(f"| p95  | {p95}ms | ≤{DOD_P95_MS}ms | {'✅' if p95<=DOD_P95_MS else '❌'} |")
    push(f"| 평균 | {avg}ms | ≤{DOD_AVG_MS}ms | {'✅' if avg<=DOD_AVG_MS else '❌'} |")
    push("")

    # 결함 5축 분류 — 카테고리에서 도출
    push("## 4. 결함 5축 분류 (카테고리→축)")
    push("")
    push("| 축 | 대표 카테고리 | v5 PASS% | 실패수 | 비고 |")
    push("|----|---------------|----------|--------|------|")
    axis_map = [
        ("A_tool",       [1],    "도구 미사용/오선택"),
        ("A_multitool",  [3],    "다중 도구 누락"),
        ("B_halluc",     [7],    "환각 의심 (가드 카테고리)"),
        ("C_continuity", [2],    "후속 zone/대명사 전파 실패"),
        ("D_decision",   [4],    "정량 가부 결론 부재"),
        ("E_meta",       [6],    "메타·자기요약 약화"),
    ]
    for axis, cats, note in axis_map:
        pcts = [cp[c]["pct"] for c in cats if c in cp]
        fails = sum(fc.get(c, 0) for c in cats)
        pct_avg = round(sum(pcts)/len(pcts)) if pcts else 0
        push(f"| {axis} | cat{cats} | {pct_avg}% | {fails} | {note} |")
    push("")

    # 회귀·회복 (v3 카테고리 PASS% 대비 ±)
    push("## 5. v3 대비 회귀·회복 카테고리")
    push("")
    reg, rec = [], []
    for c, info in cp.items():
        v3 = BASELINE_CATEGORY[c][2]
        delta = info["pct"] - v3
        if delta <= -3:
            reg.append((c, BASELINE_CATEGORY[c][0], delta))
        elif delta >= 3:
            rec.append((c, BASELINE_CATEGORY[c][0], delta))
    push(f"- 회귀(<-3pp): {reg if reg else '없음'}")
    push(f"- 회복(+3pp): {rec if rec else '없음'}")
    push("")

    # 신규 환각/CoT 샘플 캡처
    push("## 6. 신규 환각 / CoT 누수 샘플")
    push("")
    if parsed["cot_samples"]:
        push("### CoT 누수 의심 (P0 즉시 롤백 게이트)")
        for cid, jg, ans in parsed["cot_samples"][:5]:
            push(f"- {cid} ({jg}): {ans!r}")
    else:
        push("- CoT 누수: **0건 — 불변식 보존**")
    if parsed["halluc_samples"]:
        push("### 환각 의심")
        for cid, jg, ans in parsed["halluc_samples"][:5]:
            push(f"- {cid} ({jg}): {ans!r}")
    else:
        push("- 환각 의심: **0건**")
    push("")

    # ROI 산출
    push("## 7. 다음 패치 ROI 랭킹")
    push("")
    push("| 순위 | 패치 | ROI | 불변식 risk | 산식 |")
    push("|------|------|-----|-------------|------|")
    roi = roi_table(parsed)
    for i, (patch, score, risk, detail) in enumerate(roi, 1):
        risk_str = ["낮음", "중", "높음"][min(risk, 2)]
        push(f"| {i} | {patch} | **{score}** | {risk_str} | {detail} |")
    push("")
    push("> ROI = Σ(실패수 × effect) − cost. effect 는 v2→v3 실측 환산.")
    push("")

    # A 게이트 평가
    push("## 8. A 게이트 (P0~P5) 평가")
    push("")
    push("| 레벨 | 조건 충족 | 사유 |")
    push("|------|-----------|------|")
    for lvl, met, reason in gate_status(parsed):
        flag = "✔" if met else "·"
        push(f"| {lvl} | {flag} | {reason} |")
    push("")

    # 권고 (게이트 + ROI 합성)
    push("## 9. 통합 권고 (A 게이트 + B ROI)")
    push("")
    g = {lvl: met for lvl, met, _ in gate_status(parsed)}
    if g.get("P0"):
        push("- **P0 위반** — 다른 패치 전면 보류. CoT/환각 가드 정규식 즉시 점검 후 단독 사이클로 가드 패치만 진행.")
    elif g.get("P5"):
        push("- **P5 통과** — DoD 충족, Phase 3 착수. 자유변칙을 머지 차단 조건으로 등재.")
    else:
        # 상위 ROI 3건 (risk=낮음 우선)
        safe_top3 = [r for r in roi if r[2] == 0][:3]
        if not safe_top3:
            safe_top3 = roi[:3]
        push(f"- 다음 사이클 패치 후보 top3 (불변식 risk 낮음 우선):")
        for i, (patch, score, risk, _) in enumerate(safe_top3, 1):
            push(f"  {i}. **{patch}** (ROI {score})")
        push("- 격리 규칙: `P_continuity_v2 + P_quant_v2` 동시 금지(args 주입 경로 겹침). `P_continuity_v2 + P_multitool` 동시 가능.")
        if g.get("P4"):
            push(f"- 지연 트랙 별도 — p95 {slo.get('p95')}ms > 5000ms. 도구 다이어트(#31) 병행.")
    push("")

    # 한 줄 요약 — 마스터플랜 §7 등재용
    push("## 10. 마스터플랜 §7 한 줄 등재안")
    push("")
    p0v = g.get("P0", False)
    next_patch = (next((p for p,_,r,_ in roi if r==0), roi[0][0]) if roi else "?")
    summary = (
        f"v5 — 440 케이스 PASS {total.get('pass','?')}/{total.get('total','?')} "
        f"({total.get('pct','?')}%), p95 {slo.get('p95','?')}ms, "
        f"CoT {counts.get('cot','?')}/환각 {counts.get('halluc','?')}, "
        f"다음 패치 {next_patch} 채택"
        f"{' / 불변식 위반 - 롤백 우선' if p0v else ''}."
    )
    push(f"```\n{summary}\n```")
    push("")

    return "\n".join(L)

# ──────────────────────────────────────────────────────────────────────────────
# 7) CLI
# ──────────────────────────────────────────────────────────────────────────────
def main():
    log_path = "/tmp/freevar.log"
    out_path = "/tmp/v5_analysis_report.md"
    use_stdin = False
    for arg in sys.argv[1:]:
        if arg.startswith("--log="):
            log_path = arg.split("=", 1)[1]
        elif arg.startswith("--out="):
            out_path = arg.split("=", 1)[1]
        elif arg == "--stdin":
            use_stdin = True
        elif arg in ("-h", "--help"):
            print(__doc__); return 0

    # 입력 로드
    if use_stdin:
        text = sys.stdin.read()
    else:
        p = Path(log_path)
        if not p.exists():
            print(f"[error] 로그 파일 없음: {log_path}", file=sys.stderr)
            print("        --log=<path> 또는 --stdin 으로 지정", file=sys.stderr)
            return 2
        text = p.read_text(encoding="utf-8", errors="replace")

    parsed = parse_log(text)
    if not parsed["jikgun"]:
        print("[error] 직군별 종합 블록을 찾지 못함 — 러너가 완주했는지 확인", file=sys.stderr)
        return 3

    report = render_report(parsed)
    # stdout 출력
    print(report)
    # 파일 저장
    try:
        Path(out_path).write_text(report, encoding="utf-8")
        print(f"\n[ok] 리포트 저장: {out_path}", file=sys.stderr)
    except Exception as e:
        print(f"[warn] 리포트 저장 실패: {e}", file=sys.stderr)
    return 0

if __name__ == "__main__":
    sys.exit(main())
