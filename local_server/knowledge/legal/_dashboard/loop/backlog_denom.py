#!/usr/bin/env python3
"""백로그의 **진짜 분모**를 재려 한다 — 그리고 어디까지 잴 수 있는지 정직하게 밝힌다.

[왜 있나 — 2026-08-24]
1순위 라운드에서 사서 여럿이 독립적으로 "백로그 건수가 부풀어 있다"고 보고했다.
· 선박직원법: 표제 528건이 실제 고유 문항 약 208개(2.5배)
· 원양산업발전법: 7라운드에 해소된 논점을 이후 4개 라운드가 계속 "미해결"로 다시 적음
· 농수산물원산지표시법: 70여 항목이 R5N→R6N 으로 통째 재복제
· 무인도서법: 한 줄에 논점 5~7개를 압축
· 해양수산발전기본법: 헤더 숫자 자체가 실제와 다름

**분모를 못 믿으면 "얼마나 남았나"도 못 말한다.** 그래서 세어 보려 했는데 —

[★기계로 중복을 못 센다는 것을 실측으로 확인했다. 세 가지를 시도해 전부 무효였다]
  ⓐ **문항 코드 기준** — 무효. 코드가 **라운드마다 재사용된다.**
     수산종자산업육성법 "30"이 568행에서는 "협회 인가 반려 후 재신청 대기기간",
     592행에서는 "시행규칙 제17조 세부지침이 국가법령정보센터에 있나"였다. 전혀 다른 질문이다.
     이 방법으로 세면 986건이 "중복"으로 나오는데 대부분 가짜다.
  ⓑ **유형 태그 기준** — 무효. `T7`·`T5` 를 코드로 오인해 164회 "중복"이 나왔는데
     그건 질문 유형 태그일 뿐이다.
  ⓒ **질문 텍스트 완전일치** — 유효하지만 **하한선만** 준다(108건).
     같은 논점이 라운드마다 표현을 바꿔 다시 적히므로 대부분 못 잡는다.

**근본 원인**: 백로그에 **안정된 식별자가 없다.** 감사가 라운드마다 번호를 새로 매기기 때문이다.
그러니 진짜 해결책은 추출 단계가 아니라 **감사 단계에서 문항에 안정 ID를 부여하는 것**이다.
이 도구는 그 전까지 **셀 수 있는 것만** 센다.

[무엇을 하나 — 셋 다 표시만 하고 지우지 않는다]
1. **법리·판례 항목에 표시** — `_CHATBOT.md` §5-2 가 "판례·법리·다툼의 여지는 챗봇이 답할 영역이
   아니다"라고 이미 정했다. 이 항목들은 위키를 고쳐서 풀 것이 아니므로 **분모에서 뺀다.**
   ⚠표본 10건을 눈으로 확인했고 9건이 진짜 법리였다(1건은 요약행). 완벽하지 않으니 표시만 한다.
2. **압축행에 표시** — "나머지 N건도 동일: A missing, B thin…" 처럼 한 줄에 논점을 여러 개 넣은 것.
   개별 대조가 불가능하므로 **사서가 풀어써야 한다**고 표시한다.
3. **중복은 표시하지 않는다** — 위에 적은 이유로 안전하게 못 가른다. 세어서 알려만 준다.

[쓰는 법]
  python3 backlog_denom.py            → 무엇을 표시할지 보여만 준다
  python3 backlog_denom.py --apply    → 실제로 표시한다
[연계] _dashboard/backlog/*.md 를 고친다 · 되돌리기는 _touched.py --revert
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
BL = os.path.join(LEGAL, '_dashboard', 'backlog')
sys.path.insert(0, HERE)

# 항목 스스로 "법리·판례라 우리 영역이 아니다"라고 말하거나, 명백히 법리 개념을 묻는 것
JURIS = re.compile(r'죄수론|경합범|상상적\s*경합|헌법재판소|이중처벌|판례|법리|유권해석|성년의제'
                   r'|스코프\s*밖|§\s*6-A|§\s*5-2')
# 한 줄에 논점을 여러 개 눌러 담은 것
COMPRESSED = re.compile(r'나머지\s*\d+\s*건도?\s*동일|동일\s*방식\s*:')
MARK_J = '⟪분모제외(2026-08-24): 법리·판례 — _CHATBOT.md §5-2 상 챗봇이 답할 영역이 아님⟫'
MARK_C = '⟪전개필요(2026-08-24): 한 줄에 논점 여러 개 — 사서가 개별 항목으로 풀어써야 대조 가능⟫'


def main():
    apply = '--apply' in sys.argv
    plan = collections.defaultdict(list)
    stat = collections.Counter()
    total = 0
    for fn in sorted(f for f in os.listdir(BL) if f.endswith('.md')):
        for i, line in enumerate(open(os.path.join(BL, fn), encoding='utf-8').read().split('\n')):
            m = re.match(r'^- \[ \] (.*)$', line)
            if not m:
                continue
            total += 1
            t = m.group(1)
            if COMPRESSED.search(t):
                plan[fn].append((i, MARK_C)); stat['압축행(전개 필요)'] += 1
            elif JURIS.search(t):
                plan[fn].append((i, MARK_J)); stat['법리·판례(분모 제외)'] += 1

    n = sum(len(v) for v in plan.values())
    print('■ 백로그 분모 정리 — 표시만 하고 지우지 않는다')
    print('   잔존 %d건 중 표시 대상 %d건 / 파일 %d개' % (total, n, len(plan)))
    for k, v in stat.most_common():
        print('     %-22s %5d' % (k, v))
    print('\n   → 법리를 빼면 실질 분모는 %d건이 된다' % (total - stat['법리·판례(분모 제외)']))
    print('\n   ⚠중복은 세지 않는다 — 기계로 안전하게 못 가른다(파일 머리말의 세 가지 실측 참조).')
    if not apply:
        print('\n   (--apply 를 붙이면 실제로 표시한다.)')
        return

    from _touched import Touched
    t = Touched('backlog_denom')
    for fn, hits in plan.items():
        p = os.path.join(BL, fn)
        lines = open(p, encoding='utf-8').read().split('\n')
        for i, mark in hits:
            if mark not in lines[i]:
                lines[i] = lines[i] + '  ' + mark
        t.add(p)
        open(p, 'w', encoding='utf-8').write('\n'.join(lines))
    t.save()
    print('\n   표시 완료 %d건' % n)


main()
