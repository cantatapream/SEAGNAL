"""달(1~12월) 점수 재추정 — 사람 점수가 「이 관광지의 30일 평균 대비 오늘」(상대값)으로 바뀐 뒤(2026-10-15 사용자 승인 ④).

왜: 지금 달 점수(risk_points.js MONTHS)는 외지인 방문자 **절대값**(log2)을 함께 넣고 잰 「남은 몫」이다.
    사람 점수가 상대값(0.97 × max(0, log2(오늘 ÷ 30일 기하평균)))이 되면 계절 붐빔 몫이 사람 점수에서 빠지므로,
    달 점수가 그 몫을 다시 담아야 한다.
방법(28_fatal_points.py 의 달 칸과 같은 틀, 노출 항만 바꿈):
  층 = 사고 × 그 해(같은 시군구의 1년 안 날짜끼리 비교) · 군집 = 사고 날짜 · 요일·공휴일 보정 ·
  노출 = log2(그날 외지인 방문자 ÷ 그날부터 30일(t..t+29)의 기하평균) — 앱이 쓰는 집중률 API 의 창(오늘부터 30일)과 같은 방향.
  기준 = 1년 평균 날(달마다 배수를 날 수로 가중한 기하평균), 점수 = log2(배수).
  결과: 전체 사고 · 사망·실종 사고(사망 또는 실종 1명 이상).
민감도: (S1) 산술평균 창 = 앞선 적대 검토 sim_baseline.py 재현 (S2) 노출 기울기를 앱 값(0.97)으로 고정(offset)
        (S3) 노출을 앱처럼 0 아래 자름(max(0,·)) (S4) 창이 자료 밖으로 나가는 2024-12 하순도 15일 이상이면 넣음.
사용: python3 -I month_relative.py <저장소 local_server/tools/coastal_accident_analysis> <analysis_v3/data> <출력 폴더>
"""
import sys, os, collections
import numpy as np, pandas as pd
TOOLS, D, OUT = sys.argv[1:4]
sys.path.insert(0, TOOLS)
import expo, ccr

os.makedirs(OUT, exist_ok=True)
dow, hol, month, year = expo.calendar()
v = pd.read_csv(D + '/visitors_daily_coastal.csv.gz', dtype={'sgg': str, 'date': str}); v = v[v.date.isin(expo.DIDX)]
vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
V = np.full((len(vzi), expo.ND), np.nan); V[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v.outsider.values
last = expo.DIDX[v.date.max()]            # 방문자 자료 마지막 날(2024-12-31)

def window(kind, min_days):
    """t..t+29 창의 평균. kind='geo'(0·결측 제외 기하평균) | 'ari'(산술). 창 안 유효 날 수 < min_days 면 NaN."""
    out = np.full_like(V, np.nan)
    pos = np.where(V > 0, V, np.nan)
    for t in range(0, last + 1):
        w = pos[:, t:min(t + 30, last + 1)]
        n = np.sum(np.isfinite(w), axis=1)
        if kind == 'geo': m = np.exp(np.nanmean(np.log(w), axis=1)) if w.shape[1] else np.nan
        else: m = np.nanmean(w, axis=1)
        out[:, t] = np.where(n >= min_days, m, np.nan)
    return out

G30 = window('geo', 30); A30 = window('ari', 30); G15 = window('geo', 15)

pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0)
rec = collections.defaultdict(list)
for k, r in pe.iterrows():
    vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
    if vi is None: continue
    ci = expo.DIDX[r.date]
    if ci > last: continue
    days = np.where(year == year[ci])[0]; days = days[days <= last]
    rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8))
    for nm, arr in (('vo', V), ('g30', G30), ('a30', A30), ('g15', G15)): rec[nm].append(arr[vi, days])
md = pd.DataFrame({c: np.concatenate(x) for c, x in rec.items()})
md['cl'] = pe.date.values[md.ev.values]
mm = month[md.day.values]
MN = ['m%d' % i for i in range(2, 13)]
for i in range(2, 13): md['m%d' % i] = (mm == i).astype(float)
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
for d in range(1, 7): md['dow%d' % d] = (dow[md.day.values] == d).astype(float)
md['hol'] = hol[md.day.values].astype(float)
with np.errstate(divide='ignore', invalid='ignore'):
    md['lv'] = np.log2(md.vo)
    md['lg'] = np.log2(md.vo / md.g30); md['la'] = np.log2(md.vo / md.a30); md['lg15'] = np.log2(md.vo / md.g15)
md['lgc'] = md.lg.clip(lower=0)
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]); W = DAYS / DAYS.sum()

def fit_offset(q, cols, off):
    """노출 기울기를 고정한 조건부 포아송(ccr.fit 과 같은 뉴턴법·군집 강건 SE, xb 에 offset 을 더함 — ccr.fit 에 offset 인자가 없어서)."""
    strat = q.ev.values; y = q.case.values.astype(float); X = q[cols].values.astype(float); o_ = q[off].values.astype(float)
    o = np.argsort(strat, kind='stable'); strat, y, X, o_ = strat[o], y[o], X[o], o_[o]; cl = q.cl.values[o]
    starts = np.r_[0, np.where(np.diff(strat) != 0)[0] + 1]
    seg = np.repeat(np.arange(len(starts)), np.diff(np.r_[starts, len(strat)]))
    ns = np.add.reduceat(y, starts); K = X.shape[1]; b = np.zeros(K)
    def stats(b):
        xb = X @ b + o_; mx = np.maximum.reduceat(xb, starts); e = np.exp(xb - mx[seg]); se_ = np.add.reduceat(e, starts); p = e / se_[seg]
        ll = float(y @ xb - (ns * (np.log(se_) + mx)).sum())
        xbar = np.add.reduceat(p[:, None] * X, starts); U = np.add.reduceat(y[:, None] * X, starts) - ns[:, None] * xbar
        Wt = p * ns[seg]; H = -(X.T @ (Wt[:, None] * X) - (xbar.T * ns) @ xbar)
        return ll, U.sum(0), H, U
    for _ in range(50):
        ll, g, H, U = stats(b); step = np.linalg.solve(H, g); t = 1.0
        while True:
            nb = b - t * step; nll = stats(nb)[0]
            if nll >= ll - 1e-12 or t < 1e-6: break
            t /= 2
        b = nb
        if abs(nll - ll) < 1e-9: break
    ll, g, H, U = stats(b); Hinv = np.linalg.inv(-H)
    _, ci = np.unique(cl[starts], return_inverse=True); Uc = np.zeros((ci.max() + 1, K)); np.add.at(Uc, ci, U); G = Uc.shape[0]
    Vr = Hinv @ (Uc.T @ Uc * (G / (G - 1))) @ Hinv
    return dict(b=b, V=Vr, ll=ll, n_events=float(ns.sum()), names=cols)

rows = []
def months(label, q, expo_col, outcome, offset=False):
    cols = MN + ([expo_col] if expo_col and not offset else []) + CAL
    if offset:
        q = q.copy(); q['off'] = np.log(1.96) * q[expo_col]       # 사고 배수 1.96 per 2배(=앱 0.97점)를 자연로그 기울기로
        r = fit_offset(q, cols, 'off')
    else:
        r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
    b = np.r_[0.0, r['b'][:11]]; Vm = np.zeros((12, 12)); Vm[1:, 1:] = r['V'][:11, :11]
    beta = None
    if expo_col and not offset:
        j = cols.index(expo_col); beta = (np.exp(r['b'][j]), np.exp(r['b'][j] - 1.96 * np.sqrt(r['V'][j, j])), np.exp(r['b'][j] + 1.96 * np.sqrt(r['V'][j, j])))
    for i in range(12):
        c = -W.copy(); c[i] += 1; est = c @ b; se = np.sqrt(c @ Vm @ c)
        n = int(((q.case == 1) & (month[q.day.values] == i + 1)).sum())
        rows.append(dict(model=label, outcome=outcome, month=i + 1, RR=np.exp(est), lo=np.exp(est - 1.96 * se), hi=np.exp(est + 1.96 * se),
                         score=est / np.log(2), score_lo=(est - 1.96 * se) / np.log(2), score_hi=(est + 1.96 * se) / np.log(2), n_month=n,
                         n_events=int(r['n_events']), crowd_rr2x=beta[0] if beta else np.nan, crowd_lo=beta[1] if beta else np.nan, crowd_hi=beta[2] if beta else np.nan))
    print(f"{label:44s} {outcome:8s} 사고 {int(r['n_events'])}" + (f"  사람 2배당 {beta[0]:.2f} ({beta[1]:.2f}–{beta[2]:.2f})" if beta else ''))

for outcome, mask in (('전체 사고', np.ones(len(pe), bool)), ('사망·실종 사고', pe.fatal.values)):
    base = md[mask[md.ev.values]]
    # 지금 앱 달 점수 재현(외지인 절대값 log2) — 같은 사고 집합(방문자 >0)
    months('R0 지금 앱 방식(절대 방문자 log2) 재현', base[base.vo > 0].replace([np.inf, -np.inf], np.nan).dropna(subset=['lv']), 'lv', outcome)
    q = base.replace([np.inf, -np.inf], np.nan).dropna(subset=['lg'])
    months('M 주: log2(오늘÷30일 기하평균) 함께', q, 'lg', outcome)
    qa = base.replace([np.inf, -np.inf], np.nan).dropna(subset=['la'])
    months('S1 log2(오늘÷30일 산술평균) — 적대검토 재현', qa, 'la', outcome)
    months('S2 기울기 앱 값 고정(0.97점/2배, offset)', q, 'lg', outcome, offset=True)
    months('S3 노출을 0 아래 자름(앱처럼 max(0,·))', q, 'lgc', outcome)
    q15 = base.replace([np.inf, -np.inf], np.nan).dropna(subset=['lg15'])
    months('S4 창 15일 이상이면 포함(2024-12 하순 포함)', q15, 'lg15', outcome)
    months('S5 달만(사람 항 없음) — 같은 사고 집합', q, None, outcome)

res = pd.DataFrame(rows); res.to_csv(OUT + '/month_relative.csv', index=False, encoding='utf-8-sig')
print('written', OUT + '/month_relative.csv', len(res))
