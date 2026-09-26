#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import json,urllib.request,urllib.parse,time,os,re,sys
sys.path.insert(0,os.path.dirname(__file__))
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'loop'))  # 공용 판별기는 loop/ 에 있다
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)
from master_laws import MASTER

OC='hyoo1431'
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../raw')
REPORT=os.path.join(os.path.dirname(os.path.abspath(__file__)), './collection_report.md')
os.makedirs(os.path.dirname(REPORT),exist_ok=True)

def api(url):
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    for _ in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.lstrip()[:1] in '{[':
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None          # 재시도로 안 풀린다
        except Exception:
            pass
        time.sleep(1.5)
    return None

def safe(n): return re.sub(r'[\/:*?"<>|]','',n).replace(' ','')

def find_mst(name):
    """returns dict {법률,시행령,시행규칙,소관} of MSTs (현행, exact name)."""
    q=urllib.parse.quote(name)
    d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=eflaw&type=JSON&display=100&query={q}")
    rec={'법률':None,'시행령':None,'시행규칙':None,'소관':'','시행일':''}
    if not d: return rec
    laws=d.get('LawSearch',{}).get('law',[])
    if isinstance(laws,dict): laws=[laws]
    for l in laws:
        if l.get('현행연혁코드')!='현행': continue
        nm=l.get('법령명한글','')
        if nm==name: rec['법률']=l['법령일련번호']; rec['소관']=l.get('소관부처명',''); rec['시행일']=l.get('시행일자','')
        elif nm==name+' 시행령': rec['시행령']=l['법령일련번호']
        elif nm==name+' 시행규칙': rec['시행규칙']=l['법령일련번호']
    return rec

def fetch_body(mst):
    # ★`eflaw` 를 efYd 없이 부르던 자리다 (2026-09-21 수정).
    #   [무엇이 잘못이었나] `lawService.do?target=eflaw` 는 **efYd 가 없으면** HTTP **200** 과 함께
    #   *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다. api() 가 그것을 네트워크 오류처럼
    #   삼켰으므로 이 호출은 **조용히 아무것도 안 주고 있었다.**
    #   ⚠**권한 문제가 아니다.** 신청은 처음부터 다 돼 있었고, 맞는 efYd 를 주면 JSON 이 온다.
    #     나는 저 문구를 하루에 두 번 오진했다 — "호스트 불통"(L-294), "eflaw 미신청"(L-295).
    #   [왜 그냥 target=law 로 안 바꿨나] 한 MST 가 시행일 판을 둘 이상 가지면 `target=law&MST=`
    #   는 **옛 판이나 시행예정 판**을 준다 — 287955→20260701(현행은 20260828),
    #   288973→**20270101 시행예정**(현행은 20260825). 아직 시행도 안 된 법문을 현행인 양 저장한다.
    #   [그래서] 현행 시행일자를 조회해 `efYd` 로 못 박는 공용 함수를 쓴다.
    #   근거와 실측표는 law_api_guard.py 머리말 · fetch_law_body() 참조.
    return law_api_guard.fetch_law_body(api, OC, mst)

def extract_byl(body,outdir):
    """extract 별표 text + links; return count."""
    try: byl=body['법령']['별표']['별표단위']
    except (KeyError,TypeError): return 0,{}
    if isinstance(byl,dict): byl=[byl]
    os.makedirs(outdir,exist_ok=True)
    def flat(x):
        if isinstance(x,list): return '\n'.join(flat(i) for i in x)
        return str(x)
    links={}
    for b in byl:
        typ=b.get('별표구분','별표'); num=(b.get('별표번호','') or '').lstrip('0') or '0'
        title=b.get('별표제목','') or ''
        txt=flat(b.get('별표내용','')); txt=re.sub(r'<[^>]+>',' ',txt); txt=re.sub(r'&[a-z]+;',' ',txt)
        with open(os.path.join(outdir,f"{typ}{num}.txt"),'w',encoding='utf-8') as f: f.write(f"{title}\n\n{txt}")
        hwp=b.get('별표서식파일링크',''); img=b.get('별표서식이미지파일링크','')
        links[f"{typ} {num}"]={"제목":title,
            "HWP":("https://www.law.go.kr"+hwp) if hwp else "",
            "이미지":(["https://www.law.go.kr"+x for x in (img if isinstance(img,list) else [img])] if img else [])}
    json.dump(links,open(os.path.join(outdir,'_links.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    return len(byl),links

def tier_of(soban):
    if '해양수산부' in soban or '해양경찰청' in soban: return 1
    return 2

def run():
    rep=open(REPORT,'w',encoding='utf-8')
    rep.write("# 법률 수집 리포트\n\n| 도메인 | 법률 | 법 | 령 | 규 | 별표 | 소관 | tier |\n|---|---|---|---|---|---|---|---|\n")
    rep.flush()
    ok=fail=doc=byl_tot=0
    fails=[]
    for dom,names in MASTER.items():
        for name in names:
            r=find_mst(name)
            if not r['법률']:
                fail+=1; fails.append(name)
                rep.write(f"| {dom} | {name[:22]} | ❌매칭실패 | | | | | |\n"); rep.flush()
                print(f"❌ {name}",flush=True); time.sleep(0.3); continue
            base=os.path.join(ROOT,dom,safe(name)); os.makedirs(base,exist_ok=True)
            fam={}; bcount=0
            for kind,key in [('법률','법률'),('시행령','시행령'),('시행규칙','시행규칙')]:
                mst=r[key]
                if not mst: continue
                body=fetch_body(mst)
                if not body: continue
                fn='법률.json' if kind=='법률' else (kind+'.json')
                json.dump(body,open(os.path.join(base,fn),'w',encoding='utf-8'),ensure_ascii=False)
                doc+=1; fam[kind]={'MST':mst,'파일':fn}
                c,_=extract_byl(body,os.path.join(base,'별표'))
                bcount+=c; byl_tot+=c
                time.sleep(0.3)
            meta={'법령명':name,'소관부처':r['소관'],'tier':tier_of(r['소관']),'도메인':dom,
                  '시행일':r['시행일'],'families':fam,'별표수':bcount,'수집일':'2026-07-14'}
            json.dump(meta,open(os.path.join(base,'_meta.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
            ok+=1
            f='●'+('령' if '시행령' in fam else '')+('규' if '시행규칙' in fam else '')
            rep.write(f"| {dom} | {name[:22]} | ✓ | {'✓' if '시행령' in fam else '-'} | {'✓' if '시행규칙' in fam else '-'} | {bcount} | {r['소관'][:8]} | {tier_of(r['소관'])} |\n"); rep.flush()
            print(f"✓ {name} [{f}] 별표{bcount} 소관:{r['소관'][:8]}",flush=True)
    rep.write(f"\n**결과: 성공 {ok} · 실패 {fail} · 문서 {doc}개 · 별표 {byl_tot}개**\n")
    if fails: rep.write("\n실패 목록: "+', '.join(fails)+"\n")
    rep.close()
    print(f"\n=== 완료: 법 {ok}/{ok+fail} · 문서 {doc} · 별표 {byl_tot} ===",flush=True)

if __name__=='__main__': run()
