#!/usr/bin/env python3
"""백로그 항목에 **고정 ID**를 붙인다 — 지금은 같은 문제가 몇 번 중복됐는지도 못 센다.

[왜 있나 — 2026-08-24 실측]
백로그 23,529건 중 중복이 얼마나 되는지 세려고 세 가지 방법을 썼는데 전부 무효였다.
  · **문항 코드 기준** → 무효. 감사가 **라운드마다 번호를 새로 매긴다.**
    수산종자산업육성법 "30"이 한 곳은 "협회 인가 반려 후 재신청 대기기간",
    다른 곳은 "시행규칙 제17조 세부지침"이었다. 전혀 다른 질문이다.
  · **유형 태그 기준** → 무효. `T7`·`T5`는 코드가 아니라 질문 유형 태그다.
  · **질문 텍스트 완전일치** → 유효하지만 하한선만 준다(108건).

**근본 원인: 항목에 고정된 이름이 없다.** 그래서
  ① 같은 문제가 몇 번 등록됐는지 못 센다  ② 다음 라운드가 같은 것을 또 등록하는 걸 못 막는다
  ③ **일이 얼마나 남았는지 자체를 모른다**(16,902는 상한선일 뿐이다)

[이 도구가 하는 일]
각 줄에 `⟨BL-xxxxxxxx⟩`를 붙인다. ID는 **(법 + 정규화한 항목 본문)의 해시**라
  · 추출을 다시 해도 **같은 줄이면 같은 ID**가 나온다(표시를 잃지 않는다)
  · **글자까지 똑같은 중복은 같은 ID를 받아 즉시 드러난다**

⚠**이것이 중복 문제를 다 푸는 것은 아니다.** 표현이 조금 달라진 같은 논점은 여전히 다른 ID를 받는다.
  그건 사서가 보고 `= BL-xxxxxxxx`로 이어 주어야 한다. 이 도구는 그 **손잡이**를 만들 뿐이다.

[정규화 — 무엇을 지우고 비교하나]
체크박스 · 라운드 표기 `(R12)` · 판정 기호 · 나중에 붙인 주석(⟪…⟫) · 공백.
**질문 본문과 판정 내용은 지우지 않는다** — 그걸 지우면 다른 질문이 같은 ID를 받는다.

[지금은 `backlog_extract.js` 가 뽑을 때 바로 붙인다 — 2026-08-24]
이 도구는 **이미 만들어져 있던 파일에 뒤늦게 이름을 붙이려고** 만든 것이다. 그 일은 끝났고,
지금은 추출 도구가 항목을 적는 순간 같은 계산으로 ID 를 붙인다(그 도구의 JS 계산이 이 파일의
결과와 **23,529건 전부 일치**함을 확인했다). 그러니 평소에는 이 도구를 돌릴 일이 없다.
ID 를 잃은 줄이 생겼을 때의 **수선 도구**로 남겨 둔다.
⚠ID 는 **태어날 때 내용에서 나오고 그 뒤로는 붙어 다닌다** — 감사가 표현을 바꿔도 옛 ID 를 물려준다.
  그러므로 "지금 내용의 해시 = 그 줄의 ID" 가 아닐 수 있다. 그건 고장이 아니라 그렇게 설계한 것이다.

[쓰는 법]
  python3 backlog_id.py            → 무엇이 붙을지, 완전중복이 몇 건인지 보여만 준다
  python3 backlog_id.py --apply    → 실제로 붙인다
[연계] _dashboard/backlog/*.md · 되돌리기는 _touched.py --revert
"""
import os, re, sys, hashlib, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
BL = os.path.join(LEGAL, '_dashboard', 'backlog')
sys.path.insert(0, HERE)

ID_RE = re.compile(r'⟨BL-[0-9a-f]{8}⟩')
NOTE_RE = re.compile(r'⟪[^⟫]*⟫')                    # 나중에 붙인 주석
ROUND_RE = re.compile(r'^\((?:R?\d+|라운드미상)\)\s*')
SYM_RE = re.compile(r'[✅⚠❌📛〰🔓🔒🆙🔁]')


def norm(law, body):
    """ID의 재료. 라운드·기호·주석·공백만 지우고 **내용은 남긴다.**"""
    t = ID_RE.sub('', body)
    t = NOTE_RE.sub('', t)
    t = ROUND_RE.sub('', t.strip())
    t = SYM_RE.sub('', t)
    t = re.sub(r'\s+', '', t)
    return law + '|' + t


def make_id(key):
    return 'BL-' + hashlib.sha1(key.encode('utf-8')).hexdigest()[:8]


def main():
    apply = '--apply' in sys.argv
    seen = collections.defaultdict(list)
    plan = collections.defaultdict(list)
    already = 0
    for fn in sorted(f for f in os.listdir(BL) if f.endswith('.md')):
        law = re.sub(r'_\d+라운드$', '', fn[:-3])
        lines = open(os.path.join(BL, fn), encoding='utf-8').read().split('\n')
        for i, line in enumerate(lines):
            m = re.match(r'^- \[([ x])\] (.*)$', line)
            if not m:
                continue
            if ID_RE.search(line):
                already += 1
                continue
            bid = make_id(norm(law, m.group(2)))
            seen[bid].append((fn, i + 1))
            plan[fn].append((i, bid))

    n = sum(len(v) for v in plan.values())
    coll = {k: v for k, v in seen.items() if len(v) > 1}
    dupn = sum(len(v) - 1 for v in coll.values())
    print('■ 백로그 고정 ID 부여')
    print('   붙일 항목       %6d' % n)
    print('   이미 붙어 있음  %6d' % already)
    print('   고유 ID         %6d' % len(seen))
    print('   ★글자까지 같은 완전중복 : 초과분 %d건 (%d개 ID가 2번 이상)' % (dupn, len(coll)))
    if coll:
        print('\n   가장 많이 겹친 것')
        for bid, v in sorted(coll.items(), key=lambda x: -len(x[1]))[:5]:
            print('     %s  %d회  %s' % (bid, len(v), ' · '.join('%s:%d' % (f[:22], l) for f, l in v[:3])))
    if not apply:
        print('\n   (--apply 를 붙이면 실제로 붙인다.)')
        return

    from _touched import Touched
    t = Touched('backlog_id')
    for fn, hits in plan.items():
        p = os.path.join(BL, fn)
        lines = open(p, encoding='utf-8').read().split('\n')
        for i, bid in hits:
            lines[i] = lines[i] + '  ⟨%s⟩' % bid
        t.add(p)
        open(p, 'w', encoding='utf-8').write('\n'.join(lines))
    t.save()
    print('\n   부여 완료 %d건' % n)


main()
