"""v3 추가 검정(독립검증 A·B·C 지적 반영) — 결과를 마크다운 표로 찍는다.
 ① 계절 간 차이를 한 모형에서 직접 검정: 계절별 특보항 + 계절별 요일·공휴일 → Wald 대비(인명 특보 유무 / 선박 기상민감 4종 시각 맞춤 주의보·경보)
 ② 겨울 특보일 안 '파고 2m 이상'·'풍속 10m/s 이상' 이분 비교 + 겨울 대 다른 계절 대비
 ③ 다중비교: 계절별 표 전체 칸에 Benjamini–Hochberg q 값 → 본문이 인용한 칸이 살아남는지
 ④ 선박 2023년 충돌(한 척짜리 기록 급증) 민감도: 2023년 사건을 빼고 충돌·충돌접촉 특보 배수
군집 = 사고 날짜(v3). 사용: python3 -I 23_checks.py <data_dir> <results_dir> > results/checks_v3.md
"""
import sys, os
from math import erf, sqrt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccr
D, R = sys.argv[1:3]
SEASON = {3: '봄', 4: '봄', 5: '봄', 6: '여름', 7: '여름', 8: '여름', 9: '가을', 10: '가을', 11: '가을', 12: '겨울', 1: '겨울', 2: '겨울'}
SS = ['봄', '여름', '가을', '겨울']
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
pval = lambda z: 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

def seasonal_fit(df, term_cols):
    """계절별 항(term_cols 각각 × 계절) + 계절별 달력으로 한 모형 적합. 반환: (결과, 이름→인덱스)."""
    X = df.copy(); cols = []
    for t in term_cols:
        for s in SS:
            X['%s@%s' % (t, s)] = X[t] * (X.season == s); cols.append('%s@%s' % (t, s))
    for c in CAL:
        for s in SS:
            X['%s@%s' % (c, s)] = X[c] * (X.season == s); cols.append('%s@%s' % (c, s))
    r = ccr.fit(X.ev.values, X.case.values, X[cols].values.astype(float), cluster=X.cl.values, names=cols)
    return r, {n: i for i, n in enumerate(r['names'])}

def contrast(r, idx, weights):
    c = np.zeros(len(r['b']))
    for n, w in weights.items(): c[idx[n]] = w
    est = c @ r['b']; se = np.sqrt(c @ r['V'] @ c); z = est / se
    return np.exp(est), np.exp(est - 1.96 * se), np.exp(est + 1.96 * se), z, pval(z)

def wald_equal(r, idx, names):
    """names 의 계수가 모두 같은가(자유도 k-1) — 카이제곱."""
    k = len(names); C = np.zeros((k - 1, len(r['b'])))
    for i in range(k - 1): C[i, idx[names[i]]] = 1; C[i, idx[names[-1]]] = -1
    d = C @ r['b']; S = C @ r['V'] @ C.T; chi = float(d @ np.linalg.solve(S, d))
    from scipy.stats import chi2
    return chi, k - 1, float(chi2.sf(chi, k - 1))

pe = pd.read_csv(D + '/geo_person.csv', dtype={'date': str}); pe = pe[pe.sea_zone.notna()].reset_index(drop=True)
pr = pd.read_csv(R + '/person_strata_rows.csv.gz')
pr['season'] = pe.date.str[4:6].astype(int).map(SEASON).values[pr.ev.values]
pr['any_warn'] = (pr.anyw >= 1).astype(float)
print('#### 계절 간 차이 검정 — 인명(변사 제외) 특보 유무\n')
print('계절별 특보항·계절별 요일·공휴일을 한 모형에 넣고(군집 = 사고 날짜) 계절끼리의 차이를 직접 검정했다. "배수의 비" = 앞 계절 배수 ÷ 뒤 계절 배수.\n')
r, idx = seasonal_fit(pr, ['any_warn'])
print('| 항 | 배수 (95% 신뢰구간) |'); print('|---|---|')
for s in SS:
    i = idx['any_warn@' + s]; b, se = r['b'][i], np.sqrt(r['V'][i, i])
    print('| %s 특보 있음 | %.2f (%.2f–%.2f) |' % (s, np.exp(b), np.exp(b - 1.96 * se), np.exp(b + 1.96 * se)))
chi, df_, p = wald_equal(r, idx, ['any_warn@' + s for s in SS])
print('\n| 검정 | 배수의 비 (95% 신뢰구간) | p |'); print('|---|---|---|')
print('| 네 계절 모두 같은가(카이제곱 %.2f, 자유도 %d) | — | %.3f |' % (chi, df_, p))
for lab, w in (('여름 ÷ (봄·가을 평균)', {'any_warn@여름': 1, 'any_warn@봄': -.5, 'any_warn@가을': -.5}),
               ('여름 ÷ 봄', {'any_warn@여름': 1, 'any_warn@봄': -1}), ('여름 ÷ 가을', {'any_warn@여름': 1, 'any_warn@가을': -1}),
               ('여름 ÷ 겨울', {'any_warn@여름': 1, 'any_warn@겨울': -1}),
               ('여름 ÷ (나머지 세 계절 평균)', {'any_warn@여름': 1, 'any_warn@봄': -1 / 3, 'any_warn@가을': -1 / 3, 'any_warn@겨울': -1 / 3})):
    e, lo, hi, z, p = contrast(r, idx, w); print('| %s | %.2f (%.2f–%.2f) | %.3f |' % (lab, e, lo, hi, p))

# ② 겨울 특보일 안 이분 비교
print('\n#### 특보 있는 날 안에서 파고 2m 이상·풍속 10m/s 이상 — 계절별(인명, 변사 제외)\n')
print('특보일만 남기고(특보 없는 날은 층에서 뺌) 그 안에서 "파고 2m 이상인 날"(또는 "풍속 10m/s 이상인 날")을 나머지 특보일과 비교했다. 구간을 여럿으로 나누지 않은 이분 비교다.\n')
ww = pr[pr.anyw >= 1].copy()
for col, thr, lab in (('wh_max', 2.0, '파고 2m 이상'), ('ws_max', 10.0, '풍속 10m/s 이상')):
    q = ww.dropna(subset=[col]).copy(); q['hi'] = (q[col] >= thr).astype(float)
    r, idx = seasonal_fit(q, ['hi'])
    print('| %s | 배수 (95%% 신뢰구간) | 해당 사고 |' % lab); print('|---|---|---|')
    for s in SS:
        i = idx['hi@' + s]; b, se = r['b'][i], np.sqrt(r['V'][i, i])
        n_on = int(((q.case == 1) & (q.hi == 1) & (q.season == s)).sum())
        print('| %s | %.2f (%.2f–%.2f) | %d |' % (s, np.exp(b), np.exp(b - 1.96 * se), np.exp(b + 1.96 * se), n_on))
    e, lo, hi, z, p = contrast(r, idx, {'hi@겨울': 1, 'hi@봄': -1 / 3, 'hi@여름': -1 / 3, 'hi@가을': -1 / 3})
    print('| 겨울 ÷ (나머지 세 계절 평균) — 배수의 비 | %.2f (%.2f–%.2f), p=%.4f | |\n' % (e, lo, hi, p))

# 선박 기상민감 4종 시각 맞춤
sg = pd.read_csv(D + '/geo_ship.csv', dtype={'date': str}); sg = sg[sg.sea_zone.notna()].reset_index(drop=True)
sens = sg.types.str.contains('전복|침몰|침수|표류').values
st = pd.read_csv(R + '/ship_strata_rows_time.csv.gz')
st['season'] = sg.date.str[4:6].astype(int).map(SEASON).values[st.ev.values]
st['w1'] = (st.seaw == 1).astype(float); st['w2'] = (st.seaw == 2).astype(float)
s4 = st[sens[st.ev.values]]
print('#### 계절 간 차이 검정 — 선박 기상민감 4종(사고 시각 맞춤)\n')
r, idx = seasonal_fit(s4, ['w1', 'w2'])
print('| 항 | 봄 | 여름 | 가을 | 겨울 | 네 계절 같은가 p |'); print('|---|---|---|---|---|---|')
for t, lab in (('w1', '주의보'), ('w2', '경보')):
    cells = []
    for s in SS:
        i = idx['%s@%s' % (t, s)]; b, se = r['b'][i], np.sqrt(r['V'][i, i])
        cells.append('%.2f (%.2f–%.2f)' % (np.exp(b), np.exp(b - 1.96 * se), np.exp(b + 1.96 * se)) if np.exp(b + 1.96 * se) / np.exp(b - 1.96 * se) <= 50 else '추정 불안정')
    chi, df_, p = wald_equal(r, idx, ['%s@%s' % (t, s) for s in SS])
    print('| %s | %s | %.3f |' % (lab, ' | '.join(cells), p))

# ③ 다중비교(BH)
print('\n#### 다중비교 보정 — 계절별 표 전체 칸의 Benjamini–Hochberg q 값\n')
def bh(p):
    p = np.asarray(p); n = len(p); o = np.argsort(p); q = np.empty(n)
    q[o] = np.minimum.accumulate((p[o] * n / np.arange(1, n + 1))[::-1])[::-1]
    return np.minimum(q, 1)
for grp, fn in (('인명', 'season_person_models.csv'), ('선박', 'season_ship_models.csv')):
    m = pd.read_csv(R + '/' + fn)
    m = m[m.RR.notna() & ~m.term.isin(CAL) & ~m.term.astype(str).str.startswith('(')]
    m = m[(m.cases_with.isna() | (m.cases_with >= 5)) & (m.hi / m.lo <= 50) & ~m.season.str.startswith('전체')]
    m = m[m.p.notna() & np.isfinite(m.p)]   # p 가 없는 칸(표준오차 0 등)은 보정에서 뺀다 — 하나라도 섞이면 BH 가 전부 비게 된다
    m = m.copy(); m['q'] = bh(m.p.values)
    m.to_csv(R + '/season_%s_bh.csv' % ('person' if grp == '인명' else 'ship'), index=False, encoding='utf-8-sig')
    print('- %s: 보고 가능한 칸 %d개 · p<0.05 %d개(우연히 기대되는 수 약 %.0f개) · BH q<0.05 %d개' % (grp, len(m), (m.p < 0.05).sum(), 0.05 * len(m), (m.q < 0.05).sum()))
P = pd.read_csv(R + '/season_person_bh.csv'); S = pd.read_csv(R + '/season_ship_bh.csv')
print('\n| 본문이 인용한 칸 | 배수 | p | BH q |'); print('|---|---|---|---|')
def show(df, season, model, subset, term, lab):
    x = df[(df.season == season) & (df.model.str.startswith(model)) & (df.subset == subset) & (df.term == term)]
    if x.empty: print('| %s | (보고 가능 칸 아님) | | |' % lab); return
    x = x.iloc[0]; print('| %s | %.2f (%.2f–%.2f) | %.4f | %.4f |' % (lab, x.RR, x.lo, x.hi, x.p, x.q))
for s in SS: show(P, s, 'P3_', '전체', 'any_warn', '인명 %s 특보 있음' % s)
show(P, '겨울', 'P16_', '전체', 'wh_max[2-3]', '인명 겨울 특보일 안 파고 2~3m')
show(P, '겨울', 'P17_', '전체', 'ws_max[10-14]', '인명 겨울 특보일 안 풍속 10~14m/s')
show(P, '겨울', 'P17_', '전체', 'ws_max[14+]', '인명 겨울 특보일 안 풍속 14m/s 이상')
show(P, '여름', 'P8_', '전체', 'any_warn', '인명 여름 특보(방문자 보정)')
for s in SS: show(S, s, 'S시각4_', '기상민감4종(전복·침몰·침수·표류)', 'warn_경보', '선박 기상민감 4종 %s 경보' % s)
show(S, '여름', 'S시각8_', '기상민감4종(전복·침몰·침수·표류)', 'ws[14+]', '선박 기상민감 4종 여름 특보 중 풍속 14m/s 이상')
show(S, '가을', 'S시각8_', '기상민감4종(전복·침몰·침수·표류)', 'ws[14+]', '선박 기상민감 4종 가을 특보 중 풍속 14m/s 이상')
show(S, '겨울', 'S시각6_', '기상민감4종(전복·침몰·침수·표류)', 'ws[12+]', '선박 기상민감 4종 겨울 특보 없을 때 풍속 12m/s 이상')

# ④ 2023 충돌 민감도
print('\n#### 선박 2023년 충돌 민감도 — 2023년 사건을 뺐을 때(사고 시각 맞춤, 요일·공휴일 보정)\n')
yr = sg.date.str[:4].values
print('| 사고 묶음 | 항 | 전체 | 2023 제외 |'); print('|---|---|---|---|')
for lab, pat in (('충돌', '충돌'), ('충돌·접촉', '충돌|접촉')):
    msk = sg.types.str.contains(pat).values
    for nm, keep in (('전체', msk), ('2023 제외', msk & (yr != '2023'))):
        q = st[keep[st.ev.values]]
        r = ccr.fit(q.ev.values, q.case.values, q[['w1', 'w2'] + CAL].values.astype(float), cluster=q.cl.values, names=['w1', 'w2'] + CAL)
        t = {x['term']: x for x in ccr.table(r)}
        if nm == '전체': base = t
    for term, tl in (('w1', '주의보'), ('w2', '경보')):
        a, b = base[term], t[term]
        print('| %s | %s | %.2f (%.2f–%.2f) | %.2f (%.2f–%.2f) |' % (lab, tl, a['RR'], a['lo'], a['hi'], b['RR'], b['lo'], b['hi']))
c = sg[sg.types.str.contains('충돌')]
print('\n충돌 사건 중 한 척짜리 기록(n_rows=1): ' + ' · '.join('%s년 %d/%d' % (y, (g.n_rows == 1).sum(), len(g)) for y, g in c.groupby(c.date.str[:4])))

# ⑤ 계절별 '특보 없는 날 대비' 칸(점수용 — 점수는 '평소(특보 없는 날)' 대비여야 한다)
print('\n#### 특보 없는 날 대비 — 특보일을 파고 2m·풍속 10m/s 로 나눈 칸(인명, 변사 제외, 계절별)\n')
print('기준 = 같은 장소·같은 달의 특보 없는 날. 점수(A안)는 이 표의 값을 쓴다(특보일끼리 비교한 위 표가 아니라).\n')
for col, thr, lab in (('wh_max', 2.0, '파고 2m'), ('ws_max', 10.0, '풍속 10m/s')):
    q = pr.dropna(subset=[col]).copy()
    q['warn_hi'] = ((q.anyw >= 1) & (q[col] >= thr)).astype(float); q['warn_lo'] = ((q.anyw >= 1) & (q[col] < thr)).astype(float)
    r, idx = seasonal_fit(q, ['warn_hi', 'warn_lo'])
    print('| 계절 | 특보 & %s 이상 | 특보 & %s 미만 |' % (lab, lab)); print('|---|---|---|')
    for s in SS:
        cells = []
        for t in ('warn_hi', 'warn_lo'):
            i = idx['%s@%s' % (t, s)]; b, se = r['b'][i], np.sqrt(r['V'][i, i])
            n_on = int(((q.case == 1) & (q[t] == 1) & (q.season == s)).sum())
            cells.append('%.2f (%.2f–%.2f) [%d]' % (np.exp(b), np.exp(b - 1.96 * se), np.exp(b + 1.96 * se), n_on))
        print('| %s | %s |' % (s, ' | '.join(cells)))
    print()

# ⑥ 선박 기상민감 4종: 특보를 파고·풍속으로 나눈 칸 — 특보 없는 때 대비(점수용)
print('#### 특보 없는 때 대비 — 선박 기상민감 4종, 특보를 파고·풍속으로 나눈 칸(사고 시각 맞춤)\n')
print('기준 = 같은 장소·같은 달의 같은 시각, 특보 없는 때. 계절 구분 없음.\n')
for col, cuts, lab in (('wh', [2, 4], '파고'), ('ws', [14, 17], '풍속')):
    q = s4.dropna(subset=[col]).copy(); w = q.seaw >= 1
    names = ['%s<%g' % (lab, cuts[0]), '%s %g~%g' % (lab, cuts[0], cuts[1]), '%s %g 이상' % (lab, cuts[1])]
    q['c0'] = (w & (q[col] < cuts[0])).astype(float); q['c1'] = (w & (q[col] >= cuts[0]) & (q[col] < cuts[1])).astype(float); q['c2'] = (w & (q[col] >= cuts[1])).astype(float)
    r = ccr.fit(q.ev.values, q.case.values, q[['c0', 'c1', 'c2'] + CAL].values.astype(float), cluster=q.cl.values, names=['c0', 'c1', 'c2'] + CAL)
    t = {x['term']: x for x in ccr.table(r)}
    print('| 특보 & %s | 배수 (95%% 신뢰구간) | 해당 사고 |' % lab); print('|---|---|---|')
    for c, nm in zip(('c0', 'c1', 'c2'), names):
        print('| %s | %.2f (%.2f–%.2f) | %d |' % (nm, t[c]['RR'], t[c]['lo'], t[c]['hi'], int(((q.case == 1) & (q[c] == 1)).sum())))
    print()
