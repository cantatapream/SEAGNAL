# -*- coding: utf-8 -*-
"""꼬리표 판번호를 **제자리(`families.<계층>`)로** 옮긴다 — 3-37 이 「계층 불명」으로 남긴 것. (3-9)

무엇이 새로 보였나
  3-37 은 87곳 중 **이름이 계층을 말해 주는 34곳**만 옮기고,
  `법령ID`·`법령일련번호(MST)`·`법령일련번호`·`MST` 는 **「계층 불명 — 사람 몫」** 으로 남겼다.
  ★**이름은 안 말해 주지만 폴더가 말해 준다.** 실측(남은 59곳):

      ② 계층이 하나뿐            45   ← 이 도구가 옮긴다
      ③ 조약·행정규칙            10   ← `families.<계층>` 구조가 안 맞는다 → 3-45
      ④ 계층이 여럿, 이름이 안 말해 줌 4  ← 사람이 정한다(G-34)

제자리를 어떻게 고르나 (넘겨짚지 않는다)
  1. `families` 에 항목이 **딱 하나**면 그 항목 — 그 이름 그대로 쓴다.
     ⚠`"법률(발췌)"` 처럼 꼬리가 붙은 이름이 있다(지방세법). **새 이름을 만들지 않는다.**
  2. `families` 가 없으면, 폴더의 본문 파일(`법률.txt`·`법률_발췌.txt` …)로 정해지는
     **계층이 하나뿐**일 때만 그 이름으로 만든다.
  3. 둘 다 아니면 **손대지 않는다.**

무엇을 안 하나
  · 최상위 키는 **한 글자도 안 지운다**(3-37 과 같은 규약 — 옛 서술을 안 지운다).
    어긋나면 `meta_schema_gate` 의 `conflicts` 가 잡는다.
  · 이미 그 자리에 값이 있으면 **덮지 않는다.**
  · 조약(`조약일련번호`·`조약번호`)·행정규칙(`행정규칙ID`)은 **건드리지 않는다** → 3-45.

[연계] ← `_dashboard/loop/_meta_schema.js`(세는 자) · → `raw/**/_meta.json` 의 `families`
사용법: python3 meta_id_home.py [--apply]
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
from _touched import Touched                                      # noqa: E402

TIER_FILE = re.compile(r'^(법률|시행령|시행규칙)(_발췌)?\.txt$')
MST_KEYS = ['법령일련번호(MST)', '법령일련번호', 'MST', 'mst']
LID_KEYS = ['법령ID']
SKIP_KEYS = ('조약일련번호', '조약번호', '행정규칙ID', '행정규칙일련번호', '자치법규ID')


def tiers_of(d):
    out = set()
    for f in os.listdir(d):
        m = TIER_FILE.match(f)
        if m:
            out.add(m.group(1))
    return sorted(out)


def home_of(meta, d):
    """제자리 이름 하나를 고른다. 못 고르면 None."""
    fam = meta.get('families')
    if isinstance(fam, dict) and len(fam) == 1:
        return list(fam)[0], '`families` 항목이 하나뿐'
    if not isinstance(fam, dict) or not fam:
        t = tiers_of(d)
        if len(t) == 1:
            return t[0], '폴더의 본문 계층이 하나뿐'
    return None, ''


def main():
    apply_ = '--apply' in sys.argv
    touched = Touched('meta_id_home') if apply_ else None
    tally = collections.Counter()
    for r, _d, fs in os.walk(RAW):
        if '_meta.json' not in fs:
            continue
        if '/_대기/' in r.replace(os.sep, '/'):
            continue
        p = os.path.join(r, '_meta.json')
        try:
            j = json.load(open(p, encoding='utf-8'))
        except Exception:
            tally['못 읽음'] += 1
            continue
        fam = j.get('families') if isinstance(j.get('families'), dict) else {}
        if any(isinstance(v, dict) and v.get('MST') for v in fam.values()):
            continue                                   # 이미 제자리에 있다
        tops = [k for k in j if k in MST_KEYS or k in LID_KEYS or k in SKIP_KEYS]
        if not tops:
            continue
        if any(k in SKIP_KEYS for k in tops) and not any(k in MST_KEYS + LID_KEYS for k in tops):
            tally['건너뜀(조약·행정규칙 — 3-45)'] += 1
            continue
        key, why = home_of(j, r)
        if not key:
            tally['손 안 댐(계층이 여럿)'] += 1
            continue
        fam = j.setdefault('families', {})
        slot = fam.setdefault(key, {})
        moved = []
        for k in MST_KEYS:
            if j.get(k) and not slot.get('MST'):
                slot['MST'] = str(j[k]); moved.append(f'MST←{k}')
                break
        for k in LID_KEYS:
            if j.get(k) and not slot.get('법령ID'):
                slot['법령ID'] = str(j[k]); moved.append(f'법령ID←{k}')
                break
        if not moved:
            tally['옮길 것 없음'] += 1
            continue
        slot.setdefault('_제자리출처', f'meta_id_home (3-9, 2026-09-24) — {why}. 최상위 키는 안 지웠다')
        tally['옮겼다'] += 1
        print('· %-52s → families.%s  %s' % (os.path.relpath(r, RAW)[:52], key, ' · '.join(moved)))
        if apply_:
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(j, f, ensure_ascii=False, indent=2)
            touched.add(p)
    print()
    for k in sorted(tally):
        print(f'  {k:28s} {tally[k]}')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
