# -*- coding: utf-8 -*-
"""law.go.kr 에 **낱말별로 몇 건이나 있는지** 세어 보는 한 번짜리 탐침. (조사용)

★게이트가 아니다 — 수집 범위를 가늠할 때 손으로 돌려 보는 자다.
낱말 여섯(어선·수산·해양·수중레저·마리나·선원)을 `법령`·`행정규칙`·`자치법규` 세 칸에서 세어
표로 찍는다. 값을 저장하지 않으므로 **돌릴 때마다 그날의 수**다.
⚠2026-09-24 — 머리말이 없어 `loop_tool_census` 가 「무엇을 하는 자인지 모른다」로 세던 자다(G-15).
"""
import json,urllib.request,urllib.parse
OC="hyoo1431"
def cnt(target,kw):
    q=urllib.parse.quote(kw)
    url=f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target={target}&type=JSON&query={q}&display=1"
    try:
        d=json.load(urllib.request.urlopen(url,timeout=20))
        k=list(d.keys())[0]
        return d[k].get('totalCnt','?')
    except Exception as e:
        return f"err({e})"
for kw in ["어선","수산","해양","수중레저","마리나","선원"]:
    print(f"{kw:8s} | 법령:{cnt('eflaw',kw):>5} | 행정규칙:{cnt('admrul',kw):>5} | 자치법규:{cnt('ordin',kw):>6}")
