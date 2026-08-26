#!/usr/bin/env python3
"""위키 **본문이 인용하는 조문이 그 페이지 근거 조문 표에 있는지** 전수로 본다.

[왜 있나 — 2026-08-24, 사서 보고로 드러난 게이트 빈틈]
챗봇은 개념/법령 페이지의 `## 근거 조문` 표에서만 근거를 만든다(§6-E). 그래서 본문에 답이
멀쩡히 적혀 있어도 **표에 그 행이 없으면 챗봇은 그 조문을 꺼내지 못한다.**

실제 사고: 어선안전조업법 statutes 페이지가 2026-08-15 에 제5조·제6조 본문 서술을 추가했는데
표에는 그 두 행이 없었다. **여덟 달 가까이 챗봇이 그 조문을 근거로 인용하지 못했고**, 그 하나
때문에 백로그 항목 8건이 계속 미해소로 남아 있었다.

⚠**있던 게이트로는 이걸 못 잡는다.** `reach_eval.js` 는 "표에 **있는** 행이 뜨는가"를 보고,
`citation_table_scan.js` 는 "표 칸이 규칙에 맞나"를 본다. 둘 다 **표에 없는 것**은 볼 수가 없다.
검사가 통과했다고 빈 곳이 없다는 뜻이 아니었다 — H-45 ③("이 검사가 무엇을 안 보고 있나")이
가리키던 자리다.

[무엇을 세나 — 판정하지 않는다. 위치만 준다]
본문에서 **조문 제목이 붙은 인용**(`제71조(안전한 속력)`)을 모아, 그 페이지 근거 조문 표의
조문과 맞춰 본다. 표 어디에도 없으면 후보로 올린다.

[규칙을 왜 이만큼 좁혔나 — 실측으로 단계마다 재고 표본을 눈으로 봤다(L-189)]
  · 조문 표기 전부            → 11,910건 (표 있는 페이지 1,280개 중 1,131개에서 검출)
    쓸모없다. 스치듯 언급한 타법 조문·설명 문맥이 대부분이었다.
  · 조문 **제목이 붙은** 것만  → 1,490건
  · concepts·statutes 로 한정  →   979건   (annexes 는 원래 조문 번호를 나열하는 문서다)
  · 인용문(`>`)·기록 줄 제외   →   802건
표본을 단계마다 눈으로 봤고, 마지막 단계에서는 대부분이 진짜 빈틈이었다
(예: 해상교통안전법 페이지가 제71조(안전한 속력) 조문 내용을 본문에 옮겨 놓고 표에는 안 넣었다).

⚠**그래도 결함 목록이 아니라 확인 목록이다.** 남은 오탐이 있다 — 다른 법 조문을 이 법 이름
없이 언급한 경우 등. **자동으로 고치지 않는다.** 사람(사서)이 보고 `cite_row.js` 로 넣을지 정한다.
그 도구가 ①원문에 그 조가 진짜 있나 ②챗봇이 꺼낼 수 있나 를 넣기 전에 확인해 준다(§8-A ⓪).

[쓰는 법]
  python3 body_cite_gap.py                  → 전수 집계 + 법별 상위
  python3 body_cite_gap.py --law <이름>      → 한 법만
  python3 body_cite_gap.py --json PATH      → 법별 목록 저장(사서에게 배포할 때 쓴다)
[연계] ← wiki/concepts|statutes/*.md   ⚠읽기 전용 — 파일을 고치지 않는다.
"""
import os
import re
import sys
import json
import glob
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')

ART = re.compile(r'제(\d{1,3})조(?:의(\d{1,2}))?')
# ★조문 **제목이 붙은** 것만 인용으로 본다. 제목 없이 번호만 스친 것은 대개 상호참조다.
ART_TITLED = re.compile(r'제(\d{1,3})조(?:의(\d{1,2}))?\s*\(([^)]{2,40})\)')
# "제5조부터 제9조까지" 같은 범위 줄은 통째로 뺀다 — 그 안의 번호를 개별로 세면 오탐이 된다.
RANGE = re.compile(r'제\d{1,3}조(?:의\d{1,2})?\s*(?:부터|~|∼|-)\s*제\d{1,3}조')
# 바로 앞에 다른 법 이름이 오면 그 법 조문이다 — 이 페이지 표에 없는 게 정상이다.
OTHER_LAW = re.compile(r'[가-힣]{2,20}법(?:률)?(?:\s*시행령|\s*시행규칙)?\s*[」\]]?\s*$')
# 변경이력·대조 메모 줄은 인용이 아니다.
NOTE = re.compile(r'현행화|재수집|대조|라운드|확인:|changelog|updated:|검증|판정|→\s*제\d')


def key_of(m):
    return '제%s조%s' % (m.group(1), ('의' + m.group(2)) if m.group(2) else '')


def split_page(text):
    """페이지를 (근거 조문 표, 나머지 본문)으로 가른다.

    예: split_page(md) → ('| 단계 | 법령 | …', '# 제목\\n…')
    [연계] `## 근거 조문` 절 안의 파이프 줄만 표로 친다 — 본문 속 다른 표는 본문이다.
    """
    tbl, body, in_sec = [], [], False
    for ln in text.split('\n'):
        h = re.match(r'^##\s+(.*)$', ln)
        if h:
            in_sec = '근거 조문' in h.group(1)
            body.append(ln)
            continue
        (tbl if (in_sec and ln.lstrip().startswith('|')) else body).append(ln)
    return '\n'.join(tbl), '\n'.join(body)


# ★표 칸의 범위·나열 표기를 낱낱의 조문으로 편다(2026-08-24 신설, 같은 날 **좁혀 다시 씀**).
#
#   [왜] 표에 `제111~118조` 라 적혀 있어도 제112~117조가 "표에 없다"고 잡혔다.
#   실측: 해상교통안전법 사서가 57건 중 53건(93%)을 "이미 표에 범위로 있음"으로 걸러 냈다.
#
#   ⚠**어디까지 펼지는 내 취향이 아니라 챗봇 코드가 정한다.** 처음엔 `제N조~제M조`·`제5조부터
#   제9조까지` 까지 전부 폈다가 되돌렸다 — 챗봇이 그 꼴을 못 읽기 때문이다. 그걸 폈으면
#   **진짜 도달불가를 "이미 있음"으로 덮어** 결함을 숨겼을 것이다(사서 보고가 엇갈려 코드를 직접 봤다).
#
#   챗봇이 실제로 펴는 것만 편다 — `services/legal_retriever.js` 확인 결과:
#     ⓐ filterCitationChainByAnswer 의 범위 갈래 : /제(\d+)\s*[~∼]\s*(\d+)조/
#        → `제111~118조` · `전문(제1~12조)` 는 편다.  `제111조~제118조` 는 **안 편다**(정규식 불일치).
#     ⓑ expandJoEnum : **가운뎃점이 반드시 있어야** 한다
#        (`!/[·ㆍ・,]/.test(s) → return null`). 그래서 `제3·7·9조` · `제9·11·18~21조` 는 펴지만,
#        가운뎃점 없는 순수 범위는 이쪽으로는 안 펴진다(그건 ⓐ가 받는다).
#   ★챗봇 쪽 정규식이 바뀌면 여기도 같이 바꿔야 한다. 안 그러면 이 검사가 조용히 어긋난다.
RANGE_TILDE = re.compile(r'제(\d{1,3})\s*[~∼]\s*(\d{1,3})조')     # ⓐ 챗봇과 같은 꼴
LIST_MID = re.compile(r'제(\d{1,3}(?:\s*[·ㆍ・,]\s*\d{1,3})+)조')   # ⓑ 가운뎃점 나열


def table_articles(tbl):
    """표 칸이 **챗봇 기준으로** 실제로 덮는 조문 번호 집합.

    예: table_articles('| 법 | 제111~118조 |') → {'제111조', …, '제118조'}
    @param {str} tbl `## 근거 조문` 표 부분
    @returns {set[str]}
    [연계] scan() 이 "이 조문이 이미 표에 있나"를 판단하는 근거.
           ⚠`제N조~제M조` 꼴은 일부러 안 편다 — 챗봇이 못 읽으므로 그건 **진짜 도달불가**다.
    """
    have = {key_of(m) for m in ART.finditer(tbl)}
    for m in RANGE_TILDE.finditer(tbl):
        a, b = int(m.group(1)), int(m.group(2))
        if a <= b and b - a <= 200:              # 뒤집힌 표기·오타로 폭주하지 않게
            have |= {'제%d조' % n for n in range(a, b + 1)}
    for m in LIST_MID.finditer(tbl):
        for n in re.findall(r'\d{1,3}', m.group(1)):
            have.add('제%s조' % n)
    return have


def scan(path):
    """한 페이지의 후보 목록. 표가 없거나 표에 조문이 없으면 빈 목록(다른 문제다)."""
    text = open(path, encoding='utf-8').read()
    if '## 근거 조문' not in text:
        return []
    tbl, body = split_page(text)
    have = table_articles(tbl)
    if not have:
        return []
    out, seen = [], set()
    for ln in body.split('\n'):
        s = ln.lstrip()
        if RANGE.search(ln) or NOTE.search(ln) or s.startswith('>'):
            continue
        for m in ART_TITLED.finditer(ln):
            k = key_of(m)
            if k in have or k in seen:
                continue
            if OTHER_LAW.search(ln[:m.start()][-30:].strip()):
                continue
            seen.add(k)
            out.append({'article': k, 'title': m.group(3)[:40], 'line': ln.strip()[:160]})
    return out


def main():
    argv = sys.argv[1:]
    only = argv[argv.index('--law') + 1] if '--law' in argv else None
    out_path = argv[argv.index('--json') + 1] if '--json' in argv else None

    by_law = collections.defaultdict(list)
    pages = 0
    for d in ('concepts', 'statutes'):
        for p in sorted(glob.glob(os.path.join(WIKI, d, '*.md'))):
            base = os.path.basename(p)[:-3]
            law = base.split('__')[0]
            if only and only not in base:
                continue
            hits = scan(p)
            if hits:
                pages += 1
                by_law[law].append({'page': os.path.relpath(p, LEGAL), 'items': hits})

    total = sum(len(x['items']) for v in by_law.values() for x in v)
    print('■ 본문이 인용하는데 근거 조문 표에 없는 조문 — **확인 목록(판정 아님)**')
    print('   후보 %d건 · 페이지 %d개 · 법 %d개' % (total, pages, len(by_law)))
    print('   ⚠챗봇은 표에서만 근거를 만든다(§6-E). 표에 없으면 본문에 있어도 못 꺼낸다.')
    print('   ⚠남은 오탐이 있다 — 사람이 보고 `cite_row.js` 로 넣을지 정한다. 자동으로 고치지 않는다.')
    if by_law:
        print('\n   많은 법 상위 15')
        for law, v in sorted(by_law.items(), key=lambda x: -sum(len(y['items']) for y in x[1]))[:15]:
            n = sum(len(y['items']) for y in v)
            print('     %4d건  %2d페이지  %s' % (n, len(v), law[:50]))
    if out_path:
        json.dump({'total': total, 'pages': pages,
                   'by_law': {k: v for k, v in by_law.items()}},
                  open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n   저장: %s' % out_path)


main()
