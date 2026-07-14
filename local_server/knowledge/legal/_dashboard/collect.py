#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json,urllib.request,urllib.parse,time,os,re,sys
sys.path.insert(0,os.path.dirname(__file__))
from master_laws import MASTER

OC='hyoo1431'
ROOT='/home/user/SEAGNAL/local_server/knowledge/legal/raw'
REPORT='/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/collection_report.md'
os.makedirs(os.path.dirname(REPORT),exist_ok=True)

def api(url):
    for _ in range(4):
        try:
            with urllib.request.urlopen(url,timeout=30) as r: return json.load(r)
        except Exception: time.sleep(1.5)
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
    return api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON&MST={mst}")

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
