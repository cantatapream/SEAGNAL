#!/usr/bin/env python3
"""위험한 git 명령을 실행 직전에 막는다 (사용자 확정 2026-08-23, L-171·L-179·L-180).

왜 있나:
  이 저장소는 여러 에이전트가 동시에 파일을 고친다. 그 상황에서 "담을/되돌릴 대상을
  디렉토리로 잡는" 명령은 남의 작업을 쓸어담거나 지운다. 실제로 세 번 사고가 났다.
    · `git add -A` 로 남의 미완성 작업을 커밋에 담음 (2회, L-171)
    · `git checkout -- <디렉토리>` 로 남이 방금 끝낸 판독 결과 23장을 지움 (1회, L-179)
  금지 규칙은 2026-07-28(L-40)부터 있었지만 **에이전트 프롬프트에만** 걸려 있었고
  오케스트레이터에게는 아무 장치가 없었다. 교훈 178건 중 34%가 재발이고 기계화율은 27%다(L-180).
  규칙을 읽는 것과 규칙이 지켜지는 것은 다른 문제라, 도구 실행 단계에서 막는다.

무엇을 막나 (Bash 명령만 본다):
  1. `git add -A` / `git add .` / `git add --all`      → 경로를 개별 지정하라
  2. `git checkout -- <디렉토리>` / `git restore <디렉토리>`
     (파일 경로면 통과. 디렉토리이거나 `.` 이면 차단)   → _touched.py --revert 를 쓰라
  3. `git stash` (push/save 계열)                      → 남의 작업까지 치운다
  4. `git reset --hard` / `git clean -fd`              → 되돌릴 수 없다
  5. `git push --force` / `-f`                         → CLAUDE.md 상 사용자 확인 필요

무엇은 통과시키나:
  · 경로를 개별 지정한 `git add <파일>` · `git add -- <경로> ':(exclude)…'`
  · 파일 하나를 되돌리는 `git checkout -- <파일>`
  · `git stash list` 처럼 읽기만 하는 것
  · 환경변수 `SEAGNAL_GIT_GUARD=off` 를 준 경우(사용자가 의도적으로 끌 때만)

[연계] .claude/settings.json 의 PreToolUse 훅으로 등록 · 규칙 원문은 CLAUDE.md
       "★git 명령의 범위" 절 · 되돌리기 도구는 _dashboard/loop/_touched.py
"""
import json, os, re, sys

ADVICE = {
    'add_all': (
        '`git add -A`·`git add .` 는 이 저장소에서 금지다. 다른 에이전트가 동시에 파일을 고치고 있어\n'
        '  남의 미완성 작업까지 커밋에 담긴다(L-171, 실제로 2회 발생).\n'
        '  대신: 경로를 개별 지정하라. 범위를 좁혀야 하면\n'
        '        git add -- <경로> \':(exclude)<남이 쓰는 경로>\''),
    'checkout_dir': (
        '디렉토리째 `git checkout`/`git restore` 는 금지다. 그 안에 남이 방금 끝낸 작업이 있으면\n'
        '  함께 지워진다(L-179, 판독 결과 23장이 실제로 사라졌다).\n'
        '  대신: 되돌릴 파일을 개별 지정하거나,\n'
        '        python3 local_server/knowledge/legal/_dashboard/loop/_touched.py --revert <기록파일>\n'
        '        (파일을 고치는 스크립트가 남긴 "내가 고친 파일 목록"만 되돌린다)'),
    'stash': (
        '`git stash` 는 작업 트리 전체를 치운다 — 다른 에이전트가 쓰던 파일까지 사라진다.\n'
        '  대신: 정말 필요하면 해당 파일만 복사해 두고 진행하라.'),
    'destructive': (
        '되돌릴 수 없는 명령이다. CLAUDE.md 상 사용자 확인이 필요하다.\n'
        '  무엇을 왜 지우려는지 사용자에게 먼저 설명하고 승인을 받아라.'),
    'force_push': (
        'force-push 는 CLAUDE.md 상 사용자 확인이 필요한 작업이다(자율진행 예외 항목).'),
}


def strip_quotes(tok):
    if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in '"\'':
        return tok[1:-1]
    return tok


HEREDOC = re.compile(r"""<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1""")


def strip_heredocs(cmd):
    """heredoc 본문을 판정에서 뺀다.

    커밋 메시지를 `git commit -F - <<'EOF' … EOF` 로 넣을 때, 메시지 안에 적힌
    **설명 문구**(이 훅이 무엇을 막는지 적은 문장 등)를 실행되는 명령으로 오인해
    막는 사고가 있었다 — 이 훅을 처음 켠 날 첫 커밋에서 바로 재현됐고,
    자기 자신을 고치는 명령까지 막혀 편집 도구로 우회해야 했다.
    heredoc 본문은 실행되는 명령이 아니므로 판정 대상에서 뺀다.
    """
    lines = cmd.split('\n')
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        m = HEREDOC.search(line)
        out.append(line)
        i += 1
        if m:
            term = m.group(2)
            while i < len(lines) and lines[i].strip() != term:
                i += 1
            i += 1                      # 종료 표시줄도 건너뛴다
    return '\n'.join(out)


def judge(cmd):
    """명령 문자열을 보고 (사유키, 걸린부분) 또는 None 을 돌려준다."""
    cmd = strip_heredocs(cmd)
    # 세미콜론·&&·파이프로 이어진 각 조각을 따로 본다
    for part in re.split(r'&&|\|\||;|\n', cmd):
        s = part.strip()
        if not re.search(r'(^|\s)git(\s|$)', s):
            continue
        toks = [strip_quotes(t) for t in s.split()]
        try:
            gi = next(i for i, t in enumerate(toks) if t == 'git')
        except StopIteration:
            continue
        args = toks[gi + 1:]
        # `-C <경로>` 같은 전역 옵션 건너뛰기
        while args and args[0].startswith('-'):
            args = args[2:] if args[0] == '-C' else args[1:]
        if not args:
            continue
        sub, rest = args[0], args[1:]

        if sub == 'add':
            if any(a in ('-A', '--all', '.', '-Av', '-vA') for a in rest):
                return 'add_all', s
        elif sub in ('checkout', 'restore'):
            paths = [a for a in rest if not a.startswith('-')]
            if '--' in rest:
                paths = rest[rest.index('--') + 1:]
            for p in paths:
                if p in ('.', './'):
                    return 'checkout_dir', s
                full = p if os.path.isabs(p) else os.path.join(os.getcwd(), p)
                if os.path.isdir(full):
                    return 'checkout_dir', s
        elif sub == 'stash':
            if not rest or rest[0] in ('push', 'save', '--'):
                return 'stash', s
        elif sub == 'reset':
            if '--hard' in rest:
                return 'destructive', s
        elif sub == 'clean':
            if any(a.startswith('-') and 'f' in a for a in rest):
                return 'destructive', s
        elif sub == 'push':
            if any(a in ('--force', '-f') for a in rest):
                return 'force_push', s
    return None


def main():
    if os.environ.get('SEAGNAL_GIT_GUARD') == 'off':
        return
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if payload.get('tool_name') != 'Bash':
        return
    cmd = (payload.get('tool_input') or {}).get('command', '')
    hit = judge(cmd)
    if not hit:
        return
    key, part = hit
    msg = ('[git 범위 가드] 이 명령은 막혔다.\n'
           '  걸린 명령: %s\n\n%s\n\n'
           '  근거: CLAUDE.md "★git 명령의 범위 — 디렉토리째 금지" (사용자 확정 2026-08-23)\n'
           '        교훈 L-171 · L-179 · L-180\n'
           '  사용자가 명시적으로 허용하면 SEAGNAL_GIT_GUARD=off 를 앞에 붙여 실행할 수 있다.'
           % (part[:200], ADVICE[key]))
    print(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': msg,
        }
    }))


if __name__ == '__main__':
    main()
