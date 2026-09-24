# -*- coding: utf-8 -*-
"""고시 쪽의 **`## 적용범위·제외` · `## 타법 연결`** 에 넣을 **원문을 미리 뽑아 둔다**. (3-6 준비)

★이 도구는 **위키를 고치지 않는다.** 사용자 결심(3-6 = ⓐ)이 나면 바로 채울 수 있게
  원문만 모아 보여 준다. 기계가 법 내용을 **쓰지** 않는다(G-34 · 환각 0).

왜 이것이 「해석」이 아니라 「인용」인가 (실측 2026-09-24)
  V5-35 가 남긴 51자리 중 **22자리가 고시 11쪽 × 2절**이다. 그 11개 고시는
  **전부 제1조(목적)에 적용범위가 원문으로 적혀 있고**, 9개는 총칙에 적용·제외 조까지 있다:

      제1조(목적) 이 기준은 「선박안전법」 제26조에 의한 **강선의 선체구조** 등에 …

  ⇒ `## 적용범위·제외` 는 그 제1조 + 총칙의 적용·제외·특례 조를 **그대로 옮기면 된다.**
  ⇒ `## 타법 연결` 은 그 제1조 안에 **위임 근거가 적혀 있다**(「선박안전법」 제26조).

무엇을 조심했나
  ★**총칙 조만** 고른다. `강선의구조기준` 은 `제NNN조(적용)` 이 **60개가 넘는데**
    그것들은 **각 장의 개별 적용**이고 이 절이 말하는 「이 기준 전체의 적용범위」가 아니다.
    → 조 번호가 **첫 적용·제외 조보다 크게 벌어지면 버린다**(총칙은 앞에 모여 있다).
  ★`선박만재흘수선기준` 은 적용·제외 조가 **없다.** 제1조만 쓴다 — **지어내지 않는다.**
  ★자를 빌려 쓴다(L-136): 조 본문은 `article_text.extractArticleBlock(…, 'notice')` 로 꺼낸다.

[연계] ← `raw/**/행정규칙/<고시>.txt` · 목록: `_dashboard/loop/section_ready.js --list`
        → `_dashboard/notice_scope_prep.md` (사람이 읽고 확정하면 위키에 옮긴다)
사용법: python3 notice_scope_prep.py [--write]
"""
import os, re, sys, json, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')

# 위키 쪽 이름 → raw 고시 파일명(괄호가 빠진 쪽이 있어 손으로 짝지었다)
PAGES = {
    '강선의구조기준': '강선의구조기준',
    '강화플라스틱FRP선의구조기준': '강화플라스틱(FRP)선의구조기준',
    '선박구명설비기준': '선박구명설비기준',
    '선박만재흘수선기준': '선박만재흘수선기준',
    '선박설비기준': '선박설비기준',
    '선박소방설비기준': '선박소방설비기준',
    '선박전기설비기준': '선박전기설비기준',
    '알루미늄선의구조기준': '알루미늄선의구조기준',
    '어선구조기준': '어선구조기준',
    '어선기관기준': '어선기관기준',
    '어선복원성및만재흘수선기준': '어선복원성및만재흘수선기준',
}
JO = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)', re.M)
SCOPE = re.compile(r'적용|제외|특례')
# 「이 기준은 「○○법」 제N조에 …」 — 위임 근거
DELEG = re.compile(r'「([^」]+)」\s*(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*항)?)')
# ★괄호 없이 적은 고시가 있다 — `이 기준은 선박안전법 제27조에 따른 …`(선박만재흘수선기준),
#   그리고 **한 낱말이 한 줄**로 끊긴 raw 도 있다(강화플라스틱(FRP)선의구조기준: `선박안전법\n제26조에`).
#   그래서 맨몸 법령명도 받는다. 고시 이름은 `…기준` 으로 끝나 여기 안 걸린다(실측 확인).
DELEG_BARE = re.compile(r'([가-힣]{2,20}(?:법률|법|규칙|령))\s*(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*항)?)')


def delegations(purpose):
    """제1조(목적)에서 위임 근거를 뽑는다. 괄호가 있는 쪽을 먼저, 없으면 맨몸을 본다."""
    got, seen = [], set()
    for law, jo in DELEG.findall(purpose):
        k = (law.strip(), jo.replace(' ', ''))
        if k not in seen:
            seen.add(k); got.append(k)
    for law, jo in DELEG_BARE.findall(purpose):
        law = law.strip()
        # `같은 법 시행규칙 제3조의2` — 어느 법의 것인지 앞에서 이어받는다
        if law in ('시행령', '시행규칙') and got:
            law = got[0][0] + ' ' + law
        k = (law, jo.replace(' ', ''))
        if k not in seen and not any(law in a for a, _ in seen):
            seen.add(k); got.append(k)
    return got
GENERAL_MAX = 12          # 총칙은 앞에 모여 있다 — 이보다 뒤의 「적용」 조는 개별 장의 것이다


def find_raw(name):
    for r, _d, fs in os.walk(RAW):
        if '행정규칙' not in r:
            continue
        if name + '.txt' in fs:
            return os.path.join(r, name + '.txt')
    return None


def blocks(text):
    """(조표기, 제목, 시작위치) 목록."""
    out = []
    for m in JO.finditer(text):
        lab = f'제{m.group(1)}조' + (f'의{m.group(2)}' if m.group(2) else '')
        out.append((lab, m.group(3).strip(), m.start(), int(m.group(1))))
    return out


def body_of(text, start, nexts):
    end = nexts if nexts else len(text)
    return text[start:end].strip()


def main():
    write = '--write' in sys.argv
    out = ['# 3-6 준비 — 고시 11쪽의 「적용범위·제외」·「타법 연결」에 넣을 **원문**',
           '',
           '> ★**이 파일은 위키가 아니다.** 사용자 결심(3-6 = ⓐ 원문 그대로 인용)이 나면 바로',
           '> 옮겨 쓸 수 있도록 **원문만 모아 둔 것**이다. 기계가 법 내용을 쓰지 않는다(G-34).',
           '>',
           '> 만든 것: `_dashboard/loop/notice_scope_prep.py` · 자는 `article_text.extractArticleBlock`(챗봇과 같은 것).',
           '']
    tally = {'쪽': 0, '적용조': 0, '위임근거': 0, '적용조없음': []}
    for page, rawname in PAGES.items():
        p = find_raw(rawname)
        if not p:
            out.append(f'## ❌ {page} — raw 를 못 찾았다 (`{rawname}.txt`)')
            continue
        t = open(p, encoding='utf-8').read()
        bs = blocks(t)
        if not bs:
            out.append(f'## ❌ {page} — 조 머리줄을 못 읽었다')
            continue
        tally['쪽'] += 1
        # 제1조(목적)
        first = next((b for b in bs if b[3] == 1), bs[0])
        idx = bs.index(first)
        purpose = body_of(t, first[2], bs[idx + 1][2] if idx + 1 < len(bs) else None)
        # 총칙의 적용·제외·특례 조 (조 번호가 GENERAL_MAX 이하)
        gen = [b for b in bs if b[3] <= GENERAL_MAX and SCOPE.search(b[1]) and b[3] != 1]
        later = [b for b in bs if b[3] > GENERAL_MAX and SCOPE.search(b[1])]
        out.append(f'## {page}')
        out.append('')
        out.append(f'원문: `{os.path.relpath(p, LEGAL)}`')
        out.append('')
        out.append('### → `## 적용범위·제외` 에 넣을 원문')
        out.append('')
        out.append(f'**{first[0]}({first[1]})** — 원문 그대로')
        out.append('')
        out.append('```')
        out.append(purpose[:900])
        out.append('```')
        out.append('')
        if gen:
            tally['적용조'] += len(gen)
            for b in gen:
                i = bs.index(b)
                body = body_of(t, b[2], bs[i + 1][2] if i + 1 < len(bs) else None)
                out.append(f'**{b[0]}({b[1]})** — 원문 그대로')
                out.append('')
                out.append('```')
                out.append(body[:1100])
                out.append('```')
                out.append('')
        else:
            tally['적용조없음'].append(page)
            out.append('> ⚠**총칙에 적용·제외 조가 없다.** 제1조만 쓴다 — **지어내지 않는다.**')
            out.append('')
        if later:
            out.append(f'> ⓘ참고: 뒤쪽에 `제N조(적용)` 꼴이 **{len(later)}개** 더 있으나 '
                       f'**각 장의 개별 적용**이라 이 절에 넣지 않는다'
                       f'(예: {"·".join(b[0] for b in later[:5])} …).')
            out.append('')
        # 타법 연결 — 제1조 안의 위임 근거
        deleg = delegations(purpose)
        out.append('### → `## 타법 연결` 에 넣을 원문')
        out.append('')
        if deleg:
            tally['위임근거'] += len(deleg)
            out.append('| 어느 법 | 어느 조 | 무엇으로 |')
            out.append('|---|---|---|')
            for law, jo in deleg:
                out.append(f'| 「{law}」 | {jo.replace(" ", "")} | 이 고시의 **위임 근거**'
                           f'(제1조 목적에 그대로 적혀 있다) |')
            out.append('')
        else:
            out.append('> ⚠제1조에서 위임 근거를 못 읽었다 — 사람이 본다.')
            out.append('')
        out.append('---')
        out.append('')
    print(f'쪽 {tally["쪽"]} · 총칙 적용·제외 조 {tally["적용조"]}개 · 위임근거 {tally["위임근거"]}건')
    if tally['적용조없음']:
        print('★적용·제외 조가 없는 쪽(제1조만 쓴다):', ' · '.join(tally['적용조없음']))
    if write:
        q = os.path.join(LEGAL, '_dashboard', 'notice_scope_prep.md')
        open(q, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
        print('→', os.path.relpath(q, LEGAL), f'({os.path.getsize(q)//1024}KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
