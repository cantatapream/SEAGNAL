#!/usr/bin/env python3
"""백로그의 **집계 줄**(질문이 아니라 라운드 요약)을 닫는다 — 단, 안전 조건을 만족할 때만.

왜 (2026-09-01, 백로그 1묶음에서 사서 둘이 독립적으로 지적했다):
  백로그에는 질문이 아닌 줄이 섞여 있다. 예를 들어
    `- [ ] (R13) - **⚠thin 49건**(13R과 동일): X41·Y16·Z2·Z4·… `
  같은 줄은 **그 라운드가 무엇을 판정했는지 요약한 것**이지 답해야 할 질문이 아니다.
  그런데 `- [ ]` 로 남아 있어 "미해소"로 세어지고, 남은 건수를 부풀린다.
  선박교통관제만 7줄, 섬발전촉진법은 손 못 댄 71건 중 상당수가 이것이었다.

무엇을 하나 — **함부로 닫지 않는다.** 다음을 전부 만족할 때만 닫는다:
  ① 물음표도 없고 "~나요"·"~하나" 같은 질문 어미도 없다(질문이 아니다).
  ② `N건`·`N문항` 같은 개수 표현이 있다(집계문이다).
  ③ 그 줄이 **나열한 항목 ID 가 2개 이상**이다.
  ④ **나열한 ID 전부가 같은 파일에서 이미 `- [x]` 로 닫혀 있다.**
  ⑤ 그 ID 중 **개별 줄을 못 찾은 것이 하나도 없다.**
  ⚠하나라도 열려 있거나 못 찾으면 **건드리지 않는다** — 그 집계 줄은 아직 할 일이 남았다는 뜻이다.

닫을 때는 줄 끝에 근거를 적는다 — 몇 개를 확인했고 그것들이 어디에 있는지.

[연계] 읽고 씀: _dashboard/backlog/*.md  (다른 파일은 건드리지 않는다)
사용법: python3 backlog_rollup_close.py            # 미리보기(안 고침)
        python3 backlog_rollup_close.py --apply    # 실제로 고침
"""
import glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.abspath(os.path.join(HERE, '..', 'backlog'))

CNT = re.compile(r'\d+\s*(?:건|문항|개)')
QUESTION = re.compile(r'\?|나요|하나\b|되나|있나|어떻게|무엇')
# 항목 ID: 글자+숫자를 모두 가진 토큰(수집 도구와 같은 기준). 라운드 표기(R12)는 뺀다.
ID_TOK = re.compile(r'(?<![A-Za-z0-9-])((?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)(?![A-Za-z0-9-])')
# 항목 ID 가 아닌 것들을 뺀다(2026-09-01 미리보기에서 실제로 걸린 것만 넣었다):
#   R12 = 라운드 표기 · BL-xxxx = 백로그 줄 고유번호 · REVIEW-06 = 검수 큐 번호
#   H-34 = 마스터플랜 항목 · L-67 = 교훈 번호 · f42efcf93 = 커밋 해시
#   R12-13 = 라운드-번호 표기(R12-W11 처럼 뒤가 글자면 진짜 ID 라 남긴다)
ID_BAD = re.compile(r'^R\d+$|^BL-|^REVIEW-|^[HL]-\d+$|^R\d+-\d+$|^[0-9a-f]{7,}$')


def ids_in(text):
    out = []
    for m in ID_TOK.finditer(text):
        t = m.group(1)
        if ID_BAD.match(t) or len(t) < 2:
            continue
        out.append(t)
    return out


def state_of(lines, ident):
    """그 ID 를 항목 ID 칸에 가진 **개별 줄**의 상태. 'x'|' '|None(못 찾음)."""
    pat = re.compile(r'^- \[(.)\][^|]*\|\s*' + re.escape(ident) + r'\s*[|\s]')
    for l in lines:
        m = pat.match(l)
        if m:
            return m.group(1)
    return None


def main():
    apply = '--apply' in sys.argv
    closed = held = 0
    for f in sorted(glob.glob(os.path.join(BL, '*.md'))):
        lines = open(f, encoding='utf-8').read().split('\n')
        changed = False
        for i, l in enumerate(lines):
            if not l.startswith('- [ ]'):
                continue
            body = l[5:]
            if QUESTION.search(body) or not CNT.search(body):
                continue
            listed = ids_in(body)
            if len(listed) < 2:
                continue
            states = [(t, state_of(lines, t)) for t in listed]
            open_or_missing = [t for t, s in states if s != 'x']
            if open_or_missing:
                held += 1
                if not apply:
                    print('  보류 %s:%d  나열 %d개 중 아직 %d개가 열림/못찾음 (%s…)'
                          % (os.path.basename(f), i + 1, len(listed),
                             len(open_or_missing), '·'.join(open_or_missing[:4])))
                continue
            note = ('  (집계 줄 — 나열한 항목 %d개가 모두 이 파일에서 이미 닫혀 있음을 확인해 닫는다, '
                    '2026-09-01 backlog_rollup_close.py: %s)'
                    % (len(listed), '·'.join(listed[:6]) + ('…' if len(listed) > 6 else '')))
            lines[i] = '- [x]' + body + note
            closed += 1
            changed = True
            if not apply:
                print('  닫음 %s:%d  나열 %d개 전부 이미 닫힘' % (os.path.basename(f), i + 1, len(listed)))
        if changed and apply:
            open(f, 'w', encoding='utf-8').write('\n'.join(lines))
    print('\n닫을 수 있는 집계 줄 %d개 · 아직 할 일이 남아 보류한 것 %d개%s'
          % (closed, held, '' if apply else '   (미리보기 — 아무것도 안 고쳤다)'))


if __name__ == '__main__':
    main()
