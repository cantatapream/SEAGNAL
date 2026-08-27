#!/usr/bin/env python3
"""백로그 항목을 **그 항목이 가리키는 근거 조문**으로 묶어 준다.

[왜 있나 — 2026-08-27~28, 사서 제안 + 오케스트레이터 오판 정정]
사서들이 라운드마다 "같은 것을 여러 번 확인하고 있다"고 보고했다. 실측 보고 몇 가지:
  · 해운법 — 「내항해운에관한고시」 **제13조 조항 하나**를 페르소나만 바꿔 반복 질문한 항목이
    많고, **최소 13개 근거가 30건 이상으로 중복**이다(그 사서는 이 방식으로 43건을 한 번에 닫았다).
  · 수산종자산업육성법 — `33㎡ 산정단위` 8회 · `허가정보 조회방법` 6회 · `자수·자진신고 감경` 4회.
  · 선박직원법·자연유산법·해양사고심판법 — 같은 조문을 놓고 코드만 바뀐 중복.

⚠**오케스트레이터가 처음에 "문항 텍스트 유사도로 걸러내자"고 제안했는데 틀렸다.**
전수로 세어 보니 **앞 80자가 완전히 같은 줄은 0건**이다(15,708건 중). 중복은 글자가 아니라
**뜻**에서 겹친다 — 질문 문장은 다르고 가리키는 조문이 같다. 그래서 글자 비교로는 하나도 안 잡힌다.
사서들이 제안한 **"같은 조문을 가리키는 항목끼리 묶기"** 가 맞는 방식이다.

[무엇을 하나 — 지우지 않는다. 묶어서 보여만 준다]
각 미해소 줄에서 조문 표기(`제13조③2호라목` 꼴)와 그 앞의 법령·고시 이름을 뽑아
**(법령, 조문)** 을 열쇠로 묶는다. 한 묶음을 확인하면 그 안의 줄을 한꺼번에 판정할 수 있다.
⚠**중복을 지우지 않는다.** 어떤 감사가 무엇을 지적했는지는 기록이라 남겨야 한다.

⚠**묶였다고 같은 항목이라는 뜻이 아니다.** 같은 조문을 놓고 서로 다른 것을 묻는 경우가 있다
(예: 같은 조의 '누가'와 '언제'). 묶음은 **함께 보라는 표시**이지 판정이 아니다.

[쓰는 법]
  python3 backlog_by_article.py                 → 전수 집계 + 많이 묶인 조문 상위
  python3 backlog_by_article.py --law <이름>     → 한 법만(묶음별 줄까지)
  python3 backlog_by_article.py --json PATH     → 법별 묶음 저장(사서에게 배포할 때)
[연계] ← _dashboard/backlog/*.md   ⚠읽기 전용 — 백로그를 고치지 않는다.
"""
import os
import re
import sys
import json
import glob
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
BACKLOG = os.path.join(LEGAL, '_dashboard', 'backlog')

# 조문 표기 — 항·호·목까지 붙은 것을 통째로 잡는다(제13조③2호라목).
ART = re.compile(r'제\s*(\d{1,3})\s*조(?:의\s*(\d{1,2}))?'
                 r'((?:\s*[①-⑮]|\s*제\s*\d+\s*항)?(?:\s*\d+\s*호)?(?:\s*[가-힣]\s*목)?)')
# 조문 바로 앞에 오는 법령·고시 이름(낫표 안 또는 '…법/령/규칙/고시/지침' 꼴).
LAWNAME = re.compile(r'[「『]([^」』]{2,40})[」』]\s*$|([가-힣A-Za-z0-9ㆍ·()]{2,30}'
                     r'(?:법|법률|시행령|시행규칙|규정|고시|지침|요령|세칙|기준|정관))\s*$')
ID = re.compile(r'⟨(BL-[0-9a-f]{8})⟩')


def law_before(text):
    """조문 표기 바로 앞 30자에서 법령 이름을 찾는다. 없으면 '' (= 그 페이지의 법)."""
    m = LAWNAME.search(text[-30:].strip())
    if not m:
        return ''
    return (m.group(1) or m.group(2) or '').strip()


def keys_of(line):
    """한 줄이 가리키는 (법령, 조문) 열쇠들. 같은 줄에 여럿이면 여럿 다 돌려준다."""
    out = []
    for m in ART.finditer(line):
        art = '제%s조%s' % (m.group(1), ('의' + m.group(2)) if m.group(2) else '')
        tail = re.sub(r'\s+', '', m.group(3) or '')
        out.append((law_before(line[:m.start()]), art + tail))
    return out


def main():
    argv = sys.argv[1:]
    only = argv[argv.index('--law') + 1] if '--law' in argv else None
    out_path = argv[argv.index('--json') + 1] if '--json' in argv else None

    by_law = {}
    n_open = n_keyed = 0
    for p in sorted(glob.glob(os.path.join(BACKLOG, '*.md'))):
        law = re.sub(r'_\d+라운드$', '', os.path.basename(p)[:-3])
        if only and only not in law:
            continue
        groups = collections.defaultdict(list)
        for i, ln in enumerate(open(p, encoding='utf-8'), 1):
            if not ln.startswith('- [ ]'):
                continue
            n_open += 1
            ks = keys_of(ln)
            if not ks:
                continue
            n_keyed += 1
            bid = (ID.search(ln) or [None, ''])[1] if ID.search(ln) else ''
            # 한 줄이 여러 조문을 가리키면 **첫 조문**으로 묶는다(가장 앞이 그 항목의 주제다).
            k = ks[0]
            groups[k].append({'file': os.path.basename(p), 'line': i, 'id': bid,
                              'text': ln.strip()[:170]})
        if groups:
            by_law.setdefault(law, collections.defaultdict(list))
            for k, v in groups.items():
                by_law[law][k].extend(v)

    multi = [(law, k, v) for law, g in by_law.items() for k, v in g.items() if len(v) > 1]
    saved = sum(len(v) - 1 for _, _, v in multi)
    print('■ 백로그 미해소 항목을 **가리키는 조문**으로 묶었다 — 판정이 아니라 함께 보라는 표시다')
    print('   미해소 %d건 · 그중 조문을 짚은 것 %d건(%.0f%%)' % (n_open, n_keyed, n_keyed / max(n_open, 1) * 100))
    print('   **둘 이상이 같은 조문을 가리키는 묶음 %d개 · 거기 묶인 줄 %d건**'
          % (len(multi), sum(len(v) for _, _, v in multi)))
    print('   → 묶음 하나를 확인하면 최대 %d건을 한꺼번에 판정할 수 있다(줄 수 − 묶음 수).' % saved)
    print('   ⚠묶였다고 같은 질문이라는 뜻은 아니다. 같은 조를 놓고 다른 것을 묻기도 한다.')
    if multi:
        print('\n   많이 묶인 조문 상위 15')
        for law, k, v in sorted(multi, key=lambda x: -len(x[2]))[:15]:
            nm = ('「%s」 ' % k[0]) if k[0] else ''
            print('     %3d건  %s%-16s  %s' % (len(v), nm, k[1], law[:34]))
    if only:
        print()
        for law, g in by_law.items():
            for k, v in sorted(g.items(), key=lambda x: -len(x[1])):
                if len(v) < 2:
                    continue
                print('  ── %s%s — %d건' % (('「%s」 ' % k[0]) if k[0] else '', k[1], len(v)))
                for x in v[:8]:
                    print('       %s:%d  %s' % (x['file'][:28], x['line'], x['text'][:110]))
                print()
    if out_path:
        dump = {law: {('%s|%s' % k): v for k, v in g.items() if len(v) > 1}
                for law, g in by_law.items()}
        dump = {k: v for k, v in dump.items() if v}
        json.dump({'open': n_open, 'keyed': n_keyed, 'groups': len(multi), 'by_law': dump},
                  open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n   저장: %s' % out_path)


main()
