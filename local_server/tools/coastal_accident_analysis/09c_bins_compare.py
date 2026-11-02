"""위험구역 개수 구간 대안 비교(관광지 단위, 시군구 고정효과 + 해안선 길이 보정, 포아송 강건 SE).
사용: python3 -I 09c_bins_compare.py <results_dir>
"""
import sys
import numpy as np, pandas as pd, statsmodels.api as sm
R = sys.argv[1]
sp = pd.read_csv(R + '/spots_with_counts.csv', dtype={'sgg': str})
schemes = {'출발안 0/1-2/3-5/6+': ([0, 1, 3, 6, 999], ['0', '1-2', '3-5', '6+']),
           '대안A 0/1/2-5/6+': ([0, 1, 2, 6, 999], ['0', '1', '2-5', '6+']),
           '대안B 0/1-3/4-8/9+': ([0, 1, 4, 9, 999], ['0', '1-3', '4-8', '9+']),
           '대안C 0/1-2/3-7/8+': ([0, 1, 3, 8, 999], ['0', '1-2', '3-7', '8+'])}
rows = []
for nm, (e, l) in schemes.items():
    b = pd.cut(sp.hz_all_3km, e, labels=l, right=False).astype(str)
    for y in ('n_all', 'n_2023_24'):
        X = pd.get_dummies(b, prefix='b', dtype=float).drop(columns='b_0')
        X = sm.add_constant(pd.concat([X, sp[['log_coast']], pd.get_dummies(sp.sgg, prefix='s', drop_first=True, dtype=float)], axis=1))
        m = sm.GLM(sp[y], X, family=sm.families.Poisson()).fit(cov_type='HC1')
        rr = ['%s %.2f(%.2f-%.2f)' % (c[2:], np.exp(m.params[c]), np.exp(m.params[c] - 1.96 * m.bse[c]), np.exp(m.params[c] + 1.96 * m.bse[c])) for c in X.columns if c.startswith('b_')]
        n = b.value_counts().reindex(l).tolist()
        rows.append(dict(scheme=nm, outcome=y, spots_per_bin=n, RR=' / '.join(rr), deviance=round(m.deviance, 1), aic=round(m.aic, 1)))
res = pd.DataFrame(rows); res.to_csv(R + '/spot_bins_compare.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 250); pd.set_option('display.max_colwidth', 200); print(res.to_string(index=False))
