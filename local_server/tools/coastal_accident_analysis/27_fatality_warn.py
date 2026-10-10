"""연안 특보 날 사고의 치명률(사망·실종 비율) — 계절별·유형별(사용자 질문 2026-10-10:
"연안에 특보가 떴을 때 만약 사고가 발생한다면 치명율은 ? 사고자체 발생률은 낮지만 치명률은 높을 것 같은데").
사고 1건 단위, 수정 포아송(로그 링크), 보정 = 유형·월·연도(유형별은 월·연도), 군집 = 사고 날짜.
함께 찍는 것: 같은 계절의 '하루당 사망·실종 사고 수' 배수(18_season.py P3 사망·실종) — 발생 × 치명의 결과.
사용: python3 -I 27_fatality_warn.py <data_dir> <results_dir> > results/fatality_warn.md
"""
import sys, warnings
import numpy as np, pandas as pd, statsmodels.api as sm
warnings.filterwarnings('ignore')
D, R = sys.argv[1:3]
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pc = pr[pr.case == 1].copy()
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pc['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0).astype(int).values[pc.ev.values]
pc['yr'] = pe.date.str[:4].values[pc.ev.values]
S = {3: '봄', 4: '봄', 5: '봄', 6: '여름', 7: '여름', 8: '여름', 9: '가을', 10: '가을', 11: '가을', 12: '겨울', 1: '겨울', 2: '겨울'}
pc['season'] = pc.month.map(S); pc['w'] = (pc.anyw >= 1).astype(int)
def fit(df, adj):
    X = sm.add_constant(pd.concat([df[['w']].astype(float), pd.get_dummies(df[adj].astype(str), drop_first=True, dtype=float)], axis=1))
    m = sm.GLM(df.fatal.astype(float), X, family=sm.families.Poisson()).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(df.day)[0]})
    b, s = m.params['w'], m.bse['w']; return np.exp(b), np.exp(b - 1.96 * s), np.exp(b + 1.96 * s)
SP = pd.read_csv(R + '/season_person_models.csv')
day = SP[(SP.model.str.startswith('P3_')) & (SP.subset == '사망·실종') & (SP.term == 'any_warn')].set_index('season')
print('#### 연안 특보 날 사고의 치명률 — 계절별·유형별(변사 제외)\n')
print('| 묶음 | 특보일 사고 | 그중 사망·실종 | 특보일 치명률 | 평소 사고 | 그중 사망·실종 | 평소 치명률 | 치명률 배수 (95% 신뢰구간) | 하루당 사망·실종 사고 배수 (95% 신뢰구간) |')
print('|---|---|---|---|---|---|---|---|---|')
groups = [('전체', pc, ['type', 'month', 'yr'], '전체(계절 구분 없음)')] + [('계절 ' + s, pc[pc.season == s], ['type', 'month', 'yr'], s) for s in ['봄', '여름', '가을', '겨울']] + \
         [('유형 ' + t, pc[pc.type == t], ['month', 'yr'], None) for t in ['익수', '추락']] + [('익수 · ' + s, pc[(pc.type == '익수') & (pc.season == s)], ['month', 'yr'], None) for s in ['봄', '여름', '가을', '겨울']]
for lab, df, adj, dk in groups:
    a, b = df[df.w == 1], df[df.w == 0]; rr = fit(df, adj)
    d = '—' if dk is None else '%.2f (%.2f–%.2f)' % (day.loc[dk, 'RR'], day.loc[dk, 'lo'], day.loc[dk, 'hi'])
    print('| %s | %d | %d | %.1f%% | %d | %d | %.1f%% | %.2f (%.2f–%.2f) | %s |' % (lab, len(a), a.fatal.sum(), 100 * a.fatal.mean(), len(b), b.fatal.sum(), 100 * b.fatal.mean(), *rr, d))
print('\n고립(특보일 1/86건)·표류(0/89건)는 사망·실종이 거의 없어 치명률 배수를 계산하지 않았다.')
