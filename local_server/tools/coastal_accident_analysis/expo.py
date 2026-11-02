"""노출(특보·해구 기상·AWS·방문자·달력) 읽기 도우미."""
import json, re, gzip, csv, collections, datetime as dt
import numpy as np, pandas as pd

norm = lambda s: re.sub(r'[\s·.]', '', s)
D0 = dt.date(2020, 1, 1); D1 = dt.date(2025, 12, 31)
DATES = pd.date_range(D0, D1)
DIDX = {d.strftime('%Y%m%d'): i for i, d in enumerate(DATES)}
ND = len(DATES)

def load_exact(path):
    """시각 단위 특보 구간: {(zone_norm, TYPE, LEVEL): [(start_dt, end_dt), ...]} (KST)."""
    raw = json.load(open(path)); out = collections.defaultdict(list)
    for k, arr in raw.items():
        z, t, l = k.split('|')
        for s, e in arr:
            out[(norm(z), t, l)].append((dt.datetime.strptime(s, '%Y-%m-%d %H:%M'), dt.datetime.strptime(e, '%Y-%m-%d %H:%M')))
    return out

def daily_warn(exact, zones, types=('TY', 'WV', 'GW')):
    """zone별 일 배열: lvl[type] (0 없음/1 주의보/2 경보, 그 날과 조금이라도 겹치면 — build_accident_warn_flags.js levelOnDay 와 같은 포함 규칙),
    hours[type] (그 날 0~24시 중 발효 시간), dayh[type] (06~18시 중 발효 시간)."""
    res = {}
    for z in zones:
        r = {}
        for t in types:
            lvl = np.zeros(ND, np.int8); hrs = np.zeros(ND, np.float32); dh = np.zeros(ND, np.float32)
            for L, code in (('주의보', 1), ('경보', 2)):
                for s, e in exact.get((z, t, L), []):
                    if e < dt.datetime(2020, 1, 1) or s > dt.datetime(2026, 1, 1):
                        continue
                    d = max(s.date(), D0)
                    while d <= min(e.date(), D1):
                        i = (d - D0).days
                        day0 = dt.datetime.combine(d, dt.time(0)); day1 = day0 + dt.timedelta(days=1)
                        # 포함 규칙: start <= 'D 23:59' and end >= 'D 00:00'
                        if s <= day0 + dt.timedelta(hours=23, minutes=59) and e >= day0:
                            lvl[i] = max(lvl[i], code)
                            ov = (min(e, day1) - max(s, day0)).total_seconds() / 3600
                            hrs[i] += max(0.0, ov)
                            a, b = day0 + dt.timedelta(hours=6), day0 + dt.timedelta(hours=18)
                            dh[i] += max(0.0, (min(e, b) - max(s, a)).total_seconds() / 3600)
                        d += dt.timedelta(days=1)
            r[t] = dict(lvl=lvl, hours=np.minimum(hrs, 24), dayh=np.minimum(dh, 12))
        res[z] = r
    return res

def active_at(exact, z, t, when):
    """그 시각에 발효 중인 레벨(0/1/2) — build 스크립트 levelAt 과 같은 규칙(start <= t < end)."""
    lv = 0
    for L, code in (('경보', 2), ('주의보', 1)):
        for s, e in exact.get((z, t, L), []):
            if s <= when < e:
                return code
    return lv

def load_marine_daily(path):
    d = pd.read_csv(path, dtype={'date': str})
    d = d[d.date.isin(DIDX)]
    zones = sorted(d.zone.unique()); zi = {z: i for i, z in enumerate(zones)}
    arr = {}
    for col in ('wh_max', 'ws_max', 'wh_day_max', 'ws_day_max', 'wh_mean', 'ws_mean'):
        a = np.full((len(zones), ND), np.nan, np.float32)
        a[d.zone.map(zi).values, d.date.map(DIDX).values] = d[col].values
        arr[col] = a
    return zi, arr

def load_aws_daily(path, stations, min_hours=18):
    stations = set(str(s) for s in stations)
    zi = {s: i for i, s in enumerate(sorted(stations))}
    a = np.full((len(zi), ND), np.nan, np.float32); ad = np.full((len(zi), ND), np.nan, np.float32)
    with gzip.open(path, 'rt') as f:
        next(f)
        for line in f:
            p = line.rstrip('\n').split(',')
            if p[0] in zi and p[1] in DIDX and int(p[4]) >= min_hours:
                a[zi[p[0]], DIDX[p[1]]] = float(p[2])
                if p[3]: ad[zi[p[0]], DIDX[p[1]]] = float(p[3])
    return zi, a, ad

def calendar():
    import holidays
    h = holidays.KR(years=range(2020, 2026))
    dow = DATES.dayofweek.values  # 0=월
    hol = np.array([d.date() in h for d in DATES])
    month = DATES.month.values; year = DATES.year.values
    return dow, hol, month, year
