"""D1 다시 읽기 — 묶음 목록(args JSON)을 박아 넣은 워크플로우 실행 사본을 만든다.

왜: Workflow 는 실행 중에 파일을 못 읽어서 args 를 대화창에 붙여 넣어야 했다(묶음마다 약 5천 자).
    목록을 reread_workflow.js 사본 안에 `const ARGS = …` 로 넣고 사본의 경로만 넘기면 붙여 넣기가 없다.
    사본은 원본과 「args → ARGS 이름」 「목록 줄」 만 다르다(2026-11-03 diff 로 확인).
쓰는 법(저장소 루트에서):
  python3 local_server/knowledge/legal/_dashboard/reread/tools/make_wf.py <plan/D1-Rnn.json> --out <임시폴더>/wf_D1-Rnn.js \
         --tmp <임시폴더> [--repo <저장소 절대경로>] [--date <KST 날짜>]
  → Workflow({scriptPath: '<임시폴더>/wf_D1-Rnn.js'})
[연계] reread_workflow.js(원본) · make_queue.js(목록) · plan/(두 계정 나눠 하기 목록, HANDOFF_D1 §10) · post_batch.py(결과 처리)
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_DEFAULT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', '..'))

ap = argparse.ArgumentParser()
ap.add_argument('plan')
ap.add_argument('--out', required=True)
ap.add_argument('--tmp', required=True, help='지적 JSON 을 쓸 임시 폴더(미리 만든다)')
ap.add_argument('--repo', default=REPO_DEFAULT)
ap.add_argument('--date', default=None)
a = ap.parse_args()

args = json.load(open(a.plan, encoding='utf-8'))
args['repo'] = os.path.abspath(a.repo)
args['tmp'] = os.path.abspath(a.tmp)
if a.date:
    args['date'] = a.date
src = open(os.path.join(HERE, 'reread_workflow.js'), encoding='utf-8').read()
i = src.index('export const meta')
j = src.index('\n}\n', i) + 3
body = re.sub(r'\bargs\.', 'ARGS.', src[j:])
out = (src[:j] + "\n// 묶음별 사본(원본 reread_workflow.js) — args 대신 ARGS · make_wf.py 가 만듦\nconst ARGS = "
       + json.dumps(args, ensure_ascii=False) + ";\n" + body)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
open(a.out, 'w', encoding='utf-8').write(out)
print(f"{args['round']} · {len(args['pages'])}쪽 → {a.out}")
