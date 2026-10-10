"""선박사고 — 시간층화 사례교차(조건부 포아송).
(1) 일 단위: 층 = 사건 × (연,월). 노출 = 사건 해상특보구역의 그 날 풍랑·태풍(하루 중 일부라도 발효) · 대해구 일 최대 파고·풍속 · 요일·공휴일.
(2) 시각 맞춤: 같은 층에서 '같은 시각'끼리 비교 — 노출 = 그 시각 발효 중인 특보(시각 단위 구간) · 그 시각에 가장 가까운 3시간 해구 값.
결측(해구 발표 공백)은 그 날/시각을 빼서 분모·분자 모두 제외.
사용: python3 -I 08_ship.py <data_dir> <out_dir> [--exclude2025]
"""
import sys, os, collections, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, OUT = sys.argv[1:3]; EX25 = '--exclude2025' in sys.argv
os.makedirs(OUT, exist_ok=True)
se = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str, 'sea_zone': str})
se = se[se.sea_zone.notna()].reset_index(drop=True)
if EX25: se = se[se.src2025 == 0].reset_index(drop=True)
print('events', len(se))
TYPES = ['전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌']
for t in TYPES: se['is_' + t] = se.types.str.split('|').apply(lambda x: t in x)
ex = expo.load_exact(D + '/warn_intervals_exact.json')
W = expo.daily_warn(ex, sorted({expo.norm(z) for z in se.sea_zone}), types=('TY', 'WV'))
dow, hol, month, year = expo.calendar()
mzi, M = expo.load_marine_daily(D + '/marine_daily.csv.gz')
m3 = np.load(D + '/marine_3h.npz')
t3 = m3['times']; z3 = {int(z): i for i, z in enumerate(m3['zones'])}; wh3 = m3['wh']; ws3 = m3['ws']; lead3 = m3['lead']
T0 = dt.datetime(2019, 12, 31, 15)
def slot_of(kst_dt):
    u = kst_dt - dt.timedelta(hours=9)
    k = int(round((u - T0).total_seconds() / 10800))
    return k
# 시각 단위 특보: 구역별 구간 목록
def lvl_at(z, when):
    lv = 0
    for t in ('TY', 'WV'):
        for L, code in (('경보', 2), ('주의보', 1)):
            for s, e in ex.get((z, t, L), []):
                if s <= when < e: lv = max(lv, code); break
    return lv
def lvl_at_type(z, t, when):
    for L, code in (('경보', 2), ('주의보', 1)):
        for s, e in ex.get((z, t, L), []):
            if s <= when < e: return code
    return 0

LASTW = expo.DIDX['20251228']   # warn_intervals 의 끝 날짜 — 그 뒤는 특보 여부를 모른다
def build(mode):
    recs = collections.defaultdict(list)
    for k, r in se.iterrows():
        ci = expo.DIDX[r.date]
        days = np.where((year == year[ci]) & (month == month[ci]) & (np.arange(expo.ND) <= LASTW))[0]   # 특보 자료 끝(2025-12-28) 뒤 날짜는 층에서 뺀다
        n = len(days); z = expo.norm(r.sea_zone)
        recs['ev'].append(np.full(n, k)); recs['day'].append(days); recs['case'].append((days == ci).astype(np.int8))
        if mode == 'day':
            recs['wv'].append(W[z]['WV']['lvl'][days]); recs['ty'].append(W[z]['TY']['lvl'][days])
            recs['wv_h'].append(W[z]['WV']['hours'][days]); recs['ty_h'].append(W[z]['TY']['hours'][days])
            mz = mzi.get(int(r.mzone))
            for col in ('wh_max', 'ws_max'):
                recs[col].append(M[col][mz, days] if mz is not None else np.full(n, np.nan))
        else:
            h, mi = map(int, r.hm.split(':'))
            whens = [dt.datetime.combine(expo.DATES[d].date(), dt.time(h, mi)) for d in days]
            recs['wv'].append(np.array([lvl_at_type(z, 'WV', w) for w in whens], np.int8))
            recs['ty'].append(np.array([lvl_at_type(z, 'TY', w) for w in whens], np.int8))
            zi = z3.get(int(r.mzone))
            sl = np.array([slot_of(w) for w in whens])
            ok = (sl >= 0) & (sl < len(t3))
            whv = np.full(n, np.nan); wsv = np.full(n, np.nan)
            if zi is not None:
                good = ok.copy(); good[ok] = lead3[sl[ok]] != 99
                whv[good] = wh3[sl[good], zi]; wsv[good] = ws3[sl[good], zi]
            recs['wh'].append(whv); recs['ws'].append(wsv)
    df = pd.DataFrame({c: np.concatenate(v) for c, v in recs.items()})
    df['dow'] = dow[df.day.values]; df['hol'] = hol[df.day.values].astype(float)
    ym = (year[se.date.map(expo.DIDX).values] * 100 + month[se.date.map(expo.DIDX).values])
    df['cl'] = se.sea_zone.values[df.ev.values] + '_' + ym[df.ev.values].astype(str)
    df['seaw'] = np.maximum(df.wv, df.ty)
    for d_ in range(1, 7): df['dow%d' % d_] = (df.dow == d_).astype(float)
    return df
CAL = ['dow%d' % d_ for d_ in range(1, 7)] + ['hol']
results = []
def add(model, subset, df, cols):
    df = df.dropna(subset=cols)
    if df.case.sum() < 5: return
    r = ccr.fit(df.ev.values, df.case.values, df[cols].values.astype(float), cluster=df.cl.values, names=cols)
    for t in ccr.table(r):
        col = t['term']; isb = set(np.unique(df[col])) <= {0, 1}
        results.append(dict(model=model, subset=subset, term=col, RR=t['RR'], lo=t['lo'], hi=t['hi'], p=t['p'], n_events=int(r['n_events']),
                            n_strata=r['n_strata'], cases_with=int(df.loc[df.case == 1, col].sum()) if isb else np.nan,
                            ref_share=float(df.loc[df.case == 0, col].mean()) if isb else np.nan))
def dummies(df, col, bins, labels, ref):
    cat = pd.cut(df[col], bins=bins, labels=labels, right=False); names = []
    for lab in labels:
        if lab == ref: continue
        nm = '%s[%s]' % (col, lab); df[nm] = (cat == lab).astype(float); df.loc[cat.isna(), nm] = np.nan; names.append(nm)
    return names
WB = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 99]; WL = ['0-0.5', '0.5-1', '1-1.5', '1.5-2', '2-2.5', '2.5-3', '3-4', '4+']
SB = [0, 4, 6, 8, 10, 12, 14, 17, 99]; SL = ['0-4', '4-6', '6-8', '8-10', '10-12', '12-14', '14-17', '17+']
subsets = [('전체', None)] + [(t, t) for t in TYPES] + [('기상민감4종(전복·침몰·침수·표류)', 'SENS'), ('충돌·접촉', 'TRAF')]
se['is_SENS'] = se.is_전복 | se.is_침몰 | se.is_침수 | se.is_표류
se['is_TRAF'] = se.is_충돌 | se.is_접촉
for mode in ('day', 'time'):
    rows = build(mode)
    tag = '일' if mode == 'day' else '시각'
    whc, wsc = ('wh_max', 'ws_max') if mode == 'day' else ('wh', 'ws')
    print(mode, 'rows', len(rows), 'cases', rows.case.sum(), flush=True)
    for nm, t in subsets:
        sub = rows if t is None else rows[se['is_' + t].values[rows.ev.values]]
        s = sub.copy(); s['any_warn'] = (s.seaw >= 1).astype(float)
        add('S%s_A1_달력' % tag, nm, s.copy(), CAL)
        add('S%s_A2_특보유무(풍랑·태풍)' % tag, nm, s.copy(), ['any_warn'] + CAL)
        s['wv_주의보'] = (s.wv == 1).astype(float); s['wv_경보'] = (s.wv == 2).astype(float)
        s['ty_주의보'] = (s.ty == 1).astype(float); s['ty_경보'] = (s.ty == 2).astype(float)
        add('S%s_A3_특보종류·수준' % tag, nm, s.copy(), ['wv_주의보', 'wv_경보', 'ty_주의보', 'ty_경보'] + CAL)
        s['warn_주의보'] = (s.seaw == 1).astype(float); s['warn_경보'] = (s.seaw == 2).astype(float)
        add('S%s_A3b_특보최고수준' % tag, nm, s.copy(), ['warn_주의보', 'warn_경보'] + CAL)
        nw = sub[sub.seaw == 0]
        q = nw.dropna(subset=[whc]).copy(); wn = dummies(q, whc, WB, WL, '0.5-1')
        add('S%s_B1_특보없는때_파고' % tag, nm, q, wn + CAL)
        q = nw.dropna(subset=[wsc]).copy(); sn = dummies(q, wsc, SB, SL, '4-6')
        add('S%s_B2_특보없는때_풍속' % tag, nm, q, sn + CAL)
        q = nw.dropna(subset=[whc, wsc]).copy(); wn = dummies(q, whc, WB, WL, '0.5-1'); sn = dummies(q, wsc, SB, SL, '4-6')
        add('S%s_B3_특보없는때_파고+풍속' % tag, nm, q, wn + sn + CAL)
        q = nw.dropna(subset=[whc]).copy(); q['wh_per1m'] = q[whc]; add('S%s_B4_특보없는때_파고연속(1m당)' % tag, nm, q, ['wh_per1m'] + CAL)
        q = nw.dropna(subset=[wsc]).copy(); q['ws_per1ms'] = q[wsc]; add('S%s_B5_특보없는때_풍속연속(1m/s당)' % tag, nm, q, ['ws_per1ms'] + CAL)
        ww = sub[sub.seaw >= 1].dropna(subset=[whc]).copy(); wn = dummies(ww, whc, [0, 2, 3, 4, 99], ['<2', '2-3', '3-4', '4+'], '<2')
        add('S%s_C1_특보있는때만_파고' % tag, nm, ww, wn + CAL)
        ww = sub[sub.seaw >= 1].dropna(subset=[wsc]).copy(); sn = dummies(ww, wsc, [0, 10, 14, 17, 99], ['<10', '10-14', '14-17', '17+'], '<10')
        add('S%s_C2_특보있는때만_풍속' % tag, nm, ww, sn + CAL)
        q = sub.dropna(subset=[whc]).copy()
        q['nw_wh_1.5-2'] = ((q.seaw == 0) & (q[whc] >= 1.5) & (q[whc] < 2)).astype(float)
        q['nw_wh_2-3'] = ((q.seaw == 0) & (q[whc] >= 2) & (q[whc] < 3)).astype(float)
        q['nw_wh_3+'] = ((q.seaw == 0) & (q[whc] >= 3)).astype(float)
        q['w_주의보'] = (q.seaw == 1).astype(float); q['w_경보'] = (q.seaw == 2).astype(float)
        add('S%s_C3_축(특보없음 파고구간 vs 특보)' % tag, nm, q, ['nw_wh_1.5-2', 'nw_wh_2-3', 'nw_wh_3+', 'w_주의보', 'w_경보'] + CAL)
        q = sub.dropna(subset=[wsc]).copy()
        q['nw_ws_10-12'] = ((q.seaw == 0) & (q[wsc] >= 10) & (q[wsc] < 12)).astype(float)
        q['nw_ws_12-14'] = ((q.seaw == 0) & (q[wsc] >= 12) & (q[wsc] < 14)).astype(float)
        q['nw_ws_14+'] = ((q.seaw == 0) & (q[wsc] >= 14)).astype(float)
        q['w_주의보'] = (q.seaw == 1).astype(float); q['w_경보'] = (q.seaw == 2).astype(float)
        add('S%s_C4_축(특보없음 풍속구간 vs 특보)' % tag, nm, q, ['nw_ws_10-12', 'nw_ws_12-14', 'nw_ws_14+', 'w_주의보', 'w_경보'] + CAL)
        q = sub.dropna(subset=[whc, wsc]).copy(); nw0 = q.seaw == 0
        for a, b in ((1.0, 1.5), (1.5, 2.0), (2.0, 2.5), (2.5, 99)):
            q['nw_wh_%s-%s' % (a, b)] = (nw0 & (q[whc] >= a) & (q[whc] < b)).astype(float)
        q['w_주의보'] = (q.seaw == 1).astype(float); q['w_경보'] = (q.seaw == 2).astype(float)
        add('S%s_C5_축세분(파고, 기준: 특보없음·1m미만)' % tag, nm, q.copy(), ['nw_wh_1.0-1.5', 'nw_wh_1.5-2.0', 'nw_wh_2.0-2.5', 'nw_wh_2.5-99', 'w_주의보', 'w_경보'] + CAL)
        for a, b in ((8, 10), (10, 12), (12, 14), (14, 99)):
            q['nw_ws_%s-%s' % (a, b)] = (nw0 & (q[wsc] >= a) & (q[wsc] < b)).astype(float)
        add('S%s_C6_축세분(풍속, 기준: 특보없음·8m/s미만)' % tag, nm, q.copy(), ['nw_ws_8-10', 'nw_ws_10-12', 'nw_ws_12-14', 'nw_ws_14-99', 'w_주의보', 'w_경보'] + CAL)
        # 파고·풍속 중 하나라도(최대 등급 틀): 특보 없는데 (파고≥A 또는 풍속≥B)
        for A_, B_ in ((1.5, 10), (2.0, 12), (1.0, 8)):
            q['nw_or_%s_%s' % (A_, B_)] = (nw0 & ((q[whc] >= A_) | (q[wsc] >= B_))).astype(float)
        add('S%s_C7_축(특보없음 & (파고≥1.5 또는 풍속≥10))' % tag, nm, q.copy(), ['nw_or_1.5_10', 'w_주의보', 'w_경보'] + CAL)
        add('S%s_C8_축(특보없음 & (파고≥2 또는 풍속≥12))' % tag, nm, q.copy(), ['nw_or_2.0_12', 'w_주의보', 'w_경보'] + CAL)
    if mode == 'day':
        rows.to_csv(OUT + '/ship_strata_rows_day%s.csv.gz' % ('_ex2025' if EX25 else ''), index=False, compression='gzip')
    pd.DataFrame(results).to_csv(OUT + '/ship_models%s.csv' % ('_ex2025' if EX25 else ''), index=False, encoding='utf-8-sig')
# 월 효과(층 = 사건 × 연)
results_m = []
recs = collections.defaultdict(list)
for k, r in se.iterrows():
    ci = expo.DIDX[r.date]; days = np.where((year == year[ci]) & (np.arange(expo.ND) <= LASTW))[0]
    recs['ev'].append(np.full(len(days), k)); recs['day'].append(days); recs['case'].append((days == ci).astype(np.int8))
ry = pd.DataFrame({c: np.concatenate(v) for c, v in recs.items()})
ry['cl'] = se.sea_zone.values[ry.ev.values] + '_' + year[se.date.map(expo.DIDX).values][ry.ev.values].astype(str)
for m_ in range(2, 13): ry['m%02d' % m_] = (month[ry.day.values] == m_).astype(float)
for d_ in range(1, 7): ry['dow%d' % d_] = (dow[ry.day.values] == d_).astype(float)
ry['hol'] = hol[ry.day.values].astype(float)
results = []
for nm, t in subsets:
    sub = ry if t is None else ry[se['is_' + t].values[ry.ev.values]]
    add('SM_월(기준 1월)+달력', nm, sub.copy(), ['m%02d' % m_ for m_ in range(2, 13)] + CAL)
pd.DataFrame(results).to_csv(OUT + '/ship_month_models%s.csv' % ('_ex2025' if EX25 else ''), index=False, encoding='utf-8-sig')
print('done')
