# 행사일 vs 같은 시군구·같은 달·같은 요일 다른 날 — 연안 인명사고 수 비교 (2020-2024)
# 사용: python3 -I 17_event_days.py <events_2020_2025.csv> <accident_features_person_2020_2024.csv.gz> <결과.csv>
#   행사표: local_server/config/coastal_safety/events/ · 사고표: local_server/config/coastal_safety/accident_analysis/data/
# 방법: 개최·축소 행 중 날짜가 있는 2020~24 행사의 (시군구, 날짜)마다, 같은 시군구·같은 달·같은 요일의
#       행사 없는 날 평균 사고 수를 기대값으로 두고, 관측 합 ÷ 기대 합(95% 구간은 포아송 정확구간).
import csv, gzip, sys, datetime as dt, collections, math
from scipy.stats import chi2
EV, ACC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
# 행사 주소 → 시군구 코드 (DataLab 해안 시군구 코드 체계, 인천은 옛 코드)
ADDR = {
 '부산 해운대구':['26350'],'부산 수영구':['26500'],'충남 보령시':['44180'],'경기 화성시 서신면':['41590'],
 '강원 강릉시':['51150'],'전남 여수시 중앙동':['46130'],'울산 남구 장생포동':['31140'],'경남 창원시 진해구':['48129'],
 '울산 울주군 서생면':['31710'],'전북 군산시 비응도동':['52130'],'부산 기장군 기장읍':['26710'],'전남 무안군 해제면':['46840'],
 '부산 사하구':['26380'],'부산 수영구·남구·해운대구':['26500','26290','26350'],'충남 서천군 서면':['44770'],
 '강원 속초시':['51210'],'전남 여수시':['46130'],'전남 진도군 고군면 회동리':['46900'],'경남 통영시':['48220'],
 '경북 포항시 북구':['47113'],'경북 포항시 남구 호미곶면':['47111'],'전북 군산시':['52130'],
 '인천 중구 영종':['28110'],'충남 보령시 웅천읍':['44180'],'부산 동구':['26170'],
 '부산 해운대구·수영구·사하구':['26350','26500','26380'],'부산 사하구·해운대구':['26380','26350'],
 '제주 서귀포시 성산읍':['50130'],'인천 남동구':['28200'],'전남 여수시 덕충동':['46130'],'경북 영덕군 강구면':['47770'],
 '경북 울진군 후포면':['47930'],'경남 통영시 도남동':['48220'],'전남 진도군 고군면':['46900'],
 '제주 서귀포시 대정읍':['50130'],'경북 포항시 남구':['47111'],'경북 포항시':['47111','47113'],
}
acc = collections.Counter(); acc_t = collections.defaultdict(collections.Counter)
for r in csv.DictReader(gzip.open(ACC,'rt')):
    if r['sgg']: acc[(r['sgg'], r['date'])] += 1; acc_t[r['type']][(r['sgg'], r['date'])] += 1
ev_days = {}   # (sgg, date) -> [행사명]
unmapped = []
for r in csv.DictReader(open(EV, encoding='utf-8-sig')):
    if r['status'] not in ('개최','축소') or not r['start_date']: continue
    s = dt.date.fromisoformat(r['start_date']); e = dt.date.fromisoformat(r['end_date']) if r['end_date'] else s
    if s.year > 2024: continue
    codes = ADDR.get(r['address'])
    if not codes: unmapped.append(r['event_name']+' | '+r['address']); continue
    if (e - s).days > 30: continue
    d = s
    while d <= e:
        for c in codes: ev_days.setdefault((c, d.strftime('%Y%m%d')), []).append(r['event_name'])
        d += dt.timedelta(1)
def run(counter, days):
    O = E = 0.0; n = 0; rows = []
    for (c, ds), names in sorted(days.items()):
        d = dt.datetime.strptime(ds, '%Y%m%d').date()
        refs = []
        x = d.replace(day=1)
        while x.month == d.month:
            k = x.strftime('%Y%m%d')
            if x.weekday() == d.weekday() and x != d and (c, k) not in days: refs.append(counter[(c, k)])
            x += dt.timedelta(1)
        if not refs: continue
        o = counter[(c, ds)]; ex = sum(refs)/len(refs)
        O += o; E += ex; n += 1; rows.append((c, ds, '/'.join(sorted(set(names))), o, round(ex,2), len(refs)))
    if O == 0: return n, O, E, None, None, None, rows
    lo = chi2.ppf(0.025, 2*O)/2/E; hi = chi2.ppf(0.975, 2*(O+1))/2/E
    return n, O, E, O/E, lo, hi, rows
n, O, E, rr, lo, hi, rows = run(acc, ev_days)
with open(OUT, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['sgg','date','events','accidents_on_day','ref_mean_same_dow_month','n_ref_days']); w.writerows(rows)
print('행사일(시군구-일)', n, '관측', O, '기대', round(E,2), 'RR', rr and round(rr,2), '95%', lo and (round(lo,2), round(hi,2)))
for t in acc_t:
    m = run(acc_t[t], ev_days); print(' ', t, '관측', m[1], '기대', round(m[2],2), 'RR', m[3] and round(m[3],2))
# 주말 행사일만 / 평일 행사일만
for lab, f in [('주말행사일', lambda d: d.weekday()>=5), ('평일행사일', lambda d: d.weekday()<5)]:
    sub = {k:v for k,v in ev_days.items() if f(dt.datetime.strptime(k[1],'%Y%m%d').date())}
    m = run(acc, sub); print(lab, '시군구-일', m[0], '관측', m[1], '기대', round(m[2],2), 'RR', m[3] and round(m[3],2), m[4] and (round(m[4],2), round(m[5],2)))
print('주소 매핑 못한 행:', unmapped)
