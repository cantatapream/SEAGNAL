"""입력 검증: §4.6 이 쓴 중간 파일(spots_features.csv·geo_person.csv, 2026-10-10 생성)이
지금 저장소 원자료(coastal_hazard_zones.wgs84.geojson·coastal_spots.json·accident_persons.json·risk_spots.json)와 같은지
04_geo.py·03_events.py 와 같은 규칙으로 다시 계산해 대조한다. 또 종류별 개수(위험/사망/다발)를 다시 세어 저장한다.
사용: python3 -I 00_verify_inputs.py <repo_root> <data_dir> <out_dir>
"""
import sys, json, collections
import numpy as np, pandas as pd, shapely
from shapely.geometry import shape
from shapely.strtree import STRtree
from pyproj import Transformer

root, D, OUT = sys.argv[1:4]
TR = Transformer.from_crs(4326, 5179, always_xy=True)
def P(g):
    return shapely.transform(g, lambda xy: np.column_stack(TR.transform(xy[:, 0], xy[:, 1])))
def pts(lons, lats):
    x, y = TR.transform(np.asarray(lons, float), np.asarray(lats, float))
    return shapely.points(x, y)

KIND = {'연안사고 위험구역': 'risk', '사망사고 발생구역': 'fatal', '연안사고 다발구역': 'freq'}
hz = json.load(open(root + '/local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson'))['features']
hzG = [shapely.make_valid(P(shape(f['geometry']))) for f in hz]
hzK = [KIND[f['properties']['구역분류']] for f in hz]
print('hazard zones', len(hz), collections.Counter(hzK))
hzT = STRtree(hzG)

spots = json.load(open(root + '/local_server/config/coastal_safety/coastal_spots.json'))['spots']
spP = pts([s['lon'] for s in spots], [s['lat'] for s in spots])
cnt = np.zeros((len(spots), 4), int)
a_, b_ = hzT.query(spP, predicate='dwithin', distance=3000)
for a, b in zip(a_, b_):
    cnt[a, 0] += 1; cnt[a, {'fatal': 1, 'freq': 2, 'risk': 3}[hzK[b]]] += 1
sf = pd.read_csv(D + '/spots_features.csv', dtype={'sgg': str})
assert len(sf) == len(spots)
same_name = (sf.name.values == np.array([s['name'] for s in spots])).all()
print('spots_features rows', len(sf), 'name order same as coastal_spots.json:', same_name)
for j, c in enumerate(['hz_all_3km', 'hz_fatal_3km', 'hz_freq_3km', 'hz_risk_3km']):
    d = (sf[c].values != cnt[:, j]).sum()
    print('  %-13s mismatches vs recomputed from current geojson: %d' % (c, d))

# risk_spots.json(앱이 실제로 쓰는 값)과 대조
rs = json.load(open(root + '/local_server/config/coastal_safety/risk_spots.json'))['spots']
rsd = {}
for s in rs:
    rsd.setdefault((s['sgg'], s['name'], round(s['lat'], 6), round(s['lon'], 6)), []).append(s)
mm_c = mm_f = miss = 0; type_counts_app = []
for i, s in enumerate(spots):
    k = (s['sgg'], s['name'], round(s['lat'], 6), round(s['lon'], 6))
    if k not in rsd: miss += 1; continue
    h = rsd[k][0]['hazard']
    if h['count'] != cnt[i, 0]: mm_c += 1
    if bool(h['fatal']) != (cnt[i, 1] > 0): mm_f += 1
    kc = collections.Counter(z['구역분류'] for z in h.get('zones', []))
    type_counts_app.append((i, kc.get('연안사고 위험구역', 0), kc.get('사망사고 발생구역', 0), kc.get('연안사고 다발구역', 0)))
print('risk_spots.json: unmatched %d, count mismatches %d, fatal-flag mismatches %d' % (miss, mm_c, mm_f))
ta = np.array(type_counts_app)
print('risk_spots.json zones[] per-type vs recomputed: risk %d, fatal %d, freq %d mismatches' % (
    (ta[:, 1] != cnt[ta[:, 0], 3]).sum(), (ta[:, 2] != cnt[ta[:, 0], 1]).sum(), (ta[:, 3] != cnt[ta[:, 0], 2]).sum()))

# 사고 재구성(03_events.py 와 같은 규칙, 변사 제외) + 3km 안 가장 가까운 관광지(04_geo.py 와 같은 규칙)
Pr = json.load(open(root + '/client/accident_persons.json'))['rows']
PT = {'ATY001': '익수', 'ATY002': '추락', 'ATY003': '고립', 'ATY007': '표류'}
seen = set(); ev = []
for i, r in enumerate(Pr):
    if r[4] in PT and '20200101' <= r[2] <= '20241231':
        k = (r[0], r[1], r[2], r[4])
        if k in seen: continue
        seen.add(k); ev.append((i, r[2], PT[r[4]], r[0], r[1], r[8] or 0, r[9] or 0))
# 03_events.py 는 변사를 포함한 상태로 중복을 지웠다 — 변사 행은 다른 유형 키와 겹치지 않으므로 결과가 같다(유형이 키에 들어 있음).
ev = pd.DataFrame(ev, columns=['pid', 'date', 'type', 'lat', 'lon', 'death', 'missing'])
ge = pd.read_csv(D + '/geo_person.csv', dtype={'date': str})
print('events rebuilt from current accident_persons.json:', len(ev), '| geo_person.csv rows:', len(ge))
m = ev.merge(ge[['pid', 'date', 'type', 'lat', 'lon', 'death', 'missing', 'spot']], on='pid', how='outer', suffixes=('', '_g'), indicator=True)
print('  pid join:', m['_merge'].value_counts().to_dict())
both = m[m['_merge'] == 'both']
for c in ['date', 'type', 'death', 'missing']:
    print('  field %-8s mismatches %d' % (c, (both[c].astype(str) != both[c + '_g'].astype(str)).sum()))
print('  lat/lon max abs diff', float((both.lat - both.lat_g).abs().max()), float((both.lon - both.lon_g).abs().max()))
eP = pts(ev.lon.values, ev.lat.values)
spT = STRtree(spP)
(ai, bi), dd = spT.query_nearest(eP, max_distance=3000, return_distance=True, all_matches=False)
sp_new = np.full(len(ev), -1); sp_new[ai] = bi
ev['spot_new'] = sp_new
m2 = ev.merge(ge[['pid', 'spot']], on='pid')
old = m2.spot.fillna(-1).astype(int).values
print('  nearest-spot(3km) mismatches vs geo_person.spot: %d (assigned now %d, before %d)' % ((old != m2.spot_new.values).sum(), (m2.spot_new >= 0).sum(), (old >= 0).sum()))

# 관광지 몫 해안선 칸 수(04_geo.py 와 같은 규칙) — 모든 모형의 보정항
cc = json.load(open(root + '/local_server/data/tide_field/coastline_cells.json'))['cells']
cP = pts([int(c.split('_')[0]) * 0.0015 for c in cc], [int(c.split('_')[1]) * 0.0015 for c in cc])
(ai, bi), dd = spT.query_nearest(cP, max_distance=3000, return_distance=True, all_matches=False)
ccount = np.bincount(bi, minlength=len(spots))
print('coast_cells_share mismatches vs recomputed: %d' % (sf.coast_cells_share.values != ccount).sum())

out = sf[['spot', 'name', 'sgg', 'sgg_name']].copy()
out['n_risk_now'] = cnt[:, 3]; out['n_fatal_now'] = cnt[:, 1]; out['n_freq_now'] = cnt[:, 2]; out['n_all_now'] = cnt[:, 0]
out.to_csv(OUT + '/verify_spot_type_counts.csv', index=False, encoding='utf-8-sig')
print('saved')
