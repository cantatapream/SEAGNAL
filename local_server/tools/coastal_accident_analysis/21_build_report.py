"""상세 보고서 조립 — 본문(report_parts/*.md) 안의 표 자리표시를 결과 표 파일에서 그대로 옮겨 채운다(표 숫자를 손으로 옮기지 않음).
자리표시 형식: 한 줄에 <<표: 파일이름 | 제목>>  → 그 파일에서 '#### 제목'(또는 '##### 제목') 절을 다음 같은 수준 제목 전까지 통째로 넣는다.
사용: python3 -I 21_build_report.py <report_parts_dir> <results_dir> <out.md>
"""
import sys, os, re, glob
P, R, OUT = sys.argv[1:4]
cache = {}
def section(fn, title):
    if fn not in cache: cache[fn] = open(os.path.join(R, fn)).read().split('\n')
    L = cache[fn]
    for i, l in enumerate(L):
        m = re.match(r'^(#{3,5}) (.*)$', l)
        if m and m.group(2).strip() == title.strip():
            lvl = len(m.group(1)); j = i + 1
            while j < len(L):
                m2 = re.match(r'^(#{3,5}) ', L[j])
                if m2 and len(m2.group(1)) <= lvl: break
                j += 1
            body = L[i + 1:j]
            while body and not body[0].strip(): body.pop(0)
            while body and not body[-1].strip(): body.pop()
            return '\n'.join(body)
    raise SystemExit('표를 못 찾음: %s | %s' % (fn, title))
out = []; n = 0
for f in sorted(glob.glob(os.path.join(P, '*.md'))):
    for line in open(f).read().split('\n'):
        m = re.match(r'^<<표: (.+?) \| (.+)>>$', line.strip())
        if m:
            out.append(section(m.group(1), m.group(2))); n += 1
        else:
            out.append(line)
    out.append('')
open(OUT, 'w').write('\n'.join(out))
print('조립 완료:', OUT, '| 표', n, '개 | 크기', os.path.getsize(OUT), 'bytes')
