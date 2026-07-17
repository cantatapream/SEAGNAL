#!/usr/bin/env python3
# 다음 파도(≤12) 선정: 마커 없는(=미완) 작업 중, 서로 다른 법 12개, 최근 수정중인 법 제외.
# 출력: 각 줄 "TYPE\tLAWNAME" (오케스트레이터가 이걸로 fix_cell.js 워크플로 launch)
import json, os, sys, time
S='/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
MARK=os.path.join(LEGAL,'_dashboard/fix3')
tasks=json.load(open(os.path.join(S,'fix_tasks.json')))
tc={'①타법연결':'tabeop','②일반법연결':'ilbanbeop','③별표전량이관':'byeolpyo','thin심화':'thin','풀빌드(신규기준법)':'fullbuild'}
prio={'풀빌드(신규기준법)':0,'③별표전량이관':1,'①타법연결':2,'②일반법연결':3,'thin심화':4}
def done(t): return os.path.exists(os.path.join(MARK,f"{t['slug']}__{tc[t['type']]}.done"))
# law이 최근(12분내) 위키수정중이면 제외(동시쓰기 방지)
now=time.time()
def recently_touched(slug):
    d=os.path.join(LEGAL,'wiki/concepts')
    try:
        for f in os.listdir(d):
            if f.startswith(slug+'__') and now-os.path.getmtime(os.path.join(d,f))<720: return True
    except: pass
    return False
pend=[t for t in tasks if not done(t)]
pend.sort(key=lambda t: prio.get(t['type'],9))
wave=[]; used=set()
for t in pend:
    if t['law'] in used: continue
    if recently_touched(t['slug']): continue
    wave.append(t); used.add(t['law'])
    if len(wave)>=12: break
# 상태 요약(stderr)
total=len(tasks); ndone=sum(1 for t in tasks if done(t))
sys.stderr.write(f"작업 {ndone}/{total} 완료, 미완 {total-ndone}, 이번파도 {len(wave)}개\n")
for t in wave:
    sys.stdout.write(f"{t['type']}\t{t['law']}\n")
