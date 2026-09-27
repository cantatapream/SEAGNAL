# -*- coding: utf-8 -*-
"""행정규칙 별표 `.txt` 에 **내려받기 주소를 적어 넣는다**. (3-53)

왜 `.txt` 인가 — 읽는 곳이 거기다
  L-375 에서 `_links.json` 에 2,621개를 적을 뻔하고 멈췄다. 행정규칙 별표는
  `article_text.resolveRefs` ⑤ 가 **별표 `.txt` 파일 자체**를 열고
  `parseBylFile` 형식②가 `별표서식파일링크:`·`별표서식PDF파일링크:` **줄을 직접 읽는다.**
  `_links.json` 키 조회(④)는 **계층(법률·시행령·시행규칙)에만** 쓴다.
  ⇒ **고칠 자리는 `.txt` 다.**

무엇을 고르나
  기본은 **「글도 링크도 없는 것」만**(본문 100자 미만 + 주소 없음 = 실측 77개).
  그 자리는 챗봇이 **아무것도 못 보여준다.** `--with-body` 를 붙이면 본문이 있는 자리까지 넓힌다
  (그때는 주소가 「편의」다 — 급하지 않다).

어떻게 적나
  머리(`출처:` 줄) **바로 뒤**에 한 줄씩 넣는다 — `parseBylFile` 은 파일 어디에 있든 읽지만,
  사람이 열었을 때 머리에 모여 있는 편이 낫다. **본문은 한 글자도 안 건드린다.**
  ⚠raw 를 고치므로 `_touched` 기록을 남긴다(V5-33).

[연계] ← `raw/**/별표/<행정규칙>_별표N.txt` · → 같은 파일(머리줄 추가) · 읽는 곳 `article_text.parseBylFile` 형식②
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
import admrul_fill_addenda as A                                   # noqa: E402
from _touched import Touched                                      # noqa: E402

TIER = ('법률', '시행령', '시행규칙')
BASE = 'https://www.law.go.kr'
URL = re.compile(r'flDownload\.do')
NAME = re.compile(r'^(.+?)_(별표|별지|서식)(.+)$')

_CACHE = {}


def units(rid):
    if rid in _CACHE:
        return _CACHE[rid]
    d = A.api(f'{BASE}/DRF/lawService.do?OC=hyoo1431&target=admrul&type=JSON&ID={rid}')
    out = []
    try:
        u = d['AdmRulService']['별표']['별표단위']
        out = u if isinstance(u, list) else [u]
    except Exception:
        out = []
    _CACHE[rid] = out
    return out


def pick(us, typ, no):
    """번호로 고른다. ★`별지`와 `서식`은 **응답에서 섞여 쓰인다** — 둘을 같은 것으로 본다."""
    same = {'별지', '서식'} if typ in ('별지', '서식') else {'별표'}
    want = no.replace(' ', '')
    for x in us:
        n = str(x.get('별표번호') or '').lstrip('0') or '0'
        g = str(x.get('별표가지번호') or '00').lstrip('0')
        key = n + ('의' + g if g else '')
        if str(x.get('별표구분')) in same and key == want:
            return x
    return None


def rid_of(path):
    try:
        with open(path, encoding='utf-8') as f:
            f.readline()
            m = re.search(r'ID=(\d+)', f.readline())
            return m.group(1) if m else None
    except Exception:
        return None


def main():
    apply_ = '--apply' in sys.argv
    wide = '--with-body' in sys.argv
    touched = Touched('admrul_byl_file_links') if apply_ else None
    tried = wrote = noid = nomatch = nolink = 0
    for r, _d, fs in os.walk(RAW):
        if os.path.basename(r) != '별표':
            continue
        for f in sorted(fs):
            if not f.endswith('.txt'):
                continue
            m = NAME.match(f[:-4])
            if not m or m.group(1) in TIER:
                continue
            p = os.path.join(r, f)
            t = open(p, encoding='utf-8').read()
            if URL.search(t):
                continue
            body = len(re.sub(r'\s', '', t))
            if not wide and body > 100:
                continue
            tried += 1
            rid = rid_of(p)
            if not rid:
                noid += 1
                continue
            us = units(rid)
            x = pick(us, m.group(2), m.group(3))
            if not x and len(us) == 1 and m.group(3) in ('1', '01'):
                # ★번호 없는 별표 하나만 가진 규칙 — 파일은 `_별표1` 로 적혀 있다.
                #   **제목이 맞을 때만** 인정한다(번호만 보고 넘겨짚지 않는다).
                head = t.split('\n')[0]
                want_t = re.sub(r'\s', '', head.split('—')[-1])
                got_t = re.sub(r'\s', '', str(us[0].get('별표제목') or ''))
                if want_t and got_t and (want_t[:8] in got_t or got_t[:8] in want_t):
                    x = us[0]
            if not x:
                nomatch += 1
                continue
            pdf = x.get('별표서식PDF파일링크') or ''
            hwp = x.get('별표서식파일링크') or ''
            if not (pdf or hwp):
                nolink += 1
                continue
            lines = t.split('\n')
            at = 1
            for i, ln in enumerate(lines[:4]):
                if ln.startswith('출처:'):
                    at = i + 1
            add = []
            if hwp:
                add.append(f'별표서식파일링크: {hwp}')
            if pdf:
                add.append(f'별표서식PDF파일링크: {pdf}')
            lines[at:at] = add
            wrote += 1
            print('· %-66s %s' % (os.path.relpath(p, RAW)[:66],
                                  ('HWP' if hwp else '') + ('+PDF' if pdf else '')))
            if apply_:
                open(p, 'w', encoding='utf-8').write('\n'.join(lines))
                touched.add(p)
    print(f'\n=== 본 것 {tried} · 주소를 적은 것 {wrote} · ID 줄 없음 {noid} '
          f'· 응답에 그 번호 없음 {nomatch} · 응답에도 주소 없음 {nolink} ===')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
