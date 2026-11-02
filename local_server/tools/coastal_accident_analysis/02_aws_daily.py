"""육상 AWS 시간 풍속(72개 월 파일) → 지점별 KST 일 최대 풍속. 지점 좌표는 기상자료개방포털 지점정보(이력 포함)에서.
출력: data/aws_daily_all.csv.gz (stn,date,ws_max,ws_day_max(06~18시),n_hours)
      data/aws_stations.csv (stn,name,lat,lon,elev,anemo_h,addr,start,end) — 2020~2025 와 가장 많이 겹치는 이력 행
사용: python3 -I 02_aws_daily.py <csv_dir> <meta_csv> <out_dir>
"""
import sys, os, glob, gzip, csv, io, collections, datetime as dt
csv_dir, meta, out = sys.argv[1:4]
# 지점정보
txt = open(meta, 'rb').read().decode('cp949')
rows = [r for r in csv.reader(io.StringIO(txt)) if r and r[0].strip().isdigit()]
def overlap(s, e):
    s = s or '1900-01-01'; e = e or '2099-12-31'
    a = max(s, '2020-01-01'); b = min(e, '2025-12-31')
    if a > b: return -1
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
best = {}
for r in rows:
    stn, s, e, nm, addr, org, lat, lon, elev = r[:9]
    anemo = r[11] if len(r) > 11 else ''
    ov = overlap(s.strip(), e.strip())
    if stn not in best or ov > best[stn][0]:
        best[stn] = (ov, dict(stn=stn, name=nm, lat=lat, lon=lon, elev=elev, anemo_h=anemo, addr=addr, start=s, end=e))
# 위치가 바뀐 지점 수(2020~2025 기간 안에서)
moved = collections.Counter()
for r in rows:
    stn, s, e = r[0], r[1].strip(), r[2].strip()
    if overlap(s, e) >= 0: moved[stn] += 1
print('stations in meta', len(best), 'with >1 record overlapping 2020-2025:', sum(1 for v in moved.values() if v > 1))
with open(os.path.join(out, 'aws_stations.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['stn', 'name', 'lat', 'lon', 'elev', 'anemo_h', 'addr', 'start', 'end', 'n_records_2020_2025'])
    w.writeheader()
    for stn, (ov, d) in sorted(best.items(), key=lambda x: int(x[0])):
        d['n_records_2020_2025'] = moved.get(stn, 0); w.writerow(d)
# 일 최대
agg = {}
for fn in sorted(glob.glob(os.path.join(csv_dir, 'aws_hr_wind_*.csv.gz'))):
    with gzip.open(fn, 'rt', encoding='cp949') as f:
        next(f)
        for line in f:
            p = line.rstrip('\n').split(',')
            if len(p) < 5 or p[4] == '':
                continue
            ws = float(p[4])
            if ws < 0 or ws > 75:
                continue
            date = p[2][:10].replace('-', ''); hh = int(p[2][11:13])
            k = (p[0], date)
            a = agg.get(k)
            if a is None:
                a = agg[k] = [ws, -1.0, 0]
            if ws > a[0]: a[0] = ws
            if 6 <= hh <= 18 and ws > a[1]: a[1] = ws
            a[2] += 1
    print(os.path.basename(fn), len(agg), flush=True)
with gzip.open(os.path.join(out, 'aws_daily_all.csv.gz'), 'wt') as f:
    f.write('stn,date,ws_max,ws_day_max,n_hours\n')
    for (stn, date), a in sorted(agg.items(), key=lambda x: (int(x[0][0]), x[0][1])):
        f.write('%s,%s,%.1f,%s,%d\n' % (stn, date, a[0], ('%.1f' % a[1]) if a[1] >= 0 else '', a[2]))
print('done rows', len(agg))
