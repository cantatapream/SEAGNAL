#!/usr/bin/env python3
"""guard-git-scope.py 가 의도대로 갈리는지 시험한다."""
import json, subprocess

A = 'git ' + 'add'
CO = 'git ' + 'checkout'
cases = [
    (A + ' -A', '차단'),
    (A + ' .', '차단'),
    (A + ' local_server/x.md', '통과'),
    (CO + ' -- CLAUDE.md', '통과'),
    (CO + ' -- local_server/knowledge/legal/raw', '차단'),
    ('git ' + 'stash', '차단'),
    ('git ' + 'stash list', '통과'),
    ('git ' + 'reset --hard HEAD', '차단'),
    ('git ' + 'push --force origin main', '차단'),
    ('git status', '통과'),
    # heredoc 본문 안의 설명 문구는 명령이 아니다
    ("git commit -F - <<'EOF'\n설명: " + A + " -A 는 금지다\nEOF", '통과'),
    # heredoc 이 끝난 뒤의 진짜 명령은 잡아야 한다
    ("git commit -F - <<'EOF'\n메시지\nEOF\n" + A + " -A", '차단'),
]
ok = True
for cmd, exp in cases:
    r = subprocess.run(['python3', '/home/user/SEAGNAL/.claude/hooks/guard-git-scope.py'],
                       input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': cmd}}),
                       capture_output=True, text=True)
    got = '차단' if r.stdout.strip() else '통과'
    mark = 'OK ' if got == exp else '✗  '
    if got != exp:
        ok = False
    print('%s %-44s 기대 %s / 실제 %s' % (mark, cmd.replace('\n', ' ⏎ ')[:44], exp, got))
print('\n전부 의도대로 동작' if ok else '\n★불일치 있음')
