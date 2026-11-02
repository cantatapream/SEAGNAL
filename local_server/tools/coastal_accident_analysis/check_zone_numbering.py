"""해구 예측자료(포털 파일셋)의 해구번호·칸 의미를 apihub 응답(좌표 포함)과 저장소 marine_zone_area.json 으로 대조한다.
사용: python3 -I check_zone_numbering.py <marine_zip> <member> <apihub_txt> <repo_root>
"""
import sys, zipfile, json, collections
zp, member, api_txt, root = sys.argv[1:5]
rows = zipfile.ZipFile(zp).read(member).decode('latin-1').splitlines()
dat = collections.defaultdict(list)
for l in rows:
    p = l.split(); dat[int(p[0])].append([float(x) for x in p[1:]])
api = collections.defaultdict(list)
for l in open(api_txt, 'rb').read().decode('euc-kr', 'replace').splitlines():
    if l.startswith('#') or not l.strip(): continue
    p = l.split()
    z = int(p[2]); lat_lb, lon_lb, lat_rt, lon_rt = float(p[3]), float(p[4]), float(p[7]), float(p[8])
    wh, wp, wd_w, ws, wd = map(float, p[11:16])
    api[z].append(dict(lat=(lat_lb + lat_rt) / 2, lon=(lon_lb + lon_rt) / 2, wh=wh, wp=wp, wvdr=wd_w, ws=ws, wd=wd))
print('data zones', len(dat), 'rows', sum(len(v) for v in dat.values()), '| api zones', len(api), 'rows', sum(len(v) for v in api.values()))
# 값 대조 (같은 번호가 2행인 경우는 순서대로 짝)
n = ok = 0; bad = []
for z, lst in dat.items():
    al = api.get(z, [])
    for i, v in enumerate(lst):
        if i >= len(al): bad.append((z, 'no api row')); continue
        a = al[i]; n += 1
        # 파일 칸: 파고, 파향, 최대파주기, 풍속, 풍향 (과제 설명) — apihub 와 대조
        same = abs(v[0] - a['wh']) < 0.051 and abs(v[1] - a['wvdr']) < 0.51 and abs(v[2] - a['wp']) < 0.051 and abs(v[3] - a['ws']) < 0.051 and abs(v[4] - a['wd']) < 0.51
        if same: ok += 1
        else: bad.append((z, v, a))
print('value match (wh,wvdr,wp,ws,wd 순서):', ok, '/', n)
for b in bad[:5]: print('  mismatch', b)
# 좌표 대조: apihub 중심 vs marine_zone_area.json
area = json.load(open(root + '/client/marine_zone_area.json'))['features']
cent = collections.defaultdict(list)
for f in area:
    ring = f['geometry']['coordinates'][0][0]
    xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
    cent[int(f['properties']['marine_zone_no'])].append(((min(ys) + max(ys)) / 2, (min(xs) + max(xs)) / 2, f['properties']['orgnl_marinezone_no']))
cm = cn = 0; cbad = []
for z, al in api.items():
    for a in al:
        cs = cent.get(z, [])
        cn += 1
        if any(abs(c[0] - a['lat']) < 1e-4 and abs(c[1] - a['lon']) < 1e-4 for c in cs): cm += 1
        else: cbad.append((z, round(a['lat'], 3), round(a['lon'], 3), cs))
print('api 중심이 marine_zone_area 같은 번호 칸 중심과 일치:', cm, '/', cn)
for b in cbad[:10]: print('  center mismatch', b)
