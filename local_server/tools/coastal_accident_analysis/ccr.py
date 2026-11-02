"""조건부 포아송(= 시간층화 사례교차 conditional logistic) 적합기.
층(stratum) 안에서만 '사고 난 날'과 '안 난 날'을 비교한다 → 장소·연월(또는 연도)이 같으면 상쇄되어 장소·계절 차이가 통제된다.
로그우도: sum_s [ sum_d y_d x_d b - n_s log sum_d exp(x_d b) ],  n_s = sum_d y_d
표준오차: 모형 기반 + 군집 강건(sandwich) 둘 다 계산. 보고는 강건 SE 기준.
"""
import numpy as np

def fit(strat, y, X, cluster=None, names=None, maxit=50, tol=1e-9, ridge=0.0):
    strat = np.asarray(strat); y = np.asarray(y, float); X = np.asarray(X, float)
    o = np.argsort(strat, kind='stable'); strat, y, X = strat[o], y[o], X[o]
    if cluster is not None: cluster = np.asarray(cluster)[o]
    starts = np.r_[0, np.where(np.diff(strat) != 0)[0] + 1]
    seg = np.repeat(np.arange(len(starts)), np.diff(np.r_[starts, len(strat)]))
    ns = np.add.reduceat(y, starts)
    keep_s = ns > 0
    # 정보 없는 층(사건 0) 제거
    keep_r = keep_s[seg]
    strat, y, X, seg = strat[keep_r], y[keep_r], X[keep_r], seg[keep_r]
    if cluster is not None: cluster = cluster[keep_r]
    starts = np.r_[0, np.where(np.diff(seg) != 0)[0] + 1]
    seg = np.repeat(np.arange(len(starts)), np.diff(np.r_[starts, len(seg)]))
    ns = np.add.reduceat(y, starts)
    K = X.shape[1]; b = np.zeros(K)
    def stats(b):
        xb = X @ b
        mx = np.maximum.reduceat(xb, starts)
        e = np.exp(xb - mx[seg])
        se_ = np.add.reduceat(e, starts)
        p = e / se_[seg]
        ll = float(y @ xb - (ns * (np.log(se_) + mx)).sum())
        xbar = np.add.reduceat(p[:, None] * X, starts)          # S x K
        U = np.add.reduceat(y[:, None] * X, starts) - ns[:, None] * xbar   # 층별 점수
        g = U.sum(0)
        # 헤시안: -sum_s n_s [sum_d p x x' - xbar xbar']
        W = p * ns[seg]
        H = -(X.T @ (W[:, None] * X) - (xbar.T * ns) @ xbar)
        return ll, g, H, U
    ll_old = -np.inf
    for it in range(maxit):
        ll, g, H, U = stats(b)
        H_r = H - ridge * np.eye(K)
        try:
            step = np.linalg.solve(H_r, g - ridge * b)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(H_r, g, rcond=None)[0]
        t = 1.0
        while True:
            nb = b - t * step
            nll = stats(nb)[0]
            if nll >= ll - 1e-12 or t < 1e-6: break
            t /= 2
        b = nb
        if abs(nll - ll) < tol: break
    ll, g, H, U = stats(b)
    try:
        Hinv = np.linalg.inv(-H)
    except np.linalg.LinAlgError:
        Hinv = np.linalg.pinv(-H)
    se_m = np.sqrt(np.clip(np.diag(Hinv), 0, None))
    if cluster is not None:
        cl = cluster[starts]
        _, ci = np.unique(cl, return_inverse=True)
        Uc = np.zeros((ci.max() + 1, K)); np.add.at(Uc, ci, U)
        G = Uc.shape[0]
        meat = Uc.T @ Uc * (G / max(G - 1, 1))
    else:
        meat = U.T @ U
    V = Hinv @ meat @ Hinv
    se_r = np.sqrt(np.clip(np.diag(V), 0, None))
    return dict(b=b, se_model=se_m, se=se_r, V=V, ll=ll, n_events=float(ns.sum()), n_strata=len(starts),
                n_rows=len(y), names=names or ['x%d' % i for i in range(K)], iters=it + 1)

def table(res, z=1.96):
    out = []
    for i, n in enumerate(res['names']):
        b, s = res['b'][i], res['se'][i]
        out.append(dict(term=n, RR=np.exp(b), lo=np.exp(b - z * s), hi=np.exp(b + z * s), b=b, se=s, se_model=res['se_model'][i],
                        p=float(2 * (1 - _ncdf(abs(b / s)))) if s > 0 else np.nan))
    return out

def _ncdf(x):
    from math import erf, sqrt
    return 0.5 * (1 + erf(x / sqrt(2)))
