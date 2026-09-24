#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V5-18 「어긋남」 — **같은 계층을 두 자리가 다르게 말하는** `_meta.json` 을 맞춘다.

[무엇이 어긋나 있나]
  `_meta.json` 에 판번호(MST)를 적는 자리가 둘이다:
    · `families.<계층>.MST`         ← 지금 자리
    · `법령일련번호(<계층>)` (최상위) ← 옛 자리
  둘이 **다른 번호를 말하는** 파일이 있다. 그러면 신선도 점검이 **어느 판과 견줘야 할지 모른다.**

[★번호만 맞추면 거짓이 된다 — 그래서 글자를 먼저 본다]
  두 번호는 **서로 다른 판**을 가리킨다. 파일이 어느 판을 담고 있는지 모르는 채 번호만 고치면
  **우리가 안 가진 판을 가졌다고 적는 것**이 된다(환각 0 위반).
  그래서 이 도구는 **두 판을 law.go.kr 에서 받아, 우리가 담고 있는 조를 글자까지 견준다.**
    · 전부 같다  → 내용은 현행 그대로다. **번호표만 낡은 것**이므로 맞춘다(그리고 견준 사실을 적는다).
    · 하나라도 다르다 → **손대지 않는다.** 다시 받아야 하는 일이라 사람에게 넘긴다.

[실측 1건 (2026-09-24)]
  `15_관련타부처/전자정부법` — `families.법률.MST=268103`(시행 2025-07-08) ↔ 최상위 `283701`(시행 2026-08-28).
  파일은 **발췌본**이고 머리에 *"MST=268103, 시행 2025-07-08"* 이라 적혀 있다.
  우리가 발췌한 **제2·7·14·36·65조를 두 판에서 견주니 다섯 조 다 글자까지 같다.**
  ⇒ 번호표만 맞춘다. 견준 사실을 raw 머리와 `_meta.json` 에 남긴다.

[연계] ← `_dashboard/loop/meta_schema_gate.js`(V5-18) 의 `어긋남`
사용법: python3 meta_mst_align.py [--apply]
"""
import json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_api_guard
from _touched import Touched

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
APPLY = '--apply' in sys.argv
TIER_KEY = re.compile(r'^법령일련번호\((.+)\)$')


def api(url):
    for i in range(10):
        try:
            b = urllib.request.urlopen(url, timeout=40).read().decode('utf-8', 'replace')
            if b.lstrip()[:1] in '{[':
                return json.loads(b)
            r = law_api_guard.block_reason(b)
            if r:
                law_api_guard.announce(r, url)
                if law_api_guard.is_fatal(r):
                    return None
        except Exception:
            pass
        time.sleep(min(1.2 + 0.4 * i, 6.0))
    return None


def articles(mst):
    """그 판의 조문을 {조키: 공백을 지운 본문} 으로 준다."""
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON')
    js = ((d or {}).get('법령') or {}).get('조문', {}).get('조문단위') or []
    if isinstance(js, dict):
        js = [js]
    out = {}
    for j in js:
        n = str(j.get('조문번호') or '').lstrip('0') or '0'
        g = str(j.get('조문가지번호') or '').lstrip('0')
        hangs = j.get('항')
        hangs = hangs if isinstance(hangs, list) else ([hangs] if hangs else [])
        body = str(j.get('조문내용') or '') + ''.join(str(h.get('항내용') or '') for h in hangs)
        out['제%s조%s' % (n, '의' + g if g else '')] = re.sub(r'\s+', '', body)
    return out


def find():
    """두 자리가 다른 번호를 말하는 곳을 모은다 → [(폴더, 계층, families값, 최상위값, 파일이름)]"""
    out = []
    for root, dirs, files in os.walk(RAW):
        dirs[:] = [d for d in dirs if d != '_대기']
        if '_meta.json' not in files:
            continue
        p = os.path.join(root, '_meta.json')
        try:
            d = json.load(open(p, encoding='utf-8'))
        except Exception:
            continue
        fam = d.get('families') or {}
        for k, v in d.items():
            m = TIER_KEY.match(str(k))
            if not m:
                continue
            tier = m.group(1)
            f = fam.get(tier) or {}
            a, b = str(f.get('MST') or ''), str(v or '')
            if a and b and a != b:
                out.append((root, tier, a, b, f.get('파일') or ''))
    return out


def main():
    rows = find()
    print(f'두 자리가 다른 번호를 말하는 곳 {len(rows)}개\n')
    touched = Touched('meta_mst_align.py')
    fixed = handed = 0
    for root, tier, fam_mst, top_mst, fname in rows:
        rel = os.path.relpath(root, RAW)
        print(f'▣ {rel} — {tier}: families.MST={fam_mst} ↔ 최상위={top_mst}')
        txtp = os.path.join(root, fname) if fname else None
        if not (txtp and os.path.exists(txtp)):
            print('   ⏭️  그 계층 파일을 못 찾았다 — 사람 몫'); handed += 1; continue
        text = open(txtp, encoding='utf-8').read()
        ours = sorted(set(re.findall(r'^제(\d+)조(?:의(\d+))?\(', text, re.M)),
                      key=lambda x: (int(x[0]), int(x[1] or 0)))
        keys = ['제%s조%s' % (a, '의' + b if b else '') for a, b in ours]
        if not keys:
            print('   ⏭️  그 파일에서 조를 못 읽었다 — 사람 몫'); handed += 1; continue
        A, B = articles(fam_mst), articles(top_mst)
        if not A or not B:
            print('   ⏭️  두 판을 다 못 받았다 — 사람 몫'); handed += 1; continue
        diff = [k for k in keys if A.get(k) != B.get(k)]
        print(f'   우리가 담은 조 {len(keys)}개 · 두 판에서 다른 조 {len(diff)}개'
              + (f' → {diff[:5]}' if diff else ''))
        if diff:
            print('   ❌ 글자가 다르다 — **번호를 맞추지 않는다.** 다시 받아야 한다(사람 몫)')
            handed += 1; continue
        print('   ✅ 담은 조가 두 판에서 글자까지 같다 — 번호표만 맞춘다')
        if not APPLY:
            continue
        mp = os.path.join(root, '_meta.json')
        d = json.load(open(mp, encoding='utf-8'))
        d['families'][tier]['MST'] = top_mst
        note = d.setdefault('_판번호_맞춤', [])
        note.append({
            '날짜': '2026-09-24', '계층': tier, '옛 MST': fam_mst, '새 MST': top_mst,
            '근거': f'우리가 담은 조 {len(keys)}개({"·".join(keys)})를 두 판에서 글자까지 견주니 전부 같다. '
                    f'내용은 현행 그대로이고 번호표만 낡았던 것이다. 도구: meta_mst_align.py',
        })
        json.dump(d, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.add(mp)
        # raw 머리에도 남긴다 — 파일만 보는 사람도 알 수 있게(한 줄로 쓴다)
        line = (f'※판번호 확인(2026-09-24): 이 발췌는 MST={fam_mst} 에서 받았으나, 담긴 조 '
                f'{"·".join(keys)} 를 현행 MST={top_mst} 와 글자까지 견주니 **전부 같다.** '
                f'그래서 `_meta.json` 의 판번호를 {top_mst} 로 맞췄다. 다시 받은 것이 아니다.')
        if line.split(':')[0] not in text:
            lines = text.split('\n')
            lines.insert(1, line)
            open(txtp, 'w', encoding='utf-8').write('\n'.join(lines))
            touched.add(txtp)
        fixed += 1
    if APPLY:
        touched.save()
        print(f'\n맞춘 곳 {fixed} · 사람 몫 {handed}')
    else:
        print(f'\n(미리보기다. 적용하려면 --apply)  맞출 수 있다 {len(rows)-handed} · 사람 몫 {handed}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
