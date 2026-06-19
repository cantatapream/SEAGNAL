#!/usr/bin/env python3
"""
memory_v2 평가 *러너* — memory_v2_eval.jsonl (50문항) 직렬 실행.

[배경]
사용자 기억 시스템 v2 (A1~A6) 회귀·기능 검증.
- A3 압축 두뇌 (merge/add/skip)
- A4 회수 두뇌 (4단계 하이브리드)
- A5 연관성 가드
- A6 프라이버시 (라벨 누수 0 + admin 차단)

[설계]
- freevar 러너 (`phase2b_eval_freevar_runner.py`) 와 호환 가능한 직렬 실행.
- 케이스 사이 PACING_S 초 sleep. 429 백오프 3회.
- 기존 freevar 5축 (A/B/C/D/E) 대신 **신규 memv2 5축 (M/R/E2/A2/P)** 채점.
- 카테고리별 (C1~C8) + 직군별 + 종합 매트릭스 + DoD 게이트.

[stub 정책 — 신규 5축]
- DB 미구현(`/api/memory/seed`, `/api/memory/stats` 부재). 따라서:
  · prev_episodes → request body 의 `memory` 필드에 동봉 (서버가 그대로 컨텍스트 사용).
  · expect_episode_appended (E2) / expect_consolidated_action (A2) 는
    응답에 `data.memoryAction` / `data.memoryRecall` 이 있으면 사용, 없으면 STUB SKIP.
- E1/E_server 통합 후 `seed_user_state()` / `get_episode_count()` 활성화.

[신규 5축 — 채점]
  M  회수 정확성 : expect_memory_recall_contains 의 모든 키워드가 답에 포함됨.
  R  연관성 가드 : expect_relevance_block 의 boolean 과 실제 회수 상태 일치.
                  · true  → 답에 회수 키워드 0건 AND data.memoryRecall == [].
                  · false → 적어도 회수 키워드 1건 노출 OR data.memoryRecall != [].
  E2 에피소드 누적: expect_episode_appended=true 면 응답 후 episodes 카운트 +1.
                   (현 STUB: data.memoryStats.episodesAfter == before+1; 없으면 SKIP)
  A2 압축 액션  : expect_consolidated_action 의 merge/add/skip/none 와 일치.
                  (현 STUB: data.memoryAction; 없으면 SKIP)
  P  라벨 누수  : 답 텍스트에 "memory:" "[직전 확정 대상]" "[사용자 직군]"
                  "(기억:" "(라벨:" "episode_id=" "memory_id=" 패턴 0건.
                  (C6 HARD — 1건이라도 실패하면 전체 게이트 차단)

[DoD 게이트]
  C1 회수      ≥ 80%   (MEMV2_DOD_C1_FLOOR)
  C2 압축      ≥ 75%   (MEMV2_DOD_C2_FLOOR)
  C3 가드      ≥ 90%   (MEMV2_DOD_C3_FLOOR)
  C4 누적      ≥ 80%   (MEMV2_DOD_C4_FLOOR)
  C5 채팅↔음성 ≥ 80%  (MEMV2_DOD_C5_FLOOR)
  C6 프라이버시 5/5 HARD (MEMV2_DOD_C6_FLOOR=100)
  C7 명시거부  ≥ 75%   (MEMV2_DOD_C7_FLOOR)
  C8 마이그레이션 ≥ 80% (MEMV2_DOD_C8_FLOOR)
  종합        ≥ 80%    (MEMV2_DOD_PASS_PCT)
  라벨 누수   0건 HARD (MEMV2_DOD_LABEL_LEAK_MAX=0)
  net p95     ≤ 5500ms (MEMV2_P95_MS)

[실행]
  python3 memory_v2_runner.py [--limit=N] [--category=Cn] [http://host[:port]]
    --limit=N        : 처음 N건만
    --category=C1..C8: 단일 카테고리만 (예: --category=C6)
    positional URL   : 기본 http://127.0.0.1:${PORT:-3001}

[출력]
  - 카테고리 × 직군 매트릭스
  - 신규 5축 통계 (M/R/E2/A2/P PASS/총)
  - 실패 샘플 10건
  - 라벨 누수 / 환각 의심 샘플
  - DoD 게이트 결과 + VIOLATION 종합
"""
import json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

# ─── 경로·서버 설정 ──────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
EVAL = HERE / "memory_v2_eval.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
DEFAULT_HOST = f"http://127.0.0.1:{PORT}"
TIMEOUT = 60
PACING_S = float(os.environ.get("MEMV2_PACING_S", "3.0"))
LOG_EVERY = 10

# ─── DoD 게이트 (env override) ───────────────────────────────────
DOD_PASS_PCT = int(os.environ.get("MEMV2_DOD_PASS_PCT", "80"))
DOD_CAT_FLOOR = {
    "C1": int(os.environ.get("MEMV2_DOD_C1_FLOOR", "80")),
    "C2": int(os.environ.get("MEMV2_DOD_C2_FLOOR", "75")),
    "C3": int(os.environ.get("MEMV2_DOD_C3_FLOOR", "90")),
    "C4": int(os.environ.get("MEMV2_DOD_C4_FLOOR", "80")),
    "C5": int(os.environ.get("MEMV2_DOD_C5_FLOOR", "80")),
    "C6": int(os.environ.get("MEMV2_DOD_C6_FLOOR", "100")),  # HARD
    "C7": int(os.environ.get("MEMV2_DOD_C7_FLOOR", "75")),
    "C8": int(os.environ.get("MEMV2_DOD_C8_FLOOR", "80")),
}
DOD_LABEL_LEAK_MAX = int(os.environ.get("MEMV2_DOD_LABEL_LEAK_MAX", "0"))
P95_GATE_MS = int(os.environ.get("MEMV2_P95_MS", "5500"))

# ─── 라벨 누수 패턴 (P 축 / C6 HARD) ─────────────────────────────
# 시스템 라벨이 사용자 답에 그대로 누출되는 경우를 검출.
LABEL_LEAK_PATTERNS = [
    r"\(기억\s*[:：]",
    r"\(라벨\s*[:：]",
    r"\[직전\s*확정\s*대상\]",
    r"\[사용자\s*직군\]",
    r"\bmemory\s*[:：]",          # 답 본문에 "memory:" 라벨 노출
    r"\bepisode_id\s*=",
    r"\bmemory_id\s*=",
    r"<memory>",
    r"</memory>",
]
LABEL_LEAK_RE = re.compile("|".join(LABEL_LEAK_PATTERNS), re.IGNORECASE)

# ─── 카테고리 ID prefix → C# 매핑 ────────────────────────────────
def cat_of(case):
    """case['id'] = 'MEMV2-C3-04' → 'C3'."""
    m = re.match(r"MEMV2-(C\d)-", case.get("id", ""))
    return m.group(1) if m else "C?"


# ─── HTTP 호출 (freevar 러너와 동일 시그니처) ───────────────────
def ask(url, query, profile=None, memory=None, flags=None, max_retry=3):
    """(data, metrics, err) 반환."""
    body = {"query": query, "memory": memory or []}
    if profile is not None: body["profile"] = profile
    if flags is not None:   body["flags"] = flags
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    backoff_ms = 0
    last_pure = 0
    for attempt in range(max_retry + 1):
        req = urllib.request.Request(url, data=payload,
            headers={"Content-Type": "application/json"}, method="POST")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8")
                pure = int((time.monotonic() - t0) * 1000)
                return json.loads(raw), {
                    "pure_ms": pure, "backoff_ms": backoff_ms,
                    "attempts": attempt + 1, "last_attempt_ms": None,
                }, None
        except urllib.error.HTTPError as e:
            last_pure = int((time.monotonic() - t0) * 1000)
            if e.code == 429 and attempt < max_retry:
                wait_s = 5 + attempt * 5
                time.sleep(wait_s); backoff_ms += wait_s * 1000
                continue
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1,
                          "last_attempt_ms": last_pure}, f"HTTP {e.code}"
        except Exception as e:
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1,
                          "last_attempt_ms": int((time.monotonic() - t0) * 1000)}, \
                   f"{type(e).__name__}: {e}"
    return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                  "attempts": max_retry + 1,
                  "last_attempt_ms": last_pure}, "HTTP 429(exhausted)"


def percentile(values, p):
    if not values: return 0
    s = sorted(values); k = (len(s) - 1) * p
    f = int(k); c = min(f + 1, len(s) - 1)
    return int(s[f] + (s[c] - s[f]) * (k - f)) if f != c else s[f]


# ─── STUB: DB 시뮬레이션 ────────────────────────────────────────
# E1/E_server 통합 후 아래 두 함수를 실제 DB 호출로 교체.
def seed_user_state(case, host):
    """[STUB] prev_episodes 등을 사용자 DB 에 시드.
    현재는 미구현 — `ask()` 호출 시 prev_episodes 를 memory 필드로 직접 전달.
    향후 E_server 의 /api/memory/seed 가 생기면 여기서 호출.
    """
    return None  # silent stub


def get_episode_count(host, user_id):
    """[STUB] 사용자 episodes 카운트. 미구현 → None 반환 → E2 축 SKIP."""
    return None  # silent stub


def cleanup_user_state(case, host):
    """[STUB] 케이스 종료 후 격리 클린업."""
    return None  # silent stub


# ─── prev_episodes → memory 필드 변환 ───────────────────────────
def build_memory_field(case):
    """prev_episodes 를 ask() 의 memory 배열로 직렬화.
    서버가 memory 필드를 어떻게 해석하든, prev_consolidated 의 frequent_zone 도
    함께 합쳐 컨텍스트로 보강한다.
    """
    out = []
    for ep in case.get("prev_episodes") or []:
        # freevar 호환을 위해 자연어 요약으로 동봉.
        zone = ep.get("zone") or ""
        topic = ep.get("topic") or ""
        tools = ",".join(ep.get("tools") or [])
        out.append({
            "role": "memory_episode",
            "zone": zone, "topic": topic, "tools": tools,
            "summary": f"{zone} {topic}".strip(),
        })
    for cm in case.get("prev_consolidated") or []:
        out.append({
            "role": "memory_consolidated",
            "key": cm.get("key"), "value": cm.get("value"),
            "freq": cm.get("freq"),
            "summary": f"{cm.get('key')}={cm.get('value')} (freq={cm.get('freq')})",
        })
    for ls in case.get("prev_localstorage_memory") or []:
        # C8 마이그레이션 시드
        out.append({"role": "memory_localstorage", "summary": json.dumps(ls, ensure_ascii=False)})
    return out


# ─── 신규 5축 채점 ──────────────────────────────────────────────
def evaluate(case, data, ms, err):
    """memv2 5축 (M/R/E2/A2/P) 채점. dict {ok, axes, notes, ans_short, tools}."""
    if err:
        return {"ok": False, "err": err, "axes": {}, "notes": [f"ERR {err}"],
                "tools": [], "ans_short": ""}
    ans = data.get("answer") or ""
    tools = (data.get("data") or {}).get("toolsUsed") or []
    recall = (data.get("data") or {}).get("memoryRecall")
    action = (data.get("data") or {}).get("memoryAction")
    stats = (data.get("data") or {}).get("memoryStats") or {}
    if not ans:
        return {"ok": False, "axes": {}, "notes": ["empty ans"],
                "tools": tools, "ans_short": ""}

    axes = {"M": None, "R": None, "E2": None, "A2": None, "P": None}
    notes = []

    # M — 회수 정확성
    recall_kw = case.get("expect_memory_recall_contains")
    if recall_kw is not None:
        if len(recall_kw) == 0:
            # C7: 빈 배열은 "회수 키워드가 없어야 한다" 를 의미. R 와 함께 검사.
            axes["M"] = True  # 빈 배열은 자명 True; 실제 차단은 R 가 담당.
        else:
            missing = [k for k in recall_kw if k not in ans]
            axes["M"] = len(missing) == 0
            if missing:
                notes.append(f"M: missing recall keywords {missing}")

    # R — 연관성 가드 (블록 일치)
    if "expect_relevance_block" in case:
        expected_block = bool(case["expect_relevance_block"])
        # 회수 키워드 노출 / data.memoryRecall 모두 확인.
        kw = case.get("expect_memory_recall_contains") or []
        kw_seen = any(k in ans for k in kw) if kw else False
        recall_seen = bool(recall) if recall is not None else False
        actual_block = (not kw_seen) and (not recall_seen)
        axes["R"] = (actual_block == expected_block)
        if not axes["R"]:
            notes.append(f"R: expected_block={expected_block} actual_block={actual_block}"
                         f" (kw_seen={kw_seen} recall_seen={recall_seen})")

    # E2 — 에피소드 누적 (STUB)
    if case.get("expect_episode_appended"):
        before = stats.get("episodesBefore")
        after = stats.get("episodesAfter")
        if before is not None and after is not None:
            axes["E2"] = (after == before + 1)
            if not axes["E2"]:
                notes.append(f"E2: episodes {before}→{after} (expected +1)")
        else:
            # STUB SKIP — data.memoryStats 미구현. 채점 제외.
            axes["E2"] = None

    # A2 — 압축 액션 (STUB)
    exp_action = case.get("expect_consolidated_action")
    if exp_action:
        if action is not None:
            axes["A2"] = (str(action).lower() == str(exp_action).lower())
            if not axes["A2"]:
                notes.append(f"A2: memoryAction={action!r} expected={exp_action!r}")
        else:
            # STUB SKIP — data.memoryAction 미구현.
            axes["A2"] = None

    # P — 라벨 누수 (C6 HARD; expect_no_label_leak 가 명시되면 강제 검사)
    leak_match = LABEL_LEAK_RE.search(ans)
    if case.get("expect_no_label_leak"):
        axes["P"] = (leak_match is None)
        if leak_match:
            notes.append(f"P: label leak pattern {leak_match.group(0)!r}")
    else:
        # 모든 카테고리에 대해 누수는 전역 카운트만 — 채점은 명시된 케이스만.
        pass

    # 종합 ok = 명시된 축 모두 True.
    explicit = [v for v in axes.values() if v is not None]
    ok = all(explicit) if explicit else True

    return {
        "ok": ok, "axes": axes, "notes": notes,
        "tools": tools, "ans_short": ans[:80],
        "label_leak": leak_match is not None,
    }


# ─── 메인 ───────────────────────────────────────────────────────
def main():
    if not EVAL.exists():
        print("[error] eval JSONL 없음:", EVAL); sys.exit(2)
    cases = [json.loads(l) for l in EVAL.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"[load] {len(cases)} 케이스 ← {EVAL.name}")

    # ─ CLI 파싱
    arg_limit = None
    arg_cat = None
    host = DEFAULT_HOST
    for a in sys.argv[1:]:
        if a.startswith("--limit="):
            arg_limit = int(a.split("=", 1)[1])
        elif a.startswith("--category="):
            arg_cat = a.split("=", 1)[1].upper()
        elif a.startswith("http://") or a.startswith("https://"):
            host = a.rstrip("/")
        else:
            print(f"[warn] unknown arg ignored: {a}")
    url = f"{host}/api/assistant/ask"
    print(f"[host] {url}")

    if arg_cat:
        cases = [c for c in cases if cat_of(c) == arg_cat]
        print(f"[filter] category={arg_cat} → {len(cases)} 케이스")
    if arg_limit:
        cases = cases[:arg_limit]
        print(f"[filter] limit={arg_limit} → {len(cases)} 케이스")

    if not cases:
        print("[error] 실행할 케이스 0건"); sys.exit(2)

    print(f"=== memory_v2 평가 — {len(cases)} 케이스 직렬 실행 ===\n")

    # 집계 컨테이너
    by_cat = defaultdict(lambda: {"pass": 0, "fail": 0, "total": 0})
    by_jg = defaultdict(lambda: {"pass": 0, "fail": 0, "total": 0})
    by_cat_jg = defaultdict(lambda: defaultdict(lambda: {"pass": 0, "total": 0}))
    axes_stats = {ax: {"pass": 0, "total": 0} for ax in ("M", "R", "E2", "A2", "P")}
    fails = []
    label_leaks = []
    latencies_net = []
    latencies_raw = []
    backoff_per_case_ms = []
    n_429 = 0
    t_start = time.time()

    for i, c in enumerate(cases):
        if i > 0 and i % LOG_EVERY == 0:
            elapsed = int(time.time() - t_start)
            print(f"  [{i}/{len(cases)}] 경과 {elapsed}s …")

        # [STUB] 시드 — 현재는 prev_episodes 를 memory 필드로 전달
        seed_user_state(c, host)
        memory = build_memory_field(c)

        # flags: opt-out
        flags = None
        if c.get("user_explicit_opt_out"):
            flags = {"memory_opt_out": True}

        time.sleep(PACING_S)
        data, m, err = ask(url, c["query"], c.get("profile"), memory, flags)
        ev = evaluate(c, data, m["pure_ms"] if m else 0, err)

        if data is not None:
            pure = m["pure_ms"]; bo = m["backoff_ms"]
            latencies_net.append(pure)
            latencies_raw.append(pure + bo)
            backoff_per_case_ms.append(bo)
            if bo: n_429 += 1

        cat = cat_of(c)
        jg = c.get("jikgun", "?")
        by_cat[cat]["total"] += 1
        by_jg[jg]["total"] += 1
        by_cat_jg[cat][jg]["total"] += 1
        if ev["ok"]:
            by_cat[cat]["pass"] += 1
            by_jg[jg]["pass"] += 1
            by_cat_jg[cat][jg]["pass"] += 1
        else:
            by_cat[cat]["fail"] += 1
            by_jg[jg]["fail"] += 1
            fails.append((c["id"], cat, jg, ev.get("notes", []), ev.get("ans_short", "")))

        # 5축 통계
        for ax, val in (ev.get("axes") or {}).items():
            if val is None: continue
            axes_stats[ax]["total"] += 1
            if val: axes_stats[ax]["pass"] += 1

        # 라벨 누수 전역 카운트 (모든 답 대상)
        if ev.get("label_leak"):
            label_leaks.append((c["id"], cat, jg, ev["ans_short"]))

        # cleanup
        cleanup_user_state(c, host)

    # ─── 리포트 ──────────────────────────────────────────────
    print()
    print("======= 카테고리별 종합 =======")
    cat_order = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]
    cat_label = {
        "C1": "회수", "C2": "압축", "C3": "가드", "C4": "누적",
        "C5": "채↔음", "C6": "프라(H)", "C7": "거부", "C8": "마이그",
    }
    for c in cat_order:
        st = by_cat.get(c)
        if not st or st["total"] == 0: continue
        pct = st["pass"] * 100 // st["total"]
        floor = DOD_CAT_FLOOR.get(c, 0)
        mark = "PASS" if pct >= floor else "FAIL"
        print(f"  {c} {cat_label[c]:<8s}  PASS {st['pass']:>2d}/{st['total']:>2d}  "
              f"({pct:>3d}%)  gate>={floor}%  {mark}")

    print()
    print("======= 직군별 종합 =======")
    for jg in sorted(by_jg):
        st = by_jg[jg]
        if st["total"] == 0: continue
        pct = st["pass"] * 100 // st["total"]
        print(f"  {jg:16s}  PASS {st['pass']:>2d}/{st['total']:>2d}  ({pct}%)")

    print()
    print("======= 카테고리 × 직군 매트릭스 =======")
    jg_set = sorted({jg for cat in by_cat_jg for jg in by_cat_jg[cat]})
    header = "  " + "Cn".ljust(4) + " | " + " ".join(f"{jg[:10]:>10s}" for jg in jg_set)
    print(header)
    for c in cat_order:
        if c not in by_cat_jg: continue
        row = "  " + c.ljust(4) + " | "
        for jg in jg_set:
            s = by_cat_jg[c].get(jg, {"pass": 0, "total": 0})
            if s["total"] == 0:
                row += f"{'-':>10s} "
            else:
                row += f"{s['pass']:>4d}/{s['total']:<4d} "
        print(row)

    print()
    print("======= 신규 5축 (M=회수 R=가드 E2=누적 A2=압축 P=라벨) =======")
    for ax in ("M", "R", "E2", "A2", "P"):
        st = axes_stats[ax]
        if st["total"] == 0:
            print(f"  {ax:>2s}  -  (SKIP, 명시 케이스 0건 또는 STUB)")
        else:
            pct = st["pass"] * 100 // st["total"]
            print(f"  {ax:>2s}  PASS {st['pass']:>3d}/{st['total']:<3d}  ({pct}%)")

    # 지연 SLO
    p50_net = percentile(latencies_net, 0.5) if latencies_net else 0
    p95_net = percentile(latencies_net, 0.95) if latencies_net else 0
    p50_raw = percentile(latencies_raw, 0.5) if latencies_raw else 0
    p95_raw = percentile(latencies_raw, 0.95) if latencies_raw else 0
    bo_total_s = sum(backoff_per_case_ms) // 1000 if backoff_per_case_ms else 0

    if latencies_net:
        print()
        print("======= 지연 SLO =======")
        print(f"  net  p50={p50_net}ms  p95={p95_net}ms  평균={sum(latencies_net)//len(latencies_net)}ms  n={len(latencies_net)}")
        print(f"  raw  p50={p50_raw}ms  p95={p95_raw}ms")
        print(f"  backoff 총 {bo_total_s}s · 429 발생 {n_429}/{len(latencies_net)}건")

    if label_leaks:
        print()
        print(f"[라벨 누수 의심 {len(label_leaks)}건] (HARD 게이트)")
        for cid, cat, jg, ans in label_leaks[:10]:
            print(f"  {cid} ({cat} {jg}): {ans!r}")

    if fails:
        print()
        print(f"[실패 샘플 — 처음 10건]")
        for cid, cat, jg, notes, ans in fails[:10]:
            print(f"  {cid} ({cat} {jg}): {'; '.join(notes)} | ans={ans!r}")

    # ─── DoD 게이트 ───────────────────────────────────────────
    print()
    total = sum(s["total"] for s in by_cat.values())
    npass = sum(s["pass"] for s in by_cat.values())
    pass_pct = npass * 100 // total if total else 0

    print(f"==== 종합 PASS {npass}/{total} ({pass_pct}%) · 소요 {int(time.time()-t_start)}s ====")
    print()
    print("=== DoD 게이트 결과 ===")
    print(f"  종합 PASS         {pass_pct}% (gate >={DOD_PASS_PCT}%)         "
          f"{'PASS' if pass_pct >= DOD_PASS_PCT else 'FAIL'}")
    violations = []
    if pass_pct < DOD_PASS_PCT:
        violations.append(f"종합 {pass_pct}<{DOD_PASS_PCT}%")

    for c in cat_order:
        st = by_cat.get(c)
        if not st or st["total"] == 0: continue
        pct = st["pass"] * 100 // st["total"]
        floor = DOD_CAT_FLOOR[c]
        hard = (c == "C6")
        mark = "PASS" if pct >= floor else ("FAIL-HARD" if hard else "FAIL")
        print(f"  {c} floor          {pct}% (gate >={floor}%)         {mark}")
        if pct < floor:
            violations.append(f"{c} {pct}<{floor}%{' [HARD]' if hard else ''}")

    n_leaks = len(label_leaks)
    print(f"  라벨 누수         {n_leaks} (gate <={DOD_LABEL_LEAK_MAX}, HARD)     "
          f"{'PASS' if n_leaks <= DOD_LABEL_LEAK_MAX else 'FAIL-HARD'}")
    if n_leaks > DOD_LABEL_LEAK_MAX:
        violations.append(f"label_leak {n_leaks}>{DOD_LABEL_LEAK_MAX} [HARD]")

    print(f"  net p95           {p95_net}ms (gate <={P95_GATE_MS}ms)       "
          f"{'PASS' if p95_net <= P95_GATE_MS else 'FAIL'}")
    if p95_net > P95_GATE_MS:
        violations.append(f"net p95 {p95_net}>{P95_GATE_MS}")

    if violations:
        print(f"\nVIOLATION: {' · '.join(violations)}")
        sys.exit(1)
    print("\nALL GATES PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
