"""해구 예측값(일 최대 파고·풍속)이 어느 수준일 때 실제 풍랑·태풍특보가 떠 있었나 — 앱의 2~3일째(특보 정보 없음)
'특보 상당' 등급을 파고·풍속으로 정할 때의 근거. 단위: (해상특보구역, 그 구역에 붙은 대해구, 날짜). 연안 앞바다 구역의 사고에 쓰인 대해구 조합만.
사용: python3 -I 14_warn_equiv.py <results_dir>
"""
import sys
import numpy as np, pandas as pd
R = sys.argv[1]
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz')
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
pe = pd.read_csv(R + '/../data/geo_person.csv'); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
se = pd.read_csv(R + '/../data/geo_ship.csv'); se = se[se.sea_zone.notna()].reset_index(drop=True)
a = sr[['ev', 'day', 'seaw', 'wh_max', 'ws_max']].copy(); a['zone'] = se.sea_zone.values[a.ev.values]; a['mz'] = se.mzone.values[a.ev.values]
b = pr[['ev', 'day', 'seaw', 'wh_max', 'ws_max']].copy(); b['zone'] = pe.sea_zone.values[b.ev.values]; b['mz'] = pe.mzone.values[b.ev.values]
u = pd.concat([a, b]).drop_duplicates(['zone', 'mz', 'day']).dropna(subset=['wh_max', 'ws_max'])
u = u[u.zone.str.endswith('앞바다')]
print('zone-mz-days', len(u), 'zones', u.zone.nunique())
out = []
for col, edges in (('wh_max', [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 99]), ('ws_max', [0, 6, 8, 10, 12, 14, 17, 99])):
    c = pd.cut(u[col], edges, right=False)
    g = u.groupby(c, observed=True).agg(n=('seaw', 'size'), p_any=('seaw', lambda s: (s >= 1).mean()), p_경보=('seaw', lambda s: (s == 2).mean()))
    g['var'] = col; out.append(g.reset_index().rename(columns={col: 'bin'}))
# 둘 중 하나 조건
for A, B in ((1.5, 10), (2.0, 12), (2.5, 14), (3.0, 14), (3.0, 17), (4.0, 17)):
    m = (u.wh_max >= A) | (u.ws_max >= B)
    out.append(pd.DataFrame([dict(bin='파고≥%s 또는 풍속≥%s' % (A, B), n=int(m.sum()), p_any=(u.seaw[m] >= 1).mean(), p_경보=(u.seaw[m] == 2).mean(),
                                  share_of_warn_days_caught=((u.seaw >= 1) & m).sum() / (u.seaw >= 1).sum(), var='OR')]))
res = pd.concat(out); res.to_csv(R + '/warning_equivalence.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 200); print(res.round(3).to_string(index=False))
