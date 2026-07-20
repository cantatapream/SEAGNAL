#!/usr/bin/env python3
# handoff.py — 인계인수 로그를 HANDOFF.md "작업 로그"에 일관된 형식으로 append(계정 간 연속성).
# 사용:
#   python3 handoff.py start "제목" "무엇을·어떻게 할 것인지"     → 🟢착수 항목
#   python3 handoff.py done  "제목" "무엇을 했나·진행률·다음"      → ✅완료 항목
# 시각은 KST. (환경에 date 없으면 인자로 --date 'YYYY-MM-DD HH:MM' 전달 가능)
# 원칙: HANDOFF.md 상단 "A. 현재 상태 스냅샷"은 사람/모델이 직접 갱신(스냅샷은 항상 최신), 이 스크립트는 로그만 append.
import sys, os, subprocess

HANDOFF = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'HANDOFF.md'))
MARK = '## 작업 로그 (append-only · 최신이 위)'

def kst_now():
    try:
        return subprocess.check_output(['date', '-u', '-d', '+9 hours', '+%Y-%m-%d %H:%M'], text=True).strip() + ' KST'
    except Exception:
        return '(시각미상)'

def main():
    args = sys.argv[1:]
    date = None
    if '--date' in args:
        i = args.index('--date'); date = args[i + 1]; del args[i:i + 2]
    if len(args) < 2:
        print('사용: handoff.py start|done "제목" "내용"'); sys.exit(1)
    kind, title = args[0], args[1]
    body = args[2] if len(args) > 2 else ''
    icon = '🟢착수' if kind == 'start' else '✅완료'
    ts = date + ' KST' if date else kst_now()
    entry = f'\n### [{ts}] {icon} — {title}\n{body}\n'
    txt = open(HANDOFF, encoding='utf-8').read()
    if MARK not in txt:
        txt = txt.rstrip() + '\n\n' + MARK + '\n'
    # 로그 헤더 바로 아래(최신이 위)에 삽입 — 안내줄(> 형식...) 다음
    lines = txt.split('\n')
    idx = next(i for i, l in enumerate(lines) if l.strip() == MARK)
    ins = idx + 1
    while ins < len(lines) and lines[ins].startswith('>'):
        ins += 1
    new = '\n'.join(lines[:ins] + entry.split('\n') + lines[ins:])
    tmp = HANDOFF + '.tmp'; open(tmp, 'w', encoding='utf-8').write(new); os.replace(tmp, HANDOFF)
    print(f'HANDOFF 로그 append: [{ts}] {icon} {title}')

if __name__ == '__main__':
    main()
