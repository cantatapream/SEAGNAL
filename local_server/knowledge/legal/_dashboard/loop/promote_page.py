#!/usr/bin/env python3
"""draft → canonical **승격 도구** — 다른 에이전트의 PASS 가 장부에 있을 때만 올린다 (_SCHEMA §5-D ⓔ ⓖ ⓗ).

[왜 있나 — 1단계 1-6, 2026-10-08 사장님 결정 D2·D3]
  3-90~3-92 는 작업 세션의 임시 스크립트로 승격했다. 그 스크립트는 「누가 읽고 PASS 했나」를 보지 않았다.
  옛 승격 워크플로우(auto_promote · draft_reverify · promote_verify)는 폐기했고, 승격은 이 도구 하나로 한다.

[무엇을 하나 — 쪽마다]
  ① 장부(`_dashboard/reread/verdicts.jsonl`)의 마지막 기록이 **PASS · 범위 전체 · 본문해시 = 지금 본문**인지 본다
     (해시는 `reread_ledger.js hash` 로 — JS 와 똑같이 센다). 아니면 **그 쪽은 건드리지 않고** 이유를 낸다.
  ② status: canonical · updated · 배너 머리를 승격 머리로 · 「## 변경 이력」 에 §5-D ⓒ 기록줄 한 줄.
     기록줄에는 `§5-D` `ⓑ` `1차` `2차` `raw/경로` 가 다 든다(V5-13 이 읽는 꼴) · 금지 낱말은 쓰지 않는다.

[쓰는 법]
  python3 promote_page.py <spec.json> --round <회차표시 예: 3-93> [--dry]
    spec: {"<쪽 이름(concepts/ 아래, 확장자 없음)>": ["raw/<도메인>/<법>", "대조한 조문", "대조하지 않은 것"]}
[연계] ← draft_verify1.py(1차) · reread_ledger.js(2차 장부) → promote_guard.js(V5-13) · reread_guard.js(V5-57)
"""
import datetime
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')
LEDGER = os.environ.get('REREAD_LEDGER') or os.path.join(LEGAL, '_dashboard', 'reread', 'verdicts.jsonl')
BANNED = ('REVIEW', '판독', 'OCR', '출처미확인', '출처 미확인', '원본이미지', '[미확인]')


def body_hash(key):
    out = subprocess.run(['node', os.path.join(HERE, 'reread_ledger.js'), 'hash', key],
                         capture_output=True, text=True, check=True).stdout
    return out.split()[0]


def last_row(key):
    last = None
    try:
        for line in open(LEDGER, encoding='utf-8'):
            line = line.strip()
            if line:
                r = json.loads(line)
                if r.get('쪽') == key:
                    last = r
    except FileNotFoundError:
        pass
    return last


def promote(name, rawdir, cmp2, notcmp, rnd, today, dry):
    key = name if name.endswith('.md') else name + '.md'
    if '/' not in key:
        key = 'concepts/' + key
    p = os.path.join(WIKI, key)
    s = open(p, encoding='utf-8').read()
    r = last_row(key)
    h = body_hash(key)
    if not r or r.get('판정') != 'PASS' or r.get('범위') != '전체' or r.get('본문해시') != h:
        why = '장부 기록 없음' if not r else f"마지막 {r.get('판정')}·{r.get('범위')}·해시 {'같음' if r.get('본문해시') == h else '다름'}"
        return False, f'올리지 않음 — {why}'
    fm_end = s.index('\n---\n', 4)
    fm, body = s[:fm_end], s[fm_end:]
    if not re.search(r'^status: draft$', fm, re.M):
        return False, '올리지 않음 — status: draft 가 아니다'
    fm = re.sub(r'^status: draft$', 'status: canonical', fm, flags=re.M)
    fm = re.sub(r'^updated: .*$', f'updated: {today}', fm, flags=re.M)
    fm = re.sub(r'^review_reason:.*\n?', '', fm, flags=re.M)
    head = f'> ✅ **canonical — {today} `_SCHEMA.md` §5-D ⓑ 재점검 1차·2차 통과({rnd}).**'
    body2, n = re.subn(r'^> ⚠️? \*\*draft[^\n]*?\*\*(?:\s*—\s*원문 대조 정정 중\([^)]*\)\.)?', head, body, count=1, flags=re.M)
    if n != 1:
        return False, '올리지 않음 — draft 배너 머리를 못 찾았다'
    reader = r.get('읽은이') or '?'
    row = (f'| {today} | {rnd} — draft → canonical 승급(§5-D). ⓐ 챗봇이 확인 안 된 줄로 밀어내는 줄 0개(`markUnresolvedReview()`) · '
           '대기열에서 안 풀린 확인 항목 없음 · 본문에 그림을 글로 옮긴 표시 없음. ⓑ 1차(기계 대조): `_dashboard/loop/draft_verify1.py` 가 본문의 숫자 값을 '
           f'`{rawdir}/` 와 이 쪽이 「」로 인용한 법의 raw 에서 같은 값으로 찾음 — 전부 있음. 2차(다른 눈): 이 쪽을 만들지도 고치지도 1차를 돌리지도 않은 '
           f'별도 에이전트({reader} · {r.get("회차")}회차 · 장부 `_dashboard/reread/verdicts.jsonl`)가 본문 전체를 조·항·호 단위로 대조 — {cmp2} — 일치. '
           f'대조하지 않은 것: {notcmp} | `{rawdir}/` · `_SCHEMA.md` §5-D |')
    bad = [w for w in BANNED if w in row]
    if bad:
        return False, f'올리지 않음 — 기록줄에 쓰면 안 되는 낱말: {bad}'
    i = body2.index('\n## 변경 이력')
    j = body2.find('\n## ', i + 5)
    sec = body2[i:j] if j > 0 else body2[i:]
    lines = sec.split('\n')
    last = max(k for k, l in enumerate(lines) if l.startswith('| '))
    lines.insert(last + 1, row)
    body2 = body2[:i] + '\n'.join(lines) + (body2[j:] if j > 0 else '')
    if not dry:
        open(p, 'w', encoding='utf-8').write(fm + body2)
    return True, '올림' + (' (시험 — 쓰지 않음)' if dry else '')


def main(argv):
    spec = json.load(open(argv[0], encoding='utf-8'))
    rnd = argv[argv.index('--round') + 1] if '--round' in argv else ''
    if not rnd:
        print('--round 가 없다(예: 3-93)'); return 2
    today = datetime.date.today().isoformat()
    dry = '--dry' in argv
    bad = 0
    for name, (rawdir, cmp2, notcmp) in spec.items():
        okk, msg = promote(name, rawdir, cmp2, notcmp, rnd, today, dry)
        bad += 0 if okk else 1
        print(('✅ ' if okk else '❌ ') + name + ' — ' + msg)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
