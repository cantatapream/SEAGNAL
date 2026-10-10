# 모의자료로 적합기 검증: 장소마다 기본율이 다르고 계절성이 있을 때, 노출의 참 RR=1.8, 요일 RR=1.3 을 되찾는지
import numpy as np, sys
sys.path.insert(0, sys.argv[1])
import ccr
rng = np.random.default_rng(0)
U, Dn = 400, 365 * 3
base = rng.lognormal(-4.5, 1.0, U)
days = np.arange(Dn); month = (days // 30) % 12; season = 1 + 0.8 * np.sin(2 * np.pi * days / 365)
x = rng.random((U, Dn)) < 0.15
wk = (days % 7) >= 5
lam = base[:, None] * season[None, :] * np.where(x, 1.8, 1.0) * np.where(wk, 1.3, 1.0)[None, :]
y = rng.poisson(lam)
# 층 = 장소 x (연,월)
ym = days // 30
S, Y, X, C = [], [], [], []
for u in range(U):
    S.append(u * 1000 + ym); Y.append(y[u]); X.append(np.c_[x[u], wk]); C.append(np.full(Dn, u))
S = np.concatenate(S); Y = np.concatenate(Y); X = np.vstack(X).astype(float); C = np.concatenate(C)
r = ccr.fit(S, Y, X, cluster=C, names=['x', 'weekend'])
for t in ccr.table(r): print(t['term'], round(t['RR'], 3), round(t['lo'], 3), round(t['hi'], 3))
print('events', r['n_events'], 'strata', r['n_strata'])
# 비교: statsmodels ConditionalPoisson
from statsmodels.discrete.conditional_models import ConditionalPoisson
keep = np.isin(S, np.unique(S[Y > 0]))
m = ConditionalPoisson(Y[keep], X[keep], groups=S[keep]).fit()
print('statsmodels', np.exp(m.params), m.bse, 'ours se_model', r['se_model'])
