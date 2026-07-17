#!/usr/bin/env python3
# 감사 라운드 R의 다음 파도(≤N, 기본35) 선정+예약. 마커 audit_r<R>_<slug>.done 없는 법 중 서로 다른 법.
# 사용: python3 pick_audit_wave.py <round> [N] [--reserve]   출력: 각 줄 법명
import json, os, sys, time
S='/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
MARK=os.path.join(LEGAL,'_dashboard/fix3')
os.makedirs(MARK, exist_ok=True)
args=[a for a in sys.argv[1:]]
R=int(args[0]) if args and args[0].isdigit() else 4
N=12  # 지속가능 파도크기(서버 동시요청 한도). 65 동시=서버 rate-limit→0진척.
nums=[int(a) for a in args if a.isdigit()]
if len(nums)>=2: N=nums[1]
reserve='--reserve' in sys.argv
laws=json.load(open(os.path.join(S,'all_laws.json')))
now=time.time()
def dmark(slug): return os.path.join(MARK,f"audit_r{R}_{slug}.done")
def lmark(slug): return os.path.join(MARK,f"audit_r{R}_{slug}.launched")
def done(l): return os.path.exists(dmark(l['slug']))
def launched_recent(l):
    p=lmark(l['slug']); return os.path.exists(p) and now-os.path.getmtime(p)<1800  # 30분(감사가 fix보다 오래)
pend=[l for l in laws if not done(l) and not launched_recent(l)]
inflight=sum(1 for l in laws if not done(l) and launched_recent(l))
wave=pend[:N]
ndone=sum(1 for l in laws if done(l))
sys.stderr.write(f"감사R{R}: {ndone}/{len(laws)} 완료, in-flight {inflight}, 이번파도 {len(wave)}개(N={N})\n")
for l in wave:
    if reserve: open(lmark(l['slug']),'w').write(str(now))
    sys.stdout.write(l['name']+"\n")
