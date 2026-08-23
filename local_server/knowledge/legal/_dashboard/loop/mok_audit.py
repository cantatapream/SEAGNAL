#!/usr/bin/env python3
"""raw 조문 파일에 **목(가.·나.·다.)이 통째로 빠진 곳**을 원본과 직접 대조해 찾는다.

[왜 있나 — 2026-08-23, 25차 결함 검증에서 발견]
선박안전법 시행규칙 제18조①1호("승선인원에 산입되지 않는 사람")는 law.go.kr 원본에
가.·나.·다. 3개 목이 실재하는데(API 직접 조회로 확인), 우리 raw 에는 **호 제목만 남고
목이 통째로 빠져** 있었다. 감사관은 그 raw 를 읽고 "원문 자체에 규정이 없다(content_gap)"고
판정했다 — 실제로는 우리가 수집을 빠뜨린 것(collection_hole)이다.

**이 둘은 해결 경로가 정반대다.** content_gap 은 "없다고 정직하게 쓰기"가 최선이고
collection_hole 은 "다시 받아오기"가 답이다. 뒤바뀌면 그 항목은 영원히 안 고쳐진다 —
"법에 없는 것"으로 분류되는 순간 아무도 다시 찾지 않기 때문이다.

[어떻게 찾나 — 추측하지 않는다. 원본과 숫자를 맞춰 본다]
`_meta.json` 의 MST 로 law.go.kr DRF 원본을 받아 **목이 몇 개인지 세고**, 같은 계열의
우리 raw txt 에서 **목 줄이 몇 개인지 세어** 비교한다. 원본에 있는데 우리에게 없으면 누락이다.
어림짐작하지 않는다 — 양쪽 다 실제로 센 숫자다.

⚠**한계(반드시 알고 쓸 것)**: 이 검사는 **목의 개수**만 본다. 개수가 맞아도 내용이 잘렸거나
표가 유실된 것은 못 잡는다. 통과했다고 수집이 완전하다는 뜻이 아니다.
그리고 별표·행정규칙 파일은 대상이 아니다(조문 구조가 아니라 문서라서 MST 대조가 안 된다).

[고치는 법] 누락이 나오면 `recollect_jomun.py` 로 그 계열을 다시 받는다 —
그 도구는 목을 제대로 옮긴다(63행). 빠진 파일들은 그 도구가 생기기 전에 수집된 것이다.

[쓰는 법]
  python3 mok_audit.py                 → 전수 대조(427개 계열, API 호출 있음 — 수 분 걸림)
  python3 mok_audit.py --law 선박안전법   → 한 법만
  python3 mok_audit.py --gate          → 누락이 있으면 종료코드 1

[연계] ← raw/*/*/_meta.json · law.go.kr DRF API   → _dashboard/mok_audit.json
       ⚠읽기 전용 — 파일을 고치지 않는다. 고치는 것은 recollect_jomun.py 몫이다.
"""
import os
import re
import sys
import json
import glob
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
KINDS = [('법률', '법률.txt'), ('시행령', '시행령.txt'), ('시행규칙', '시행규칙.txt')]

argv = sys.argv[1:]
only = argv[argv.index('--law') + 1] if '--law' in argv else None

# recollect_jomun.py 가 목을 6칸 들여쓰기로 적는다(63행). 옛 수집본도 같은 관례를 따랐다.
MOK_LINE = re.compile(r'^\s{4,}[가-힣]\s*\.')


def L(x):
    return x if isinstance(x, list) else ([x] if x else [])


def api(url, tries=3):
    """DRF 원본을 받는다. 빈 응답이 간헐적으로 오므로 몇 번 다시 시도한다."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.strip().startswith('{'):
                return json.loads(body)
        except Exception:
            pass
        time.sleep(1 + i)
    return None


def api_mok_count(mst):
    """원본에서 목이 몇 개인지 센다. 못 받으면 None(=판정 불가, 0 이 아니다)."""
    d = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=eflaw&type=JSON&MST=%s' % (OC, mst))
    if not d:
        return None, None
    root = d.get('법령', d)
    n, spots = 0, []
    for a in L(root.get('조문', {}).get('조문단위')):
        for h in L(a.get('항')):
            for x in L(h.get('호')):
                mk = L(x.get('목'))
                if mk:
                    n += len(mk)
                    spots.append('제%s조 %s' % (a.get('조문번호'), str(x.get('호내용'))[:40]))
    return n, spots


rows, no_answer = [], []
metas = sorted(glob.glob(os.path.join(RAW, '*', '*', '_meta.json')))
targets = []
for mp in metas:
    base = os.path.dirname(mp)
    law = os.path.basename(base)
    if only and only not in law:
        continue
    try:
        meta = json.load(open(mp, encoding='utf-8'))
    except Exception:
        continue
    for kind, fn in KINDS:
        fam = (meta.get('families') or {}).get(kind)
        # 계열이 여러 개인 법이 있어 리스트로 적힌 곳이 있다(예: 시행규칙이 부처별로 둘).
        # 첫 항목의 MST 를 쓰되, 리스트라는 사실 자체를 기록해 나중에 사람이 볼 수 있게 한다.
        multi = isinstance(fam, list)
        if multi:
            fam = fam[0] if fam else None
        if not isinstance(fam, dict) or not fam.get('MST'):
            continue
        p = os.path.join(base, fn)
        if os.path.exists(p):
            targets.append((law, kind + ('(계열 여러 개 중 첫째)' if multi else ''), fam['MST'], p))

print('■ 목 누락 대조 — 원본(law.go.kr)과 우리 raw 의 목 개수를 맞춰 본다')
print('   대상 계열: %d개' % len(targets))

for i, (law, kind, mst, p) in enumerate(targets, 1):
    ours = sum(1 for ln in open(p, encoding='utf-8') if MOK_LINE.match(ln))
    theirs, spots = api_mok_count(mst)
    if theirs is None:
        no_answer.append('%s %s (MST=%s)' % (law, kind, mst))
        continue
    if theirs > ours:
        rows.append({'law': law, 'kind': kind, 'mst': mst,
                     'file': os.path.relpath(p, LEGAL),
                     'api_mok': theirs, 'raw_mok': ours, 'missing': theirs - ours,
                     'spots': spots[:12]})
    if i % 40 == 0:
        print('   ... %d/%d 대조' % (i, len(targets)), flush=True)

print('\n   원본에 있는데 우리에게 없는 계열 : %d개' % len(rows))
print('   원본을 못 받아 판정 못 한 계열   : %d개' % len(no_answer))
if rows:
    rows.sort(key=lambda r: -r['missing'])
    print('   빠진 목 총 개수                  : %d개' % sum(r['missing'] for r in rows))
    print('\n   많이 빠진 순 상위 20')
    for r in rows[:20]:
        print('     %4d개  %s %s  (원본 %d / 우리 %d)'
              % (r['missing'], r['law'], r['kind'], r['api_mok'], r['raw_mok']))
    out = os.path.join(LEGAL, '_dashboard', 'mok_audit.json')
    json.dump({'missing': rows, 'no_answer': no_answer}, open(out, 'w'),
              ensure_ascii=False, indent=1)
    print('\n   목록 저장: %s' % out)
if no_answer:
    print('\n   ⚠판정 못 한 계열(원본 응답 없음 — "없다"가 아니라 "모른다"다):')
    for x in no_answer[:15]:
        print('     ', x)

if '--gate' in argv and rows:
    sys.exit(1)
