#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/unreachable_article_guard.py
# 역할: **파일에는 있는데 챗봇이 영영 못 읽는 조문**을 센다(V5-17). 네트워크를 안 쓴다.
# ============================================================================
#
# [왜 있나 — 2026-09-21]
#   챗봇은 계층 원문을 **정해진 이름으로만** 찾는다(`services/article_text.js`) —
#       `법률.txt` → `법률_발췌.txt` (시행령·시행규칙도 같은 꼴, 대통령령은 `대통령령.txt`)
#   그런데 사서들은 필요할 때 `법률_수입제한조문(연결조문).txt` · `법률_연결조문만.txt` 처럼
#   **뜻이 담긴 이름**으로 저장해 왔다(실측 53개). 그 파일은 **아무리 잘 받아 놔도 안 열린다.**
#   ★실제로 「대외무역법」 제5조·제11조·제40조가 그랬다 — 위키가 제5조·제11조를 네 군데서
#   인용하는데 `법률.txt` 에는 제33조·제33조의2·제39조뿐이라 **"그 조 없음"으로 죽고 있었다.**
#   받아 놓고도 못 쓰는 것이 **안 받은 것보다 나쁘다** — 수집 기록만 보면 있다고 나오니까.
#
# [무엇을 세나]
#   한 법 폴더의 한 계층에서, **읽히는 파일에는 없고 안 읽히는 형제 파일에만 있는 조**.
#   · 읽히는 이름이 하나도 없으면 센다(그 계층이 통째로 안 열린다).
#   · `_구판/`·`_대기/`·별표·서식 파일은 뺀다(보존본·다른 경로로 열리는 것).
#
# [고치는 법]
#   그 조를 **읽히는 파일로 옮겨 적는다**(새로 받는 것이 아니다 — 이미 우리 손에 있다).
#   옮긴 뒤 원본 파일 머리에 "옮겨 적었다 · 다시 합치지 말 것"을 적어 둔다.
#   ⚠파일을 지우지 않는다 — 수집 경위가 거기 적혀 있다.
#
# [쓰는 법]
#   python3 _dashboard/loop/unreachable_article_guard.py [--examples]
#   python3 _dashboard/loop/unreachable_article_guard.py --base <json> --gate
#   python3 _dashboard/loop/unreachable_article_guard.py --save <json>
#
# [연계] ← services/article_text.js 의 TIER_FILE·TIER_FILE_ALT 순서를 그대로 따라 적었다.
#        → scripts/refactor/verify_all.sh V5-17
# ============================================================================
import json
import os
import re
import sys

LEGAL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(LEGAL, 'raw')
argv = sys.argv[1:]


def arg(k):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else ''


# ★`article_text.js` 가 찾는 이름 그대로다. 여기를 고칠 때는 그쪽도 같이 본다.
READABLE = {
    '법률': ('법률.txt', '법률_발췌.txt'),
    '시행령': ('시행령.txt', '시행령_발췌.txt', '대통령령.txt', '대통령령_발췌.txt'),
    '시행규칙': ('시행규칙.txt', '시행규칙_발췌.txt'),
}
HEAD = re.compile(r'^\[(제\d+조(?:의\d+)?)\]', re.M)
SKIP_IN_NAME = ('별표', '서식', '별지', '_구판')

# ★**다른 폴더에 정식 사본이 있으면 읽힌다** — 그것까지 봐야 한다(2026-09-21, 첫 판에서 놓쳤다).
#   「해양경찰위원회 규정」은 `해양경찰법/시행령_해양경찰위원회규정.txt` 에도 있지만
#   `15_관련타부처/해양경찰위원회규정/법률_발췌.txt` 에 정식 사본이 있고 지도에도 올라 있다.
#   챗봇은 **지도(`law_raw_paths.json`) → 그 폴더의 읽히는 이름** 으로 찾으므로 잘 열린다.
#   그 확인을 빼먹으면 멀쩡한 것을 결함이라 부른다 — 첫 실행에서 3건 중 2건이 그랬다.
_SQ = re.compile(r'[「」『』()（）·ㆍ・,.\s-]')


def squash(s):
    return _SQ.sub('', str(s or ''))


try:
    _MAP = json.load(open(os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json'), encoding='utf-8'))
except Exception:
    _MAP = {}
_MAP_SQ = {squash(k): v for k, v in _MAP.items()}
_REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))


def arts_in_mapped_folder(stem):
    """파일 이름 뒤쪽(`시행령_<여기>.txt`)이 지도에 있는 법이면, **그 폴더의 읽히는 파일**에
    들어 있는 조를 준다. 지도에 없으면 빈 집합."""
    rel = _MAP_SQ.get(squash(stem))
    if not rel:
        return set()
    d = os.path.join(_REPO, rel)
    got = set()
    for group in READABLE.values():
        for n in group:
            fp = os.path.join(d, n)
            if os.path.exists(fp):
                try:
                    got |= set(HEAD.findall(open(fp, encoding='utf-8').read()))
                except Exception:
                    pass
    return got

rows = []
for base, dirs, names in os.walk(RAW):
    if os.sep + '_구판' + os.sep in base + os.sep or os.sep + '_대기' + os.sep in base + os.sep:
        continue
    if os.path.basename(base) in ('행정규칙', '별표', '_이미지', '_원본첨부'):
        continue
    txts = [n for n in names if n.endswith('.txt')]
    if not txts:
        continue
    for tier, reads in READABLE.items():
        vis_files = [n for n in txts if n in reads]
        others = [n for n in txts
                  if n.startswith(tier + '_') and n not in reads
                  and not any(s in n for s in SKIP_IN_NAME)]
        if not others:
            continue
        seen = set()
        for n in vis_files:
            try:
                seen |= set(HEAD.findall(open(os.path.join(base, n), encoding='utf-8').read()))
            except Exception:
                pass
        for n in others:
            try:
                hid = set(HEAD.findall(open(os.path.join(base, n), encoding='utf-8').read()))
            except Exception:
                continue
            stem = n[len(tier) + 1:-4]          # `시행령_해양경찰위원회규정.txt` → 해양경찰위원회규정
            elsewhere = arts_in_mapped_folder(stem)
            only = sorted(hid - seen - elsewhere, key=lambda s: int(re.findall(r'\d+', s)[0]))
            if only:
                rows.append({'file': os.path.relpath(os.path.join(base, n), LEGAL),
                             'arts': only,
                             'reads': vis_files or ['(그 계층에 읽히는 파일이 없다)']})

rows.sort(key=lambda r: -len(r['arts']))
now = {'files': len(rows), 'arts': sum(len(r['arts']) for r in rows)}
base_j = {}
if arg('--base') and os.path.exists(arg('--base')):
    base_j = json.load(open(arg('--base'), encoding='utf-8'))


def delta(k):
    if k not in base_j:
        return ''
    d = now[k] - base_j[k]
    return '' if d == 0 else '  (%+d)' % d


print('■ 파일에는 있는데 **챗봇이 못 읽는** 조문 (이름이 달라 안 열린다)')
print('   %s 파일 %d개%s · 조 %d개%s'
      % ('❌' if rows else '✅', now['files'], delta('files'), now['arts'], delta('arts')))
if rows and '--examples' in argv:
    for r in rows[:25]:
        print('      %s' % r['file'])
        print('         못 읽는 조: %s' % ', '.join(r['arts'][:10]))
        print('         읽히는 파일: %s' % ', '.join(r['reads']))
if rows:
    print('   고치는 법: 그 조를 **읽히는 이름의 파일로 옮겨 적는다**(새로 받는 것이 아니다).')
if arg('--save'):
    json.dump(dict(now, examples=rows[:40]), open(arg('--save'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n스냅샷 저장: %s' % arg('--save'))
if '--gate' in argv:
    if now['arts'] or now['files']:
        print('\n  ❌ 받아 놓고도 못 읽는 조문이 있습니다 — 0 이어야 합니다.')
        sys.exit(1)
    print('\n  ✅ 0')
