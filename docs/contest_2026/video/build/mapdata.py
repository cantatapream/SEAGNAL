"""지도 그림용 자료 만들기 → data/map.js (SVG path 문자열, 지도 단위 px)
- 육지: client/land_mask_korea.json(origin/main) 중 한반도 범위, Douglas-Peucker 로 단순화
- 특보구역: client/assets/warn_zones.geojson(44) · warn_zones_sub.geojson(49) — 이름 포함
- 관광지: local_server/config/coastal_safety/coastal_spots.json(1,354곳) 좌표
투영: 위도 35.8° 기준 등장방형(경도에 cos 보정), K px/도."""
import json, math, os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
LON0, LAT0, K = 127.8, 35.8, 125.0
CL = math.cos(math.radians(LAT0))
BB = (123.0, 132.6, 31.6, 39.7)


def P(lon, lat):
    return ((lon - LON0) * CL * K, -(lat - LAT0) * K)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L if L > 1e-12 else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [a, b]


def path(rings, eps=0.9):
    out = []
    for r in rings:
        q = [P(*p[:2]) for p in r]
        if len(q) > 3 and q[0] == q[-1]:
            q = rdp(q[:-1], eps) + [q[0]] if len(q) > 4 else q
        else:
            q = rdp(q, eps)
        if len(q) < 3:
            continue
        xs = [p[0] for p in q]; ys = [p[1] for p in q]
        if max(xs) - min(xs) < 2.5 and max(ys) - min(ys) < 2.5:
            continue
        out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in q) + 'Z')
    return ''.join(out)


land = json.load(open(os.path.join(D, 'land_mask_korea.json')))['rings']
land = [r for r in land if any(BB[0] <= p[0] <= BB[1] and BB[2] <= p[1] <= BB[3] for p in r)]
# 범위 밖 점은 범위 테두리로 눌러 붙인다(화면 밖이라 모양 차이가 안 보임) → 단순화로 줄어듦
land = [[[min(max(p[0], BB[0]), BB[1]), min(max(p[1], BB[2]), BB[3])] for p in r] for r in land]
landPath = path(land)


def zones(fn):
    g = json.load(open(os.path.join(D, fn)))
    res = []
    for f in g['features']:
        gm = f['geometry']
        rings = gm['coordinates'] if gm['type'] == 'Polygon' else [r for poly in gm['coordinates'] for r in poly]
        z = {'name': f['properties']['name'], 'd': path(rings, 0.35)}
        hg = f['properties'].get('_holedGeometry')
        if hg:   # 연안바다·평수구역 자리를 구멍으로 뺀 모양(칠할 때 사용, evenodd)
            hr = []
            if hg['type'] == 'Polygon':
                hr = hg['coordinates']
            else:
                for poly in hg['coordinates']:
                    hr.extend(poly)
            z['dh'] = path(hr, 0.35)
        res.append(z)
    return res


z44, z49 = zones('warn_zones.geojson'), zones('warn_zones_sub.geojson')
sp = json.load(open(os.path.join(D, 'coastal_spots.json')))['spots']
spots = [[round(P(s['lon'], s['lat'])[0], 1), round(P(s['lon'], s['lat'])[1], 1), s['name'], s['sgg_name']] for s in sp]
js = 'window.MAP=' + json.dumps({'K': K, 'lon0': LON0, 'lat0': LAT0, 'cl': CL, 'land': landPath, 'z44': z44, 'z49': z49, 'spots': spots}, ensure_ascii=False) + ';'
open(os.path.join(D, 'map.js'), 'w').write(js)
print('land', len(landPath), 'z44', len(z44), sum(len(z['d']) for z in z44), 'z49', len(z49), sum(len(z['d']) for z in z49), 'spots', len(spots), 'bytes', len(js))
