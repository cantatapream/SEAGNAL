#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""개정검토 큐의 승인 건을 **「위키 반영 완료」 장부**에 적는다.

[왜 있나 — 2026-11-07 사장님 「승인분 지시문이 이미 반영한 것까지 다시 묶는 문제 고치기 … 진행하기로 해」]
관리자 화면 개정검토 방의 「📋 승인분 전체 지시문」 은 **승인한 전 건**을 매번 다시 묶었다.
승인이 마지막 상태라 「위키에 반영했다」를 적을 자리가 없었고, 작업 세션은 운영 볼륨의 큐를 고칠 수 없다.
그래서 11-02·11-03 에 이미 반영한 162건이 11-06 지시문에 그대로 다시 왔다(재대조 결과 새로 할 일 0).
→ 작업 세션이 반영을 끝낸 큐 id 를 **저장소 안 장부**에 적어 커밋하고, 배포된 서버가 그 장부를 읽어
  다음 지시문에서 빼고 카드에 「위키 반영 완료」를 붙인다(services/legal_amendment_scanner.js loadWikiApplied).

[무엇을 하나]
  장부 `_amendments/wiki_applied.jsonl` 에 한 줄씩 `{"id","at","by","note"}` 를 **덧붙인다**(지우거나 고치지 않는다).
  이미 적힌 id 는 다시 적지 않고 「이미 있음」 으로 센다.

[연계]
  - 읽음: 인계문 끝 수집 목록(`<!-- collect-manifest:start -->`) — collect_approved.read_brief 를 그대로 쓴다
  - 씀:   local_server/knowledge/legal/_amendments/wiki_applied.jsonl (덧붙이기만)
  - 읽는 쪽: services/legal_amendment_scanner.js loadWikiApplied → routes/legal.js(wiki-brief-all · 카드)
  - 검사: local_server/scripts/test_amend_applied.js

사용법:
  python3 amend_applied.py --from-brief <인계문을 저장한 파일> --note "무엇을 했나"   ← 그 글의 전 건
  python3 amend_applied.py --ids chg_…,chg_… --note "무엇을 했나"                     ← 끝낸 건만
  python3 amend_applied.py --list                                                     ← 장부에 몇 건 있나
  공통: --by <누가>(기본 「작업 세션」) · --dry(쓰지 않고 무엇을 적을지만 보인다)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
LEDGER = os.path.join(LEGAL, '_amendments', 'wiki_applied.jsonl')
# 큐 id 꼴(legal_amendment_scanner 가 만든다). 꼴이 다른 것은 받지 않는다 — 오타가 장부에 남으면 아무것도 안 뺀다.
ID_RE = re.compile(r'^chg_\d{8}_[0-9a-f]{6}$')


def today_kst():
    """오늘 날짜(KST) `YYYY-MM-DD`."""
    out = subprocess.run(['date', '-u', '-d', '+9 hours', '+%Y-%m-%d'], capture_output=True, text=True).stdout.strip()
    return out or '(날짜미상)'


def load(path=LEDGER):
    """장부의 id 집합. 파일이 없으면 빈 집합. 깨진 줄은 건너뛴다(서버 loadWikiApplied 와 같은 규칙).
    예: load() → {'chg_20260810_a5f82d', …}"""
    ids = set()
    if not os.path.exists(path):
        return ids
    for line in open(path, encoding='utf-8'):
        t = line.strip()
        if not t:
            continue
        try:
            o = json.loads(t)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get('id'):
            ids.add(str(o['id']))
    return ids


def ids_from_brief(path):
    """인계문 파일의 수집 목록에서 큐 id 들을 꺼낸다(순서 유지).
    @returns list[str]  [연계] → collect_approved.read_brief(같은 칸을 읽는다)"""
    sys.path.insert(0, HERE)
    from collect_approved import read_brief
    return [str(it.get('id')) for it in read_brief(path) if it.get('id')]


def add(ids, note, by='작업 세션', path=LEDGER, dry=False, at=None):
    """장부에 덧붙인다 → {'적음': [...], '이미있음': [...], '꼴이다름': [...]}
    예: add(['chg_20260810_a5f82d'], '3-94 반영') → {'적음': ['chg_20260810_a5f82d'], ...}"""
    have = load(path)
    rep = {'적음': [], '이미있음': [], '꼴이다름': []}
    lines = []
    seen = set()
    for i in ids:
        i = str(i).strip()
        if not i or i in seen:
            continue
        seen.add(i)
        if not ID_RE.match(i):
            rep['꼴이다름'].append(i)
            continue
        if i in have:
            rep['이미있음'].append(i)
            continue
        rep['적음'].append(i)
        lines.append(json.dumps({'id': i, 'at': at or today_kst(), 'by': by, 'note': note}, ensure_ascii=False))
    if lines and not dry:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        need_nl = os.path.exists(path) and os.path.getsize(path) > 0 and not open(path, 'rb').read()[-1:] == b'\n'
        with open(path, 'a', encoding='utf-8') as f:
            if need_nl:
                f.write('\n')
            f.write('\n'.join(lines) + '\n')
    return rep


def main(argv):
    def arg(name):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None
    if '--list' in argv:
        print('장부 %s — %d건' % (os.path.relpath(LEDGER), len(load())))
        return 0
    ids = []
    if arg('--from-brief'):
        ids += ids_from_brief(arg('--from-brief'))
    if arg('--ids'):
        ids += [x for x in arg('--ids').split(',') if x.strip()]
    note = arg('--note')
    if not ids:
        print('적을 id 가 없다 — --from-brief <파일> 또는 --ids chg_…,chg_… 를 준다.')
        return 2
    if not note:
        # 무엇을 했는지 없는 기록은 나중에 근거가 못 된다 — 받지 않는다.
        print('--note "무엇을 했나" 가 필요하다(근거 없는 기록을 남기지 않는다).')
        return 2
    rep = add(ids, note, by=arg('--by') or '작업 세션', dry='--dry' in argv)
    for k, v in rep.items():
        print('%s: %d건%s' % (k, len(v), (' — ' + ', '.join(v[:5]) + (' …' if len(v) > 5 else '')) if v and k != '적음' else ''))
    if '--dry' in argv:
        print('(--dry — 쓰지 않았다)')
    return 1 if rep['꼴이다름'] else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
