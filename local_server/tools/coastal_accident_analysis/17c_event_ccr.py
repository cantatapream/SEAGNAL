"""행사일 효과 — 본 분석과 같은 방법(시간층화 사례교차 = 조건부 포아송)으로 다시 잰다(v3, 독립검증 B 지적).
17_event_days.py 의 '관측 ÷ 기대' 는 기대값(같은 달·같은 요일 행사 없는 날 평균, 보통 3~4일)을 상수로 보고 구간을 계산해 구간이 좁았다.
여기서는 사고 1건마다 층 = 같은 시군구·같은 연월·같은 요일의 날들로 잡고, 노출 = 그 날이 그 시군구의 행사일인가로 둔다.
→ 기준일 수가 적은 불확실성이 우도에 그대로 들어간다. 군집 = 사고 날짜.
대상: 행사가 한 번이라도 열린 시군구의 인명사고(변사 제외, 2020~2024). 행사 = events_2020_2025.csv 개최·축소·날짜 있음(17_event_days.py 와 같은 ADDR 매핑).
사용: python3 -I 17c_event_ccr.py <events.csv> <accident_features_person.csv.gz> <out.md>
"""
import sys, os, csv, gzip, datetime as dt, importlib.util
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccr
spec = importlib.util.spec_from_file_location('ev17', os.path.join(os.path.dirname(os.path.abspath(__file__)), '17_event_days.py'))
src = open(spec.origin).read(); ADDR = {}
exec(src[src.index('ADDR = {'):src.index('}\n', src.index('ADDR = {')) + 2], {}, locals_ := {}); ADDR = locals_['ADDR']
EV, ACC, OUT = sys.argv[1:4]
D0, D1 = dt.date(2020, 1, 1), dt.date(2024, 12, 31)
ev_days = {}
for r in csv.DictReader(open(EV, encoding='utf-8-sig')):
    if r['status'] not in ('개최', '축소') or not r['start_date']: continue
    s = dt.date.fromisoformat(r['start_date']); e = dt.date.fromisoformat(r['end_date']) if r['end_date'] else s
    codes = ADDR.get(r['address'])
    if not codes or (e - s).days > 30: continue
    d = s
    while d <= e:
        if D0 <= d <= D1:
            for c in codes: ev_days.setdefault((c, d), set()).add(r['event_name'])
        d += dt.timedelta(1)
ev_sgg = {c for c, _ in ev_days}
acc = [r for r in csv.DictReader(gzip.open(ACC, 'rt')) if r['sgg'] in ev_sgg]
evs, case, x, cl, wk = [], [], [], [], []
for k, r in enumerate(acc):
    d = dt.datetime.strptime(r['date'], '%Y%m%d').date()
    x0 = d.replace(day=1)
    while x0.month == d.month:
        if x0.weekday() == d.weekday():
            evs.append(k); case.append(int(x0 == d)); x.append(float((r['sgg'], x0) in ev_days)); cl.append(r['date']); wk.append(d.weekday() >= 5)
        x0 += dt.timedelta(1)
evs, case, x, cl, wk = map(np.array, (evs, case, x, cl, wk))
lines = ['#### 행사일 효과 — 조건부 포아송(층 = 같은 시군구·같은 연월·같은 요일, 군집 = 사고 날짜)\n',
         '| 구분 | 모형에 든 사고 | 행사일에 난 사고 | 비교일 중 행사일 비율 | 배수 (95% 신뢰구간) |', '|---|---|---|---|---|']
for lab, m in (('전체', np.ones(len(evs), bool)), ('주말(토·일)', wk), ('평일', ~wk)):
    r = ccr.fit(evs[m], case[m], x[m][:, None], cluster=cl[m], names=['event'])
    t = ccr.table(r)[0]
    lines.append('| %s | %d | %d | %.1f%% | %.2f (%.2f–%.2f) |' % (lab, int(r['n_events']), int(((case == 1) & (x == 1) & m).sum()),
                                                            100 * x[m & (case == 0)].mean(), t['RR'], t['lo'], t['hi']))
lines.append('\n대상: 행사가 열린 시군구 %d곳의 인명사고 %d건(변사 제외). 행사일(시군구-일) %d개.' % (len(ev_sgg), len(acc), len(ev_days)))
open(OUT, 'w').write('\n'.join(lines) + '\n'); print('\n'.join(lines))
