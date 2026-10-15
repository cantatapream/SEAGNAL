"""점수표 후보(A안: 점수 = log2 배수)와 지금 앱 점수표 비교 — 관광지별 장소 점수가 어떻게 바뀌나.
지금 앱: risk_score.js — 전체 개수 0/1-2/3-5/6+ → 0/.70/1.24/1.74(risk_points.js HAZARDS) + 사망사고 발생구역 1곳 이상 +.37(COAST.fatalScore).
후보는 모두 01_type_models.py 의 2023~24(지정 이후) 적합값에서 만든다.
  후보 A = b3= (종류 같은 무게, 종류마다 3곳에서 멈춤) · 후보 B = b3 (종류별 무게, 3곳에서 멈춤)
  참고 = A1(지금 구조 그대로, 구간과 사망 가산을 한 모형에서 함께 추정) · b2=/b2(멈춤 없음)
사용: python3 -I 03_scores.py <out_dir>
"""
import sys
import numpy as np, pandas as pd, statsmodels.api as sm
OUT = sys.argv[1]
sp = pd.read_csv(OUT + '/spots_type_features.csv', dtype={'sgg': str})
tm = pd.read_csv(OUT + '/type_models.csv'); mc = pd.read_csv(OUT + '/model_compare.csv')
Y = 'n_2023_24'
def coef(model, term):
    r = tm[(tm.outcome == Y) & (tm.model == model) & (tm.term == term)]
    assert len(r) == 1, (model, term); return float(np.log2(r.iloc[0].RR))
A1 = 'A1 출발안 구간 + 사망구역 있음(§4.6)'
B2, B2E = 'b2 종류별 log2(개수+1) 3개', 'b2= 종류별 log2(개수+1) 같은 무게'
B3, B3E = 'b3 종류별 log2(min(개수,3)+1) 3개', 'b3= 종류별 log2(min(개수,3)+1) 같은 무게'
APPM = 'APP 앱 점수 고정(0/.70/1.24/1.74 + 사망 .37)'
TY = ['risk', 'fatal', 'freq']
w3e = coef(B3E, 'l2c3sum'); w3 = {t: coef(B3, t + '_l2c3') for t in TY}
w2e = coef(B2E, 'l2sum'); w2 = {t: coef(B2, t + '_l2') for t in TY}
a1 = {b: coef(A1, 'bin_start_' + b) for b in ['1-2', '3-5', '6+']}; a1f = coef(A1, 'fatal_any_start')
L0 = 'L0 전체 log2(개수+1)'; wl0 = coef(L0, 'all_l2')
APP = {'0': 0, '1-2': .70, '3-5': 1.24, '6+': 1.74}
sp['s_app'] = sp.bin_start.map(APP) + .37 * (sp.hz_fatal_3km > 0)
sp['s_a1'] = sp.bin_start.map({'0': 0, **a1}) + a1f * (sp.hz_fatal_3km > 0)
sp['s_candA'] = w3e * sp.l2c3sum
sp['s_candB'] = sum(w3[t] * sp[t + '_l2c3'] for t in TY)
sp['s_b2e'] = w2e * sp.l2sum
sp['s_L0'] = wl0 * sp.all_l2
sp['s_b2'] = sum(w2[t] * sp[t + '_l2'] for t in TY)

# ① 점수표: 한 종류가 n곳일 때 그 종류 몫 점수
rows = []
for n in range(0, 9):
    l3 = np.log2(min(n, 3) + 1); l = np.log2(n + 1)
    rows.append(dict(n_zones=n, candA=w3e * l3, candB_risk=w3['risk'] * l3, candB_fatal=w3['fatal'] * l3, candB_freq=w3['freq'] * l3,
                     ref_b2e=w2e * l, ref_b2_risk=w2['risk'] * l, ref_b2_fatal=w2['fatal'] * l, ref_b2_freq=w2['freq'] * l))
tab = pd.DataFrame(rows); tab.to_csv(OUT + '/score_tables.csv', index=False, encoding='utf-8-sig')
# 참고: 종류 구분 없이 전체 개수를 매끄럽게(L0) — 전체 n곳일 때 장소 점수
pd.DataFrame([dict(n_total=n, L0=wl0 * np.log2(n + 1), app=APP['0' if n == 0 else '1-2' if n <= 2 else '3-5' if n <= 5 else '6+']) for n in [0, 1, 2, 3, 4, 5, 6, 8, 10, 14]]).to_csv(
    OUT + '/score_table_L0.csv', index=False, encoding='utf-8-sig')

# ② 자료 적합(2023~24): 점수 숫자를 이 자료에서 추정한 개수까지 모수로 센 AIC
m = mc[mc.outcome == Y].set_index('model')
fit = pd.DataFrame([
    dict(table='지금 앱(값 고정)', score_params=4, aic=m.loc[APPM, 'aic'] + 2 * 4, qaic=m.loc[APPM, 'qaic'] + 2 * 4),
    dict(table='참고: 지금 구조, 한 모형 값(A1)', score_params=4, aic=m.loc[A1, 'aic'], qaic=m.loc[A1, 'qaic']),
    dict(table='참고: 종류 구분 없이 전체 log2(개수+1)(L0)', score_params=1, aic=m.loc[L0, 'aic'], qaic=m.loc[L0, 'qaic']),
    dict(table='후보 A: 종류 같은 무게·3곳 멈춤(b3=)', score_params=1, aic=m.loc[B3E, 'aic'], qaic=m.loc[B3E, 'qaic']),
    dict(table='후보 B: 종류별 무게·3곳 멈춤(b3)', score_params=3, aic=m.loc[B3, 'aic'], qaic=m.loc[B3, 'qaic']),
    dict(table='참고: 종류 같은 무게·멈춤 없음(b2=)', score_params=1, aic=m.loc[B2E, 'aic'], qaic=m.loc[B2E, 'qaic']),
    dict(table='참고: 종류별 무게·멈춤 없음(b2)', score_params=3, aic=m.loc[B2, 'aic'], qaic=m.loc[B2, 'qaic']),
    dict(table='장소 점수 없음', score_params=0, aic=m.loc['N 장소 요인 없음', 'aic'], qaic=m.loc['N 장소 요인 없음', 'qaic'])])
fit['d_aic'] = fit.aic - fit.aic.min(); fit['d_qaic'] = fit.qaic - fit.qaic.min()
fit.to_csv(OUT + '/score_fit.csv', index=False, encoding='utf-8-sig')

# ③ 관측 ÷ 기대(지금 앱 점수 단계별): 각 점수표를 고정 오프셋으로 두고 시군구·해안선만 추정한 모형의 기대 사고 수
X0 = sm.add_constant(pd.concat([sp[['log_coast']], pd.get_dummies(sp.sgg, prefix='sgg', drop_first=True, dtype=float)], axis=1))
oe = []
grp = sp.bin_start + np.where(sp.hz_fatal_3km > 0, ' +사망', '')
for c, lab in (('s_app', '지금 앱'), ('s_a1', 'A1'), ('s_L0', 'L0'), ('s_candA', '후보 A'), ('s_candB', '후보 B')):
    mm = sm.GLM(sp[Y], X0, family=sm.families.Poisson(), offset=np.log(2) * sp[c].values).fit()
    sp['mu_' + c] = mm.fittedvalues
for g in ['0', '1-2', '1-2 +사망', '3-5', '3-5 +사망', '6+', '6+ +사망']:
    s = sp[grp == g]
    oe.append(dict(group=g, app_score=float(s.s_app.iloc[0]), spots=len(s), observed=int(s[Y].sum()),
                   **{'oe_' + lab: s[Y].sum() / s['mu_' + c].sum() for c, lab in (('s_app', 'app'), ('s_a1', 'a1'), ('s_L0', 'L0'), ('s_candA', 'candA'), ('s_candB', 'candB'))}))
oe = pd.DataFrame(oe); oe.to_csv(OUT + '/score_obs_exp.csv', index=False, encoding='utf-8-sig')

# ④ 관광지 1,354곳 점수 분포·변화
S = {'s_app': '지금 앱', 's_a1': 'A1(지금 구조, 한 모형 값)', 's_L0': '참고 L0(종류 구분 없음)', 's_candA': '후보 A', 's_candB': '후보 B'}
summ = []
for c, lab in S.items():
    d = sp[c] - sp.s_app
    summ.append(dict(table=lab, mean=sp[c].mean(), median=sp[c].median(), max=sp[c].max(), min_nonzero=sp.loc[sp[c] > 0, c].min(),
                     spearman_vs_app=sp[[c, 's_app']].corr(method='spearman').iloc[0, 1],
                     n_up_ge_0_25=int((d >= .25).sum()), n_down_ge_0_25=int((d <= -.25).sum()), n_abs_lt_0_25=int((d.abs() < .25).sum())))
summ = pd.DataFrame(summ); summ.to_csv(OUT + '/score_summary.csv', index=False, encoding='utf-8-sig')
combo = sp.risk_any.astype(int).astype(str) + sp.fatal_any.astype(int).astype(str) + sp.freq_any.astype(int).astype(str)
CN = {'000': '없음', '100': '위험만', '010': '사망만', '001': '다발만', '110': '위험+사망', '101': '위험+다발', '011': '사망+다발', '111': '셋 다'}
sp['combo'] = combo.map(CN)
bycombo = sp.groupby('combo').agg(spots=('spot', 'size'), zones_mean=('hz_all_3km', 'mean'), s_app=('s_app', 'mean'), s_a1=('s_a1', 'mean'), s_L0=('s_L0', 'mean'),
                                  s_candA=('s_candA', 'mean'), s_candB=('s_candB', 'mean'), acc_2023_24=('n_2023_24', 'sum')).reindex(list(CN.values()))
bycombo.to_csv(OUT + '/score_by_combo.csv', encoding='utf-8-sig')

# ⑤ 예시 관광지
sp['d_candA'] = sp.s_candA - sp.s_app
cols = ['name', 'sgg_name', 'hz_risk_3km', 'hz_fatal_3km', 'hz_freq_3km', 'hz_all_3km', 'n_2023_24', 'n_all', 's_app', 's_a1', 's_L0', 's_candA', 's_candB']
ex = []
def take(df, lab):
    for _, r in df.iterrows(): ex.append(dict(group=lab, **{c: r[c] for c in cols}))
take(sp.sort_values(['s_app', 'n_2023_24', 'spot'], ascending=[False, False, True]).head(5), '지금 점수 최고(같은 점수면 2023~24 사고 많은 순)')
take(sp.sort_values(['s_candA', 'n_2023_24', 'spot'], ascending=[False, False, True]).head(3), '후보 A 점수 최고')
take(sp.sort_values(['d_candA', 'n_2023_24', 'spot'], ascending=[True, False, True]).head(4), '후보 A 에서 가장 내려감')
take(sp.sort_values(['d_candA', 'n_2023_24', 'spot'], ascending=[False, False, True]).head(3), '후보 A 에서 가장 올라감')
for k, lab in (('100', '위험구역 1곳만'), ('010', '사망구역 1곳만'), ('001', '다발구역 1곳만')):
    take(sp[(combo == k) & (sp.hz_all_3km == 1)].sort_values(['n_2023_24', 'spot'], ascending=[False, True]).head(1), lab)
take(sp[(sp.hz_risk_3km >= 6) & (sp.hz_fatal_3km == 0) & (sp.hz_freq_3km == 0)].sort_values(['n_2023_24', 'spot'], ascending=[False, True]).head(1), '위험구역만 6곳 이상')
ex = pd.DataFrame(ex); ex.to_csv(OUT + '/score_examples.csv', index=False, encoding='utf-8-sig')
sp.drop(columns=[c for c in sp.columns if c.startswith('mu_')]).to_csv(OUT + '/spots_scores.csv', index=False, encoding='utf-8-sig')

pd.set_option('display.width', 250)
print('candA w=%.3f  candB %s  b2e %.3f  b2 %s  A1 %s fatal %.3f' % (w3e, {k: round(v, 3) for k, v in w3.items()}, w2e, {k: round(v, 3) for k, v in w2.items()},
      {k: round(v, 3) for k, v in a1.items()}, a1f))
print(tab.round(2).to_string(index=False)); print(fit.round(1).to_string(index=False)); print(oe.round(2).to_string(index=False))
print(summ.round(3).to_string(index=False)); print(bycombo.round(2).to_string()); print(ex.round(2).to_string(index=False))
