"""너울(파도 주기) — 과거 보고서에 없던 요인(사용자 지시 2026-10-10: "우리의 예측에는 너울이 들어가니까(연안) 그거에 따른 약간의 가중치를 주는게 좋겠어").
과거 '너울' 자료 자체는 없다. 대신 해구 파랑 예측의 **주기(wp, 초)** 를 쓴다 — 주기가 긴 파도(10초 이상)는 멀리서 온 너울이다.
같은 높이라도 주기가 길면 해안에 부딪혀 크게 올라온다(동해안 '너울성 파도'). 그래서 **파고를 같이 보정**하고 주기만의 몫을 본다.
연안(인명, 변사 제외): 층 = 사고 × 연월(07_person.py 와 같은 행), 노출 = 사고 해구의 그 날 최대 주기 구간, 파고(일 최대) 구간·요일·공휴일 보정.
  ① 특보 없는 날만 ② 모든 날(특보 여부 보정). 결과는 전체·유형·사망실종·동해안/그 밖.
선박(기상민감 4종): 사고 시각에 가장 가까운 3시간 칸의 주기, 특보 없는 때, 파고 보정(08_ship.py 시각 맞춤 행).
군집 = 사고 날짜. 사용: python3 -I 30_swell.py <data_dir> <results_dir> > results/swell.md
"""
import sys, os, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R = sys.argv[1:3]
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
m3 = np.load(D + '/marine_3h.npz'); t3 = m3['times']; z3 = {int(z): i for i, z in enumerate(m3['zones'])}; wp3 = m3['wp']; lead3 = m3['lead']
wp3 = np.where((lead3 != 99)[:, None], wp3, np.nan)
# 3시간 칸(UTC) → KST 날짜 인덱스, 날짜별 최대 주기
kst = [dt.datetime.strptime(str(t), '%Y%m%d%H') + dt.timedelta(hours=9) for t in t3]
di = np.array([expo.DIDX.get(k.strftime('%Y%m%d'), -1) for k in kst])
WPD = np.full((len(z3), expo.ND), np.nan, np.float32)
for d in np.unique(di[di >= 0]):
    with np.errstate(all='ignore'): WPD[:, d] = np.nanmax(wp3[di == d], axis=0)
PB = [0, 6, 8, 10, 12, 99]; PL = ['<6', '6-8', '8-10', '10-12', '12+']
WB = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 99]; WL = ['0-0.5', '0.5-1', '1-1.5', '1.5-2', '2-2.5', '2.5-3', '3-4', '4+']
def dummies(df, col, bins, labels, ref):
    cat = pd.cut(df[col], bins=bins, labels=labels, right=False); names = []
    for lab in labels:
        if lab == ref: continue
        nm = '%s[%s]' % (col, lab); df[nm] = (cat == lab).astype(float); names.append(nm)
    return names
out = []
def run(title, df, extra=()):
    df = df.dropna(subset=['wp', 'wh']).copy()
    pn = dummies(df, 'wp', PB, PL, '<6'); wn = dummies(df, 'wh', WB, WL, '0.5-1')
    r = ccr.fit(df.ev.values, df.case.values, df[pn + wn + list(extra) + CAL].values.astype(float), cluster=df.cl.values, names=pn + wn + list(extra) + CAL)
    t = {x['term']: x for x in ccr.table(r)}
    cells = []
    for nm in pn:
        k = int(((df.case == 1) & (df[nm] == 1)).sum())
        cells.append('추정 보류(%d건)' % k if k < 5 else '%.2f (%.2f–%.2f) [%d]%s' % (t[nm]['RR'], t[nm]['lo'], t[nm]['hi'], k, ' ‡' if t[nm]['hi'] / t[nm]['lo'] >= 20 else ''))
    out.append('| %s | %d | %s |' % (title, int(df.case.sum()), ' | '.join(cells)))

# 연안
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
EAST = pe.sea_zone.str.contains('강원|경북|울산|동해').values
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
zi = np.array([z3.get(int(x), -1) if pd.notna(x) else -1 for x in pe.mzone])[pr.ev.values]
pr['wp'] = np.where(zi >= 0, WPD[np.maximum(zi, 0), pr.day.values], np.nan); pr['wh'] = pr.wh_max
pr['w1'] = (pr.anyw == 1).astype(float); pr['w2'] = (pr.anyw == 2).astype(float)
out += ['#### 너울(파도 주기) — 연안 인명사고(변사 제외), 주기 6초 미만 대비 · 파고(일 최대) 보정\n',
        '칸 = 배수 (95% 신뢰구간) [그 구간에서 난 사고 수]. 주기 = 사고 해구 그 날 최대 주기(해구 파랑 예측).\n',
        '| 묶음 | 모형에 든 사고 | ' + ' | '.join('주기 %s초' % l for l in PL[1:]) + ' |', '|---|---|' + '---|' * 4]
nw = pr[pr.anyw == 0]
for lab, m_ in (('특보 없는 날 · 전체', None), ('특보 없는 날 · 동해안(강원·경북·울산)', 'E'), ('특보 없는 날 · 동해안 밖', 'W'),
                ('특보 없는 날 · 익수', '익수'), ('특보 없는 날 · 추락', '추락'), ('특보 없는 날 · 고립', '고립'), ('특보 없는 날 · 표류', '표류'), ('특보 없는 날 · 사망·실종', 'F')):
    s = nw
    if m_ == 'E': s = nw[EAST[nw.ev.values]]
    elif m_ == 'W': s = nw[~EAST[nw.ev.values]]
    elif m_ == 'F': s = nw[pe.fatal.values[nw.ev.values]]
    elif m_: s = nw[nw.type == m_]
    run(lab, s)
run('모든 날(특보 주의보·경보 보정) · 전체', pr, extra=('w1', 'w2'))
run('모든 날(특보 보정) · 동해안', pr[EAST[pr.ev.values]], extra=('w1', 'w2'))
# 주기 분포(연안 사고일 대비 비교일)
cs = pr[pr.case == 1].wp; out.append('\n연안 사고일의 주기 분포: ' + ' · '.join('%s초 %.1f%%' % (l, 100 * ((cs >= a) & (cs < b)).mean()) for l, a, b in zip(PL, PB[:-1], PB[1:])) + '\n')

# 선박
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sens = sg.types.str.contains('전복|침몰|침수|표류').values
st = pd.read_csv(R + '/ship_strata_rows_time.csv.gz')
T0 = dt.datetime(2019, 12, 31, 15)
hm = sg.hm.values[st.ev.values]
whens = [expo.DATES[d].to_pydatetime() + dt.timedelta(hours=int(h.split(":")[0]), minutes=int(h.split(":")[1])) - dt.timedelta(hours=9) for d, h in zip(st.day.values, hm)]
sl = np.array([int(round((w - T0).total_seconds() / 10800)) for w in whens])
zz = np.array([z3.get(int(x), -1) if pd.notna(x) else -1 for x in sg.mzone])[st.ev.values]
ok = (sl >= 0) & (sl < len(t3)) & (zz >= 0)
st['wp'] = np.nan; st.loc[ok, 'wp'] = wp3[sl[ok], zz[ok]]
out += ['#### 너울(파도 주기) — 선박사고, 사고 시각 맞춤, 특보 없는 때, 주기 6초 미만 대비 · 파고 보정\n',
        '| 묶음 | 모형에 든 사고 | ' + ' | '.join('주기 %s초' % l for l in PL[1:]) + ' |', '|---|---|' + '---|' * 4]
nws = st[st.seaw == 0]
run('기상민감 4종(전복·침몰·침수·표류)', nws[sens[nws.ev.values]])
run('충돌·접촉', nws[sg.types.str.contains('충돌|접촉').values[nws.ev.values]])
print('\n'.join(out))
