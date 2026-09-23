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
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recollect_byl as RB                                       # noqa: E402  ★운영 수집기를 그대로 부른다
from _touched import Touched                                     # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
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


def kind_of(fn):
    m = re.match(r'^(법률|시행령|시행규칙)_', fn)
    return m.group(1) if m else None


def run():
    apply_ = '--apply' in sys.argv
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
            mst = (fams.get(kind) or {}).get('MST')
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
