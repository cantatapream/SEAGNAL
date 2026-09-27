#!/usr/bin/env python3
"""gen_rulebook.py — ★규칙집(`_RULES.md`)의 **검사 목록 칸을 기계가 다시 쓴다.** (등록부 2-4)

[왜 있나]
`2-4` 는 *"짧은 규칙집 — 규칙마다 **검사 코드 이름**을 옆에"* 다. 그런데 검사 목록을
**손으로 적으면 반드시 낡는다** — 이 저장소의 뿌리 사슬 ①②③이 정확히 그것이다:
  ①규칙은 있었다 → 코드가 안 읽는다 ②코드가 안 읽는 규칙은 죽는다
  ③게이트가 안 재는 자리도 죽는다
그래서 규칙집의 **검사 목록만은 사람이 안 적는다.** 이 자가 `verify_all.sh` 를 읽어 찍는다.

[어디서 뽑나 — 다시 적지 않는다(L-136·L-386)]
  게이트   `scripts/refactor/verify_all.sh` 의 절 머리줄 `echo "── <이름> <뜻> ──"`
           그리고 그 절이 **실제로 부르는 파일**(node/python 줄에서 뽑는다)
  스위트   같은 파일의 `SUITES=(…)` 배열 → `local_server/scripts/<이름>.js`
           그 파일 머리 주석의 **첫 설명줄**

[쓰는 법]
  python3 scripts/refactor/gen_rulebook.py            `_RULES.md` 의 검사 칸을 다시 쓴다
  python3 scripts/refactor/gen_rulebook.py --check     낡았으면 **exit 1** (게이트용)
  python3 scripts/refactor/gen_rulebook.py --print     찍기만 한다

⚠이 자는 규칙집의 **표시된 칸만** 건드린다(`<!-- 검사목록:시작 -->`~`<!-- 검사목록:끝 -->`).
  사람이 쓴 규칙 본문은 한 글자도 안 만진다.

[연계] ← 등록부 `2-4`. → `_RULES.md`(찍는 곳) · `verify_all.sh`(읽는 곳).
"""
import io, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VERIFY = os.path.join(REPO, 'scripts/refactor/verify_all.sh')
RULES = os.path.join(REPO, 'local_server/knowledge/legal/_RULES.md')
BEGIN = '<!-- 검사목록:시작 — `python3 scripts/refactor/gen_rulebook.py` 가 다시 쓴다. 손으로 고치지 않는다 -->'
END = '<!-- 검사목록:끝 -->'
NOT_A_GATE = {'재는 조건', 'V5 테스트 스위트'}


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def first_doc_line(head, name):
    """머리 주석의 **첫 설명줄**을 뽑는다.

    이 저장소에는 머리 주석 꼴이 **두 가지**다 — 실측으로 확인했다:
      ① `/** * <이름>.js — <설명>` (test_glossary_parse 꼴)
      ② `// [2026-08-08 실사고] <설명> — node scripts/…` (test_child_relevance 꼴)
    한 가지만 맞춰 뽑았다가 **47개 중 상당수가 빈칸**으로 나왔다. 둘 다 받는다.
    """
    SKIP = ("'use strict'", '"use strict"', '#!/', '/**', '*/', '====')
    for raw in head.split('\n'):
        l = raw.strip()
        if not l or l.startswith(SKIP):
            continue
        if not (l.startswith('//') or l.startswith('*') or l.startswith('#')):
            continue
        t = l.lstrip('/*# ').strip()
        if not t or t.startswith('====') or set(t) <= set('=-─ '):
            continue
        t = re.sub(r'^\[[^\]]*\]\s*', '', t)                       # 「[2026-08-08 실사고]」를 뗀다
        t = re.sub(r'^`?%s(\.js)?`?\s*[—:-]\s*' % re.escape(name), '', t)  # 제 이름을 뗀다
        t = re.sub(r'\s*[—-]\s*node\s+\S+.*$', '', t)               # 「— node scripts/…」를 뗀다
        t = t.strip()
        # ⚠꼴이 셋이었다 — 「파일명: …」 다음 줄에 「역할: …」 이 오는 자가 7개 있다(실측).
        #   그 「파일명:」 줄을 설명으로 잡으면 47개 중 7개가 경로만 적힌 칸이 된다.
        if t.startswith('파일명'):
            continue
        t = re.sub(r'^역할\s*:\s*', '', t)
        if len(t) >= 6 and not t.startswith('★L-'):
            return t[:110] + ('…' if len(t) > 110 else '')
    return '⚠머리 주석에 설명줄이 없다'


def gate_sections():
    """`verify_all.sh` 의 절 머리줄과 그 절이 부르는 파일."""
    lines = read(VERIFY).split('\n')
    heads = []
    for i, l in enumerate(lines):
        m = re.match(r'^echo(?:; echo)? "── (.+?) ──"$', l.strip())
        if m and m.group(1) not in NOT_A_GATE:
            heads.append((i, m.group(1)))
    out = []
    for k, (i, title) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        body = '\n'.join(lines[i:end])
        # 그 절이 실제로 부르는 파일 — node/python 인자에서 경로꼴만 고른다
        files = []
        for m in re.finditer(r'(?:node|python3)\s+(?:-[^\s]+\s+)*([\w./_-]+\.(?:js|py|sh))', body):
            f = m.group(1)
            if f not in files:
                files.append(f)
        # 이름과 뜻을 가른다 — 머리줄이 「V5-7 골든 문항 …」 꼴이다
        m = re.match(r'^((?:V\d[\w.-]*|V\d+-\d+[a-z]?))\s+(.*)$', title)
        code, what = (m.group(1), m.group(2)) if m else ('', title)
        out.append({'code': code, 'what': what, 'files': files})
    return out


def suites():
    s = read(VERIFY)
    m = re.search(r'SUITES=\((.*?)\)', s, re.S)
    names = m.group(1).split() if m else []
    out = []
    for n in names:
        p = os.path.join(REPO, 'local_server/scripts/%s.js' % n)
        what = '⚠파일이 없다' if not os.path.exists(p) else first_doc_line(read(p)[:3000], n)
        out.append({'name': n, 'what': what})
    return out


def block():
    g = gate_sections()
    su = suites()
    L = []
    L.append(BEGIN)
    L.append('')
    L.append('### ⓐ 게이트 %d 개 — `bash scripts/refactor/verify_all.sh` 가 한 번에 돈다' % len(g))
    L.append('')
    L.append('| 검사 이름 | 무엇을 못박나 | 자 |')
    L.append('|---|---|---|')
    for x in g:
        code = ('`%s`' % x['code']) if x['code'] else '—'
        files = ' · '.join('`%s`' % f for f in x['files'][:3]) or '(`verify_all.sh` 안에서 바로)'
        L.append('| %s | %s | %s |' % (code, x['what'].replace('|', '\\|'), files))
    L.append('')
    L.append('### ⓑ 테스트 스위트 %d 개 — 같은 게이트가 이어서 돈다' % len(su))
    L.append('')
    L.append('| 검사 이름 | 무엇을 못박나 |')
    L.append('|---|---|')
    for x in su:
        L.append('| `%s` | %s |' % (x['name'], x['what'].replace('|', '\\|')))
    L.append('')
    L.append('> 위 두 표는 **기계가 찍은 것**이다 — `verify_all.sh` 의 절 머리줄과 `SUITES` 배열,')
    L.append('> 그리고 각 스위트 파일 머리 주석에서 그대로 뽑았다. 손으로 고치면 다음 실행에 사라진다.')
    L.append('> 낡았는지는 `python3 scripts/refactor/gen_rulebook.py --check` 가 잰다(게이트 **V5-47**).')
    L.append('')
    L.append(END)
    return '\n'.join(L)


def main():
    new = block()
    if '--print' in sys.argv:
        print(new)
        return 0
    if not os.path.exists(RULES):
        print('실패: %s 가 없다 — 규칙집 본문을 먼저 만든다' % RULES, file=sys.stderr)
        return 2
    cur = read(RULES)
    if BEGIN not in cur or END not in cur:
        print('실패: 규칙집에 표시(`검사목록:시작`/`끝`)가 없다', file=sys.stderr)
        return 2
    i, j = cur.index(BEGIN), cur.index(END) + len(END)
    out = cur[:i] + new + cur[j:]
    if '--check' in sys.argv:
        if out != cur:
            print('❌ 규칙집의 검사 목록이 **낡았다** — `python3 scripts/refactor/gen_rulebook.py` 로 다시 쓴다')
            old_block = cur[i:j]
            print('   지금 적힌 줄 %d · 다시 쓰면 %d' % (old_block.count('\n'), new.count('\n')))
            return 1
        g, su = gate_sections(), suites()
        print('  ✅ 규칙집 검사 목록이 최신이다 — 게이트 %d · 스위트 %d' % (len(g), len(su)))
        return 0
    with io.open(RULES, 'w', encoding='utf-8') as f:
        f.write(out)
    print('규칙집 검사 목록을 다시 썼다 — 게이트 %d · 스위트 %d' % (len(gate_sections()), len(suites())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
