#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint 2단계(알고리즘 산출): 백본 지도·대시보드 인덱스·개념 그래프 생성."""
import os,re,json,glob,collections
# 경로를 박아두면 다른 컴퓨터에서 못 돈다 — 깃허브 CI 는 /home/runner/work/… 에서 돈다(2026-09-18).
#   이 파일 위치(…/legal/_dashboard/loop/)에서 세 단계 올라가면 legal 폴더다.
LEGAL=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WIKI=f'{LEGAL}/wiki'; DASH=f'{LEGAL}/_dashboard'
idx=json.load(open(f'{DASH}/index.json'))['pages']
rep=json.load(open(f'{DASH}/lint_report.json'))

# --- graph.json (노드=법/개념 페이지, 엣지=인용·링크) ---
nodes={}; edges=[]
for p in idx:
    nodes.setdefault(p['law'],{'id':p['law'],'type':'law','pages':0})['pages']+=1
for p in idx:
    for c in rep['common_cited_laws']:
        pass
for p in idx:
    src=p['law']
    for c in set(re.sub(r'\s+','',x) for x in p['cited']):
        # 인용 대상이 우리 법 노드면 엣지
        for lawname in list(nodes):
            if re.sub(r'\s+','',lawname)==c and lawname!=src:
                edges.append({'from':src,'to':lawname,'kind':'cite'}); break
# [[위키링크]]도 엣지로 편입(H-3: md 링크가 신경망의 실제 엣지). slug→법명으로 대상 법 해석.
slug2law={p['slug']:p['law'] for p in idx}
for p in idx:
    src=p['law']
    for lk in p.get('links',[]):
        base=lk.replace('\\|','|').split('|')[0].split('#')[0].split('(')[0].strip()
        base=re.sub(r'^(concepts/|statutes/|comparisons/|annexes/|concept_|statute_)','',base)
        tgt_slug=base.split('__')[0]
        tgt_law=slug2law.get(tgt_slug)
        if tgt_law and tgt_law!=src:
            edges.append({'from':src,'to':tgt_law,'kind':'link'})
# 중복 제거: 방향쌍(from,to) 단위로 유일화(cite·link 둘 다면 kind 병합) → 인접 과다계수 방지
bykey={}
for e in edges:
    k=(e['from'],e['to'])
    if k not in bykey: bykey[k]=set()
    bykey[k].add(e['kind'])
# ⚠정렬 필수: 위 `set(...)` 순회 순서가 프로세스마다 달라(PYTHONHASHSEED) 엣지 차례가 매번 바뀐다.
#   내용이 같은데도 graph.json 이 1,114줄씩 바뀐 것으로 보여 커밋 diff 를 못 믿게 된다(2026-09-18 실측).
ed2=[{'from':f,'to':t,'kind':'+'.join(sorted(ks))} for (f,t),ks in sorted(bykey.items())]
json.dump({'nodes':list(nodes.values()),'edges':ed2},open(f'{WIKI}/graph.json','w'),ensure_ascii=False,indent=1)

# --- _backbone.md: 여러 법이 공통 의존하는 허브 법 지도 ---
cc=rep['common_cited_laws']
lines=['# 위키 백본 — 공통 인용 타법 지도 (lint 자동생성)','',
 '> 여러 법이 **공통으로 인용**하는 법 = 정의·허브 노드. 이 법들을 고치면 인용하는 모든 법에 영향.','',
 '| 허브 법(피인용) | 이 법을 인용하는 법 수 | 인용하는 법(일부) |','|---|---|---|']
for c,v in sorted(cc.items(),key=lambda x:-len(x[1]))[:40]:
    lines.append(f"| 「{c}」 | {len(v)} | {', '.join(v[:6])}{' 외' if len(v)>6 else ''} |")
open(f'{WIKI}/_backbone.md','w',encoding='utf-8').write('\n'.join(lines)+'\n')

# --- build_index.md: 전체 statute/concept 인덱스 + 테마·링크갭 요약 ---
# ★종류별로 나눠 센다(2026-09-03). 종전에는 statute 가 아닌 것을 전부 'concepts' 로 몰아
#   담아 놓고 머리글에는 statute·concept 수만 찍어, **annex 198·comparison 49 가 어디에도
#   안 보였다**(총 페이지 1285 인데 74+963 만 적혀 있었다). 그 탓에 "annexes·comparisons 가
#   색인에 0건"이라는 오해가 여러 회차 이어졌다 — 실제로는 index.json 에 다 들어 있다.
KINDS=['statute','concept','annex','comparison','activity']
laws=collections.defaultdict(lambda:{'statute':None,'concept':[],'annex':[],'comparison':[],'activity':[]})
for p in idx:
    if p['kind']=='statute': laws[p['law']]['statute']=p['file']
    else: laws[p['law']].setdefault(p['kind'],[]).append(p['topic'])
kc=collections.Counter(p['kind'] for p in idx)
bi=['# 위키 빌드 인덱스 (lint 자동생성)','',f"- 총 페이지: **{rep['page_count']}** (" + ' · '.join(f'{k} {kc.get(k,0)}' for k in KINDS if kc.get(k)) + ")",
 f"- 비대칭 링크 갭: **{len(rep['asym_link_gaps'])}건** (역링크 필요 — 후속 lint에서 보강)",'',
 '## 교차 테마(2법 이상)','','| 테마 | 관련 법 수 | 페이지 수 |','|---|---|---|']
for t,l in rep['theme_laws'].items():
    if len(l)>=2: bi.append(f"| {t} | {len(l)} | {rep['theme_page_count'][t]} |")
bi+=['','## 법령별 페이지','','| 법령 | statute | concept | annex | comparison |','|---|---|---|---|---|']
for law in sorted(laws):
    d=laws[law]
    bi.append(f"| {law[:30]} | {'✓' if d['statute'] else '—'} | {len(d.get('concept',[]))} | {len(d.get('annex',[]))} | {len(d.get('comparison',[]))} |")
open(f'{DASH}/build_index.md','w',encoding='utf-8').write('\n'.join(bi)+'\n')

print('graph.json:',len(nodes),'노드',len(ed2),'엣지')
print('_backbone.md:',min(40,len(cc)),'허브 법')
print('build_index.md 생성 · 법령',len(laws),'개')
