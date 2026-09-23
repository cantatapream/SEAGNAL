#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint 검증(사후 확인): 전수 린트가 실제로 촘촘한지 3개 실질 지표로 측정.
[연계] 입력 wiki/statutes+concepts/**(md) · 출력 _dashboard/lint_verify.json (사람 보고용)
지표: ①진짜 dangling(미해결·편입예정 아님) ②우리법↔우리법 비대칭 [[위키링크]] ③평문 「우리법」 인용인데 [[링크]] 0건(조문별 누락)."""
import os,re,json,glob,collections
LEGAL=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
WIKI=f'{LEGAL}/wiki'

# 1) 우리 위키의 모든 페이지 파일명(=링크 타깃 후보) 수집
files=set()
for path in glob.glob(f'{WIKI}/**/*.md',recursive=True):
    files.add(os.path.basename(path)[:-3])
# 슬러그→법명, 법명→슬러그
build=json.load(open('/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad/build_data.json'))
laws=build['all']
slug2name={x['slug']:x['name'] for x in laws}
name2slug={x['name']:x['slug'] for x in laws}
# 법명 정규화(공백/괄호 제거)
def norm(s): return re.sub(r'\s+','',s)
normname2slug={norm(x['name']):x['slug'] for x in laws}
our_slugs=set(slug2name)

# 페이지별로 파싱
pages={}  # file -> {slug, txt, links, cited(평문「」)}
for path in glob.glob(f'{WIKI}/statutes/*.md')+glob.glob(f'{WIKI}/concepts/*.md'):
    fn=os.path.basename(path)[:-3]
    slug=fn.split('__')[0]
    txt=open(path,encoding='utf-8').read()
    links=re.findall(r'\[\[([^\]]+?)\]\]',txt)
    cited=set(norm(x) for x in re.findall(r'「([^」]+?)」',txt))
    pages[fn]={'slug':slug,'txt':txt,'links':links,'cited':cited}

# 링크 타깃 해석: [[X]] → 존재하는 파일? (comparisons/, statutes/, concepts/, annexes/, draft/, activities/ 접두 고려)
all_files=set()
for path in glob.glob(f'{WIKI}/**/*.md',recursive=True):
    rel=os.path.relpath(path,WIKI)[:-3]  # e.g. concepts/xxx or comparisons/yyy
    all_files.add(rel); all_files.add(os.path.basename(path)[:-3])
for path in glob.glob(f'{LEGAL}/draft/*.md')+glob.glob(f'{LEGAL}/activities/*.md'):
    all_files.add(os.path.basename(path)[:-3])

def resolve(link):
    """[[link]]가 실제 파일로 해석되면 True."""
    t=link.strip()
    # (편입예정)/(편입 예정) 꼬리표 붙은 링크는 제외 처리 대상
    t=re.sub(r'\(편입\s*예정\)','',t).strip()
    if not t: return True
    # 표 셀 내 이스케이프 파이프(\|) 정규화 후 별칭(|)·앵커 제거
    t=t.replace('\\|','|').split('|')[0].split('#')[0].strip()
    cands=[t, f'concepts/{t}', f'statutes/{t}', f'comparisons/{t}', f'annexes/{t}',
           t.replace('concept_',''), t.replace('statute_','')]
    for c in cands:
        if c in all_files or os.path.basename(c) in all_files: return True
    return False

# --- 지표 1: 진짜 dangling (편입예정 표기 없는 미해결 [[링크]]) ---
dangling=[]
for fn,p in pages.items():
    # 편입예정 표기된 링크는 의도된 미생성 → 제외
    marked=set(re.findall(r'\[\[([^\]]+?)\]\]\(편입\s*예정\)',p['txt']))
    marked|=set(re.findall(r'편입\s*예정[^\n]*?\[\[([^\]]+?)\]\]',p['txt']))
    for lk in set(p['links']):
        base=lk.replace('\\|','|').split('|')[0].strip()
        if base in marked: continue
        if '(편입' in lk: continue
        if base in ('링크','비교표','statutes/법명','statute.법명','대상','법명') or base.startswith('법명'): continue  # 설명용 리터럴/예시
        if not resolve(lk):
            dangling.append(f'{fn}: [[{lk}]]')

# --- 지표 2: 우리법↔우리법 비대칭 [[위키링크]] ---
# law별 전체 링크 대상 슬러그 집합
law_links=collections.defaultdict(set)   # srcslug -> set(dstslug)
for fn,p in pages.items():
    src=p['slug']
    for lk in p['links']:
        base=lk.replace('\\|','|').split('|')[0].split('(')[0].strip()
        base=re.sub(r'^(concepts/|statutes/|comparisons/|concept_|statute_)','',base)
        dst=base.split('__')[0]
        if dst in our_slugs and dst!=src:
            law_links[src].add(dst)
asym=[]
for a in our_slugs:
    for b in law_links.get(a,()):
        if a not in law_links.get(b,()):
            asym.append((slug2name.get(a,a),slug2name.get(b,b)))

# --- 지표 3: 평문 「우리법」 인용인데 그 법으로의 [[링크]]가 페이지에 0건 (조문별 누락 후보) ---
textonly=collections.Counter()
textonly_ex=collections.defaultdict(list)
for fn,p in pages.items():
    src=p['slug']
    linked_slugs=law_links.get('__page__'+fn,set())
    # 이 페이지가 링크한 슬러그
    page_link_slugs=set()
    for lk in p['links']:
        base=re.sub(r'^(concepts/|statutes/|comparisons/|concept_|statute_)','',lk.replace('\\|','|').split('|')[0].split('(')[0].strip())
        page_link_slugs.add(base.split('__')[0])
    for cn in p['cited']:
        dst=normname2slug.get(cn)
        if dst and dst in our_slugs and dst!=src and dst not in page_link_slugs:
            textonly[slug2name[dst]]+=1
            if len(textonly_ex[slug2name[dst]])<2:
                textonly_ex[slug2name[dst]].append(fn)

out={
 'pages':len(pages),
 'dangling_count':len(dangling),
 'dangling_examples':dangling[:40],
 'asym_pairs_count':len(asym),
 'asym_examples':[f'{a} → {b} (역링크 없음)' for a,b in asym[:40]],
 'textonly_law_mentions_missing_link_total':sum(textonly.values()),
 'textonly_top':[{'law':k,'pages_mentioning_without_link':v,'eg':textonly_ex[k]} for k,v in textonly.most_common(25)],
}
json.dump(out,open(f'{LEGAL}/_dashboard/lint_verify.json','w'),ensure_ascii=False,indent=1)
print('페이지수',out['pages'])
print('① 진짜 dangling(편입예정 아님):',out['dangling_count'])
print('② 우리법↔우리법 비대칭 [[위키링크]] 쌍:',out['asym_pairs_count'])
print('③ 평문「우리법」인용인데 링크 0건(페이지·법 누적):',out['textonly_law_mentions_missing_link_total'])
print('  상위:',[(x['law'],x['pages_mentioning_without_link']) for x in out['textonly_top'][:10]])
