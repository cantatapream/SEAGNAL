#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""조문 텍스트 재추출: 벌칙/과태료 등 '호 직속' 조문의 chapeau(형량 도입문) 누락 버그 수정.
   기존 추출기는 조문내용을 버려서 '다음 각 호의 ...에 처한다' 형량 문장이 사라졌음.
   → 조문내용을 항상 기록하도록 전체 재생성(법률/시행령/시행규칙). 별표는 이미 수정됨(건드리지 않음)."""
import json,urllib.request,time,os,re,glob
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

OC='hyoo1431'
ROOT='/home/user/SEAGNAL/local_server/knowledge/legal/raw'
KINDS=[('법률','법률.txt'),('시행령','시행령.txt'),('시행규칙','시행규칙.txt')]

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

def L(x):  # 리스트 정규화
    if x is None: return []
    return x if isinstance(x,list) else [x]

def s(x):  # 문자열 강제(리스트면 join)
    if x is None: return ''
    if isinstance(x,list): return '\n'.join(s(i) for i in x)
    return str(x)

def strip_title(jo_no,jo_ga,content):
    """조문내용 앞 '제N조(제목)'/'제N조의M(제목)' 프리픽스 제거 → chapeau만 남김."""
    if not content: return ''
    pat=r'^제'+re.escape(str(int(jo_no)))+r'조'
    if jo_ga and str(jo_ga).strip('0'): pat+=r'의'+re.escape(str(int(jo_ga)))
    pat+=r'(\([^)]*\))?\s*'
    return re.sub(pat,'',content,count=1).strip()

def article_lines(a, with_head=True):
    """조문단위 1개를 우리 raw 파일과 같은 꼴의 줄 목록으로 만든다.
    예: article_lines({'조문번호':'28','조문제목':'장례비',…}) → ['[제28조] 장례비 (시행 20260911 · 일부개정)', '① …']
    @param {dict} a  API 응답의 조문단위 하나
    @param {bool} with_head  `[제N조] 제목 (시행 … · …)` 머리줄을 넣을지
    @returns {list[str]}
    [연계] ← build_text(파일 전체) · detect_law_changes.changed_articles(카드에 실을 조문 본문).
           두 곳이 **같은 함수**를 써야 카드 본문과 raw 파일의 꼴이 어긋나지 않는다.
    """
    no=s(a.get('조문번호')); ga=s(a.get('조문가지번호'))
    out=[]
    if with_head:
        label='제%s조'%no + ('의%s'%str(int(ga)) if ga and ga.strip('0') else '')
        title=s(a.get('조문제목'))
        siheng=s(a.get('조문시행일자')); typ=s(a.get('조문제개정유형'))
        head=f"[{label}] {title}".rstrip()
        meta=' · '.join([x for x in [('시행 '+siheng) if siheng else '', typ] if x])
        if meta: head+=f" ({meta})"
        out.append(head)
    chap=strip_title(no,ga,s(a.get('조문내용')))
    if chap: out.append(chap)          # ★ 누락되던 chapeau(형량 도입문 등) 복구
    for h in L(a.get('항')):
        hn=s(h.get('항번호')).strip()
        hc=s(h.get('항내용')).strip()
        if hc: out.append(hc if hn and hc.startswith(hn) else ((hn+' ' if hn else '')+hc))
        for x in L(h.get('호')):
            xc=s(x.get('호내용')).strip()
            if xc: out.append('   '+xc)
            for m in L(x.get('목')):
                mc=s(m.get('목내용')).strip()
                if mc: out.append('      '+mc)
    # 항이 없고 호가 조 직속인 경우 위 루프의 빈 항(항번호 None)이 호를 담고 있음 → 이미 처리됨
    return out


def build_text(body):
    try: jos=L(body['법령']['조문']['조문단위'])
    except (KeyError,TypeError): return None
    out=[]
    for a in jos:
        if a.get('조문여부')!='조문':  # 편/장/절 표제
            t=s(a.get('조문내용')).strip()
            if t: out.append(t)
            continue
        lines=article_lines(a)
        out.append('\n'+lines[0])
        out.extend(lines[1:])
    return '\n'.join(out).strip()+'\n'

def run():
    metas=sorted(glob.glob(os.path.join(ROOT,'*','*','_meta.json')))
    print(f"대상 {len(metas)}개 계열",flush=True)
    ok=err=files=0; errs=[]
    for mp in metas:
        base=os.path.dirname(mp); meta=json.load(open(mp,encoding='utf-8'))
        fams=meta.get('families',{}); good=True
        for kind,fn in KINDS:
            if kind not in fams: continue
            mst=fams[kind].get('MST')
            if not mst: continue
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
            body=law_api_guard.fetch_law_body(api, OC, mst, lid=fams[kind].get('법령ID'))
            if not body: good=False; continue
            txt=build_text(body)
            if not txt: good=False; continue
            with open(os.path.join(base,fn),'w',encoding='utf-8') as f: f.write(txt)
            files+=1; time.sleep(0.25)
        meta['조문재추출']='2026-07-14(chapeau복구)'
        json.dump(meta,open(mp,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        if good: ok+=1
        else: err+=1; errs.append(meta.get('법령명',base))
        print(f"✓ {meta.get('법령명','?')[:24]}"+("" if good else " ⚠일부실패"),flush=True)
    print(f"\n=== 조문 재추출 완료: {ok} OK · {err} 일부실패 · 파일 {files}개 ===",flush=True)
    if errs: print("일부실패:",', '.join(errs),flush=True)

if __name__=='__main__': run()
