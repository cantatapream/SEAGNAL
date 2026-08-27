#!/usr/bin/env python3
"""감사 파일에는 **결함으로 적혀 있는데 백로그에 안 올라온 줄**을 전수로 찾는다.

[왜 있나 — 2026-08-27, 사서 보고로 드러난 사각지대]
자연유산법 사서 보고: 16라운드 자체 재검증이 남긴 미해결 항목들(HH25·39·47·48·59 등)이
**17라운드부터 회귀 검증 범위가 "이번에 새로 바뀐 raw·위키"로 좁혀지면서 4~9라운드 동안 단 한 번도
다시 검증되지 않았다.** 확인해 보니 그 항목들은 감사 파일에 `❌` 로 멀쩡히 적혀 있는데
**백로그 파일에는 한 줄도 없었다**(실측: 5개 ID 전부 0건).

즉 라운드는 백로그만 보고 도는데, 백로그에 안 올라온 결함은 **어느 라운드에도 안 잡힌다.**
백로그가 라운드의 눈인데 그 눈에 안 보이는 자리가 있었다는 뜻이다.

[왜 놓쳤나 — 뽑는 규칙이 낱말에 매여 있다]
`backlog_extract.js` 는 `⚠thin`·`❌missing`·`still_missing` 이라는 **낱말**을 찾는다.
그런데 감사 표에는 판정을 **기호만으로** 적은 줄이 많다:
    | HH25 | P | T4 | 남북 교류 자연유산 사업에 …? | ❌ | 제48조 미반영 |
`❌` 뒤에 `missing` 이 없으니 안 걸린다.

⚠**판정하지 않는다. 대조만 한다.** 두 가지를 빼고 센다(표본을 눈으로 보고 정했다):
  ⓐ 같은 줄에 해소 표시가 있는 것(추출기와 같은 규칙).
  ⓑ **그 뒤 라운드에서 해소된 것** — 감사 파일은 라운드를 아래로 덧붙이므로, 같은 문항번호가
     더 아래에서 `✅ full` 로 바뀌어 있으면 이미 끝난 것이다.
     (실측 반례: 낚시관리및육성법 J6-03 은 1355행에 `❌ missing` 이지만 1614행에서
      `✅ full(상향)` 로 해소됐다. 이걸 안 빼면 오탐이 된다.)
  ⓒ **그 문항번호가 백로그에 이미 있는 것** — 표현이 달라도 라운드가 이미 보고 있다는 뜻이다.
⚠ⓑ에는 한계가 있다. 감사 문항번호는 라운드마다 재사용되기도 해서(사서 보고),
  더 아래의 같은 번호가 **다른 질문**일 수 있다. 그래서 이건 "덜 세는" 쪽 오차다.

[쓰는 법]
  python3 audit_backlog_gap.py                 → 전수 집계 + 법별 상위
  python3 audit_backlog_gap.py --law <이름>     → 한 법만(줄까지 보여 준다)
  python3 audit_backlog_gap.py --json PATH     → 목록 저장
[연계] 읽기 전용 — _dashboard/audit/*.md · _dashboard/backlog/*.md
"""
import os
import re
import sys
import json
import glob
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
AUDIT = os.path.join(LEGAL, '_dashboard', 'audit')
BACKLOG = os.path.join(LEGAL, '_dashboard', 'backlog')

WORD = re.compile(r'⚠\s*thin|❌\s*missing|\bstill_missing\b')
SYMBOL = re.compile(r'[❌⚠]')
RESOLVED = re.compile(r'✅|full\s*전환|해소|해결|완료|무회귀|불필요')
ITEM_ID = re.compile(r'^\|\s*([A-Z]{1,3}\d{1,3}(?:-\d{1,2})?)\s*\|')
NOT_ITEM = re.compile(r'소계|합계|총계|집계|범례')


def norm(s):
    return re.sub(r'\s+', '', re.sub(r'[|`*_>⟨⟩⟪⟫]', '', s))


def backlog_text(slug):
    out = []
    for p in glob.glob(os.path.join(BACKLOG, slug + '.md')) + \
             glob.glob(os.path.join(BACKLOG, slug + '_*.md')):
        try:
            out.append(open(p, encoding='utf-8').read())
        except Exception:
            pass
    return norm('\n'.join(out))


RESOLVED_LATER = re.compile(r'✅')


def main():
    argv = sys.argv[1:]
    only = argv[argv.index('--law') + 1] if '--law' in argv else None
    out_path = argv[argv.index('--json') + 1] if '--json' in argv else None

    by_law = collections.defaultdict(list)
    for p in sorted(glob.glob(os.path.join(AUDIT, '*.md'))):
        slug = os.path.basename(p)[:-3]
        if only and only not in slug:
            continue
        bl = backlog_text(slug)
        if not bl:
            continue
        lines = open(p, encoding='utf-8').read().split('\n')
        # 문항번호별로 **해소 표시가 붙은 마지막 줄 번호**를 미리 모은다(ⓑ).
        solved_at = {}
        for j, ln in enumerate(lines, 1):
            m = ITEM_ID.match(ln)
            if m and RESOLVED_LATER.search(ln):
                solved_at[m.group(1)] = max(solved_at.get(m.group(1), 0), j)
        for i, ln in enumerate(lines, 1):
            m = ITEM_ID.match(ln)
            if not m or NOT_ITEM.search(ln):
                continue
            has_word = bool(WORD.search(ln))
            has_sym = bool(SYMBOL.search(ln))
            if not (has_word or has_sym):
                continue
            if RESOLVED.search(ln):
                continue
            if solved_at.get(m.group(1), 0) > i:
                continue                      # ⓑ 뒤 라운드에서 해소됐다
            if re.search(r'(?<![A-Za-z0-9])%s(?![0-9])' % re.escape(m.group(1)), bl):
                continue                      # ⓒ 그 문항번호가 백로그에 이미 있다
            head = norm(ln)[:60]
            if head and head in bl:
                continue
            by_law[slug].append({'id': m.group(1), 'line_no': i,
                                 'only_symbol': not has_word,
                                 'line': ln.strip()[:180]})

    total = sum(len(v) for v in by_law.values())
    sym_only = sum(1 for v in by_law.values() for x in v if x['only_symbol'])
    print('■ 감사에는 결함으로 적혀 있는데 **백로그에 안 올라온 줄** — 대조 결과(판정 아님)')
    print('   후보 %d건 · 법 %d개' % (total, len(by_law)))
    print('   그중 판정을 **기호(❌·⚠)로만** 적어 추출기가 못 걸렀을 줄: %d건' % sym_only)
    print('   ⚠전부 진짜 미해소라는 뜻이 아니다 — 사람이 보고 정한다.')
    if by_law:
        print('\n   많은 법 상위 15')
        for law, v in sorted(by_law.items(), key=lambda x: -len(x[1]))[:15]:
            s = sum(1 for x in v if x['only_symbol'])
            print('     %4d건 (기호만 %3d)  %s' % (len(v), s, law[:50]))
    if only and by_law:
        print()
        for law, v in by_law.items():
            for x in v[:40]:
                print('   %s:%d  %s' % (law[:20], x['line_no'], x['line'][:150]))
    if out_path:
        json.dump({'total': total, 'symbol_only': sym_only, 'by_law': dict(by_law)},
                  open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n   저장: %s' % out_path)


main()
