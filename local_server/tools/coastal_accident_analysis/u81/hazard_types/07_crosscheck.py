"""검산: 시군구 고정효과 포아송(본문)과 시군구 묶음 조건부 포아송(statsmodels ConditionalPoisson)의 (a) 계수가 같은가.
사용: python3 -I 07_crosscheck.py <out_dir>
"""
import sys, warnings
import numpy as np, pandas as pd
from statsmodels.discrete.conditional_models import ConditionalPoisson
warnings.simplefilter('ignore')
OUT = sys.argv[1]
sp = pd.read_csv(OUT + '/spots_type_features.csv', dtype={'sgg': str})
tm = pd.read_csv(OUT + '/type_models.csv')
rows = []
for y in ['n_2023_24', 'n_all', 'n_fatal']:
    X = sp[['risk_any', 'fatal_any', 'freq_any', 'log_coast']].astype(float)
    m = ConditionalPoisson(sp[y].values, X.values, groups=sp.sgg.values).fit(disp=0)
    for i, t in enumerate(['risk_any', 'fatal_any', 'freq_any']):
        fe = tm[(tm.outcome == y) & (tm.model == 'a 종류별 있음 3개') & (tm.term == t)].RR.iloc[0]
        rows.append(dict(outcome=y, term=t, RR_fe_poisson=fe, RR_conditional=float(np.exp(m.params[i])), abs_diff=abs(fe - float(np.exp(m.params[i])))))
r = pd.DataFrame(rows); r.to_csv(OUT + '/crosscheck_conditional.csv', index=False, encoding='utf-8-sig')
print(r.round(4).to_string(index=False)); print('max abs diff', r.abs_diff.max())
