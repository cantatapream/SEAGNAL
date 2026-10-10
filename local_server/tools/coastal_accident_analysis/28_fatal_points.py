"""A안 요소마다 '전체 사고'와 '사망·실종 사고'를 같은 방법으로 나란히 잰다(사용자 지시 2026-10-10:
"위험구역 개수별, 주말 행사, 달별의 값 별 등 같은 방식으로 계산 필요" · "모든 월을 재야하지 않을까" · "1.##배를 %로 표현").
방법은 요소마다 본 분석과 같다 — 결과 칸만 '사망·실종이 1명 이상 난 사고'로 바꾼다.
  사람(혼잡)  : person_models.csv D2(같은 장소·같은 달, 요일·공휴일 보정) — 07_person.py 결과를 읽는다
  달(1~12월)  : 층 = 사고 × 그 해, 외지인 방문자(log₂)·요일·공휴일 보정, 군집 = 사고 날짜(26_summer_bonus.py 와 같은 틀).
                기준 = 1년 평균 날(달마다 배수를 날 수로 가중한 기하평균) — "평소보다 몇 % 높은가/낮은가"
  위험구역    : 관광지 단위 포아송 + 시군구 고정효과 + 해안선 길이 보정, 지정 이후(2023~24) 사고(09_spots.py 와 같은 틀)
  주말 행사   : 층 = 같은 시군구·같은 연월·같은 요일(17c_event_ccr.py 와 같은 틀)
  연안 특보   : 하루 사고 수 = season_person_models.csv P3 / 사고 1건의 사망·실종 비율 = 27_fatality_warn.py 와 같은 틀
  해상 날씨   : 선박 기상민감 4종, 사고 시각 맞춤(08_ship.py A3b · 23_checks.py '특보 없는 때 대비' 칸과 같은 틀)
표시: 배수 → 백분율 = (배수 − 1) × 100. 사망·실종 사고가 5건 미만인 칸은 '추정 보류', 신뢰구간 상한÷하한 20~50 은 ‡, 50 초과는 '추정 불안정'.
사용: python3 -I 28_fatal_points.py <data_dir> <results_dir> <events.csv> <accident_features_person.csv.gz> > results/fatal_points.md
"""
import sys, os, csv, gzip, collections, datetime as dt, importlib.util
import numpy as np, pandas as pd, statsmodels.api as sm
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R, EVF, ACCF = sys.argv[1:5]
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
rows = []   # (영역, 요소, 단계, 결과, RR, lo, hi, 해당 사고 수)
def add(area, factor, level, outcome, rr, lo, hi, n):
    rows.append(dict(area=area, factor=factor, level=level, outcome=outcome, RR=rr, lo=lo, hi=hi, n=n))

# ── 사람(혼잡) ─────────────────────────────────────────────
P = pd.read_csv(R + '/person_models.csv')
for sub, oc in (('전체', '전체 사고'), ('사망·실종', '사망·실종 사고')):
    x = P[P.model.str.startswith('D2_') & (P.subset == sub) & (P.term == 'log2_outsider')].iloc[0]
    add('연안', '사람(혼잡)', '사람(외지인 방문자) 2배', oc, x.RR, x.lo, x.hi, int(x.n_events))

# ── 달(1~12월) ─────────────────────────────────────────────
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0)
dow, hol, month, year = expo.calendar()
v = pd.read_csv(D + '/visitors_daily_coastal.csv.gz', dtype={'sgg': str, 'date': str}); v = v[v.date.isin(expo.DIDX)]
vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
V = np.full((len(vzi), expo.ND), np.nan, np.float32); V[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v.outsider.values
rec = collections.defaultdict(list)
for k, r in pe.iterrows():
    vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
    if vi is None: continue
    ci = expo.DIDX[r.date]; days = np.where(year == year[ci])[0]
    rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8)); rec['vo'].append(V[vi, days])
md = pd.DataFrame({c: np.concatenate(x) for c, x in rec.items()})
md = md[md.vo > 0].copy(); md['lv'] = np.log2(md.vo); md['cl'] = pe.date.values[md.ev.values]
mm = month[md.day.values]
MN = ['m%d' % i for i in range(2, 13)]
for i in range(2, 13): md['m%d' % i] = (mm == i).astype(float)
for d in range(1, 7): md['dow%d' % d] = (dow[md.day.values] == d).astype(float)
md['hol'] = hol[md.day.values].astype(float)
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]); W = DAYS / DAYS.sum()
for oc, mask in (('전체 사고', np.ones(len(pe), bool)), ('사망·실종 사고', pe.fatal.values)):
    q = md[mask[md.ev.values]]
    r = ccr.fit(q.ev.values, q.case.values, q[MN + ['lv'] + CAL].values.astype(float), cluster=q.cl.values, names=MN + ['lv'] + CAL)
    b = np.r_[0.0, r['b'][:11]]; Vm = np.zeros((12, 12)); Vm[1:, 1:] = r['V'][:11, :11]
    for i in range(12):   # 달 i 의 배수 ÷ 1년 평균 날(날 수 가중 기하평균)
        c = -W.copy(); c[i] += 1
        est = c @ b; se = np.sqrt(c @ Vm @ c)
        n = int(((q.case == 1) & (month[q.day.values] == i + 1)).sum())
        add('연안', '달(1년 평균 날 대비)', '%d월' % (i + 1), oc, np.exp(est), np.exp(est - 1.96 * se), np.exp(est + 1.96 * se), n)

# ── 위험구역(관광지 단위, 지정 이후 2023~24) ───────────────────
sp = pd.read_csv(D + '/spots_features.csv', dtype={'sgg': str})
ps = pe[pe.spot.notna()].copy(); ps['spot'] = ps.spot.astype(int); late = ps.date >= '20230101'
for nm, m_ in (('n_late', late), ('n_late_fatal', late & ps.fatal)):
    sp[nm] = sp.spot.map(ps[m_].groupby('spot').size()).fillna(0).astype(int)
sp['log_coast'] = np.log(sp.coast_cells_share + 1)
sp['bin'] = pd.cut(sp.hz_all_3km, bins=[0, 1, 3, 6, 999], labels=['0', '1-2', '3-5', '6+'], right=False).astype(str)
sp['fatal_any'] = (sp.hz_fatal_3km > 0).astype(float)
BL = {'1-2': '위험구역 1~2곳', '3-5': '위험구역 3~5곳', '6+': '위험구역 6곳 이상'}
for y, oc in (('n_late', '전체 사고'), ('n_late_fatal', '사망·실종 사고')):
    for with_fatal in (False, True):
        X = pd.get_dummies(sp.bin, prefix='bin', dtype=float).drop(columns='bin_0')
        if with_fatal: X['fatal_any'] = sp.fatal_any
        X = sm.add_constant(pd.concat([X, pd.get_dummies(sp.sgg, prefix='sgg', drop_first=True, dtype=float), sp[['log_coast']]], axis=1))
        m = sm.GLM(sp[y], X, family=sm.families.Poisson()).fit(cov_type='HC1')
        terms = ['fatal_any'] if with_fatal else ['bin_' + k for k in BL]
        for t in terms:
            b_, s_ = m.params[t], m.bse[t]
            sel = (sp.fatal_any == 1) if t == 'fatal_any' else (sp.bin == t[4:])
            add('연안', '장소(가산)' if t == 'fatal_any' else '장소(위험구역 3km 안)', '사망사고 발생구역 3km 안' if t == 'fatal_any' else BL[t[4:]],
                oc, np.exp(b_), np.exp(b_ - 1.96 * s_), np.exp(b_ + 1.96 * s_), int(sp.loc[sel, y].sum()))

# ── 주말 행사 ───────────────────────────────────────────────
spec = os.path.join(os.path.dirname(os.path.abspath(__file__)), '17_event_days.py')
src = open(spec).read(); loc = {}
exec(src[src.index('ADDR = {'):src.index('}\n', src.index('ADDR = {')) + 2], {}, loc); ADDR = loc['ADDR']
D0, D1 = dt.date(2020, 1, 1), dt.date(2024, 12, 31); ev_days = set()
for r in csv.DictReader(open(EVF, encoding='utf-8-sig')):
    if r['status'] not in ('개최', '축소') or not r['start_date']: continue
    s = dt.date.fromisoformat(r['start_date']); e = dt.date.fromisoformat(r['end_date']) if r['end_date'] else s
    codes = ADDR.get(r['address'])
    if not codes or (e - s).days > 30: continue
    d = s
    while d <= e:
        if D0 <= d <= D1:
            for c in codes: ev_days.add((c, d))
        d += dt.timedelta(1)
ev_sgg = {c for c, _ in ev_days}
acc = [r for r in csv.DictReader(gzip.open(ACCF, 'rt')) if r['sgg'] in ev_sgg]
for oc, keep in (('전체 사고', lambda r: True), ('사망·실종 사고', lambda r: float(r['death'] or 0) + float(r['missing'] or 0) > 0)):
    evs, case, x, cl = [], [], [], []
    for k, r in enumerate(a for a in acc if keep(a)):
        d = dt.datetime.strptime(r['date'], '%Y%m%d').date()
        if d.weekday() < 5: continue
        x0 = d.replace(day=1)
        while x0.month == d.month:
            if x0.weekday() == d.weekday():
                evs.append(k); case.append(int(x0 == d)); x.append(float((r['sgg'], x0) in ev_days)); cl.append(r['date'])
            x0 += dt.timedelta(1)
    evs, case, x, cl = map(np.array, (evs, case, x, cl))
    n = int(((case == 1) & (x == 1)).sum())
    if n == 0:
        add('연안', '행사', '주말 행사일', oc, np.nan, np.nan, np.nan, 0); continue
    t = ccr.table(ccr.fit(evs, case, x[:, None], cluster=cl, names=['event']))[0]
    add('연안', '행사', '주말 행사일', oc, t['RR'], t['lo'], t['hi'], n)

# ── 연안 특보 ───────────────────────────────────────────────
SP = pd.read_csv(R + '/season_person_models.csv')
for sub, oc in (('전체', '전체 사고'), ('사망·실종', '사망·실종 사고')):
    x = SP[SP.model.str.startswith('P3_') & (SP.subset == sub) & (SP.term == 'any_warn') & (SP.season == '전체(계절 구분 없음)')].iloc[0]
    add('연안(점수 밖)', '특보(하루 사고 수)', '특보 있는 날', oc, x.RR, x.lo, x.hi, int(x.cases_with))
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pc = pr[pr.case == 1].copy()
pc['fatal'] = pe.fatal.astype(int).values[pc.ev.values]; pc['yr'] = pe.date.str[:4].values[pc.ev.values]; pc['w'] = (pc.anyw >= 1).astype(float)
X = sm.add_constant(pd.concat([pc[['w']], pd.get_dummies(pc[['type', 'month', 'yr']].astype(str), drop_first=True, dtype=float)], axis=1))
m = sm.GLM(pc.fatal.astype(float), X, family=sm.families.Poisson()).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(pc.day)[0]})
b_, s_ = m.params['w'], m.bse['w']
add('연안(점수 밖)', '특보(사고 1건의 치명률)', '특보 있는 날 사고', '사고 1건이 사망·실종으로 이어질 비율', np.exp(b_), np.exp(b_ - 1.96 * s_), np.exp(b_ + 1.96 * s_), int(pc[(pc.w == 1)].fatal.sum()))

# ── 해상 날씨(선박 기상민감 4종, 사고 시각 맞춤) ───────────────────
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sens = sg.types.str.contains('전복|침몰|침수|표류').values; sfat = ((sg.death.fillna(0) + sg.missing.fillna(0)) > 0).values
st = pd.read_csv(R + '/ship_strata_rows_time.csv.gz')
st['w1'] = (st.seaw == 1).astype(float); st['w2'] = (st.seaw == 2).astype(float)
for oc, mask in (('전체 사고', sens), ('사망·실종 사고', sens & sfat)):
    s4 = st[mask[st.ev.values]]
    t = {x['term']: x for x in ccr.table(ccr.fit(s4.ev.values, s4.case.values, s4[['w1', 'w2'] + CAL].values.astype(float), cluster=s4.cl.values, names=['w1', 'w2'] + CAL))}
    for c, lab in (('w1', '주의보'), ('w2', '경보')):
        add('해상', '바다·날씨', lab, oc, t[c]['RR'], t[c]['lo'], t[c]['hi'], int(((s4.case == 1) & (s4[c] == 1)).sum()))
    for col, cuts, lab in (('ws', [14, 17], '풍속'), ('wh', [2, 4], '파고')):
        q = s4.dropna(subset=[col]).copy(); w = q.seaw >= 1
        q['c0'] = (w & (q[col] < cuts[0])).astype(float); q['c1'] = (w & (q[col] >= cuts[0]) & (q[col] < cuts[1])).astype(float); q['c2'] = (w & (q[col] >= cuts[1])).astype(float)
        t = {x['term']: x for x in ccr.table(ccr.fit(q.ev.values, q.case.values, q[['c0', 'c1', 'c2'] + CAL].values.astype(float), cluster=q.cl.values, names=['c0', 'c1', 'c2'] + CAL))}
        want = (('c1', '특보 & 풍속 14~17m/s'), ('c2', '특보 & 풍속 17m/s 이상')) if col == 'ws' else (('c2', '특보 & 파고 4m 이상'),)
        for c, nm in want:
            add('해상', '바다·날씨', nm, oc, t[c]['RR'], t[c]['lo'], t[c]['hi'], int(((q.case == 1) & (q[c] == 1)).sum()))

# ── 출력 ───────────────────────────────────────────────────
df = pd.DataFrame(rows); df.to_csv(R + '/fatal_points.csv', index=False, encoding='utf-8-sig')
def pct(x): return '—' if not np.isfinite(x) else ('%+.0f%%' % (100 * (x - 1))).replace('-', '−')
def cell(r):
    if r.n < 5 or not np.isfinite(r.RR): return '추정 보류(해당 %d건)' % r.n
    ratio = r.hi / r.lo; mark = ' — 추정 불안정' if ratio > 50 else (' ‡' if ratio >= 20 else '')
    return '%.2f배 (%.2f–%.2f) · **%s** (%s ~ %s)%s' % (r.RR, r.lo, r.hi, pct(r.RR), pct(r.lo), pct(r.hi), mark)
def pts(r): return '—' if r.n < 5 or not np.isfinite(r.RR) else '%.2f' % np.log2(r.RR)
print('#### 요소별 전체 사고와 사망·실종 사고 — 같은 방법, 배수와 백분율(백분율 = (배수 − 1) × 100)\n')
print('| 영역 | 요소 | 단계 | 전체 사고: 배수 · 백분율 (95% 신뢰구간) | 점수 | 사망·실종 사고: 배수 · 백분율 (95% 신뢰구간) | 해당 사고(전체 / 사망·실종) |')
print('|---|---|---|---|---|---|---|')
key = ['area', 'factor', 'level']
for (a, f, l), g in df.groupby(key, sort=False):
    al = g[g.outcome == '전체 사고']; fa = g[g.outcome == '사망·실종 사고']
    if len(al) and len(fa):
        A, F = al.iloc[0], fa.iloc[0]
        print('| %s | %s | %s | %s | %s | %s | %d / %d |' % (a, f, l, cell(A), pts(A), cell(F), A.n, F.n))
    else:
        X_ = g.iloc[0]; print('| %s | %s | %s | (%s) %s | — | — | %d |' % (a, f, l, X_.outcome, cell(X_), X_.n))
print('\n- 점수 = log₂(전체 사고 배수) — A안 점수(사고 빈도 기준). 사망·실종 칸은 점수에 넣지 않고 함께 보여 주는 값.')
print('- 달 칸의 기준은 "1년 평균 날"(달마다의 배수를 날 수로 가중한 기하평균)이다. 사람 수(외지인 방문자)를 같게 맞춘 뒤의 몫이다.')
print('- 위험구역 칸의 기준은 "같은 시군구의 위험구역 없는 관광지", 사람 칸은 "같은 장소·같은 달의 사람이 절반인 날", 행사 칸은 "같은 시군구·같은 달의 같은 요일, 행사 없는 날", 해상 칸은 "같은 장소·같은 달의 같은 시각, 특보 없는 때".')
