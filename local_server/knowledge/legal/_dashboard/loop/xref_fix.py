#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위키 깨진 [[링크]] 자동 수리 — **답이 하나로 확정될 때만** 고친다(H-40 Phase 3).

[왜 필요한가 — 초보자용]
  위키 문서끼리는 `[[문서이름]]` 으로 이어져 있다. 이 이름이 실제 파일과 다르면 링크가 끊기고,
  챗봇은 그 문서에 **도달하지 못한다**. 특히 `_glossary.md`(사용자 일상어 → 법 개념 문서로 가는
  이정표)는 끊긴 링크가 116개나 돼, 위키 본문이 아무리 좋아도 챗봇이 그 문서를 못 편다.

[왜 사람(AI)이 아니라 기계인가]
  "이 이름의 파일이 있나 없나"는 **파일 목록 대조 = 결정론적 작업**이다. 지금까지는 법별 AI
  에이전트 74개가 각자 자기 법만 보며 고쳤는데, ①`_glossary.md`처럼 **어느 법의 소유도 아닌
  파일은 담당자가 없어** 21라운드 동안 방치됐고 ②판단이 매번 달라 같은 링크가 고쳐졌다 말았다
  했다. 기계는 전역을 한 번에 보고 같은 입력에 같은 결과를 낸다(CLAUDE.md 결정로그의
  "구멍 탐지류는 AI보다 로직 우선" 원칙과 같은 취지).

[고치는 것 — 후보가 정확히 1개일 때만]
  ① 법 이름 접두 누락: `[[비어업인 포획·채취 제한]]` → `[[수산자원관리법__비어업인포획채취제한]]`
  ② 옛 접두 표기: `[[concept_어촌계]]`·`[[activity_해루질]]`·`[[statute.서해5도지원특별법]]`
  ③ 작업 지시문 잔재: `[[링크]]`·`[[대상]]`·`[[^]]`·`[[statutes/법명]]` → **링크 해제**(글자만 남김)
  ④ 위키링크 문법 오용: `[[표: 근해장어통발어업 — 어선 규모별 어구량]]`(같은 문서 안의 표를
     링크로 감쌈) → 링크 해제
  ⑤ 우리 74법 **밖**의 다른 부처 법령(하천법·문화유산법 등) 링크 → `(편입예정)` 표시 부착.
     위키에 문서가 없는 게 정상이므로, 깨진 링크가 아니라 "아직 안 들어온 법"임을 명시한다.

[절대 손대지 않는 것 — 틀리게 고치느니 그대로 둔다]
  · 후보가 2개 이상(예: `[[낚시터업 허가/등록]]`은 유사 후보 9개) → 목록으로만 남김
  · 대응 문서가 아예 없는 것 → 목록으로만 남김(AI 판정·신규 작성은 다음 단계)
  · `(편입예정)` 표시가 붙은 링크 — 우리 74법 밖 외부 법령을 가리키는 **의도적 표시**
  · 상대경로 링크(`[[../annexes/…]]`) — 정상 동작한다
  · 파일 이름 자체 — 챗봇이 파일명 규칙으로 문서를 찾으므로 **항상 링크 쪽을 파일명에 맞춘다**

[연계] 점검: `xref_check.py`(같은 폴더, verify_all.sh V5 게이트에 등록)
       사용: `python3 xref_fix.py <wiki경로> [--apply]`  (기본은 미리보기, --apply 해야 실제 수정)
[로드 순서] ⚠**단독 실행**. 위키 전역을 수정하므로 다른 위키 작업 에이전트와 동시에 돌리지 말 것
            (CLAUDE.md 병렬 작업 안전 규칙 — 공유 파일 다중 쓰기 금지).
"""
import os, re, sys, json, collections

LINK = re.compile(r'\[\[([^\]]+)\]\](\s*\(편입예정\))?')
# 위키 본문에 남은 작업 지시문 예시 — 문서를 가리키는 링크가 아니라 지시문 잔재다.
BOILERPLATE = {'링크', '대상', '^', 'statutes/법명', 'statutes/...', '법명', '문서명'}


def flat(s):
    """이름 비교용 정규화 — 공백·가운뎃점·괄호만 지운다(글자 자체는 안 바꾼다)."""
    return re.sub(r'[\s·ㆍ()（）\-_/]', '', s)


def build_index(wiki):
    """위키 문서 목록을 만든다. → (전체 상대경로 집합, 파일명→경로들, 정규화이름→경로들)"""
    rels, bases, flats = set(), collections.defaultdict(list), collections.defaultdict(list)
    for dp, _dn, fn in os.walk(wiki):
        for f in fn:
            if not f.endswith('.md'):
                continue
            rel = os.path.relpath(os.path.join(dp, f), wiki)[:-3]
            base = os.path.basename(rel)
            rels.add(rel)
            bases[base].append(rel)
            flats[flat(base)].append(rel)
    return rels, bases, flats


def is_external_law(tgt, laws):
    """우리 74법 밖의 법령을 가리키는 링크인가 — `[[하천법]]`·`[[식품위생법__위해식품판매등금지]]` 등.
    링크 앞머리가 법령 이름 꼴(…법/…법률)인데 74법 목록에 없으면 외부 법령으로 본다.
    """
    head = tgt.split('__')[0]
    if '/' in head or ' ' in head:      # `[[해사안전기본법 / 해상교통안전법]]` 같은 링크 오용은 사람이 볼 몫
        return False
    return bool(re.search(r'(법|법률)$', head)) and head not in laws


def resolve(tgt, rels, bases, flats, cur):
    """깨진 링크 하나를 어떻게 처리할지 정한다.
    @returns ('replace', 새이름) | ('unwrap', None) | ('skip', 사유)
    ★후보가 정확히 1개일 때만 replace 한다 — 2개 이상이면 기계가 고르지 않는다.
    """
    if tgt in BOILERPLATE or tgt.startswith('statutes/') and tgt.endswith('...'):
        return ('unwrap', None)
    if tgt.startswith('표:') or tgt.startswith('표 :'):
        return ('unwrap', None)

    # `statute.법명` → `법명`
    core = tgt
    for pre in ('statute.', 'concept_', 'activity_', 'annex.', 'comparison_'):
        if core.startswith(pre):
            core = core[len(pre):]
            break

    # ① 이름 그대로 있는가(접두만 떼면 맞는 경우)
    if core in rels:
        return ('replace', core)
    cands = bases.get(core, [])
    if len(cands) == 1:
        return ('replace', os.path.basename(cands[0]))

    # ② 법 이름 접두(`법명__`)만 빠진 경우 — 파일명이 `__<이름>` 으로 끝나는 문서를 찾는다
    key = flat(core)
    hits = [r for r in rels
            if '__' in os.path.basename(r) and flat(os.path.basename(r).split('__', 1)[1]) == key]
    if len(hits) == 1:
        return ('replace', os.path.basename(hits[0]))
    if len(hits) > 1:
        return ('skip', f'후보 {len(hits)}개(모호)')

    # ③ 정규화 이름이 정확히 하나 있는 경우(띄어쓰기·가운뎃점만 다른 표기)
    fh = flats.get(key, [])
    if len(fh) == 1:
        return ('replace', os.path.basename(fh[0]))
    if len(fh) > 1:
        return ('skip', f'후보 {len(fh)}개(모호)')

    return ('skip', '대응 문서 없음')


def main():
    wiki = sys.argv[1] if len(sys.argv) > 1 else 'wiki'
    apply = '--apply' in sys.argv
    rels, bases, flats = build_index(wiki)
    laws = {os.path.basename(r) for r in rels if r.startswith('statutes' + os.sep)}

    fixed, unwrapped, skipped, externs = [], [], [], []
    for dp, _dn, fn in os.walk(wiki):
        for f in fn:
            if not f.endswith('.md'):
                continue
            path = os.path.join(dp, f)
            cur = os.path.relpath(dp, wiki)
            src = os.path.relpath(path, wiki)
            text = open(path, encoding='utf-8').read()
            out, last, changed = [], 0, False
            for m in LINK.finditer(text):
                raw = m.group(1)
                tgt = raw.split('|')[0].split('\\')[0].split('#')[0].strip()
                if not tgt:
                    continue
                # 이미 정상인 링크·(편입예정)·상대경로는 건드리지 않는다
                cand = os.path.normpath(os.path.join(cur, tgt)) if cur != '.' else tgt
                if cand in rels or tgt in rels or ('/' not in tgt and len(bases.get(tgt, [])) == 1):
                    continue
                if m.group(2) or tgt.startswith('../'):
                    continue
                act, val = resolve(tgt, rels, bases, flats, cur)
                if act == 'skip' and is_external_law(tgt, laws):
                    act, val = 'extern', None
                if act == 'skip':
                    skipped.append((src, tgt, val))
                    continue
                out.append(text[last:m.start()])
                if act == 'extern':
                    out.append(m.group(0) + ' (편입예정)')   # 링크는 그대로 두고 표시만 붙인다
                    externs.append((src, tgt))
                elif act == 'replace':
                    rest = raw[len(tgt):]                      # `|별칭`·`#앵커` 는 그대로 보존
                    out.append('[[' + val + rest + ']]')
                    fixed.append((src, tgt, val))
                else:
                    out.append(tgt)                            # 링크 해제 — 글자만 남긴다
                    unwrapped.append((src, tgt))
                last = m.end()
                changed = True
            if changed and apply:
                out.append(text[last:])
                open(path, 'w', encoding='utf-8').write(''.join(out))

    print(f'{"[적용]" if apply else "[미리보기]"} 교체 {len(fixed)}건 / 링크해제 {len(unwrapped)}건 '
          f'/ (편입예정) 표시 {len(externs)}건 / 손대지 않음 {len(skipped)}건')
    print('\n[교체 예시]')
    for s, a, b in fixed[:12]:
        print(f'  {a}  →  {b}   ({s})')
    print('\n[손대지 않음 — 사유별]')
    for why, c in collections.Counter(w for _, _, w in skipped).most_common():
        print(f'  {c:4d}  {why}')
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xref_fix_report.json'),
              'w', encoding='utf-8') as fp:
        json.dump({'fixed': fixed, 'unwrapped': unwrapped, 'extern': externs, 'skipped': skipped},
                  fp, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
