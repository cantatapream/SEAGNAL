#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위키 쪽이 적은 **숫자로 된 법적 효과**가 raw 원문에 글자 그대로 있는지 기계로 센다.

왜 있나 (`_SCHEMA.md` §5-D ⓑ 1차, 사용자 확정 2026-09-19):
  원문과 같으면 자동으로 canonical 로 올리되, **처벌ㆍ과태료ㆍ형량ㆍ금액ㆍ기간ㆍ수량ㆍ규격**이
  들어 있으면 재점검을 두 번 더 거치게 했다. 이 도구가 그 **1차(기계 EXACT 대조)** 다.
  2차(조ㆍ항ㆍ호 귀속과 단위가 맞는지)는 사람이나 다른 에이전트가 읽어서 하는 것이라 여기서 하지 않는다.

  ⚠이 도구가 통과시켰다고 그 쪽이 맞는 것이 아니다 — **"그 숫자가 원문 어딘가에 있다"까지만** 본다.
    실제 사고는 *"숫자는 원문에 있는데 엉뚱한 조문에 붙어 있던 것"* 이었다(§5 L-148). 그래서 2차가 따로 있다.

무엇을 하나
  ① 쪽 본문(변경 이력 표와 상태 배너 제외)에서 수치 토큰을 뽑는다 — 3년ㆍ3천만원ㆍ10노트ㆍ100분의 50 등.
  ② 그 쪽이 속한 법의 `raw/<도메인>/<법>/` 아래 모든 .txt 에서 그 토큰을 **글자 그대로** 찾는다.
     찾지 못하면 인용 타법 폴더(`15_관련타부처`)까지 넓혀 한 번 더 본다.
  ③ 못 찾은 토큰을 열거한다. **못 찾았다는 것이 곧 틀렸다는 뜻은 아니다**(표현이 달라졌거나 별표에 있을 수 있다) —
     사람·2차 검증자가 봐야 할 자리를 좁혀 주는 것이 목적이다.

사용법:
  python3 _dashboard/loop/num_exact_check.py <위키파일경로> [...]
  python3 _dashboard/loop/num_exact_check.py --batch <쪽목록 JSON>   (batch1_*.json 꼴: [{"path": "wiki/..."}])

[연계] 규칙 `_SCHEMA.md` §5-D ⓑ · 입력 wiki/**/*.md · raw/**/*.txt · 출력 stdout + JSON
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')

# 숫자로 된 법적 효과 — 이 꼴이면 뽑는다.
# ⚠토큰은 **수량 그 자체**만 잡는다(`5천만원`·`3년`). `벌금 5천만원` 처럼 낱말을 붙여 잡으면
#   원문이 `5천만원 이하의 벌금` 으로 어순만 달라도 "못 찾음"이 되어 오탐이 난다(2026-09-19 실측).
NUMWORD = r'\d[\d,]*(?:\.\d+)?(?:천|백|십)?(?:만|억)?'
UNITS = ('년|개월|월|일|시간|분|초|회|명|개|대|척|톤|미터|m|km|노트|'
         '킬로그램|kg|그램|리터|퍼센트|%|배|원|점')
TOKEN = re.compile(r'(?<![A-Za-z0-9\-~.])(%s)\s*(%s)(?![A-Za-z0-9])' % (NUMWORD, UNITS))
FRAC = re.compile(r'\d+\s*분의\s*\d+')
# 대기열 카드 번호(REVIEW-어선법-801~807)는 수치가 아니다 — 뽑기 전에 지운다.
CARDNO = re.compile(r'REVIEW-[^\s,)\]]*')
# ⚠단위가 한 글자면 뒷 글자와 붙어 **다른 낱말**이 되기도 한다 — `807 일치` 를 `807일` 로 잘못 읽었다
#   (2026-09-19 실측). 단위 뒤에 이 글자가 오면 단위가 아니라고 본다.
BAD_NEXT = {'일': '치반부자시정단', '월': '간', '분': '야류석담', '회': '의차원계',
            '개': '정별선요발념', '대': '상해한비응행략', '명': '시확칭단', '점': '검수차',
            '배': '치점출', '척': '도', '원': '문칙본래인상장', '년': '도간', '호': '선'}

SKIP_LINE = re.compile(r'^\s*\||^>\s*\*\*draft|^>\s*⚠\s*\*\*draft|^\s*<!--')
LOGHEAD = re.compile(r'^#{2,3}\s*변경\s*이력')
OTHERHEAD = re.compile(r'^#{2,3}\s')
# 날짜·조문번호처럼 "법적 효과"가 아닌 것은 뺀다.
NOISE = re.compile(r'^(19|20)\d\d\s*년$|^제?\d+\s*호$')


def body_lines(path):
    """변경 이력과 상태 배너를 뺀 본문 줄."""
    txt = open(path, encoding='utf-8').read()
    if txt.startswith('---'):
        txt = txt.split('---', 2)[-1]
    out, inlog = [], False
    for l in txt.split('\n'):
        if LOGHEAD.match(l):
            inlog = True
            continue
        if OTHERHEAD.match(l):
            inlog = False
        if inlog or SKIP_LINE.match(l):
            continue
        out.append(l)
    return out


_RAWDIRS = None


def _all_law_dirs():
    """raw/<도메인>/<법> 폴더 이름 → 경로."""
    global _RAWDIRS
    if _RAWDIRS is None:
        _RAWDIRS = {}
        for dom in sorted(os.listdir(RAW)):
            dp = os.path.join(RAW, dom)
            if not os.path.isdir(dp):
                continue
            for law in sorted(os.listdir(dp)):
                d = os.path.join(dp, law)
                if os.path.isdir(d):
                    _RAWDIRS.setdefault(law, []).append(d)
    return _RAWDIRS


def law_dirs(page_file, body_text=''):
    """그 쪽이 대조해야 할 raw 폴더들.

    ⓐ 파일이름 앞머리(`<법>__<주제>.md`)가 곧 법 폴더다 — 보통은 이것 하나면 된다.
    ⓑ **`__` 가 없는 교차주제 쪽**(예: `음주운항_측정거부.md`)은 자기 법이 없다.
       그런 쪽은 본문이 「…」로 부른 법령 이름을 전부 모아 그 폴더들을 대조 대상으로 삼는다.
       (2026-09-19: 이 처리가 없어서 교차주제 쪽의 수치가 통째로 "못 찾음"으로 나왔다.)
    """
    all_dirs = _all_law_dirs()
    slug = os.path.basename(page_file).split('__')[0].replace('.md', '')
    hits = list(all_dirs.get(slug, []))
    if hits:
        return hits
    for name in set(re.findall(r'「([^」]{2,40})」', body_text)):
        key = re.sub(r'\s', '', name)
        for cand in (key, key.replace('시행령', ''), key.replace('시행규칙', '')):
            if cand in all_dirs:
                hits.extend(all_dirs[cand])
                break
    return sorted(set(hits))


def corpus(dirs):
    buf = []
    for d in dirs:
        for dp, _dn, fns in os.walk(d):
            for fn in fns:
                if fn.endswith('.txt'):
                    try:
                        buf.append(open(os.path.join(dp, fn), encoding='utf-8').read())
                    except Exception:
                        pass
    return '\n'.join(buf)


_OTHER = None


def other_corpus():
    global _OTHER
    if _OTHER is None:
        d = os.path.join(RAW, '15_관련타부처')
        buf = []
        if os.path.isdir(d):
            for dp, _dn, fns in os.walk(d):
                for fn in fns:
                    if fn.endswith('.txt'):
                        try:
                            buf.append(open(os.path.join(dp, fn), encoding='utf-8').read())
                        except Exception:
                            pass
        _OTHER = '\n'.join(buf)
    return _OTHER


def norm(s):
    """대조용 정규화 — 공백을 없애고 `%` 를 `퍼센트` 로 통일한다.

    ⚠가운뎃점ㆍ한자는 **그대로 둔다**(원문 충실, `_SCHEMA.md` §5 "원문 발췌는 복붙이다").
      `%`↔`퍼센트` 만 예외로 두는 이유는 같은 값을 적는 두 표기일 뿐이고, 법령 원문은 `퍼센트`,
      위키는 `%` 를 쓰는 일이 잦아 이것 때문에 "못 찾음"이 무더기로 나왔기 때문이다(2026-09-19).
    """
    return re.sub(r'\s+', '', s).replace('%', '퍼센트')


def check(page_path):
    full = page_path if os.path.isabs(page_path) else os.path.join(LEGAL, page_path)
    toks = []
    for l in body_lines(full):
        l = CARDNO.sub(' ', l)
        for m in TOKEN.finditer(l):
            unit, end = m.group(2), m.end()
            nxt = l[end] if end < len(l) else ''
            if nxt and nxt in BAD_NEXT.get(unit, ''):
                continue
            t = (m.group(1) + unit).strip()
            if NOISE.match(norm(t)):
                continue
            toks.append(t)
        toks.extend(m.group(0) for m in FRAC.finditer(l))
    uniq = sorted(set(norm(t) for t in toks))
    dirs = law_dirs(full, '\n'.join(body_lines(full)))
    own = norm(corpus(dirs))
    miss = [t for t in uniq if t not in own]
    if miss:
        oth = norm(other_corpus())
        miss = [t for t in miss if t not in oth]
    return {'file': os.path.relpath(full, LEGAL), 'raw폴더': [os.path.relpath(d, LEGAL) for d in dirs],
            '수치토큰': len(uniq), '원문에서못찾음': miss}


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return 1
    if a[0] == '--batch':
        rows = json.load(open(a[1], encoding='utf-8'))
        paths = [r['path'] for r in rows]
    else:
        paths = a
    out = [check(p) for p in paths]
    for r in out:
        mark = '✅' if not r['원문에서못찾음'] else '⚠'
        print('%s %-58s 수치 %3d개 · 못찾음 %d %s' %
              (mark, os.path.basename(r['file'])[:58], r['수치토큰'], len(r['원문에서못찾음']),
               ('→ ' + ', '.join(r['원문에서못찾음'][:8])) if r['원문에서못찾음'] else ''))
    tot = sum(r['수치토큰'] for r in out)
    bad = sum(len(r['원문에서못찾음']) for r in out)
    print('\n합계: %d쪽 · 수치 %d개 · 원문에서 못 찾은 것 %d개' % (len(out), tot, bad))
    print('⚠못 찾았다고 곧 틀린 것은 아니다 — 2차 검증자가 볼 자리를 좁힌 것이다.')
    dst = os.path.join(LEGAL, '_dashboard', 'num_exact_check.json')
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('저장:', os.path.relpath(dst, LEGAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
