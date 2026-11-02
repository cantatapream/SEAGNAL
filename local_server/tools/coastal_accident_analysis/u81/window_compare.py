"""사람 점수의 「30일 평균」 창 방향 비교 — 앞으로 30일(현행) / 지난 30일 / 가운데 30일 중 어느 쪽이 사고를 더 잘 설명하나.

왜: 앱의 사람 점수(U81①) = 0.97 × max(0, log2(오늘 집중률 ÷ 30일 기하평균)) 이고, 그 30일은 관광공사 API 가 주는
    「오늘부터 앞으로 30일」 예측값이다. 사용자 질문(2026-10-15): *"30일 평균이라는 거는 앞으로 30일이잖아. 근데 과거 평균이
    근데 이게 과거 데이터도 중요한 거 아니야? 해수욕장에서 1월달 30일 평균과 여름 30일 평균은 다르니까 말이야."*
    → 과거 30일 기준으로도 다시 돌려 비교(사용자 승인).
방법: month_relative.py 의 주 모형 M 과 같은 자료·같은 틀(조건부 포아송 ccr.fit · 층 = 사고 × 그 해 · 군집 = 사고 날짜 ·
      달 11개 + 요일 6 + 공휴일 + 사람 항 1개), 결과변수(전체 사고 · 사망·실종 사고)도 같다. 사람 항의 기준 창만 바꾼다.
        F30  = t..t+29  (그날부터 앞으로 30일 — 현행. month_relative.csv 의 M 과 같아야 한다 — 이 스크립트가 대조한다)
        P30  = t-29..t  (지난 30일, 오늘 포함)      P30x = t-30..t-1 (지난 30일, 오늘 제외)
        C30  = t-15..t+14 (가운데 30일)
      창 안 30일 모두 방문자가 있어야(>0) 평균을 낸다(month_relative.py 의 G30 과 같은 규칙). 창이 자료(2020-01-01~2024-12-31)
      밖으로 나가는 날은 빠진다 → 창마다 표본이 다르다. 그래서 (가) 창마다 자기 표본, (나) 네 창이 모두 정의되는 날만 남긴
      공통 표본 두 가지로 돌린다. 로그우도·AIC 는 (나)에서만 서로 비교할 수 있다(같은 행·같은 모수 개수).
      공통 표본에서는 사람 항 없는 「달만」 모형도 돌려, 사람 항이 보태는 설명력을 함께 본다.
      철 경계: 6/16~30 · 8/16~31 날들에서 log2(오늘 ÷ F30) 와 log2(오늘 ÷ P30) 분포(평균·중앙값·0 넘는 비율)를 비교.
입력(저장소 안 자료만 — 세션 원본이 없어도 돈다):
  <저장소>/local_server/config/coastal_safety/accident_analysis/data/visitors_daily_coastal_sgg_2020_2024.csv.gz
  <저장소>/local_server/config/coastal_safety/accident_analysis/data/accident_features_person_2020_2024.csv.gz
    (13_export.py 가 v1 geo_person.csv 에서 sea_zone 있는 사고만 같은 순서로 내보낸 것. 변사를 빼면 month_relative.py 의 pe 와 같은 집합)
  재현 대조: <저장소>/local_server/config/coastal_safety/accident_analysis/v3/data/u81/month_relative/month_relative.csv
출력(<출력 폴더>, 기본 <저장소>/local_server/config/coastal_safety/accident_analysis/v3/data/u81/window_compare):
  window_models.csv    창 × 표본(자기/공통) × 결과 — 사람 2배당 배수(95% 구간)·로그우도·AIC·ΔAIC·사고 수·행 수
  window_months.csv    같은 모형의 달 점수 12개월(1년 평균 날 = 0, month_relative.py 와 같은 계산)
  window_boundary.csv  철 경계 log2(오늘÷평균) 분포
  repro_check.csv      F30(자기 표본) 이 month_relative.csv 의 M 과 같은지 대조
사용: OMP_NUM_THREADS=1 python3 -I window_compare.py [출력 폴더]   (약 수 분)
"""
import sys, os, collections
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(TOOLS, '..', '..', '..'))
DATA = os.path.join(REPO, 'local_server', 'config', 'coastal_safety', 'accident_analysis', 'data')
U81 = os.path.join(REPO, 'local_server', 'config', 'coastal_safety', 'accident_analysis', 'v3', 'data', 'u81')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(U81, 'window_compare')
sys.path.insert(0, TOOLS)
import expo, ccr

os.makedirs(OUT, exist_ok=True)
dow, hol, month, year = expo.calendar()
v = pd.read_csv(DATA + '/visitors_daily_coastal_sgg_2020_2024.csv.gz', dtype={'sgg': str, 'date': str}); v = v[v.date.isin(expo.DIDX)]
vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
V = np.full((len(vzi), expo.ND), np.nan); V[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v.outsider.values
first, last = expo.DIDX[v.date.min()], expo.DIDX[v.date.max()]
print('방문자 자료', v.date.min(), '~', v.date.max(), '시군구', len(vzi))

WINDOWS = [('F30', '그날부터 앞으로 30일(t..t+29) — 현행', 0, 29), ('P30', '지난 30일, 오늘 포함(t-29..t)', -29, 0),
           ('P30x', '지난 30일, 오늘 제외(t-30..t-1)', -30, -1), ('C30', '가운데 30일(t-15..t+14)', -15, 14)]

def window(a, b):
    """t+a..t+b 창(30일)의 기하평균(0·결측 제외). 자료 범위로 자른 창 안 유효 날 < 30 이면 NaN — month_relative.py window('geo', 30) 과 같은 계산."""
    out = np.full_like(V, np.nan)
    pos = np.where(V > 0, V, np.nan)
    for t in range(first, last + 1):
        lo, hi = max(t + a, first), min(t + b, last)
        w = pos[:, lo:hi + 1]
        n = np.sum(np.isfinite(w), axis=1)
        m = np.exp(np.nanmean(np.log(w), axis=1)) if w.shape[1] else np.nan
        out[:, t] = np.where(n >= 30, m, np.nan)
    return out

import warnings; warnings.filterwarnings('ignore', category=RuntimeWarning)
G = {k: window(a, b) for k, _, a, b in WINDOWS}

pe = pd.read_csv(DATA + '/accident_features_person_2020_2024.csv.gz', dtype={'date': str, 'sgg': str})
# 저장소 내보내기는 v1(변사 포함, 3,331건)이다. v2 분석 입력(geo_person.csv)은 변사를 뺀 것(07_person.py 주석) —
# 변사를 빼면 pid·date·sgg·death·missing·sea_zone·type 이 v2 geo_person.csv(sea_zone 있음 3,075건)와 행 순서까지 같음(2026-10-15 대조).
pe = pe[pe.sea_zone.notna() & (pe.type != '변사')].reset_index(drop=True)
pe['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0)
rec = collections.defaultdict(list)
for k, r in pe.iterrows():
    vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
    if vi is None: continue
    ci = expo.DIDX[r.date]
    if ci > last: continue
    days = np.where(year == year[ci])[0]; days = days[days <= last]
    rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8))
    rec['vo'].append(V[vi, days])
    for w in G: rec['g_' + w].append(G[w][vi, days])
md = pd.DataFrame({c: np.concatenate(x) for c, x in rec.items()})
md['cl'] = pe.date.values[md.ev.values]
mm = month[md.day.values]
MN = ['m%d' % i for i in range(2, 13)]
for i in range(2, 13): md['m%d' % i] = (mm == i).astype(float)
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
for d in range(1, 7): md['dow%d' % d] = (dow[md.day.values] == d).astype(float)
md['hol'] = hol[md.day.values].astype(float)
with np.errstate(divide='ignore', invalid='ignore'):
    for w in G: md['l_' + w] = np.log2(md.vo / md['g_' + w])
md = md.replace([np.inf, -np.inf], np.nan)
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]); W = DAYS / DAYS.sum()
LCOLS = ['l_' + w for w in G]

mrows, rows = [], []
def fit(sample, wname, q, xcol, outcome):
    """조건부 포아송 한 번 — month_relative.py months() 와 같은 열 순서(달 11 · 사람 1 · 달력 7)·같은 달 점수 계산."""
    cols = MN + ([xcol] if xcol else []) + CAL
    r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
    K = len(cols); aic = -2 * r['ll'] + 2 * K
    d = dict(sample=sample, window=wname, outcome=outcome, n_events=int(r['n_events']), n_strata=r['n_strata'], n_rows=r['n_rows'],
             k=K, loglik=r['ll'], AIC=aic, crowd_rr2x=np.nan, crowd_lo=np.nan, crowd_hi=np.nan, crowd_b=np.nan, crowd_se=np.nan)
    if xcol:
        j = cols.index(xcol); b, se = r['b'][j], r['se'][j]
        d.update(crowd_rr2x=np.exp(b), crowd_lo=np.exp(b - 1.96 * se), crowd_hi=np.exp(b + 1.96 * se), crowd_b=b, crowd_se=se)
    mrows.append(d)
    b = np.r_[0.0, r['b'][:11]]; Vm = np.zeros((12, 12)); Vm[1:, 1:] = r['V'][:11, :11]
    for i in range(12):
        c = -W.copy(); c[i] += 1; est = c @ b; se = np.sqrt(c @ Vm @ c)
        n = int(((q.case == 1) & (month[q.day.values] == i + 1)).sum())
        rows.append(dict(sample=sample, window=wname, outcome=outcome, month=i + 1, RR=np.exp(est), lo=np.exp(est - 1.96 * se), hi=np.exp(est + 1.96 * se),
                         score=est / np.log(2), score_lo=(est - 1.96 * se) / np.log(2), score_hi=(est + 1.96 * se) / np.log(2), n_month=n, n_events=int(r['n_events'])))
    print(f"{sample:6s} {wname:5s} {outcome:8s} 사고 {int(r['n_events'])} 행 {r['n_rows']} ll {r['ll']:.3f} AIC {aic:.2f}"
          + (f"  사람 2배당 {d['crowd_rr2x']:.3f} ({d['crowd_lo']:.3f}–{d['crowd_hi']:.3f})" if xcol else ''))

for outcome, mask in (('전체 사고', np.ones(len(pe), bool)), ('사망·실종 사고', pe.fatal.values)):
    base = md[mask[md.ev.values]]
    for w in G: fit('own', w, base.dropna(subset=['l_' + w]), 'l_' + w, outcome)
    qc = base.dropna(subset=LCOLS)
    for w in G: fit('common', w, qc, 'l_' + w, outcome)
    fit('common', 'none', qc, None, outcome)          # 사람 항 없음(달만) — 같은 공통 표본

M = pd.DataFrame(mrows)
M['dAIC_vs_best'] = np.nan
cm = M['sample'] == 'common'
for oc in M.outcome.unique():
    s = cm & (M.outcome == oc); M.loc[s, 'dAIC_vs_best'] = M.loc[s, 'AIC'] - M.loc[s, 'AIC'].min()
M['window_desc'] = M.window.map({k: d for k, d, _, _ in WINDOWS}).fillna('사람 항 없음(달만)')
M.to_csv(OUT + '/window_models.csv', index=False, encoding='utf-8-sig')
pd.DataFrame(rows).to_csv(OUT + '/window_months.csv', index=False, encoding='utf-8-sig')

# 재현 대조: F30(자기 표본) ↔ month_relative.csv 의 M
old = pd.read_csv(U81 + '/month_relative/month_relative.csv'); old = old[old.model.str.startswith('M ')]
new = pd.DataFrame(rows); new = new[(new['sample'] == 'own') & (new.window == 'F30')]
rc = []
for oc in ('전체 사고', '사망·실종 사고'):
    o = old[old.outcome == oc].set_index('month'); n = new[new.outcome == oc].set_index('month')
    mo = M[(M['sample'] == 'own') & (M.window == 'F30') & (M.outcome == oc)].iloc[0]
    rc.append(dict(outcome=oc, n_events_old=int(o.n_events.iloc[0]), n_events_new=int(mo.n_events),
                   crowd_old=o.crowd_rr2x.iloc[0], crowd_new=mo.crowd_rr2x, crowd_absdiff=abs(o.crowd_rr2x.iloc[0] - mo.crowd_rr2x),
                   score_max_absdiff=float(np.max(np.abs(o.score.values - n.score.values))), n_month_same=bool((o.n_month.values == n.n_month.values).all())))
rc = pd.DataFrame(rc); rc.to_csv(OUT + '/repro_check.csv', index=False, encoding='utf-8-sig'); print(rc.to_string())

# 철 경계: 모든 해안 시군구 × 날 / 사고 당일
mo_, dd_ = expo.DATES.month.values, expo.DATES.day.values
PER = [('6월 하순(6/16~30)', (mo_ == 6) & (dd_ >= 16)), ('8월 하순(8/16~31)', (mo_ == 8) & (dd_ >= 16)),
       ('7월 전체', mo_ == 7), ('1월 전체', mo_ == 1), ('1년 전체', np.ones(expo.ND, bool))]
brow = []
with np.errstate(divide='ignore', invalid='ignore'):
    LF, LP = np.log2(V / G['F30']), np.log2(V / G['P30'])
for pname, dm in PER:
    for unit in ('시군구×날 전체', '사고 당일'):
        if unit == '시군구×날 전체':
            sel = np.zeros_like(V, bool); sel[:, dm] = True
            f, p = LF[sel], LP[sel]
        else:
            c = md[(md.case == 1) & dm[md.day.values]]; f, p = c.l_F30.values, c.l_P30.values
        ok = np.isfinite(f) & np.isfinite(p); f, p = f[ok], p[ok]
        if not len(f): continue
        brow.append(dict(period=pname, unit=unit, n=int(len(f)),
                         F30_mean=f.mean(), F30_median=np.median(f), F30_pos_share=(f > 0).mean(), F30_app_points=(0.97 * np.maximum(0, f)).mean(),
                         P30_mean=p.mean(), P30_median=np.median(p), P30_pos_share=(p > 0).mean(), P30_app_points=(0.97 * np.maximum(0, p)).mean(),
                         diff_mean_P_minus_F=(p - f).mean(), corr=np.corrcoef(f, p)[0, 1]))
B = pd.DataFrame(brow); B.to_csv(OUT + '/window_boundary.csv', index=False, encoding='utf-8-sig'); print(B.to_string())
print('written', OUT)
