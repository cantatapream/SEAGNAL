#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""별표 충돌 버그 수정: 법률/시행령/시행규칙 별표를 층별 접두어로 재수집.
   기존 별표/서식 파일(접두어 없음)은 삭제 후 {kind}_{typ}{num}.txt 로 재저장.
   JSON 본문은 추출 후 보관하지 않음(디스크 절약)."""
import json,urllib.request,time,os,re,glob
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

OC='hyoo1431'
ROOT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '../../raw')

def api(url):
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    # ★2026-09-23 (3-46) — 4회로는 모자랐다. 같은 MST 가 한 번은 실패하고 다음 실행에서 성공했다.
    #   law.go.kr 은 **막힌 게 아니라 간헐적**이다(L-322 실측: 단발 4/8, 재시도를 붙이면 9/10).
    #   4회에서 25회로 늘린다 — 되는 것을 "안 된다"고 적는 것이 제일 나쁘다.
    for _i in range(25):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
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
        time.sleep(min(1.5 + 0.4 * _i, 6.0))
    return None

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

def flat(x):
    if isinstance(x,list): return '\n'.join(flat(i) for i in x)
    return str(x)

def extract_layer(body,kind,outdir,links,only=None,overwrite=True,links_all=False):
    """kind = 법률|시행령|시행규칙. 층별 접두어로 별표 저장. links 딕셔너리에 병합.

    ★2026-09-23 (3-46) — **골라 채우기**를 위해 두 개를 더 받는다. 기본값은 예전 그대로다.
      only      : 쓸 파일이름 집합. 주면 **그 안에 있는 것만** 쓴다(빈자리만 메울 때).
      overwrite : False 면 **이미 있는 파일은 건드리지 않는다.**
      links_all : True 면 **파일을 안 써도 링크는 다 적는다**(3-21 · PDF 링크만 채울 때).
                  ⚠기본값은 False 라 종전 동작 그대로다 — 쓴 것만 링크에 남는다.
    이렇게 하는 까닭은 **별표를 적는 꼴을 한 곳에만 두기 위해서**다(L-136).
    골라 채우는 도구가 같은 글꼴을 따로 베끼면, 언젠가 둘이 달라진다.
    """
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
        skip = (only is not None and fname not in only) or \
               (not overwrite and os.path.exists(os.path.join(outdir,fname)))
        if skip and not links_all: continue
        if not skip:
            with open(os.path.join(outdir,fname),'w',encoding='utf-8') as f:
                f.write(f"[{kind}] {typ}{numlabel} — {title}\n\n{txt}")
        hwp=b.get('별표서식파일링크',''); img=b.get('별표서식이미지파일링크','')
        # ★2026-09-23 (3-21 · P-17) — **PDF 링크를 여태 안 읽고 있었다.**
        #   등록부는 *"서식 다운로드가 HWP 일변도 — 2,754항목 중 PDF 24개"* 라고 적었는데,
        #   원인은 **원문 제공처가 PDF 를 안 주는 것이 아니라 우리가 그 칸을 안 읽은 것**이었다.
        #   응답에는 `별표서식PDF파일링크`·`별표PDF파일명` 이 나란히 들어 있다(실측: 골재채취법 시행령 별표1).
        #   3-20 의 부칙과 **똑같은 꼴**이다 — "구조적으로 못 얻는 것이 아니라 얻을 수 있는데 안 받은 것".
        pdf=b.get('별표서식PDF파일링크','')
        links[f"{kind} {typ} {numlabel}"]={"제목":title,
            "HWP":("https://www.law.go.kr"+hwp) if hwp else "",
            "PDF":("https://www.law.go.kr"+pdf) if pdf else "",
            "이미지":(["https://www.law.go.kr"+x for x in (img if isinstance(img,list) else [img])] if img else [])}
        if skip: continue          # 링크만 적고 파일은 안 썼다 — 쓴 개수에 안 센다
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
