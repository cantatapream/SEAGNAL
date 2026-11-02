"""보조 검증: 관광지가 아닌 '해안선 격자'를 단위로 위험구역 3km 개수 ↔ 인명사고 (전남 포함 전국).
단위 = 해안선 칸(150m, coastline_cells.json)이 1개 이상 든 0.03° 칸(약 3.3×2.7km). 사고는 3km 안 가장 가까운 단위 중심 몫.
보정 = log(해안선 칸 수) + 대해구(0.5°) 고정효과. 포아송 강건 SE.
※ coastline_cells.json 은 경도 129.6° 동쪽(울릉도 등)이 없다.
사용: python3 -I 09b_coastgrid.py <repo_root> <scratch_root> <data_dir> <results_dir>
"""
import sys, json, collections, math
import numpy as np, pandas as pd, shapely
import statsmodels.api as sm
from shapely.geometry import shape
from shapely.strtree import STRtree
from pyproj import Transformer
root, scr, D, R = sys.argv[1:5]
TR = Transformer.from_crs(4326, 5179, always_xy=True)
cc = json.load(open(root + '/local_server/data/tide_field/coastline_cells.json'))['cells']
cx = np.array([int(c.split('_')[0]) * 0.0015 for c in cc]); cy = np.array([int(c.split('_')[1]) * 0.0015 for c in cc])
gx = np.floor(cx / 0.03).astype(int); gy = np.floor(cy / 0.03).astype(int)
units = collections.Counter(zip(gx, gy))
U = sorted(units); ulon = np.array([(u[0] + 0.5) * 0.03 for u in U]); ulat = np.array([(u[1] + 0.5) * 0.03 for u in U])
ncoast = np.array([units[u] for u in U])
x, y = TR.transform(ulon, ulat); uP = shapely.points(x, y)
hz = json.load(open(root + '/local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson'))['features']  # 해경 연안위험구역 820곳(2023-01-01 지정), 저장소 보관본
hzG = [shapely.make_valid(shapely.transform(shape(f['geometry']), lambda xy: np.column_stack(TR.transform(xy[:, 0], xy[:, 1])))) for f in hz]
hzF = np.array([f['properties'].get('구역분류') == '사망사고 발생구역' for f in hz])
T = STRtree(hzG)
a, b = T.query(uP, predicate='dwithin', distance=3000)
cnt = np.bincount(a, minlength=len(U)); fat = np.bincount(a, weights=hzF[b].astype(float), minlength=len(U))
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str})
px, py = TR.transform(pe.lon.values, pe.lat.values); pP = shapely.points(px, py)
uT = STRtree(uP)
(ai, bi), dd = uT.query_nearest(pP, max_distance=3000, return_distance=True, all_matches=False)
nev = np.bincount(bi, minlength=len(U)); late = pe.date.values >= '20230101'
nlate = np.bincount(bi, weights=late[ai].astype(float), minlength=len(U))
df = pd.DataFrame(dict(lon=ulon, lat=ulat, ncoast=ncoast, hz=cnt, hzfat=fat, n=nev, n_late=nlate))
df['mz'] = (np.floor(df.lat / 0.5).astype(int) * 1000 + np.floor(df.lon / 0.5).astype(int)).astype(str)
df['bin'] = pd.cut(df.hz, [0, 1, 3, 6, 999], right=False, labels=['0', '1-2', '3-5', '6+']).astype(str)
df['bin_fine'] = pd.cut(df.hz, [0, 1, 2, 3, 4, 6, 9, 999], right=False, labels=['0', '1', '2', '3', '4-5', '6-8', '9+']).astype(str)
out = []
for yv in ('n', 'n_late'):
    for bc in ('bin', 'bin_fine'):
        X = pd.get_dummies(df[bc], prefix=bc, dtype=float).drop(columns=bc + '_0')
        X = sm.add_constant(pd.concat([X, np.log(df[['ncoast']]), pd.get_dummies(df.mz, prefix='mz', drop_first=True, dtype=float)], axis=1))
        m = sm.GLM(df[yv], X, family=sm.families.Poisson()).fit(cov_type='HC1')
        for c in X.columns:
            if c.startswith(bc):
                out.append(dict(outcome=yv, bins=bc, term=c, RR=np.exp(m.params[c]), lo=np.exp(m.params[c] - 1.96 * m.bse[c]), hi=np.exp(m.params[c] + 1.96 * m.bse[c]),
                                units=len(df), events=int(df[yv].sum())))
res = pd.DataFrame(out); res.to_csv(R + '/coastgrid_hazard_models.csv', index=False, encoding='utf-8-sig')
desc = df.groupby('bin_fine').agg(units=('n', 'size'), events=('n', 'sum'), coast_cells=('ncoast', 'mean')).reset_index()
desc['events_per_unit_per_year'] = desc.events / desc.units / 5
desc.to_csv(R + '/coastgrid_hazard_desc.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 200)
print(desc.round(3).to_string(index=False)); print(res.round(3).to_string(index=False))
print('units', len(df), 'events assigned', int(df.n.sum()), 'of', len(pe))
