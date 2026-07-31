#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint 1단계: 완성된 위키 전체를 알고리즘으로 색인 → 교집합·링크갭·테마맵 산출."""
import os,re,json,glob,collections

LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
WIKI=f'{LEGAL}/wiki'
DASH=f'{LEGAL}/_dashboard'

def load_names():
    d=json.load(open(f'{os.path.dirname(__file__)}/build_data.json'))
    return {x['slug']:x['name'] for x in d['all']}
SLUG2NAME=load_names()

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
for path in glob.glob(f'{WIKI}/statutes/*.md')+glob.glob(f'{WIKI}/concepts/*.md')+glob.glob(f'{WIKI}/comparisons/*.md'):
    fn=os.path.basename(path)[:-3]
    kind='statute' if '/statutes/' in path else ('comparison' if '/comparisons/' in path else 'concept')
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
    pages.append({'file':fn,'kind':kind,'slug':slug,'law':SLUG2NAME.get(slug,slug),
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
