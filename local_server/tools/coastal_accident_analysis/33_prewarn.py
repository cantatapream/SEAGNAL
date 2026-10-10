"""예비특보 — 과거 기록으로 ①실제 특보로 이어지는 비율·시각 ②예비 범위 시작부터 '특보로 가정'한 시간대의 사고 배수
(사용자 확정 2026-10-10: "예비특보는 발표 예정일시가 범위형으로 되어있기 떄문에(0시 ~ 0시) 시작하는 시각 시점에 발효가 된것으로 가정").
자료: 기상청 API허브 wrn_met_data.php(특보 자료, LVL 1 = 예비) 2020~2025 → $S/kma/wrn_met/wrn_2020_2025.csv(수집 에이전트 정리).
 · 이 API 의 예비 TM_EF 는 **예정 범위의 끝**이다(…58 = 6시간 범위 끝, …59 = 3시간 범위 끝으로 보고 시작 = 끝 올림 − 6h/3h).
   이 해석은 ①에서 실제 특보 발효시각이 그 범위 안에 드는 비율로 점검한다.
 · 해상 구역(S…)의 풍랑(V)·태풍(T)만. 2021-07 에 폐지된 먼바다 코드 8개는 실제 특보 시작시각 일치로 지금 이름(안쪽·바깥 둘)에 잇는다.
 · 한 '예비 묶음' = 같은 구역·종류에서 예비 발표가 나온 뒤 정식 발표(주의보·경보) / 예비 해제 / 범위 끝 + 24시간 중 먼저 오는 것까지. 묶음 안 예비 재발표는 범위를 마지막 것으로 갱신.
② 노출(사고 시각 기준, 서로 겹치지 않게):
   실제 특보 중 / [실제 특보 없음] 예비 범위 시작 ~ 실제 발효 전(전환된 묶음) / [실제 특보 없음] 예비 범위 시작 ~ 범위 끝(전환 안 된 묶음 — 헛예비)
   기준 = 그 밖의 시간. 선박 기상민감 4종(08_ship.py 시각 맞춤 행), 층 = 사고 × 연월, 요일·공휴일 보정, 군집 = 사고 날짜.
사용: python3 -I 33_prewarn.py <data_dir> <results_dir> <wrn_2020_2025.csv> > results/prewarn.md
"""
import sys, os, collections, datetime as dt, bisect
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R, WF = sys.argv[1:4]
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
RETIRED = {'S1132100': ['동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다'], 'S1132200': ['동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다'],
           'S1152000': ['동해중부안쪽먼바다', '동해중부바깥먼바다'], 'S1232100': ['서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다'],
           'S1232200': ['서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'], 'S1252000': ['서해중부안쪽먼바다', '서해중부바깥먼바다'],
           'S1312000': ['남해동부안쪽먼바다', '남해동부바깥먼바다'], 'S1324000': ['제주도남쪽바깥먼바다']}
w = pd.read_csv(WF, dtype=str)
w = w[w.reg_id.str.startswith('S') & w.wrn.isin(['V', 'T'])].copy()
P = lambda s: dt.datetime.strptime(s, '%Y%m%d%H%M')
w['fc'] = w.tm_fc.map(P); w['ef'] = w.tm_ef.map(P); w['lvl'] = w.lvl.astype(int); w['cmd'] = w.cmd.astype(int)
def names(r):
    if r.reg_id in RETIRED: return RETIRED[r.reg_id]
    return [r.reg_name] if isinstance(r.reg_name, str) else []
def range_of(ef):   # 예비 TM_EF(범위 끝) → (시작, 끝)
    end = ef.replace(minute=0, second=0) + dt.timedelta(hours=1)
    return end - dt.timedelta(hours=6 if ef.minute == 58 else 3), end
ep = []   # 예비 묶음
for (reg, wrn), g in w.sort_values(['fc', 'tm_in']).groupby(['reg_id', 'wrn']):
    cur = None
    for r in g.itertuples():
        if cur and r.fc > cur['end'] + dt.timedelta(hours=24):
            cur['close'] = cur['end'] + dt.timedelta(hours=24); cur['how'] = '만료'; ep.append(cur); cur = None
        if r.lvl == 1 and r.cmd == 1:
            s, e = range_of(r.ef)
            if cur is None: cur = dict(reg=reg, wrn=wrn, names=names(r), fc0=r.fc, start=s, end=e, n=1)
            else: cur.update(start=s, end=e, n=cur['n'] + 1)
        elif cur and r.lvl == 1 and r.cmd in (3, 7):
            cur['close'] = r.fc; cur['how'] = '예비 해제'; ep.append(cur); cur = None
        elif cur and r.lvl >= 2 and r.cmd == 1:
            cur['close'] = r.ef; cur['how'] = '정식 발효'; cur['actual'] = r.ef; cur['actual_lvl'] = r.lvl; ep.append(cur); cur = None
    if cur: cur['close'] = cur['end'] + dt.timedelta(hours=24); cur['how'] = '만료'; ep.append(cur)
E = pd.DataFrame(ep); E = E[E.names.map(len) > 0]
E = E[(E.start >= dt.datetime(2020, 1, 1)) & (E.start < dt.datetime(2026, 1, 1))]
out = ['#### ① 예비특보 → 실제 특보(해상 구역 풍랑·태풍, 2020~2025)\n']
conv = E[E.how == '정식 발효']
out.append('| 종류 | 예비 묶음 | 실제 특보로 이어짐 | 예비 해제 | 이어지지 않고 만료 |'); out.append('|---|---|---|---|---|')
for wrn, lab in (('V', '풍랑'), ('T', '태풍'), (None, '합계')):
    g = E if wrn is None else E[E.wrn == wrn]
    out.append('| %s | %d | %d (%.1f%%) | %d (%.1f%%) | %d (%.1f%%) |' % (lab, len(g), (g.how == '정식 발효').sum(), 100 * (g.how == '정식 발효').mean(),
               (g.how == '예비 해제').sum(), 100 * (g.how == '예비 해제').mean(), (g.how == '만료').sum(), 100 * (g.how == '만료').mean()))
d = (conv.actual - conv.start).dt.total_seconds() / 3600
inr = ((conv.actual >= conv.start) & (conv.actual <= conv.end)).mean()
out.append('\n**실제 발효시각이 예비 범위(시작~끝) 안에 든 비율: %.1f%%** (범위 앞 %.1f%% · 범위 뒤 %.1f%%) — 범위 해석(…58 = 6시간, …59 = 3시간) 점검.' % (
    100 * inr, 100 * (conv.actual < conv.start).mean(), 100 * (conv.actual > conv.end).mean()))
out.append('실제 발효 − 예비 범위 시작(시간): 중앙값 %.1f · 사분위 %.1f ~ %.1f · 범위 시작보다 일찍 발효된 묶음의 중앙 앞섬 %.1f시간.' % (
    d.median(), d.quantile(.25), d.quantile(.75), -d[d < 0].median() if (d < 0).any() else 0))
lead = (conv.actual - conv.fc0).dt.total_seconds() / 3600
out.append('예비 첫 발표 → 실제 발효까지(시간): 중앙값 %.1f · 사분위 %.1f ~ %.1f.' % (lead.median(), lead.quantile(.25), lead.quantile(.75)))
# 정식 발표 중 앞에 예비가 있었던 비율
off = w[(w.lvl >= 2) & (w.cmd == 1)]; off = off[(off.ef >= dt.datetime(2020, 1, 2)) & (off.ef < dt.datetime(2026, 1, 1))]
key = set(zip(conv.reg, conv.wrn, conv.actual))
out.append('실제 정식 발표(주의보·경보 신규) %d건 중 앞에 예비가 있었던 것: %d (%.1f%%).\n' % (len(off), sum((a, b, c) in key for a, b, c in zip(off.reg_id, off.wrn, off.ef)),
           100 * np.mean([(a, b, c) in key for a, b, c in zip(off.reg_id, off.wrn, off.ef)])))
# ② 사고 배수
win = collections.defaultdict(list)   # 정규화 이름 → (시작, 끝, 종류)
for r in E.itertuples():
    if r.how == '정식 발효':
        if r.actual > r.start: seg = (r.start, r.actual, 'pre')
        else: continue
    else: seg = (r.start, min(r.end, r.close) if r.how == '예비 해제' else r.end, 'false')
    if seg[1] <= seg[0]: continue
    for nm in r.names: win[expo.norm(nm)].append(seg)
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sens = sg.types.str.contains('전복|침몰|침수|표류').values; sfat = ((sg.death.fillna(0) + sg.missing.fillna(0)) > 0).values
st = pd.read_csv(R + '/ship_strata_rows_time.csv.gz'); st = st[sens[st.ev.values]].copy()
hm = sg.hm.values[st.ev.values]; zz = [expo.norm(z) for z in sg.sea_zone.values[st.ev.values]]
whens = [expo.DATES[d].to_pydatetime() + dt.timedelta(hours=int(h.split(':')[0]), minutes=int(h.split(':')[1])) for d, h in zip(st.day.values, hm)]
pre = np.zeros(len(st)); fal = np.zeros(len(st))
for i, (z, t) in enumerate(zip(zz, whens)):
    for a, b, k in win.get(z, ()):
        if a <= t < b:
            if k == 'pre': pre[i] = 1
            else: fal[i] = 1
act = (st.seaw.values >= 1)
st['actual'] = act.astype(float); st['pre'] = ((pre == 1) & ~act).astype(float); st['false'] = ((fal == 1) & ~act & (pre == 0)).astype(float)
out += ['#### ② 예비 범위 시작부터 "특보로 가정"한 시간의 선박사고 배수(기상민감 4종, 사고 시각 맞춤, 기준 = 실제 특보도 예비 범위도 아닌 시간)\n',
        '| 시간대 | 전체 사고: 배수 (95% 신뢰구간) [사고 수] | 사망·실종 사고 |', '|---|---|---|']
res = {}
for oc, m_ in (('all', None), ('fatal', sfat)):
    q = st if m_ is None else st[m_[st.ev.values]]
    t = {x['term']: x for x in ccr.table(ccr.fit(q.ev.values, q.case.values, q[['actual', 'pre', 'false'] + CAL].values.astype(float), cluster=q.cl.values, names=['actual', 'pre', 'false'] + CAL))}
    res[oc] = (t, q)
for c, lab in (('actual', '실제 특보 중'), ('pre', '예비 → 실제로 이어졌으나 아직 발효 전(범위 시작 ~ 실제 발효)'), ('false', '헛예비(실제로 안 이어짐) 범위 안')):
    cell = []
    for oc in ('all', 'fatal'):
        t, q = res[oc]; n = int(((q.case == 1) & (q[c] == 1)).sum())
        cell.append('추정 보류(%d건)' % n if n < 5 else '%.2f (%.2f–%.2f) [%d]' % (t[c]['RR'], t[c]['lo'], t[c]['hi'], n))
    out.append('| %s | %s | %s |' % (lab, cell[0], cell[1]))
t, q = res['all']; cmb = q.copy(); cmb['assumed'] = ((cmb.pre == 1) | (cmb.false == 1)).astype(float)
t2 = {x['term']: x for x in ccr.table(ccr.fit(cmb.ev.values, cmb.case.values, cmb[['actual', 'assumed'] + CAL].values.astype(float), cluster=cmb.cl.values, names=['actual', 'assumed'] + CAL))}
out.append('| (합쳐서) 예비만으로 특보를 가정한 시간 전체 | %.2f (%.2f–%.2f) [%d] | |' % (t2['assumed']['RR'], t2['assumed']['lo'], t2['assumed']['hi'], int(((cmb.case == 1) & (cmb.assumed == 1)).sum())))
out.append('\n- 헛예비 범위의 끝 = 예비 해제가 먼저 오면 그 시각, 아니면 예비가 말한 범위 끝.')
print('\n'.join(out))
