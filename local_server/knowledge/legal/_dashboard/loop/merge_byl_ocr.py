#!/usr/bin/env python3
# merge_byl_ocr.py — 이미지 OCR sidecar(_이미지/<id>.txt)를 원문 raw의 <img id="N"> 자리에 접어 넣는다.
# 역할(초보자용): byl_image_ocr_cell이 만든 이미지 판독 텍스트(sidecar)를, 원문 안 <img id="N"> 바로 뒤에
#   【이미지판독 N】 블록으로 삽입한다. 그러면 원문 txt만 봐도 "그 이미지에 뭐가 적혀있었는지(표·수치)"를
#   읽을 수 있고, 도해는 원본 png 경로가 함께 남아 챗봇이 이미지도 띄울 수 있다.
# [연계] 입력 raw/**/*.txt(<img id>) + _이미지/<id>.txt(sidecar) · 출력 같은 raw txt(삽입)
#        · 규칙 _SCHEMA.md 0-A 별표 이미지 이중처리
# 단독 실행(결정적·1회 쓰기 = 경합 없음). 재실행 안전(이미 삽입된 【이미지판독 N】은 skip).
# 사용법: python3 merge_byl_ocr.py <inscope_list.txt>   (없으면 기준법 도메인 01~14 전체)
import os, re, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _touched import Touched

ROOT = "/home/user/SEAGNAL/local_server/knowledge/legal"

def targets():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        return [l.strip() for l in open(sys.argv[1]) if l.strip()]
    out = []
    for p in glob.glob(ROOT + "/raw/**/*.txt", recursive=True):
        rel = p.replace(ROOT + "/", "")
        if rel.startswith("raw/15_관련타부처/") or rel.startswith("raw/_자치법규/"):
            continue
        if "<img id=" in open(p, encoding="utf-8", errors="ignore").read():
            out.append(rel)
    return out

def sidecar_text(d, i):
    fp = os.path.join(d, i + ".txt")
    if not os.path.exists(fp):
        return None
    return open(fp, encoding="utf-8", errors="ignore").read().strip()

tot_files = tot_ins = tot_skip = tot_nosc = 0
touched = Touched('merge_byl_ocr')
for rel in targets():
    p = os.path.join(ROOT, rel)
    s = open(p, encoding="utf-8", errors="ignore").read()
    d = os.path.join(os.path.dirname(p), "_이미지")
    ids = re.findall(r'<img id="(\d+)"', s)
    if not ids:
        continue
    changed = False
    for i in dict.fromkeys(ids):  # 순서보존 유니크
        if f"【이미지판독 {i}】" in s:
            tot_skip += 1
            continue
        txt = sidecar_text(d, i)
        if txt is None:
            tot_nosc += 1
            continue
        png_rel = f"_이미지/{i}.png"
        block = f"\n【이미지판독 {i}】(원본이미지: {png_rel})\n{txt}\n"
        # <img id="i"></img> 또는 <img id="i"> 뒤에 삽입(첫 1회)
        pat_close = f'<img id="{i}"></img>'
        pat_open = f'<img id="{i}">'
        if pat_close in s:
            s = s.replace(pat_close, pat_close + block, 1)
        elif pat_open in s:
            s = s.replace(pat_open, pat_open + block, 1)
        else:
            continue
        tot_ins += 1
        changed = True
    if changed:
        open(p, "w", encoding="utf-8").write(s)
        touched.add(p)
        tot_files += 1

touched.save()
print(f"병합 완료: 파일 {tot_files}개 수정 · 삽입 {tot_ins} · 기존skip {tot_skip} · sidecar없음 {tot_nosc}")
