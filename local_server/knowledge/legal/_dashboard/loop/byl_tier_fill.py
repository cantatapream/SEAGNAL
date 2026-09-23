#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-46 — V5-32 가 「파일이 없다」고 짚은 **계층 별표 빈자리**를 골라서 메운다.

[무엇을 메우나] 위키의 근거 줄이 `법률/시행령/시행규칙` 별표를 짚었는데
  `<법>/별표/<계층>_별표N.txt` 가 **없는** 자리. V5-32(`byl_tier_ready.js`)가 그 목록을 갖고 있다.

[자는 하나만 쓴다 — 뿌리 사슬 ⑥] 여기서 다시 세지 않는다. **V5-32 의 `check()` 를 node 로 불러**
  그 `ex.no_file` 을 그대로 받는다. 따로 세면 값이 갈리고, 갈리는 순간 무엇이 맞는지 아무도 모른다.

[★104 는 파일 수가 아니다] V5-32 의 104 는 **근거 줄**의 수다. 같은 별표를 여러 쪽이 짚으면
  여러 번 세어진다. 서로 다른 **파일 자리**로 접으면 **75개**, 법 폴더로는 **41개**다.
  「104개를 받는다」고 적으면 그 자체가 또 하나의 허수가 된다.

[베끼지 않고 부른다 — L-136] 별표를 적는 꼴(`[법률] 별표3 — 제목` + 본문)은
  `recollect_byl.extract_layer` **하나에만** 있다. 이 도구는 그것을 `only=`/`overwrite=False` 로 부른다.
  내려받기도 `law_api_guard.fetch_law_body`(현행 시행일을 못 박아 부르는 공용 함수)를 그대로 쓴다.

[무엇을 안 하나]
  · **이미 있는 파일은 건드리지 않는다**(`overwrite=False`). 이것은 **빈자리 메우기**이지 재수집이 아니다.
  · `_meta.json` 을 **안 고친다**. (`recollect_byl.run()` 은 전수 재수집이라 별표수를 다시 적지만,
    골라 채우기는 그 수를 바꿀 자격이 없다 — 이 도구가 보는 것은 법의 전체 별표가 아니다.)
  · `_links.json` 은 **덮지 않고 합친다**.
  · 조례(`_자치법규`)는 API 가 다르다(`target=ordin`) — **여기서 손대지 않고 따로 센다.**

쓰는 법:
    python3 _dashboard/loop/byl_tier_fill.py           # 무엇을 어디서 받을지만 보여준다
    python3 _dashboard/loop/byl_tier_fill.py --apply   # 실제로 받아 빈자리를 메운다

[연계] → `raw/<도메인>/<법>/별표/<계층>_별표N.txt` · 같은 폴더의 `_links.json`
        ← `byl_tier_ready.js`(빈자리 목록) · `recollect_byl.py`(내려받기·적는 꼴) · `law_api_guard.py`
"""
import json, os, re, subprocess, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recollect_byl as RB                                       # noqa: E402  ★운영 수집기를 그대로 부른다
from _touched import Touched                                     # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OC = 'hyoo1431'
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
GATE = os.path.join(HERE, 'byl_tier_ready.js')
KIND_OF = {'법률': '법률', '시행령': '시행령', '시행규칙': '시행규칙'}


def gaps():
    """V5-32 에게 빈자리를 묻는다. 줄 꼴: `<법폴더>/별표/<계층>_<별표N>.txt | <위키쪽>`"""
    out = subprocess.run(
        ['node', '-e', "console.log(JSON.stringify(require(%r).check()))" % GATE],
        capture_output=True, text=True, check=True)
    # ⚠node 가 먼저 뱉는 안내줄(`[Gemini] …`)을 같이 받는다 — **JSON 인 줄만** 고른다.
    line = next(l for l in reversed(out.stdout.split('\n')) if l.startswith('{'))
    ex = json.loads(line)['ex']
    want = {}
    for line in ex['no_file']:
        p = line.split(' | ')[0].strip()
        base, fn = p.rsplit('/별표/', 1)
        want.setdefault(base, set()).add(fn)
    return want


# ★꼬리표의 `families` 키는 **한 가지가 아니다**(3-48 실측 16자리).
#   `공무원 여비 규정` 은 `대통령령`, `시설물안전법` 은 `시행령_부분수집`,
#   `유어장 규칙`·`가축분뇨법(시행규칙)` 은 규칙인데 `법률` 로 적혀 있다.
#   **없는 게 아니라 다른 이름으로 있는 것**이다 — 안 씻고 찾으면 "판을 모른다"가 된다(⑥).
ALIAS = {
    '시행령': ['시행령', '대통령령'],
    '시행규칙': ['시행규칙', '부령', '총리령', '해양수산부령', '환경부령', '국토교통부령', '농림축산식품부령'],
    '법률': ['법률', '법'],
}


def fam_mst(fams, kind, meta_name=None):
    """`families` 에서 그 계층의 MST 를 찾는다 → (MST, 어느 키에서 왔나)."""
    for want in ALIAS.get(kind, [kind]):
        v = fams.get(want)
        if isinstance(v, dict) and v.get('MST'):
            return str(v['MST']), want
    # `시행령_부분수집` 처럼 **뒤에 말이 붙은 키**도 같은 계층이다.
    for k, v in fams.items():
        if not isinstance(v, dict) or not v.get('MST'):
            continue
        for want in ALIAS.get(kind, [kind]):
            if k.startswith(want):
                return str(v['MST']), k
    # ★단일 계층 폴더 — **그 폴더가 곧 그 계층일 때만** 하나뿐인 판을 쓴다.
    if meta_name and len(fams) == 1 and own_tier(meta_name) == kind:
        k = next(iter(fams))
        v = fams[k]
        if isinstance(v, dict) and v.get('MST'):
            return str(v['MST']), '%s(이 폴더가 곧 %s다)' % (k, kind)
    return None, None


def indent_of(text):
    """그 파일이 쓰던 들여쓰기를 그대로 돌려준다. **통째로 다시 찍지 않기 위해서**다(L-331)."""
    for ln in text.split('\n')[1:]:
        if ln.strip():
            return len(ln) - len(ln.lstrip(' '))
    return 1


def find_law_mst(name):
    """법령명으로 MST 를 찾는다 — 3-43 에서 쓴 길과 같다(가운뎃점은 띄어쓰기로 바꿔 한 번 더 묻는다).

    돌려주는 것: (MST, 시행일자, 공포일자). **이름이 정확히 같을 때만** 돌려준다 —
    비슷한 것을 집으면 **엉뚱한 법의 별표**를 우리 법 폴더에 적게 된다.
    """
    flat = re.sub(r'[^0-9A-Za-z가-힣]', '', name)
    for q in (name, re.sub(r'[·ㆍ・]', ' ', name)):
        d = RB.api('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&target=law&type=JSON&display=100&query=%s'
                   % (OC, urllib.parse.quote(q)))
        rows = ((d or {}).get('LawSearch', {}) or {}).get('law') or []
        if isinstance(rows, dict):
            rows = [rows]
        for r in rows:
            if re.sub(r'[^0-9A-Za-z가-힣]', '', str(r.get('법령명한글', ''))) == flat:
                return (str(r.get('법령일련번호') or ''), str(r.get('시행일자') or ''),
                        str(r.get('공포일자') or ''))
        if q != name:
            break
    return None, None, None


SUFFIX = {'시행령': ' 시행령', '시행규칙': ' 시행규칙', '법률': ''}


def own_tier(meta_name):
    """그 폴더가 **담고 있는 문서 자체**의 계층. 이름 꼬리로 가른다.

    ⚠이것을 안 보면 두 가지를 반대로 한다:
      · `가축분뇨…법률` 폴더(안은 **시행규칙**)에서 시행령 별표를 찾으면서
        **하나뿐인 판(=시행규칙)을 시행령이라고 적을 뻔했다** — 그러면 틀린 원문이 들어간다.
      · `유전자변형…규칙` 폴더(안이 **그 규칙 자체**)에 `시행규칙` 을 덧붙여
        「…규칙 시행규칙」 이라는 **없는 법**을 찾고 있었다.
    """
    n = str(meta_name or '').strip()
    if n.endswith('시행령'):
        return '시행령'
    if n.endswith('시행규칙') or n.endswith('규칙') or n.endswith('규정'):
        return '시행규칙'
    return '법률'


def want_name(meta_name, kind):
    """그 계층의 **법령명**을 짓는다. 이미 그 계층의 이름이면 그대로 쓴다.

    예) 꼬리표 법령명이 `가축분뇨의 관리 및 이용에 관한 법률 시행규칙` 이고 원하는 계층이 `시행령` 이면
        → 꼬리를 떼고(`… 법률`) `시행령` 을 붙여 `가축분뇨의 관리 및 이용에 관한 법률 시행령`.
    """
    n = str(meta_name or '').strip()
    if not n:
        return ''
    if own_tier(n) == kind:
        return n                                  # 그 폴더가 이미 그 계층이다 — 꼬리를 덧붙이지 않는다
    base = re.sub(r'\s*(시행령|시행규칙)\s*$', '', n).strip()
    return (base + SUFFIX.get(kind, '')).strip()


def fill_mst(apply_):
    """3-48 — 꼬리표에 그 계층의 MST 가 없는 자리를 **이름으로 찾아** 채운다(네트워크)."""
    want = gaps()
    todo = []
    for base in sorted(want):
        if '/_자치법규/' in base:
            continue
        absbase = base if os.path.isabs(base) else os.path.join(REPO, base)
        mp = os.path.join(absbase, '_meta.json')
        if not os.path.exists(mp):
            print('· %s\n    ⚠`_meta.json` 이 **없다** — 꼬리표를 새로 만드는 일은 스키마 결정이라 여기서 안 한다'
                  % os.path.relpath(absbase, REPO).replace('local_server/knowledge/legal/raw/', ''))
            continue
        raw = open(mp, encoding='utf-8').read()
        meta = json.loads(raw)
        fams = meta.get('families', {})
        kinds = {kind_of(fn) for fn in want[base]} - {None}
        for kind in sorted(kinds):
            mst, _via = fam_mst(fams, kind, meta.get('법령명'))
            if mst:
                continue
            todo.append((absbase, mp, raw, meta, fams, kind))
    print('꼬리표에 판이 없는 자리 %d개' % len(todo))
    added = 0
    for absbase, mp, raw, meta, fams, kind in todo:
        short = os.path.relpath(absbase, REPO).replace('local_server/knowledge/legal/raw/', '')
        # ★단일 계층 폴더 — 그 폴더 자체가 규칙·규정이면 하나뿐인 판이 모든 계층을 맡는다.
        # ⚠**그 폴더가 그 계층일 때만** 하나뿐인 판을 그 계층으로 본다.
        #   아니면 엉뚱한 판(시행규칙)을 시행령이라고 적게 된다.
        if len(fams) == 1 and own_tier(meta.get('법령명')) == kind:
            only_key = next(iter(fams))
            print('· %s\n    ↪이 폴더는 **그 자체가 `%s`** 다 — 꼬리표의 `%s` 판(%s)이 곧 그 판이다(새로 안 받는다)'
                  % (short, meta.get('법령명'), only_key, (fams[only_key] or {}).get('MST')))
            continue
        name = want_name(meta.get('법령명'), kind)
        mst, efyd, pub = find_law_mst(name)
        print('· %s\n    %s 를 이름으로 찾는다 → 「%s」 → MST=%s (시행 %s)' % (short, kind, name, mst, efyd))
        if not mst or not apply_:
            continue
        ind = indent_of(raw)
        meta.setdefault('families', {})[kind] = {'MST': mst, '공포일자': pub, '시행일자': efyd,
                                                 '찾은날': '2026-09-23(3-48 · 이름으로 조회)'}
        open(mp, 'w', encoding='utf-8').write(
            json.dumps(meta, ensure_ascii=False, indent=ind) + '\n')
        t = Touched('byl_tier_fill_mst')
        t.add(mp)
        t.save()
        added += 1
    print('\n=== 꼬리표에 새로 적은 판 %d개 ===' % added)
    if apply_ and added:
        print('⚠다음으로 `byl_tier_fill.py --apply` 를 다시 돌려 별표를 받는다.')
    return 0


def kind_of(fn):
    m = re.match(r'^(법률|시행령|시행규칙)_', fn)
    return m.group(1) if m else None


def run():
    apply_ = '--apply' in sys.argv
    if '--mst' in sys.argv:
        return fill_mst(apply_)
    want = gaps()
    lines = sum(len(v) for v in want.values())
    print('V5-32 가 짚은 **빈 별표 파일 자리** %d개 · 법 폴더 %d개' % (lines, len(want)))
    ordin = {k: v for k, v in want.items() if '/_자치법규/' in k}
    nat = {k: v for k, v in want.items() if '/_자치법규/' not in k}
    print('  · 법령(이 도구가 본다)  파일 %d개 · 폴더 %d개'
          % (sum(len(v) for v in nat.values()), len(nat)))
    print('  · 조례(API 가 다르다)   파일 %d개 · 폴더 %d개 — 여기서 손대지 않는다'
          % (sum(len(v) for v in ordin.values()), len(ordin)))
    touched = Touched('byl_tier_fill') if apply_ else None
    made = missing = nometa = 0
    for base in sorted(nat):
        rel = os.path.relpath(base, REPO) if os.path.isabs(base) else base
        absbase = base if os.path.isabs(base) else os.path.join(REPO, base)
        fns = sorted(want[base])
        mp = os.path.join(absbase, '_meta.json')
        print('\n· %s  ← %d개' % (rel.replace('local_server/knowledge/legal/raw/', ''), len(fns)))
        if not os.path.exists(mp):
            print('    ⚠`_meta.json` 이 없다 — 어느 판을 받을지 알 수 없다. 손대지 않는다')
            nometa += len(fns)
            continue
        meta = json.load(open(mp, encoding='utf-8'))
        fams = meta.get('families', {})
        bdir = os.path.join(absbase, '별표')
        links_p = os.path.join(bdir, '_links.json')
        links = json.load(open(links_p, encoding='utf-8')) if os.path.exists(links_p) else {}
        by_kind = {}
        for fn in fns:
            k = kind_of(fn)
            if k:
                by_kind.setdefault(k, set()).add(fn)
        for kind, only in sorted(by_kind.items()):
            mst, via = fam_mst(fams, kind, meta.get('법령명'))
            if mst and via != kind:
                print('    ↪%s 의 판은 꼬리표에 **`%s`** 라는 이름으로 있었다(없는 게 아니었다)' % (kind, via))
            if not mst:
                print('    ⚠%s 의 MST 가 꼬리표에 없다 → %s' % (kind, ', '.join(sorted(only))))
                nometa += len(only)
                continue
            body = RB.fetch_body(mst)
            if not body:
                print('    ⚠%s MST=%s — 본문을 못 받았다 → %s' % (kind, mst, ', '.join(sorted(only))))
                missing += len(only)
                continue
            before = set(os.listdir(bdir)) if os.path.isdir(bdir) else set()
            n = RB.extract_layer(body, kind, bdir, links, only=only, overwrite=False) if apply_ else 0
            if not apply_:
                # 받아만 보고 **무엇이 있는지**만 센다(파일은 안 쓴다).
                try:
                    byl = body['법령']['별표']['별표단위']
                except (KeyError, TypeError):
                    byl = []
                if isinstance(byl, dict):
                    byl = [byl]
                have = set()
                for b in byl:
                    typ = b.get('별표구분', '별표')
                    num = (b.get('별표번호', '') or '').lstrip('0') or '0'
                    sub = (b.get('별표가지번호', '') or '').lstrip('0')
                    have.add('%s_%s%s%s.txt' % (kind, typ, num, ('의' + sub) if sub else ''))
                hit = only & have
                print('    %s MST=%s — 받은 별표 %d개 중 **우리가 찾던 것 %d/%d**%s'
                      % (kind, mst, len(byl), len(hit), len(only),
                         ('  ⚠없는 것: ' + ', '.join(sorted(only - hit))) if only - hit else ''))
                made += len(hit)
                missing += len(only - hit)
                continue
            after = set(os.listdir(bdir)) if os.path.isdir(bdir) else set()
            new = sorted(after - before)
            for fn in new:
                touched.add(os.path.join(bdir, fn))
            made += len(new)
            gone = sorted(only - set(new))
            if gone:
                print('    ⚠%s — API 가 안 준 것 %d개: %s' % (kind, len(gone), ', '.join(gone)))
                missing += len(gone)
            if new:
                print('    ✅%s — 새로 적은 것 %d개: %s' % (kind, len(new), ', '.join(new)))
            if links:
                json.dump(links, open(links_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
                touched.add(links_p)
    print('\n=== 메운 것 %d개 · API 에 없던 것 %d개 · 판을 모르는 것 %d개 ===' % (made, missing, nometa))
    if apply_:
        touched.save()
        print('⚠다음으로 `node _dashboard/loop/byl_tier_ready.js` 를 다시 돌려 확인한다.')
    return 0


if __name__ == '__main__':
    sys.exit(run())
