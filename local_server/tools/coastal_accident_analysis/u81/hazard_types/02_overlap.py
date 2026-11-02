"""위험구역 종류끼리 겹치는가 — ① 폴리곤 겹침·거리 ② 같은 장소명·주소 ③ 관광지에서 함께 나타나는 정도.
사용: python3 -I 02_overlap.py <repo_root> <out_dir>   (01_type_models.py 가 만든 <out_dir>/spots_type_features.csv 필요)
"""
import sys, json, collections, re
import numpy as np, pandas as pd, shapely
from shapely.geometry import shape
from shapely.strtree import STRtree
from pyproj import Transformer

root, OUT = sys.argv[1:3]
TR = Transformer.from_crs(4326, 5179, always_xy=True)
def P(g):
    return shapely.transform(g, lambda xy: np.column_stack(TR.transform(xy[:, 0], xy[:, 1])))
LAB = {'연안사고 위험구역': '위험', '사망사고 발생구역': '사망', '연안사고 다발구역': '다발'}
hz = json.load(open(root + '/local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson'))['features']
G = [shapely.make_valid(P(shape(f['geometry']))) for f in hz]
K = np.array([LAB[f['properties']['구역분류']] for f in hz])
props = [f['properties'] for f in hz]
T = STRtree(G)
out = []
pr = lambda *a: out.append(' '.join(str(x) for x in a))

# ① 폴리곤 겹침(면적 > 1㎡)·닿음, 종류 쌍별
a_, b_ = T.query(G, predicate='intersects')
pairs = collections.Counter(); touch = collections.Counter(); ov_zone = collections.defaultdict(set)
for a, b in zip(a_, b_):
    if a >= b: continue
    key = '-'.join(sorted([K[a], K[b]]))
    ar = G[a].intersection(G[b]).area
    if ar > 1:
        pairs[key] += 1; ov_zone[(a, K[b])].add(b); ov_zone[(b, K[a])].add(a)
    else:
        touch[key] += 1
rows = []
for key in sorted(set(pairs) | set(touch) | {'위험-위험', '사망-사망', '다발-다발', '사망-위험', '다발-위험', '다발-사망'}):
    rows.append(dict(type_pair=key, overlapping_pairs_area_gt_1m2=pairs.get(key, 0), touching_only_pairs=touch.get(key, 0)))
ovp = pd.DataFrame(rows); ovp.to_csv(OUT + '/overlap_polygon_pairs.csv', index=False, encoding='utf-8-sig')

# 종류별: 다른 종류 구역과 면적이 겹치는 구역 수 / 가장 가까운 다른 종류 구역까지 거리
rows = []
for t in ['위험', '사망', '다발']:
    idx = np.where(K == t)[0]
    r = dict(type=t, zones=len(idx), area_median_m2=float(np.median([G[i].area for i in idx])))
    for u in ['위험', '사망', '다발']:
        if u == t: continue
        others = [G[j] for j in np.where(K == u)[0]]
        TU = STRtree(others)
        (ai, bi), dd = TU.query_nearest([G[i] for i in idx], return_distance=True, all_matches=False)
        d = np.full(len(idx), np.nan); d[ai] = dd
        r['overlap_area_with_%s' % u] = sum(1 for i in idx if ov_zone.get((i, u)))
        r['nearest_%s_le_0m' % u] = int((d <= 0).sum())
        r['nearest_%s_le_100m' % u] = int((d <= 100).sum())
        r['nearest_%s_le_500m' % u] = int((d <= 500).sum())
        r['nearest_%s_median_m' % u] = float(np.median(d))
    rows.append(r)
dist = pd.DataFrame(rows); dist.to_csv(OUT + '/overlap_distance_by_type.csv', index=False, encoding='utf-8-sig')

# ② 같은 장소명·같은 주소가 다른 종류로 두 번 이상 지정됐나
norm = lambda s: re.sub(r'\s|\(인근\)|대한민국', '', s or '')
for fld in ['장소명', '주소']:
    by = collections.defaultdict(list)
    for i, p in enumerate(props): by[norm(p[fld])].append(i)
    multi = {k: v for k, v in by.items() if len(v) > 1 and k}
    mixed = {k: v for k, v in multi.items() if len(set(K[v])) > 1}
    pr('%s: 같은 값이 2번 이상 = %d개 값(%d구역), 그중 종류가 섞인 것 = %d개 값' % (fld, len(multi), sum(len(v) for v in multi.values()), len(mixed)))
    for k, v in list(mixed.items())[:15]:
        pr('   ', k, [(props[i]['name'], K[i]) for i in v])

# 장소형태 × 종류
ft = pd.crosstab(pd.Series([p['장소형태'] for p in props], name='장소형태'), pd.Series(K, name='종류'), margins=True)
ft.to_csv(OUT + '/zone_form_by_type.csv', encoding='utf-8-sig')
# 시도(주소 첫 낱말) × 종류
sido = [norm(p['주소'])[:2] for p in props]
st = pd.crosstab(pd.Series(sido, name='주소앞2자'), pd.Series(K, name='종류'), margins=True)
st.to_csv(OUT + '/zone_region_by_type.csv', encoding='utf-8-sig')

# ③ 관광지에서 함께 나타나는 정도
sp = pd.read_csv(OUT + '/spots_type_features.csv', dtype={'sgg': str})
spP = shapely.points(*TR.transform(sp.lon.values, sp.lat.values))
a_, b_ = T.query(spP, predicate='dwithin', distance=3000)
reach = collections.Counter(K[np.unique(b_)])
pr('관광지 3km 안에 한 번이라도 드는 구역 수(종류별):', dict(reach), '/ 전체', dict(collections.Counter(K)))
cols = ['hz_risk_3km', 'hz_fatal_3km', 'hz_freq_3km']
cor_all = sp[cols].corr(method='spearman')
dm = sp[cols] - sp.groupby('sgg')[cols].transform('mean')
cor_within = dm.corr(method='pearson')
anyc = ['risk_any', 'fatal_any', 'freq_any']
phi = sp[anyc].corr()
dmany = sp[anyc] - sp.groupby('sgg')[anyc].transform('mean')
phi_within = dmany.corr()
co = []
for (x, xl), (y, yl) in [(('risk_any', '위험'), ('fatal_any', '사망')), (('risk_any', '위험'), ('freq_any', '다발')), (('fatal_any', '사망'), ('freq_any', '다발'))]:
    both = int(((sp[x] > 0) & (sp[y] > 0)).sum()); nx = int((sp[x] > 0).sum()); ny = int((sp[y] > 0).sum())
    co.append(dict(pair='%s-%s' % (xl, yl), spots_with_first=nx, spots_with_second=ny, spots_with_both=both,
                   share_of_second_that_also_has_first=both / ny, share_of_first_that_also_has_second=both / nx,
                   spearman_counts_all=cor_all.loc['hz_%s_3km' % x.split('_')[0], 'hz_%s_3km' % y.split('_')[0]],
                   pearson_counts_within_sgg=cor_within.loc['hz_%s_3km' % x.split('_')[0], 'hz_%s_3km' % y.split('_')[0]],
                   phi_any_all=phi.loc[x, y], phi_any_within_sgg=phi_within.loc[x, y]))
# 종류별 개수와 '전체 개수' 사이 상관(개수 구간이 종류를 얼마나 대신하나)
for x in cols:
    co.append(dict(pair='%s~전체개수' % x, spearman_counts_all=sp[[x, 'hz_all_3km']].corr(method='spearman').iloc[0, 1],
                   pearson_counts_within_sgg=(sp[[x, 'hz_all_3km']] - sp.groupby('sgg')[[x, 'hz_all_3km']].transform('mean')).corr().iloc[0, 1]))
co = pd.DataFrame(co); co.to_csv(OUT + '/cooccurrence_at_spots.csv', index=False, encoding='utf-8-sig')
# 개수 구간(출발안) × 종류 있음
bt = sp.groupby('bin_start')[anyc].mean().reindex(['0', '1-2', '3-5', '6+'])
bt['spots'] = sp.bin_start.value_counts().reindex(bt.index)
bt.to_csv(OUT + '/type_share_by_bin.csv', encoding='utf-8-sig')

pd.set_option('display.width', 250)
print(ovp.to_string(index=False)); print(dist.round(1).to_string(index=False))
print('\n'.join(out)); print(ft.to_string()); print(st.to_string()); print(co.round(3).to_string(index=False)); print(bt.round(3).to_string())
