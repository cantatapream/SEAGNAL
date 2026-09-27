# -*- coding: utf-8 -*-
"""`scope.py` 의 뒷판 — 같은 물음을 **여러 법에 이어서** 돌린다. (조사용)

★게이트가 아니다. `scope.py` 와 하는 일이 겹치지만 돌리는 범위가 다르다.
⚠**둘 다 남겨 둔다** — 지우면 무엇을 물어봤는지 자취가 사라진다. 다만 새로 쓸 일이 있으면
  둘을 합치는 것이 낫다(지금은 합치지 않는다 — 쓰는 사람이 없어 확인할 길이 없다).
⚠2026-09-24 — 머리말이 없어 `loop_tool_census` 가 「무엇을 하는 자인지 모른다」로 세던 자다(G-15).
"""
import json,urllib.request,urllib.parse,time
OC='hyoo1431'
def api(u):
    for _ in range(3):
        try:
            with urllib.request.urlopen(u,timeout=20) as r: return json.load(r)
        except: time.sleep(1)
    return None
def info(name):
    q=urllib.parse.quote(name)
    d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=eflaw&type=JSON&display=100&query={q}")
    if not d: return None
    laws=d.get('LawSearch',{}).get('law',[])
    if isinstance(laws,dict): laws=[laws]
    rec={'법률':None,'령':False,'규':False,'소관':''}
    for l in laws:
        if l.get('현행연혁코드')!='현행': continue
        nm=l.get('법령명한글','')
        if nm==name: rec['법률']=l['법령일련번호']; rec['소관']=l.get('소관부처명','')
        elif nm==name+' 시행령': rec['령']=True
        elif nm==name+' 시행규칙': rec['규']=True
    return rec
# 이미지에서 새로 추가되는 법(seed에 없던 것)
new=['배타적 경제수역에서의 외국인어업 등에 대한 주권적 권리의 행사에 관한 법률','해양과학조사법',
 '해양경찰법','해상교통안전법','선박교통관제에 관한 법률','선박의 입항 및 출항 등에 관한 법률',
 '해운법','항만운송사업법','유선 및 도선 사업법','수상레저기구의 등록 및 검사에 관한 법률',
 '해수욕장의 이용 및 관리에 관한 법률','해사안전기본법','도선법','해양사고의 조사 및 심판에 관한 법률']
ok=leg=rule=0
for n in new:
    r=info(n)
    if not r or not r['법률']:
        print(f"   ? {n[:34]} (매칭 실패)"); continue
    ok+=1; leg+=r['령']; rule+=r['규']
    fam='법'+('+령' if r['령'] else '')+('+규' if r['규'] else '')
    print(f"   ✓ {n[:32]:32} [{fam}] {r['소관'][:8]}")
    time.sleep(0.2)
print(f"\n새 법 {len(new)}개 중 확인 {ok} · 시행령 {leg} · 시행규칙 {rule}")
