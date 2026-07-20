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
