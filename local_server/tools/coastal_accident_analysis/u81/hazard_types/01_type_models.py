"""위험구역 종류별(연안사고 위험구역 · 사망사고 발생구역 · 연안사고 다발구역) 효과 — 관광지 단위.
§4.6(09_spots.py)과 같은 틀: 포아송 회귀 + 시군구 고정효과 + log(관광지 몫 해안선 칸 수 + 1), 강건 표준오차(HC1).
입력: 09_spots.py 가 만든 spots_with_counts.csv(관광지·종류별 3km 안 개수·사고 수) + geo_person.csv(유형·기간별 사고 수를 더 센다).
사용: python3 -I 01_type_models.py <data_dir> <repro_dir> <out_dir>
"""
import sys
import numpy as np, pandas as pd, statsmodels.api as sm
from scipy.stats import chi2

D, R, OUT = sys.argv[1:4]
sp = pd.read_csv(R + '/spots_with_counts.csv', dtype={'sgg': str})
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str})
pe = pe[pe.spot.notna()].copy(); pe['spot'] = pe.spot.astype(int)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
pe['late'] = pe.date >= '20230101'
def cnt(mask, name):
    c = pe[mask].groupby('spot').size(); sp[name] = sp.spot.map(c).fillna(0).astype(int)
cnt(pe.fatal & pe.late, 'n_fatal_2023_24'); cnt(pe.fatal & ~pe.late, 'n_fatal_2020_22')
for t in ['익수', '추락', '고립', '표류']:
    cnt((pe.type == t) & pe.late, 'n_%s_2023_24' % t)
# 09_spots.py 의 값과 같은지(같은 규칙으로 센 열) 확인
cnt(pe.date.notna(), '_chk_all'); assert (sp._chk_all == sp.n_all).all(); sp = sp.drop(columns='_chk_all')

T3 = [('risk', 'hz_risk_3km', '연안사고 위험구역'), ('fatal', 'hz_fatal_3km', '사망사고 발생구역'), ('freq', 'hz_freq_3km', '연안사고 다발구역')]
for k, c, _ in T3:
    sp[k + '_any'] = (sp[c] > 0).astype(float)
    sp[k + '_l2'] = np.log2(sp[c] + 1)
    sp[k + '_l2c3'] = np.log2(sp[c].clip(upper=3) + 1)   # 3곳에서 멈춤(3곳 이상 = 3곳)
    sp[k + '_l2c2'] = np.log2(sp[c].clip(upper=2) + 1)   # 2곳에서 멈춤
    sp[k + '_b'] = pd.cut(sp[c], [0, 1, 2, 3, 99], labels=['0', '1', '2', '3+'], right=False).astype(str)
sp['all_l2'] = np.log2(sp.hz_all_3km + 1)
sp['all_l2c3'] = np.log2(sp.hz_all_3km.clip(upper=3) + 1); sp['all_l2c6'] = np.log2(sp.hz_all_3km.clip(upper=6) + 1)
sp['types_present'] = sp.risk_any + sp.fatal_any + sp.freq_any          # 종류를 구분하지 않은 '있음' 합(같은 무게)
sp['l2sum'] = sp.risk_l2 + sp.fatal_l2 + sp.freq_l2                     # 종류별 log2(개수+1)의 합(같은 무게)
sp['l2c3sum'] = sp.risk_l2c3 + sp.fatal_l2c3 + sp.freq_l2c3
sp['l2c2sum'] = sp.risk_l2c2 + sp.fatal_l2c2 + sp.freq_l2c2
sp['bin_start'] = pd.cut(sp.hz_all_3km, [0, 1, 3, 6, 999], labels=['0', '1-2', '3-5', '6+'], right=False).astype(str)
sp['fatal_any_start'] = sp.fatal_any.astype(float)
# 앱 점수(risk_points.js HAZARDS + COAST.fatalScore) — 고정 오프셋 모형용
APP = {'0': 0, '1-2': .70, '3-5': 1.24, '6+': 1.74}
sp['app_score'] = sp.bin_start.map(APP) + .37 * (sp.hz_fatal_3km > 0)

def design(terms):
    parts = []
    for t in terms:
        if t.endswith('_b') or t == 'bin_start':
            X = pd.get_dummies(sp[t], prefix=t, dtype=float); X = X.drop(columns=t + '_0'); parts.append(X)
        else:
            parts.append(sp[[t]].astype(float))
    return parts

def fit(y, terms, offset=None):
    X = pd.concat(design(terms) + [sp[['log_coast']], pd.get_dummies(sp.sgg, prefix='sgg', drop_first=True, dtype=float)], axis=1)
    X = sm.add_constant(X)
    m = sm.GLM(sp[y], X, family=sm.families.Poisson(), offset=offset).fit(cov_type='HC1')
    return m

OUTCOMES = [('n_2023_24', '2023~24 전체(주)'), ('n_all', '2020~24 전체'), ('n_fatal', '2020~24 사망·실종'), ('n_fatal_2023_24', '2023~24 사망·실종'),
            ('n_2020_22', '2020~22 전체(지정 전 — 순환성 대조)'), ('n_fatal_2020_22', '2020~22 사망·실종(지정 전 — 순환성 대조)')]
TYPEOUT = [('n_익수', '익수 2020~24'), ('n_추락', '추락 2020~24'), ('n_고립', '고립 2020~24'), ('n_표류', '표류 2020~24'),
           ('n_익수_2023_24', '익수 2023~24'), ('n_추락_2023_24', '추락 2023~24'), ('n_고립_2023_24', '고립 2023~24'), ('n_표류_2023_24', '표류 2023~24')]
MODELS = [
    ('A0 출발안 구간(전체 개수)', ['bin_start']),
    ('A1 출발안 구간 + 사망구역 있음(§4.6)', ['bin_start', 'fatal_any_start']),
    ('A2 출발안 구간 + 사망·다발 있음', ['bin_start', 'fatal_any_start', 'freq_any']),
    ('L0 전체 log2(개수+1)', ['all_l2']),
    ('L0c3 전체 log2(min(개수,3)+1)', ['all_l2c3']),
    ('L0c6 전체 log2(min(개수,6)+1)', ['all_l2c6']),
    ('L1 전체 log2(개수+1) + 있는 종류 수', ['all_l2', 'types_present']),
    ('a 종류별 있음 3개', ['risk_any', 'fatal_any', 'freq_any']),
    ('a= 있음 3개 같은 무게(있는 종류 수)', ['types_present']),
    ('b1 종류별 개수 구간(0/1/2/3+) 3개', ['risk_b', 'fatal_b', 'freq_b']),
    ('b2 종류별 log2(개수+1) 3개', ['risk_l2', 'fatal_l2', 'freq_l2']),
    ('b2= 종류별 log2(개수+1) 같은 무게', ['l2sum']),
    ('b3 종류별 log2(min(개수,3)+1) 3개', ['risk_l2c3', 'fatal_l2c3', 'freq_l2c3']),
    ('b3= 종류별 log2(min(개수,3)+1) 같은 무게', ['l2c3sum']),
    ('b4 종류별 log2(min(개수,2)+1) 3개', ['risk_l2c2', 'fatal_l2c2', 'freq_l2c2']),
    ('b4= 종류별 log2(min(개수,2)+1) 같은 무게', ['l2c2sum']),
    ('c 위험구역만 있음', ['risk_any']), ('c 사망구역만 있음', ['fatal_any']), ('c 다발구역만 있음', ['freq_any']),
    ('c 위험구역만 log2', ['risk_l2']), ('c 사망구역만 log2', ['fatal_l2']), ('c 다발구역만 log2', ['freq_l2']),
    ('N 장소 요인 없음', []),
]

def wald_equal(m, names):
    """names 의 계수가 모두 같은가(자유도 k-1), 강건 공분산."""
    b = m.params; V = m.cov_params(); k = len(names)
    C = np.zeros((k - 1, len(b)))
    for i in range(k - 1):
        C[i, b.index.get_loc(names[i])] = 1; C[i, b.index.get_loc(names[-1])] = -1
    d = C @ b.values; S = C @ V.values @ C.T
    x = float(d @ np.linalg.solve(S, d)); return x, k - 1, float(chi2.sf(x, k - 1))
def ratio(m, a, c):
    """exp(b_a - b_c) 와 95% 구간."""
    b = m.params; V = m.cov_params()
    d = b[a] - b[c]; s = np.sqrt(V.loc[a, a] + V.loc[c, c] - 2 * V.loc[a, c])
    return np.exp(d), np.exp(d - 1.96 * s), np.exp(d + 1.96 * s), float(2 * (1 - __import__('scipy').stats.norm.cdf(abs(d / s))))

rows, cmp_rows, eq_rows = [], [], []
for y, ylab in OUTCOMES + TYPEOUT:
    fits = {}
    for nm, terms in MODELS:
        m = fit(y, terms); fits[nm] = m
        disp = float(m.pearson_chi2 / m.df_resid)
        for c in m.params.index:
            if c.startswith('sgg_') or c in ('const', 'log_coast'): continue
            b, s = m.params[c], m.bse[c]
            rows.append(dict(outcome=y, outcome_label=ylab, model=nm, term=c, RR=np.exp(b), lo=np.exp(b - 1.96 * s), hi=np.exp(b + 1.96 * s),
                             p=m.pvalues[c], n_spots=int(m.nobs), events=int(sp[y].sum())))
        cmp_rows.append(dict(outcome=y, outcome_label=ylab, model=nm,
                             loglik=m.llf, aic=m.aic, deviance=m.deviance, pearson_disp=disp, events=int(sp[y].sum())))
    # 앱 점수 고정(배수를 2^점수로 고정, 시군구·해안선만 추정)
    m = fit(y, [], offset=np.log(2) * sp.app_score.values)
    cmp_rows.append(dict(outcome=y, outcome_label=ylab, model='APP 앱 점수 고정(0/.70/1.24/1.74 + 사망 .37)',
                         loglik=m.llf, aic=m.aic, deviance=m.deviance, pearson_disp=float(m.pearson_chi2 / m.df_resid), events=int(sp[y].sum())))
    # 같은가 검정
    EQ = {'a 종류별 있음 3개': 'a= 있음 3개 같은 무게(있는 종류 수)', 'b2 종류별 log2(개수+1) 3개': 'b2= 종류별 log2(개수+1) 같은 무게',
          'b3 종류별 log2(min(개수,3)+1) 3개': 'b3= 종류별 log2(min(개수,3)+1) 같은 무게'}
    for nm, names in (('a 종류별 있음 3개', ['risk_any', 'fatal_any', 'freq_any']), ('b2 종류별 log2(개수+1) 3개', ['risk_l2', 'fatal_l2', 'freq_l2']),
                      ('b3 종류별 log2(min(개수,3)+1) 3개', ['risk_l2c3', 'fatal_l2c3', 'freq_l2c3'])):
        mm = fits[nm]
        x, df, p = wald_equal(mm, names)
        r1 = ratio(mm, names[1], names[0]); r2 = ratio(mm, names[2], names[0]); r3 = ratio(mm, names[1], names[2])
        eqm = fits[EQ[nm]]
        chat_ = float(fits['b1 종류별 개수 구간(0/1/2/3+) 3개'].pearson_chi2 / fits['b1 종류별 개수 구간(0/1/2/3+) 3개'].df_resid)
        qlr = (eqm.deviance - mm.deviance) / max(chat_, 1.0)
        eq_rows.append(dict(outcome=y, outcome_label=ylab, model=nm, chi2=x, df=df, p=p, d_aic_vs_equal=mm.aic - eqm.aic,
                            quasi_lr=qlr, quasi_lr_p=float(chi2.sf(qlr, 2)),
                            fatal_over_risk='%.2f (%.2f–%.2f) p=%.3f' % r1, freq_over_risk='%.2f (%.2f–%.2f) p=%.3f' % r2,
                            fatal_over_freq='%.2f (%.2f–%.2f) p=%.3f' % r3))
res = pd.DataFrame(rows); res.to_csv(OUT + '/type_models.csv', index=False, encoding='utf-8-sig')
cmpd = pd.DataFrame(cmp_rows)
# 과산포 보정 QAIC: ĉ = 가장 큰 모형(b1)의 Pearson χ²/자유도, 모수 수 = AIC 에서 거꾸로(k = (AIC + 2LL)/2) + 1(ĉ)
cmpd['k'] = ((cmpd.aic + 2 * cmpd.loglik) / 2).round().astype(int)
chat = cmpd[cmpd.model.str.startswith('b1')].set_index('outcome').pearson_disp
cmpd['c_hat_b1'] = cmpd.outcome.map(chat)
cmpd['qaic'] = -2 * cmpd.loglik / cmpd.c_hat_b1 + 2 * (cmpd.k + 1)
cmpd['d_aic'] = cmpd.aic - cmpd.groupby('outcome').aic.transform('min')
cmpd['d_qaic'] = cmpd.qaic - cmpd.groupby('outcome').qaic.transform('min')
cmpd.to_csv(OUT + '/model_compare.csv', index=False, encoding='utf-8-sig')
pd.DataFrame(eq_rows).to_csv(OUT + '/equality_tests.csv', index=False, encoding='utf-8-sig')

# 표본 수: 종류별 해당 관광지 수·사고 수
smp = []
ycols = ['n_2023_24', 'n_all', 'n_fatal', 'n_fatal_2023_24']
def addrow(lab, mask):
    g = sp[mask]
    smp.append(dict(group=lab, spots=len(g), **{y: int(g[y].sum()) for y in ycols},
                    per_spot_year_2023_24=g.n_2023_24.sum() / max(len(g), 1) / 2, per_spot_year_all=g.n_all.sum() / max(len(g), 1) / 5))
addrow('전체 관광지', sp.spot.notna())
addrow('어느 구역도 없음(0곳)', sp.hz_all_3km == 0)
for k, c, lab in T3:
    addrow(lab + ' 1곳 이상', sp[c] > 0)
    addrow(lab + ' 0곳', sp[c] == 0)
for k, c, lab in T3:
    for b in ['1', '2', '3+']:
        addrow('%s %s곳' % (lab, b), sp[k + '_b'] == b)
combo = sp.risk_any.astype(int).astype(str) + sp.fatal_any.astype(int).astype(str) + sp.freq_any.astype(int).astype(str)
CN = {'000': '없음', '100': '위험만', '010': '사망만', '001': '다발만', '110': '위험+사망', '101': '위험+다발', '011': '사망+다발', '111': '셋 다'}
for cc_, lab in CN.items():
    addrow('조합: ' + lab, combo == cc_)
pd.DataFrame(smp).to_csv(OUT + '/samples_by_type.csv', index=False, encoding='utf-8-sig')
sp.to_csv(OUT + '/spots_type_features.csv', index=False, encoding='utf-8-sig')

# 시군구 안 변이: 같은 시군구 안에서 종류별 '있음'이 갈리는 시군구 수(고정효과 모형은 이 변이만 쓴다)
var = []
for k, c, lab in T3:
    g = sp.groupby('sgg')[k + '_any'].agg(['min', 'max'])
    vv = g[g['min'] != g['max']].index
    var.append(dict(type=lab, sgg_with_variation=len(vv), sgg_total=sp.sgg.nunique(), spots_in_those_sgg=int(sp.sgg.isin(vv).sum()),
                    n_2023_24_in_those_sgg=int(sp[sp.sgg.isin(vv)].n_2023_24.sum())))
pd.DataFrame(var).to_csv(OUT + '/within_sgg_variation.csv', index=False, encoding='utf-8-sig')

pd.set_option('display.width', 250); pd.set_option('display.max_colwidth', 80)
print(pd.DataFrame(smp).round(3).to_string())
print(pd.DataFrame(var).to_string())
print(res[res.outcome.isin(['n_2023_24']) & ~res.model.str.startswith('N')].round(3).to_string())
print(cmpd[cmpd.outcome.isin(['n_2023_24', 'n_all', 'n_fatal', 'n_fatal_2023_24'])][['outcome', 'model', 'k', 'aic', 'd_aic', 'pearson_disp', 'qaic', 'd_qaic']].round(1).to_string())
print(pd.DataFrame(eq_rows).round(4).to_string())
