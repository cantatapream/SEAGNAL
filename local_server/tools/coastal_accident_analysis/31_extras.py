"""v3 보고서·설계서에서 "재지 않았다/검정하지 못했다"로 남은 항목 중 지금 자료로 잴 수 있는 것을 잰다
(사용자 지시 2026-10-10: "재지 않은 요소가 있다면 누락없이 재놔야 나중에 보고서, 설계서의 근거가 제대로 될 것 같고").
 ① 사람(혼잡) × 장소(위험구역) — "사람이 많은 날 위험구역 효과가 커지는가"(§4.6·§8.5 미검정)
    층 = 사고 × 연월(07_person.py 행), 노출 = log₂ 외지인 방문자, 사고가 속한 관광지의 위험구역 구간별로 방문자 효과를 따로 → 같은가 검정
 ② 선박: 주의보만 떼어 파고 4m 이상(§6.6 '주의보 안에서도' 미분석) — 기상민감 4종, 사고 시각 맞춤
 ③ 선박 기상민감 4종: 주말·공휴일, 달(1~12월, 1년 평균 날 대비) — 전체·사망실종(점수 후보 칸이 비어 있었음)
 ⑤ 선박 충돌·접촉 — 특보 × 파고·풍속 칸(기상민감 4종 §6.6 칸과 같은 틀, 바텀시트 종류별 수치용)
 ④ 주말 효과의 계절 차이 검정 — 연안 사망·실종(§6 "검정하지는 않았다"), 선박 충돌·접촉(§6 "검정하지 않았다")
군집 = 사고 날짜. 사용: python3 -I 31_extras.py <data_dir> <results_dir> > results/extras.md
"""
import sys, os, collections
import numpy as np, pandas as pd
from scipy.stats import chi2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R = sys.argv[1:3]
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
SEASON = {3: '봄', 4: '봄', 5: '봄', 6: '여름', 7: '여름', 8: '여름', 9: '가을', 10: '가을', 11: '가을', 12: '겨울', 1: '겨울', 2: '겨울'}
SS = ['봄', '여름', '가을', '겨울']
fmt = lambda t: '%.2f (%.2f–%.2f)' % (t['RR'], t['lo'], t['hi'])
def wald_equal(r, idx, names):
    k = len(names); C = np.zeros((k - 1, len(r['b'])))
    for i in range(k - 1): C[i, idx[names[i]]] = 1; C[i, idx[names[-1]]] = -1
    d = C @ r['b']; S = C @ r['V'] @ C.T; x = float(d @ np.linalg.solve(S, d)); return x, k - 1, float(chi2.sf(x, k - 1))
def fit(df, cols):
    r = ccr.fit(df.ev.values, df.case.values, df[cols].values.astype(float), cluster=df.cl.values, names=cols)
    return r, {x['term']: x for x in ccr.table(r)}, {n: i for i, n in enumerate(r['names'])}
out = []
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')

# ① 사람 × 위험구역
sp = pd.read_csv(D + '/spots_features.csv')
hz = dict(zip(sp.spot, sp.hz_all_3km))
bins = pd.cut(pe.spot.map(hz), bins=[0, 1, 3, 6, 999], labels=['0', '1-2', '3-5', '6+'], right=False).astype(str).values
q = pr[(pr.v_outsider > 0)].copy(); q['bin'] = bins[q.ev.values]; q = q[q.bin != 'nan']
q['lv'] = np.log2(q.v_outsider)
names = []
for b in ['0', '1-2', '3-5', '6+']:
    q['lv@' + b] = q.lv * (q.bin == b); names.append('lv@' + b)
out += ['#### ① 사람(혼잡) × 장소(위험구역) — 위험구역 구간별 "외지인 방문자 2배당" 사고 배수\n',
        '층 = 사고 × 연월, 요일·공휴일 보정, 관광지에 배정된 사고만(전남은 관광지 목록에 없음). 구간 = 사고가 속한 관광지 3km 안 위험구역 수.\n',
        '| 결과 | 위험구역 0곳 | 1~2곳 | 3~5곳 | 6곳 이상 | 네 구간 같은가 p |', '|---|---|---|---|---|---|']
for lab, m_ in (('전체 사고', None), ('사망·실종 사고', 'F')):
    s = q if m_ is None else q[pe.fatal.values[q.ev.values]]
    r, t, idx = fit(s, names + CAL)
    cnt = [int(((s.case == 1) & (s.bin == b)).sum()) for b in ['0', '1-2', '3-5', '6+']]
    x, k, p = wald_equal(r, idx, names)
    out.append('| %s | %s | p=%.3f |' % (lab, ' | '.join('%s [%d]' % (fmt(t[n]), c) for n, c in zip(names, cnt)), p))
out.append('\n→ 구간마다 방문자 효과가 같으면(곱셈 가정) 네 칸이 비슷하고 p 가 크다.\n')

# 선박 공통
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sens = sg.types.str.contains('전복|침몰|침수|표류').values; traf = sg.types.str.contains('충돌|접촉').values
sfat = ((sg.death.fillna(0) + sg.missing.fillna(0)) > 0).values
st = pd.read_csv(R + '/ship_strata_rows_time.csv.gz')

# ② 주의보 안 파고 4m
s4 = st[sens[st.ev.values]].dropna(subset=['wh']).copy()
for lv_, nm in ((1, '주의보'), (2, '경보')):
    s4['%s&<4' % nm] = ((s4.seaw == lv_) & (s4.wh < 4)).astype(float); s4['%s&4+' % nm] = ((s4.seaw == lv_) & (s4.wh >= 4)).astype(float)
cols = ['주의보&<4', '주의보&4+', '경보&<4', '경보&4+']
r, t, idx = fit(s4, cols + CAL)
s4f = s4[sfat[s4.ev.values]]; _, tf, _ = fit(s4f, cols + CAL)
out += ['#### ② 선박 기상민감 4종 — 특보 수준 × 파고 4m(사고 시각 맞춤, 기준 = 특보 없는 때)\n', '| 칸 | 배수 (95% 신뢰구간) | 해당 사고 | 사망·실종 사고 |', '|---|---|---|---|']
for c in cols:
    nf = int(((s4f.case == 1) & (s4f[c] == 1)).sum())
    out.append('| %s | %s | %d | %s |' % (c.replace('&', ' & 파고 ').replace('<4', '4m 미만').replace('4+', '4m 이상'), fmt(t[c]), int(((s4.case == 1) & (s4[c] == 1)).sum()),
               '추정 보류(%d건)' % nf if nf < 5 else '%s [%d]' % (fmt(tf[c]), nf)))
out.append('')

# ③ 선박 주말·달 — 층 = 사고 × 그 해(특보 자료 끝 2025-12-28 까지)
dow, hol, month, year = expo.calendar(); LASTW = expo.DIDX['20251228']
rec = collections.defaultdict(list)
for k, d in enumerate(sg.date):
    ci = expo.DIDX[d]; days = np.where((year == year[ci]) & (np.arange(expo.ND) <= LASTW))[0]
    rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8))
sy = pd.DataFrame({c: np.concatenate(v) for c, v in rec.items()}); sy['cl'] = sg.date.values[sy.ev.values]
for d_ in range(1, 7): sy['dow%d' % d_] = (dow[sy.day.values] == d_).astype(float)
sy['hol'] = hol[sy.day.values].astype(float); sy['wkh'] = ((dow[sy.day.values] >= 5) | hol[sy.day.values]).astype(float)
mm = month[sy.day.values]; MN = ['m%d' % i for i in range(2, 13)]
for i in range(2, 13): sy['m%d' % i] = (mm == i).astype(float)
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]); W = DAYS / DAYS.sum()
out += ['#### ③ 선박 기상민감 4종 — 주말·공휴일과 달(층 = 사고 × 그 해)\n', '| 항 | 전체 사고 | 사망·실종 사고 |', '|---|---|---|']
res = {}
for lab, m_ in (('전체', sens), ('사망·실종', sens & sfat)):
    s = sy[m_[sy.ev.values]]
    _, t, _ = fit(s, ['wkh'] + MN)
    r, _, _ = fit(s, MN + CAL)
    b = np.r_[0.0, r['b'][:11]]; Vm = np.zeros((12, 12)); Vm[1:, 1:] = r['V'][:11, :11]; mrow = []
    for i in range(12):
        c = -W.copy(); c[i] += 1; e = c @ b; se = np.sqrt(c @ Vm @ c)
        mrow.append(dict(RR=np.exp(e), lo=np.exp(e - 1.96 * se), hi=np.exp(e + 1.96 * se), n=int(((s.case == 1) & (mm[s.index.values - s.index.values[0]] if False else month[s.day.values] == i + 1)).sum())))
    res[lab] = (t['wkh'], int(((s.case == 1) & (s.wkh == 1)).sum()), mrow)
out.append('| 주말·공휴일(평일 대비, 달 보정) | %s [%d] | %s [%d] |' % (fmt(res['전체'][0]), res['전체'][1], fmt(res['사망·실종'][0]), res['사망·실종'][1]))
for i in range(12):
    a, f = res['전체'][2][i], res['사망·실종'][2][i]
    out.append('| %d월(1년 평균 날 대비, 요일·공휴일 보정) | %s [%d] | %s [%d] |' % (i + 1, fmt(a), a['n'], fmt(f), f['n']))
out.append('')

# ④ 주말 효과 계절 차이
out += ['#### ④ 주말·공휴일 효과의 계절 차이 검정(한 모형, 계절별 주말항)\n', '| 대상 | 봄 | 여름 | 가을 | 겨울 | 네 계절 같은가 p |', '|---|---|---|---|---|---|']
def season_weekend(df, lab):
    df = df.copy(); df['season'] = df.month_.map(SEASON); cols = []
    for s in SS: df['wk@' + s] = df.wkh * (df.season == s); cols.append('wk@' + s)
    r, t, idx = fit(df, cols); x, k, p = wald_equal(r, idx, cols)
    out.append('| %s | %s | p=%.3f |' % (lab, ' | '.join('%s [%d]' % (fmt(t[c]), int(((df.case == 1) & (df[c] == 1)).sum())) for c in cols), p))
pf = pr[pe.fatal.values[pr.ev.values]].copy(); pf['wkh'] = pf.weekend_or_hol; pf['month_'] = pf.month
season_weekend(pf, '연안 사망·실종(층 = 사고 × 연월)')
sd = pd.read_csv(R + '/ship_strata_rows_day.csv.gz'); sd = sd[traf[sd.ev.values]].copy()
sd['wkh'] = ((sd.dow >= 5) | (sd.hol == 1)).astype(float); sd['month_'] = month[sd.day.values]
season_weekend(sd, '선박 충돌·접촉(층 = 사고 × 연월)')
# ⑤ 충돌·접촉 — 특보 × 파고·풍속
trf = st[traf[st.ev.values]]
out += ['#### ⑤ 선박 충돌·접촉 — 특보 중 파고·풍속 칸(사고 시각 맞춤, 기준 = 특보 없는 때)\n', '| 칸 | 배수 (95% 신뢰구간) | 해당 사고 |', '|---|---|---|']
for col, cuts, lab in (('wh', [2, 4], '파고'), ('ws', [14, 17], '풍속')):
    q = trf.dropna(subset=[col]).copy(); w = q.seaw >= 1
    q['c0'] = (w & (q[col] < cuts[0])).astype(float); q['c1'] = (w & (q[col] >= cuts[0]) & (q[col] < cuts[1])).astype(float); q['c2'] = (w & (q[col] >= cuts[1])).astype(float)
    _, t, _ = fit(q, ['c0', 'c1', 'c2'] + CAL)
    for c, nm in zip(('c0', 'c1', 'c2'), ('%s %g 미만' % (lab, cuts[0]), '%s %g~%g' % (lab, cuts[0], cuts[1]), '%s %g 이상' % (lab, cuts[1]))):
        n = int(((q.case == 1) & (q[c] == 1)).sum())
        out.append('| 특보 & %s | %s | %d |' % (nm, '추정 보류' if n < 5 else fmt(t[c]), n))
out.append('')
print('\n'.join(out))
