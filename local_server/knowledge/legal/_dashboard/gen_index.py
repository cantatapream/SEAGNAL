#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index.md 자동 재생성 — wiki/ 실제 파일 기준으로 전체 목차를 만든다.
   사서가 ingest/수정/lint 후 실행(오케스트레이터가 매 사이클 호출). 인자 없음.
   실행: python3 _dashboard/gen_index.py   (legal/ 디렉터리 기준 상대경로)
   [연계] 읽기: wiki/concepts/*.md, wiki/statutes/*.md, raw/<도메인>/<법>/  → 쓰기: index.md
"""
import os, re, collections

LEGAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../knowledge/legal
CD = os.path.join(LEGAL, 'wiki', 'concepts')
SD = os.path.join(LEGAL, 'wiki', 'statutes')
RAW = os.path.join(LEGAL, 'raw')

def norm(s):  # 파일 slug와 맞추기 위한 정규화(공백·경로문자 제거)
    return re.sub(r'[\s/:*?"<>|]', '', s)

def h1(path):
    try:
        for line in open(path, encoding='utf-8'):
            m = re.match(r'^#\s+(.+)$', line)
            if m: return m.group(1).strip()
    except Exception: pass
    return None

# 1) raw/ 스캔 → {정규화 법명: 도메인}
law2dom = {}
if os.path.isdir(RAW):
    for dom in sorted(os.listdir(RAW)):
        dp = os.path.join(RAW, dom)
        if not os.path.isdir(dp) or dom.startswith('_'): continue
        for law in os.listdir(dp):
            if os.path.isdir(os.path.join(dp, law)):
                law2dom[norm(law)] = dom

def domain_of(slug):
    if slug in law2dom: return law2dom[slug]
    for lname, dom in law2dom.items():  # 부분일치 폴백
        if slug.startswith(lname) or lname.startswith(slug): return dom
    return 'zz_기타'

# 2) 개념을 법 slug별로 묶기
by_law = collections.defaultdict(list)
for f in sorted(os.listdir(CD)):
    if not f.endswith('.md'): continue
    slug = f.split('__')[0]
    by_law[slug].append((f, h1(os.path.join(CD, f)) or f[:-3]))

# 3) 법 표시이름 = statute H1 → 첫 개념 → slug
def law_name(slug):
    sp = os.path.join(SD, slug + '.md')
    return (h1(sp) if os.path.exists(sp) else None) or slug

by_dom = collections.defaultdict(list)
for slug in by_law: by_dom[domain_of(slug)].append(slug)

concept_total = sum(len(v) for v in by_law.values())
statute_n = len([f for f in os.listdir(SD) if f.endswith('.md')]) if os.path.isdir(SD) else 0

def mdlink(rel):
    """`index.md` 에서 **눌러서 열리는** 링크를 만든다 (2026-09-23, G-25).

    고친 것 둘:
      ① ★`wiki/` 접두사 — `index.md` 는 `legal/` 에 있고 쪽들은 `legal/wiki/` 에 있다.
         예전에는 `concepts/…` 라고만 적어 **1,020개가 전부 안 열렸다**(실측 2026-09-23).
      ② ★괄호를 `<>` 로 감싼다 — 파일명에 `(` 가 든 쪽이 **12개** 있다
         (`선박평형수(船舶平衡水)…`, `…인증(GAP)…`). 마크다운 링크는 **첫 `)` 에서 끊기므로**
         감싸지 않으면 그 12개는 이름이 잘린 채 죽는다.
    ⚠`index.md` 는 사람이 **눌러서** 찾아가는 목차다(_SCHEMA §13 "누가 언제 봐도").
      읽는 코드가 없다고 해서 안 고쳐도 되는 것이 아니다 — 읽는 것이 사람이다.
    """
    rel = 'wiki/' + rel
    return '<' + rel + '>' if ('(' in rel or ')' in rel or ' ' in rel) else rel

out = ['# 해양법률 위키 — 인덱스 (자동생성)', '',
       '> `_dashboard/gen_index.py`가 `wiki/` 실제 파일 기준으로 재생성한다(사서 ingest/수정/lint 후). 현존 페이지 전체 목차.',
       f'> 개념 {concept_total} · 법(statute) {statute_n} · 도메인 {len([d for d in by_dom])}. 규칙 [`_SCHEMA.md`](./_SCHEMA.md) · 답변 [`_CHATBOT.md`](./_CHATBOT.md) · 일지 [`log.md`](./log.md)', '']
for dom in sorted(by_dom):
    out.append(f'## {dom.replace("zz_","")}')
    for slug in sorted(by_dom[dom], key=law_name):
        cs = by_law[slug]
        st = f' · [개요]({mdlink(f"statutes/{slug}.md")})' if os.path.exists(os.path.join(SD, slug + '.md')) else ''
        out.append(f'- **{law_name(slug)}** ({len(cs)}개){st}')
        for f, title in sorted(cs):
            t = title if len(title) <= 48 else title[:47] + '…'
            out.append(f'  - [{t}]({mdlink(f"concepts/{f}")})')
    out.append('')

open(os.path.join(LEGAL, 'index.md'), 'w', encoding='utf-8').write('\n'.join(out))
print(f'index.md 재생성: 개념 {concept_total} · 법 {len(by_law)} · 도메인 {len(by_dom)} · {len(out)}줄')
