#!/usr/bin/env python3
"""표기 통일(c_list) 묶음 만들기 — HANDOFF_D1 §10-9 순서 5 · §10-10 방법.

[무엇을 하나]
  `_dashboard/reread/c_list.md` 의 C 지적(「- 」 줄)을 **쪽마다** 모은다(같은 쪽이 여러 라운드 절에 나오므로 합친다).
  위키에 실제로 있는 쪽만 남기고, 이름순으로 25쪽씩 묶어 `plan/C1-Rnn.json` 을 쓴다.
  `--extra <쪽 목록 파일>` 로 지적이 없어도 넣을 쪽(예: 표준 절 이름 꼬리표를 고친 쪽)을 더한다 — 그 쪽은 바뀐 부분 읽기가 필요하다.

[쓰는 법]
  python3 make_cfix.py --base <비교 기준 커밋> --tmp <scratchpad 폴더> [--extra <쪽 목록 파일>] [--size 25]
  → plan/C1-R01.json … (cfix_workflow.js 의 args 꼴)

[연계] → tools/cfix_workflow.js(고침 + 바뀐 부분 다시 읽기) → tools/post_cfix.py(되돌림·기록)
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REREAD = os.path.normpath(os.path.join(HERE, '..'))
LEGAL = os.path.normpath(os.path.join(REREAD, '..', '..'))
REPO = os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))


def parse_clist(path):
    """c_list.md → {쪽 경로(wiki/ 아래, .md 포함): [지적 문장, …]} (같은 문장은 한 번만)."""
    out, cur = {}, None
    for line in open(path, encoding='utf-8'):
        m = re.match(r'^## (\S+\.md)', line)
        if m:
            cur = m.group(1)
            out.setdefault(cur, [])
            continue
        if line.startswith('## '):
            cur = None
            continue
        if cur and line.startswith('- '):
            t = line[2:].strip()
            if t and t not in out[cur]:
                out[cur].append(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--tmp', required=True)
    ap.add_argument('--extra')
    ap.add_argument('--size', type=int, default=25)
    ap.add_argument('--date', default='2026-11-08')
    a = ap.parse_args()
    items = parse_clist(os.path.join(REREAD, 'c_list.md'))
    if a.extra:
        for line in open(a.extra, encoding='utf-8'):
            k = line.strip()
            if k:
                items.setdefault(k, [])
    pages, missing = [], []
    for k in sorted(items):
        if os.path.exists(os.path.join(LEGAL, 'wiki', k)):
            pages.append({'f': k[:-3], 'items': items[k]})
        else:
            missing.append(k)
    n = 0
    for i in range(0, len(pages), a.size):
        n += 1
        plan = {'repo': REPO, 'round': f'C1-R{n:02d}', 'date': a.date, 'tmp': a.tmp, 'base': a.base,
                'model': 'sonnet', 'effort': 'medium', 'pages': pages[i:i + a.size]}
        json.dump(plan, open(os.path.join(REREAD, 'plan', f'C1-R{n:02d}.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
    print(f'쪽 {len(pages)} · 지적 {sum(len(p["items"]) for p in pages)} · 지적 없는 추가 쪽 '
          f'{sum(1 for p in pages if not p["items"])} · 묶음 {n} · 위키에 없는 쪽 {len(missing)}')
    for k in missing:
        print('  위키에 없음:', k)


if __name__ == '__main__':
    main()
