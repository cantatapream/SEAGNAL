"""여름 추가점수(사용자 지시 2026-10-10 "여름에 점수를 더 주어야 할 것 같은데 ? 추가점수 반영")의 근거 계산.
층 = 사고 × 그 해(1년), 노출 = 그 날이 여름(6~8월)인가 / 9월인가, 외지인 방문자(log₂)·요일·공휴일 보정, 군집 = 사고 날짜.
→ "사람 수가 같을 때 여름이 나머지 달보다 하루당 사고가 몇 배인가" = 사람 혼잡 점수에 이미 들어간 몫을 뺀 여름 몫.
사용: python3 -I 26_summer_bonus.py <data_dir> <results_dir> > results/summer_bonus.md
"""
import sys, os, collections
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo, ccr
D, R = sys.argv[1:3]
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
dow, hol, month, year = expo.calendar()
v = pd.read_csv(D + '/visitors_daily_coastal.csv.gz', dtype={'sgg': str, 'date': str}); v = v[v.date.isin(expo.DIDX)]
vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
V = np.full((len(vzi), expo.ND), np.nan, np.float32); V[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v.outsider.values
rec = collections.defaultdict(list)
for k, r in pe.iterrows():
    vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
    if vi is None: continue
    ci = expo.DIDX[r.date]; days = np.where(year == year[ci])[0]
    rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8)); rec['vo'].append(V[vi, days])
df = pd.DataFrame({c: np.concatenate(x) for c, x in rec.items()})
df = df[df.vo > 0].copy(); df['lv'] = np.log2(df.vo)
df['cl'] = pe.date.values[df.ev.values]; m = month[df.day.values]
df['summer'] = np.isin(m, [6, 7, 8]).astype(float); df['sep'] = (m == 9).astype(float); df['s69'] = np.isin(m, [6, 7, 8, 9]).astype(float)
for mm in (6, 7, 8, 9): df['m%d' % mm] = (m == mm).astype(float)
CAL = []
for d in range(1, 7): df['dow%d' % d] = (dow[df.day.values] == d).astype(float); CAL.append('dow%d' % d)
df['hol'] = hol[df.day.values].astype(float); CAL.append('hol')
out = ['#### 여름 추가점수 — 사람 수가 같을 때 여름(6~8월)이 나머지 달보다 하루당 사고가 몇 배인가\n',
       '층 = 같은 장소·같은 해, 외지인 방문자(log₂)·요일·공휴일 보정, 군집 = 사고 날짜. 점수 = log₂(배수).\n',
       '| 모형 | 항 | 배수 (95% 신뢰구간) | 점수 (95% 신뢰구간) |', '|---|---|---|---|']
for lab, cols in (('여름 vs 나머지 9개월', ['summer']), ('여름·9월 각각 vs 나머지 8개월', ['summer', 'sep']),
                  ('6~9월 한 묶음 vs 나머지 8개월', ['s69']), ('6·7·8·9월 달마다 vs 나머지 8개월', ['m6', 'm7', 'm8', 'm9'])):
    r = ccr.fit(df.ev.values, df.case.values, df[cols + ['lv'] + CAL].values.astype(float), cluster=df.cl.values, names=cols + ['lv'] + CAL)
    for t in ccr.table(r):
        if t['term'] in CAL: continue
        nm = {'summer': '여름(6~8월)', 'sep': '9월', 's69': '6~9월', 'm6': '6월', 'm7': '7월', 'm8': '8월', 'm9': '9월', 'lv': '외지인 방문자 2배당'}[t['term']]
        out.append('| %s | %s | %.2f (%.2f–%.2f) | %.2f (%.2f–%.2f) |' % (lab, nm, t['RR'], t['lo'], t['hi'], np.log2(t['RR']), np.log2(t['lo']), np.log2(t['hi'])))
out.append('\n모형에 든 사고 %d건(시군구 방문자를 붙인 사고).' % int(df.case.sum()))
print('\n'.join(out))
