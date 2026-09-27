#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`_구판/` 옛 판 파일에 **「이것은 현행이 아니다」 경고**가 붙어 있는지 지키고, 빠진 곳을 채운다.
선언: `_dashboard/gupan_notice.json`

[왜]
  옛 판은 지우지 않고 `_구판/` 에 남기는 것이 저장소 규약이다(L-244). 그런데 **경고가 없으면
  LLM 은 그것을 현행으로 읽는다.** 항만시설 운영세칙은 요율·감면율을 담고 있어 **틀린 금액이 나간다.**

[★무엇이 이 자를 만들게 했나 — 2026-09-27 실측]
  같은 구판의 **형제 사본 두 쪽 중 한 쪽에만** 경고가 있었다
  (무역항 등의 항만시설 사용 및 사용료에 관한 규정 — 항만법 쪽엔 2026-09-03 부터, 항로표지법 쪽엔 없음).
  **한쪽에만 붙은 경고는 없는 것과 같다.**

[⚠자를 두 번 고쳤다 — 두 번 다 내가 틀렸다]
  ①처음엔 `옛 판` 한 낱말만 찾아 「21개 중 16개가 없다」고 셌다. 폐지본은 `⛔…폐지됐다`,
    신구조문대비표는 `⚠…현행 원문이 아니다` 로 적혀 있었다. 진짜 없는 것은 **9개**였다.
  ②형제의 ID 를 아무 `ID:` 나 집었더니, 사본 동기화 안내문 속 산문 `(ID 2100000185871)이었다` 가
    걸려 **현행판을 구판으로 오판**했다. ⇒ **줄머리의 `ID:` 만** 본다.

[쓰기 전에 증명한다 — 하나라도 못 대면 쓰지 않는다(G-34)]
  ①형제 현행판 파일이 있다  ②그 ID 가 구판 ID 와 다르다  ③창구가 구판 N · 형제 Y 라고 말한다
  ⇒ **아는 사실만 적는다.** 폐기 까닭 같은 것은 모르면 안 적는다.

쓰는 법:
    python3 _dashboard/loop/gupan_notice.py            # 재기만 한다(망을 쓴다)
    python3 _dashboard/loop/gupan_notice.py --apply    # 증명을 넘은 것만 쓴다
    python3 _dashboard/loop/gupan_notice.py --gate     # ★망 없이 머리글만 본다 (V5-53)
    python3 _dashboard/loop/gupan_notice.py --update   # 기준선을 다시 굽는다

[연계] ← `_dashboard/gupan_notice.json`(선언·기준선) → `raw/**/_구판/*.txt` · `_touched.py` · 게이트 V5-53
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                        # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
DECL = os.path.join(LEGAL, '_dashboard', 'gupan_notice.json')
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
APPLY = '--apply' in sys.argv
GATE = '--gate' in sys.argv
UPDATE = '--update' in sys.argv

decl = json.load(open(DECL, encoding='utf-8'))
표식 = decl['★경고로 인정하는 말 (머리 12줄 안)']['낱말']


def 머리글(p, n=12):
    with open(p, encoding='utf-8') as f:
        return ''.join([next(f, '') for _ in range(n)])


def 경고있나(p):
    h = 머리글(p)
    return any(w in h for w in 표식)


def 구판들():
    out = []
    for d, _, fs in os.walk(RAW):
        if os.path.basename(d) != '_구판':
            continue
        for f in sorted(fs):
            if f.endswith('.txt'):
                out.append(os.path.join(d, f))
    return sorted(out)


def 받기(url):
    for 판 in range(4):
        r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                            '--retry-delay', '2', '-m', '60', url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith('{'):
            try:
                return json.loads(r.stdout)
            except Exception:
                pass
        time.sleep(2 ** 판)
    return None


def 창구(ID):
    d = 받기('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=admrul&ID=%s&type=JSON' % (OC, ID))
    if not d:
        return None
    return (d.get('AdmRulService') or d).get('행정규칙기본정보') or {}


def 줄머리ID(p):
    """★**줄머리의 `ID:` 만** 본다 — 산문 속 `(ID …)이었다` 를 집으면 현행판을 구판으로 오판한다."""
    for l in 머리글(p, 24).split('\n'):
        m = re.match(r'\s*ID\s*:?\s*(\d{6,})', l)
        if m:
            return m.group(1)
    return None


def 형제찾기(p):
    f = os.path.basename(p)
    본 = re.sub(r'_구판(?:_[^_]*)?_ID\d+\.txt$', '', f)
    본 = re.sub(r'_구판.*\.txt$', '', 본) if 본.endswith('.txt') else 본
    형제 = os.path.join(os.path.dirname(os.path.dirname(p)), 본 + '.txt')
    return 본, (형제 if os.path.exists(형제) else None)


def main():
    전부 = 구판들()
    빈것 = [p for p in 전부 if not 경고있나(p)]

    if GATE or UPDATE:
        기준 = (decl.get('기준선') or {}).get('경고없음', 0)
        print('  `_구판/` 파일 %d개 — 경고 있다 %d · **없다 %d** (기준선 %d)'
              % (len(전부), len(전부) - len(빈것), len(빈것), 기준))
        for p in 빈것:
            print('     ❌ %s' % os.path.relpath(p, LEGAL))
        if UPDATE:
            decl['기준선'] = {'경고없음': len(빈것)}
            json.dump(decl, open(DECL, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print('  기준선을 다시 구웠다 — 경고없음 %d' % len(빈것))
            return 0
        if len(빈것) > 기준:
            print('  ❌ V5-53: 경고 없는 옛 판 파일이 늘었다 %d → %d' % (기준, len(빈것)))
            return 1
        if len(빈것) < 기준:
            print('  ✅ 줄었다 %d → %d — `--update` 로 잠근다' % (기준, len(빈것)))
            return 0
        print('  ✅ V5-53 경고 없는 옛 판 파일 %d (기준선 %d)' % (len(빈것), 기준))
        return 0

    touched = Touched('gupan_notice') if APPLY else None
    한것, 막힌것 = 0, 0
    print('  ── 옛 판 경고를 채운다 (%s) ── 대상 %d쪽'
          % ('실제로 쓴다' if APPLY else '마른 실행 · 쓰지 않는다', len(빈것)))
    for p in 빈것:
        rel = os.path.relpath(p, LEGAL)
        구판ID = (re.search(r'_ID(\d+)\.txt$', p) or [None, None])[1]
        본, 형제 = 형제찾기(p)
        막힘 = []
        if not 구판ID:
            막힘.append('파일 이름에 `_ID…` 가 없다')
        if not 형제:
            막힘.append('형제 현행판 파일이 없다 (`../%s.txt`)' % 본)
        현ID = 줄머리ID(형제) if 형제 else None
        if 형제 and not 현ID:
            막힘.append('형제 머리에서 줄머리 `ID:` 를 못 찾았다')
        if 구판ID and 현ID and 구판ID == 현ID:
            막힘.append('형제의 ID 가 구판과 같다 — 둘 중 하나가 낡았다(사람이 본다)')
        구b = 창구(구판ID) if (구판ID and not 막힘) else None
        현b = 창구(현ID) if (현ID and not 막힘) else None
        if not 막힘:
            if 구b is None or 현b is None:
                막힘.append('창구가 답을 안 줬다 — 다시 물어라')
            else:
                if str(구b.get('현행여부')) != 'N':
                    막힘.append('창구가 구판을 현행여부 %s 라고 한다 — 옛 판이 아닐 수 있다' % 구b.get('현행여부'))
                if str(현b.get('현행여부')) != 'Y':
                    막힘.append('창구가 형제를 현행여부 %s 라고 한다' % 현b.get('현행여부'))
        if 막힘:
            print('  ❌ %s\n       %s' % (rel, ' / '.join(막힘)))
            막힌것 += 1
            continue

        문구 = (
            '⚠**이 파일은 옛 판이다 — 현행이 아니다(%s 확인, L-244).**\n'
            '  ID %s — %s «%s» (발령 %s · 시행 %s). **국가법령정보센터 현행여부 = N** 이다.\n'
            '  현행판은 ID %s (발령 %s · 시행 %s · 현행여부 Y)이고 전문은\n'
            '  `../%s.txt` 에 있다.\n'
            '  ⚠이 파일의 수치를 현행처럼 인용하면 **틀린 값이 나간다** — 운영세칙·사용료 고시는 요율을 담는다.\n'
            '  ★위 세 줄은 **창구에 물어 적은 것**이다(구판 N · 현행판 Y). 폐기 까닭처럼 모르는 것은 적지 않았다.\n'
            '\n'
            % (time.strftime('%Y-%m-%d'), 구판ID, 구b.get('제개정구분명') or '', 구b.get('행정규칙명') or 본,
               구b.get('발령번호') or '?', 구b.get('시행일자') or '?',
               현ID, 현b.get('발령번호') or '?', 현b.get('시행일자') or '?', 본))
        print('  ✅ %s\n       구판 %s(시행 %s · N) → 현행 %s(시행 %s · Y)'
              % (rel, 구판ID, 구b.get('시행일자'), 현ID, 현b.get('시행일자')))
        if APPLY:
            옛 = open(p, encoding='utf-8').read()
            open(p, 'w', encoding='utf-8').write(문구 + 옛)
            touched.add(p)
            if open(p, encoding='utf-8').read() != 문구 + 옛:
                print('       ❌ 쓴 뒤 확인 — 디스크 글이 다르다')
                막힌것 += 1
                continue
            한것 += 1

    print('\n  통과 %d · 막힌 것 %d' % (한것 if APPLY else (len(빈것) - 막힌것), 막힌것))
    if APPLY and touched:
        touched.save()
    return 0 if not 막힌것 else 1


if __name__ == '__main__':
    sys.exit(main())
