# -*- coding: utf-8 -*-
"""`_meta.json` 의 `tier`(1군·2군·3군)를 규약대로 채운다. (3-1)

왜 만드나 — 뿌리 사슬 ①·② 바로 그것이다
  「1군·2군·3군」 판정 규칙은 `_SCHEMA.md` 에 **2026-07-16 부터 글로 있었다.**
  그런데 **그것을 읽는 코드가 없었다.** `collect_eval.js`·`tier1_outside_gate.js`·
  `build_inspection_cycle_table.py` 는 `meta.tier` 를 **읽기만** 하고 아무도 안 채웠다.
  그래서 **516개 꼬리표 중 406개에 `tier` 가 없다.**

  ⇒ 규칙을 `_dashboard/tier_rules.json` **한 곳**에 두고, 이 도구가 **그것을 읽어** 채운다.
    (`review_queue_rules.json` 과 같은 꼴 — 세는 법·고르는 법은 한 집에 둔다.)

무엇을 안 하나 (★기계가 고르지 않는다 · G-34)
  · `/_대기/` 아래는 **다음 판을 받아 둔 자리**라 법 폴더가 아니다 — 건너뛴다.
  · **이중 폴더** — `15_관련타부처` 에 있으면서 기준법 도메인에도 같은 이름이 있는 것은
    어느 쪽이 참인지 **사람이 정한다**(3-11). 건드리지 않고 목록만 낸다.
  · 이미 `tier` 가 있는 것은 **덮지 않는다.**

[연계] ← `_dashboard/tier_rules.json`(규칙) · → `raw/**/_meta.json` 의 `tier` · 읽는 곳 `collect_eval.js`·V5-25
사용법: python3 tier_fill.py [--apply]
"""
import os, re, sys, json, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
from _touched import Touched                                      # noqa: E402

RULES = json.load(open(os.path.join(LEGAL, '_dashboard', 'tier_rules.json'), encoding='utf-8'))


def flat(s):
    return re.sub(r'\s|·|ㆍ', '', unicodedata.normalize('NFC', str(s)))


def base_names():
    """기준법 도메인(raw/01_*~14_*)에 있는 법 이름 — 이중 폴더를 가려내는 데 쓴다."""
    out = set()
    for d in sorted(os.listdir(RAW)):
        if d.startswith(('15_', '_')) or not os.path.isdir(os.path.join(RAW, d)):
            continue
        for e in os.listdir(os.path.join(RAW, d)):
            out.add(flat(e))
    return out


CONV = re.compile(r'협약|조약')


def decide(domain, folder, name, base):
    # ★협약·조약은 건너뛴다 — 이 규칙의 전제가 「소관부처가 기준」인데 협약엔 소관부처가 없다.
    #   낱말만 보면 SOLAS·COLREG·SAR·만재흘수선이 3군으로 떨어진다. **사람이 정한다(3-2).**
    if CONV.search(name):
        return None, '★협약·조약 — 소관부처가 없어 이 규칙의 전제가 안 선다. 사람이 정한다(3-2)'
    if not domain.startswith(RULES['타법_폴더'][:3]):
        return RULES['기준법_도메인_아니면'], '기준법 도메인'
    if flat(folder) in base:
        return None, '★기준법 도메인에도 같은 이름이 있다 — 사람이 정한다(3-11)'
    hit = [k for k in RULES['2군_낱말'] if k in name]
    if hit or any(e in name for e in RULES['2군_이름지정']):
        return 2, '2군 낱말 ' + '·'.join((hit or RULES['2군_이름지정'])[:3])
    return RULES['3군_나머지'], '어디에도 안 걸린다'


def main():
    apply_ = '--apply' in sys.argv
    base = base_names()
    touched = Touched('tier_fill') if apply_ else None
    tally = collections.Counter()
    hold = []
    for r, _d, fs in os.walk(RAW):
        if '_meta.json' not in fs:
            continue
        if '/_대기/' in r.replace(os.sep, '/') or os.path.basename(r) == '_대기':
            tally['건너뜀(_대기)'] += 1
            continue
        mp = os.path.join(r, '_meta.json')
        try:
            j = json.load(open(mp, encoding='utf-8'))
        except Exception:
            tally['못 읽음'] += 1
            continue
        if j.get('tier') is not None:
            tally['이미 있다'] += 1
            continue
        rel = os.path.relpath(r, RAW).replace(os.sep, '/')
        domain, folder = rel.split('/')[0], os.path.basename(r)
        name = j.get('법령명') or folder
        t, why = decide(domain, folder, name, base)
        if t is None:
            tally['보류'] += 1
            hold.append(name)
            continue
        tally[f'tier {t}'] += 1
        if apply_:
            j['tier'] = t
            j.setdefault('_tier_출처', 'tier_rules.json (3-1, 2026-09-24) — ' + why)
            with open(mp, 'w', encoding='utf-8') as f:
                json.dump(j, f, ensure_ascii=False, indent=2)
            touched.add(mp)
    for k in sorted(tally):
        print(f'  {k:18s} {tally[k]}')
    if hold:
        print(f'\n★보류 {len(hold)}개 — 3-11 이 정한다:')
        for n in hold:
            print('   ', n[:60])
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
