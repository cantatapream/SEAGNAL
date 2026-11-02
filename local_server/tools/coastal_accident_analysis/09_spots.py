"""위험구역(해경 연안위험구역 820) 3km 개수 ↔ 관광지 몫 인명사고.
단위 = 해안 관광지 1,354곳(전남은 관광지 목록에 없음 — 한계). 사고는 3km 안 가장 가까운 관광지 몫(설계서 U16).
모형 = 포아송 회귀(강건 표준오차) + 시군구 고정효과(같은 시군구 안 관광지끼리 비교 → 시군구 방문자 규모 통제)
       + log(관광지 몫 해안선 칸 수+1)(영역 크기 보정).
구간: 출발안 0 / 1~2 / 3~5 / 6+ 와 세분 구간을 모두 본다. 순환성 점검: 지정일(2023-01-01) 이후 2023~2024 사고만으로 다시.
사용: python3 -I 09_spots.py <data_dir> <out_dir>
"""
import sys, os
import numpy as np, pandas as pd
import statsmodels.api as sm
D, OUT = sys.argv[1:3]
sp = pd.read_csv(D + '/spots_features.csv', dtype={'sgg': str})
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str})
pe = pe[pe.spot.notna()].copy(); pe['spot'] = pe.spot.astype(int)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
pe['late'] = pe.date >= '20230101'
def cnt(mask, name):
    c = pe[mask].groupby('spot').size(); sp[name] = sp.spot.map(c).fillna(0).astype(int)
cnt(pe.date.notna(), 'n_all'); cnt(pe.late, 'n_2023_24'); cnt(~pe.late, 'n_2020_22'); cnt(pe.fatal, 'n_fatal')
for t in ['익수', '추락', '고립', '표류']: cnt(pe.type == t, 'n_' + t)
sp['log_coast'] = np.log(sp.coast_cells_share + 1)
def binz(x, edges, labels):
    return pd.cut(x, bins=edges, labels=labels, right=False).astype(str)
sp['bin_start'] = binz(sp.hz_all_3km, [0, 1, 3, 6, 999], ['0', '1-2', '3-5', '6+'])
sp['bin_fine'] = binz(sp.hz_all_3km, [0, 1, 2, 3, 4, 6, 9, 13, 999], ['0', '1', '2', '3', '4-5', '6-8', '9-12', '13+'])
sp['fatal_any'] = (sp.hz_fatal_3km > 0).astype(int)
rows = []
def fit(y, terms, label, data, ref_note=''):
    X = pd.get_dummies(data[terms], drop_first=False, dtype=float)
    # 기준 범주 제거
    for c in list(X.columns):
        if c.endswith('_0') and c.startswith('bin'): X = X.drop(columns=c)
    X = pd.concat([X, pd.get_dummies(data.sgg, prefix='sgg', drop_first=True, dtype=float), data[['log_coast']]], axis=1)
    X = sm.add_constant(X)
    m = sm.GLM(data[y], X, family=sm.families.Poisson()).fit(cov_type='HC1')
    for c in X.columns:
        if c.startswith('sgg_') or c == 'const': continue
        b, s = m.params[c], m.bse[c]
        rows.append(dict(model=label, outcome=y, term=c, RR=np.exp(b), lo=np.exp(b - 1.96 * s), hi=np.exp(b + 1.96 * s), p=m.pvalues[c],
                         n_spots=len(data), events=int(data[y].sum())))
    return m
for y in ['n_all', 'n_2020_22', 'n_2023_24', 'n_fatal', 'n_익수', 'n_추락', 'n_고립', 'n_표류']:
    fit(y, ['bin_start'], '출발안 구간(0/1-2/3-5/6+)', sp)
for y in ['n_all', 'n_2023_24', 'n_fatal']:
    fit(y, ['bin_fine'], '세분 구간', sp)
    d2 = sp.copy(); d2['bin_start'] = d2.bin_start; fit(y, ['bin_start', 'fatal_any'], '출발안 구간 + 사망사고구역 3km 안 있음', d2)
# 연속(개수 1개당, 로그)
d3 = sp.copy(); d3['log_hz1'] = np.log(d3.hz_all_3km + 1)
for y in ['n_all', 'n_2023_24']:
    X = sm.add_constant(pd.concat([d3[['log_hz1', 'log_coast']], pd.get_dummies(d3.sgg, prefix='sgg', drop_first=True, dtype=float)], axis=1))
    m = sm.GLM(d3[y], X, family=sm.families.Poisson()).fit(cov_type='HC1')
    b, s = m.params['log_hz1'], m.bse['log_hz1']
    rows.append(dict(model='연속 log(개수+1) 1단위', outcome=y, term='log_hz1', RR=np.exp(b), lo=np.exp(b - 1.96 * s), hi=np.exp(b + 1.96 * s), p=m.pvalues['log_hz1'], n_spots=len(d3), events=int(d3[y].sum())))
res = pd.DataFrame(rows); res.to_csv(OUT + '/spot_hazard_models.csv', index=False, encoding='utf-8-sig')
# 기술 통계: 구간별 관광지 수·사고·관광지당 연간 사고
desc = []
for b, g in sp.groupby('bin_fine'):
    desc.append(dict(bin=b, spots=len(g), events=int(g.n_all.sum()), per_spot_per_year=g.n_all.sum() / len(g) / 5, fatal=int(g.n_fatal.sum()),
                     coast_cells_mean=g.coast_cells_share.mean(), share_with_fatal_zone=g.fatal_any.mean()))
for b, g in sp.groupby('bin_start'):
    desc.append(dict(bin='[출발안] ' + b, spots=len(g), events=int(g.n_all.sum()), per_spot_per_year=g.n_all.sum() / len(g) / 5, fatal=int(g.n_fatal.sum()),
                     coast_cells_mean=g.coast_cells_share.mean(), share_with_fatal_zone=g.fatal_any.mean()))
pd.DataFrame(desc).to_csv(OUT + '/spot_hazard_desc.csv', index=False, encoding='utf-8-sig')
sp.to_csv(OUT + '/spots_with_counts.csv', index=False, encoding='utf-8-sig')
print(pd.DataFrame(desc).round(3).to_string())
print(res[res.model.str.startswith('출발안 구간(') | res.model.str.startswith('세분') | res.model.str.startswith('연속')].round(3).to_string())
print('spots', len(sp), 'events assigned', int(sp.n_all.sum()), 'sgg', sp.sgg.nunique())
