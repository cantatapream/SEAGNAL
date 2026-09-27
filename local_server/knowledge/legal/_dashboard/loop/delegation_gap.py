#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""법이 "대통령령·부령으로 정한다"고 위임했는데, **그 법의 시행령·시행규칙에 대응 조문이 없는 자리**를 찾는다.

[왜 있나 — 2026-09-02, 25회차 항만법에서 드러남]
항만법 제25조제3항이 시설관리권 등록에 관해 위임한 대통령령은 **항만법 시행령이 아니라
별도 대통령령 「항만시설관리권 등록령」**(82개 조문)이었다. 지난 라운드들이 항만법 시행령만
대조하고 그 등록령을 안 봐서 **"규정이 없다"고 잘못 닫은 판정이 4건** 있었다
(등록원부 열람·체납처분 압류·관리권 포기 절차·저당권 순위 — 전부 그 영에 있었다).

`delegated_sweep.py` 는 **행정규칙(고시·훈령)만** 본다. 위임 대상이 대통령령·부령이면
그 도구로는 구조적으로 못 잡는다. 이 검사가 그 빈자리를 메운다.

[무엇을 하나]
법률.txt 를 조문 단위로 갈라, 위임 문구(대통령령·○○부령으로 정한다 등)가 있는 조를 모은다.
그 다음 같은 폴더의 시행령.txt·시행규칙.txt 에서 그 조를 가리키는 인용(`법 제N조` 등)을 찾는다.
**한 번도 안 가리키면** 그 자리를 목록에 올린다 — 그 위임의 답이
ⓐ 별도 대통령령·부령에 있거나 ⓑ 아직 안 만들어졌거나 ⓒ 우리가 안 받아 뒀거나 셋 중 하나다.

⚠**판정이 아니라 확인 목록이다.** 시행령이 조 번호를 안 적고 받는 경우도 있어 오탐이 남는다.
   사람이 하나씩 보고 판단한다.

사용법: python3 delegation_gap.py [<법이름> ...]   (안 주면 law_raw_paths.json 의 전부)
[연계] ← raw/<도메인>/<법>/{법률,시행령,시행규칙}.txt · _dashboard/law_raw_paths.json
        → _dashboard/delegation_gap.md
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
# ★2026-09-23 (3-39) — 그 컴퓨터 이름을 박아 두면 **다른 데서는 안 돈다**(G-31).
#   `LEGAL` 이 이미 이 파일 자리에서 계산돼 있으므로 뿌리도 거기서 센다.
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
OUT = os.path.join(LEGAL, '_dashboard', 'delegation_gap.md')

# 위임 문구 — "대통령령/○○부령으로 정한다·정하는" 꼴만 본다.
#   "해양수산부장관이 정하여 고시하는"(행정규칙 위임)은 delegated_sweep.py 소관이라 여기서 뺀다.
DELEG = re.compile(r'(대통령령|[가-힣]{2,8}부령|총리령)(으)?로\s*(정한다|정하는|정하며|정하되|정할)')
HEAD = re.compile(r'^\[(제\d+조(?:의\d+)?)\]\s*(.*)$')


def articles(path):
    """`[제N조] 제목` 으로 갈라 (조번호, 제목, 본문) 목록을 만든다.

    ★부칙에서 멈춘다(2026-09-02, 사서가 잡음). 부칙에는 **다른 법을 고치는 개정문**이 들어 있어
      그것이 앞 조의 본문에 붙어 버렸다 — 수산업ㆍ어촌발전기본법 제52조가 항 없는 단일 조인데
      "제11항"이 있는 것처럼 잡힌 것이 그 때문이다(5건).
    """
    out, num, title, buf = [], None, '', []
    for line in open(path, encoding='utf-8'):
        # 부칙 머리줄은 두 꼴이 있다 — `부칙 <제…>` 와 `[부칙 <제…>]`(2026-09-02 실측, 영해및접속수역법).
        if re.match(r'^\s*\[?부칙(\s|<|\]|$|\()', line):
            break
        m = HEAD.match(line.rstrip('\n'))
        if m:
            if num:
                out.append((num, title, ''.join(buf)))
            num, title, buf = m.group(1), m.group(2), []
        elif num:
            buf.append(line)
    if num:
        out.append((num, title, ''.join(buf)))
    return out


HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'


def cited(path):
    """그 파일이 가리키는 상위법 조·항. 자기 조 머리(`[제N조]`)는 뺀다.

    ★조 번호만 보면 못 잡는다(2026-09-02 실측). 항만법 제25조**제3항**이
      별도 대통령령에 위임한 자리가 있는데, 시행령이 제25조를 **다른 항** 때문에
      여러 번 가리키고 있어서 "가리켰다"로 걸러졌다. 그래서 조와 **조+항**을 따로 모은다.
    """
    if not os.path.exists(path):
        return None
    txt = open(path, encoding='utf-8').read()
    txt = re.sub(r'^\[.*?\]', '', txt, flags=re.M)
    # ★부칙은 뺀다(2026-09-02). 부칙에는 **다른 법령을 고치는 문장**이 들어 있어
    #   "「항만법」제25조제3항으로 한다" 같은 줄이 인용으로 잡혔다 — 그건 이 영이 그 항을
    #   받아 규정한 것이 아니라 남의 영을 고쳐 준 것이다.
    cut = re.search(r'^부칙', txt, flags=re.M)
    if cut:
        txt = txt[:cut.start()]
    # ★`법 제N조` 만 센다(2026-09-02). `영 제25조제3항`·`규칙 제5조` 는 **자기 계층**을 가리키는 말이라
    #   상위법을 받은 근거가 못 된다 — 실제로 항만법 시행규칙의 `영 제25조제3항` 이 그렇게 잡혔다.
    # ★`법 제N조` 만 보면 **시행령 첫 조의 표준 문형을 통째로 놓친다**(2026-09-02, 사서가 잡음).
    #   시행령·시행규칙 제2조는 거의 항상 이렇게 쓴다:
    #     「해양경비법」(이하 "법"이라 한다) 제2조제11호에서 "…"이란 …
    #   여기엔 `법 제2조` 가 아니라 `한다) 제2조` 가 있어 매칭이 안 됐다.
    #   실제로 한 사서가 맡은 22건 중 13건이 정확히 이 문형이었다.
    #   그래서 ⓐ`법 제N조` ⓑ`」 … 제N조`(법령명 인용 뒤) 둘 다 센다.
    #   ⚠2026-09-02 오후 재수정 — `」` 를 통째로 허용했더니 **과교정**이 났다.
    #     `「어선법」 제17조` 처럼 **남의 법**을 인용한 것, `「…시행령」(이하 "영"이라 한다) 제3조`
    #     처럼 **자기 계층**을 가리킨 것까지 "받았다"로 세어, 실제 빈자리(수산업법 제17조③ →
    #     「어업ㆍ양식업등록령」)를 오히려 숨겼다. 그래서 두 꼴만 센다:
    #       ⓐ `법 제N조`   ⓑ `"법"이라 한다) 제N조`(시행령 제1·2조의 표준 문형)
    #   ⓒ **한 문장에 여러 조를 나열**하면 뒤쪽 조에는 "법"이 안 붙는다(2026-09-02, 사서 둘이 각각 지적):
    #       법 제99조제1항, 같은 조 제2항 본문 **및 제100조제1항**에서…
    #     이걸 이어 세도록 고쳐 봤다가 **되돌렸다** — 나열을 따라가는 규칙이 욕심을 부려
    #     항만법 제25조제3항(실제 빈자리, 25회차에 확인된 것)을 A 목록에서 지워 버렸다.
    #     이 목록은 사람이 보는 **확인 목록**이라, 헛걸음(오탐)보다 **놓치는 것(누락)이 훨씬 나쁘다.**
    #     그래서 나열형은 오탐으로 남겨 두고, 사서가 그 자리에서 "오탐"이라고 적는 쪽을 택했다.
    jo, johang = set(), set()
    for pat in (r'법\s*제(\d+조(?:의\d+)?)((?:제\d+항)?)',
                r'"법"이라\s*한다\)\s*제(\d+조(?:의\d+)?)((?:제\d+항)?)'):
        for m in re.finditer(pat, txt):
            jo.add('제' + m.group(1))
            if m.group(2):
                johang.add('제' + m.group(1) + m.group(2))
    return jo, johang


def hangs(body):
    """조 본문을 항 단위로 가른다 — [(항번호, 그 항 본문)]. 항 표시가 없으면 (0, 전체)."""
    marks = [(i, HANG.index(ch) + 1) for i, ch in enumerate(body) if ch in HANG]
    if not marks:
        return [(0, body)]
    out = []
    for k, (i, n) in enumerate(marks):
        j = marks[k + 1][0] if k + 1 < len(marks) else len(body)
        out.append((n, body[i:j]))
    return out


def scan(law, rel):
    base = os.path.join(REPO, rel)
    lawf = os.path.join(base, '법률.txt')
    if not os.path.exists(lawf):
        return None
    dec = cited(os.path.join(base, '시행령.txt'))
    rul = cited(os.path.join(base, '시행규칙.txt'))
    if dec is None and rul is None:
        return {'law': law, 'no_lower': True, 'gaps': [], 'weak': []}
    jo = (dec[0] if dec else set()) | (rul[0] if rul else set())
    johang = (dec[1] if dec else set()) | (rul[1] if rul else set())
    # ★같은 폴더의 **다른 부령 파일**도 본다(2026-09-02, 사서가 잡음).
    #   항만법 제32조①②의 답은 시행규칙이 아니라 같은 폴더의
    #   `항만시설장비관리규칙.txt`(별도 해양수산부령)에 있었다. 시행령·시행규칙 두 파일만 읽어 놓친 것이다.
    for n in sorted(os.listdir(base)):
        if not n.endswith('.txt') or n in ('법률.txt', '시행령.txt', '시행규칙.txt', '부칙.txt'):
            continue
        if n.startswith('법률_') or n.startswith('_'):
            continue
        got = cited(os.path.join(base, n))
        if got:
            jo |= got[0]; johang |= got[1]
    gaps, weak = [], []
    for num, title, body in articles(lawf):
        for hn, htxt in hangs(body):
            m = DELEG.search(htxt)
            if not m:
                continue
            i = m.start()
            snippet = re.sub(r'\s+', ' ', htxt[max(0, i - 60):i + 40]).strip()
            label = f'{num}제{hn}항' if hn else num
            if num not in jo:
                gaps.append((label, title, m.group(0), snippet))
            elif hn and f'{num}제{hn}항' not in johang:
                weak.append((label, title, m.group(0), snippet))
    return {'law': law, 'no_lower': False, 'gaps': gaps, 'weak': weak,
            'has_dec': dec is not None, 'has_rul': rul is not None}


def main():
    paths = json.load(open(os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json'), encoding='utf-8'))
    want = [a for a in sys.argv[1:] if not a.startswith('--')]
    laws = want or sorted(paths)
    rows, skipped, total = [], [], 0
    for law in laws:
        rel = paths.get(law)
        if not rel:
            skipped.append((law, 'law_raw_paths.json 에 없다')); continue
        r = scan(law, rel)
        if r is None:
            skipped.append((law, '법률.txt 이 없다')); continue
        if r['no_lower']:
            skipped.append((law, '시행령·시행규칙이 둘 다 없다 — 이 검사로는 못 본다')); continue
        if r['gaps'] or r['weak']:
            rows.append(r); total += len(r['gaps'])

    with open(OUT, 'w', encoding='utf-8') as fp:
        fp.write('# 위임했는데 그 법 시행령·시행규칙에 대응 조문이 없는 자리\n\n')
        fp.write('> **판정이 아니라 확인 목록이다.** 법이 "대통령령·부령으로 정한다"고 위임했는데\n')
        fp.write('> 그 법의 시행령·시행규칙이 그 조를 한 번도 가리키지 않는 자리를 모은 것이다.\n')
        fp.write('> 답이 ⓐ **별도 대통령령·부령**에 있거나 ⓑ 아직 안 만들어졌거나 ⓒ 우리가 안 받아 뒀거나 셋 중 하나다.\n')
        fp.write('> 25회차 항만법에서 ⓐ 유형이 실제로 나왔다 — 제25조제3항의 답이\n')
        fp.write('> 항만법 시행령이 아니라 「항만시설관리권 등록령」(별도 대통령령)에 있었고,\n')
        fp.write('> 그걸 안 봐서 "규정이 없다"고 잘못 닫은 판정이 4건이었다.\n\n')
        fp.write('> ⚠시행령이 조 번호를 안 적고 받는 경우가 있어 **오탐이 남는다.** 사람이 하나씩 본다.\n')
        fp.write('> ⚠행정규칙(고시·훈령) 위임은 여기서 보지 않는다 — `delegated_sweep.py` 소관이다.\n\n')
        tw = sum(len(r['weak']) for r in rows)
        fp.write(f'- **본 법**: {len(laws)}개 · **자리가 나온 법**: {len(rows)}개\n')
        fp.write(f'- **A. 조 자체를 한 번도 안 가리킴**: {total}개 (빈자리일 가능성이 높다)\n')
        fp.write(f'- **B. 조는 가리키는데 그 항은 안 가리킴**: {tw}개 (항만법 제25조제3항이 이 유형이었다)\n\n')
        for r in sorted(rows, key=lambda x: -(len(x['gaps']) + len(x['weak']))):
            tier = []
            if not r['has_dec']: tier.append('시행령 없음')
            if not r['has_rul']: tier.append('시행규칙 없음')
            fp.write(f'## {r["law"]} — A {len(r["gaps"])}개 · B {len(r["weak"])}개'
                     + (f' ({" · ".join(tier)})' if tier else '') + '\n\n')
            for label, rowsrc in (('A. 조 자체를 한 번도 안 가리킴', r['gaps']),
                                  ('B. 조는 가리키는데 그 항은 안 가리킴', r['weak'])):
                if not rowsrc: continue
                fp.write(f'**{label}**\n\n')
                for num, title, kw, snip in rowsrc:
                    fp.write(f'- **{num}** {title} — 위임 문구 `{kw}`\n')
                    fp.write(f'  - …{snip}…\n')
                fp.write('\n')
        if skipped:
            fp.write('## 이 검사로 못 본 법\n\n')
            for law, why in skipped:
                fp.write(f'- {law} — {why}\n')
    print(f'✅ 본 법 {len(laws)} · 자리가 나온 법 {len(rows)} · A {total} · '
          f'B {sum(len(r["weak"]) for r in rows)} · 못 본 법 {len(skipped)}'
          f' → {os.path.relpath(OUT, LEGAL)}')


if __name__ == '__main__':
    main()
