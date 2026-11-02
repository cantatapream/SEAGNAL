"""2~3일 뒤 예보로 본 '특보급 날씨' — 미리 본 예보가 실제 특보를 얼마나 맞히나, 그 날 사고는 몇 배인가.
v3 §7 표는 '그 날 당일 예측값'으로만 만들었다(보고서 한계 "2~3일째는 오차가 더 클 것 — 재지 못함").
원자료 zip 에 72시간 앞 예보까지 있어(01b_marine_fcst_leads.py → data/marine_fcst_daily.csv.gz) 이제 잴 수 있다.
lead_day 0 = 전날 21시 KST 발표 예보(3~24시간 앞), 1 = 이틀 전 발표(27~48시간 앞), 2 = 사흘 전 발표(51~72시간 앞).
 ① 정밀도·포착률: 14b_warn_equiv_alldays.py 와 같은 (연안 앞바다 구역 × 대해구) 쌍, 2020-01-02~2025-12-28, 세 lead 모두 값이 있는 날만.
 ② 사고 배수: "그 날을 k일 전 예보가 기준 이상으로 봤는가"를 노출로(실제 특보 여부와 무관 — 앱이 실제로 쓸 신호),
    선박 기상민감 4종(층 = 사고 × 연월, 일 단위)·연안 인명(층 = 사고 × 연월), 요일·공휴일 보정, 군집 = 사고 날짜.
사용: python3 -I 32_fcst_leads.py <data_dir> <results_dir> > results/fcst_leads.md
"""
import sys, os
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R = sys.argv[1:3]
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
CRIT = ((1.5, 10), (2.0, 12), (2.5, 14), (3.0, 17), (4.0, 17))
f = pd.read_csv(D + '/marine_fcst_daily.csv.gz', dtype={'target_date': str})
f = f[f.target_date.isin(expo.DIDX)]; f['d'] = f.target_date.map(expo.DIDX)
zones = sorted(f.zone.unique()); zi = {z: i for i, z in enumerate(zones)}
WH = np.full((3, len(zones), expo.ND), np.nan, np.float32); WS = WH.copy()
WH[f.lead_day.values, f.zone.map(zi).values, f.d.values] = f.wh_max.values; WS[f.lead_day.values, f.zone.map(zi).values, f.d.values] = f.ws_max.values
LAB = {0: '하루 전 예보(3~24시간 앞)', 1: '이틀 전 예보(27~48시간 앞)', 2: '사흘 전 예보(51~72시간 앞)'}
# ① 정밀도·포착률
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz', usecols=['ev']); pr0 = pd.read_csv(R + '/person_strata_rows.csv.gz', usecols=['ev'])
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
se = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str}); se = se[se.sea_zone.notna()].reset_index(drop=True)
pairs = set(zip(se.sea_zone.values[sr.ev.unique()], se.mzone.values[sr.ev.unique()])) | set(zip(pe.sea_zone.values[pr0.ev.unique()], pe.mzone.values[pr0.ev.unique()]))
pairs = sorted((z, int(m)) for z, m in pairs if str(z).endswith('앞바다'))
ex = expo.load_exact(D + '/warn_intervals_exact.json')
W = expo.daily_warn(ex, sorted({expo.norm(z) for z, _ in pairs}), types=('TY', 'WV'))
last = expo.DIDX['20251228']; parts = []
for z, m in pairs:
    if m not in zi: continue
    zz = expo.norm(z); seaw = np.maximum(W[zz]['WV']['lvl'], W[zz]['TY']['lvl'])[1:last + 1]
    a = dict(seaw=seaw)
    for k in range(3): a['wh%d' % k] = WH[k, zi[m], 1:last + 1]; a['ws%d' % k] = WS[k, zi[m], 1:last + 1]
    parts.append(pd.DataFrame(a))
u = pd.concat(parts); u = u.dropna()
nw, nk = (u.seaw >= 1).sum(), (u.seaw == 2).sum()
out = ['#### ① 예보로 본 특보급 기준 — 실제 특보와의 일치(연안 앞바다 구역 × 대해구 × 날짜, 2020-01-02~2025-12-28, 세 예보 모두 있는 %d 구역-일 · 특보일 %d · 경보일 %d)\n' % (len(u), nw, nk),
       '정밀도 = 기준에 걸린 날 중 실제로 특보(주의보 이상)였던 비율 · 포착률 = 실제 특보일 중 기준에 걸린 비율.\n',
       '| 기준 | 예보 | 걸린 구역-일 | 정밀도(특보) | 정밀도(경보) | 포착률(특보일) | 포착률(경보일) |', '|---|---|---|---|---|---|---|']
for A, B in CRIT:
    for k in range(3):
        m = (u['wh%d' % k] >= A) | (u['ws%d' % k] >= B)
        out.append('| 파고≥%g 또는 풍속≥%g | %s | %d | %.1f%% | %.1f%% | %.1f%% | %.1f%% |' % (A, B, LAB[k], m.sum(), 100 * (u.seaw[m] >= 1).mean(), 100 * (u.seaw[m] == 2).mean(),
                                                                                    100 * ((u.seaw >= 1) & m).sum() / nw, 100 * ((u.seaw == 2) & m).sum() / nk))
out.append('')
# ② 사고 배수
def fl(mz, day, k, A, B):
    i = np.array([zi.get(int(x), -1) if pd.notna(x) else -1 for x in mz]); ok = i >= 0
    v = np.full(len(day), np.nan)
    wh = WH[k, np.maximum(i, 0), day]; ws = WS[k, np.maximum(i, 0), day]
    v[ok] = ((wh >= A) | (ws >= B))[ok].astype(float); v[ok & (np.isnan(wh) | np.isnan(ws))] = np.nan
    return v
sd = pd.read_csv(R + '/ship_strata_rows_day.csv.gz'); sens = se.types.str.contains('전복|침몰|침수|표류').values; sd = sd[sens[sd.ev.values]]
sfat = ((se.death.fillna(0) + se.missing.fillna(0)) > 0).values
sd_all = pd.read_csv(R + '/ship_strata_rows_day.csv.gz'); traf = se.types.str.contains('충돌|접촉').values; st_tr = sd_all[traf[sd_all.ev.values]]
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pe['fatal'] = (pe.death.fillna(0) + pe.missing.fillna(0)) > 0
out += ['#### ② 예보가 특보급으로 본 날의 사고 배수(실제 특보 여부와 무관, 기준 = 예보가 기준 미만으로 본 날, 같은 장소·같은 달)\n',
        '| 대상 | 기준 | ' + ' | '.join(LAB[k] for k in range(3)) + ' |', '|---|---|---|---|---|']
for lab, df, mzs in (('선박 기상민감 4종', sd, se.mzone.values), ('선박 기상민감 4종 사망·실종', sd[sfat[sd.ev.values]], se.mzone.values), ('선박 충돌·접촉', st_tr, se.mzone.values), ('연안 인명 전체', pr, pe.mzone.values), ('연안 사망·실종', pr[pe.fatal.values[pr.ev.values]], pe.mzone.values)):
    for A, B in ((2.0, 12), (2.5, 14), (4.0, 17)):
        cells = []
        for k in range(3):
            q = df.copy(); q['x'] = fl(mzs[q.ev.values], q.day.values, k, A, B); q = q.dropna(subset=['x'])
            n = int(((q.case == 1) & (q.x == 1)).sum())
            if n < 5: cells.append('추정 보류(%d건)' % n); continue
            t = ccr.table(ccr.fit(q.ev.values, q.case.values, q[['x'] + CAL].values.astype(float), cluster=q.cl.values, names=['x'] + CAL))[0]
            cells.append('%.2f (%.2f–%.2f) [%d]' % (t['RR'], t['lo'], t['hi'], n))
        out.append('| %s | 파고≥%g 또는 풍속≥%g | %s |' % (lab, A, B, ' | '.join(cells)))
out.append('\n칸 = 배수 (95% 신뢰구간) [기준에 걸린 날 난 사고 수].')
print('\n'.join(out))
