"""치명도: '사고가 났을 때 사망·실종으로 이어지는 비율'이 조건에 따라 달라지는가(사고 1건 단위).
수정 포아송(로그 링크, 강건 SE) → 비율의 배수(치명률 배수). 보정: 사고유형 + 월 + 연도. 군집: 해상특보구역.
노출은 사례교차 표(case 행)에서 가져온다(같은 정의).
사용: python3 -I 10_severity.py <data_dir> <results_dir>
"""
import sys
import numpy as np, pandas as pd
import statsmodels.api as sm
D, R = sys.argv[1:3]
out = []
def run(df, y, terms, adj, label, group):
    X = pd.concat([df[terms].astype(float), pd.get_dummies(df[adj].astype(str), drop_first=True, dtype=float)], axis=1)
    X = sm.add_constant(X); ok = X.notna().all(1) & df[y].notna()
    m = sm.GLM(df.loc[ok, y].astype(float), X[ok], family=sm.families.Poisson()).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(df.loc[ok, group])[0]})
    for t in terms:
        b, s = m.params[t], m.bse[t]
        out.append(dict(model=label, term=t, ratio=np.exp(b), lo=np.exp(b - 1.96 * s), hi=np.exp(b + 1.96 * s), p=m.pvalues[t],
                        n=int(ok.sum()), n_fatal=int(df.loc[ok, y].sum()), n_with=int(df.loc[ok, t].sum()) if set(df[t].dropna().unique()) <= {0, 1} else None,
                        fatal_rate_with=float(df.loc[ok & (df[t] == 1), y].mean()) if set(df[t].dropna().unique()) <= {0, 1} else None,
                        fatal_rate_without=float(df.loc[ok & (df[t] == 0), y].mean()) if set(df[t].dropna().unique()) <= {0, 1} else None))
# 인명
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
pc = pr[pr.case == 1].copy()
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str})
pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pc['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0).astype(int).values[pc.ev.values]
pc['yr'] = pe.date.str[:4].values[pc.ev.values]
pc['any_warn'] = (pc.anyw >= 1).astype(int); pc['warn_주의보'] = (pc.anyw == 1).astype(int); pc['warn_경보'] = (pc.anyw == 2).astype(int)
pc['sea_warn'] = (pc.seaw >= 1).astype(int); pc['gw_warn'] = (pc.gw >= 1).astype(int)
pc['nw_wh_1.5+'] = ((pc.anyw == 0) & (pc.wh_max >= 1.5)).astype(float); pc.loc[pc.wh_max.isna(), 'nw_wh_1.5+'] = np.nan
pc['nw_ws_10+'] = ((pc.anyw == 0) & (pc.ws_max >= 10)).astype(float); pc.loc[pc.ws_max.isna(), 'nw_ws_10+'] = np.nan
for sub, lab in [(pc, '인명 전체(변사 제외)')]:
    run(sub, 'fatal', ['any_warn'], ['type', 'month', 'yr'], lab + ': 특보 있는 날 사고의 사망·실종 비율 배수', 'sea_zone')
    run(sub, 'fatal', ['warn_주의보', 'warn_경보'], ['type', 'month', 'yr'], lab + ': 특보 수준별', 'sea_zone')
    run(sub, 'fatal', ['sea_warn', 'gw_warn'], ['type', 'month', 'yr'], lab + ': 해상특보·강풍특보 따로', 'sea_zone')
    run(sub.dropna(subset=['nw_wh_1.5+']), 'fatal', ['nw_wh_1.5+', 'any_warn'], ['type', 'month', 'yr'], lab + ': 특보 없는 날 파고1.5m↑ vs 그 외', 'sea_zone')
    run(sub.dropna(subset=['nw_ws_10+']), 'fatal', ['nw_ws_10+', 'any_warn'], ['type', 'month', 'yr'], lab + ': 특보 없는 날 풍속10m/s↑ vs 그 외', 'sea_zone')
for t in ['익수', '추락', '고립', '표류']:
    s = pc[pc.type == t]
    if s.fatal.sum() >= 10:
        run(s, 'fatal', ['any_warn'], ['month', 'yr'], '인명 ' + t + ': 특보 있는 날 사망·실종 비율 배수', 'sea_zone')
# 선박
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz')
sc = sr[sr.case == 1].copy()
se = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str}); se = se[se.sea_zone.notna()].reset_index(drop=True)
sc['fatal'] = ((se.death.fillna(0) + se.missing.fillna(0)) > 0).astype(int).values[sc.ev.values]
sc['type1'] = se.types.str.split('|').str[0].values[sc.ev.values]; sc['month'] = se.date.str[4:6].values[sc.ev.values]; sc['yr'] = se.date.str[:4].values[sc.ev.values]
sc['zone'] = se.sea_zone.values[sc.ev.values]
sc['any_warn'] = (sc.seaw >= 1).astype(int); sc['warn_주의보'] = (sc.seaw == 1).astype(int); sc['warn_경보'] = (sc.seaw == 2).astype(int)
sc['nw_wh_2+'] = ((sc.seaw == 0) & (sc.wh_max >= 2)).astype(float); sc.loc[sc.wh_max.isna(), 'nw_wh_2+'] = np.nan
run(sc, 'fatal', ['any_warn'], ['type1', 'month', 'yr'], '선박 전체: 특보 있는 날 사고의 사망·실종 비율 배수', 'zone')
run(sc, 'fatal', ['warn_주의보', 'warn_경보'], ['type1', 'month', 'yr'], '선박: 특보 수준별', 'zone')
run(sc.dropna(subset=['nw_wh_2+']), 'fatal', ['nw_wh_2+', 'any_warn'], ['type1', 'month', 'yr'], '선박: 특보 없는 날 파고2m↑ vs 그 외', 'zone')
res = pd.DataFrame(out); res.to_csv(R + '/severity_models.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 250)
print(res.round(3).to_string())
