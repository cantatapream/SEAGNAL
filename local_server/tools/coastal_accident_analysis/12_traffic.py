"""충돌이 '교통량'과 관련되는지 — 공간 대리 확인.
과거 교통량 자료가 없어, 해양교통안전공단 해양교통 혼잡도 예보(4단계 격자, 2026-10-10 03시·12시 두 시각, 이전 세션 수집본)를
'평소 배가 많이 다니는 곳'의 공간 대리값으로 쓴다(시점이 사고 기간과 다르다 — 한계).
각 선박 사건에 반경 2km 안 가장 가까운 격자 중심의 혼잡지수(두 시각 평균, 없으면 0)를 붙여 유형별로 비교.
사용: python3 -I 12_traffic.py <scratch_root> <data_dir> <results_dir>
"""
import sys, json, math
import numpy as np, pandas as pd
SCR, D, R = sys.argv[1:4]
cells = {}
for fn in ('mtc4_1010_03.json', 'mtc4_1010_12.json'):
    for it in json.load(open(SCR + '/' + fn))['response']['body']['items']['item']:
        c = cells.setdefault(it['gridId'], [float(it['latitude']), float(it['longitude']), []])
        c[2].append(float(it['congestionIndex']))
ids = list(cells); lat = np.array([cells[i][0] for i in ids]); lon = np.array([cells[i][1] for i in ids])
val = np.array([sum(cells[i][2]) / 2.0 for i in ids])  # 한 시각에만 있으면 다른 시각은 0.1 미만(응답에서 빠짐)으로 보고 0 처리
se = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str})
ci = []
for la, lo in zip(se.lat, se.lon):
    d = np.hypot((lat - la) * 111.0, (lon - lo) * 111.0 * math.cos(math.radians(la)))
    j = int(np.argmin(d)); ci.append(val[j] if d[j] <= 2.0 else 0.0)
se['cong'] = ci
TYPES = ['전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌']
rows = []
for t in TYPES + ['전체']:
    g = se if t == '전체' else se[se.types.str.split('|').apply(lambda x: t in x)]
    rows.append(dict(type=t, n=len(g), median_cong=g.cong.median(), mean_cong=g.cong.mean(), share_ge1=(g.cong >= 1).mean(), share_ge10=(g.cong >= 10).mean(),
                     share_ge20=(g.cong >= 20).mean(), share_zero=(g.cong == 0).mean()))
res = pd.DataFrame(rows); res.to_csv(R + '/ship_traffic_proxy.csv', index=False, encoding='utf-8-sig')
pd.set_option('display.width', 200); print(res.round(3).to_string(index=False))
# 충돌 vs 기상민감 4종: 혼잡 상위(≥10) 비율 차이의 95% 신뢰구간(정규근사)
a = se[se.types.str.contains('충돌')]; b = se[se.types.str.contains('전복|침몰|침수|표류')]
p1, p2 = (a.cong >= 10).mean(), (b.cong >= 10).mean(); s = math.sqrt(p1 * (1 - p1) / len(a) + p2 * (1 - p2) / len(b))
print('혼잡지수 10 이상 칸 비율: 충돌 %.3f (n=%d) vs 기상민감4종 %.3f (n=%d), 차이 %.3f (95%% CI %.3f~%.3f)' % (p1, len(a), p2, len(b), p1 - p2, p1 - p2 - 1.96 * s, p1 - p2 + 1.96 * s))
# 시각 분포(시)
se['h'] = se.hm.str.split(':').str[0].astype(int)
tab = pd.crosstab(se.h, se.types.str.split('|').str[0], normalize='columns').round(3)
tab.to_csv(R + '/ship_hour_share.csv', encoding='utf-8-sig')
print(tab[['충돌', '전복', '표류', '침수']].T.to_string())
