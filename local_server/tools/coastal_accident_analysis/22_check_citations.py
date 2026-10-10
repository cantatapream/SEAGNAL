"""본문 해설에 손으로 적은 '배수 (하한–상한)' 숫자가 결과 표에 실제로 있는지 대조한다.
대상: report_parts/*.md 중 표 자리표시를 뺀 본문 줄. 기준: results/ 의 표 파일들(tables.md·season_tables.md·extra_tables.md·event_days.md).
사용: python3 -I 22_check_citations.py <report_parts_dir> <results_dir>   → 결과를 출력(보고서 §10.3 끝에 붙임)
"""
import sys, os, re, glob
P, R = sys.argv[1:3]
ref = ''.join(open(os.path.join(R, f)).read() for f in ('tables.md', 'season_tables.md', 'extra_tables.md', 'event_days.md', 'checks_v3.md', 'points.md', 'event_ccr.md', 'warning_equivalence_alldays.md', 'fatal_points.md', 'fatality_warn.md', 'summer_bonus.md', 'fcst_leads.md', 'prewarn.md', 'extras.md', 'swell.md', 'points_v31.md') if os.path.exists(os.path.join(R, f)))
pat = re.compile(r'(\d+\.\d\d)\s*\((\d+\.\d\d)[–-](\d+\.\d\d)\)')
refset = set(pat.findall(ref.replace('배 (', ' (')))
found = miss = 0; misses = []
for f in sorted(glob.glob(os.path.join(P, '*.md'))):
    for i, line in enumerate(open(f).read().split('\n'), 1):
        if line.strip().startswith('<<표:'): continue
        for m in pat.findall(line):
            if m in refset: found += 1
            else: miss += 1; misses.append('%s:%d %s (%s–%s)' % (os.path.basename(f), i, *m))
print('본문 인용 "배수 (하한–상한)" %d개 중 결과 표와 일치 %d개, 표에 없음 %d개' % (found + miss, found, miss))
for x in misses: print('  - 표에 없음:', x)
