"""인명사고 — 시간층화 사례교차(= 조건부 포아송) 분석.
층 = 사고 1건 × 그 사고의 (연,월) [월 효과만 (연) 층]. 같은 장소·같은 달의 '사고 난 날' 노출을 '안 난 날' 노출과 비교한다.
  → 결과 RR = 같은 장소·같은 달에서 '조건 있는 날 하루당 사고 수 ÷ 조건 없는 날 하루당 사고 수'.
노출(사고 지점에 붙은 것): 해상특보(풍랑·태풍, 사고의 해상특보구역) · 강풍특보(사고의 육상구역 → 2017~2025 통보문 이름) ·
  대해구 일 최대 파고·풍속(KST) · 해안 AWS 일 최대 풍속 · 시군구 일별 방문자(외지인) · 요일 · 공휴일.
결측(해구 발표 공백일 등)은 그 날을 층에서 빼서 분모·분자 모두에서 제외한다.
사용: python3 -I 07_person.py <data_dir> <out_dir>
"""
import sys, os, json, collections, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr

D, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str, 'aws': str, 'gw_keys': str, 'sea_zone': str})
pe['gw_keys'] = pe['gw_keys'].fillna('')
pe = pe[pe.sea_zone.notna()].reset_index(drop=True)          # 해상특보구역 3km 밖 4건 제외
print('events', len(pe), pe.type.value_counts().to_dict())
ex = expo.load_exact(D + '/warn_intervals_exact.json')
sea_z = sorted(pe.sea_zone.unique())
gw_z = sorted({k for ks in pe.gw_keys for k in ks.split('|') if k})
W = expo.daily_warn(ex, [expo.norm(z) for z in sea_z] + gw_z)
dow, hol, month, year = expo.calendar()
mzi, M = expo.load_marine_daily(D + '/marine_daily.csv.gz')
aws_st = sorted(pe.aws.dropna().unique())
azi, A, Ad = expo.load_aws_daily(D + '/aws_daily_all.csv.gz', aws_st)
vis = None
if os.path.exists(D + '/visitors_daily_coastal.csv.gz'):
    v = pd.read_csv(D + '/visitors_daily_coastal.csv.gz', dtype={'sgg': str, 'date': str})
    v = v[v.date.isin(expo.DIDX)]
    vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
    vis = {}
    for col in ('local', 'outsider', 'foreign'):
        a = np.full((len(vzi), expo.ND), np.nan, np.float32)
        a[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v[col].values
        vis[col] = a

# ---------- 사건별 층(연월) 행 만들기 ----------
def build_rows(stratum='ym'):
    recs = collections.defaultdict(list)
    for k, r in pe.iterrows():
        ci = expo.DIDX[r.date]
        if stratum == 'ym':
            days = np.where((year == year[ci]) & (month == month[ci]))[0]
        else:
            days = np.where(year == year[ci])[0]
        n = len(days)
        sz = expo.norm(r.sea_zone)
        wv = W[sz]['WV']; ty = W[sz]['TY']
        gl = np.zeros(expo.ND, np.int8); gh = np.zeros(expo.ND, np.float32); gdh = np.zeros(expo.ND, np.float32)
        for key in [x for x in r.gw_keys.split('|') if x]:
            gl = np.maximum(gl, W[key]['GW']['lvl']); gh = np.maximum(gh, W[key]['GW']['hours']); gdh = np.maximum(gdh, W[key]['GW']['dayh'])
        mz = mzi.get(int(r.mzone))
        ai = azi.get(str(r.aws)) if isinstance(r.aws, str) else None
        recs['ev'].append(np.full(n, k)); recs['day'].append(days); recs['case'].append((days == ci).astype(np.int8))
        recs['wv'].append(wv['lvl'][days]); recs['ty'].append(ty['lvl'][days]); recs['gw'].append(gl[days])
        recs['wv_dh'].append(wv['dayh'][days]); recs['ty_dh'].append(ty['dayh'][days]); recs['gw_dh'].append(gdh[days])
        for col in ('wh_max', 'ws_max', 'wh_day_max', 'ws_day_max'):
            recs[col].append(M[col][mz, days] if mz is not None else np.full(n, np.nan))
        recs['aws_ws'].append(A[ai, days] if ai is not None else np.full(n, np.nan))
        if vis is not None:
            vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
            for col in ('local', 'outsider', 'foreign'):
                recs['v_' + col].append(vis[col][vi, days] if vi is not None else np.full(n, np.nan))
    df = pd.DataFrame({c: np.concatenate(v) for c, v in recs.items()})
    df['dow'] = dow[df.day.values]; df['hol'] = hol[df.day.values].astype(int); df['month'] = month[df.day.values]
    df['type'] = pe.type.values[df.ev.values]; df['sea_zone'] = pe.sea_zone.values[df.ev.values]
    df['ym'] = year[df.day.values] * 100 + month[df.day.values]
    df['cl'] = df['sea_zone'] + '_' + (year[pe.date.map(expo.DIDX).values][df.ev.values] * 100 + month[pe.date.map(expo.DIDX).values][df.ev.values]).astype(str)
    df['anyw'] = np.maximum(np.maximum(df.wv, df.ty), df.gw)
    df['seaw'] = np.maximum(df.wv, df.ty)
    return df

rows = build_rows('ym')
print('rows', len(rows), 'cases', rows.case.sum())
results = []
def add(model, subset, df, cols, extra_info=None, cluster='cl'):
    df = df.dropna(subset=[c for c in cols])
    X = df[cols].values.astype(float)
    if df.case.sum() < 5:
        return None
    # 층 안에서 값이 전혀 안 변하는 열 → 추정 불가 표시
    r = ccr.fit(df.ev.values, df.case.values, X, cluster=df[cluster].values, names=cols)
    for t in ccr.table(r):
        col = t['term']
        cases_on = int(df.loc[df.case == 1, col].sum()) if set(np.unique(df[col])) <= {0, 1} else np.nan
        refs_on = float(df.loc[df.case == 0, col].mean()) if set(np.unique(df[col])) <= {0, 1} else np.nan
        results.append(dict(model=model, subset=subset, term=col, RR=t['RR'], lo=t['lo'], hi=t['hi'], p=t['p'],
                            n_events=int(r['n_events']), n_strata=r['n_strata'], cases_with=cases_on, ref_share=refs_on,
                            **(extra_info or {})))
    return r

def dummies(df, col, bins, labels, ref):
    cat = pd.cut(df[col], bins=bins, labels=labels, right=False)
    names = []
    for lab in labels:
        if lab == ref: continue
        nm = '%s[%s]' % (col, lab); df[nm] = (cat == lab).astype(float); df.loc[cat.isna(), nm] = np.nan; names.append(nm)
    return names

subsets = [('전체', None), ('익수', '익수'), ('추락', '추락'), ('고립', '고립'), ('표류', '표류'), ('변사', '변사'), ('사망·실종', 'FATAL'), ('변사제외', 'NOBYUNSA')]
pe['fatal'] = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0)
def pick(df, t):
    if t is None: return df
    if t == 'FATAL': return df[pe.fatal.values[df.ev.values]]
    if t == 'NOBYUNSA': return df[df.type != '변사']
    return df[df.type == t]
cal = []
for d_ in range(1, 7):
    rows['dow%d' % d_] = (rows.dow == d_).astype(float); cal.append('dow%d' % d_)
rows['hol'] = rows.hol.astype(float)
CAL = cal + ['hol']
rows['weekend_or_hol'] = ((rows.dow >= 5) | (rows.hol == 1)).astype(float)

for nm, t in subsets:
    sub = pick(rows, t)
    # A1 달력
    add('A1_달력(요일+공휴일)', nm, sub.copy(), CAL)
    add('A1b_주말·공휴일', nm, sub.copy(), ['weekend_or_hol'])
    # A2 특보(전체 유무) — 달력 보정
    s2 = sub.copy(); s2['any_warn'] = (s2.anyw >= 1).astype(float)
    add('A2_특보유무(풍랑·태풍·강풍 중 하나)', nm, s2, ['any_warn'] + CAL)
    # A3 특보 종류·수준(같은 날 여러 종류면 각각 1)
    s3 = sub.copy()
    for tt in ('wv', 'ty', 'gw'):
        s3[tt + '_주의보'] = (s3[tt] == 1).astype(float); s3[tt + '_경보'] = (s3[tt] == 2).astype(float)
    add('A3_특보종류·수준', nm, s3, ['wv_주의보', 'wv_경보', 'ty_주의보', 'ty_경보', 'gw_주의보', 'gw_경보'] + CAL)
    # A3b 수준만(최고 수준)
    s3b = sub.copy(); s3b['warn_주의보'] = (s3b.anyw == 1).astype(float); s3b['warn_경보'] = (s3b.anyw == 2).astype(float)
    add('A3b_특보최고수준', nm, s3b, ['warn_주의보', 'warn_경보'] + CAL)
    # A3c 낮 시간 발효 길이(06~18시 중 발효 시간, 종류 중 최대)
    s3c = sub.copy(); dh = np.maximum(np.maximum(s3c.wv_dh, s3c.ty_dh), s3c.gw_dh)
    s3c['dh_0_<6h'] = ((s3c.anyw >= 1) & (dh < 6)).astype(float); s3c['dh_6h+'] = ((s3c.anyw >= 1) & (dh >= 6)).astype(float)
    add('A3c_특보_낮발효시간', nm, s3c, ['dh_0_<6h', 'dh_6h+'] + CAL)

# ---------- 특보 없는 날만: 파고·풍속 ----------
WB = [0, 0.5, 1.0, 1.5, 2.0, 99]; WL = ['0-0.5', '0.5-1', '1-1.5', '1.5-2', '2+']
SB = [0, 4, 6, 8, 10, 12, 99]; SL = ['0-4', '4-6', '6-8', '8-10', '10-12', '12+']
AB = [0, 3, 5, 7, 9, 11, 99]; AL = ['0-3', '3-5', '5-7', '7-9', '9-11', '11+']
nw = rows[rows.anyw == 0].copy()
print('non-warning rows', len(nw), 'cases', nw.case.sum())
for nm, t in subsets:
    sub = pick(nw, t)
    s = sub.dropna(subset=['wh_max']).copy(); wn = dummies(s, 'wh_max', WB, WL, '0.5-1')
    add('B1_특보없는날_파고(일최대)', nm, s, wn + CAL)
    s = sub.dropna(subset=['ws_max']).copy(); sn = dummies(s, 'ws_max', SB, SL, '4-6')
    add('B2_특보없는날_풍속(일최대)', nm, s, sn + CAL)
    s = sub.dropna(subset=['wh_max', 'ws_max']).copy(); wn = dummies(s, 'wh_max', WB, WL, '0.5-1'); sn = dummies(s, 'ws_max', SB, SL, '4-6')
    add('B3_특보없는날_파고+풍속동시', nm, s, wn + sn + CAL)
    s = sub.dropna(subset=['wh_max']).copy(); s['wh_per1m'] = s.wh_max
    add('B4_특보없는날_파고연속(1m당)', nm, s, ['wh_per1m'] + CAL)
    s = sub.dropna(subset=['ws_max']).copy(); s['ws_per1ms'] = s.ws_max
    add('B5_특보없는날_풍속연속(1m/s당)', nm, s, ['ws_per1ms'] + CAL)
    s = sub.dropna(subset=['aws_ws']).copy(); an = dummies(s, 'aws_ws', AB, AL, '3-5')
    add('B6_특보없는날_해안AWS풍속(일최대)', nm, s, an + CAL)
    s = sub.dropna(subset=['wh_day_max']).copy(); wn = dummies(s, 'wh_day_max', WB, WL, '0.5-1')
    add('B7_특보없는날_파고(낮06~18최대)', nm, s, wn + CAL)

# ---------- 특보 있는 날 안에서 파고 추가효과 ----------
ww = rows[rows.anyw >= 1].dropna(subset=['wh_max']).copy()
for nm, t in subsets[:1]:
    s = ww.copy(); wn = dummies(s, 'wh_max', [0, 2, 3, 4, 99], ['<2', '2-3', '3-4', '4+'], '<2')
    add('C1_특보있는날만_파고', nm, s, wn + CAL)
    s = ww.dropna(subset=['ws_max']).copy(); sn = dummies(s, 'ws_max', [0, 10, 14, 17, 99], ['<10', '10-14', '14-17', '17+'], '<10')
    add('C2_특보있는날만_풍속', nm, s, sn + CAL)
# 특보 없는 날 + 특보 있는 날 한 모형: 바다·날씨 축(파고 등급 vs 특보)
s = rows.dropna(subset=['wh_max']).copy()
s['nw_wh_1.5-2'] = ((s.anyw == 0) & (s.wh_max >= 1.5) & (s.wh_max < 2)).astype(float)
s['nw_wh_2-3'] = ((s.anyw == 0) & (s.wh_max >= 2) & (s.wh_max < 3)).astype(float)
s['nw_wh_3+'] = ((s.anyw == 0) & (s.wh_max >= 3)).astype(float)
s['w_주의보'] = (s.anyw == 1).astype(float); s['w_경보'] = (s.anyw == 2).astype(float)
for nm, t in subsets:
    ss = pick(s, t)
    add('C3_축(특보없음 파고구간 vs 특보)', nm, ss.copy(), ['nw_wh_1.5-2', 'nw_wh_2-3', 'nw_wh_3+', 'w_주의보', 'w_경보'] + CAL)

# ---------- 방문자 ----------
if vis is not None:
    for nm, t in subsets:
        sub = pick(rows, t)
        s = sub.dropna(subset=['v_outsider']).copy(); s = s[s.v_outsider > 0]
        s['log2_outsider'] = np.log2(s.v_outsider)
        add('D1_외지인방문자(2배당)', nm, s, ['log2_outsider'])
        add('D2_외지인방문자(2배당)+달력', nm, s.copy(), ['log2_outsider'] + CAL)
        s['log2_total'] = np.log2(s.v_local.fillna(0) + s.v_outsider + s.v_foreign.fillna(0))
        add('D3_전체방문자(2배당)+달력', nm, s.copy(), ['log2_total'] + CAL)
        # 같은 시군구-같은 달 평균 대비 상대값 구간
        s['rel'] = s.v_outsider / s.groupby('ev').v_outsider.transform('mean')
        rn = dummies(s, 'rel', [0, 0.8, 1.0, 1.2, 1.5, 99], ['<0.8', '0.8-1', '1-1.2', '1.2-1.5', '1.5+'], '0.8-1')
        add('D4_외지인(같은달평균대비)', nm, s.copy(), rn)
        add('D4b_외지인(같은달평균대비)+달력', nm, s.copy(), rn + CAL)
    # 특보 + 방문자 동시(특보 효과가 '사람이 안 나와서'로 얼마나 설명되나)
    s = rows.dropna(subset=['v_outsider']).copy(); s = s[s.v_outsider > 0]; s['log2_outsider'] = np.log2(s.v_outsider)
    s['any_warn'] = (s.anyw >= 1).astype(float)
    add('D5_특보+외지인방문자', '전체', s.copy(), ['any_warn', 'log2_outsider'] + CAL)
    s['rel'] = s.v_outsider / s.groupby('ev').v_outsider.transform('mean')
    s['hiV'] = (s.rel >= 1.2).astype(float)
    s['hiV_x_warn'] = s.hiV * s.any_warn
    add('D7_특보×방문자많은날(같은달평균 1.2배↑) 상호작용', '전체', s.copy(), ['any_warn', 'hiV', 'hiV_x_warn'] + CAL)
    s['cell_lowV_warn'] = ((s.hiV == 0) & (s.any_warn == 1)).astype(float); s['cell_hiV_nowarn'] = ((s.hiV == 1) & (s.any_warn == 0)).astype(float)
    s['cell_hiV_warn'] = ((s.hiV == 1) & (s.any_warn == 1)).astype(float)
    add('D8_특보×방문자 4칸(기준: 방문자 보통·특보 없음)', '전체', s.copy(), ['cell_lowV_warn', 'cell_hiV_nowarn', 'cell_hiV_warn'] + CAL)
    s2 = s.dropna(subset=['wh_max']).copy(); s2 = s2[s2.anyw == 0]; wn = dummies(s2, 'wh_max', WB, WL, '0.5-1')
    add('D6_특보없는날_파고+외지인방문자', '전체', s2, wn + ['log2_outsider'] + CAL)

res = pd.DataFrame(results)
res.to_csv(OUT + '/person_models.csv', index=False, encoding='utf-8-sig')
print('saved', len(res))

# ---------- 월 효과(층 = 사고 × 연) ----------
ry = build_rows('y')
for m_ in range(1, 13):
    ry['m%02d' % m_] = (ry.month == m_).astype(float)
for d_ in range(1, 7): ry['dow%d' % d_] = (ry.dow == d_).astype(float)
ry['hol'] = ry.hol.astype(float)
results = []
for nm, t in subsets:
    sub = pick(ry, t)
    add('M1_월(기준 1월)+달력', nm, sub.copy(), ['m%02d' % m_ for m_ in range(2, 13)] + CAL)
    if vis is not None:
        s = sub.dropna(subset=['v_outsider']).copy(); s = s[s.v_outsider > 0]; s['log2_outsider'] = np.log2(s.v_outsider)
        add('M2_월+외지인방문자+달력', nm, s, ['m%02d' % m_ for m_ in range(2, 13)] + ['log2_outsider'] + CAL)
pd.DataFrame(results).to_csv(OUT + '/person_month_models.csv', index=False, encoding='utf-8-sig')
# 진단용 행 표본 저장(재현)
rows.to_csv(OUT + '/person_strata_rows.csv.gz', index=False, compression='gzip')
print('done')
