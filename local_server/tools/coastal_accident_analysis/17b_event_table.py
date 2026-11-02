"""17_event_days.py 출력(로그)을 보고서용 마크다운 표로 바꾼다(숫자를 손으로 옮기지 않기 위해).
사용: python3 -I 17b_event_table.py <v2 로그> <v1 로그> > results/event_days.md
"""
import sys, re
def parse(fn):
    t = open(fn).read(); out = {}
    m = re.search(r'행사일\(시군구-일\) (\d+) 관측 ([\d.]+) 기대 ([\d.]+) RR ([\d.]+) 95% \(np.float64\(([\d.]+)\), np.float64\(([\d.]+)\)\)', t)
    out['전체 행사일'] = m.groups()
    for lab in ('주말행사일', '평일행사일'):
        m = re.search(lab + r' 시군구-일 (\d+) 관측 ([\d.]+) 기대 ([\d.]+) RR ([\d.]+) \(np.float64\(([\d.]+)\), np.float64\(([\d.]+)\)\)', t)
        out[lab] = m.groups()
    out['types'] = re.findall(r'  (\S+) 관측 ([\d.]+) 기대 ([\d.]+)', t)
    return out
v2, v1 = parse(sys.argv[1]), parse(sys.argv[2])
print('#### 행사일 사고 비교 (같은 시군구·같은 달·같은 요일의 행사 없는 날 대비)\n')
print('| 구분 | 시군구-일 | 관측 사고 | 기대 사고 | 배수 (95% 신뢰구간) |'); print('|---|---|---|---|---|')
for k, lab in (('전체 행사일', '전체 행사일'), ('주말행사일', '주말 행사일'), ('평일행사일', '평일 행사일')):
    n, o, e, rr, lo, hi = v2[k]
    print('| %s | %s | %d | %.2f | %.2f (%.2f–%.2f) |' % (lab, n, float(o), float(e), float(rr), float(lo), float(hi)))
n, o, e, rr, lo, hi = v1['전체 행사일']
print('| (참고) v1 — 변사 포함, 전체 행사일 | %s | %d | %.2f | %.2f (%.2f–%.2f) |' % (n, float(o), float(e), float(rr), float(lo), float(hi)))
print('\n| 유형 | 관측 사고 | 기대 사고 |'); print('|---|---|---|')
for t, o, e in v2['types']: print('| %s | %d | %.2f |' % (t, float(o), float(e)))
