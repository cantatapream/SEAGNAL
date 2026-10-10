"""계절별 건수표(기술 통계)와 계절별 조건 빈도 — 18_season.py 와 같은 계절 정의(봄 3~5 · 여름 6~8 · 가을 9~11 · 겨울 12~2).
출력(results/): season_descriptive.md · season_desc_*.csv · season_condition_prevalence.csv
사용: python3 -I 18b_season_desc.py <data_dir> <results_dir>
"""
import sys, os
import numpy as np, pandas as pd
D, R = sys.argv[1:3]
SEASON = {3: '봄', 4: '봄', 5: '봄', 6: '여름', 7: '여름', 8: '여름', 9: '가을', 10: '가을', 11: '가을', 12: '겨울', 1: '겨울', 2: '겨울'}
SEASONS = ['봄', '여름', '가을', '겨울']
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
pe['month'] = pe.date.str[4:6].astype(int); pe['season'] = pe.month.map(SEASON)
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pr['season'] = pe.season.values[pr.ev.values]
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sg['month'] = sg.date.str[4:6].astype(int); sg['season'] = sg.month.map(SEASON)
TYPES = ['전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌']
# ======================= 기술 통계(건수) =======================
def crosstab(df, row, col, order_rows=None, order_cols=None):
    t = pd.crosstab(df[row], df[col], margins=True, margins_name='합계')
    if order_rows: t = t.reindex(order_rows + ['합계'])
    if order_cols: t = t.reindex(columns=order_cols + ['합계'])
    return t.fillna(0).astype(int)
PT = ['익수', '추락', '고립', '표류']
pe['year'] = pe.date.str[:4]; pe['dow'] = pd.to_datetime(pe.date).dt.dayofweek
DOWN = ['월', '화', '수', '목', '금', '토', '일']
pe['dow_name'] = pe.dow.map(dict(enumerate(DOWN)))
pe['fatal_s'] = np.where(pe.fatal, '사망·실종', '그 외')
desc = {}
desc['인명_월×유형'] = crosstab(pe, 'month', 'type', list(range(1, 13)), PT)
desc['인명_계절×유형'] = crosstab(pe, 'season', 'type', SEASONS, PT)
desc['인명_연도×유형'] = crosstab(pe, 'year', 'type', None, PT)
desc['인명_요일×유형'] = crosstab(pe, 'dow_name', 'type', DOWN, PT)
desc['인명_계절×치명'] = crosstab(pe, 'season', 'fatal_s', SEASONS, ['사망·실종', '그 외'])
desc['인명_유형×치명'] = crosstab(pe, 'type', 'fatal_s', PT, ['사망·실종', '그 외'])
sg['type1'] = sg.types.str.split('|').str[0]; sg['year'] = sg.date.str[:4]
sg['fatal'] = (sg.death.fillna(0) + sg.missing.fillna(0)) > 0; sg['fatal_s'] = np.where(sg.fatal, '사망·실종', '그 외')
sg['hour'] = sg.hm.str.split(':').str[0].astype(int); sg['hband'] = pd.cut(sg.hour, [0, 6, 12, 18, 24], right=False, labels=['00~06시', '06~12시', '12~18시', '18~24시']).astype(str)
sg['dow_name'] = pd.to_datetime(sg.date).dt.dayofweek.map(dict(enumerate(DOWN)))
# 유형 집계는 '사건에 그 유형이 들어 있으면 1'(한 사건에 여러 유형이면 여러 칸에 센다)
long = sg.assign(t=sg.types.str.split('|')).explode('t'); long = long[long.t.isin(TYPES)].reset_index(drop=True)
desc['선박_월×유형'] = crosstab(long, 'month', 't', list(range(1, 13)), TYPES)
desc['선박_계절×유형'] = crosstab(long, 'season', 't', SEASONS, TYPES)
desc['선박_연도×유형'] = crosstab(long, 'year', 't', None, TYPES)
desc['선박_요일×유형'] = crosstab(long, 'dow_name', 't', DOWN, TYPES)
desc['선박_시간대×유형'] = crosstab(long, 'hband', 't', ['00~06시', '06~12시', '12~18시', '18~24시'], TYPES)
desc['선박_계절×치명'] = crosstab(sg, 'season', 'fatal_s', SEASONS, ['사망·실종', '그 외'])
desc['선박_유형×치명'] = crosstab(long, 't', 'fatal_s', TYPES, ['사망·실종', '그 외'])
with open(R + '/season_descriptive.md', 'w') as f:
    for k, t in desc.items():
        f.write('\n##### %s\n\n' % k)
        f.write('| ' + t.index.name + ' | ' + ' | '.join(str(c) for c in t.columns) + ' |\n|' + '---|' * (len(t.columns) + 1) + '\n')
        for i, r in t.iterrows(): f.write('| ' + str(i) + ' | ' + ' | '.join(str(v) for v in r.values) + ' |\n')
        fn = k
        for a, b in (('인명', 'person'), ('선박', 'ship'), ('시간대', 'hourband'), ('월', 'month'), ('계절', 'season'), ('연도', 'year'), ('요일', 'dow'), ('유형', 'type'), ('치명', 'fatal'), ('×', '_x_')):
            fn = fn.replace(a, b)
        t.to_csv(R + '/season_desc_%s.csv' % fn, encoding='utf-8-sig')   # 파일 이름은 ASCII(저장소 호환)

# ======================= 계절별 조건 빈도(비교일 기준) =======================
# 층의 '사고 안 난 날'(case==0) 을 (구역, 날짜) 로 중복 제거해 그 계절에 각 조건이 얼마나 흔했는지 본다.
prev = []
u = pr[pr.case == 0].drop_duplicates(['sea_zone', 'day'])
for se_ in SEASONS:
    g = u[u.season == se_]
    prev.append(dict(group='인명(사고 지점 해상특보구역-일)', season=se_, zone_days=len(g), share_any_warn=(g.anyw >= 1).mean(), share_경보=(g.anyw == 2).mean(),
                     share_wv=(g.wv >= 1).mean(), share_ty=(g.ty >= 1).mean(), share_gw=(g.gw >= 1).mean(),
                     wh_median=g.wh_max.median(), wh_p90=g.wh_max.quantile(.9), ws_median=g.ws_max.median(), ws_p90=g.ws_max.quantile(.9)))
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz'); sr['season'] = sg.season.values[sr.ev.values]; sr['zone'] = sg.sea_zone.values[sr.ev.values]
u = sr[sr.case == 0].drop_duplicates(['zone', 'day'])
for se_ in SEASONS:
    g = u[u.season == se_]
    prev.append(dict(group='선박(사고 지점 해상특보구역-일)', season=se_, zone_days=len(g), share_any_warn=(g.seaw >= 1).mean(), share_경보=(g.seaw == 2).mean(),
                     share_wv=(g.wv >= 1).mean(), share_ty=(g.ty >= 1).mean(), share_gw=np.nan,
                     wh_median=g.wh_max.median(), wh_p90=g.wh_max.quantile(.9), ws_median=g.ws_max.median(), ws_p90=g.ws_max.quantile(.9)))
pd.DataFrame(prev).to_csv(R + '/season_condition_prevalence.csv', index=False, encoding='utf-8-sig')
print(pd.DataFrame(prev).round(3).to_string())
print('done')
