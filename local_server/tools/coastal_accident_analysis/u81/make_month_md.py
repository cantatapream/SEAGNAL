"""month_relative.csv → 보고서용 표(month_relative.md). 숫자는 모두 csv 에서 읽는다(손으로 옮기지 않음).
사용: python3 -I make_month_md.py <out 폴더>
"""
import sys
import pandas as pd
OUT = sys.argv[1]
r = pd.read_csv(OUT + '/month_relative.csv')
CUR = [-.78, -.42, -.12, -.18, .16, .29, .46, .66, .56, .02, -.12, -.54]          # risk_points.js MONTHS(바꾸기 전) 점수
CUR_F = [.93, .79, 1.12, .62, 1.35, 1.09, 1.39, 1.66, 1.45, 1.02, .62, .61]       # 같은 표 사망·실종 배수
pct = lambda x: ('%+.0f%%' % (100 * (x - 1))).replace('-', '−')
M = r[r.model.str.startswith('M ')]
A, F = M[M.outcome == '전체 사고'].set_index('month'), M[M.outcome == '사망·실종 사고'].set_index('month')
L = []
L.append('| 월 | 새 점수 (95% 구간) | 새 배수 (95% 구간) · 백분율 | 지금 점수 | 차이 | 새 사망·실종 배수 (95% 구간) · 백분율 | 지금 사망·실종 배수 | 사고 수(전체 / 사망·실종) |')
L.append('|---|---|---|---|---|---|---|---|')
for m in range(1, 13):
    a, f = A.loc[m], F.loc[m]
    L.append('| %d월 | %.2f (%.2f ~ %.2f) | %.2f (%.2f–%.2f) · **%s** | %.2f | %+.2f | %.2f (%.2f–%.2f) · **%s** | %.2f | %d / %d |' % (
        m, round(a.score, 2), a.score_lo, a.score_hi, a.RR, a.lo, a.hi, pct(a.RR), CUR[m - 1], round(a.score, 2) - CUR[m - 1],
        f.RR, f.lo, f.hi, pct(f.RR), CUR_F[m - 1], a.n_month, f.n_month))
b = M.groupby('outcome').first()
L.append('')
L.append('모형에 든 사고: 전체 %d건 · 사망·실종 %d건. 같은 모형의 사람 항(오늘 ÷ 30일 기하평균, 2배당): 전체 %.2f (%.2f–%.2f) · 사망·실종 %.2f (%.2f–%.2f).' % (
    b.loc['전체 사고'].n_events, b.loc['사망·실종 사고'].n_events, b.loc['전체 사고'].crowd_rr2x, b.loc['전체 사고'].crowd_lo, b.loc['전체 사고'].crowd_hi,
    b.loc['사망·실종 사고'].crowd_rr2x, b.loc['사망·실종 사고'].crowd_lo, b.loc['사망·실종 사고'].crowd_hi))
L.append('')
L.append('민감도 — 전체 사고 점수(1년 평균 날 = 0):')
L.append('')
models = list(dict.fromkeys(r.model))
L.append('| 모형 | ' + ' | '.join('%d월' % m for m in range(1, 13)) + ' | 사고 수 |')
L.append('|---|' + '---|' * 13)
for oc in ('전체 사고', '사망·실종 사고'):
    for mo in models:
        x = r[(r.model == mo) & (r.outcome == oc)].set_index('month')
        L.append('| %s · %s | ' % (mo, '전체' if oc == '전체 사고' else '사망·실종') + ' | '.join('%+.2f' % x.loc[m].score for m in range(1, 13)) + ' | %d |' % x.iloc[0].n_events)
open(OUT + '/month_relative.md', 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
# risk_points.js MONTHS 에 넣을 값(점수·배수·사망배수, 소수 둘째 자리 — 지금 표와 같은 자릿수)
print('MONTHS', [[round(A.loc[m].score, 2), round(A.loc[m].RR, 2), round(F.loc[m].RR, 2)] for m in range(1, 13)])
