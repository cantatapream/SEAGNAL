"""계절별 분석 — 인명(변사 제외)·선박을 계절로 나눠 같은 비교(시간층화 사례교차 = 조건부 포아송)를 다시 한다.
계절은 기상청 관례: 봄 3~5월 · 여름 6~8월 · 가을 9~11월 · 겨울 12~2월. 사고가 난 달로 정한다
(층 = 사고 × 그 사고의 연·월이라 한 층 안의 날은 모두 같은 계절이다).
입력: 07_person.py·08_ship.py 가 저장한 층 행(person_strata_rows.csv.gz, ship_strata_rows_day/time.csv.gz)과 사고표(geo_*.csv).
출력(results/): season_person_models.csv · season_ship_models.csv  (건수표·조건 빈도는 18b_season_desc.py)
사용: python3 -I 18_season.py <data_dir> <results_dir>
"""
import sys, os
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccr, expo
D, R = sys.argv[1:3]
SEASON = {3: '봄', 4: '봄', 5: '봄', 6: '여름', 7: '여름', 8: '여름', 9: '가을', 10: '가을', 11: '가을', 12: '겨울', 1: '겨울', 2: '겨울'}
SEASONS = ['봄', '여름', '가을', '겨울']
CAL = ['dow%d' % d_ for d_ in range(1, 7)] + ['hol']
out = []

def add(group, season, model, subset, df, cols):
    df = df.dropna(subset=cols)
    if df.case.sum() < 5:
        out.append(dict(group=group, season=season, model=model, subset=subset, term='(사고 5건 미만 — 적합 안 함)', n_events=int(df.case.sum())))
        return
    r = ccr.fit(df.ev.values, df.case.values, df[cols].values.astype(float), cluster=df.cl.values, names=cols)
    for t in ccr.table(r):
        col = t['term']; isb = set(np.unique(df[col])) <= {0, 1}
        out.append(dict(group=group, season=season, model=model, subset=subset, term=col, RR=t['RR'], lo=t['lo'], hi=t['hi'], p=t['p'],
                        n_events=int(r['n_events']), n_strata=r['n_strata'],
                        cases_with=int(df.loc[df.case == 1, col].sum()) if isb else np.nan,
                        ref_share=float(df.loc[df.case == 0, col].mean()) if isb else np.nan))

def dummies(df, col, bins, labels, ref):
    cat = pd.cut(df[col], bins=bins, labels=labels, right=False); names = []
    for lab in labels:
        if lab == ref: continue
        nm = '%s[%s]' % (col, lab); df[nm] = (cat == lab).astype(float); df.loc[cat.isna(), nm] = np.nan; names.append(nm)
    return names

# ======================= 인명 =======================
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
pe['month'] = pe.date.str[4:6].astype(int); pe['season'] = pe.month.map(SEASON)
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
pr['season'] = pe.season.values[pr.ev.values]
pr['any_warn'] = (pr.anyw >= 1).astype(float)
pr['warn_주의보'] = (pr.anyw == 1).astype(float); pr['warn_경보'] = (pr.anyw == 2).astype(float)
for tt in ('wv', 'ty', 'gw'):
    pr[tt + '_any'] = (pr[tt] >= 1).astype(float)
PSUB = [('전체', None), ('익수', '익수'), ('추락', '추락'), ('고립', '고립'), ('표류', '표류'), ('사망·실종', 'FATAL')]
def ppick(df, t):
    if t is None: return df
    if t == 'FATAL': return df[pe.fatal.values[df.ev.values]]
    return df[df.type == t]
WB = [0, 0.5, 1.0, 1.5, 2.0, 99]; WL = ['0-0.5', '0.5-1', '1-1.5', '1.5-2', '2+']
SB = [0, 4, 6, 8, 10, 12, 99]; SL = ['0-4', '4-6', '6-8', '8-10', '10-12', '12+']
AB = [0, 3, 5, 7, 9, 11, 99]; AL = ['0-3', '3-5', '5-7', '7-9', '9-11', '11+']
for se_ in SEASONS + ['전체(계절 구분 없음)']:
    base = pr if se_.startswith('전체') else pr[pr.season == se_]
    for nm, t in PSUB:
        sub = ppick(base, t)
        add('인명', se_, 'P1_주말·공휴일(평일 대비)', nm, sub.copy(), ['weekend_or_hol'])
        add('인명', se_, 'P2_요일·공휴일(월요일 대비)', nm, sub.copy(), CAL)
        add('인명', se_, 'P3_특보유무(풍랑·태풍·강풍)+달력', nm, sub.copy(), ['any_warn'] + CAL)
        add('인명', se_, 'P4_특보최고수준+달력', nm, sub.copy(), ['warn_주의보', 'warn_경보'] + CAL)
        add('인명', se_, 'P5_특보종류별(풍랑·태풍·강풍 각각 유무)+달력', nm, sub.copy(), ['wv_any', 'ty_any', 'gw_any'] + CAL)
        s = sub.dropna(subset=['v_outsider']).copy(); s = s[s.v_outsider > 0]
        if len(s):
            s['log2_outsider'] = np.log2(s.v_outsider)
            add('인명', se_, 'P6_외지인방문자(2배당)+달력', nm, s.copy(), ['log2_outsider'] + CAL)
            s['rel'] = s.v_outsider / s.groupby('ev').v_outsider.transform('mean')
            rn = dummies(s, 'rel', [0, 0.8, 1.0, 1.2, 1.5, 99], ['<0.8', '0.8-1', '1-1.2', '1.2-1.5', '1.5+'], '0.8-1')
            add('인명', se_, 'P7_외지인(같은달평균대비)+달력', nm, s.copy(), rn + CAL)
            add('인명', se_, 'P8_특보+외지인방문자+달력', nm, s.copy(), ['any_warn', 'log2_outsider'] + CAL)
        nw = sub[sub.anyw == 0]
        q = nw.dropna(subset=['wh_max']).copy(); wn = dummies(q, 'wh_max', WB, WL, '0.5-1')
        add('인명', se_, 'P9_특보없는날_파고(일최대)+달력', nm, q, wn + CAL)
        q = nw.dropna(subset=['ws_max']).copy(); sn = dummies(q, 'ws_max', SB, SL, '4-6')
        add('인명', se_, 'P10_특보없는날_풍속(일최대)+달력', nm, q, sn + CAL)
        q = nw.dropna(subset=['aws_ws']).copy(); an = dummies(q, 'aws_ws', AB, AL, '3-5')
        add('인명', se_, 'P11_특보없는날_해안AWS풍속+달력', nm, q, an + CAL)
        q = nw.dropna(subset=['wh_max']).copy(); q['wh_per1m'] = q.wh_max
        add('인명', se_, 'P12_특보없는날_파고연속(1m당)+달력', nm, q, ['wh_per1m'] + CAL)
        q = nw.dropna(subset=['ws_max']).copy(); q['ws_per1ms'] = q.ws_max
        add('인명', se_, 'P13_특보없는날_풍속연속(1m/s당)+달력', nm, q, ['ws_per1ms'] + CAL)
    # 결합 4칸(전체만)
    s = base.dropna(subset=['v_outsider']).copy(); s = s[s.v_outsider > 0]
    if len(s):
        s['rel'] = s.v_outsider / s.groupby('ev').v_outsider.transform('mean'); s['hiV'] = (s.rel >= 1.2).astype(float)
        s['cell_lowV_warn'] = ((s.hiV == 0) & (s.any_warn == 1)).astype(float); s['cell_hiV_nowarn'] = ((s.hiV == 1) & (s.any_warn == 0)).astype(float)
        s['cell_hiV_warn'] = ((s.hiV == 1) & (s.any_warn == 1)).astype(float); s['hiV_x_warn'] = s.hiV * s.any_warn
        add('인명', se_, 'P14_특보×방문자 4칸+달력', '전체', s.copy(), ['cell_lowV_warn', 'cell_hiV_nowarn', 'cell_hiV_warn'] + CAL)
        add('인명', se_, 'P15_특보×방문자 상호작용+달력', '전체', s.copy(), ['any_warn', 'hiV', 'hiV_x_warn'] + CAL)
    ww = base[base.anyw >= 1].dropna(subset=['wh_max']).copy(); wn = dummies(ww, 'wh_max', [0, 2, 3, 99], ['<2', '2-3', '3+'], '<2')
    add('인명', se_, 'P16_특보있는날만_파고+달력', '전체', ww, wn + CAL)
    ww = base[base.anyw >= 1].dropna(subset=['ws_max']).copy(); sn = dummies(ww, 'ws_max', [0, 10, 14, 99], ['<10', '10-14', '14+'], '<10')
    add('인명', se_, 'P17_특보있는날만_풍속+달력', '전체', ww, sn + CAL)
    print('person', se_, flush=True)

# ======================= 선박 =======================
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sg['month'] = sg.date.str[4:6].astype(int); sg['season'] = sg.month.map(SEASON)
TYPES = ['전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌']
for t in TYPES: sg['is_' + t] = sg.types.str.split('|').apply(lambda x: t in x)
sg['is_SENS'] = sg.is_전복 | sg.is_침몰 | sg.is_침수 | sg.is_표류; sg['is_TRAF'] = sg.is_충돌 | sg.is_접촉
SSUB = [('전체', None)] + [(t, t) for t in TYPES] + [('기상민감4종(전복·침몰·침수·표류)', 'SENS'), ('충돌·접촉', 'TRAF')]
SWB = [0, 0.5, 1.0, 1.5, 2.0, 99]; SWL = ['0-0.5', '0.5-1', '1-1.5', '1.5-2', '2+']
SSB = [0, 4, 6, 8, 10, 12, 99]; SSL = ['0-4', '4-6', '6-8', '8-10', '10-12', '12+']
for mode, whc, wsc in (('day', 'wh_max', 'ws_max'), ('time', 'wh', 'ws')):
    tag = '일' if mode == 'day' else '시각'
    rows = pd.read_csv(R + '/ship_strata_rows_%s.csv.gz' % mode)
    rows['season'] = sg.season.values[rows.ev.values]
    rows['any_warn'] = (rows.seaw >= 1).astype(float); rows['warn_주의보'] = (rows.seaw == 1).astype(float); rows['warn_경보'] = (rows.seaw == 2).astype(float)
    rows['weekend_or_hol'] = ((rows.dow >= 5) | (rows.hol == 1)).astype(float)
    for se_ in SEASONS + ['전체(계절 구분 없음)']:
        base = rows if se_.startswith('전체') else rows[rows.season == se_]
        for nm, t in SSUB:
            sub = base if t is None else base[sg['is_' + t].values[base.ev.values]]
            if mode == 'day':
                add('선박', se_, 'S%s1_주말·공휴일(평일 대비)' % tag, nm, sub.copy(), ['weekend_or_hol'])
                add('선박', se_, 'S%s2_요일·공휴일(월요일 대비)' % tag, nm, sub.copy(), CAL)
            add('선박', se_, 'S%s3_특보유무(풍랑·태풍)+달력' % tag, nm, sub.copy(), ['any_warn'] + CAL)
            add('선박', se_, 'S%s4_특보최고수준+달력' % tag, nm, sub.copy(), ['warn_주의보', 'warn_경보'] + CAL)
            nw = sub[sub.seaw == 0]
            q = nw.dropna(subset=[whc]).copy(); wn = dummies(q, whc, SWB, SWL, '0.5-1')
            add('선박', se_, 'S%s5_특보없는때_파고+달력' % tag, nm, q, wn + CAL)
            q = nw.dropna(subset=[wsc]).copy(); sn = dummies(q, wsc, SSB, SSL, '4-6')
            add('선박', se_, 'S%s6_특보없는때_풍속+달력' % tag, nm, q, sn + CAL)
            ww = sub[sub.seaw >= 1].dropna(subset=[whc]).copy(); wn = dummies(ww, whc, [0, 2, 3, 99], ['<2', '2-3', '3+'], '<2')
            add('선박', se_, 'S%s7_특보있는때만_파고+달력' % tag, nm, ww, wn + CAL)
            ww = sub[sub.seaw >= 1].dropna(subset=[wsc]).copy(); sn = dummies(ww, wsc, [0, 10, 14, 99], ['<10', '10-14', '14+'], '<10')
            add('선박', se_, 'S%s8_특보있는때만_풍속+달력' % tag, nm, ww, sn + CAL)
        print('ship', mode, se_, flush=True)
res = pd.DataFrame(out)
res[res.group == '인명'].to_csv(R + '/season_person_models.csv', index=False, encoding='utf-8-sig')
res[res.group == '선박'].to_csv(R + '/season_ship_models.csv', index=False, encoding='utf-8-sig')

print('done', len(res))
