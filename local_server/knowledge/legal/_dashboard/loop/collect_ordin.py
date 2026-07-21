#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""조례(자치법규) 수집: 해양·수산 키워드로 target=ordin 검색 → 지역별 저장.
   조례는 지역 기반(법 넘나듦)이라 raw/_자치법규/<지역>/에 보관. 지역 비교표 재료."""
import json,urllib.request,urllib.parse,time,os,re
OC='hyoo1431'
OUT='/home/user/SEAGNAL/local_server/knowledge/legal/raw/_자치법규'
KEYS=['어항','어촌','수산','조업','낚시어선','수상레저','해수욕장','해양쓰레기','어선','포구','갯벌']
CAP_KW=40  # 키워드당 상한
def api(u):
    for _ in range(3):
        try:
            with urllib.request.urlopen(u,timeout=25) as r: return json.load(r)
        except Exception: time.sleep(1.2)
    return None
def L(x): return x if isinstance(x,list) else ([] if x is None else [x])
def s(x):
    if x is None: return ''
    if isinstance(x,list): return '\n'.join(s(i) for i in x)
    return str(x)
def safe(n): return re.sub(r'[\/:*?"<>|]','',n).replace(' ','')[:70]
def region(nm):
    m=re.match(r'^([가-힣]+?(?:특별자치도|특별자치시|광역시|특별시|도|시|군|구))',nm)
    return m.group(1) if m else '기타'

def fetch(mst):
    # ★버그수정(2026-07-21, 어촌ㆍ어항법 C그룹 재확인 세션): lawService.do?target=ordin은
    # 자치법규일련번호를 MST= 파라미터로 받아야 한다. 기존 ID= 파라미터는 전혀 다른 필드
    # (자치법규ID)로 해석되어 엉뚱한 조례가 반환됨(raw/_자치법규 84/115개 파일 오염 확인, _LESSONS.md L-18 참조).
    d=api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=ordin&type=JSON&MST={mst}")
    if not d: return ''
    b=d.get('OrdinService') or d.get('LawService') or {}
    return s(b.get('조문내용') or b.get('조문')).strip()

def run():
    os.makedirs(OUT,exist_ok=True)
    seen=set(); catalog={}; saved=0
    for kw in KEYS:
        d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=ordin&type=JSON&display=100&query={urllib.parse.quote(kw)}")
        rules=L((d or {}).get('OrdinSearch',{}).get('law'))
        n=0
        for r in rules:
            if n>=CAP_KW: break
            mst=r.get('자치법규일련번호'); nm=r.get('자치법규명','')
            if not mst or mst in seen: continue
            seen.add(mst)
            body=fetch(mst)
            if not body: continue
            reg=region(r.get('지자체기관명') or nm)
            rdir=os.path.join(OUT,safe(reg)); os.makedirs(rdir,exist_ok=True)
            with open(os.path.join(rdir,safe(nm)+'.txt'),'w',encoding='utf-8') as f:
                f.write(f"[조례] {nm}\n지자체: {r.get('지자체기관명')} · 시행 {r.get('시행일자')} · 분야 {r.get('자치법규분야명')}\n\n{body}")
            catalog.setdefault(reg,[]).append({'명':nm,'ID':mst,'분야':r.get('자치법규분야명'),'키워드':kw})
            saved+=1; n+=1; time.sleep(0.2)
        print(f"  [{kw}] {n}건",flush=True)
    json.dump(catalog,open(os.path.join(OUT,'_ordin_catalog.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
    print(f"=== 조례 수집 완료: {saved}건 · {len(catalog)}개 지역 ===",flush=True)
if __name__=='__main__': run()
