#!/usr/bin/env python3
"""표기 통일(cfix_workflow.js) 결과 처리 — 되돌림 · 결과 기록 · 요약.

[무엇을 하나]
  ① final == HOLD_REVERT(바뀐 부분 읽기 3번 안에 통과 못 함) 또는 ERROR 인데 쪽이 바뀌어 있으면 → 그 쪽 **파일 하나**를 기준 커밋으로 되돌린다
     (canonical 쪽을 다른 눈이 통과시키지 않은 채로 두지 않는다 — V5-57). 디렉토리째 되돌리지 않는다(_RULES §4).
  ② 쪽마다 결과를 `_dashboard/reread/c_fix.jsonl` 에 한 줄씩 적는다(고친 것·이미 고쳐져 있던 것·되돌린 까닭).
[쓰는 법] python3 post_cfix.py <워크플로우 출력 파일> --base <기준 커밋> [--dry]
[연계] ← cfix_workflow.js · make_cfix.py
"""
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REREAD = os.path.normpath(os.path.join(HERE, '..'))
LEGAL = os.path.normpath(os.path.join(REREAD, '..', '..'))
REPO = os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))
LOG = os.path.join(REREAD, 'c_fix.jsonl')

argv = sys.argv[1:]
res = json.load(open(argv[0], encoding='utf-8'))
if isinstance(res, dict) and 'result' in res:
    res = res['result']
    if isinstance(res, str):
        res = json.loads(res)
base = argv[argv.index('--base') + 1]
dry = '--dry' in argv
items = res['pages'] if isinstance(res, dict) else res


def changed(rel):
    return subprocess.run(['git', 'diff', '--quiet', base, '--', rel], cwd=REPO).returncode == 1


now = datetime.datetime.now(datetime.timezone.utc).isoformat()
count, reverted = {}, []
with open(LOG, 'a', encoding='utf-8') as log:
    for it in items:
        if not it:
            continue
        rel = f'local_server/knowledge/legal/wiki/{it["file"]}.md'
        fin = it.get('final', 'ERROR')
        if fin in ('HOLD_REVERT', 'ERROR') and changed(rel):
            if not dry:
                subprocess.run(['git', 'checkout', base, '--', rel], cwd=REPO, check=True)
            reverted.append((it['file'], fin))
            fin = fin + '→되돌림'
        count[fin] = count.get(fin, 0) + 1
        row = {'시각': now, '쪽': it['file'] + '.md', '결과': fin, '고침': len(it.get('fixed', [])),
               '이미': len(it.get('already', [])), '거절': len(it.get('rejected', [])), '읽은이': it.get('readers', []),
               '거절_까닭': [r.get('reason', '')[:200] for r in it.get('rejected', [])][:10],
               '남은_AB': [f.get('what', '')[:200] for f in it.get('last_findings', [])][:5], '메모': it.get('note', '')}
        if not dry:
            log.write(json.dumps(row, ensure_ascii=False) + '\n')
print(json.dumps(count, ensure_ascii=False))
for f, why in reverted:
    print(f'되돌림({why}): {f}')
