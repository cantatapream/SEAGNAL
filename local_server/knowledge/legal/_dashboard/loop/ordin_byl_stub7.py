#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-49 남은 7자리 (결심 ⑤ⓑ) — **조례 별표 7자리를 정직하게 채운다.**

[결심] 2026-09-24 사장님 ⓑ — *「제공처가 안 준다」고 적어둔다.*
  ★그런데 **정직 표시를 적기 전에 정말 못 받는지 다시 물었다.** 그 결과 **7자리 중 6자리는
  주소를 받을 수 있었다.** 「없다」의 첫 용의자는 언제나 우리 자다.

[자리마다 무엇이 참인가 — 원문 조문으로 대조했다. 지어내지 않는다]
  ① 강화군 관공선 관리 조례 **시행규칙** 별표1~4 (4자리)
     · 위키는 「시행규칙 별표1~4」라 적었고, **시행규칙 본문이 실제로 별표 1·2·3·4 를 짚는다**
       (`별표 1의 기준에 따른다`·`별표 2의 기준`·`별표 3의 관공선 안전수칙`·`별표 4의 손해배상금`).
     · 우리 폴더에는 `시행규칙.txt` 는 있는데 **그 별표를 한 번도 안 받았다.**
       종전에 「다른 문서일 것」이라 적어 둔 것은 **틀렸다** — 같은 문서다(자치법규 ID 2021944).
     · 제공처는 **네 별표를 HWP 한 파일에 묶어** 준다(`별표 1 ~ 별표 4`). 글은 안 준다.
       ⇒ 네 자리가 **같은 주소**를 가리킨다. 그것을 숨기지 않고 파일마다 적는다.
  ② 고성군 해수욕장 관리·운영 및 지원 조례 별표1 (1자리)
     · 본문 제36줄이 **`별표 1과 같다`** 로 번호를 못박는다. 주소 있음.
  ③ 부산광역시 사하구 해수욕장 관리 조례 별표2 (1자리)
     · 본문 제39줄이 **`별표2에 따라 과태료를 부과한다`**. 주소 있음.
  ④ 부산광역시 사하구 해수욕장 관리 조례 「별표1」 (1자리) — ★**원문에 그런 번호가 없다**
     · 제7조제1항은 **`별표와 같다`** 라고만 한다. 번호가 없다. 위키가 `별표1` 이라 부른 것이다.
     · ⇒ 번호를 우리가 지어 붙이지 않는다(결심 ⑥ⓑ). 파일에 **그 사실을 적고** 주소를 준다.

[왜 `_links.json` 에 있는데 못 찾았나]
  수집기가 조례 별표를 전부 **`서식1`·`서식2`** 라는 이름으로 철해 두었다. 그래서
  `별표1`·`별표2` 로 찾던 3-49 가 못 보고 지나쳤다. **파일 이름이 내용과 다른 그 병**이다(3-34).

[연계] → `article_text.bylBodyKind` 가 `linkOnly` 로 가른다 · V5-32·V5-39 가 센다
사용법: python3 ordin_byl_stub7.py [--apply]
"""
import json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_api_guard
from _touched import Touched

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
ORD = os.path.join(LEGAL, 'raw', '_자치법규')
APPLY = '--apply' in sys.argv

KANGHWA = '인천광역시/강화군관공선관리조례'
SAHA = '부산광역시/부산광역시사하구해수욕장관리조례'
GOSEONG = '강원특별자치도/고성군해수욕장관리·운영및지원조례'

BUNDLE = ('주의3: 제공처가 **별표 1~4 를 HWP 한 파일에 묶어** 준다. 그래서 네 별표가 같은 주소를\n'
          ' 가리킨다 — 잘못 붙인 것이 아니다. 내려받으면 그 안에 네 별표가 다 들어 있다.\n')
NONUM = ('주의3: ★**원문에는 이 별표에 번호가 없다.** 조례 제7조제1항은 「별표와 같다」라고만 한다.\n'
         ' 위키가 편의상 「별표1」이라 불렀을 뿐이다. **번호를 우리가 지어 붙이지 않는다**(결심 ⑥ⓑ).\n')


def api(url):
    for i in range(12):
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


def links_of(folder):
    p = os.path.join(ORD, folder, '별표', '_links.json')
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return {}


def plan():
    out = []          # (폴더, 파일이름, 조례이름, 별표표기, 제목, 주소, 덧말)
    # ① 강화군 시행규칙 — 제공처에서 직접 받는다(`_links.json` 은 조례 것뿐이다)
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=ordin&ID=2021944&type=JSON')
    root = (d or {}).get('LawService') or d or {}
    us = (root.get('별표') or {}).get('별표단위') if isinstance(root.get('별표'), dict) else root.get('별표')
    if isinstance(us, dict):
        us = [us]
    hit = next((u for u in (us or []) if '별표 1' in (u.get('별표제목') or '')), None)
    if hit and hit.get('별표첨부파일명'):
        for n in (1, 2, 3, 4):
            out.append((KANGHWA, f'시행규칙_별표{n}.txt', '강화군 관공선 관리 조례 시행규칙',
                        f'별표{n}', hit['별표제목'], hit['별표첨부파일명'], BUNDLE))
    else:
        print('  ❌ 강화군 시행규칙 별표 주소를 못 받았다')
    # ②③④ — 이미 받아 둔 `_links.json` 안에 있다(`서식N` 이라는 이름으로 철해져 있었다)
    gl = links_of(GOSEONG).get('서식1')
    if gl:
        out.append((GOSEONG, '법률_별표1.txt', '고성군 해수욕장 관리·운영 및 지원 조례',
                    '별표1', gl['제목'], gl['원본'], ''))
    sl = links_of(SAHA)
    if sl.get('서식2'):
        out.append((SAHA, '법률_별표2.txt', '부산광역시 사하구 해수욕장 관리 조례',
                    '별표2', sl['서식2']['제목'], sl['서식2']['원본'], ''))
    if sl.get('서식1'):
        out.append((SAHA, '법률_별표1.txt', '부산광역시 사하구 해수욕장 관리 조례',
                    '별표(번호없음)', sl['서식1']['제목'], sl['서식1']['원본'], NONUM))
    return out


def main():
    rows = plan()
    touched = Touched('ordin_byl_stub7.py')
    n = 0
    for folder, fname, law, mark, title, link, extra in rows:
        path = os.path.join(ORD, folder, '별표', fname)
        body = (
            f'[{law}] {mark} — {title}\n'
            f'출처: 국가법령정보센터 자치법규 API target=ordin (수집 2026-09-24, 3-49 남은 7자리)\n'
            '주의: 원문 제공처가 **조례 별표를 본문 글로 주지 않는다** — 첨부파일(HWP)뿐이다.\n'
            ' 그래서 이 파일에는 **글이 없고 내려받기 주소만** 있다. 지어내지 않는다.\n'
            '주의2: 이 파일은 `bylBodyKind()` 가 **`linkOnly`** 로 가른다 — 「원문이 있다」로 세어지지 않는다.\n'
            + extra +
            f'별표서식파일링크: {link}\n'
        )
        print(f'▣ {folder}/별표/{fname}\n   {mark} · {title[:44]}')
        if APPLY:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, 'w', encoding='utf-8').write(body)
            touched.add(path); n += 1
    if APPLY:
        touched.save()
        print(f'\n만든 파일 {n}개')
    else:
        print(f'\n만들 파일 {len(rows)}개 (미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
