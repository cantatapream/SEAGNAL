#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint 2단계(알고리즘 산출): 백본 지도·대시보드 인덱스·개념 그래프 생성."""
import os,re,json,glob,collections
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
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
# 중복 제거
uniq=set(); ed2=[]
for e in edges:
    k=(e['from'],e['to'],e['kind'])
    if k in uniq: continue
    uniq.add(k); ed2.append(e)
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
laws=collections.defaultdict(lambda:{'statute':None,'concepts':[]})
for p in idx:
    if p['kind']=='statute': laws[p['law']]['statute']=p['file']
    else: laws[p['law']]['concepts'].append(p['topic'])
bi=['# 위키 빌드 인덱스 (lint 자동생성)','',f"- 총 페이지: **{rep['page_count']}** (statute {sum(1 for p in idx if p['kind']=='statute')} · concept {sum(1 for p in idx if p['kind']=='concept')})",
 f"- 비대칭 링크 갭: **{len(rep['asym_link_gaps'])}건** (역링크 필요 — 후속 lint에서 보강)",'',
 '## 교차 테마(2법 이상)','','| 테마 | 관련 법 수 | 페이지 수 |','|---|---|---|']
for t,l in rep['theme_laws'].items():
    if len(l)>=2: bi.append(f"| {t} | {len(l)} | {rep['theme_page_count'][t]} |")
bi+=['','## 법령별 페이지','','| 법령 | statute | concept 수 |','|---|---|---|']
for law in sorted(laws):
    d=laws[law]; bi.append(f"| {law[:30]} | {'✓' if d['statute'] else '—'} | {len(d['concepts'])} |")
open(f'{DASH}/build_index.md','w',encoding='utf-8').write('\n'.join(bi)+'\n')

print('graph.json:',len(nodes),'노드',len(ed2),'엣지')
print('_backbone.md:',min(40,len(cc)),'허브 법')
print('build_index.md 생성 · 법령',len(laws),'개')
