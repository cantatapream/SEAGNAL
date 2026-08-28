#!/usr/bin/env python3
"""백로그 목록을 **현재 상태로 다시 고른다** — 낡은 목록으로 헛일하지 않도록.

[왜 있나 — 2026-08-23 실측]
1순위 856건을 51개 법에 돌렸더니 **623건 중 392건(63%)이 이미 고쳐져 있었다.**
목록을 8/20~21 상태로 만들었는데 그 뒤 8/21~23 에 다른 라운드가 위키를 고쳤기 때문이다.
선박직원법은 14건 중 9건, 무인도서법은 17건 중 12건이 그랬고, 무인도서법 부칙 건은
**바로 전날** 다른 세션이 근거표까지 채워 끝낸 것이었다.

그리고 사서들이 목록 자체의 오염을 여럿 보고했다 — 감사 파일의 **범례·방법론 서술문**이
항목으로 뽑히고, 같은 결함이 여러 줄로 중복 등록되고, 다른 법 것이 엉뚱한 법에 배정됐다.

[무엇을 하나]
1. **실제 항목이 아닌 줄에 표시**한다(범례·집계 서술문). ⚠지우지 않는다 —
   진짜 항목을 지우는 쪽이 훨씬 나쁘다(backlog_extract.js 가 같은 이유로 규칙을 좁게 잡았다).
2. **같은 법 안 중복**을 표시한다(첫 줄만 남기고 나머지에 표시).
3. **[미수집]을 텍스트/이미지로 가른다** — 그림은 law.go.kr API 로 원천적으로 못 받는데
   사서가 세 가지 방법을 다 시도한 사고가 있었다(항로표지법 픽토그램).
4. 그러고 나서 **남은 것만** 다시 센다.

⚠**"이미 고쳐졌나"는 여전히 기계가 못 가른다.** 2026-08-20 에 그걸 기계로 정하려다
1,353건을 오판했다(감사관이 바로 그 줄에 "위키에 없음"이라 적어 둔 항목이었다).
이 도구가 줄이는 것은 **목록의 오염**이지 "이미 해소된 것"이 아니다.
이미 해소된 것은 사서가 위키를 읽어야 갈리고, 그 결과가 `- [x]` 로 이 파일에 쌓인다 —
그러니 **다음 배치는 이 파일의 현재 상태에서 뽑으면** 그만큼 헛일이 준다.

[쓰는 법]
  python3 backlog_refresh.py            → 무엇을 표시할지 보여만 준다(파일 안 고침)
  python3 backlog_refresh.py --apply    → 실제로 표시한다
[연계] _dashboard/backlog/*.md 를 고친다 · 되돌리기는 _touched.py --revert
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
BL = os.path.join(LEGAL, '_dashboard', 'backlog')
sys.path.insert(0, HERE)

SYM = re.compile(r'✅|⚠|❌|📛|〰|🔓')
QUES = re.compile(r'\?|나요|하나요|인가|되나|있나')
LEGEND = re.compile(r'(판정\s*기호|범례)\s*[:：]|페르소나\s*태그')
AGG = re.compile(r'(미해소|전수\s*재확인|누적|소계|합계|총계)\s*\d+\s*건|\d+\s*건\s*(전수|재확인|유지|불변)')
# 그림으로만 있는 것 — API 로는 원천적으로 못 받는다
IMG = re.compile(r'픽토그램|도안|디자인|이미지|그림|스캔|사진|양식\s*그림|도면')
MARK = '⏭️기계판정(2026-08-23)'


def core_of(t):
    return re.sub(r'^\((R?\d+|라운드미상)\)\s*', '', t)


def key_of(t):
    c = re.sub(r'^\((R?\d+|라운드미상)\)\s*\|?', '', t)
    if c.startswith('|'):
        cells = [x.strip() for x in c.split('|') if x.strip()]
        c = cells[1] if (cells and re.fullmatch(r'[#R]?\d+', cells[0].replace('#', '')) and len(cells) > 1) \
            else (cells[0] if cells else '')
    return re.sub(r'[|`*_#>\s⚠❌✅📛〰🔓]', '', c)[:70]


def judge(core):
    """이 줄이 '실제 항목이 아니다'라고 **확실히** 말할 수 있나. 애매하면 None(건드리지 않는다).

    ★처음엔 규칙을 넓게 잡았다가 **적용 직전에 표본 10건을 눈으로 보고 되돌렸다**(2026-08-23).
      "판정 기호가 3개 이상 나오고 물음표가 없으면 범례"라는 규칙이 184건을 잡았는데,
      무작위 10건을 열어 보니 **절반이 진짜 항목**이었다:
        · `|C704|T6|police|⚠thin|유지(⚠thin)|11R 재확인…|` — 실제 문항 표 행이다
        · `표지판 미달 몰수 여부(⚠thin, 13회) · 재도색 경계(⚠thin, 8회) · …` — 결함 4개를 묶은 줄
        · `J1(분구정의 ⚠thin) · J2(어항구 동일성 ⚠thin) · J3(분구위반처벌 ❌missing) …` — 7건 묶음
      감사 문장은 결함을 **판정 기호와 함께 나열**하는 습관이 있어, 기호 개수로는 범례와 안 갈린다.
      그대로 적용했으면 **진짜 결함 90여 건을 "항목 아님"으로 묻었을 것이다.**
      backlog_extract.js 가 같은 이유로 규칙을 좁게 잡았다("진짜 항목을 지우는 쪽이 훨씬 나쁘다") —
      그 경고를 읽고도 같은 실수를 할 뻔했다.

    그래서 **원문이 스스로 "이건 범례다"라고 밝힌 것만** 남긴다.
    나머지(집계 요약·방법론 서술·중복)는 기계가 안전하게 못 가른다 — 사서가 볼 일이다.
    """
    if LEGEND.search(core):
        return '실제 항목 아님 — 판정기호 범례(원문이 스스로 밝힘)'
    return None


def main():
    apply = '--apply' in sys.argv
    seen = collections.defaultdict(list)
    plan = collections.defaultdict(list)   # 파일 → [(줄번호, 사유)]
    stat = collections.Counter()
    files = sorted(f for f in os.listdir(BL) if f.endswith('.md'))
    for fn in files:
        law = re.sub(r'_\d+라운드$', '', fn[:-3])
        lines = open(os.path.join(BL, fn), encoding='utf-8').read().split('\n')
        for i, line in enumerate(lines):
            m = re.match(r'^- \[([ x])\] (.*)$', line)
            if not m or m.group(1) == 'x':
                continue
            core = core_of(m.group(2))
            r = judge(core)
            if r:
                plan[fn].append((i, r)); stat[r.split(' — ')[1]] += 1; continue
            # ⚠중복 표시도 하지 않는다: 결함 여러 개를 묶어 적은 줄이 많아
            #   앞 70자 열쇠로는 서로 다른 줄이 같아 보일 수 있다. 세어서 알려만 준다.
            k = (law, key_of(m.group(2)))
            if k in seen:
                stat['중복으로 보임(표시 안 함, 참고)'] += 1
            else:
                seen[k] = (fn, i)
            if IMG.search(core):
                stat['그림 성격(API로 못 받음, 참고)'] += 1

    tot = sum(len(v) for v in plan.values())
    print('■ 백로그 정리 — 실제 항목이 아닌 줄에 표시한다(지우지 않는다)')
    print('   표시 대상 %d건 / 파일 %d개' % (tot, len(plan)))
    for k, v in stat.most_common():
        print('     %-28s %4d' % (k, v))
    print('\n   ⚠"이미 고쳐졌나"는 이 도구가 못 가른다 — 그건 사서가 위키를 읽어야 갈린다.')
    if not apply:
        print('\n   (--apply 를 붙이면 실제로 표시한다. 지금은 보여만 줬다.)')
        return

    from _touched import Touched
    t = Touched('backlog_refresh')
    for fn, hits in plan.items():
        p = os.path.join(BL, fn)
        lines = open(p, encoding='utf-8').read().split('\n')
        for i, why in hits:
            lines[i] = lines[i].replace('- [ ]', '- [x]', 1) + '  ⟪%s: %s⟫' % (MARK, why)
        t.add(p)
        open(p, 'w', encoding='utf-8').write('\n'.join(lines))
    t.save()
    print('\n   표시 완료 %d건' % tot)


main()
