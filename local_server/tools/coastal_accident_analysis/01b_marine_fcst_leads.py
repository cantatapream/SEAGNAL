"""해구 파랑 예측 원자료(zip)에서 '그 날을 며칠 전에 어떻게 예보했나'를 KST 일 단위로 정리한다 (분석 아님, 정리만).

무엇을: 각 KST 날짜 D(00~24시)에 대해 lead_day = 0, 1, 2 별로 예보 run 하나를 골라,
        그 run 의 예측 중 유효시각이 D 에 들어가는 3시간 칸(8개)의 최대값(파고 wh, 풍속 ws, 주기 wp)을 낸다.
        01_marine_series.py 와 달리 선행시간(lead) 0~72h 전부를 쓴다. 해구 집합·결측 처리도 그 스크립트와 같다.

run 선택 규칙(필수 기록):
  - 파일 이름 marine_wave_hLLL_YYYYMMDDHH.txt 의 YYYYMMDDHH 는 UTC 로 취급(01_marine_series.py 와 동일: 유효시각 = run + LLL시간, KST = UTC+9).
  - 발표 주기는 00UTC·12UTC (실제 파일 이름에서 확인).
  - 기준시각 T = (KST D 날짜 0시) - 24*lead_day 시간 = UTC (D-1일) 15시 - 24*lead_day 시간.
  - run 은 'T 이하(발표 시각 <= T)' 중 가장 늦은 00/12UTC run. T 는 항상 15UTC 이므로 정상일 땐 UTC (D-1-lead_day)일 12시 run.
  - 그 run 이 원자료에 없으면(발표 누락) 12시간 앞선 run(같은 날 00UTC)으로 한 번만 물러난다. 그것도 없으면 그 행은 만들지 않는다. 쓴 run 은 run 열에 기록.
  - 유효시각 = D 의 8개 칸(UTC (D-1)15,18,21, D 00,03,...,12)에 해당하는 h파일이 있어야 그 칸이 채워진다.
    wh_max = 칸들 중 wh 가 결측(-998 이하)이 아닌 것의 최대, ws_max·wp_max 도 같은 방식. n_slots = wh 가 유효한 칸 수(0~8). n_slots=0 인 행은 쓰지 않는다.
    8칸 모두 필요하면 분석 쪽에서 n_slots==8 로 거른다.
  - 정상 run(12UTC 기준)의 선행시간 범위: lead_day0 → 3~24h, lead_day1 → 27~48h, lead_day2 → 51~72h. 00UTC 로 물러난 행은 +12h (run 열로 구별).
  - 해구 번호: data/marine_daily.csv.gz 에 있는 zone 만 (7432 중복 번호 제외 — 그 파일에서 이미 빠져 있음). 날짜 범위 KST 20200101~20251231.
출력: <out_dir>/marine_fcst_daily.csv.gz — zone,target_date,lead_day,run,wh_max,ws_max,wp_max,n_slots
사용: python3 -I 01b_marine_fcst_leads.py <zip_dir> <marine_daily.csv.gz> <out_dir>
"""
import sys, os, re, zipfile, glob, gzip, datetime as dt
import numpy as np

zip_dir, daily_csv, out = sys.argv[1:4]
with gzip.open(daily_csv, 'rt') as f:
    next(f)
    zones = sorted({int(l.split(',')[0]) for l in f})
assert 7432 not in zones
zidx = {z: i for i, z in enumerate(zones)}
NZ = len(zones)
print('zones', NZ)

pat = re.compile(r'marine_wave_h(\d{3})_(\d{10})\.txt$')
index = {}   # (run datetime, lead) -> (zip path, name)
for zp in sorted(glob.glob(os.path.join(zip_dir, 'marine_*.zip'))):
    for name in zipfile.ZipFile(zp).namelist():
        m = pat.search(name)
        if not m:
            continue
        key = (dt.datetime.strptime(m.group(2), '%Y%m%d%H'), int(m.group(1)))
        assert key not in index, ('중복 파일', key)
        index[key] = (zp, name)
print('files', len(index))

zfs = {}
cache = {}
def load(run, lead):
    """(NZ,3) = wh,ws,wp (결측 NaN). 파일 없으면 None."""
    k = (run, lead)
    if k in cache:
        return cache[k]
    if k not in index:
        return None
    zp, name = index[k]
    zf = zfs.get(zp) or zfs.setdefault(zp, zipfile.ZipFile(zp))
    arr = np.array(zf.read(name).split(), dtype=np.float64).reshape(-1, 6)
    res = np.full((NZ, 3), np.nan)
    for r in arr:
        j = zidx.get(int(r[0]))
        if j is not None:
            res[j] = (r[1], r[4], r[3])
    res[res <= -998] = np.nan
    if len(cache) > 400:
        cache.clear()
    cache[k] = res
    return res

d0 = dt.datetime(2020, 1, 1); d1 = dt.datetime(2025, 12, 31)
rows = 0
nfall = {0: 0, 1: 0, 2: 0}
with gzip.open(os.path.join(out, 'marine_fcst_daily.csv.gz'), 'wt') as f:
    f.write('zone,target_date,lead_day,run,wh_max,ws_max,wp_max,n_slots\n')
    D = d0
    while D <= d1:
        start_utc = D - dt.timedelta(hours=9)          # KST D 00시 = UTC (D-1) 15시
        for k in (0, 1, 2):
            T = start_utc - dt.timedelta(hours=24 * k)
            nominal = T - dt.timedelta(hours=3)         # T 는 15UTC → 가장 늦은 00/12UTC run = 12UTC
            assert nominal.hour == 12
            chosen = None
            for run in (nominal, nominal - dt.timedelta(hours=12)):
                if any((run, L) in index for L in range(0, 73, 3)):
                    chosen = run
                    break
            if chosen is None:
                continue
            if chosen != nominal:
                nfall[k] += 1
            W = []
            for s in range(8):
                vt = start_utc + dt.timedelta(hours=3 * s)
                lead = int((vt - chosen).total_seconds() // 3600)
                a = load(chosen, lead) if 0 <= lead <= 72 else None
                if a is not None:
                    W.append(a)
            if not W:
                continue
            W = np.stack(W)                              # (slots, NZ, 3)
            valid = ~np.isnan(W[:, :, 0])
            n = valid.sum(axis=0)
            with np.errstate(all='ignore'):
                mx = np.nanmax(np.where(np.isnan(W), -np.inf, W), axis=0)
            mx[np.isinf(mx)] = np.nan
            ds = D.strftime('%Y%m%d'); rs = chosen.strftime('%Y%m%d%H')
            for j in np.where(n > 0)[0]:
                f.write('%d,%s,%d,%s,%s,%s,%s,%d\n' % (zones[j], ds, k, rs,
                        *['' if np.isnan(x) else '%.1f' % x for x in mx[j]], n[j]))
                rows += 1
        D += dt.timedelta(days=1)
print('rows', rows, 'fallback to 00UTC (날짜 단위)', nfall)
