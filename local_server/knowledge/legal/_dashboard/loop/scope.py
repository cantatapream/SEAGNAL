# -*- coding: utf-8 -*-
"""법 이름으로 law.go.kr 에 물어 **그 법의 계층·시행일·판번호를 훑어보는** 한 번짜리 탐침. (조사용)

★게이트가 아니다 — 수집 범위(scope)를 짤 때 손으로 돌려 보는 자다.
이름을 넣으면 현행 판을 찾아 계층(법률·시행령·시행규칙)이 무엇이 있는지 찍는다.
⚠2026-09-24 — 머리말이 없어 `loop_tool_census` 가 「무엇을 하는 자인지 모른다」로 세던 자다(G-15).
"""
import json,urllib.request,urllib.parse,time
OC='hyoo1431'
def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url,timeout=20) as r: return json.load(r)
        except: time.sleep(1)
    return None
def info(name):
    q=urllib.parse.quote(name)
    d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=eflaw&type=JSON&display=100&query={q}")
    if not d: return None
    laws=d.get('LawSearch',{}).get('law',[])
    if isinstance(laws,dict): laws=[laws]
    rec={'법률':None,'시행령':False,'시행규칙':False,'소관':''}
    for l in laws:
        if l.get('현행연혁코드')!='현행': continue
        nm=l.get('법령명한글','')
        if nm==name: rec['법률']=l['법령일련번호']; rec['소관']=l.get('소관부처명','')
        elif nm==name+' 시행령': rec['시행령']=True
        elif nm==name+' 시행규칙': rec['시행규칙']=True
    return rec

seed = {
 '01_안전조업':['어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률','낚시 관리 및 육성법','연안사고 예방에 관한 법률','수상에서의 수색ㆍ구조 등에 관한 법률'],
 '02_면허허가':['수산업법','수산업협동조합법','어촌ㆍ어항법'],
 '03_자원관리':['수산자원관리법','양식산업발전법','내수면어업법'],
 '04_선박검사등록':['어선법','선박안전법','선박직원법','선박법'],
 '05_선원인력':['선원법','어선원 및 어선 재해보상보험법'],
 '06_해양환경':['해양환경관리법','해양폐기물 및 해양오염퇴적물 관리법','수산부산물 재활용 촉진에 관한 법률','물환경보전법','폐기물관리법'],
 '07_어촌어항시설':['항만법'],
 '08_수상수중레저':['수상레저안전법','수중레저활동의 안전 및 활성화 등에 관한 법률','마리나항만의 조성 및 관리 등에 관한 법률'],
 '09_해경단속':['해양경비법'],
 '10_해양경계출입국':['영해 및 접속수역법','배타적 경제수역 및 대륙붕에 관한 법률','출입국관리법'],
}
tot=law=leg=rule=0
for dom,names in seed.items():
    print(f"── {dom} ──")
    for n in names:
        r=info(n); tot+=1
        if not r or not r['법률']:
            print(f"   ? {n[:28]} (현행 법률 매칭 실패)"); continue
        law+=1; leg+=r['시행령']; rule+=r['시행규칙']
        fam=('법'+('+령' if r['시행령'] else '')+('+규' if r['시행규칙'] else ''))
        print(f"   ✓ {n[:26]:26} [{fam}] 소관:{r['소관'][:8]}")
        time.sleep(0.2)
print()
print(f"seed 후보 {tot}개 중 현행 확인 {law}개 · 시행령 {leg} · 시행규칙 {rule}")
print(f"수집 문서 수(법+령+규) ≈ {law+leg+rule}개 (+ 별표 다수)")
