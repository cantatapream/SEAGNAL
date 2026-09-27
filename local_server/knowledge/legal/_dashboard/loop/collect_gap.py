#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
"""추가 수집: (A) 기준법 시행령/시행규칙 미수집분 전수조사·수집  (B) 타법 원문 표적 수집.
   포맷은 recollect_jomun.build_text와 동일(.txt). 기존 파일은 덮지 않음(A는 없을 때만 채움).
   타법은 raw/15_관련타부처/<법명>/ 에 저장. 순수 API/IO — 토큰 안 씀."""
import json,urllib.request,urllib.parse,time,os,re,glob,sys
sys.path.insert(0,os.path.dirname(__file__))
from master_laws import MASTER
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

OC='hyoo1431'
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../raw')
LOG=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../collect_gap_report.md')

def api(url):
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    for _ in range(4):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
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
def L(x):
    if x is None: return []
    return x if isinstance(x,list) else [x]
def sfn(n): return re.sub(r'[\/:*?"<>|]','',n).replace(' ','')
def S(x):
    if x is None: return ''
    if isinstance(x,list): return '\n'.join(S(i) for i in x)
    return str(x)
def strip_title(no,ga,content):
    if not content: return ''
    pat=r'^제'+re.escape(str(int(no)))+r'조'
    if ga and str(ga).strip('0'): pat+=r'의'+re.escape(str(int(ga)))
    pat+=r'(\([^)]*\))?\s*'
    return re.sub(pat,'',content,count=1).strip()
def build_text(body):
    try: jos=L(body['법령']['조문']['조문단위'])
    except (KeyError,TypeError): return None
    out=[]
    for a in jos:
        if a.get('조문여부')!='조문':
            t=S(a.get('조문내용')).strip()
            if t: out.append(t)
            continue
        no=S(a.get('조문번호')); ga=S(a.get('조문가지번호'))
        label='제%s조'%no + ('의%s'%str(int(ga)) if ga and ga.strip('0') else '')
        title=S(a.get('조문제목')); siheng=S(a.get('조문시행일자')); typ=S(a.get('조문제개정유형'))
        head=f"[{label}] {title}".rstrip()
        meta=' · '.join([x for x in [('시행 '+siheng) if siheng else '', typ] if x])
        if meta: head+=f" ({meta})"
        out.append('\n'+head)
        chap=strip_title(no,ga,S(a.get('조문내용')))
        if chap: out.append(chap)
        for h in L(a.get('항')):
            hn=S(h.get('항번호')).strip(); hc=S(h.get('항내용')).strip()
            if hc: out.append(hc if hn and hc.startswith(hn) else ((hn+' ' if hn else '')+hc))
            for x in L(h.get('호')):
                xc=S(x.get('호내용')).strip()
                if xc: out.append('   '+xc)
                for m in L(x.get('목')):
                    mc=S(m.get('목내용')).strip()
                    if mc: out.append('      '+mc)
    return '\n'.join(out).strip()+'\n'
def extract_byl(body,outdir):
    try: byl=L(body['법령']['별표']['별표단위'])
    except (KeyError,TypeError): return 0
    if not byl: return 0
    os.makedirs(outdir,exist_ok=True); n=0
    for b in byl:
        typ=b.get('별표구분','별표'); num=(S(b.get('별표번호','')) or '').lstrip('0') or '0'
        title=S(b.get('별표제목','')); txt=S(b.get('별표내용',''))
        txt=re.sub(r'<[^>]+>',' ',txt); txt=re.sub(r'&[a-z]+;',' ',txt)
        with open(os.path.join(outdir,f"{typ}{num}.txt"),'w',encoding='utf-8') as f: f.write(f"{title}\n\n{txt}")
        n+=1
    return n
def _search_current(fullname):
    """이름 정확히 일치 + 현행인 1건 반환. 개정 많은 법은 연혁이 display를 채워 하위법령이 밀려나므로
       하위법령(시행령/시행규칙)은 전체이름으로 따로 조회한다."""
    q=urllib.parse.quote(fullname)
    d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=eflaw&type=JSON&display=100&query={q}")
    if not d: return None
    for l in L(d.get('LawSearch',{}).get('law',[])):
        if l.get('법령명한글')==fullname and l.get('현행연혁코드')=='현행':
            return l
    return None
def find_mst(name):
    rec={'법률':None,'시행령':None,'시행규칙':None,'소관':'','시행일':''}
    l=_search_current(name)
    if l: rec['법률']=l['법령일련번호']; rec['소관']=l.get('소관부처명',''); rec['시행일']=l.get('시행일자','')
    lo=_search_current(name+' 시행령')
    if lo: rec['시행령']=lo['법령일련번호']
    lr=_search_current(name+' 시행규칙')
    if lr: rec['시행규칙']=lr['법령일련번호']
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

LOGLINES=[]
def log(m):
    print(m,flush=True); LOGLINES.append(m)

def partA():
    log("## Part A — 기준법 시행령/시행규칙 전수조사·수집\n")
    metas=sorted(glob.glob(os.path.join(ROOT,'*','*','_meta.json')))
    filled=[]; confirmed_none=0; checked=0
    for mp in metas:
        base=os.path.dirname(mp)
        try: meta=json.load(open(mp,encoding='utf-8'))
        except Exception: continue
        name=meta.get('법령명') or os.path.basename(base)
        # 타법 폴더(15_관련타부처)는 A 대상 아님
        if '15_관련타부처' in base: continue
        fams=meta.setdefault('families',{})
        checked+=1
        need=[]
        for kind,fn in [('시행령','시행령.txt'),('시행규칙','시행규칙.txt')]:
            p=os.path.join(base,fn)
            if (not os.path.exists(p)) or os.path.getsize(p)<80:
                need.append((kind,fn))
        if not need: continue
        r=find_mst(name)
        for kind,fn in need:
            mst=r.get(kind)
            if not mst:
                confirmed_none+=1
                continue  # DB에도 없음 = 이 법은 그 하위법령이 없음(정상)
            body=fetch_body(mst)
            if not body: log(f"  ⚠ {name} {kind} fetch 실패"); continue
            txt=build_text(body)
            if not txt: log(f"  ⚠ {name} {kind} 본문 없음"); continue
            with open(os.path.join(base,fn),'w',encoding='utf-8') as f: f.write(txt)
            c=extract_byl(body,os.path.join(base,'별표'))
            fams[kind]={'MST':mst,'파일':fn.replace('.txt','.json')}
            meta['families']=fams; meta['추가수집']='2026-07-16(gap)'
            json.dump(meta,open(mp,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
            filled.append(f"{name}/{kind}(별표{c})")
            log(f"  ✓ 채움: {name} — {kind} (별표 {c})")
            time.sleep(0.3)
    log(f"\nPart A 결과: 확인 {checked}법 · **신규 채움 {len(filled)}건** · DB에도없음(정상) {confirmed_none}건")
    if filled: log("채운 목록: "+', '.join(filled))
    return filled

# 타법 후보(감사 인용 「」에서 기준법·기준법고시·노이즈 제외한 별도 법률)
TABEOP=[
 '어장관리법','상법','형법','산업안전보건법','질서위반행위규제법','하천법','통합방위법',
 '위험물 선박운송 및 저장규칙','해양이용영향평가법','소상공인기본법','유실물법',
 '의사상자 등 예우 및 지원에 관한 법률','장사 등에 관한 법률','전원개발촉진법','골재채취법',
 '관세법','산지관리법','공유재산 및 물품 관리법','공익사업을 위한 토지 등의 취득 및 보상에 관한 법률',
 '공간정보의 구축 및 관리 등에 관한 법률','공공기관의 운영에 관한 법률','국가기술자격법',
 '군사기지 및 군사시설 보호법','농어업경영체 육성 및 지원에 관한 법률','비료관리법','사료관리법',
 '소금산업 진흥법','수산식품산업의 육성 및 지원에 관한 법률','화학물질관리법',
 '지방행정제재ㆍ부과금의 징수 등에 관한 법률','비상사태등에 대비하기 위한 해운 및 항만 기능 유지에 관한 법률',
 '특정연구기관 육성법','선박소유자 등의 책임제한절차에 관한 법률','해양재난구조대의 설치 및 운영에 관한 법률',
 '자동차손해배상 보장법','해양생물다양성의 보전 및 이용에 관한 법률',
 '선박에서의 오염방지에 관한 규칙','선박톤수의 측정에 관한 규칙',
]

def partB():
    log("\n## Part B — 타법 원문 표적 수집 (raw/15_관련타부처/)\n")
    dom=os.path.join(ROOT,'15_관련타부처')
    got=[]; added=[]; noresolve=[]
    for name in TABEOP:
        base=os.path.join(dom,sfn(name))
        r=find_mst(name)
        if not r['법률']:
            noresolve.append(name); log(f"  ? 미해결(현행 매칭 없음): {name}"); time.sleep(0.2); continue
        os.makedirs(base,exist_ok=True)
        fams={}; bcnt=0; new_files=[]
        for kind,fn in [('법률','법률.txt'),('시행령','시행령.txt'),('시행규칙','시행규칙.txt')]:
            mst=r.get(kind)
            if not mst: continue
            p=os.path.join(base,fn)
            if os.path.exists(p) and os.path.getsize(p)>=80:   # 이미 있으면 스킵(추가만)
                fams[kind]={'MST':mst,'파일':fn.replace('.txt','.json')}; continue
            body=fetch_body(mst)
            if not body: continue
            txt=build_text(body)
            if not txt: continue
            with open(p,'w',encoding='utf-8') as f: f.write(txt)
            c=extract_byl(body,os.path.join(base,'별표')); bcnt+=c
            fams[kind]={'MST':mst,'파일':fn.replace('.txt','.json')}; new_files.append(kind)
            time.sleep(0.25)
        meta={'법령명':name,'소관부처':r['소관'],'도메인':'15_관련타부처','시행일':r['시행일'],
              'families':fams,'별표수':bcnt,'수집일':'2026-07-16','분류':'타법(기준법 인용 대상, 위키는 뻗어나온 지점만)'}
        json.dump(meta,open(os.path.join(base,'_meta.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        if new_files:
            got.append(name); added.append(f"{name}[{'·'.join(new_files)}]")
            log(f"  ✓ {name} 추가: {'·'.join(new_files)} (별표+{bcnt}) 소관:{r['소관'][:10]}")
    log(f"\nPart B 결과: **파일 추가된 법 {len(got)}건** · 미해결 {len(noresolve)}건")
    if added: log("추가내역: "+', '.join(added))
    if got: log("수집: "+', '.join(got))
    if noresolve: log("미해결(협약/부령명 상이 등 별도 처리): "+', '.join(noresolve))
    return got,noresolve

if __name__=='__main__':
    import datetime
    log(f"# 추가수집 리포트 (시작 {datetime.datetime.utcnow().strftime('%H:%M')}UTC)\n")
    a=partA()
    g,nr=partB()
    log(f"\n=== 완료: Part A 채움 {len(a)} · Part B 수집 {len(g)} ===")
    os.makedirs(os.path.dirname(LOG),exist_ok=True)
    open(LOG,'w',encoding='utf-8').write('\n'.join(LOGLINES)+'\n')
    print("리포트 저장:",LOG,flush=True)
