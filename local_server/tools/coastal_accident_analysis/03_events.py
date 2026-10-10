"""분석 대상 사고 추출 + 중복 정리.
인명(2020-01-01~2024-12-31): 익수 ATY001·추락 ATY002·고립 ATY003·표류 ATY007·변사 ATY005. 같은 좌표·날짜·유형 완전중복은 1건.
선박(2020-01-01~2025-12-28): 전복 ATY018·침수 ATY029·침몰 ATY028·좌초좌주 ATY022/023/041·표류 ATY033·접촉 ATY019·충돌 ATY027.
  선박 원자료는 배 1척 = 1행이라 충돌 1건이 2~3행으로 들어 있다(같은 좌표·같은 시각). 사고 '건'으로 세기 위해
  같은 날짜·1km 이내·30분 이내 행들을 한 사건으로 묶는다(유형별 집계는 사건 안에 그 유형이 하나라도 있으면 1).
출력: data/events_person.csv, data/events_ship.csv
칸 위치 근거: build_accidents.js(인명 [lat,lon,ymd,pos,typeCd,orgCd,prsn,rescue,death,missing,warnFlags,severity]),
            build_ship_accidents_v2.js(선박 [lat,lon,ymd,hm,pos,typeCd,causeCd,shipCd,orgCd,rescue,death,missing,warnFlags,shipUse,tonnage,season,severity])
"""
import sys, json, csv, math, collections
root, out = sys.argv[1], sys.argv[2]
P = json.load(open(root + '/client/accident_persons.json'))['rows']
H = json.load(open(root + '/client/accident_ships_hk.json'))['rows']
PT = {'ATY001': '익수', 'ATY002': '추락', 'ATY003': '고립', 'ATY007': '표류', 'ATY005': '변사'}
ST = {'ATY018': '전복', 'ATY029': '침수', 'ATY028': '침몰', 'ATY022': '좌초좌주', 'ATY023': '좌초좌주', 'ATY041': '좌초좌주',
      'ATY033': '표류', 'ATY019': '접촉', 'ATY027': '충돌'}
seen = set(); prow = []; ndup = 0
for i, r in enumerate(P):
    if r[4] in PT and '20200101' <= r[2] <= '20241231':
        k = (r[0], r[1], r[2], r[4])
        if k in seen: ndup += 1; continue
        seen.add(k)
        prow.append(dict(pid=i, date=r[2], type=PT[r[4]], code=r[4], lat=r[0], lon=r[1], prsn=r[6] or 0, death=r[8] or 0, missing=r[9] or 0,
                         flags_type='|'.join(r[10] or []), flags_sev='|'.join(r[11] or []), pos=(r[3] or '').replace(',', ' ')))
print('person events', len(prow), 'exact dup removed', ndup)
with open(out + '/events_person.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(prow[0].keys())); w.writeheader(); w.writerows(prow)

def hm2min(hm):
    h, m = hm.split(':'); return int(h) * 60 + int(m)
rows = []
for i, r in enumerate(H):
    if r[5] in ST and '20200101' <= r[2] <= '20251228':
        rows.append(dict(rid=i, date=r[2], hm=r[3], t=hm2min(r[3]), lat=r[0], lon=r[1], code=r[5], type=ST[r[5]],
                         death=r[10] or 0, missing=r[11] or 0, flags_type='|'.join(r[12] or []), flags_sev='|'.join(r[16] or []), src2025=r[2] >= '20250101'))
# 사건 묶기: 같은 날짜 안에서 1km·30분 이내 연결(단일연결)
byd = collections.defaultdict(list)
for j, r in enumerate(rows): byd[r['date']].append(j)
parent = list(range(len(rows)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
def dist_km(a, b):
    dy = (a['lat'] - b['lat']) * 111.0; dx = (a['lon'] - b['lon']) * 111.0 * math.cos(math.radians(a['lat']))
    return math.hypot(dx, dy)
for d, idx in byd.items():
    for x in range(len(idx)):
        for y in range(x + 1, len(idx)):
            a, b = rows[idx[x]], rows[idx[y]]
            if abs(a['t'] - b['t']) <= 30 and dist_km(a, b) <= 1.0:
                parent[find(idx[x])] = find(idx[y])
groups = collections.defaultdict(list)
for j in range(len(rows)): groups[find(j)].append(j)
ev = []
for g, js in groups.items():
    js.sort(key=lambda j: rows[j]['rid']); r0 = rows[js[0]]
    types = sorted(set(rows[j]['type'] for j in js))
    ev.append(dict(eid=len(ev), date=r0['date'], hm=r0['hm'], lat=r0['lat'], lon=r0['lon'], types='|'.join(types), n_rows=len(js),
                   death=sum(rows[j]['death'] for j in js), missing=sum(rows[j]['missing'] for j in js),
                   flags_type=r0['flags_type'], flags_sev=r0['flags_sev'], src2025=int(r0['src2025'])))
ev.sort(key=lambda e: (e['date'], e['hm']))
for i, e in enumerate(ev): e['eid'] = i
print('ship rows', len(rows), '-> events', len(ev))
c = collections.Counter(); cr = collections.Counter(r['type'] for r in rows)
for e in ev:
    for t in e['types'].split('|'): c[t] += 1
print('rows by type', dict(cr)); print('events by type', dict(c))
print('events with >1 type', sum(1 for e in ev if '|' in e['types']))
with open(out + '/events_ship.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(ev[0].keys())); w.writeheader(); w.writerows(ev)
