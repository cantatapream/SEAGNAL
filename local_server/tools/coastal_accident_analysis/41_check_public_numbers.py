"""위험지수 산출 근거 보고서(일반인용 원고)에 적은 숫자가 원 분석 자료에 실제로 있는지 대조한다.
대상: v3/public/*_위험지수_산출근거.md (배포 원고). 기준: v3/report.md + v3/*.md 결과 표.
대조하는 숫자: ①'배수 (하한–상한)' 묶음 ②소수 둘째 자리 숫자(1.68 등) ③쉼표 들어간 건수(6,810 등).
그 밖의 숫자(68%, 약 4.5배처럼 반올림해 옮긴 값)는 여기서 못 보므로 독립 검토가 맡는다.
사용: python3 -I 41_check_public_numbers.py <v3 폴더>   → 표에 없는 숫자를 줄 번호와 함께 찍고, 있으면 종료코드 1
"""
import sys, os, re, glob
V3 = sys.argv[1]
ref = ''.join(open(f).read() + '\n' for f in sorted(glob.glob(os.path.join(V3, '*.md'))))  # report.md 포함
ref = ref.replace('배 (', ' (').replace('−', '-')
pair = re.compile(r'(\d+\.\d\d)\s*\((\d+\.\d\d)\s*[–~-]\s*(\d+\.\d\d)\)')
refpairs = set(pair.findall(ref))
dec = re.compile(r'(?<![\d.])-?\d+\.\d\d(?![\d])')
cnt = re.compile(r'(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d])')
refdec = set(x.lstrip('-') for x in dec.findall(ref))
refcnt = set(re.findall(r'(?<![\d.])\d+(?![\d.])', ref.replace(',', '')))  # 원자료는 쉼표 없이 적은 건수도 있다(3138)
bad = 0; seen = 0
for f in sorted(glob.glob(os.path.join(V3, 'public', '*_위험지수_산출근거.md'))):
    for i, line in enumerate(open(f).read().replace('−', '-').split('\n'), 1):
        line2 = line.replace('배 (', ' (')
        for m in pair.findall(line2):
            seen += 1
            if m not in refpairs: bad += 1; print('  - 표에 없음(배수 묶음): %s:%d %s (%s–%s)' % (os.path.basename(f), i, *m))
        rest = pair.sub(' ', line2)
        for x in dec.findall(rest):
            seen += 1
            if x.lstrip('-') not in refdec: bad += 1; print('  - 원자료에 없음(소수): %s:%d %s' % (os.path.basename(f), i, x))
        for x in cnt.findall(rest):
            seen += 1
            if x.replace(',', '') not in refcnt: bad += 1; print('  - 원자료에 없음(건수): %s:%d %s' % (os.path.basename(f), i, x))
print('대조한 숫자 %d개, 원자료에 없는 숫자 %d개' % (seen, bad))
sys.exit(1 if bad else 0)
