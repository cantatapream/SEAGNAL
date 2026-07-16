#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""별표 충돌 버그 수정: 법률/시행령/시행규칙 별표를 층별 접두어로 재수집.
   기존 별표/서식 파일(접두어 없음)은 삭제 후 {kind}_{typ}{num}.txt 로 재저장.
   JSON 본문은 추출 후 보관하지 않음(디스크 절약)."""
import json,urllib.request,time,os,re,glob

OC='hyoo1431'
ROOT='/home/user/SEAGNAL/local_server/knowledge/legal/raw'

def api(url):
    for _ in range(4):
        try:
            with urllib.request.urlopen(url,timeout=40) as r: return json.load(r)
        except Exception: time.sleep(1.5)
    return None

def fetch_body(mst):
    return api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON&MST={mst}")

def flat(x):
    if isinstance(x,list): return '\n'.join(flat(i) for i in x)
    return str(x)

def extract_layer(body,kind,outdir,links):
    """kind = 법률|시행령|시행규칙. 층별 접두어로 별표 저장. links 딕셔너리에 병합."""
    try: byl=body['법령']['별표']['별표단위']
    except (KeyError,TypeError): return 0
    if isinstance(byl,dict): byl=[byl]
    os.makedirs(outdir,exist_ok=True)
    n=0
    for b in byl:
        typ=b.get('별표구분','별표'); num=(b.get('별표번호','') or '').lstrip('0') or '0'
        sub=(b.get('별표가지번호','') or '').lstrip('0')
        numlabel=num+('의'+sub if sub else '')
        title=b.get('별표제목','') or ''
        txt=flat(b.get('별표내용','')); txt=re.sub(r'<[^>]+>',' ',txt); txt=re.sub(r'&[a-z]+;',' ',txt)
        fname=f"{kind}_{typ}{numlabel}.txt"
        with open(os.path.join(outdir,fname),'w',encoding='utf-8') as f:
            f.write(f"[{kind}] {typ}{numlabel} — {title}\n\n{txt}")
        hwp=b.get('별표서식파일링크',''); img=b.get('별표서식이미지파일링크','')
        links[f"{kind} {typ} {numlabel}"]={"제목":title,
            "HWP":("https://www.law.go.kr"+hwp) if hwp else "",
            "이미지":(["https://www.law.go.kr"+x for x in (img if isinstance(img,list) else [img])] if img else [])}
        n+=1
    return n

def run():
    metas=sorted(glob.glob(os.path.join(ROOT,'*','*','_meta.json')))
    print(f"대상 법 계열: {len(metas)}개",flush=True)
    fixed=err=byl_tot=0
    errlist=[]
    for mp in metas:
        base=os.path.dirname(mp)
        meta=json.load(open(mp,encoding='utf-8'))
        fams=meta.get('families',{})
        bdir=os.path.join(base,'별표')
        # 1) 기존 접두어 없는 별표/서식 파일 삭제 (재수집 전 청소)
        if os.path.isdir(bdir):
            for fn in os.listdir(bdir):
                if fn=='_links.json': continue
                # 이미 층접두어(법률_/시행령_/시행규칙_) 붙은 건 skip, 나머지(구파일) 삭제
                if not re.match(r'^(법률|시행령|시행규칙)_',fn):
                    try: os.remove(os.path.join(bdir,fn))
                    except OSError: pass
        links={}; cnt=0; layer_ok=True
        for kind in ('법률','시행령','시행규칙'):
            if kind not in fams: continue
            mst=fams[kind].get('MST')
            if not mst: continue
            body=fetch_body(mst)
            if not body:
                layer_ok=False; continue
            cnt+=extract_layer(body,kind,bdir,links)
            time.sleep(0.25)
        if links:
            json.dump(links,open(os.path.join(bdir,'_links.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        # meta 별표수 갱신
        meta['별표수']=cnt; meta['별표재수집']='2026-07-14(층별네임스페이스)'
        json.dump(meta,open(mp,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        byl_tot+=cnt
        if layer_ok: fixed+=1
        else: err+=1; errlist.append(meta.get('법령명',base))
        print(f"✓ {meta.get('법령명','?')[:24]} 별표{cnt}"+("" if layer_ok else " ⚠일부실패"),flush=True)
    print(f"\n=== 재수집 완료: {fixed}개 OK · {err}개 일부실패 · 별표총 {byl_tot} ===",flush=True)
    if errlist: print("일부실패:",', '.join(errlist),flush=True)

if __name__=='__main__': run()
