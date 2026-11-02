"""보고서 보충표(마크다운) — 월별 배수의 신뢰구간 전체, 선박 2025 제외 비교, 모형별 사고 수.
사용: python3 -I 20_extra_tables.py <results_dir> > results/extra_tables.md
"""
import sys
import numpy as np, pandas as pd
R = sys.argv[1]
def ci(r): return '%.2f (%.2f–%.2f)' % (r.RR, r.lo, r.hi)
PM = pd.read_csv(R + '/person_month_models.csv'); SM = pd.read_csv(R + '/ship_month_models.csv'); SMx = pd.read_csv(R + '/ship_month_models_ex2025.csv')
for title, df, subs, mdl in (('인명(변사 제외) — 월별 배수 (같은 장소·같은 해 안, 1월 대비, 요일·공휴일 보정)', PM, ['전체', '익수', '추락', '고립', '표류', '사망·실종'], 'M1'),
                             ('인명(변사 제외) — 월별 배수, 외지인 방문자까지 보정', PM, ['전체', '익수', '추락', '고립', '표류', '사망·실종'], 'M2'),
                             ('선박 — 월별 배수 (같은 장소·같은 해 안, 1월 대비, 요일·공휴일 보정)', SM, ['전체', '전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌', '기상민감4종(전복·침몰·침수·표류)', '충돌·접촉'], 'SM')):
    print('\n#### %s\n' % title)
    print('| 월 | ' + ' | '.join(s.replace('(전복·침몰·침수·표류)', '') for s in subs) + ' |'); print('|---|' + '---|' * len(subs))
    print('| 1월 | ' + ' | '.join('1 (기준)' for _ in subs) + ' |')
    for m in range(2, 13):
        cells = []
        for s in subs:
            x = df[(df.model.str.startswith(mdl)) & (df.subset == s) & (df.term == 'm%02d' % m)]
            cells.append('—' if x.empty else ci(x.iloc[0]))
        print('| %d월 | ' % m + ' | '.join(cells) + ' |')
    x = df[(df.model.str.startswith(mdl))].drop_duplicates('subset').set_index('subset').n_events
    print('| (모형에 든 사고 수) | ' + ' | '.join(str(int(x.get(s, 0))) for s in subs) + ' |')
    if mdl == 'M2':
        y = df[(df.model.str.startswith('M2')) & (df.term == 'log2_outsider')].set_index('subset')
        print('| (외지인 2배당 배수) | ' + ' | '.join(ci(y.loc[s]) if s in y.index else '—' for s in subs) + ' |')
# 선박 2025 제외 비교
S = pd.read_csv(R + '/ship_models.csv'); Sx = pd.read_csv(R + '/ship_models_ex2025.csv')
print('\n#### 선박 — 2025년(해양안전심판원 단독 자료)을 뺐을 때 주요 배수 비교\n')
print('| 모형 | 사고 묶음 | 항 | 2020~2025 전체 | 2025 제외 | 차이 |'); print('|---|---|---|---|---|---|')
KEYS = [('S시각_A3b', 'warn_주의보'), ('S시각_A3b', 'warn_경보'), ('S일_A3b', 'warn_주의보'), ('S일_A3b', 'warn_경보'),
        ('S시각_C6', 'nw_ws_12-14'), ('S시각_C5', 'nw_wh_1.5-2.0')]
for subset in ['전체', '전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌', '기상민감4종(전복·침몰·침수·표류)', '충돌·접촉']:
    for mdl, term in KEYS:
        a = S[(S.model.str.startswith(mdl)) & (S.subset == subset) & (S.term == term)]
        b = Sx[(Sx.model.str.startswith(mdl)) & (Sx.subset == subset) & (Sx.term == term)]
        if a.empty or b.empty: continue
        a, b = a.iloc[0], b.iloc[0]
        if a.cases_with < 5 or b.cases_with < 5: continue
        print('| %s | %s | %s | %s [%d] | %s [%d] | %+.2f |' % (mdl, subset, term, ci(a), a.cases_with, ci(b), b.cases_with, b.RR - a.RR))
