#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-49 — 조례 별표는 **본문이 안 온다.** 그러면 **원본으로 가는 길이라도 적어 둔다.**

[먼저 재 봤다 — 2026-09-23, 조례 11곳 전수]
  `lawService.do?target=ordin` 의 `별표단위` **41개 중 `별표내용` 이 있는 것 0개.**
  전부 `별표첨부파일명`(hwp·xls) 만 온다. **본문을 지어낼 수 없다.**
  (법령 `target=law` 는 `별표내용` 을 준다 — 그래서 3-46·3-48 은 채울 수 있었다. 조례는 다르다.)

[★그리고 번호를 그대로 믿으면 안 된다]
  조례 `별표단위` 는 `별표구분` 이 **전부 `서식`** 이고, `별표번호` 는 **일련번호**(0001, 0002 …)다.
  진짜 번호는 **제목 안**에 있다 — `[별표 2] 해수욕장시설 사용료` 는 `별표번호=0002` 가 아니라
  **별표 2** 다(우연히 같을 뿐이다). 실제로 어긋나는 것이 있다:
      해남군: 서식 0001=[별지 제1호서식] · 0002=[별표 1] · 0003=[별표 2] · 0004=[별지 제2호서식]
  그래서 `recollect_byl.extract_layer` 의 이름짓기(`{계층}_{별표구분}{별표번호}`)를 조례에 쓰면
  **[별표 1] 이 `법률_서식2.txt` 가 된다.** 이 도구는 파일을 안 쓰고 **길만 적는다.**

[무엇을 하나] `<조례>/별표/_links.json` 에 제목·원본 주소를 적는다(있던 항목은 덮지 않고 합친다).
  `.txt` 를 안 만들므로 **V5-32 는 그대로 「없다」로 센다 — 그게 맞다.** 공백은 공백이다.

쓰는 법:
    python3 _dashboard/loop/ordin_byl_links.py            # 무엇을 적을지만 보여준다
    python3 _dashboard/loop/ordin_byl_links.py --apply    # `_links.json` 에 적는다

[연계] → `raw/_자치법규/<시도>/<조례>/별표/_links.json`
        ← `byl_tier_ready.js`(어느 조례가 빈자리인지) · `ordin_recollect.py`(MST 찾기·내려받기)
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ordin_recollect as OR                                     # noqa: E402  ★MST 찾기·부르기를 그대로 쓴다
from _touched import Touched                                     # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
CATALOG = os.path.join(RAW, '_자치법규', '_ordin_catalog.json')
GATE = os.path.join(HERE, 'byl_tier_ready.js')
MST_CACHE = os.path.join(HERE, 'baseline', 'ordin_mst.json')
# 제목 안에 적힌 **진짜 번호**를 읽는다 — `별표번호` 는 일련번호라 믿을 수 없다(위 머리말).
TITLE_NO_RE = re.compile(r'(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)')


def gaps():
    """V5-32 에게 조례 빈자리를 묻는다 → {조례폴더: {찾던 파일이름}}"""
    import subprocess
    out = subprocess.run(
        ['node', '-e', "console.log(JSON.stringify(require(%r).check()))" % GATE],
        capture_output=True, text=True, check=True)
    line = next(l for l in reversed(out.stdout.split('\n')) if l.startswith('{'))
    want = {}
    for l in json.loads(line)['ex']['no_file']:
        p = l.split(' | ')[0].strip()
        if '/_자치법규/' not in p:
            continue
        base, fn = p.rsplit('/별표/', 1)
        want.setdefault(base, set()).add(fn)
    return want


NO_NUM_RE = re.compile(r'(별표|별지|서식)')


def title_key(title):
    """제목에서 번호를 읽는다. **번호가 없으면 지어내지 않는다.**

    ⚠처음엔 번호가 없을 때 `별표번호`(일련번호)로 메웠다. 그랬더니
    `[별표] 해수욕장 시설사용요금표`(번호 없는 단일 별표)가 **`서식1`** 이 되고,
    위키가 짚은 `별표1` 이 **「없는 번호」로 잘못 보고**됐다. 원인이 둘인데 하나로 뭉친 것이다.
    이제 번호 없는 것은 `별표(번호없음)` 으로 따로 세고, 판정은 사람이 한다(G-34).
    """
    t = str(title or '')
    m = TITLE_NO_RE.search(t)
    if m:
        return ('별표' if m.group(1) == '별표' else '서식') + m.group(2)
    m2 = NO_NUM_RE.search(t)
    if m2:
        return ('별표' if m2.group(1) == '별표' else '서식') + '(번호없음)'
    return None


def run():
    apply_ = '--apply' in sys.argv
    cat = json.load(open(CATALOG, encoding='utf-8')) if os.path.exists(CATALOG) else {}
    cache = json.load(open(MST_CACHE, encoding='utf-8')) if os.path.exists(MST_CACHE) else {}
    want = gaps()
    print('조례 빈자리 — 파일 %d개 · 조례 %d곳' % (sum(len(v) for v in want.values()), len(want)))
    touched = Touched('ordin_byl_links') if apply_ else None
    wrote = body = 0
    for base in sorted(want):
        absbase = base if os.path.isabs(base) else os.path.join(REPO, base)
        short = os.path.relpath(absbase, RAW)
        src = os.path.join(absbase, '법률.txt')
        text = open(src, encoding='utf-8').read() if os.path.exists(src) else ''
        head, _ = OR.split_head(text)
        name = OR.title_of(head)
        mst, how = OR.find_mst(head, name, cat, cache)
        print('\n· %s\n    이름=%s  MST=%s (%s)  ← 찾던 것 %s'
              % (short, name, mst, how, ', '.join(sorted(want[base]))))
        if not mst:
            continue
        d = OR.api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=ordin&type=JSON&MST=%s'
                   % (OR.OC, mst))
        if not d:
            continue
        b = list(d.values())[0] if d else {}
        byl = (b.get('별표') or {}).get('별표단위')
        if isinstance(byl, dict):
            byl = [byl]
        byl = byl or []
        links = {}
        have_title = []
        for x in byl:
            t = str(x.get('별표제목', '') or '')
            key = title_key(t) or ('서식' + str(x.get('별표번호', '')).lstrip('0'))
            # ⚠같은 꼴이 둘 이상이면 뒤엣것이 앞엣것을 덮는다 — 번호를 붙여 구분한다.
            if key in links:
                key = '%s#%s' % (key, str(x.get('별표번호', '')).lstrip('0'))
            have_title.append(key)
            url = str(x.get('별표첨부파일명', '') or '')
            links[key] = {'제목': t.strip(),
                          '파일꼴': str(x.get('별표첨부파일구분', '') or ''),
                          '원본': url if url.startswith('http') else (('https://www.law.go.kr' + url) if url else ''),
                          '본문있나': bool(str(x.get('별표내용', '') or '').strip())}
            if links[key]['본문있나']:
                body += 1
        miss = sorted({fn.split('_', 1)[1][:-4] for fn in want[base]} - set(have_title))
        print('    별표단위 %d개 · 본문이 온 것 %d개 · 제목에서 읽은 번호: %s'
              % (len(byl), sum(1 for v in links.values() if v['본문있나']), ', '.join(have_title) or '—'))
        if miss:
            nonum = [k for k in have_title if '(번호없음)' in k]
            why = ('— 이 조례의 별표는 **제목에 번호가 없다**(%s). 「단일 별표를 별표1 로 볼 것인가」는 사람이 정한다'
                   % ', '.join(nonum)) if nonum else '— 번호 오기이거나 **다른 문서**(시행규칙 등)다'
            print('    ⚠위키가 짚었는데 **이 조례의 별표 목록에 없는 번호**: %s %s. 기계가 고르지 않는다(G-34)'
                  % (', '.join(miss), why))
        if not apply_ or not links:
            continue
        bd = os.path.join(absbase, '별표')
        os.makedirs(bd, exist_ok=True)
        lp = os.path.join(bd, '_links.json')
        old = json.load(open(lp, encoding='utf-8')) if os.path.exists(lp) else {}
        old.update(links)                                        # 있던 항목은 지우지 않는다
        json.dump(old, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        touched.add(lp)
        wrote += 1
    json.dump(cache, open(MST_CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    print('\n=== `_links.json` 을 적은 조례 %d곳 · API 가 본문을 준 별표 %d개 ===' % (wrote, body))
    print('⚠본문이 0개이므로 **`.txt` 는 만들지 않는다.** V5-32 는 이 자리를 계속 「없다」로 센다 — 그게 맞다.')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(run())
