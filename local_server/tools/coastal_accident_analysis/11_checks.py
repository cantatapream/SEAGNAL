"""검증: (1) 저장된 사고별 특보 딱지 vs 재계산 (2) 강풍 딱지 누락 규모 (3) 선박 시각 딱지 대조 (4) 해구 값 vs 특보(특보일에 파고·풍속이 실제로 높은가)
사용: python3 -I 11_checks.py <data_dir> <results_dir>
"""
import sys, os, collections, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expo
D, R = sys.argv[1:3]
out = []
pr = pd.read_csv(R + '/person_strata_rows.csv.gz'); pc = pr[pr.case == 1].copy()
pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pc['stored'] = pe.flags_type.fillna('').values[pc.ev.values]; pc['sea_d'] = pe.sea_d_m.values[pc.ev.values]
ins = pc[pc.sea_d == 0]
st_wv = ins.stored.str.contains('WV'); st_ty = ins.stored.str.contains('TY'); st_gw = pc.stored.str.contains('GW')
out.append(('인명: 해상특보구역 폴리곤 안 사고 수', len(ins)))
out.append(('  WV 딱지 일치(저장 vs 재계산)', int(((ins.wv >= 1) == st_wv).sum())))
out.append(('  TY 딱지 일치', int(((ins.ty >= 1) == st_ty).sum())))
out.append(('인명: 폴리곤 밖(3km 이내 최근접으로 붙인) 사고 수', int((pc.sea_d > 0).sum())))
out.append(('  그중 재계산상 풍랑·태풍 발효일인데 저장 딱지에는 없는 사고', int(((pc.sea_d > 0) & (pc.seaw >= 1) & ~pc.stored.str.contains('WV|TY')).sum())))
out.append(('인명: 저장 GW 딱지 있는 사고', int(st_gw.sum())))
out.append(('인명: 재계산 GW(강풍) 발효일 사고', int((pc.gw >= 1).sum())))
out.append(('  재계산 GW 있는데 저장 딱지 없음', int(((pc.gw >= 1) & ~st_gw).sum())))
# 선박 시각 딱지
se = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str, 'hm': str}); se = se[se.sea_zone.notna()].reset_index(drop=True)
ex = expo.load_exact(D + '/warn_intervals_exact.json')
def lvl(z, t, when):
    for L, code in (('경보', 2), ('주의보', 1)):
        for s, e in ex.get((z, t, L), []):
            if s <= when < e: return code
    return 0
agree = n = 0; dis = []
for _, r in se[se.sea_d_m == 0].iterrows():
    h, m = map(int, r.hm.split(':'))
    w = dt.datetime.strptime(r.date, '%Y%m%d').replace(hour=h, minute=m)
    z = expo.norm(r.sea_zone)
    mine = set(t for t in ('TY', 'WV') if lvl(z, t, w))
    stored = set(x for x in str(r.flags_type).split('|') if x in ('TY', 'WV'))
    n += 1; agree += mine == stored
    if mine != stored and len(dis) < 5: dis.append((r.eid, r.date, r.hm, r.sea_zone, mine, stored))
out.append(('선박: 폴리곤 안 사건의 시각 특보 딱지 일치', '%d / %d' % (agree, n)))
for d_ in dis: out.append(('  불일치 예', str(d_)))
# 해구 값 vs 특보: 해상특보구역별로 그 구역 사고들이 쓰는 대해구의 일 최대값 분포(층 행 기준, 중복 제거)
sr = pd.read_csv(R + '/ship_strata_rows_day.csv.gz')
sr['zone'] = se.sea_zone.values[sr.ev.values]; sr['mz'] = se.mzone.values[sr.ev.values]
u = sr.drop_duplicates(['mz', 'day'])[['mz', 'day', 'seaw', 'wh_max', 'ws_max']].dropna()
for lv, nm in ((0, '특보 없음'), (1, '주의보'), (2, '경보')):
    g = u[u.seaw == lv]
    out.append(('대해구-일(%s) n=%d: 파고 일최대 중앙값/90%%' % (nm, len(g)), '%.1f / %.1f m; 풍속 %.1f / %.1f m/s; 파고3m↑ 또는 풍속14↑ 비율 %.2f' % (
        g.wh_max.median(), g.wh_max.quantile(.9), g.ws_max.median(), g.ws_max.quantile(.9), ((g.wh_max >= 3) | (g.ws_max >= 14)).mean())))
for k, v in out: print(k, ':', v)
pd.DataFrame(out, columns=['check', 'value']).to_csv(R + '/checks.csv', index=False, encoding='utf-8-sig')
