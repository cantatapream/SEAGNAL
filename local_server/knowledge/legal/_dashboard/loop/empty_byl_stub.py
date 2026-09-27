#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-55 — **까닭도 없이 빈 별표 6개**에 내려받기 주소를 달아 정직하게 만든다.

[무엇이 문제였나]
  V5-39(`byl_body_census.js`) 를 만들고 나서야 드러났다. 별표 파일 7,516개 가운데 **6개**가
  **제목·출처 두 줄만 있고 본문이 통째로 없었다.** `삭제`라고 적혀 있지도 않았다.
  ⇒ 챗봇이 이 별표를 짚으면 **아무것도 못 보여주면서 「원문이 있다」고 세어졌다.**
  아무 게이트도 이 자리를 안 재고 있었다(뿌리 사슬 ③).

[원문 제공처를 먼저 물었다 — 지어내지 않는다]
  6개 모두 law.go.kr 을 다시 불러 **본문이 정말 없는지** 확인했다(2026-09-24 실측).
    · admrul 5개 — `별표내용` 이 **빈 문자열**이다. 첨부파일(HWP/PDF)뿐이다.
    · 감정평가 서식6 — `별표내용` 이 37자, 곧 **제목 머리줄뿐**이다(자격증 그림).
      ※같은 법 서식5·서식7 은 우리 파일에 본문이 있는데 API `별표내용` 은 1자다.
        본문은 **다른 경로(서식본문)** 로 받았던 것이다. 서식6 은 그 경로에도 글이 없다.
  ⇒ **우리가 빠뜨린 게 아니라 원문에 글이 없다.** 그러면 3-49·3-53 과 같은 길로 간다:
     **글은 못 주더라도 내려받기 주소는 준다.**

[왜 파일을 지우지 않나]
  지우면 V5-39 가 초록이 된다. 그러나 위키가 짚던 자리가 사라져 **사용자는 원문에 닿을 길을
  잃는다.** 빨간불을 끄려고 재는 대상을 없애지 않는다(G-49·G-34).

[연계] → `article_text.bylBodyKind` 가 `linkOnly` 로 가른다 · V5-39 가 센다
사용법: python3 empty_byl_stub.py [--apply]
"""
import json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_api_guard
from _touched import Touched

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.abspath(os.path.join(HERE, '../../raw'))
APPLY = '--apply' in sys.argv

# 파일 → (부르는 법, 그 문서 안에서 고를 별표제목)
TARGETS = [
    ('04_선박해운/선박법/별표/선박톤수측정요령_별표1.txt',
     ('admrul', '2100000025246'), '선박톤수계산서의 종류 및 부표(제22조관련)'),
    ('04_선박해운/선박안전법/별표/외국적시운전선박에대한임시항해검사지침_별표1.txt',
     ('admrul', '2100000056249'), '외국적 시운전 선박 임시항해검사 점검표'),
    ('05_수산어업/수산업협동조합법/별표/상호금융기관의신용사업회계처리기준_별지1.txt',
     ('admrul', '2100000022330'), '결론도출근거'),
    ('05_수산어업/수산업협동조합법/별표/상호금융기관의신용사업회계처리기준_별지2.txt',
     ('admrul', '2100000022330'), '실무지침'),
    ('05_수산어업/수산업협동조합법/별표/상호금융기관의신용사업회계처리기준_별지3.txt',
     ('admrul', '2100000022330'), '재무제표 양식 사례'),
    ('15_관련타부처/감정평가및감정평가사에관한법률/별표/서식6.txt',
     ('law', '284523'), '감정평가사 자격증'),
]

NOTE = (
    # ★주의: 이 주의문은 **반드시 한 줄에 하나**여야 한다. 이어지는 들여쓴 줄을 쓰면
    #   `bylBodyKind()` 가 그 줄을 **본문 글로 세어** 이 파일을 `text` 로 잘못 가른다
    #   (2026-09-24 실측 — 처음 붙였을 때 6개가 통째로 「글이 있다」로 세어졌다).
    '주의: 원문 제공처가 **이 별표를 본문 글로 주지 않는다** — 2026-09-24 재조회 실측에서 `별표내용` 이 비어 있고 첨부파일뿐이다. 우리가 빠뜨린 게 아니다. 지어내지 않는다.\n'
    '주의2: 이 파일은 `bylBodyKind()` 가 **`linkOnly`** 로 가른다 — V5-39 의 「주소만 있다」 통에 들어가 **「글이 있다」로 세어지지 않는다.**\n'
)


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
        time.sleep(min(1.5 + 0.4 * i, 6.0))
    return None


def units(target, ident):
    key = 'ID' if target == 'admrul' else 'MST'
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target={target}&{key}={ident}&type=JSON')
    if not d:
        return None
    root = d.get('AdmRulService') or d.get('법령') or d
    byl = root.get('별표')
    if isinstance(byl, dict):
        byl = byl.get('별표단위', byl)
    if isinstance(byl, dict):
        byl = [byl]
    return byl or []


def main():
    cache, done, miss = {}, 0, []
    touched = Touched('empty_byl_stub.py')
    for rel, (target, ident), title in TARGETS:
        path = os.path.join(RAW, rel)
        if ident not in cache:
            cache[ident] = units(target, ident)
        us = cache[ident]
        if us is None:
            miss.append(f'{rel}  ← API 를 못 받았다'); continue
        hit = next((u for u in us if (u.get('별표제목') or '').strip() == title), None)
        if not hit:
            miss.append(f'{rel}  ← 「{title}」 을 그 문서에서 못 찾았다'); continue
        link = (hit.get('별표서식파일링크') or '').strip()
        if not link:
            miss.append(f'{rel}  ← 내려받기 주소조차 없다'); continue
        if link.startswith('/'):
            link = 'https://www.law.go.kr' + link
        body = (hit.get('별표내용') or '').strip()
        old = open(path, encoding='utf-8').read().rstrip('\n')
        # ★두 번 돌려도 같은 결과가 나와야 한다. 앞서 붙인 주의·링크 줄을 먼저 걷어낸다
        #   (2026-09-24 — 걷어내지 않고 덧붙였다가 주의문이 두 벌로 쌓였다).
        head = '\n'.join(l for l in old.split('\n')
                         if l.strip() and not l.startswith(('주의:', '주의2:', '별표서식파일링크:')))
        new = f'{head}\n{NOTE}별표서식파일링크: {link}\n'
        print(f'▣ {rel}\n   원문 글 {len(body)}자 · 주소 {link}')
        if APPLY:
            open(path, 'w', encoding='utf-8').write(new)
            touched.add(path)
            done += 1
    for m in miss:
        print('  ❌', m)
    if APPLY:
        touched.save()
        print(f'\n고친 파일 {done}개 · 못 고친 것 {len(miss)}개')
    else:
        print('\n(미리보기다. 적용하려면 --apply)')
    return 1 if miss else 0


if __name__ == '__main__':
    sys.exit(main())
