"""민감도: 이웃 관광지는 같은 위험구역을 함께 세므로 서로 독립이 아니다. 표준오차를 시군구 군집 강건(60개 군집)으로 바꿔
주요 모형의 구간과 '세 종류가 같은가' 검정을 다시 본다. 또 음이항(과산포 허용) 회귀로 점추정이 흔들리는지 본다.
사용: python3 -I 04_sensitivity.py <out_dir>
"""
import sys
import numpy as np, pandas as pd, statsmodels.api as sm
from scipy.stats import chi2
OUT = sys.argv[1]
sp = pd.read_csv(OUT + '/spots_type_features.csv', dtype={'sgg': str})
FE = pd.get_dummies(sp.sgg, prefix='sgg', drop_first=True, dtype=float)
grp = pd.factorize(sp.sgg)[0]
MODELS = {'a 종류별 있음 3개': ['risk_any', 'fatal_any', 'freq_any'],
          'b3 종류별 log2(min(개수,3)+1) 3개': ['risk_l2c3', 'fatal_l2c3', 'freq_l2c3'],
          'A1 출발안 구간 + 사망구역 있음': None}
def X_of(terms):
    if terms is None:
        B = pd.get_dummies(sp.bin_start, prefix='bin_start', dtype=float).drop(columns='bin_start_0')
        parts = [B, sp[['fatal_any']].astype(float)]
    else:
        parts = [sp[terms].astype(float)]
    return sm.add_constant(pd.concat(parts + [sp[['log_coast']], FE], axis=1))
def wald(m, names):
    b = m.params; V = m.cov_params(); C = np.zeros((2, len(b)))
    for i in range(2): C[i, b.index.get_loc(names[i])] = 1; C[i, b.index.get_loc(names[2])] = -1
    d = C @ b.values; x = float(d @ np.linalg.solve(C @ V.values @ C.T, d)); return x, float(chi2.sf(x, 2))
rows, eq = [], []
for y in ['n_2023_24', 'n_all', 'n_fatal', 'n_fatal_2023_24']:
    for nm, terms in MODELS.items():
        X = X_of(terms)
        fits = {'HC1(본문)': sm.GLM(sp[y], X, family=sm.families.Poisson()).fit(cov_type='HC1'),
                '시군구 군집': sm.GLM(sp[y], X, family=sm.families.Poisson()).fit(cov_type='cluster', cov_kwds={'groups': grp})}
        # 음이항: 과산포 모수 alpha 를 최우추정으로 잡고(NB2), 그 alpha 로 GLM 을 적합해 HC1 표준오차
        try:
            nb = sm.NegativeBinomial(sp[y], X).fit(disp=0, maxiter=300, method='bfgs')
            alpha = float(nb.params['alpha'])
            fits['음이항'] = sm.GLM(sp[y], X, family=sm.families.NegativeBinomial(alpha=alpha)).fit(cov_type='HC1')
        except Exception as e:
            print('NB fail', y, nm, e)
        alpha_ = alpha if '음이항' in fits else np.nan
        for se, m in fits.items():
            names = [c for c in X.columns if not (c.startswith('sgg_') or c in ('const', 'log_coast'))]
            for c in names:
                b, s = m.params[c], m.bse[c]
                rows.append(dict(outcome=y, model=nm, se=se, nb_alpha=alpha_ if se == '음이항' else np.nan, term=c, RR=np.exp(b), lo=np.exp(b - 1.96 * s), hi=np.exp(b + 1.96 * s)))
            if terms is not None:
                x, p = wald(m, terms); eq.append(dict(outcome=y, model=nm, se=se, nb_alpha=alpha_ if se == '음이항' else np.nan, chi2=x, p=p))
res = pd.DataFrame(rows); res.to_csv(OUT + '/sensitivity_se.csv', index=False, encoding='utf-8-sig')
eqd = pd.DataFrame(eq); eqd.to_csv(OUT + '/sensitivity_equality.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 250)
res['s'] = res.apply(lambda r: '%.2f (%.2f–%.2f)' % (r.RR, r.lo, r.hi), axis=1)
print(res.pivot_table(index=['outcome', 'model', 'term'], columns='se', values='s', aggfunc='first').to_string())
print(eqd.round(4).to_string(index=False))
