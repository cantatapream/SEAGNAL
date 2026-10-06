#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-75 · Q-19 — 위키에서 **그림 판독에서 옮긴 줄**을 숫자로 가려 목록으로 만든다. (`_dashboard/picture_wiki_lines.json`)

[왜 — 출처를 밝히지 않고 옮겨진 값이 있다]
  `services/picture_text.js` 는 「이미지판독」「원본이미지」「OCR」… 처럼 **스스로 출처를 밝힌 줄**만 뺀다.
  그런데 위키에는 머리줄에만 「(… 이미지판독 전사)」라고 적고 **그 아래 표 행은 아무 표시 없이** 숫자만 있는 곳이 있다
  (예: 서천갯벌 습지보호지역 경계좌표 표). 그렇다고 그 절을 통째로 빼면 **글로 된 법 조문까지 함께 빠진다** — 실측:
  「수협 공제사업」 절은 머리줄에 「별표이미지판독 반영」이 있지만 지급여력비율 100%·경영개선 구간 같은 값은
  「raw 평문 원문에서 직접 확인 — 별표이미지 판독값 아님」이다. ★그래서 **절 단위가 아니라 줄 단위로, 숫자로** 가른다.

[어떻게 가르나 — 그 법의 raw 를 둘로 나눠 숫자를 견준다]
  · 그림 쪽 글: raw 의 `【이미지판독 N】…【이미지판독 끝 N】` 블록 · `【이미지판독: …】` 한 줄 설명 · `_이미지/*.txt`
    (우리 메모 줄 — 「소유자가 원본을」「REVIEW」「대조」… — 은 뺀다)
  · 글 쪽 글: 그 밖의 raw 전부(법률·시행령·시행규칙·별표·행정규칙)
  ① **어디서나** — 줄의 「또렷한 숫자」(좌표·소수·4자리 이상)가 그림 쪽에만 있고 글 쪽에는 거의 없다 → 그림에서 옮긴 줄
  ② **판독 출처를 밝힌 머리줄 아래 절 안에서는** — 줄에 숫자가 있는데 그 숫자가 글 쪽에 절반도 없다 → 그림에서 옮긴 줄
     (글 쪽에 있는 숫자 = 글로 된 원문에 있는 값 = 남긴다. 「글로 뽑히는 것은 글로 쓴다」 §5ⓓ)
  날짜·flSeq·판번호·`제N조` 같은 **자리 번호는 숫자로 치지 않는다**(그것이 겹친다고 같은 값이 아니다).

[무엇을 쓰나] `_dashboard/picture_wiki_lines.json` = { "생성", "규칙", "쪽": { "<wiki 상대경로>": ["<줄 열쇠>", …] } }
  줄 열쇠 = 빈칸을 뺀 줄 앞 80자. `picture_text.js` 가 그 쪽을 근거로 실을 때 이 열쇠의 줄을 「원문 그림」 안내로 바꾼다.

쓰는 법:
    python3 _dashboard/loop/picture_wiki_lines.py            # 다시 계산해 파일을 쓴다
    python3 _dashboard/loop/picture_wiki_lines.py --check    # 파일이 지금 위키·raw 와 맞나(망 없이) — V5-56
    python3 _dashboard/loop/picture_wiki_lines.py --show     # 쪽마다 무엇을 빼는지 보여 준다

[연계] → `_dashboard/picture_wiki_lines.json` → `services/picture_text.js`(stripWikiPictureText)
       ← `raw/**`(끝 표시는 `ocr_block_end.py`) · `wiki/**/*.md`
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
WIKI = os.path.join(LEGAL, 'wiki')
OUT = os.path.join(LEGAL, '_dashboard', 'picture_wiki_lines.json')

BLOCK = re.compile(r'【이미지판독\s*(\d+)】[\s\S]*?【이미지판독 끝\s*\1】')
INLINE = re.compile(r'【이미지판독\s*[:：—–-][^】]*】')
NOTE = re.compile(r'소유자가 원본|사용자 확인|사용자가 원본|REVIEW|판독|오케스트레이터|옮겨 적|바로잡|대조')
# 숫자로 치지 않는 자리 번호 — 날짜 · 첨부 번호 · 판번호 · 그림 파일 · 조·항·호·목 · 별표 번호 · 고시 번호
PLACE = re.compile(r'(19|20)\d\d\s?[-.년]\s?\d{1,2}\s?[-.월]\s?\d{1,2}|(19|20)\d{6}|flSeq=\d+|\d{5,}\.(png|gif|txt)'
                   r'|ID\s?\d+|\b21000\d+|제\s?\d+\s?(조|항|호|목|장|절)(의\s?\d+)?|별표\s?\d+(의\d+)?|별지\s?제?\d+'
                   r'|제\d{4}-\d+호|\d+\s?(행|R|라운드|차)\b')
NUM = re.compile(r"\d+(?:\s?[.,°'′″\"분초도-]\s?\d+)*")
SIGNAL = re.compile(r'이미지판독|원본이미지|_이미지/|비전\s?판독|\bOCR\b|판독\s?불명|판독\s?불가|도안\s?전사|전사본|원본\s?스캔\s?대조|그림-표 대조')
NEG = re.compile(r'(이미지판독|판독|OCR)[^,.;:\n]{0,12}?(아님|아니다|아니며|없음|없다|없어|불필요|0건)')


def key_of(line):
    return re.sub(r'\s', '', line)[:80]


def tokens(s, strong):
    s = PLACE.sub(' ', s)
    out = set()
    for n in NUM.findall(s):
        k = re.sub(r'[^0-9.]', '', n.replace(',', ''))
        digits = k.replace('.', '')
        if not digits:
            continue
        if strong and not (len(digits) >= 4 or ('.' in k and len(digits) >= 3)):
            continue
        out.add(k)
    return out


def law_dirs():
    d = {}
    for p in glob.glob(os.path.join(RAW, '*', '*')):
        if os.path.isdir(p):
            d.setdefault(os.path.basename(p), []).append(p)
    return d


def corpora(dirs):
    pic, txt = [], []
    for d in dirs:
        for p in glob.glob(os.path.join(d, '**', '*.txt'), recursive=True):
            try:
                t = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            if '/_이미지/' in p:
                pic.append('\n'.join(x for x in t.split('\n') if not NOTE.search(x)))
                continue
            rest, i = [], 0
            for m in BLOCK.finditer(t):
                rest.append(t[i:m.start()])
                pic.append('\n'.join(x for x in m.group(0).split('\n') if not NOTE.search(x)))
                i = m.end()
            rest.append(t[i:])
            r = ''.join(rest)
            pic.extend(m.group(0) for m in INLINE.finditer(r))
            txt.append(INLINE.sub(' ', r))
    P, T = ' '.join(pic), ' '.join(txt)
    return (tokens(P, True), tokens(T, True), tokens(P, False), tokens(T, False))


def page_body(path):
    t = open(path, encoding='utf-8').read()
    m = re.match(r'^---\n[\s\S]*?\n---\n', t)
    return t[m.end():] if m else t


def judge_page(body, C):
    sp, st, wp, wt = C
    drop, sec_level = [], None
    for line in body.split('\n'):
        h = re.match(r'^(#{1,6})\s', line)
        if h:
            lv = len(h.group(1))
            if SIGNAL.search(line) and not NEG.search(line):
                sec_level = lv
            elif sec_level is not None and lv <= sec_level:
                sec_level = None
            continue
        if not line.strip() or (SIGNAL.search(line) and not NEG.search(line)):
            continue                                    # 출처를 밝힌 줄은 picture_text.js 가 이미 뺀다
        s = tokens(line, True)
        only = [n for n in s if n in sp and n not in st]
        if s and len(only) >= 1 and sum(n in sp for n in s) / len(s) >= 0.6 and sum(n in st for n in s) / len(s) < 0.5:
            drop.append(key_of(line))                   # ①
            continue
        if sec_level is not None:
            w = tokens(line, False)
            if w and sum(n in wt for n in w) / len(w) < 0.5 and any(n in wp for n in w):
                drop.append(key_of(line))               # ②
    return drop


def build():
    dirs = law_dirs()
    cache, pages = {}, {}
    for f in sorted(glob.glob(os.path.join(WIKI, '**', '*.md'), recursive=True)):
        law = os.path.basename(f)[:-3].split('__')[0]
        if law not in dirs:
            continue
        if law not in cache:
            cache[law] = corpora(dirs[law])
        if not cache[law][0] and not cache[law][2]:
            continue
        d = judge_page(page_body(f), cache[law])
        if d:
            pages[os.path.relpath(f, WIKI)] = sorted(set(d))
    return pages


def run():
    pages = build()
    if '--check' in sys.argv:
        old = json.load(open(OUT, encoding='utf-8')).get('쪽', {}) if os.path.exists(OUT) else {}
        if old != pages:
            add = sum(len(set(v) - set(old.get(k, []))) for k, v in pages.items())
            gone = sum(len(set(v) - set(pages.get(k, []))) for k, v in old.items())
            print('❌ picture_wiki_lines.json 이 낡았다 — 새로 뺄 줄 %d · 더는 없는 줄 %d → 다시 돌린다:' % (add, gone))
            print('   python3 local_server/knowledge/legal/_dashboard/loop/picture_wiki_lines.py')
            return 1
        print('✅ picture_wiki_lines.json 최신 — %d쪽 · %d줄' % (len(pages), sum(len(v) for v in pages.values())))
        return 0
    if '--show' in sys.argv:
        for k, v in pages.items():
            print('==', k)
            for x in v:
                print('   ', x)
        return 0
    out = {'생성': 'picture_wiki_lines.py', '규칙': {
        '①': '또렷한 숫자(좌표·소수·4자리 이상)가 그 법 raw 의 그림 쪽에만 있다',
        '②': '판독 출처를 밝힌 머리줄 아래 절에서, 줄의 숫자가 글 쪽 raw 에 절반도 없다',
        '자리번호': '날짜·flSeq·판번호·제N조·별표 N 은 숫자로 치지 않는다'},
        '쪽': pages}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('→ %s  %d쪽 · %d줄' % (os.path.relpath(OUT, LEGAL), len(pages), sum(len(v) for v in pages.values())))
    return 0


if __name__ == '__main__':
    sys.exit(run())
