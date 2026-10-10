"""보고서용 표(마크다운) 생성 — 숫자를 손으로 옮기지 않기 위해 결과 CSV 에서 바로 만든다.
사용: python3 -I 16_tables.py <results_dir> > results/tables.md
"""
import sys
import numpy as np, pandas as pd
R = sys.argv[1]
P = pd.read_csv(R + '/person_models.csv'); PM = pd.read_csv(R + '/person_month_models.csv')
S = pd.read_csv(R + '/ship_models.csv'); SM = pd.read_csv(R + '/ship_month_models.csv')
def f(r, mincase=5):
    if r is None or (isinstance(r, float) and np.isnan(r)): return '—'
    cw = r.get('cases_with', np.nan)
    if not np.isnan(cw) and cw < mincase:
        return '(사례 %d — 추정 보류)' % cw
    if not (r['lo'] > 0) or not np.isfinite(r['hi']) or r['hi'] / r['lo'] > 50:   # v2: 분리로 값이 터진 칸
        return '(사례 %s — 추정 불안정, 구간 과대)' % ('?' if np.isnan(cw) else int(cw))
    s = '%.2f (%.2f–%.2f)' % (r['RR'], r['lo'], r['hi'])
    if not np.isnan(cw): s += ' [%d]' % cw
    if r['hi'] / r['lo'] > 20: s += ' ‡'   # v3: 구간 상·하한 비 20~50배 — 근거로 쓰지 않음
    return s
def get(df, model, subset, term):
    x = df[(df.model.str.startswith(model)) & (df.subset == subset) & (df.term == term)]
    return None if x.empty else x.iloc[0]
def table(df, rows, cols, title, note=''):
    print('\n#### ' + title + '\n')
    if note: print(note + '\n')
    print('| 조건 | ' + ' | '.join(c[0] for c in cols) + ' |')
    print('|---|' + '---|' * len(cols))
    for lab, model, term in rows:
        print('| ' + lab + ' | ' + ' | '.join(f(get(df, model if m is None else m, sub, term)) for _, sub, m in cols) + ' |')
PT = [('전체', '전체', None), ('익수', '익수', None), ('추락', '추락', None), ('고립', '고립', None), ('표류', '표류', None), ('사망·실종 사고', '사망·실종', None)]
table(P, [('주말·공휴일 (평일 대비)', 'A1b', 'weekend_or_hol'), ('토요일 (월요일 대비)', 'A1_', 'dow5'), ('일요일 (월요일 대비)', 'A1_', 'dow6'), ('공휴일', 'A1_', 'hol')],
      PT, '인명 — 달력(요일·공휴일)', '값 = 같은 장소·같은 달 안에서의 하루당 사고 배수(RR, 95% 신뢰구간) [조건 해당 사고 수].')
table(P, [('외지인 방문자 2배 (달력 보정)', 'D2_', 'log2_outsider'), ('전체 방문자 2배 (달력 보정)', 'D3_', 'log2_total'),
          ('외지인 같은달 평균 0.8배 미만', 'D4b', 'rel[<0.8]'), ('외지인 1.0~1.2배', 'D4b', 'rel[1-1.2]'), ('외지인 1.2~1.5배', 'D4b', 'rel[1.2-1.5]'), ('외지인 1.5배 이상', 'D4b', 'rel[1.5+]')],
      PT, '인명 — 시군구 방문자(DataLab)', '기준: 같은 시군구·같은 달 평균의 0.8~1.0배.')
table(P, [('외지인 방문자 2배당', 'D2_', 'log2_outsider'), ('토요일 (월요일 대비)', 'D2_', 'dow5'), ('일요일 (월요일 대비)', 'D2_', 'dow6'), ('공휴일', 'D2_', 'hol'),
          ('화', 'D2_', 'dow1'), ('수', 'D2_', 'dow2'), ('목', 'D2_', 'dow3'), ('금', 'D2_', 'dow4')],
      PT, '인명 — 요일·공휴일 효과를 외지인 방문자와 함께 넣었을 때', '같은 모형(외지인 방문자 + 요일·공휴일)의 요일 항. 방문자 수가 같을 때 남는 요일 효과다.')
table(P, [('특보 있음(풍랑·태풍·강풍 중 하나)', 'A2_', 'any_warn'), ('최고 수준 주의보', 'A3b', 'warn_주의보'), ('최고 수준 경보', 'A3b', 'warn_경보'),
          ('풍랑주의보', 'A3_', 'wv_주의보'), ('풍랑경보', 'A3_', 'wv_경보'), ('태풍주의보', 'A3_', 'ty_주의보'), ('태풍경보', 'A3_', 'ty_경보'), ('강풍주의보', 'A3_', 'gw_주의보'), ('강풍경보', 'A3_', 'gw_경보'),
          ('특보 낮(06~18시) 발효 6시간 미만', 'A3c', 'dh_0_<6h'), ('특보 낮 발효 6시간 이상', 'A3c', 'dh_6h+')],
      PT, '인명 — 특보 (달력 보정)', '기준: 그 장소에 특보가 없는 날.')
table(P, [('파고 0~0.5m', 'B1_', 'wh_max[0-0.5]'), ('파고 1.0~1.5m', 'B1_', 'wh_max[1-1.5]'), ('파고 1.5~2.0m', 'B1_', 'wh_max[1.5-2]'), ('파고 2.0m 이상', 'B1_', 'wh_max[2+]'),
          ('풍속 0~4m/s', 'B2_', 'ws_max[0-4]'), ('풍속 6~8', 'B2_', 'ws_max[6-8]'), ('풍속 8~10', 'B2_', 'ws_max[8-10]'), ('풍속 10~12', 'B2_', 'ws_max[10-12]'), ('풍속 12 이상', 'B2_', 'ws_max[12+]'),
          ('해안 AWS 풍속 0~3', 'B6', 'aws_ws[0-3]'), ('AWS 5~7', 'B6', 'aws_ws[5-7]'), ('AWS 7~9', 'B6', 'aws_ws[7-9]'), ('AWS 9~11', 'B6', 'aws_ws[9-11]'), ('AWS 11 이상', 'B6', 'aws_ws[11+]')],
      PT, '인명 — 특보 없는 날만: 해구 일 최대 파고·풍속, 해안 AWS 일 최대 풍속',
      '기준: 파고 0.5~1.0m / 해구 풍속 4~6m/s / AWS 3~5m/s. 파고와 풍속은 각각 따로 넣은 모형(B1·B2·B6).')
table(P, [('특보일 중 파고 2~3m (2m 미만 대비)', 'C1', 'wh_max[2-3]'), ('특보일 중 파고 3~4m', 'C1', 'wh_max[3-4]'), ('특보일 중 파고 4m 이상', 'C1', 'wh_max[4+]'),
          ('특보일 중 풍속 10~14 (10 미만 대비)', 'C2', 'ws_max[10-14]'), ('특보일 중 풍속 14~17', 'C2', 'ws_max[14-17]'), ('특보일 중 풍속 17 이상', 'C2', 'ws_max[17+]')],
      PT[:1], '인명 — 특보 있는 날 안에서 파고·풍속의 추가 효과')
table(P, [('외지인 방문자 2배 + 특보 동시 — 특보', 'D5', 'any_warn'), ('— 방문자 2배', 'D5', 'log2_outsider'),
          ('4칸: 방문자 보통·특보 있음', 'D8', 'cell_lowV_warn'), ('4칸: 방문자 많음(1.2배↑)·특보 없음', 'D8', 'cell_hiV_nowarn'), ('4칸: 방문자 많음·특보 있음', 'D8', 'cell_hiV_warn'),
          ('상호작용항(곱셈 모형에서 벗어남)', 'D7', 'hiV_x_warn')], PT[:1], '인명 — 방문자와 특보의 결합(위험×노출)', '기준(4칸): 방문자 보통(같은달 평균 1.2배 미만)·특보 없음.')
# 월
print('\n#### 인명 — 월 (같은 장소·같은 해 안, 1월 대비, 요일·공휴일 보정)\n')
print('| 유형 | ' + ' | '.join('%d월' % m for m in range(2, 13)) + ' |'); print('|---|' + '---|' * 11)
for sub in ['전체', '익수', '추락', '고립', '표류', '사망·실종']:
    x = PM[(PM.model.str.startswith('M1')) & (PM.subset == sub)].set_index('term')
    print('| ' + sub + ' | ' + ' | '.join('%.2f' % x.loc['m%02d' % m, 'RR'] for m in range(2, 13)) + ' |')
x = PM[(PM.model.str.startswith('M2')) & (PM.subset == '전체')].set_index('term')
print('| 전체(외지인 방문자 보정) | ' + ' | '.join('%.2f' % x.loc['m%02d' % m, 'RR'] for m in range(2, 13)) + ' |')
ST = [('전체', '전체', None), ('전복', '전복', None), ('침수', '침수', None), ('침몰', '침몰', None), ('좌초좌주', '좌초좌주', None), ('표류', '표류', None), ('접촉', '접촉', None), ('충돌', '충돌', None),
      ('기상민감4종', '기상민감4종(전복·침몰·침수·표류)', None)]
for tag, nm in (('S일', '일 단위(그 날 하루 중 일부라도 발효)'), ('S시각', '시각 맞춤(사고 시각에 발효 중)')):
    table(S, [('특보 있음(풍랑·태풍)', tag + '_A2', 'any_warn'), ('최고 수준 주의보', tag + '_A3b', 'warn_주의보'), ('최고 수준 경보', tag + '_A3b', 'warn_경보'),
              ('풍랑주의보', tag + '_A3_', 'wv_주의보'), ('풍랑경보', tag + '_A3_', 'wv_경보'), ('태풍경보', tag + '_A3_', 'ty_경보')], ST, '선박 — 특보 · ' + nm)
for tag, nm, wc, sc in (('S일', '일 최대', 'wh_max', 'ws_max'), ('S시각', '사고 시각 3시간 값', 'wh', 'ws')):
    table(S, [('파고 0~0.5m', tag + '_B1', wc + '[0-0.5]'), ('파고 1.0~1.5', tag + '_B1', wc + '[1-1.5]'), ('파고 1.5~2.0', tag + '_B1', wc + '[1.5-2]'), ('파고 2.0~2.5', tag + '_B1', wc + '[2-2.5]'),
              ('풍속 0~4', tag + '_B2', sc + '[0-4]'), ('풍속 6~8', tag + '_B2', sc + '[6-8]'), ('풍속 8~10', tag + '_B2', sc + '[8-10]'), ('풍속 10~12', tag + '_B2', sc + '[10-12]'),
              ('풍속 12~14', tag + '_B2', sc + '[12-14]'), ('풍속 14~17', tag + '_B2', sc + '[14-17]')],
          ST, '선박 — 특보 없을 때만: 해구 파고·풍속 (' + nm + ')', '기준: 파고 0.5~1.0m / 풍속 4~6m/s. 파고·풍속 각각 따로 넣은 모형.')
    table(S, [('특보 중 파고 2~3m (2m 미만 대비)', tag + '_C1', wc + '[2-3]'), ('특보 중 파고 3~4m', tag + '_C1', wc + '[3-4]'), ('특보 중 파고 4m 이상', tag + '_C1', wc + '[4+]'),
              ('특보 중 풍속 10~14 (10 미만 대비)', tag + '_C2', sc + '[10-14]'), ('특보 중 풍속 14~17', tag + '_C2', sc + '[14-17]'), ('특보 중 풍속 17 이상', tag + '_C2', sc + '[17+]')],
          ST, '선박 — 특보 있을 때 안에서 파고·풍속 추가 효과 (' + nm + ')')
    table(S, [('특보 없음·파고 1.0~1.5', tag + '_C5', 'nw_wh_1.0-1.5'), ('특보 없음·파고 1.5~2.0', tag + '_C5', 'nw_wh_1.5-2.0'), ('특보 없음·파고 2.0~2.5', tag + '_C5', 'nw_wh_2.0-2.5'),
              ('특보 없음·파고 2.5 이상', tag + '_C5', 'nw_wh_2.5-99'), ('주의보', tag + '_C5', 'w_주의보'), ('경보', tag + '_C5', 'w_경보'),
              ('특보 없음·풍속 8~10', tag + '_C6', 'nw_ws_8-10'), ('특보 없음·풍속 10~12', tag + '_C6', 'nw_ws_10-12'), ('특보 없음·풍속 12~14', tag + '_C6', 'nw_ws_12-14'), ('특보 없음·풍속 14 이상', tag + '_C6', 'nw_ws_14-99')],
          [('전체', '전체', None), ('기상민감4종', '기상민감4종(전복·침몰·침수·표류)', None), ('충돌·접촉', '충돌·접촉', None)],
          '선박 — 하나의 바다·날씨 축으로 묶은 모형 (' + nm + ')', '파고 모형 기준: 특보 없음·파고 1m 미만 / 풍속 모형 기준: 특보 없음·풍속 8m/s 미만.')
table(S, [('토요일(월 대비)', 'S일_A1', 'dow5'), ('일요일', 'S일_A1', 'dow6'), ('공휴일', 'S일_A1', 'hol')], ST, '선박 — 요일·공휴일')
print('\n#### 선박 — 월 (같은 장소·같은 해 안, 1월 대비)\n')
print('| 유형 | ' + ' | '.join('%d월' % m for m in range(2, 13)) + ' |'); print('|---|' + '---|' * 11)
for sub in ['전체', '전복', '침수', '침몰', '좌초좌주', '표류', '접촉', '충돌']:
    x = SM[SM.subset == sub].set_index('term')
    print('| ' + sub + ' | ' + ' | '.join('%.2f' % x.loc['m%02d' % m, 'RR'] for m in range(2, 13)) + ' |')
# ---------- 위험구역 ----------
H = pd.read_csv(R + '/spot_hazard_models.csv'); HD = pd.read_csv(R + '/spot_hazard_desc.csv')
print('\n#### 위험구역 — 관광지 반경 3km 안 개수별 관광지 몫 인명사고 (2020~2024)\n')
print('같은 시군구 안 관광지끼리 비교(시군구 고정효과) + 관광지 몫 해안선 길이 보정. 기준 = 0곳.\n')
print('| 개수 구간 | 관광지 수 | 사고 수 | 관광지당 연간 사고 | RR 2020~24 전체 | RR 2023~24만(지정 이후) | RR 사망·실종 사고 |'); print('|---|---|---|---|---|---|---|')
for b in ['0', '1-2', '3-5', '6+']:
    d = HD[HD.bin == '[출발안] ' + b].iloc[0]
    def g(y):
        x = H[(H.model.str.startswith('출발안 구간(')) & (H.outcome == y) & (H.term == 'bin_start_' + b)]
        return '1 (기준)' if b == '0' else '%.2f (%.2f–%.2f)' % (x.RR.iloc[0], x.lo.iloc[0], x.hi.iloc[0])
    print('| %s | %d | %d | %.2f | %s | %s | %s |' % (b, d.spots, d.events, d.per_spot_per_year, g('n_all'), g('n_2023_24'), g('n_fatal')))
print('\n| 세분 구간 | 관광지 수 | 사고 수 | 관광지당 연간 사고 | RR 전체 | RR 2023~24 |'); print('|---|---|---|---|---|---|')
for b in ['0', '1', '2', '3', '4-5', '6-8', '9-12', '13+']:
    d = HD[HD.bin == b].iloc[0]
    def g(y):
        x = H[(H.model == '세분 구간') & (H.outcome == y) & (H.term == 'bin_fine_' + b)]
        return '1 (기준)' if b == '0' else '%.2f (%.2f–%.2f)' % (x.RR.iloc[0], x.lo.iloc[0], x.hi.iloc[0])
    print('| %s | %d | %d | %.2f | %s | %s |' % (b, d.spots, d.events, d.per_spot_per_year, g('n_all'), g('n_2023_24')))
x = H[H.model.str.contains('사망사고') & (H.term == 'fatal_any')]
print('\n사망사고 발생구역이 3km 안에 1곳 이상(개수 구간 함께 보정): ' + '; '.join('%s %.2f (%.2f–%.2f)' % ({'n_all': '전체 사고', 'n_2023_24': '2023~24', 'n_fatal': '사망·실종 사고'}[o], a, b, c) for o, a, b, c in zip(x.outcome, x.RR, x.lo, x.hi)))
x = H[(H.model.str.startswith('출발안 구간(')) & H.outcome.isin(['n_익수', 'n_추락', 'n_고립', 'n_표류']) & H.term.str.startswith('bin_start')]
print('\n유형별(출발안 구간 RR, 1-2 / 3-5 / 6+): ' + '; '.join('%s %s' % (o[2:], ' / '.join('%.2f' % v for v in g.RR)) for o, g in x.groupby('outcome', sort=False)))
C = pd.read_csv(R + '/coastgrid_hazard_models.csv')
x = C[(C.bins == 'bin')]
print('\n보조(전국 해안선 격자, 전남 포함, 대해구 고정효과): ' + '; '.join('%s %s' % ({'n': '2020~24', 'n_late': '2023~24'}[o], ' / '.join('%s %.2f (%.2f–%.2f)' % (t.replace('bin_', ''), a, b, c) for t, a, b, c in zip(g.term, g.RR, g.lo, g.hi))) for o, g in x.groupby('outcome', sort=False)))
B = pd.read_csv(R + '/spot_bins_compare.csv')
print('\n| 구간안 | 결과 | 구간별 관광지 수 | RR(기준 0곳) | AIC |'); print('|---|---|---|---|---|')
for _, r in B.iterrows(): print('| %s | %s | %s | %s | %.1f |' % (r.scheme, {'n_all': '2020~24', 'n_2023_24': '2023~24'}[r.outcome], r.spots_per_bin, r.RR, r.aic))
# ---------- 치명도 ----------
V = pd.read_csv(R + '/severity_models.csv')
print('\n#### 치명도 — 사고 1건이 사망·실종으로 이어진 비율(유형·월·연도 보정)\n')
print('| 비교 | 비율 배수 (95% CI) | 조건 있음 사고 수 | 사망·실종 비율(있음/없음) |'); print('|---|---|---|---|')
for _, r in V.iterrows():
    rate = '' if pd.isna(r.fatal_rate_with) else '%.1f%% / %.1f%%' % (100 * r.fatal_rate_with, 100 * r.fatal_rate_without)
    print('| %s — %s | %.2f (%.2f–%.2f) | %s | %s |' % (r.model, r.term, r.ratio, r.lo, r.hi, '' if pd.isna(r.n_with) else int(r.n_with), rate))
# ---------- 특보 상당 ----------
E = pd.read_csv(R + '/warning_equivalence.csv')
print('\n#### 해구 예측 일 최대값과 실제 특보(연안 앞바다 25구역, 구역×대해구×날짜)\n')
print('| 구간 | 구역-일 수 | 특보(주의보 이상) 비율 | 경보 비율 | 특보일 중 이 조건이 잡는 비율 |'); print('|---|---|---|---|---|')
for _, r in E.iterrows():
    nm = {'wh_max': '파고 ', 'ws_max': '풍속 ', 'OR': ''}[r['var']] + str(r['bin'])
    print('| %s | %d | %.1f%% | %.1f%% | %s |' % (nm, r.n, 100 * r.p_any, 100 * r.p_경보, '' if pd.isna(r.share_of_warn_days_caught) else '%.1f%%' % (100 * r.share_of_warn_days_caught)))
T = pd.read_csv(R + '/ship_traffic_proxy.csv')
print('\n#### 선박 사건 지점의 해양교통 혼잡지수(2026-10-10 예보 2시각 평균, 2km 안 최근접 4단계 칸)\n')
print('| 유형 | 사건 | 혼잡지수 중앙값 | 1 이상 비율 | 10 이상 비율 | 칸 없음(0.1 미만 추정) 비율 |'); print('|---|---|---|---|---|---|')
for _, r in T.iterrows(): print('| %s | %d | %.2f | %.1f%% | %.1f%% | %.1f%% |' % (r.type, r.n, r.median_cong, 100 * r.share_ge1, 100 * r.share_ge10, 100 * r.share_zero))
S2 = pd.read_csv(R + '/person_sensitivity.csv')
print('\n#### 인명 민감도 분석\n')
print('| 분석 | 항 | RR (95% CI) | 사고 수 |'); print('|---|---|---|---|')
for _, r in S2.iterrows(): print('| %s | %s | %.2f (%.2f–%.2f) | %d |' % (r.analysis, r.term, r.RR, r.lo, r.hi, r.n_events))
K = pd.read_csv(R + '/checks.csv')
print('\n#### 확인 기록(자동 대조)\n')
for _, r in K.iterrows(): print('- %s : %s' % (r.check, r.value))
