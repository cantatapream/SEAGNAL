#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""고시(행정규칙) 정밀 수집: lsDelegated(위임법령) API로 '그 법이 실제 위임한 고시만' 수집.
   키워드 추측 없음 — 위임 매핑(어느 조→어느 고시)까지 저장해 빌드에 활용."""
import json,urllib.request,time,os,re,glob

OC='hyoo1431'
ROOT='/home/user/SEAGNAL/local_server/knowledge/legal/raw'

def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url,timeout=30) as r: return json.load(r)
        except Exception: time.sleep(1.2)
    return None
def L(x): return x if isinstance(x,list) else ([] if x is None else [x])
def s(x):
    if x is None: return ''
    if isinstance(x,list): return '\n'.join(s(i) for i in x)
    return str(x)
def safe(n): return re.sub(r'[\/:*?"<>|]','',n).replace(' ','')[:60]

def delegated_admrul(mst):
    """이 MST(법 한 층)가 위임한 (고시제목, 고시일련번호, 위임조) 목록."""
    d=api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=lsDelegated&type=JSON&MST={mst}")
    out=[]
    try: units=L(d['lsDelegated']['법령']['위임조문정보'])
    except (KeyError,TypeError): return out
    for u in units:
        wi=u.get('위임정보'); jo=s((u.get('조정보') or {}).get('조문번호'))
        for w in L(wi):
            for a in L(w.get('위임행정규칙조문정보')):
                sid=s(a.get('위임행정규칙일련번호')); title=s(a.get('위임행정규칙제목'))
                if sid and sid!='0':
                    out.append({'id':sid,'title':title,'위임조':'제%s조'%jo if jo else '','조항호목':s(a.get('조항호목')),'근거문':s(a.get('라인텍스트'))[:120]})
    return out

def fetch_body(mst):
    d=api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={mst}")
    if not d: return None,{}
    b=d.get('AdmRulService',{})
    info=b.get('행정규칙기본정보',{})
    jo=s(b.get('조문내용'))
    byl=b.get('별표',{}); byltxt=''
    if byl:
        for un in L(byl.get('별표단위') if isinstance(byl,dict) else byl):
            byltxt+='\n[별표] '+s(un.get('별표제목'))+'\n'+re.sub(r'<[^>]+>',' ',s(un.get('별표내용')))
    body=(jo+('\n\n'+byltxt if byltxt.strip() else '')).strip()
    return body,info

def collect_for(meta_path):
    m=json.load(open(meta_path,encoding='utf-8'))
    base=os.path.dirname(meta_path); name=m['법령명']
    # 모든 층 MST에서 위임고시 수집·통합
    deleg={}
    for kind in ('법률','시행령','시행규칙'):
        f=m.get('families',{}).get(kind)
        if not f: continue
        for a in delegated_admrul(f['MST']):
            d=deleg.setdefault(a['id'],{'title':a['title'],'위임':[]})
            d['위임'].append({'층':kind,'위임조':a['위임조'],'조항호목':a['조항호목'],'근거문':a['근거문']})
        time.sleep(0.2)
    outdir=os.path.join(base,'행정규칙'); os.makedirs(outdir,exist_ok=True)
    if not deleg:
        return {'law':name,'delegated':0,'saved':0}
    # L-39(2026-07-28): 예전엔 여기서 기존 .txt를 전부 삭제하고 새로 받은 것만 남겼는데,
    # 재스캔이 못 찾은 기존 항목(수동 OCR/HWP 복원본 등)이 조용히 유실되는 회귀를 냈다.
    # 이제는 기존 catalog를 베이스로 새로 받은 항목만 병합(추가/갱신)하고, 삭제하지 않는다.
    catalog_path=os.path.join(outdir,'_admrul.json')
    try: catalog=json.load(open(catalog_path,encoding='utf-8'))
    except (FileNotFoundError,json.JSONDecodeError): catalog={}
    saved=0
    for sid,info in deleg.items():
        title=info['title'] or sid
        existing=catalog.get(title)
        if existing and existing.get('ID')==sid:
            existing['위임']=info['위임']  # 위임근거만 최신화, 본문은 그대로(재요청 불필요)
            continue
        body,binfo=fetch_body(sid)
        if not body: continue
        title=info['title'] or binfo.get('행정규칙명','') or sid
        fn=safe(title)+'.txt'
        hdr='위임근거: '+'; '.join(f"{w['층']} {w['위임조']}({w['조항호목']})" for w in info['위임'])
        # L-39 회귀 방지: 기존 파일이 있고 새로 받은 본문이 더 짧으면(이미지버튼 스텁 등) 덮어쓰지 않고 보류
        old_fn=os.path.join(outdir,fn)
        if os.path.exists(old_fn) and os.path.getsize(old_fn)>len(body.encode('utf-8'))*1.3:
            catalog[title]={'ID':existing['ID'] if existing else sid,'위임':info['위임']}
            continue
        with open(old_fn,'w',encoding='utf-8') as f:
            f.write(f"[고시/행정규칙] {title}\nID:{sid} · {hdr}\n\n{body}")
        catalog[title]={'ID':sid,'위임':info['위임']}
        saved+=1; time.sleep(0.25)
    json.dump(catalog,open(catalog_path,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
    return {'law':name,'delegated':len(deleg),'saved':saved}

if __name__=='__main__':
    import sys
    if sys.argv[1:]=='ALL'.split():
        metas=sorted(glob.glob(os.path.join(ROOT,'*','*','_meta.json')))
    else:
        metas=[os.path.join(ROOT,p,'_meta.json') for p in
               ['09_레저관광/낚시관리및육성법','04_선박해운/어선법','09_레저관광/수상레저안전법']]
    tot=0
    for mp in metas:
        if not os.path.exists(mp): print('없음:',mp); continue
        # 이미 수집된 법(행정규칙/_admrul.json 존재)은 건너뜀
        done_marker=os.path.join(os.path.dirname(mp),'행정규칙','_admrul.json')
        if os.path.exists(done_marker):
            print('skip(이미):',json.load(open(mp,encoding='utf-8')).get('법령명','')[:20],flush=True); continue
        try:
            r=collect_for(mp); tot+=r['saved']
            print(f"✓ {r['law'][:22]} 위임고시 {r['delegated']}개 → 저장 {r['saved']}",flush=True)
        except Exception as e:
            print(f"✗ 오류 {os.path.dirname(mp)}: {str(e)[:80]}",flush=True)
    print(f"=== 완료: 고시 총 {tot}개 저장 ===")
