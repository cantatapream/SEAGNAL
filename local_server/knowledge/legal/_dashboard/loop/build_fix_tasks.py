#!/usr/bin/env python3
# 최신 감사 라운드 결과(저널)에서 법×유형 작업큐(fix_tasks.json) 재생성 + fix3 마커 초기화(새 수정라운드).
# 사용: python3 build_fix_tasks.py <round>   (예: 4 → round:4 감사결과 기준으로 수정4 큐 생성)
import json, os, glob, sys, time
S='/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
MARK=os.path.join(LEGAL,'_dashboard/fix3')
D="/root/.claude/projects/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/subagents/workflows"
rnd=int(sys.argv[1]) if len(sys.argv)>1 else 3
laws=json.load(open(os.path.join(S,'all_laws.json')))  # 70

# 최신(문항수 최대) 감사 결과 per law — 라운드 무관, 가장 최근/완전한 것
best={}
for jf in glob.glob(os.path.join(D,"*","journal.jsonl")):
    try:
        for line in open(jf):
            if '"verdicts"' not in line: continue
            o=json.loads(line); r=o.get('result')
            if not isinstance(r,dict): continue
            law=r.get('law'); tq=r.get('total_questions',0)
            if not law: continue
            v=r.get('verdicts',{})
            mt=os.path.getmtime(jf)
            if law not in best or mt>best[law][0]:
                best[law]=(mt, r.get('all_wiki_gaps',[]) or r.get('wiki_gaps',[]) or [], r.get('all_collection_holes',[]) or r.get('collection_holes',[]) or [], v)
    except: pass

GEN=['형법','행정절차법','질서위반행위규제법','공소시효','행정심판','행정소송','미수','경합','양벌','개인정보','국가배상','일반법']
def has(items,kws):
    s=' '.join(items); return any(k in s for k in kws)
tasks=[]
for l in laws:
    name=l['name']; slug=l['slug']
    key=name if name in best else next((k for k in best if k[:12]==name[:12]),None)
    if not key:
        tasks.append({"law":name,"slug":slug,"type":"thin심화","status":"pending"}); continue
    _,gaps,holes,v=best[key]
    allitems=gaps+holes
    if any(('별표' in x and ('이관' in x or '대표' in x or '전량' in x or '전체' in x or '옮' in x or '미이관' in x)) for x in allitems):
        tasks.append({"law":name,"slug":slug,"type":"③별표전량이관","status":"pending"})
    if has(allitems,GEN):
        tasks.append({"law":name,"slug":slug,"type":"②일반법연결","status":"pending"})
    if any(('raw' in x or '타법' in x or '미수집' in x or '「' in x) for x in allitems):
        tasks.append({"law":name,"slug":slug,"type":"①타법연결","status":"pending"})
    if v.get('missing',0)+v.get('thin',0)>0:
        tasks.append({"law":name,"slug":slug,"type":"thin심화","status":"pending"})

json.dump(tasks, open(os.path.join(S,'fix_tasks.json'),'w'), ensure_ascii=False, indent=0)
# 마커 초기화: 기존 .done/.launched를 라운드별 아카이브로 이동
arch=os.path.join(MARK, f'_round{rnd-1}_archive')
os.makedirs(arch, exist_ok=True)
moved=0
for f in os.listdir(MARK):
    if f.endswith('.done') or f.endswith('.launched'):
        os.rename(os.path.join(MARK,f), os.path.join(arch,f)); moved+=1
from collections import Counter
c=Counter(t['type'] for t in tasks)
sys.stderr.write(f"수정{rnd} 작업큐 재생성: {len(tasks)}작업 {dict(c)}, 이전마커 {moved}개 아카이브\n")
print(len(tasks))
