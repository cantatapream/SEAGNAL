#!/usr/bin/env python3
"""edition_forms.py — ★raw 원문이 **판(시행일·일련번호)을 적는 꼴**을 전수로 센다. (등록부 D-5 · 2-5)

[왜 있나]
`_SCHEMA §0-E` 의 「판 표기」 칸이 꼴을 **셋**만 적고 있었다
(`ID:…` · `MST:… · 시행일:…` · `(시행 … · 타법개정)`).
등록부 `D-5` 는 *"실제 9종"* 이라 적었다. **둘 다 틀렸다** — 2026-09-25 전수로 재니
**꼴 45가지 · 열쇠 낱말 11가지**였다.

그리고 이 절 자신이 왜 생겼는지를 이렇게 적고 있다:
  *"2026-09-21 하루에 다섯 번, 내가 급히 만든 정규식이 우리 파일의 표기를 몰라서
    틀린 숫자를 냈다. 매번 「다르다/빠졌다」는 거짓 경보였다."*
그러니 이 목록은 **손으로 적어 두면 또 낡는다.** 그래서 자를 남긴다 —
다음 사람은 문서를 믿지 말고 **이 자를 돌려서** 지금의 꼴을 본다.

[세는 법]
  대상   `raw/**/*.txt` 전부의 **머리 1,200자**(판 표기는 머리에 온다)
  고르는 법  판을 가리키는 열쇠 낱말 11가지를 찾는다 —
            `ID:` · `법령ID:` · `MST:` · `시행일:` · `시행:` · `(시행 …)` · `[시행 …]`
            · `일련번호:` · `공포번호:` · `발령일자:`
  꼴 세기  찾은 글에서 **숫자만 `N` 으로 바꿔** 모양을 만든다
           (`(시행 20260701 · 일부개정)` → `(시행 N · 일부개정)`)

⚠**게이트가 아니다.** 꼴이 늘어나는 것 자체는 결함이 아니다(새 원문이 들어오면 늘 수 있다).
  이 자는 **지금 몇 가지인지 보여 주는 것**이고, 잠글지는 사람이 값을 보고 정한다(G-49).

쓰는 법:
  python3 edition_forms.py              꼴 표를 찍는다
  python3 edition_forms.py --keys        열쇠 낱말별로 묶어서 찍는다
  python3 edition_forms.py --save <파일>  결과를 JSON 으로 남긴다

[연계] ← 등록부 `D-5`·`2-5`. → `_SCHEMA §0-E`(사람이 읽는 자리, 이 자를 가리킨다).
       형제: `_dashboard/loop/_counting.js`(세는 법 사전) · `bnum_words.json`(§5-D 낱말).
"""
import io, json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
HEAD_CHARS = 1200

# ★열쇠 낱말 11가지 — 이것을 늘릴 때는 **왜 늘렸는지** 여기에 한 줄 적는다.
KEY_RE = re.compile(
    r'(법령ID\s*:\s*\d+'                      # 법령ID: 009177
    r'|ID\s*:\s*\d+'                          # ID:2100000208425
    r'|MST\s*:\s*\d+'                         # MST:283397
    r'|시행일\s*:\s*\d{8}'                     # 시행일: 20201123
    r'|일련번호\s*:\s*\d+'                      # 일련번호: 2675
    r'|공포번호\s*:\s*\d+'                      # 공포번호: 00486
    r'|발령일자\s*:\s*\d{8}'                    # 발령일자: 20240517
    r'|시행\s*:\s*\d{4}[.\-]\d{1,2}[.\-]\d{1,2}'   # 시행: 2015-07-31 · 시행: 2026.1.6
    r'|\(시행\s*\d{4}[.\-]?\d{0,2}[.\-]?\d{0,2}[^)]{0,40}\)'   # (시행 20260701 · 일부개정)
    r'|\[시행\s*\d{4}[.\-]?\d{0,2}[.\-]?\d{0,2}[^\]]{0,40}\]'  # [시행 2024.1.18.]
    r')')


def key_of(text):
    """열쇠 낱말 — 꼴이 아무리 갈라져도 이 11가지 중 하나로 묶인다."""
    t = text.strip()
    for k in ('법령ID', 'MST', '시행일', '일련번호', '공포번호', '발령일자'):
        if t.startswith(k):
            return k
    if t.startswith('ID'):
        return 'ID'
    if t.startswith('시행'):
        return '시행:'
    if t.startswith('('):
        return '(시행 …)'
    if t.startswith('['):
        return '[시행 …]'
    return '그 밖'


def main():
    forms = collections.Counter()
    sample = {}
    keys = collections.Counter()
    files = 0
    for root, dirs, fs in os.walk(RAW):
        for f in fs:
            if not f.endswith('.txt'):
                continue
            p = os.path.join(root, f)
            try:
                head = io.open(p, encoding='utf-8', errors='replace').read(HEAD_CHARS)
            except OSError:
                continue
            files += 1
            for m in KEY_RE.finditer(head):
                t = m.group(1)
                shape = re.sub(r'N+', 'N', re.sub(r'\d', 'N', t))
                forms[shape] += 1
                keys[key_of(t)] += 1
                sample.setdefault(shape, (t, os.path.relpath(p, RAW)))

    print('raw 안 txt 파일 %d개의 머리 %d자를 봤다' % (files, HEAD_CHARS))
    print('판을 적은 꼴 **%d가지** · 열쇠 낱말 **%d가지**' % (len(forms), len(keys)))
    print()
    if '--keys' in sys.argv:
        print('  열쇠 낱말별')
        for k, v in keys.most_common():
            print('    %7d  %s' % (v, k))
    else:
        print('  꼴별 (많은 것부터)')
        for shape, v in forms.most_common():
            t, p = sample[shape]
            print('    %6d  %-34s 예: %-32s %s' % (v, shape[:34], t[:32], p[:56]))
    print()
    print('  ⚠이 수는 **늘 수 있다** — 새 원문이 들어오면 새 꼴이 생긴다. 결함이 아니다.')
    print('    문서(_SCHEMA §0-E)에 적힌 목록이 이것과 다르면 **문서가 낡은 것**이다.')

    save = None
    for i, a in enumerate(sys.argv):
        if a == '--save' and i + 1 < len(sys.argv):
            save = sys.argv[i + 1]
    if save:
        with io.open(save, 'w', encoding='utf-8') as fh:
            json.dump({
                '잰날': __import__('datetime').date.today().isoformat(),
                '자': 'edition_forms.py',
                '본파일': files, '꼴수': len(forms), '열쇠낱말수': len(keys),
                '꼴': dict(forms), '열쇠낱말': dict(keys),
            }, fh, ensure_ascii=False, indent=1)
            fh.write('\n')
        print('  저장: %s' % save)
    return 0


if __name__ == '__main__':
    sys.exit(main())
