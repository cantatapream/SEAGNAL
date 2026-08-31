#!/usr/bin/env python3
"""조약 raw(`조약_*.txt`)를 챗봇이 읽을 수 있는 `법률_발췌.txt` 로 모은다.

[왜 있나 — 2026-08-31]
조약은 `raw/15_관련타부처/<조약이름>/조약_<주제>.txt` 꼴로 주제별로 받아 뒀다. 그런데 챗봇은
그 폴더에서 `법률.txt`·`법률_발췌.txt` 만 찾으므로(`article_text.js` TIER_FILE), **원문이 손에
있는데도 "그 계층 파일이 없음"** 이었다. V5-8 게이트 실측으로 UNCLOS 만 31줄이 그 상태였다.

[무엇을 하나]
그 폴더의 `조약_*.txt` 를 모두 읽어 조문 블록을 뽑고, 법률과 같은 표기(`[제N조]`)로 바꿔
`법률_발췌.txt` 를 만든다. **원본 `조약_*.txt` 는 그대로 둔다**(지우지 않는다).

★조문을 어떻게 가르나 — 두 갈래다
  ⓐ줄머리에 `제N조 …` 가 오는 파일: 그 줄부터 다음 줄머리 조 앞까지가 한 조다.
  ⓑ한 줄에 여러 조가 통째로 뭉친 파일(제12부·제13부): **번호를 하나씩 세어 가며** 찾는다.
     `제192조` 다음은 반드시 `제193조` 다 — 그 번호가 앞 머리 뒤쪽에서 처음 나오되
     **뒤에 붙은 말이 '및'·'또는'·'제…' 같은 이음말이 아닌 곳**을 머리로 본다.
     이 두 조건이 없으면 본문 속 상호참조(`제218조, 제220조 및 제228조의 적용을…`)를
     머리로 잘못 집는다(실제로 그렇게 집어 제218·219조를 통째로 잃을 뻔했다).
     ⚠**번호가 하나라도 안 맞으면 그 파일은 만들지 않는다** — 반쯤 자른 조약문을 내놓는 것보다
       아무것도 안 내놓는 편이 낫다(환각 0).

⚠제목과 본문 사이에 구분이 없는 줄이 많다(`제95조 공해상 군함의 면제공해에 있는 군함은…`).
  그래서 제목을 따로 뽑지 않고 **원문 그대로** 본문에 남긴다 — 없는 구분을 지어내지 않는다.

사용법: python3 trty_to_excerpt.py <조약폴더> --범위 <파일명>=<첫조>-<끝조> [...] [--apply]
[연계] → raw/15_관련타부처/<조약>/법률_발췌.txt  ← services/article_text.js loadArticle()
"""
import os, re, sys

CONJ = ('및', '또는', '내지', '부터', '까지', '그리고', '제', '에', '의', '를', '은',
        '는', '와', '과', '이', '가', '또한', '단서')


def split_lines(text):
    """줄머리 `제N조 …` 꼴 — 그 줄부터 다음 조 앞까지."""
    lines = text.split('\n')
    idx = [i for i, l in enumerate(lines) if re.match(r'^제\d+조[ 　(]', l)]
    out = []
    for k, i in enumerate(idx):
        end = idx[k + 1] if k + 1 < len(idx) else len(lines)
        no = re.match(r'^제(\d+)조', lines[i]).group(1)
        body = '\n'.join(lines[i:end]).strip()
        out.append((int(no), body))
    return out


def split_run(text, first, last):
    """한 줄에 뭉친 조를 번호 차례로 짚어 가며 자른다. 하나라도 못 찾으면 None."""
    heads = []
    pos = 0
    for n in range(first, last + 1):
        found = None
        for m in re.finditer(r'제%d조' % n, text):
            if m.start() < pos:
                continue
            nxt = text[m.end():m.end() + 8]
            if nxt[:1] not in ' 　':
                continue
            word = nxt[1:].strip().split(' ')[0][:2]
            if any(word.startswith(c) for c in CONJ):
                continue
            found = m.start()
            break
        if found is None:
            print(f'  ⚠제{n}조 머리를 못 찾았다 — 이 파일은 건너뛴다(반쯤 자르지 않는다).')
            return None
        heads.append((n, found))
        pos = found + 1
    out = []
    for k, (n, p) in enumerate(heads):
        end = heads[k + 1][1] if k + 1 < len(heads) else len(text)
        out.append((n, text[p:end].strip()))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    folder = sys.argv[1]
    apply = '--apply' in sys.argv
    ranges = {}
    for a in sys.argv[2:]:
        if '=' in a and '-' in a.split('=')[1]:
            fn, rg = a.split('=', 1)
            f, t = rg.split('-')
            ranges[fn] = (int(f), int(t))

    blocks = {}
    for n in sorted(os.listdir(folder)):
        if not (n.startswith('조약') and n.endswith('.txt')):
            continue
        text = open(os.path.join(folder, n), encoding='utf-8').read()
        got = split_run(text, *ranges[n]) if n in ranges else split_lines(text)
        if got is None:
            continue
        print(f'  {n}: 조 {len(got)}개')
        for no, body in got:
            blocks.setdefault(no, body)          # 먼저 나온 것을 쓴다(중복 수집분)

    if not blocks:
        print('뽑은 조가 없다.')
        return
    name = os.path.basename(folder.rstrip('/'))
    head = (f'{name} — 조약 raw(`조약_*.txt`)에서 조문만 모은 발췌 (전체 아님)\n'
            f'※ 원문은 같은 폴더의 `조약_*.txt` 이고 그대로 남아 있다. 이 파일은 챗봇이 조 단위로\n'
            f'   읽을 수 있게 표기만 `[제N조]` 꼴로 바꾼 것이다(제목과 본문 사이에 구분이 없는 줄이\n'
            f'   많아 제목을 따로 뽑지 않고 원문 그대로 두었다). 만든 도구: _dashboard/loop/trty_to_excerpt.py\n\n')
    body = '\n\n'.join(f'[제{n}조]\n' + re.sub(r'^제%d조[ 　]*' % n, '', blocks[n])
                       for n in sorted(blocks))
    out = os.path.join(folder, '법률_발췌.txt')
    print(f'\n조 {len(blocks)}개 · {len(head + body):,}자 → {out}')
    if apply:
        open(out, 'w', encoding='utf-8').write(head + body + '\n')
        print('썼다.')
    else:
        print('(--apply 를 붙이면 실제로 쓴다)')


main()
