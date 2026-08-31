#!/usr/bin/env python3
"""옛날 이름으로 흩어져 있는 계층 파일을 `<계층>_발췌.txt` 하나로 모은다.

[왜 있나 — 2026-09-01]
챗봇은 타법 원문을 `<법>/법률.txt`·`<법>/법률_발췌.txt`(시행령·시행규칙도 같은 꼴) **딱 두 이름**
으로만 찾는다(`article_text.js` TIER_FILE). 그런데 raw 에는 그 이전에 만들어진 이름들이 남아 있다 —
`법률_연결조문만.txt` · `법률_제2조(연결조문).txt` · `시행령_제8조(연결조문).txt` 처럼.
**그 파일들은 디스크에 멀쩡히 있는데 챗봇이 한 번도 안 읽는다.** 2026-09-01 전수 확인 결과
`raw/15_관련타부처` 에 그런 파일이 54개 있고, 그중 상당수는 그 폴더에 정식·발췌 파일이
아예 없어 **그 법의 인용이 통째로 죽어 있었다.**
(같은 종류의 사고를 `add_other_law_article.js` 가 조문별 파일에 대해 이미 한 번 겪었다 — L-223.)

[무엇을 하나]
폴더마다 계층별로 옛 이름 파일을 읽어 `[제N조]` 블록을 뽑고, `<계층>_발췌.txt` 에 **없는 조만**
덧붙인다. 넣는 자리는 **별표·부칙 앞**이다(L-223 — 끝에 붙이면 조문 나열에서 안 보인다).
**원본은 지우지 않는다.**

⚠`[제N조]` 블록이 하나도 없는 파일은 건너뛰고 목록으로 알린다 — 별표만 담은 파일
  (`시행령_별표6_과징금.txt`)이나 고시 꼴로 적힌 전문(`시행규칙_전문.txt`) 이 여기 걸린다.
  그런 것은 사람이 보고 판단할 일이지 이 도구가 넘겨짚을 일이 아니다.

사용법: python3 merge_legacy_tier_files.py [--apply]
[연계] → raw/15_관련타부처/<법>/<계층>_발췌.txt  ← services/article_text.js loadArticle()
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
OTHER = os.path.join(LEGAL, 'raw', '15_관련타부처')
TIERS = ('법률', '시행령', '시행규칙')
BOUND = re.compile(r'^(?:\[(?:별표|별지|서식)|[ \t]*\[?\s*부\s*칙)')


def blocks_of(text):
    """`[제N조]` 블록 목록 — (조번호표기, 블록글) 쌍."""
    parts = re.split(r'(?=^\[제\d+조(?:의\d+)?\])', text, flags=re.M)
    out = []
    for b in parts:
        m = re.match(r'^\[(제\d+조(?:의\d+)?)\]', b)
        if m:
            out.append((m.group(1), b.rstrip() + '\n'))
    return out


def main():
    apply = '--apply' in sys.argv
    moved = skipped = 0
    skip_list = []
    for law in sorted(os.listdir(OTHER)):
        d = os.path.join(OTHER, law)
        if not os.path.isdir(d):
            continue
        names = [n for n in sorted(os.listdir(d)) if n.endswith('.txt')]
        for tier in TIERS:
            legacy = [n for n in names
                      if n.startswith(tier + '_') and n != f'{tier}_발췌.txt']
            if not legacy:
                continue
            target = os.path.join(d, f'{tier}_발췌.txt')
            plain = os.path.join(d, f'{tier}.txt')
            have = open(plain, encoding='utf-8').read() if os.path.exists(plain) else ''
            cur = open(target, encoding='utf-8').read() if os.path.exists(target) else ''
            add = []
            for n in legacy:
                t = open(os.path.join(d, n), encoding='utf-8').read()
                bs = blocks_of(t)
                if not bs:
                    skipped += 1
                    skip_list.append(f'{law}/{n}')
                    continue
                for no, body in bs:
                    if f'[{no}]' in cur or f'[{no}]' in have or any(no == x[0] for x in add):
                        continue
                    add.append((no, body))
            if not add:
                continue
            print(f'  {law}/{tier}: 옛 파일 {len(legacy)}개에서 조 {len(add)}개 → {os.path.basename(target)}')
            moved += len(add)
            if not apply:
                continue
            body = '\n'.join(b for _, b in add)
            if cur:
                at = cur.find('\n')
                m = BOUND.search(cur, 0)
                # 별표·부칙 앞에 끼워 넣는다(L-223)
                pos = -1
                for mm in re.finditer(r'\n(?:\[(?:별표|별지|서식)|[ \t]*\[?\s*부\s*칙)', cur):
                    pos = mm.start()
                    break
                if pos >= 0:
                    open(target, 'w', encoding='utf-8').write(cur[:pos] + '\n' + body + cur[pos:])
                else:
                    open(target, 'a', encoding='utf-8').write(('' if cur.endswith('\n') else '\n') + '\n' + body)
            else:
                head = f'{law} — 옛 이름으로 흩어져 있던 조문을 모은 발췌 (전체 아님)\n'
                head += '※ 원본 파일은 같은 폴더에 그대로 있다. 만든 도구: _dashboard/loop/merge_legacy_tier_files.py\n\n'
                open(target, 'w', encoding='utf-8').write(head + body)

    print(f'\n모은 조 {moved}개 · `[제N조]` 블록이 없어 건너뛴 파일 {skipped}개')
    for x in skip_list:
        print('   ⏭️ ', x)
    if not apply:
        print('(--apply 를 붙이면 실제로 쓴다)')


main()
