"""공간 연결: 사고·관광지·AWS 지점 → 특보구역/강풍구역/대해구/AWS/시군구/관광지/위험구역.
좌표는 EPSG:5179(m)로 투영해 거리를 잰다.
규칙(설계서 coastal_risk §3.3, build_accident_warn_flags.js 와 같은 취지):
  - 해상 특보구역(풍랑·태풍): client/assets/warn_zones.geojson(부모 44) 안이면 그 구역, 아니면 3km 이내 가장 가까운 구역, 그 밖은 미연결.
    ※ 저장소 build_accident_warn_flags.js 는 인명사고에 '폴리곤 안'만 쓴다(3km 단계 없음). 여기서는 §3.3 의 3단계 규칙을 쓰고,
      폴리곤 안 사고에 대해서는 저장된 플래그와 같은지 따로 대조한다.
  - 강풍(육상): wrnArea_land.geojson level2 local(+제주 옛 구역 근사) 중 3km 이내 가장 가까운 구역(build 스크립트와 같은 규칙).
    그 구역 이름을 2017~2025 통보문이 쓴 이름(예: '거제시'→'거제', '부산중부'→'부산')으로 바꿔 특보 이력과 잇는다.
  - 대해구: 사고점을 품은 0.5° 칸(자료 있는 칸)이면 그 칸, 아니면 중심이 가장 가까운 칸.
  - AWS: '해안 지점'(해안선 2km 이내) 중 15km 이내 가장 가까운 지점.
  - 시군구: 행정동 경계(vuski/admdongkor ver20241231, CC BY 4.0; 통계청 SGIS 원자료)를 시군구로 합친 다각형 안, 아니면 10km 이내 가장 가까운 시군구.
  - 관광지: 3km 이내 가장 가까운 관광지(원 겹침은 가장 가까운 관광지 몫 — 설계서 U16).
사용: python3 -I 04_geo.py <repo_root> <scratch_root> <data_dir>
"""
import sys, json, csv, re, gzip, collections, math
import numpy as np, shapely
from shapely.geometry import shape, Point, box, MultiLineString, LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree
from pyproj import Transformer

root, scr, D = sys.argv[1:4]
TR = Transformer.from_crs(4326, 5179, always_xy=True)
def P(g):
    return shapely.transform(g, lambda xy: np.column_stack(TR.transform(xy[:, 0], xy[:, 1])))
def pts(lons, lats):
    x, y = TR.transform(np.asarray(lons, float), np.asarray(lats, float))
    return shapely.points(x, y)
norm = lambda s: re.sub(r'[\s·.]', '', s)

# ---------- 사건 ----------
pe = list(csv.DictReader(open(D + '/events_person.csv')))
se = list(csv.DictReader(open(D + '/events_ship.csv')))
pP = pts([float(r['lon']) for r in pe], [float(r['lat']) for r in pe])
sP = pts([float(r['lon']) for r in se], [float(r['lat']) for r in se])

# ---------- 해상 특보구역 ----------
sea = json.load(open(root + '/client/assets/warn_zones.geojson'))['features']
seaN = [norm(f['properties']['name']) for f in sea]
seaG = [shapely.make_valid(P(shape(f['geometry']))) for f in sea]
seaT = STRtree(seaG)
def assign_poly(points, geoms, tree, maxd):
    """폴리곤 안이면 (idx,0), 아니면 maxd 이내 최근접 (idx,dist), 없으면 (-1,nan)."""
    out_i = np.full(len(points), -1); out_d = np.full(len(points), np.nan)
    inside = tree.query(points, predicate='within')  # (point_idx, geom_idx)
    for a, b in zip(*inside):
        if out_i[a] < 0: out_i[a] = b; out_d[a] = 0.0
    rest = np.where(out_i < 0)[0]
    if len(rest):
        (ai, bi), dd = tree.query_nearest(points[rest], max_distance=maxd, return_distance=True, all_matches=False)
        for a, b, d in zip(ai, bi, dd):
            out_i[rest[a]] = b; out_d[rest[a]] = d
    return out_i, out_d
pi, pdd = assign_poly(pP, seaG, seaT, 3000)
si, sdd = assign_poly(sP, seaG, seaT, 3000)
print('person sea zone: inside %d, within3km %d, none %d' % ((pdd == 0).sum(), ((pdd > 0) & (pi >= 0)).sum(), (pi < 0).sum()))
print('ship   sea zone: inside %d, within3km %d, none %d' % ((sdd == 0).sum(), ((sdd > 0) & (si >= 0)).sum(), (si < 0).sum()))

# ---------- 강풍 육상구역 ----------
land = json.load(open(root + '/local_server/scripts/data/warn_zone_flags/wrnArea_land.geojson'))['features']
jeju = json.load(open(root + '/local_server/scripts/data/warn_zone_flags/jeju_old_zones.geojson'))['features']
NEW_JEJU = {'제주시서부', '제주시동부', '제주시북부', '제주시중산간', '서귀포시서부', '서귀포시동부', '서귀포시남부', '서귀포시중산간'}
wi = json.load(open(root + '/client/warn_intervals.json'))['zones']
gwkeys = {z for z, d in wi.items() if any(k.startswith('GW') and any(iv[1] >= 20170101 for iv in v) for k, v in d.items())}
MANUAL = {'인천영종': ['인천'], '인천남부': ['인천'], '인천북부': ['인천'], '인천광역시': ['인천'], '보령도서': ['보령'], '보령(도서제외)': ['보령'],
          '완도여서도': ['완도'], '완도군여서도': ['완도'], '완도군(여서도제외)': ['완도'], '군산옥도면(어청도제외)': ['군산'], '군산어청도': ['군산'],
          '군산시(옥도면제외)': ['군산'], '영광낙월면': ['영광'], '영광군(낙월면제외)': ['영광'], '부안위도면': ['부안'], '부안군(위도면제외)': ['부안'],
          '백령도대청도': ['서해5도'], '연평도우도': ['서해5도'], '거문도초도': ['거문도초도'], '흑산도홍도': ['흑산도홍도'], '울릉도독도': ['울릉도독도']}
SUF = ['동북부', '서북부', '동남부', '서남부', '중북부', '중부', '서부', '동부', '남부', '북부']
def gw_resolve(names):
    keys = set()
    for n in names:
        n = norm(n)
        if n in MANUAL: keys.update(MANUAL[n])
        if n in gwkeys: keys.add(n)
        for s in SUF:
            if n.endswith(s) and n[:-len(s)] in gwkeys: keys.add(n[:-len(s)])
    return sorted(keys)
landN, landK, landG = [], [], []
# 상위 구역(regId 끝 '00')에 하위(평지·산지·동부 등)가 있으면 상위는 뺀다 — 겹친 상위가 먼저 잡혀 이름이 어긋나는 것을 막음
#   (예: 강원 '고성군'(L1022200, regko '고성')이 경남 고성의 옛 이름 '고성'과 겹친다. 해안 사고는 '고성평지'로 가야 한다.)
L2 = [f for f in land if f['properties'].get('level') == 2 and f['properties'].get('ground') == 'local']
ids = [f['properties'].get('regId') or '' for f in L2]
has_child = {i for i in ids if i.endswith('00') and any(j != i and j[:-2] == i[:-2] for j in ids)}
has_child |= {'L1091300', 'L1091400'}  # 제주시(산지 제외)·서귀포시(산지 제외) — 신 제주 체계, 옛 구역 근사형으로 대체
print('land parents dropped', len(has_child))
for f in L2:
    p = f['properties']
    if (p.get('regId') or '') in has_child: continue
    nm = p.get('regKo') or p.get('regko')
    if not nm or nm in NEW_JEJU: continue
    landN.append(nm); landK.append(gw_resolve([p.get('regko') or '', p.get('regKo') or '']))
    landG.append(shapely.make_valid(P(shape(f['geometry']))))
for f in jeju:
    nm = f['properties']['name']
    if '__pre' in nm: continue          # 사고 기간 대부분(2022-12 이후 포함)에 맞는 현행 근사형만 사용 — 해안 사고는 중산간과 무관
    base = nm.split('__')[0]
    landN.append(nm); landK.append(gw_resolve([base])); landG.append(shapely.make_valid(P(shape(f['geometry']))))
landT = STRtree(landG)
def assign_land(points):
    out_i = np.full(len(points), -1); out_d = np.full(len(points), np.nan)
    a_, b_ = landT.query(points, predicate='dwithin', distance=3000)
    dist = shapely.distance(points[a_], np.array(landG, dtype=object)[b_])
    best = {}
    for a, b, d in zip(a_, b_, dist):
        key = (0 if landK[b] else 1, d, landG[b].area)
        if a not in best or key < best[a][0]: best[a] = (key, b, d)
    for a, (k, b, d) in best.items(): out_i[a] = b; out_d[a] = d
    return out_i, out_d
li, ldd = assign_land(pP)
print('person land(GW) zone: inside %d, within3km %d, none %d' % ((ldd == 0).sum(), ((ldd > 0) & (li >= 0)).sum(), (li < 0).sum()))
unres = collections.Counter(landN[i] for i in li if i >= 0 and not landK[i])
print('  land zones used by accidents with NO 2017+ GW key:', dict(unres))

# ---------- 대해구 ----------
mz = list(csv.DictReader(open(D + '/marine_zones.csv')))
md = collections.Counter()
with gzip.open(D + '/marine_daily.csv.gz', 'rt') as f:
    next(f)
    for line in f: md[int(line.split(',', 1)[0])] += 1
ndays = max(md.values())
mzv = [r for r in mz if md.get(int(r['zone']), 0) >= 0.95 * ndays]
print('marine zones with data', len(mzv), 'of', len(mz))
mzZ = np.array([int(r['zone']) for r in mzv]); mlat = np.array([float(r['lat']) for r in mzv]); mlon = np.array([float(r['lon']) for r in mzv])
def assign_mz(lats, lons):
    z = np.full(len(lats), -1); dk = np.zeros(len(lats)); how = []
    for i, (la, lo) in enumerate(zip(lats, lons)):
        inc = np.where((np.abs(mlat - la) <= 0.25) & (np.abs(mlon - lo) <= 0.25))[0]
        dd = np.hypot((mlat - la) * 111.0, (mlon - lo) * 111.0 * math.cos(math.radians(la)))
        if len(inc): j = inc[0]; how.append('contain')
        else: j = int(np.argmin(dd)); how.append('nearest')
        z[i] = mzZ[j]; dk[i] = dd[j]
    return z, dk, how
pmz, pmd, pmh = assign_mz([float(r['lat']) for r in pe], [float(r['lon']) for r in pe])
smz, smd, smh = assign_mz([float(r['lat']) for r in se], [float(r['lon']) for r in se])
print('person marine zone: contain %d nearest %d (nearest dist km median %.1f max %.1f)' % (pmh.count('contain'), pmh.count('nearest'),
      np.median([d for d, h in zip(pmd, pmh) if h == 'nearest'] or [0]), max([d for d, h in zip(pmd, pmh) if h == 'nearest'] or [0])))
print('ship   marine zone: contain %d nearest %d (nearest dist km max %.1f)' % (smh.count('contain'), smh.count('nearest'), max([d for d, h in zip(smd, smh) if h == 'nearest'] or [0])))

# ---------- 해안선(land_mask) ----------
rings = json.load(open(root + '/client/land_mask_korea.json'))['rings']
kr = [r for r in rings if len(r) >= 4 and 123.5 <= min(p[0] for p in r) and max(p[0] for p in r) <= 132.5 and 32.5 <= min(p[1] for p in r) and max(p[1] for p in r) <= 39.5]
coast = P(MultiLineString([LineString(r) for r in kr]))
landpoly = P(unary_union([shapely.make_valid(shapely.Polygon(r)) for r in kr]))
print('land_mask rings in Korea bbox', len(kr))

# ---------- AWS 해안 지점 ----------
st = list(csv.DictReader(open(D + '/aws_stations.csv')))
ad = collections.Counter()
with gzip.open(D + '/aws_daily_all.csv.gz', 'rt') as f:
    next(f)
    for line in f:
        p = line.split(',')
        if int(p[4]) >= 18: ad[p[0]] += 1
stP = pts([float(r['lon']) for r in st], [float(r['lat']) for r in st])
cd = shapely.distance(stP, coast)
ins = shapely.contains(landpoly, stP)
for r, d_, i_ in zip(st, cd, ins):
    r['coast_m'] = round(float(d_)); r['in_land'] = int(bool(i_)); r['days_ok'] = ad.get(r['stn'], 0)
ndaysA = 2192
coastal = [i for i, r in enumerate(st) if (r['coast_m'] <= 2000 or not r['in_land']) and r['days_ok'] >= 0.8 * ndaysA]
print('AWS stations', len(st), 'coastal(<=2km or off-mask) with >=80% days', len(coastal))
with open(D + '/aws_stations_geo.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(st[0].keys()) + ['coastal']); w.writeheader()
    cs = set(coastal)
    for i, r in enumerate(st): r['coastal'] = int(i in cs); w.writerow(r)
cT = STRtree([stP[i] for i in coastal])
(ai, bi), dd = cT.query_nearest(pP, max_distance=15000, return_distance=True, all_matches=False)
paws = np.full(len(pe), -1); pawd = np.full(len(pe), np.nan)
for a, b, d_ in zip(ai, bi, dd): paws[a] = int(st[coastal[b]]['stn']); pawd[a] = d_
print('person -> coastal AWS within 15km: %d / %d (median dist %.1f km)' % ((paws >= 0).sum(), len(pe), np.nanmedian(pawd) / 1000))

# ---------- 시군구 ----------
adm = json.load(open(scr + '/analysis/dl/admdong/HangJeongDong_ver20241231.geojson'))['features']
bysgg = collections.defaultdict(list); sggname = {}
for f in adm:
    p = f['properties']; bysgg[p['sgg']].append(shape(f['geometry'])); sggname[p['sgg']] = p['sidonm'] + ' ' + p['sggnm']
sggC = sorted(bysgg); sggG = [P(shapely.make_valid(unary_union(bysgg[c]))) for c in sggC]
sggT = STRtree(sggG)
def assign_sgg(points):
    i, d_ = assign_poly(points, sggG, sggT, 10000)
    return [sggC[k] if k >= 0 else '' for k in i], d_
psgg, psgd = assign_sgg(pP)
print('person sgg: inside %d, within10km %d, none %d' % ((psgd == 0).sum(), ((psgd > 0) & ~np.isnan(psgd)).sum(), sum(1 for x in psgg if not x)))

# ---------- 관광지·위험구역 ----------
spots = json.load(open(root + '/local_server/config/coastal_safety/coastal_spots.json'))['spots']
spP = pts([s['lon'] for s in spots], [s['lat'] for s in spots])
spT = STRtree(spP)
(ai, bi), dd = spT.query_nearest(pP, max_distance=3000, return_distance=True, all_matches=False)
pspot = np.full(len(pe), -1); pspd = np.full(len(pe), np.nan)
for a, b, d_ in zip(ai, bi, dd): pspot[a] = b; pspd[a] = d_
print('person -> spot within 3km: %d / %d' % ((pspot >= 0).sum(), len(pe)))
hz = json.load(open(scr + '/shp/coastal_hazard_zones.wgs84.geojson'))['features']
hzG = [shapely.make_valid(P(shape(f['geometry']))) for f in hz]; hzC = [f['properties'].get('구역분류') for f in hz]
hzT = STRtree(hzG)
cnt = np.zeros((len(spots), 4), int)  # 전체, 사망, 다발, 위험
pairs = hzT.query(spP, predicate='dwithin', distance=3000)
for a, b in zip(*pairs):
    cnt[a, 0] += 1
    cnt[a, {'사망사고 발생구역': 1, '연안사고 다발구역': 2, '연안사고 위험구역': 3}[hzC[b]]] += 1
# 사고 지점 기준 3km 개수(관광지와 무관한 보조 분석용)
pc = np.zeros(len(pe), int)
pairs = hzT.query(pP, predicate='dwithin', distance=3000)
for a, b in zip(*pairs): pc[a] += 1
# 해안선 칸(150m, coastline_cells.json) → 3km 이내 최근접 관광지 = 관광지 몫 해안선 길이
cc = json.load(open(root + '/local_server/data/tide_field/coastline_cells.json'))['cells']
cx = [int(c.split('_')[0]) * 0.0015 for c in cc]; cy = [int(c.split('_')[1]) * 0.0015 for c in cc]
cP = pts(cx, cy)
(ai, bi), dd = spT.query_nearest(cP, max_distance=3000, return_distance=True, all_matches=False)
ccount = np.bincount(bi, minlength=len(spots))
with open(D + '/spots_features.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['spot', 'name', 'sgg', 'sgg_name', 'lat', 'lon', 'on', 'hz_all_3km', 'hz_fatal_3km', 'hz_freq_3km', 'hz_risk_3km', 'coast_cells_share'])
    for i, s in enumerate(spots):
        w.writerow([i, s['name'], s['sgg'], s['sgg_name'], s['lat'], s['lon'], s['on'], *cnt[i], ccount[i]])

# ---------- 저장 ----------
with open(D + '/geo_person.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['pid', 'date', 'type', 'lat', 'lon', 'sea_zone', 'sea_d_m', 'land_zone', 'gw_keys', 'land_d_m', 'mzone', 'mzone_how', 'mzone_d_km',
                'aws', 'aws_d_km', 'sgg', 'sgg_d_m', 'spot', 'spot_d_m', 'hz_3km_at_acc', 'death', 'missing', 'flags_type', 'flags_sev'])
    for k, r in enumerate(pe):
        w.writerow([r['pid'], r['date'], r['type'], r['lat'], r['lon'], seaN[pi[k]] if pi[k] >= 0 else '', '' if np.isnan(pdd[k]) else round(pdd[k]),
                    landN[li[k]] if li[k] >= 0 else '', '|'.join(landK[li[k]]) if li[k] >= 0 else '', '' if np.isnan(ldd[k]) else round(ldd[k]),
                    pmz[k], pmh[k], round(pmd[k], 1), paws[k] if paws[k] >= 0 else '', '' if np.isnan(pawd[k]) else round(pawd[k] / 1000, 2),
                    psgg[k], '' if np.isnan(psgd[k]) else round(psgd[k]), pspot[k] if pspot[k] >= 0 else '', '' if np.isnan(pspd[k]) else round(pspd[k]),
                    pc[k], r['death'], r['missing'], r['flags_type'], r['flags_sev']])
with open(D + '/geo_ship.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['eid', 'date', 'hm', 'types', 'lat', 'lon', 'sea_zone', 'sea_d_m', 'mzone', 'mzone_how', 'mzone_d_km', 'death', 'missing', 'flags_type', 'flags_sev', 'src2025', 'n_rows'])
    for k, r in enumerate(se):
        w.writerow([r['eid'], r['date'], r['hm'], r['types'], r['lat'], r['lon'], seaN[si[k]] if si[k] >= 0 else '', '' if np.isnan(sdd[k]) else round(sdd[k]),
                    smz[k], smh[k], round(smd[k], 1), r['death'], r['missing'], r['flags_type'], r['flags_sev'], r['src2025'], r['n_rows']])
json.dump({c: sggname[c] for c in sggC}, open(D + '/sgg_names_admdong2024.json', 'w'), ensure_ascii=False)
json.dump({'land_zone_gw_keys': {n: k for n, k in zip(landN, landK)}}, open(D + '/land_zone_gw_keys.json', 'w'), ensure_ascii=False, indent=0)
print('saved')
