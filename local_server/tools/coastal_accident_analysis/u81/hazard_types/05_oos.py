"""표본 밖 확인: 점수표의 '모양'(어느 구간·종류에 얼마)을 2020~22(지정 전) 사고로 정하고, 2023~24(지정 후) 사고에 맞춰 본다.
2023~24 에서는 모양을 고정하고 크기(기울기) 하나만 추정한다 — 모든 점수표가 같은 개수(1개)의 모수로 비교된다.
기울기 < 1 이면 2020~22 에서 정한 무게가 2023~24 에는 부풀어 있었다는 뜻(순환성과 같은 방향).
사용: python3 -I 05_oos.py <out_dir>
"""
import sys
import numpy as np, pandas as pd, statsmodels.api as sm
OUT = sys.argv[1]
sp = pd.read_csv(OUT + '/spots_type_features.csv', dtype={'sgg': str})
FE = pd.get_dummies(sp.sgg, prefix='sgg', drop_first=True, dtype=float)
def design(terms):
    parts = []
    for t in terms:
        if t.endswith('_b') or t == 'bin_start':
            X = pd.get_dummies(sp[t], prefix=t, dtype=float); parts.append(X.drop(columns=t + '_0'))
        else:
            parts.append(sp[[t]].astype(float))
    return pd.concat(parts, axis=1)
def fit(y, Xs):
    X = sm.add_constant(pd.concat([Xs, sp[['log_coast']], FE], axis=1))
    return sm.GLM(sp[y], X, family=sm.families.Poisson()).fit(cov_type='HC1')
S = [('지금 구조: 구간 + 사망 있음(A1)', ['bin_start', 'fatal_any']),
     ('구간만(A0)', ['bin_start']),
     ('전체 log2(개수+1)(L0)', ['all_l2']),
     ('종류별 있음 3개(a)', ['risk_any', 'fatal_any', 'freq_any']),
     ('있는 종류 수(a=)', ['types_present']),
     ('후보 B: 종류별 무게·3곳 멈춤(b3)', ['risk_l2c3', 'fatal_l2c3', 'freq_l2c3']),
     ('후보 A: 종류 같은 무게·3곳 멈춤(b3=)', ['l2c3sum']),
     ('종류별 무게·멈춤 없음(b2)', ['risk_l2', 'fatal_l2', 'freq_l2']),
     ('종류 같은 무게·멈춤 없음(b2=)', ['l2sum'])]
rows = []
for train, test in (('n_2020_22', 'n_2023_24'), ('n_fatal_2020_22', 'n_fatal_2023_24')):
    for nm, terms in S:
        Xs = design(terms)
        m1 = fit(train, Xs)
        score = Xs.values @ m1.params[Xs.columns].values      # 2020~22 에서 정한 모양(자연로그 배수)
        m2 = fit(test, pd.DataFrame({'score': score}))
        b, s = m2.params['score'], m2.bse['score']
        rows.append(dict(train=train, test=test, structure=nm, train_params=Xs.shape[1], slope=b, slope_lo=b - 1.96 * s, slope_hi=b + 1.96 * s,
                         test_loglik=m2.llf, test_aic=m2.aic))
res = pd.DataFrame(rows)
res['d_test_aic'] = res.test_aic - res.groupby('test').test_aic.transform('min')
res.to_csv(OUT + '/oos_2020_22_to_2023_24.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 250)
print(res.round(3).to_string(index=False))
