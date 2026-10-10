"""민감도: (1) 인명 — 해상특보구역 폴리곤 안 사고만 (2) 인명 — 해안선 300m 근처(위험구역 3km 개수 ≥1 인 곳) 등 하위집단 (3) 인명 — 2023~2024만
사용: python3 -I 15_sensitivity.py <data_dir> <results_dir>
"""
import sys, os
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccr
D, R = sys.argv[1:3]
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
for d_ in range(1, 7): pr['dow%d' % d_] = (pr.dow == d_).astype(float)
CAL = ['dow%d' % d_ for d_ in range(1, 7)] + ['hol']
pr['any_warn'] = (pr.anyw >= 1).astype(float)
out = []
def run(lbl, df, cols):
    df = df.dropna(subset=cols)
    r = ccr.fit(df.ev.values, df.case.values, df[cols].values.astype(float), cluster=df.cl.values, names=cols)
    for t in ccr.table(r):
        if t['term'] in CAL: continue
        out.append(dict(analysis=lbl, term=t['term'], RR=t['RR'], lo=t['lo'], hi=t['hi'], n_events=int(r['n_events'])))
ins = pe.sea_d_m.values[pr.ev.values] == 0
run('인명: 특보구역 폴리곤 안 사고만', pr[ins], ['any_warn'] + CAL)
run('인명: 폴리곤 밖(3km 최근접) 사고만', pr[~ins], ['any_warn'] + CAL)
yr = pe.date.str[:4].values[pr.ev.values]
run('인명: 2020~2022', pr[yr <= '2022'], ['any_warn'] + CAL)
run('인명: 2023~2024', pr[yr >= '2023'], ['any_warn'] + CAL)
hz = pe.hz_3km_at_acc.values[pr.ev.values]
run('인명: 사고지점 3km 안 위험구역 있음', pr[hz >= 1], ['any_warn'] + CAL)
run('인명: 사고지점 3km 안 위험구역 없음', pr[hz == 0], ['any_warn'] + CAL)
# 낮 시간 발효 6시간 이상인 날만 '특보일'로 보고, 나머지 특보일(밤에만)은 빼고 비교
s = pr[(pr.anyw == 0) | (np.maximum(np.maximum(pr.wv_dh, pr.ty_dh), pr.gw_dh) >= 6)]
run('인명: 낮 6시간 이상 발효일 vs 특보없는날(밤에만 걸친 날 제외)', s, ['any_warn'] + CAL)
res = pd.DataFrame(out); res.to_csv(R + '/person_sensitivity.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 200); print(res.round(3).to_string(index=False))
# 낮(06~18시)에 걸친 특보일 vs 밤에만 걸친 특보일(낮 발효 0시간 — 자정에 끝난 구간 포함)
dhm = np.maximum(np.maximum(pr.wv_dh, pr.ty_dh), pr.gw_dh)
pr['warn_daytime'] = ((pr.anyw >= 1) & (dhm > 0)).astype(float); pr['warn_nightonly'] = ((pr.anyw >= 1) & (dhm == 0)).astype(float)
run('인명: 특보가 낮에 걸친 날 / 밤에만 걸친 날 (기준 특보 없는 날)', pr, ['warn_daytime', 'warn_nightonly'] + CAL)
# 사망·실종 사고: 특보 없는 날 파고 1.0m 이상(합친 구간) — 표의 1.0~1.5m 구간이 1.33 으로 나와 구간을 합쳐 다시 본다(사후 확인임을 보고서에 명시)
fat = ((pe.death.fillna(0) + pe.missing.fillna(0)) > 0).values[pr.ev.values]
nw = pr[(pr.anyw == 0) & fat].dropna(subset=['wh_max']).copy()
nw['wh_ge1.0'] = (nw.wh_max >= 1.0).astype(float); nw['wh_ge1.5'] = (nw.wh_max >= 1.5).astype(float)
run('사망·실종 사고·특보없는날: 파고 1.0m 이상(1m 미만 대비)', nw, ['wh_ge1.0'] + CAL)
run('사망·실종 사고·특보없는날: 파고 1.5m 이상(1.5m 미만 대비)', nw, ['wh_ge1.5'] + CAL)
nw2 = nw.dropna(subset=['v_outsider']); nw2 = nw2[nw2.v_outsider > 0].copy(); nw2['log2_outsider'] = np.log2(nw2.v_outsider)
run('사망·실종 사고·특보없는날: 파고 1.0m 이상 + 외지인 방문자 보정', nw2, ['wh_ge1.0', 'log2_outsider'] + CAL)
al = pr[(pr.anyw == 0)].dropna(subset=['wh_max']).copy(); al['wh_ge1.0'] = (al.wh_max >= 1.0).astype(float)
run('전체 사고·특보없는날: 파고 1.0m 이상', al, ['wh_ge1.0'] + CAL)
res = pd.DataFrame(out); res.to_csv(R + '/person_sensitivity.csv', index=False, encoding='utf-8-sig')
print(res.round(3).tail(6).to_string(index=False))
