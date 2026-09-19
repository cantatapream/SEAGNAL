#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint 1단계: 완성된 위키 전체를 알고리즘으로 색인 → 교집합·링크갭·테마맵 산출."""
import os,re,json,glob,collections

# 경로를 박아두면 다른 컴퓨터에서 못 돈다 — 깃허브 CI 는 /home/runner/work/… 에서 돈다(2026-09-18).
#   이 파일 위치(…/legal/_dashboard/loop/)에서 세 단계 올라가면 legal 폴더다.
LEGAL=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WIKI=f'{LEGAL}/wiki'
DASH=f'{LEGAL}/_dashboard'

def load_names():
    d=json.load(open(f'{os.path.dirname(__file__)}/build_data.json'))
    return {x['slug']:x['name'] for x in d['all']}
SLUG2NAME=load_names()

# ── 파일명이 `법__주제` 꼴이 아닌 개념 페이지의 소속 법 찾기 (2026-08-21) ─────────────
# 왜: 아래 `law` 는 파일명 앞부분(slug)으로 법 이름을 찾고, **못 찾으면 slug 를 그대로 법 이름으로
#   쓴다.** 그런데 고시 이름을 그대로 파일명으로 쓴 개념 페이지가 있다(`강선의구조기준.md` 등).
#   그러면 그 페이지의 법이 "강선의구조기준" 이 되고, 챗봇이 조문 원문을 열 때 그 이름으로 raw 폴더를
#   찾다 실패한다 — 고시는 독립 폴더가 없고 **모법 폴더 아래**에 있기 때문이다
#   (`선박안전법/행정규칙/강선의구조기준.txt`). 그 결과 사용자가 본문 조문 링크를 눌러도 아무것도
#   안 열린다(2026-08-21 `link_ready.js` 로 발견, 개념 페이지 12장·근거 줄 약 159개).
# 어떻게: 페이지 머리말에 이미 적혀 있는 `상위기준법`, 없으면 `id: concept.<법>_<주제>` 에서 가져온다.
#   **지어내지 않는다** — 둘 다 없거나 아는 법이 아니면 예전처럼 slug 를 그대로 쓴다.
# ⚠비교(comparisons)·활동(activities) 페이지는 손대지 않는다. 여러 법을 견주는 자리라 소속 법이
#   하나일 수 없고, 코드도 그 전제로 쓰여 있다(client buildCiteIndex 주석 참고).
KNOWN_LAWS={re.sub(r'\s+','',v) for v in SLUG2NAME.values()}
for _d in (os.listdir(f'{LEGAL}/raw') if os.path.isdir(f'{LEGAL}/raw') else []):
    _p=f'{LEGAL}/raw/{_d}'
    if os.path.isdir(_p):
        for _l in os.listdir(_p):
            if os.path.isdir(f'{_p}/{_l}'): KNOWN_LAWS.add(re.sub(r'\s+','',_l))

def owner_law(txt):
    """머리말에서 이 페이지가 딸린 법을 찾는다. 못 찾으면 ''."""
    for pat in (r'^상위기준법:\s*(.+)$', r'^id:\s*\w+\.(.+?)_'):
        m=re.search(pat,txt,re.M)
        if m:
            v=m.group(1).strip().strip('"\'')
            if re.sub(r'\s+','',v) in KNOWN_LAWS: return v
    return ''

# 테마 키워드(의미 기반 1차 후보) — 최종 병합은 에이전트가
THEMES={
 '안전장구_구명설비':['구명조끼','구명동의','인명안전','구명부환','구명뗏목','구명벌','안전장비','인명구조','자기점화등','구명줄'],
 '폐기물_해양오염':['폐기물','해양오염','오염물질','배출','투기','부산물','기름','유해액체','분뇨'],
 '야간운항_장비':['야간','일몰','일출','항해등','조도','등화'],
 '음주운항_측정거부':['음주','혈중알코올','주취','측정'],
 '출항통제_기상특보':['출항통제','기상특보','풍랑','출항제한','조업제한','통항금지'],
 '검사_등록':['검사','등록','검정','정기검사','중간검사','선박검사','어선검사','안전검사'],
 '신고_허가_면허':['신고','허가','면허','인가','등록증','승인'],
}

pages=[]
# ⚠`glob.glob()` 은 폴더를 읽은 순서를 그대로 준다 — 그 순서는 **컴퓨터마다 다르다.**
#   정렬하지 않으면 같은 위키로 만든 index.json 이 여기서와 깃허브 러너에서 서로 다른 차례로
#   나오고, 내용이 똑같은데도 77,122 줄이 바뀐 것으로 보인다(2026-09-18 CI 첫 실행에서 실측).
#   그러면 자동 재생성과 사람 작업이 서로의 순서를 계속 되돌리며 싸운다. 갈래마다 정렬해 고정한다.
for path in (sorted(glob.glob(f'{WIKI}/statutes/*.md'))+sorted(glob.glob(f'{WIKI}/concepts/*.md'))
             +sorted(glob.glob(f'{WIKI}/comparisons/*.md'))+sorted(glob.glob(f'{WIKI}/annexes/*.md'))
             +sorted(glob.glob(f'{WIKI}/activities/*.md'))):
    fn=os.path.basename(path)[:-3]
    kind=('statute' if '/statutes/' in path else 'comparison' if '/comparisons/' in path
          else 'annex' if '/annexes/' in path else 'activity' if '/activities/' in path else 'concept')
    slug=fn.split('__')[0]
    topic=fn.split('__')[1] if '__' in fn else ''
    txt=open(path,encoding='utf-8').read()
    cited=sorted(set(re.findall(r'「([^」]+?)」',txt)))
    links=sorted(set(re.findall(r'\[\[([^\]]+?)\]\]',txt)))
    byls=sorted(set(re.findall(r'별표\s*\d+(?:의\d+)?',txt)))
    # 처벌 신호
    pen=bool(re.search(r'징역|벌금|과태료|영업정지|면허취소|자격정지',txt))
    themes=[t for t,ks in THEMES.items() if any(k in txt for k in ks)]
    # status(승급상태): 챗봇 답변엔진 canonical 필터용. frontmatter 없으면 보수적으로 draft.
    sm=re.search(r'^status:\s*(\S+)',txt,re.M)
    status=sm.group(1).strip() if sm else 'draft'
    law=SLUG2NAME.get(slug,'')
    if not law and kind in ('concept','annex'):
        # 파일명으로 법을 못 찾은 개념·별표 페이지 — 머리말에 적힌 소속 법을 쓴다(위 owner_law 주석).
        law=owner_law(txt)
        # 법 이름을 옮기면 그 페이지가 **자기 이름으로 안 잡힌다**(scoreOne 은 topic||law 를 제목으로
        # 보고 +3 을 준다). 파일명을 주제로 넣어 신원을 보존한다 — 다른 개념 페이지의 `법__주제` 와 같은 꼴.
        if law and not topic: topic=fn
    if not law: law=slug
    pages.append({'file':fn,'kind':kind,'slug':slug,'law':law,
                  'topic':topic,'status':status,'cited':cited,'links':links,'byls':byls,'penalty':pen,'themes':themes})

# 1) 테마 → 페이지 (2법 이상 걸린 테마만 허브 대상)
theme_pages=collections.defaultdict(list)
for p in pages:
    for t in p['themes']: theme_pages[t].append(p['file'])
theme_laws={t:sorted(set(SLUG2NAME.get(f.split('__')[0],f.split('__')[0]) for f in fs)) for t,fs in theme_pages.items()}

# 2) 공통 인용 타법(여러 법이 함께 의존) → 허브 노드 후보
cited_by=collections.defaultdict(set)
for p in pages:
    for c in p['cited']:
        c2=re.sub(r'\s+','',c)
        cited_by[c2].add(p['law'])
common_cited={c:sorted(v) for c,v in cited_by.items() if len(v)>=3}

# 3) 링크 갭(비대칭): 페이지 파일명 기준 [[link]] 대상이 존재하나 역링크 없음 — 링크 표기가 자유라 근사
allfiles=set(p['file'] for p in pages)
linkgap=[]
linkmap={p['file']:set(re.sub(r'\s+','',l) for l in p['links']) for p in pages}
norm={re.sub(r'\s+','',f):f for f in allfiles}
for p in pages:
    for l in p['links']:
        ln=re.sub(r'\s+','',l)
        if ln in norm:
            tgt=norm[ln]
            # 역링크 있나
            back=any(re.sub(r'\s+','',x)==re.sub(r'\s+','',p['file']) for x in linkmap.get(tgt,[]))
            if not back: linkgap.append({'from':p['file'],'to':tgt})

os.makedirs(DASH,exist_ok=True)
out={'page_count':len(pages),
     'theme_laws':{t:theme_laws[t] for t in THEMES if t in theme_laws},
     'theme_page_count':{t:len(theme_pages[t]) for t in THEMES if t in theme_pages},
     'common_cited_laws':common_cited,
     'asym_link_gaps':linkgap[:200]}
json.dump({'pages':pages},open(f'{DASH}/index.json','w'),ensure_ascii=False,indent=1)
json.dump(out,open(f'{DASH}/lint_report.json','w'),ensure_ascii=False,indent=1)

print('페이지',len(pages),'· 테마(2법+):')
for t in THEMES:
    if t in theme_laws and len(theme_laws[t])>=2:
        print(f"  {t}: {len(theme_laws[t])}법 ({len(theme_pages[t])}페이지)")
print('공통 인용 타법(3법+):',len(common_cited))
for c,v in sorted(common_cited.items(),key=lambda x:-len(x[1]))[:12]:
    print(f"  「{c}」← {len(v)}법")
print('비대칭 링크갭:',len(linkgap))
