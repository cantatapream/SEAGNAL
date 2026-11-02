"""해구 예측자료(기상자료개방포털 파일셋, 72개 zip)를 풀지 않고 스트리밍해 3시간 간격 계열과 KST 일 단위 값을 만든다.

방법(보고서에 적는 선택):
  - 각 유효시각(UTC 00,03,...,21)마다 '가장 짧은 선행시간'의 예측값을 쓴다. 평소에는 00/12UTC 발표의 h000~h009 로 채워진다.
  - 12UTC 발표가 빠진 날(2022-08-12~31)은 같은 날 00UTC 발표의 h012~h021 로 채운다(선행 21시간까지만 허용).
  - 그보다 긴 선행이 필요한 시각(발표가 통째로 빠진 기간)은 결측으로 둔다 → 그 날은 분석에서 분모·분자 모두 제외.
  - 결측값 -999 는 결측 처리.
  - KST 날짜 D = UTC D-1 15시 ~ D 12시의 8개 유효시각. 8개가 모두 있어야 그 날 값을 낸다.
출력:
  data/marine_3h.npz  — times(UTC, int YYYYMMDDHH), zones, wh, ws, wp, lead (float32) [작업용]
  data/marine_daily.csv.gz — zone, date(KST), wh_max, ws_max, wh_mean, ws_mean, wh_day_max(06~18 KST), ws_day_max, max_lead  [저장소 후보]
  data/marine_zones.csv — zone, lat, lon (apihub 응답의 칸 좌표, 중심)
사용: python3 -I 01_marine_series.py <zip_dir> <apihub_txt> <out_dir>
"""
import sys, os, re, zipfile, glob, datetime as dt, gzip
import numpy as np

zip_dir, api_txt, out = sys.argv[1:4]
# 1) 해구 좌표(apihub 응답) — 한국 주변만
zc = {}
for l in open(api_txt, 'rb').read().decode('euc-kr', 'replace').splitlines():
    if l.startswith('#') or not l.strip():
        continue
    p = l.split()
    z = int(p[2]); lat = (float(p[3]) + float(p[7])) / 2; lon = (float(p[4]) + float(p[8])) / 2
    zc[z] = (lat, lon)
zones = sorted(z for z, (la, lo) in zc.items() if 31.0 <= la <= 40.0 and 123.0 <= lo <= 132.5 and z != 7432)
zidx = {z: i for i, z in enumerate(zones)}
print('zones kept', len(zones))
with open(os.path.join(out, 'marine_zones.csv'), 'w') as f:
    f.write('zone,lat,lon\n')
    for z in zones:
        f.write('%d,%.2f,%.2f\n' % (z, zc[z][0], zc[z][1]))

# 2) 유효시각 축: 2019-12-31 15UTC ~ 2025-12-31 12UTC (KST 2020-01-01 ~ 2025-12-31)
t0 = dt.datetime(2019, 12, 31, 15)
nT = int((dt.datetime(2025, 12, 31, 12) - t0).total_seconds() // 10800) + 1
NZ = len(zones)
wh = np.full((nT, NZ), np.nan, np.float32); ws = np.full_like(wh, np.nan); wp = np.full_like(wh, np.nan)
lead_used = np.full(nT, 99, np.int16)
pat = re.compile(r'marine_wave_h(\d{3})_(\d{10})\.txt$')
nfiles = 0
for zp in sorted(glob.glob(os.path.join(zip_dir, 'marine_*.zip'))):
    zf = zipfile.ZipFile(zp)
    for name in zf.namelist():
        m = pat.search(name)
        if not m:
            continue
        lead = int(m.group(1))
        if lead > 21:
            continue
        run = dt.datetime.strptime(m.group(2), '%Y%m%d%H')
        vt = run + dt.timedelta(hours=lead)
        ti = int((vt - t0).total_seconds() // 10800)
        if ti < 0 or ti >= nT or lead >= lead_used[ti]:
            continue
        arr = np.array(zf.read(name).split(), dtype=np.float64).reshape(-1, 6)
        # 같은 번호가 두 번 나오는 7432 는 위에서 제외. 나머지 번호는 1회.
        rows = [zidx.get(int(n), -1) for n in arr[:, 0]]
        sel = np.array([i for i, r in enumerate(rows) if r >= 0]); tgt = np.array([rows[i] for i in sel])
        v = arr[sel]
        v[v <= -998] = np.nan
        wh[ti, :] = np.nan; ws[ti, :] = np.nan; wp[ti, :] = np.nan
        wh[ti, tgt] = v[:, 1]; wp[ti, tgt] = v[:, 3]; ws[ti, tgt] = v[:, 4]
        lead_used[ti] = lead
        nfiles += 1
    print(os.path.basename(zp), 'files used so far', nfiles, flush=True)
times = np.array([int((t0 + dt.timedelta(hours=3 * i)).strftime('%Y%m%d%H')) for i in range(nT)])
np.savez_compressed(os.path.join(out, 'marine_3h.npz'), times=times, zones=np.array(zones), wh=wh, ws=ws, wp=wp, lead=lead_used)
print('3h slots', nT, 'missing slots (no run within lead<=21):', int((lead_used == 99).sum()),
      'lead histogram', {int(k): int(v) for k, v in zip(*np.unique(lead_used, return_counts=True))})

# 3) KST 일 단위
nD = nT // 8
assert nT == nD * 8
with gzip.open(os.path.join(out, 'marine_daily.csv.gz'), 'wt') as f:
    f.write('zone,date,wh_max,ws_max,wh_mean,ws_mean,wh_day_max,ws_day_max,max_lead\n')
    for d in range(nD):
        sl = slice(8 * d, 8 * d + 8)
        date = (t0 + dt.timedelta(hours=24 * d + 9)).strftime('%Y%m%d')  # KST 날짜 = UTC 시작 + 9h
        L = lead_used[sl]
        if (L == 99).any():
            continue  # 그 날 발표 공백 → 하루 통째 결측
        W = wh[sl]; S = ws[sl]
        ok = ~np.isnan(W).any(axis=0) & ~np.isnan(S).any(axis=0)
        # 낮(KST 06~18) = 슬롯 2..6 (UTC 21,00,03,06,09)
        Wd = W[2:7]; Sd = S[2:7]
        for j in np.where(ok)[0]:
            f.write('%d,%s,%.1f,%.1f,%.2f,%.2f,%.1f,%.1f,%d\n' % (zones[j], date, W[:, j].max(), S[:, j].max(), W[:, j].mean(), S[:, j].mean(),
                                                               Wd[:, j].max(), Sd[:, j].max(), int(L.max())))
print('done')
