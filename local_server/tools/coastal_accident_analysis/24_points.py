"""A안 점수표(사용자 확정 U18: "1점 = 사고 위험 2배", 점수가 높을수록 위험) — 결과 CSV 의 배수를 log₂ 로 바꿔 찍는다.
점수 = log₂(배수). 배수 2 → 1점, 4 → 2점, 1 → 0점. 신뢰구간도 같이 바꿔 적는다(점수의 불확실성).
'근거 등급': 강함(신뢰구간 하한 > 1 이고 여러 계절·유형·기간에서 반복) / 경계(하한이 1 근처) / 가설(근거 기준 미충족 — 점수에 넣지 않는 후보).
사용: python3 -I 24_points.py <results_dir> > results/points.md
"""
import sys, re
import numpy as np, pandas as pd
R = sys.argv[1]
P = pd.read_csv(R + '/person_models.csv'); S = pd.read_csv(R + '/ship_models.csv'); H = pd.read_csv(R + '/spot_hazard_models.csv')
def g(df, model, subset, term, col='subset'):
    x = df[(df.model.str.startswith(model)) & (df[col] == subset) & (df.term == term)]
    return x.iloc[0]
ev = open(R + '/event_ccr.md').read()
m = re.search(r'\| 주말\(토·일\) \| \d+ \| \d+ \| [\d.]+% \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \|', ev)
ev_w = dict(RR=float(m.group(1)), lo=float(m.group(2)), hi=float(m.group(3)))
chk = open(R + '/checks_v3.md').read()
def season_row(block, season):
    seg = chk[chk.index(block):]
    m = re.search(r'\| %s \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \| (\d+) \|' % season, seg)
    return dict(RR=float(m.group(1)), lo=float(m.group(2)), hi=float(m.group(3)))
def nonwarn_row(block, season):
    seg = chk[chk.index('특보 없는 날 대비'):]; seg = seg[seg.index(block):]
    m = re.search(r'\| %s \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \[\d+\]' % season, seg)
    return dict(RR=float(m.group(1)), lo=float(m.group(2)), hi=float(m.group(3)))
# 점수는 '평소(특보 없는 날)' 대비여야 한다 — 특보일끼리 비교한 값(2.70·3.82)이 아니라 특보 없는 날 대비 값을 쓴다
win_wh = nonwarn_row('| 계절 | 특보 & 파고 2m 이상', '겨울'); win_ws = nonwarn_row('| 계절 | 특보 & 풍속 10m/s 이상', '겨울')
pt = lambda v: np.log2(v)
rows = []
def add(area, factor, level, r, basis, grade, src):
    rows.append((area, factor, level, r['RR'], r['lo'], r['hi'], pt(r['RR']), pt(r['lo']), pt(r['hi']), basis, grade, src))
v = g(P, 'D2_', '전체', 'log2_outsider')
add('연안', '사람(혼잡)', '1단계 = 사람 2배', v, '외지인 방문자 2배당(같은 시군구·같은 달, 요일·공휴일 보정)', '강함', '§4.4')
for b, lab in (('1-2', '위험구역 1~2곳'), ('3-5', '위험구역 3~5곳'), ('6+', '위험구역 6곳 이상')):
    x = H[(H.model.str.startswith('출발안 구간(')) & (H.outcome == 'n_2023_24') & (H.term == 'bin_start_' + b)].iloc[0]
    add('연안', '장소(위험구역 3km 안)', lab, x, '지정 이후(2023~24) 사고, 같은 시군구 안 관광지 비교', '강함', '§4.6')
x = H[H.model.str.contains('사망사고') & (H.outcome == 'n_2023_24') & (H.term == 'fatal_any')].iloc[0]
add('연안', '장소(가산)', '사망사고 발생구역 3km 안 1곳 이상', x, '지정 이후(2023~24), 개수 구간 함께 보정', '경계', '§4.6')
add('연안', '행사', '주말 행사일', ev_w, '같은 시군구·같은 연월·같은 요일 비교(조건부 포아송)', '경계', '§4.5')
add('연안(넣지 않음)', '바다·날씨(겨울)', '겨울 특보 & 파고 2m 이상(특보 없는 날 대비)', win_wh, '평소와 차이 뚜렷하지 않음(특보일끼리 비교한 2.70배는 순한 특보일이 낮아서 생김)', '근거 없음', '§6.2')
add('연안(넣지 않음)', '바다·날씨(겨울)', '겨울 특보 & 풍속 10m/s 이상(특보 없는 날 대비)', win_ws, '평소와 차이 뚜렷하지 않음', '근거 없음', '§6.2')
SENS = '기상민감4종(전복·침몰·침수·표류)'
add('해상', '바다·날씨', '주의보', g(S, 'S시각_A3b', SENS, 'warn_주의보'), '기상민감 4종, 사고 시각 맞춤', '강함', '§5.5')
add('해상', '바다·날씨', '경보', g(S, 'S시각_A3b', SENS, 'warn_경보'), '기상민감 4종, 사고 시각 맞춤', '강함', '§5.5')
add('해상', '바다·날씨', '특보 없음·풍속 12~14m/s', g(S, 'S시각_C6', SENS, 'nw_ws_12-14'), '기상민감 4종, 사고 시각 맞춤, 축 모형(28건)', '가설', '§5.8')
def ship_row(block, label):
    seg = chk[chk.index('특보 없는 때 대비 — 선박'):]; seg = seg[seg.index(block):]
    m = re.search(r'\| %s \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \| \d+ \|' % re.escape(label), seg)
    return dict(RR=float(m.group(1)), lo=float(m.group(2)), hi=float(m.group(3)))
add('해상', '바다·날씨', '특보 & 풍속 14~17m/s(특보 없는 때 대비)', ship_row('| 특보 & 풍속 |', '풍속 14~17'), '기상민감 4종, 사고 시각 맞춤', '강함', '§6.6')
add('해상', '바다·날씨', '특보 & 풍속 17m/s 이상(특보 없는 때 대비)', ship_row('| 특보 & 풍속 |', '풍속 17 이상'), '기상민감 4종, 사고 시각 맞춤', '강함', '§6.6')
add('해상', '바다·날씨', '특보 & 파고 4m 이상(특보 없는 때 대비)', ship_row('| 특보 & 파고 |', '파고 4 이상'), '기상민감 4종, 사고 시각 맞춤', '강함', '§6.6')

add('연안(별도 칸 후보)', '물놀이 떠밀림(표류)', '해안 바람 7~9m/s(3~5 대비, 특보 없는 날)', g(P, 'B6', '표류', 'aws_ws[7-9]'), '연안 표류, 해안 AWS', '경계', '§4.8')
add('연안(넣지 않음)', '주말·공휴일', '토요일(방문자 보정 후)', g(P, 'D2_', '전체', 'dow5'), '방문자를 함께 넣으면 남는 몫', '근거 없음', '§4.2')
add('연안(넣지 않음)', '바다·날씨(겨울 외)', '특보 있음(전 계절)', g(P, 'A2_', '전체', 'any_warn'), '특보일 하루 사고 수', '반대 방향(회피)', '§4.7')
print('#### A안 점수표 — 점수 = log₂(배수) · 1점 = 사고 위험 2배 · 점수가 높을수록 위험\n')
print('| 영역 | 요소 | 단계 | 배수 (95% 신뢰구간) | 점수 (95% 신뢰구간) | 근거 | 근거 등급 | 절 |'); print('|---|---|---|---|---|---|---|---|')
for a, f, l, rr, lo, hi, p, pl, ph, b, gr, s in rows:
    print('| %s | %s | %s | %.2f (%.2f–%.2f) | %.2f (%.2f–%.2f) | %s | %s | %s |' % (a, f, l, rr, lo, hi, p, pl, ph, b, gr, s))
pd.DataFrame(rows, columns=['area', 'factor', 'level', 'RR', 'lo', 'hi', 'point', 'point_lo', 'point_hi', 'basis', 'grade', 'section']).to_csv(R + '/points.csv', index=False, encoding='utf-8-sig')
# 연안 만점 예시
ex = {r[2]: r[6] for r in rows}
cmax = 3 * ex['1단계 = 사람 2배'] + ex['위험구역 6곳 이상'] + ex['사망사고 발생구역 3km 안 1곳 이상'] + ex['주말 행사일']
print('\n연안 만점 예시(사람 3단계 + 위험구역 6곳 이상 + 사망사고 발생구역 + 주말 행사) = %.2f점 → 모든 요소가 0점인 조건(사람 가장 적음·위험구역 0곳·행사 없음) 대비 약 %.0f배.' % (cmax, 2 ** cmax))
print('(주의: 요소별 배수를 곱해 합친 값이다 — 사람×장소의 상호작용은 검정하지 못했다, §8.5.)')
print('요소별 비중: 사람 %.0f%% · 위험구역 %.0f%% · 사망사고 발생구역 %.0f%% · 주말 행사 %.0f%%.' % (
    100 * 3 * ex['1단계 = 사람 2배'] / cmax, 100 * ex['위험구역 6곳 이상'] / cmax, 100 * ex['사망사고 발생구역 3km 안 1곳 이상'] / cmax, 100 * ex['주말 행사일'] / cmax))
print('연안 바다·날씨(겨울 포함)는 특보 없는 날 대비 사고 증가가 뚜렷하지 않아 점수에 넣지 않았다(위 표의 "넣지 않음" 행).')
smax = ex['경보']
print('해상 바다·날씨: 주의보 %.2f점(약 %.1f배) · 경보 %.2f점(약 %.1f배). 교통(선박 혼잡) 점수는 근거 없음(§5.10).' % (ex['주의보'], 2 ** ex['주의보'], smax, 2 ** smax))
