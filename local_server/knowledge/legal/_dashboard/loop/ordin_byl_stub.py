# -*- coding: utf-8 -*-
"""조례 별표 빈자리에 **내려받기 주소만 담은 파일**을 만든다. (3-49 = ⓐ)

왜 글이 아니라 주소인가 — 원문 제공처가 글을 안 준다
  전수로 쟀다(2026-09-23, 조례 11곳): `별표단위` **41개 중 `별표내용` 이 있는 것 0개.**
  법령(`target=law`)은 본문을 주는데 **조례(`target=ordin`)는 첨부파일(HWP)만** 준다.
  ⇒ 사용자 확정 ⓐ: **첨부 주소를 적고 내려받기 단추를 띄운다.**

★세는 법을 먼저 고쳤다 (이 도구보다 먼저 한 일)
  `article_text.hasBylBody()` 가 `출처:`·`별표서식파일링크:` 같은 **머리 메타 줄을 본문으로**
  세고 있었다. 그 상태로 이 파일들을 만들면 게이트의 「없다 22」가 **0으로 떨어지면서
  원문은 하나도 없는** 거짓 초록불이 된다. 그래서 `bylBodyKind()` 를 새로 두어
  **`text` / `linkOnly` / `none`** 세 갈래로 가르고, `byl_tier_ready` 에 **「첨부만」 통**을
  만들어 기준선에 넣었다. 이 파일들은 `linkOnly` 로 **따로 세어진다.**

★번호를 일련번호로 믿지 않는다
  조례 `별표단위` 는 `별표구분` 이 전부 `서식` 이고 `별표번호` 는 **일련번호**다.
  진짜 번호는 **제목 안**에 있다(해남군: 서식0001=`[별지 제1호서식]` · 0002=`[별표 1]`).
  이 도구는 `_links.json` 의 **제목에서 번호를 읽고**, 번호가 없으면 **만들지 않는다.**

무엇을 안 하나 (G-34 — 기계가 고르지 않는다)
  · 제목에 번호가 없는 별표 — 「단일 별표를 별표1 로 볼 것인가」는 **사람이 정한다.**
  · 위키가 짚는 계층이 그 조례에 없는 것(강화군관공선: 위키는 **시행규칙** 별표1~4 를
    짚는데 이 조례엔 번호 없는 별표 하나뿐 — **다른 문서일 것이다**).

[연계] ← `raw/_자치법규/*/*/별표/_links.json`(`ordin_byl_links.py` 가 적는다)
        ← 빈자리 목록: `_dashboard/loop/byl_tier_ready.js --list`
        → `raw/_자치법규/<시도>/<조례>/별표/<계층>_별표N.txt`
사용법: python3 ordin_byl_stub.py [--apply]
"""
import os, re, sys, json, glob, subprocess, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
from _touched import Touched                                      # noqa: E402

NUM_BYL = re.compile(r'[\[(]?\s*별표\s*(\d+)')
NUM_FORM = re.compile(r'별지\s*제\s*(\d+)\s*호')


def wanted():
    """V5-32 에게 「없는 별표 파일」을 묻는다 → {절대경로: 짚은 위키쪽}"""
    out = {}
    p = subprocess.run(['node', os.path.join(HERE, 'byl_tier_ready.js'), '--list'],
                       capture_output=True, text=True, cwd=LEGAL)
    for ln in p.stdout.split('\n'):
        m = re.match(r'\s*·\s+(\S+\.txt)\s+\|\s+(\S+)', ln)
        if m and '_자치법규' in m.group(1):
            out.setdefault(m.group(1), set()).add(m.group(2))
    return out


def key_of(name):
    """`법률_별표1.txt` → ('법률', '별표', '1')"""
    m = re.match(r'^(법률|시행령|시행규칙)_(별표|서식|별지)(\d+(?:의\d+)?)\.txt$', name)
    return (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)


def links_of(folder):
    p = os.path.join(folder, '_links.json')
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return {}


def pick(links, kind, num):
    """제목에서 읽은 번호가 맞는 항목만 고른다. 없으면 None."""
    for k, v in links.items():
        t = str(v.get('제목') or '')
        if kind == '별표':
            m = NUM_BYL.search(t)
        else:
            m = NUM_FORM.search(t)
        if m and m.group(1) == num:
            return k, v
    return None


def main():
    apply_ = '--apply' in sys.argv
    touched = Touched('ordin_byl_stub') if apply_ else None
    tally = collections.Counter()
    made, skip = [], []
    for abspath, pages in sorted(wanted().items()):
        full = os.path.join(os.path.dirname(os.path.dirname(LEGAL)), abspath) \
            if not os.path.isabs(abspath) else abspath
        # byl_tier_ready 는 저장소 뿌리 기준 경로를 찍는다
        full = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(LEGAL))), abspath)
        folder = os.path.dirname(full)
        name = os.path.basename(full)
        tier, kind, num = key_of(name)
        rel = os.path.relpath(full, RAW) if full.startswith(RAW) else abspath
        if not tier:
            tally['이름을 못 읽음'] += 1
            skip.append((rel, '파일 이름에서 계층·번호를 못 읽었다')); continue
        if os.path.exists(full):
            tally['이미 있다'] += 1; continue
        links = links_of(folder)
        if not links:
            tally['★_links.json 이 없다 — 사람 몫'] += 1
            skip.append((rel, '`_links.json` 이 없다 — 주소조차 없다')); continue
        got = pick(links, '별표' if kind == '별표' else '서식', num)
        if not got:
            have = ' · '.join(f'{k}「{str(v.get("제목"))[:24]}」' for k, v in links.items())
            tally['★번호를 못 맞춤 — 사람이 정한다(G-34)'] += 1
            skip.append((rel, f'제목에 번호 {num} 이 없다. 있는 것: {have}')); continue
        k, v = got
        url = v.get('원본') or ''
        if not url:
            tally['★주소가 비어 있다'] += 1
            skip.append((rel, '그 항목에 원본 주소가 없다')); continue
        law = os.path.basename(folder.rsplit('/별표', 1)[0])
        label = f'{kind} {num}' if kind == '별표' else f'별지 제{num}호서식'
        body = (
            f'[{law}] {kind}{num} — {v.get("제목") or ""}\n'
            f'출처: 국가법령정보센터 자치법규 API target=ordin (수집 2026-09-24, 3-49)\n'
            f'주의: 원문 제공처가 **조례 별표를 본문 글로 주지 않는다** — 전수 실측(조례 11곳 '
            f'별표단위 41개) 결과 `별표내용` 이 있는 것 0개이고 첨부파일(HWP)뿐이다. '
            f'그래서 이 파일에는 **글이 없고 내려받기 주소만** 있다. 지어내지 않는다.\n'
            f'주의2: 이 파일은 `bylBodyKind()` 가 **`linkOnly`** 로 가른다 — 게이트의 '
            f'「첨부만」 통에 들어가 **「원문이 있다」로 세어지지 않는다.**\n'
            f'별표서식파일링크: {url}\n'
        )
        made.append((rel, k, label, url[:60]))
        tally['만든다'] += 1
        if apply_:
            os.makedirs(folder, exist_ok=True)
            open(full, 'w', encoding='utf-8').write(body)
            touched.add(os.path.relpath(full, os.path.dirname(os.path.dirname(os.path.dirname(LEGAL)))))
    print('=== 만들 것 ===')
    for rel, k, label, url in made:
        print(f'  ✅ {rel:72s} ← {k} ({label})')
    print('\n=== 사람이 정해야 하는 것 (기계가 고르지 않는다 — G-34) ===')
    for rel, why in skip:
        print(f'  ⬜ {rel}\n       {why}')
    print()
    for k in sorted(tally):
        print(f'  {k:36s} {tally[k]}')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
