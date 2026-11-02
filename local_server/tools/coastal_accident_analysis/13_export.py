"""저장소에 남길 작은 가공 자료 만들기(원본 1.6GB 는 세션 종료 시 사라짐).
출력 폴더: repo_data/
  marine_daily_kst_2020_2025.csv.gz  — 대해구(사고·관광지에 연결된 칸)별 KST 일 최대·낮 최대 파고·풍속
  marine_zones_korea.csv             — 대해구 번호·중심 좌표(apihub 응답 기준, 2025-12-31 00UTC 로 확인)
  aws_daily_coastal_2020_2025.csv.gz — 해안 AWS(사고에 연결된 지점 + 관광지 최근접 지점) 일 최대 풍속
  aws_stations_coastal.csv           — 그 지점들의 좌표·해안선 거리
  visitors_daily_coastal_sgg_2020_2024.csv.gz — 해안 시군구 일별 방문자(현지인·외지인·외국인)
  warn_daily_2020_2025.csv.gz        — 특보구역(해상 44 + 강풍 육상 이름)별 발효일·수준·발효시간(희소 표)
  accident_features_person_2020_2024.csv.gz / accident_features_ship_2020_2025.csv.gz — 사고별 연결·당일 노출
  spots_hazard_3km.csv               — 관광지별 위험구역 3km 개수(분류별)·관광지 몫 사고 수
사용: python3 -I 13_export.py <data_dir> <results_dir> <out_dir>
"""
import sys, os, gzip, json, csv, math
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo
D, R, O = sys.argv[1:4]; os.makedirs(O, exist_ok=True)
gp = pd.read_csv(D + '/geo_person.csv', dtype={'date': str, 'sgg': str, 'aws': str})
gs = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str})
sp = pd.read_csv(D + '/spots_features.csv', dtype={'sgg': str})
mz = pd.read_csv(D + '/marine_zones.csv')
md = pd.read_csv(D + '/marine_daily.csv.gz', dtype={'date': str})
valid = set(md.zone.unique())
mzv = mz[mz.zone.isin(valid)]
def nearest_mz(la, lo):
    inc = mzv[(abs(mzv.lat - la) <= 0.25) & (abs(mzv.lon - lo) <= 0.25)]
    if len(inc): return int(inc.zone.iloc[0])
    d = np.hypot((mzv.lat - la) * 111, (mzv.lon - lo) * 111 * math.cos(math.radians(la)))
    return int(mzv.zone.iloc[int(np.argmin(d.values))])
spz = {nearest_mz(a, b) for a, b in zip(sp.lat, sp.lon)}
zones = sorted(set(gp.mzone) | set(gs.mzone) | spz)
m = md[md.zone.isin(zones)][['zone', 'date', 'wh_max', 'ws_max', 'wh_day_max', 'ws_day_max', 'max_lead']]
m.to_csv(O + '/marine_daily_kst_2020_2025.csv.gz', index=False, compression='gzip')
mz[mz.zone.isin(zones)].to_csv(O + '/marine_zones_korea.csv', index=False)
print('marine zones', len(zones), 'rows', len(m))
st = pd.read_csv(D + '/aws_stations_geo.csv', dtype={'stn': str})
co = st[st.coastal == 1]
def nearest_st(la, lo):
    d = np.hypot((co.lat - la) * 111, (co.lon - lo) * 111 * math.cos(math.radians(la))); j = int(np.argmin(d.values))
    return co.stn.iloc[j] if d.iloc[j] <= 15 else None
sps = {nearest_st(a, b) for a, b in zip(sp.lat, sp.lon)} - {None}
stns = sorted(set(gp.aws.dropna()) | sps, key=int)
with gzip.open(D + '/aws_daily_all.csv.gz', 'rt') as f, gzip.open(O + '/aws_daily_coastal_2020_2025.csv.gz', 'wt') as g:
    g.write(next(f)); n = 0
    S = set(stns)
    for line in f:
        if line.split(',', 1)[0] in S: g.write(line); n += 1
st[st.stn.isin(stns)][['stn', 'name', 'lat', 'lon', 'elev', 'anemo_h', 'addr', 'coast_m', 'in_land', 'days_ok']].to_csv(O + '/aws_stations_coastal.csv', index=False, encoding='utf-8-sig')
print('aws stations', len(stns), 'rows', n)
v = pd.read_csv(D + '/visitors_daily_coastal.csv.gz', dtype={'sgg': str, 'date': str})
names = json.load(open(D + '/datalab_sgg_names.json'))
v.insert(1, 'sgg_name', v.sgg.map(names)); v.to_csv(O + '/visitors_daily_coastal_sgg_2020_2024.csv.gz', index=False, compression='gzip')
print('visitors rows', len(v))
# 특보 일 표(희소)
ex = expo.load_exact(D + '/warn_intervals_exact.json')
zs = sorted({k[0] for k in ex})
W = expo.daily_warn(ex, zs)
with gzip.open(O + '/warn_daily_2020_2025.csv.gz', 'wt') as g:
    g.write('zone,date,type,level,hours,hours_0618\n'); n = 0
    for z in zs:
        for t in ('TY', 'WV', 'GW'):
            a = W[z][t]
            for i in np.where(a['lvl'] > 0)[0]:
                g.write('%s,%s,%s,%s,%.1f,%.1f\n' % (z, expo.DATES[i].strftime('%Y%m%d'), t, '주의보' if a['lvl'][i] == 1 else '경보', a['hours'][i], a['dayh'][i])); n += 1
print('warn rows', n)
# 사고별 특징표
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pc = pr[pr.case == 1].sort_values('ev')
pe = gp[gp.sea_zone.notna()].reset_index(drop=True)
feat = pe[['pid', 'date', 'type', 'lat', 'lon', 'death', 'missing', 'sea_zone', 'sea_d_m', 'land_zone', 'gw_keys', 'mzone', 'aws', 'aws_d_km', 'sgg', 'spot', 'spot_d_m', 'hz_3km_at_acc', 'flags_type']].copy()
for c in ['wv', 'ty', 'gw', 'wv_dh', 'ty_dh', 'gw_dh', 'wh_max', 'ws_max', 'wh_day_max', 'ws_day_max', 'aws_ws', 'v_local', 'v_outsider', 'v_foreign', 'dow', 'hol']:
    feat[c] = pc[c].values
feat = feat.rename(columns={'flags_type': 'stored_flags(app)'})
feat.to_csv(O + '/accident_features_person_2020_2024.csv.gz', index=False, compression='gzip')
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz'); sc = sr[sr.case == 1].sort_values('ev')
se = gs[gs.sea_zone.notna()].reset_index(drop=True)
fs = se[['eid', 'date', 'hm', 'types', 'lat', 'lon', 'death', 'missing', 'sea_zone', 'sea_d_m', 'mzone', 'src2025', 'n_rows', 'flags_type']].copy()
for c in ['wv', 'ty', 'wv_h', 'ty_h', 'wh_max', 'ws_max', 'dow', 'hol']:
    fs[c] = sc[c].values
fs = fs.rename(columns={'flags_type': 'stored_flags(app)'})
fs.to_csv(O + '/accident_features_ship_2020_2025.csv.gz', index=False, compression='gzip')
spc = pd.read_csv(R + '/spots_with_counts.csv', dtype={'sgg': str})
spc[['spot', 'name', 'sgg', 'sgg_name', 'lat', 'lon', 'on', 'hz_all_3km', 'hz_fatal_3km', 'hz_freq_3km', 'hz_risk_3km', 'coast_cells_share', 'n_all', 'n_2020_22', 'n_2023_24', 'n_fatal']].to_csv(O + '/spots_hazard_3km.csv', index=False, encoding='utf-8-sig')
for fn in sorted(os.listdir(O)): print(fn, os.path.getsize(O + '/' + fn))
