# -*- coding: utf-8 -*-
"""행정규칙에서 온 별표의 **원본 파일 링크(PDF·HWP)** 를 `_links.json` 에 채운다. (3-21 · 3-36)

왜 만드나
  3-21 에서 PDF 링크를 채우고 남은 91개를 갈랐을 때, **「행정규칙 출처 23개」** 를
  *"다른 API 로 받은 별표라 이 도구 범위 밖"* 이라고 적었다. **그것도 틀렸다.**
  `target=admrul` 응답에도 `별표서식PDF파일링크`·`별표서식파일링크` 가 **그대로 있다**
  (목포항 항만시설운영세칙 ID 2100000261868 로 확인 — 별표 15개 **전부** PDF 링크 있음).

  ⇒ 오늘만 세 번째다(L-360·L-367). **「API 가 안 준다」를 적기 전에 응답의 칸 이름을 전부 찍어 본다.**

무엇을 하나 (둘)
  ⑴ `_links.json` 에 **이미 있는** 항목 중 머리가 계층 낱말이 아닌 것 → `PDF`·`HWP` 칸을 채운다.
  ⑵ ★**항목 자체가 없는 것을 새로 적는다.** 별표 폴더의 `.txt` 7,495개 중
     `_links.json` 에 짝이 있는 것은 **2,757개(37%)** 뿐이고, 짝 없는 **2,690개 중 2,621개가
     행정규칙 출처**다. 그 2,621개는 **내려받기 단추가 아예 안 뜬다** — 링크를 적어 둔 적이 없어서다.

무엇을 안 하나
  · `.txt` 본문은 **한 글자도 안 건드린다.**
  · 이미 찬 칸은 덮지 않는다.
  · 짝을 못 찾으면 **손대지 않고 그대로 적어 둔다**(넘겨짚지 않는다).
"""
import os, re, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
import admrul_fill_addenda as A                                   # noqa: E402
from _touched import Touched                                      # noqa: E402

TIER = ('법률', '시행령', '시행규칙')
BASE = 'https://www.law.go.kr'


def flat(s):
    return re.sub(r'\s|·|ㆍ', '', s)


def rule_id(path):
    """행정규칙 .txt 둘째 줄의 `ID:` — 수집기가 적어 둔 그대로."""
    try:
        with open(path, encoding='utf-8') as f:
            f.readline()
            m = re.search(r'ID:\s*(\d+)', f.readline())
            return m.group(1) if m else None
    except Exception:
        return None


def rule_file(admdir, name):
    p = os.path.join(admdir, name + '.txt')
    if os.path.exists(p):
        return p
    if not os.path.isdir(admdir):
        return None
    for e in os.listdir(admdir):
        if e.endswith('.txt') and flat(e[:-4]) == flat(name):
            return os.path.join(admdir, e)
    return None


_CACHE = {}


def units_of(rid):
    """그 행정규칙의 별표 목록 — 한 번만 부른다."""
    if rid in _CACHE:
        return _CACHE[rid]
    d = A.api(f'{BASE}/DRF/lawService.do?OC=hyoo1431&target=admrul&type=JSON&ID={rid}')
    out = {}
    try:
        u = d['AdmRulService']['별표']['별표단위']
        for x in (u if isinstance(u, list) else [u]):
            no = str(x.get('별표번호') or '').lstrip('0') or '0'
            gaji = str(x.get('별표가지번호') or '00').lstrip('0')
            key = f"{x.get('별표구분')}{no}" + (f"의{gaji}" if gaji else '')
            out[flat(key)] = x
    except Exception:
        pass
    _CACHE[rid] = out
    return out


ITEM = re.compile(r'^(.+?)\s+(별표|별지|서식)\s*(\d+(?:의\d+)?)(?:호)?(서식)?$')


def main():
    apply_ = '--apply' in sys.argv
    touched = Touched('admrul_byl_links') if apply_ else None
    seen = filled = nofile = noid = nomatch = 0
    for r, _d, _f in os.walk(RAW):
        if os.path.basename(r) != '별표':
            continue
        lp = os.path.join(r, '_links.json')
        if not os.path.exists(lp):
            continue
        links = json.load(open(lp, encoding='utf-8'))
        admdir = os.path.join(os.path.dirname(r), '행정규칙')
        add = 0
        # ⑵ 항목이 아예 없는 `.txt` 를 먼저 채워 넣는다(머리가 계층 낱말이 아닌 것만).
        keyset = {flat(k) for k in links}
        for fn in sorted(os.listdir(r)):
            if not fn.endswith('.txt'):
                continue
            mm = re.match(r'^(.+?)_(별표|별지|서식)(.+)$', fn[:-4])
            if not mm or mm.group(1) in TIER:
                continue
            owner, typ, no = mm.groups()
            newkey = f"{owner} {'서식' if typ in ('별지', '서식') else '별표'} {no}"
            if flat(newkey) in keyset or flat(f"{owner} {typ} {no}") in keyset:
                continue
            seen += 1
            rf = rule_file(admdir, owner)
            if not rf:
                nofile += 1
                continue
            rid = rule_id(rf)
            if not rid:
                noid += 1
                continue
            want = flat(('서식' if typ in ('별지', '서식') else '별표') + no)
            x = units_of(rid).get(want) or units_of(rid).get(flat('별지' + no))
            if not x:
                nomatch += 1
                continue
            pdf = x.get('별표서식PDF파일링크') or ''
            hwp = x.get('별표서식파일링크') or ''
            if not (pdf or hwp):
                nomatch += 1
                continue
            links[newkey] = {'제목': str(x.get('별표제목') or ''),
                             'HWP': (BASE + hwp) if hwp else '',
                             'PDF': (BASE + pdf) if pdf else '',
                             '이미지': [BASE + u for u in (x.get('별표서식이미지파일링크') or [])
                                      if isinstance(u, str)]}
            keyset.add(flat(newkey)); add += 1
        for k, v in links.items():
            if not isinstance(v, dict) or v.get('PDF'):
                continue
            m = ITEM.match(k.strip())
            if not m or m.group(1) in TIER:
                continue
            seen += 1
            rf = rule_file(admdir, m.group(1))
            if not rf:
                nofile += 1
                continue
            rid = rule_id(rf)
            if not rid:
                noid += 1
                continue
            want = flat(('서식' if m.group(2) in ('별지', '서식') else '별표') + m.group(3))
            x = units_of(rid).get(want) or units_of(rid).get(flat('별지' + m.group(3)))
            if not x:
                nomatch += 1
                continue
            pdf = x.get('별표서식PDF파일링크') or ''
            hwp = x.get('별표서식파일링크') or ''
            if pdf:
                v['PDF'] = BASE + pdf; add += 1
            if hwp and not v.get('HWP'):
                v['HWP'] = BASE + hwp
        if add:
            filled += add
            print('· %-58s 새로 적음·채움 %3d' % (os.path.relpath(os.path.dirname(r), RAW)[:58], add))
            if apply_:
                json.dump(links, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
                touched.add(lp)
    print(f'\n=== 본 항목 {seen} · 채움 {filled} · 행정규칙 파일 없음 {nofile} '
          f'· ID 줄 없음 {noid} · 응답에 그 번호 없음 {nomatch} ===')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
