#!/usr/bin/env python3
"""
나리야 운영 로그 환각·CoT 누수 캡처 — assistant-log 에서 의심 응답 자동 추출.

[목적]
- 운영 로그의 각 답변을 검사해 (1) CoT(사고과정) 누수, (2) 환각 단정형,
  (3) 컨텍스트 라벨 누수([최근 대화]/memory: 등) 를 찾아 의심건만 출력.
- 거절문(REFUSAL)은 환각으로 처리하지 않는다(오탐 가드).

[입력 소스 — 3택1]
- http : GET http://127.0.0.1:$PORT/api/admin/assistant-log?n=N  → {ok, entries:[...]}
- file : --path 의 JSON. {entries:[...]} 또는 [...] 또는 JSONL(줄당 1객체) 모두 허용.
         미지정 시 local_server/data/ 하위 assistant_log*.json* 자동 탐색.
- stdin: 파이프로 위와 같은 JSON/JSONL 전달.
- 항목 형식: {ts, query, answer, tools, zone, intent, aiUsed}

[사용법]
  python3 halluc_cot_capture.py --source=http   [--port=3001] [--n=300]
  python3 halluc_cot_capture.py --source=file   [--path=/경로/log.json]
  python3 halluc_cot_capture.py --source=stdin  < log.jsonl
  옵션: --limit=N (처음 N건만), --json (의심건을 JSON 으로 출력)

[정규식 출처]
- COT_PATTERNS / HALLUC_INDICATORS / REFUSAL_RE 는
  phase2b_eval_freevar_runner.py 의 것을 재사용·확장(컨텍스트 라벨 추가).
"""
import json, os, re, sys, glob, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent.parent / "data"   # local_server/data

# ── 정규식 (phase2b_eval_freevar_runner.py 재사용) ──────────────────────────
# CoT(사고 과정) 누수 의심 패턴
COT_PATTERNS = [
    r"thinking\s*[:：]", r"sources\s*[:：]", r"먼저\s+\S+를?\s+확인",
    r"내가\s+생각", r"추론\s*과정", r"reasoning\s*[:：]",
    r"단계\s*\d+\s*[:：]", r"step\s*\d+\s*[:：]",
]
COT_RE = re.compile("|".join(COT_PATTERNS), re.IGNORECASE)

# 환각 의심 패턴(도구 결과에 통상 없는 단정형 수치/법령)
HALLUC_INDICATORS = [
    r"약 \d+km", r"약 \d+제곱", r"통계는", r"법령\s*제\d+조",
    r"약 \d+년", r"약 \d+\.\d+", r"약 \d+퍼센트",
]
HALLUC_RE = re.compile("|".join(HALLUC_INDICATORS))

# 컨텍스트/시스템 라벨 누수(프롬프트 내부 구조가 답변에 새어나온 경우)
CONTEXT_LEAK_PATTERNS = [
    r"\[최근\s*대화\]", r"\[대화\s*기록\]", r"\[컨텍스트\]", r"\[시스템\]",
    r"memory\s*[:：]", r"context\s*[:：]", r"system\s*prompt",
    r"<\s*assistant\s*>", r"<\s*user\s*>", r"\bprofile\s*[:：]",
]
CONTEXT_LEAK_RE = re.compile("|".join(CONTEXT_LEAK_PATTERNS), re.IGNORECASE)

# 거절·정보없음(환각 아님 — 보호 가드)
REFUSAL_RE = re.compile(r"없어요|모릅|가져오지|찾지\s*못|지원하지|범위.*벗어|확인할\s*수\s*없")


def load_http(port, n):
    """HTTP: /api/admin/assistant-log 호출 → entries 리스트."""
    url = f"http://127.0.0.1:{port}/api/admin/assistant-log?n={n}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    try:
        obj = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[error] HTTP 응답이 JSON 이 아님: {e}", file=sys.stderr)
        sys.exit(2)
    if isinstance(obj, dict) and obj.get("ok") is False:
        print(f"[error] 서버 오류 응답: {obj.get('error')}", file=sys.stderr)
        sys.exit(2)
    return _coerce_entries(obj)


def load_text(text):
    """문자열을 JSON 또는 JSONL 로 파싱 → entries 리스트."""
    text = text.strip()
    if not text:
        return []
    # 먼저 통JSON 시도
    try:
        return _coerce_entries(json.loads(text))
    except json.JSONDecodeError:
        pass
    # JSONL(줄당 1객체) 시도
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return out


def load_file(path):
    """파일 경로(또는 자동 탐색) 에서 entries 로드."""
    if not path:
        # data/ 하위 assistant_log 관련 파일 자동 탐색
        cands = glob.glob(str(DATA_DIR / "assistant_log*.json*"))
        if not cands:
            print(f"[error] --path 미지정 & {DATA_DIR} 에 assistant_log* 없음", file=sys.stderr)
            sys.exit(2)
        path = sorted(cands)[-1]  # 가장 최근(이름순 마지막)
        print(f"[info] 자동 선택: {path}", file=sys.stderr)
    p = Path(path)
    if not p.exists():
        print(f"[error] 파일 없음: {p}", file=sys.stderr)
        sys.exit(2)
    return load_text(p.read_text(encoding="utf-8"))


def _coerce_entries(obj):
    """{entries:[...]} / {data:[...]} / [...] 어떤 형태든 리스트로 정규화."""
    if isinstance(obj, dict):
        return obj.get("entries") or obj.get("data") or obj.get("logs") or []
    if isinstance(obj, list):
        return obj
    return []


def inspect(answer):
    """답변 1건 검사 → 매칭된 패턴 라벨 리스트.
    거절문이면 환각 판정은 면제(CoT/라벨누수는 그대로 검사)."""
    hits = []
    is_refusal = bool(REFUSAL_RE.search(answer))
    if COT_RE.search(answer):
        hits.append("CoT누수")
    if CONTEXT_LEAK_RE.search(answer):
        hits.append("라벨누수")
    if HALLUC_RE.search(answer) and not is_refusal:
        hits.append("환각")
    return hits, is_refusal


def excerpt(answer, pat_re, span=40):
    """매칭 지점 주변만 발췌(없으면 앞부분)."""
    m = pat_re.search(answer)
    if not m:
        return answer[:80].replace("\n", " ")
    s = max(0, m.start() - span)
    e = min(len(answer), m.end() + span)
    return ("…" if s > 0 else "") + answer[s:e].replace("\n", " ") + ("…" if e < len(answer) else "")


def main():
    args = {a.split("=", 1)[0]: (a.split("=", 1)[1] if "=" in a else True)
            for a in sys.argv[1:]}
    source = args.get("--source", "http")

    def _int_arg(key, default):
        """숫자 옵션 파싱 가드 — 잘못된 값이면 traceback 대신 종료(2)."""
        raw = args.get(key, default)
        if raw is True:  # '--n' 처럼 값 없이 준 경우
            print(f"[error] {key} 에 숫자 값이 필요합니다", file=sys.stderr)
            sys.exit(2)
        try:
            return int(raw)
        except (TypeError, ValueError):
            print(f"[error] {key} 값이 정수가 아닙니다: {raw!r}", file=sys.stderr)
            sys.exit(2)

    port = _int_arg("--port", os.environ.get("PORT", "3001"))
    n = _int_arg("--n", "300")
    path = args.get("--path")
    limit = _int_arg("--limit", None) if "--limit" in args else None
    as_json = "--json" in args

    # ── 입력 로드 ──
    try:
        if source == "http":
            entries = load_http(port, n)
        elif source == "file":
            entries = load_file(path)
        elif source == "stdin":
            entries = load_text(sys.stdin.read())
        else:
            print(f"[error] --source 는 http|file|stdin 중 하나", file=sys.stderr)
            sys.exit(2)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"[error] HTTP 로드 실패: {e}", file=sys.stderr)
        sys.exit(2)

    if limit is not None:
        if limit < 0:
            print(f"[error] --limit 은 0 이상이어야 합니다: {limit}", file=sys.stderr)
            sys.exit(2)
        entries = entries[:limit]

    # ── 검사 ──
    total = len(entries)
    suspects = []
    refusal_cnt = 0
    pat_map = {"CoT누수": COT_RE, "라벨누수": CONTEXT_LEAK_RE, "환각": HALLUC_RE}
    for idx, e in enumerate(entries):
        ans = str(e.get("answer") or "")
        if not ans:
            continue
        hits, is_refusal = inspect(ans)
        if is_refusal:
            refusal_cnt += 1
        if not hits:
            continue
        # 발췌는 첫 히트 패턴 기준
        ex = excerpt(ans, pat_map[hits[0]])
        suspects.append({
            "id": e.get("id", idx),
            "ts": e.get("ts"),
            "patterns": hits,
            "query": str(e.get("query") or "")[:60],
            "excerpt": ex,
            "tools": e.get("tools"),
            "aiUsed": e.get("aiUsed"),
        })

    # ── 출력 ──
    if as_json:
        print(json.dumps({"total": total, "suspect": len(suspects),
                          "items": suspects}, ensure_ascii=False, indent=2))
        return

    print(f"=== 나리야 환각·CoT 누수 캡처 (source={source}) ===")
    print(f"총 {total}건 · 의심 {len(suspects)}건 · 거절문(환각면제) {refusal_cnt}건\n")
    for s in suspects:
        ts = s["ts"]
        print(f"[{s['id']}] ts={ts} {'/'.join(s['patterns'])}")
        if s["query"]:
            print(f"   Q: {s['query']}")
        print(f"   A: {s['excerpt']!r}")
    print()
    rate = (len(suspects) * 100 // total) if total else 0
    # 패턴별 분포
    dist = {}
    for s in suspects:
        for p in s["patterns"]:
            dist[p] = dist.get(p, 0) + 1
    dist_str = " · ".join(f"{k} {v}" for k, v in dist.items()) or "없음"
    print(f"==== 의심율 {rate}% ({len(suspects)}/{total}) · 패턴분포: {dist_str} ====")


if __name__ == "__main__":
    main()
