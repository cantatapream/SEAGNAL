# ============================================================================
# 파일명: scripts/hazard_rocks_ocr_build_review.py
# 역할: 노출암 고립판정 OCR 배치 결과(JSON)에서 "사람이 봐야 하는" 애매 판정만
#   골라, 이미지를 base64로 내장한 단일 HTML 검토 페이지(hazard_rocks_ocr_
#   review_template.html 기반)를 생성한다. Artifact로 배포해 사람이 한 장씩
#   보며 판정하고 결과 JSON을 내보낼 수 있다.
# ============================================================================
#
# [핵심 규칙 — 반드시 지킬 것, 2026-08-03 사용자 확정]
#   AI가 verdict=land로 판정한 항목은 검토 대상에서 제외한다. 1,000개(애매
#   판정 283건) 전수 사람 검토에서 AI의 land 판정이 단 한 번도 뒤집힌 적이
#   없었기 때문 — 신뢰도가 충분히 검증됐으므로 재차 물어볼 필요가 없다.
#   검토가 필요한 건 water_reading인데 근거가 약한 것(색구역 추정/근거없음/
#   심볼만)과 데이터 자체가 없는 것뿐이다. 이 필터를 우회하거나 land를
#   다시 검토 큐에 넣지 말 것.
#
# [사용법]
#   python3 hazard_rocks_ocr_build_review.py \
#       --results <배치결과.json> \
#       --image-dir <이미지폴더1> [--image-dir <이미지폴더2> ...] \
#       --out <출력.html> [--title "노출암 애매 판정 검토"] [--max-mb 15]
#
#   <배치결과.json>: [{id, label, region, lat, lon, badaDepth, badaDistM,
#                       verdict, chartDepthM, readingBasis, note}, ...]
#   이미지 폴더들: hazard_rocks_ocr_fetch.js + _stitch.py 가 만든
#     {label}_centered.png / {label}_wide_marked.png 를 찾을 폴더(여러 개 가능,
#     배치를 여러 워크플로우로 나눠 돌렸으면 그 폴더들을 전부 나열).
#   --max-mb: 이 크기를 넘으면 자동으로 여러 HTML로 분할 출력한다
#     (Artifact 업로드 제한 16MB 대응, 기본 15MB로 여유를 둠). 분할 시 출력
#     파일명은 <out 베이스>_a.html, _b.html, ... 로 늘어난다.
#
# [연계]
#   - hazard_rocks_ocr_fetch.js / hazard_rocks_ocr_stitch.py → 이미지 생성(선행)
#   - hazard_rocks_ocr_review_template.html → HTML/CSS/JS 템플릿(이 스크립트가 채움)
#   - HAZARD_ROCKS_HANDOFF.md §6.4~6.7, HAZARD_ROCKS_HANDOFF_BRIEF.md → 배경·재현법
# ============================================================================

import argparse
import base64
import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "hazard_rocks_ocr_review_template.html")

AMBIGUOUS_BASIS = {"color_zone_only", "none", "symbol_only"}
AMBIGUOUS_VERDICT_NO_DATA = {"hazard_zone_no_data", "no_data_uniform"}


def needs_review(r):
    """land로 판정된 건 신뢰도가 검증됐으므로 절대 재검토 대상에 넣지 않는다."""
    if r.get("verdict") == "land":
        return False
    if r.get("readingBasis") in AMBIGUOUS_BASIS:
        return True
    if r.get("verdict") in AMBIGUOUS_VERDICT_NO_DATA:
        return True
    return False


def find_image(image_dirs, label, suffix):
    for d in image_dirs:
        p = os.path.join(d, f"{label}{suffix}")
        if os.path.exists(p):
            return p
    return None


def to_data_uri(path):
    with open(path, "rb") as f:
        b = f.read()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii")


def build_records(results, image_dirs):
    records = []
    missing = []
    for r in results:
        if not needs_review(r):
            continue
        label = r["label"]
        centered = find_image(image_dirs, label, "_centered.png")
        wide = find_image(image_dirs, label, "_wide_marked.png")
        if not centered:
            missing.append(label)
            continue
        records.append({
            "id": r["id"], "label": label, "region": r.get("region"),
            "lat": r["lat"], "lon": r["lon"],
            "badaDepth": r.get("badaDepth"), "badaDistM": r.get("badaDistM"),
            "verdict": r.get("verdict"), "chartDepthM": r.get("chartDepthM"),
            "readingBasis": r.get("readingBasis"), "note": r.get("note", ""),
            "centeredSrc": to_data_uri(centered),
            "wideSrc": to_data_uri(wide) if wide else None,
        })
    return records, missing


def render_html(records, title):
    tpl = open(TEMPLATE_PATH, encoding="utf-8").read()
    if title:
        tpl = tpl.replace("<title>노출암 애매 판정 검토</title>", f"<title>{title}</title>", 1)
        tpl = tpl.replace("노출암 애매 판정 검토 · 오퍼스", title, 1)
    data_js = "const REVIEW_DATA = " + json.dumps(records, ensure_ascii=False) + ";"
    return tpl.replace("/*__DATA__*/", data_js)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--image-dir", action="append", required=True, dest="image_dirs")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="노출암 애매 판정 검토")
    ap.add_argument("--max-mb", type=float, default=15.0)
    args = ap.parse_args()

    results = json.load(open(args.results, encoding="utf-8"))
    records, missing = build_records(results, args.image_dirs)
    print(f"전체 {len(results)}건 중 검토 필요(land 제외 애매 판정): {len(records)}건")
    if missing:
        print(f"⚠ 이미지 못 찾음({len(missing)}건, 검토 목록에서 제외됨): {missing[:20]}{'...' if len(missing) > 20 else ''}")

    if not records:
        print("검토할 애매 판정이 없습니다 — 페이지를 만들지 않습니다.")
        return

    html = render_html(records, args.title)
    size_mb = len(html.encode("utf-8")) / 1e6

    base, ext = os.path.splitext(args.out)
    if size_mb <= args.max_mb:
        open(args.out, "w", encoding="utf-8").write(html)
        print(f"작성: {args.out} ({size_mb:.2f} MB, {len(records)}건)")
        return

    # 용량 초과 — 여러 페이지로 분할
    n_parts = max(2, int(size_mb // args.max_mb) + 1)
    chunk = (len(records) + n_parts - 1) // n_parts
    labels = [chr(ord("a") + i) for i in range(n_parts)]
    for i, suffix in enumerate(labels):
        part = records[i * chunk: (i + 1) * chunk]
        if not part:
            continue
        part_html = render_html(part, f"{args.title} ({suffix.upper()}/{n_parts})")
        part_path = f"{base}_{suffix}{ext}"
        open(part_path, "w", encoding="utf-8").write(part_html)
        part_mb = len(part_html.encode("utf-8")) / 1e6
        print(f"작성: {part_path} ({part_mb:.2f} MB, {len(part)}건)")


if __name__ == "__main__":
    main()
