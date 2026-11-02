"""특보 상당 표 — 전체 날짜판(v3, 독립검증 B 지적).
14_warn_equiv.py 는 '사고가 난 달의 날'만 모아 표를 만들었다(층 행에서 뽑았기 때문). 그러면 사람이 많이 나가는 계절이 더 많이 들어간다.
여기서는 같은 (연안 앞바다 해상특보구역, 대해구) 쌍에 대해 2020-01-02~2025-12-28 **모든 날짜**로 같은 표를 다시 만든다.
해구 값 = KST 일 최대(wh_max·ws_max), 특보 = 그 날과 조금이라도 겹친 풍랑·태풍 최고 수준(앱 levelOnDay 와 같은 규칙).
사용: python3 -I 14b_warn_equiv_alldays.py <data_dir> <results_dir>
"""
import sys, os
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo
D, R = sys.argv[1:3]
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz', usecols=['ev'])
pr = pd.read_csv(R + '/person_strata_rows.csv.gz', usecols=['ev'])
pe = pd.read_csv(D + '/geo_person.csv'); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
se = pd.read_csv(D + '/geo_ship.csv'); se = se[se.sea_zone.notna()].reset_index(drop=True)
pairs = set(zip(se.sea_zone.values[sr.ev.unique()], se.mzone.values[sr.ev.unique()])) | set(zip(pe.sea_zone.values[pr.ev.unique()], pe.mzone.values[pr.ev.unique()]))
pairs = sorted((z, int(m)) for z, m in pairs if str(z).endswith('앞바다'))
ex = expo.load_exact(D + '/warn_intervals_exact.json')
W = expo.daily_warn(ex, sorted({expo.norm(z) for z, _ in pairs}), types=('TY', 'WV'))
mzi, M = expo.load_marine_daily(D + '/marine_daily.csv.gz')
last = expo.DIDX['20251228']
rows = []
for z, m in pairs:
    if m not in mzi: continue
    zz = expo.norm(z); seaw = np.maximum(W[zz]['WV']['lvl'], W[zz]['TY']['lvl'])[:last + 1]
    wh = M['wh_max'][mzi[m], :last + 1]; ws = M['ws_max'][mzi[m], :last + 1]
    ok = ~np.isnan(wh) & ~np.isnan(ws)
    rows.append(pd.DataFrame(dict(zone=z, mz=m, seaw=seaw[ok], wh_max=wh[ok], ws_max=ws[ok])))
u = pd.concat(rows)
print('zone-mz-days', len(u), 'zones', u.zone.nunique(), 'pairs', len(pairs))
out = []
for col, edges in (('wh_max', [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 99]), ('ws_max', [0, 6, 8, 10, 12, 14, 17, 99])):
    c = pd.cut(u[col], edges, right=False)
    g = u.groupby(c, observed=True).agg(n=('seaw', 'size'), p_any=('seaw', lambda s: (s >= 1).mean()), p_경보=('seaw', lambda s: (s == 2).mean()))
    g['var'] = col; out.append(g.reset_index().rename(columns={col: 'bin'}))
nw, nk = (u.seaw >= 1).sum(), (u.seaw == 2).sum()
for A, B_ in ((1.5, 10), (2.0, 12), (2.5, 14), (3.0, 14), (3.0, 17), (4.0, 17)):
    m = (u.wh_max >= A) | (u.ws_max >= B_)
    out.append(pd.DataFrame([dict(bin='파고≥%s 또는 풍속≥%s' % (A, B_), n=int(m.sum()), p_any=(u.seaw[m] >= 1).mean(), p_경보=(u.seaw[m] == 2).mean(),
                                  share_of_warn_days_caught=((u.seaw >= 1) & m).sum() / nw, share_of_경보_days_caught=((u.seaw == 2) & m).sum() / nk, var='OR')]))
res = pd.concat(out); res.to_csv(R + '/warning_equivalence_alldays.csv', index=False, encoding='utf-8-sig')
with open(R + '/warning_equivalence_alldays.md', 'w') as f:
    f.write('#### 해구 예측 일 최대값과 실제 특보 — 전체 날짜(연안 앞바다 구역×대해구×날짜, 2020-01-02~2025-12-28)\n\n')
    f.write('| 구간 | 구역-일 수 | 특보(주의보 이상) 비율 | 경보 비율 | 실제 특보일 중 이 조건이 잡는 비율 | 실제 경보일 중 이 조건이 잡는 비율 |\n|---|---|---|---|---|---|\n')
    for _, r in res.iterrows():
        nm = {'wh_max': '파고 ', 'ws_max': '풍속 ', 'OR': ''}[r['var']] + str(r['bin'])
        a = '' if pd.isna(r.get('share_of_warn_days_caught')) else '%.1f%%' % (100 * r.share_of_warn_days_caught)
        b = '' if pd.isna(r.get('share_of_경보_days_caught')) else '%.1f%%' % (100 * r.share_of_경보_days_caught)
        f.write('| %s | %d | %.1f%% | %.1f%% | %s | %s |\n' % (nm, r.n, 100 * r.p_any, 100 * r.p_경보, a, b))
    f.write('\n(전체 구역-일 %d · 그중 특보일 %d · 경보일 %d)\n' % (len(u), nw, nk))
print(open(R + '/warning_equivalence_alldays.md').read())
