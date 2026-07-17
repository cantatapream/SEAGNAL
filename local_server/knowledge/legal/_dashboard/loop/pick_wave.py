#!/usr/bin/env python3
# 다음 파도(≤N, 기본35) 선정 후 예약(.launched). 서로 다른 법(파일충돌 방지)·미완(.done 없음)·비-in-flight(.launched 25분내 없음).
# 출력: 각 줄 "TYPE\tLAWNAME". 인자: 숫자=파도크기, --reserve=선정분 .launched 기록.
import json, os, sys, time
S='/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
MARK=os.path.join(LEGAL,'_dashboard/fix3')
os.makedirs(MARK, exist_ok=True)
N=70
for a in sys.argv[1:]:
    if a.isdigit(): N=int(a)
reserve='--reserve' in sys.argv
tasks=json.load(open(os.path.join(S,'fix_tasks.json')))
tc={'①타법연결':'tabeop','②일반법연결':'ilbanbeop','③별표전량이관':'byeolpyo','thin심화':'thin','풀빌드(신규기준법)':'fullbuild'}
prio={'풀빌드(신규기준법)':0,'③별표전량이관':1,'①타법연결':2,'②일반법연결':3,'thin심화':4}
now=time.time()
def dpath(t): return os.path.join(MARK,f"{t['slug']}__{tc[t['type']]}.done")
def lpath(t): return os.path.join(MARK,f"{t['slug']}__{tc[t['type']]}.launched")
def done(t): return os.path.exists(dpath(t))
def launched_recent(t):
    p=lpath(t); return os.path.exists(p) and now-os.path.getmtime(p)<1500
pend=[t for t in tasks if not done(t) and not launched_recent(t)]
pend.sort(key=lambda t: prio.get(t['type'],9))
inflight_laws=set(t['law'] for t in tasks if not done(t) and launched_recent(t))
wave=[]; used=set()
for t in pend:
    if t['law'] in used or t['law'] in inflight_laws: continue
    wave.append(t); used.add(t['law'])
    if len(wave)>=N: break
total=len(tasks); ndone=sum(1 for t in tasks if done(t))
sys.stderr.write(f"작업 {ndone}/{total} 완료, in-flight {len(inflight_laws)}법, 이번파도 {len(wave)}개(N={N})\n")
for t in wave:
    if reserve: open(lpath(t),'w').write(str(now))
    sys.stdout.write(f"{t['type']}\t{t['law']}\n")
