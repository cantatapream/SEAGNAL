"""계절별 결과표(마크다운) — 18_season.py 결과 CSV 에서 바로 찍는다(손으로 옮기지 않음).
표 하나 = 모형 하나. 행 = (사고 묶음, 항), 열 = 봄·여름·가을·겨울·전체.
칸 = 배수(95% 신뢰구간) [그 조건에 해당한 사고 수]. 해당 사고 5건 미만은 '추정 보류', 신뢰구간 상·하한 비 50배 초과는 '추정 불안정'.
사용: python3 -I 19_season_tables.py <results_dir> > results/season_tables.md
"""
import sys
import numpy as np, pandas as pd
R = sys.argv[1]
COLS = ['봄', '여름', '가을', '겨울', '전체(계절 구분 없음)']
TERM_KO = {
    'weekend_or_hol': '주말·공휴일', 'dow1': '화', 'dow2': '수', 'dow3': '목', 'dow4': '금', 'dow5': '토', 'dow6': '일', 'hol': '공휴일',
    'any_warn': '특보 있음', 'warn_주의보': '최고 수준 주의보', 'warn_경보': '최고 수준 경보', 'wv_any': '풍랑특보', 'ty_any': '태풍특보', 'gw_any': '강풍특보',
    'log2_outsider': '외지인 방문자 2배당', 'wh_per1m': '파고 1m 높을 때마다', 'ws_per1ms': '풍속 1m/s 셀 때마다',
    'cell_lowV_warn': '방문자 보통·특보 있음', 'cell_hiV_nowarn': '방문자 많음·특보 없음', 'cell_hiV_warn': '방문자 많음·특보 있음',
    'hiV': '방문자 많음(같은달 평균 1.2배↑)', 'hiV_x_warn': '상호작용(곱셈에서 벗어난 정도)',
}
def ko(t):
    if t in TERM_KO: return TERM_KO[t]
    for p, n in (('rel[', '외지인 같은달평균 대비 '), ('wh_max[', '파고 '), ('ws_max[', '풍속 '), ('aws_ws[', '해안 AWS 풍속 '), ('wh[', '파고 '), ('ws[', '풍속 ')):
        if t.startswith(p): return n + t[len(p):-1] + ('배' if p == 'rel[' else ('m' if 'wh' in p else 'm/s'))
    return t
def cell(r):
    if r is None: return '—'
    if pd.isna(r.get('RR', np.nan)): return '적합 안 함(사고 5건 미만)'
    cw = r.get('cases_with', np.nan)
    if not pd.isna(cw) and cw < 5: return '추정 보류(%d건)' % cw
    # 층 안에서 조건이 거의 안 바뀌어(분리) 값이 터진 경우: 신뢰구간 상·하한 비가 50배를 넘으면 숫자를 쓰지 않는다.
    if not (r.lo > 0) or not np.isfinite(r.hi) or r.hi / r.lo > 50:
        return '추정 불안정(%s건, 구간 과대)' % ('?' if pd.isna(cw) else int(cw))
    s = '%.2f (%.2f–%.2f)' % (r.RR, r.lo, r.hi)
    if not pd.isna(cw): s += ' [%d]' % cw
    return s
for grp, fn in (('인명(변사 제외)', 'season_person_models.csv'), ('선박', 'season_ship_models.csv')):
    df = pd.read_csv(R + '/' + fn)
    print('\n### %s — 계절별 결과\n' % grp)
    for model in df.model.drop_duplicates():
        m = df[df.model == model]
        print('\n#### %s · %s\n' % (grp, model))
        # 계절별 사고 수(모형에 들어간 사고)
        ne = m.drop_duplicates(['season', 'subset']).set_index(['subset', 'season']).n_events
        print('| 사고 묶음 | 항 | ' + ' | '.join(c.replace('(계절 구분 없음)', '') for c in COLS) + ' |')
        print('|---|---|' + '---|' * len(COLS))
        for sub in m.subset.drop_duplicates():
            ms = m[m.subset == sub]
            print('| %s | (모형에 든 사고 수) | ' % sub + ' | '.join(str(int(ne.get((sub, c), 0))) if (sub, c) in ne.index else '—' for c in COLS) + ' |')
            terms = [t for t in ms.term.drop_duplicates() if not str(t).startswith('(') and t not in ('dow1', 'dow2', 'dow3', 'dow4', 'dow5', 'dow6', 'hol') or model.startswith(('P2', 'S일2'))]
            for t in terms:
                if str(t).startswith('('): continue
                row = []
                for c in COLS:
                    x = ms[(ms.season == c) & (ms.term == t)]
                    if x.empty:
                        y = ms[(ms.season == c)]
                        row.append('적합 안 함(사고 5건 미만)' if (not y.empty and y.term.astype(str).str.startswith('(').any()) else '—')
                    else:
                        row.append(cell(x.iloc[0]))
                print('| %s | %s | ' % (sub, ko(t)) + ' | '.join(row) + ' |')
print('\n### 계절별 조건 빈도(사고 안 난 비교일, 구역-일 중복 제거)\n')
P = pd.read_csv(R + '/season_condition_prevalence.csv')
print('| 묶음 | 계절 | 구역-일 수 | 특보일 비율 | 경보일 비율 | 풍랑 | 태풍 | 강풍 | 파고 일최대 중앙값 / 90% | 풍속 일최대 중앙값 / 90% |')
print('|---|---|---|---|---|---|---|---|---|---|')
for _, r in P.iterrows():
    g = '—' if pd.isna(r.share_gw) else '%.1f%%' % (100 * r.share_gw)
    print('| %s | %s | %d | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %s | %.1f / %.1f m | %.1f / %.1f m/s |' % (
        r.group, r.season, r.zone_days, 100 * r.share_any_warn, 100 * r.share_경보, 100 * r.share_wv, 100 * r.share_ty, g, r.wh_median, r.wh_p90, r.ws_median, r.ws_p90))
