"""A안 점수표 v3.1 — 2026-10-10 사용자 결정(달마다 점수 · 사망·실종 배수 병기 · 백분율 표기 · 2~3일 예보 칸 · 예비특보 · 너울)을 반영한 통합표.
점수 = log₂(전체 사고 배수). 백분율 = (배수 − 1) × 100. 값은 모두 결과 파일에서 읽는다(손으로 옮기지 않음):
  fatal_points.csv(28) · fcst_leads.md(32) · swell.md(30) · extras.md(31)
사용: python3 -I 34_points_v31.py <results_dir> > results/points_v31.md
"""
import sys, re
import numpy as np, pandas as pd
R = sys.argv[1]
F = pd.read_csv(R + '/fatal_points.csv')
def fp(area, level, oc):
    x = F[(F.area == area) & (F.level == level) & (F.outcome == oc)]
    return None if x.empty or not np.isfinite(x.iloc[0].RR) or x.iloc[0].n < 5 else x.iloc[0]
def pct(v): return ('%+.0f%%' % (100 * (v - 1))).replace('-', '−')
rows = []
def add(area, factor, level, a, f, basis, grade):
    rows.append(dict(area=area, factor=factor, level=level, a=a, f=f, basis=basis, grade=grade))
def tup(r): return None if r is None else (r.RR, r.lo, r.hi)
add('연안', '사람(혼잡)', '1단계 = 사람 2배', tup(fp('연안', '사람(외지인 방문자) 2배', '전체 사고')), tup(fp('연안', '사람(외지인 방문자) 2배', '사망·실종 사고')), '같은 장소·같은 달, 사람이 절반인 날 대비', '강함')
for b in ('위험구역 1~2곳', '위험구역 3~5곳', '위험구역 6곳 이상', '사망사고 발생구역 3km 안'):
    add('연안', '장소', b, tup(fp('연안', b, '전체 사고')), tup(fp('연안', b, '사망·실종 사고')), '같은 시군구, 위험구역 없는 관광지 대비(지정 이후 2023~24)', '강함' if '위험구역' in b else '경계')
add('연안', '행사', '주말 행사일', tup(fp('연안', '주말 행사일', '전체 사고')), tup(fp('연안', '주말 행사일', '사망·실종 사고')), '같은 시군구·같은 달·같은 요일, 행사 없는 날 대비', '경계')
for m in range(1, 13):
    a = fp('연안', '%d월' % m, '전체 사고')
    add('연안', '달', '%d월' % m, tup(a), tup(fp('연안', '%d월' % m, '사망·실종 사고')), '1년 평균 날 대비(사람 수 같게 맞춘 뒤)', '강함' if a is not None and (a.lo > 1 or a.hi < 1) else '뚜렷하지 않음')
sw = open(R + '/swell.md').read()
m = re.search(r'\| 특보 없는 날 · 전체 \| \d+ \| (?:[^|]+\|){3} ([\d.]+) \(([\d.]+)–([\d.]+)\) \[\d+\] \|', sw)
mf = re.search(r'\| 특보 없는 날 · 사망·실종 \| \d+ \| (?:[^|]+\|){3} ([\d.]+) \(([\d.]+)–([\d.]+)\) \[\d+\] \|', sw)
add('연안', '너울(정책 후보)', '파도 주기 12초 이상', tuple(map(float, m.groups())), tuple(map(float, mf.groups())), '특보 없는 날, 파고 보정, 주기 6초 미만 대비 — 뚜렷하지 않음', '정책값 후보')
add('연안(점수 밖)', '특보', '특보 있는 날 — 하루 사고 수', tup(fp('연안(점수 밖)', '특보 있는 날', '전체 사고')), tup(fp('연안(점수 밖)', '특보 있는 날', '사망·실종 사고')), '같은 장소·같은 달, 특보 없는 날 대비', '반대 방향(회피)')
x = F[F.factor == '특보(사고 1건의 치명률)'].iloc[0]
add('연안(점수 밖)', '특보', '특보 날 사고 1건이 사망·실종으로 이어질 비율', None, (x.RR, x.lo, x.hi), '유형·월·연도 보정', '뚜렷하지 않음')
for lv in ('주의보', '경보', '특보 & 풍속 14~17m/s', '특보 & 풍속 17m/s 이상', '특보 & 파고 4m 이상'):
    add('해상', '바다·날씨(실제 특보)', lv, tup(fp('해상', lv, '전체 사고')), tup(fp('해상', lv, '사망·실종 사고')), '같은 장소·같은 달·같은 시각, 특보 없는 때 대비', '강함')
ex = open(R + '/extras.md').read()
m = re.search(r'\| 주의보 & 파고 4m 이상 \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \| \d+ \|', ex)
add('해상', '바다·날씨(실제 특보)', '주의보 & 파고 4m 이상', tuple(map(float, m.groups())), None, '같은 기준', '강함(사고 19건)')
fl = open(R + '/fcst_leads.md').read()
for crit, lab in (('파고≥2 또는 풍속≥12', '넓은 기준(파고 2m·풍속 12m/s)'), ('파고≥2.5 또는 풍속≥14', '엄격 기준(파고 2.5m·풍속 14m/s)'), ('파고≥4 또는 풍속≥17', '파고 4m·풍속 17m/s')):
    m = re.search(r'\| 선박 기상민감 4종 \| %s \| (?:[^|]+\|){2} ([\d.]+) \(([\d.]+)–([\d.]+)\) \[\d+\] \|' % re.escape(crit), fl)
    mf = re.search(r'\| 선박 기상민감 4종 사망·실종 \| %s \| (?:[^|]+\|){2} ([\d.]+) \(([\d.]+)–([\d.]+)\) \[\d+\] \|' % re.escape(crit), fl)
    add('해상', '2~3일 뒤(예보만)', '사흘 전 예보 ' + lab, tuple(map(float, m.groups())), tuple(map(float, mf.groups())) if mf else None, '같은 장소·같은 달, 예보가 기준 미만으로 본 날 대비(실제 특보 여부 무관)', '강함')
print('#### A안 점수표 v3.1 — 점수 = log₂(전체 사고 배수) · 백분율 = (배수 − 1) × 100 · 사망·실종은 병기만\n')
print('| 영역 | 요소 | 단계 | 사고: 백분율 (95% 구간) · 배수 | 점수 | 사망·실종 사고: 백분율 (95% 구간) | 기준 | 근거 등급 |'); print('|---|---|---|---|---|---|---|---|')
for r in rows:
    a = '—' if r['a'] is None else '**%s** (%s ~ %s) · %.2f배' % (pct(r['a'][0]), pct(r['a'][1]), pct(r['a'][2]), r['a'][0])
    p = '—' if r['a'] is None else '%.2f' % np.log2(r['a'][0])
    f = '추정 보류(5건 미만)' if r['f'] is None else '**%s** (%s ~ %s)' % (pct(r['f'][0]), pct(r['f'][1]), pct(r['f'][2]))
    if r['a'] is None and r['f'] is not None and r['factor'] == '특보': f = '**%s** (%s ~ %s) — 사고 1건 기준' % (pct(r['f'][0]), pct(r['f'][1]), pct(r['f'][2]))
    print('| %s | %s | %s | %s | %s | %s | %s | %s |' % (r['area'], r['factor'], r['level'], a, p, f, r['basis'], r['grade']))
ex_ = {r['level']: np.log2(r['a'][0]) for r in rows if r['a'] is not None}
mx = 3 * ex_['1단계 = 사람 2배'] + ex_['위험구역 6곳 이상'] + ex_['사망사고 발생구역 3km 안'] + ex_['주말 행사일'] + max(ex_['%d월' % i] for i in range(1, 13))
print('\n연안 만점 예시(사람 3단계 + 위험구역 6곳 이상 + 사망사고 발생구역 + 주말 행사 + 가장 높은 달) = %.2f점(너울 후보 제외).' % mx)
print('달 점수의 범위: %.2f ~ %.2f점(1년 평균 날 = 0점 — 겨울은 마이너스).' % (min(ex_['%d월' % i] for i in range(1, 13)), max(ex_['%d월' % i] for i in range(1, 13))))
