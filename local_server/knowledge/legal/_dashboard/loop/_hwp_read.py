#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""구형 `.hwp`(복합 이진)를 글자로 바꾼다 — **표는 행 단위로.** 읽는 자는 여기 하나뿐이다(L-386).

[왜 필요했나 — 결심 ⑬ⓐ (2026-09-26 사장님 「들여」)]
  `.hwpx` 는 zip+XML 이라 파이썬 기본만으로 읽힌다(`admrul_rewrite_clean.hwpx글자`).
  그런데 **`.hwp` 는 복합 이진**이라 판독기가 있어야 한다. 그 벽에 걸려 있던 것:
    · 자연유산 허용기준 별표3 **265줄** (3-36 에서 가장 큰 것)
    · 마리나항만시설물안전점검지침 **174줄**
    · 어선구조기준 (3-68 의 마지막 하나)
    · 해경 출입통제 공고의 **북위·동경 좌표표** — `33°18 39` 와 `′` `″` 가 떨어져
      **33°18′39″ 를 다시 맞출 수 없다**(안전과 직결된다)

[★부품을 저장소에도 CI 에도 넣지 않는다 — 가장 중요한 결정]
  실측: `verify-all-gate.yml` 은 `setup-python@v5` 로 파이썬만 세우고
  **파이썬 꾸러미는 하나도 깔지 않는다**(`npm ci` 뿐이다). 저장소에 `requirements.txt` 도 없다.
  ⇒ **게이트 도구가 `hwp5` 를 들이는 순간 CI 가 빨간불이 된다.**
  그래서 판독기는 **격리된 venv** 에 두고, 이 자는 그 venv 를 **바깥에서 불러 쓴다**.
  ⚠이 자를 게이트에서 부르지 마라. 수집기(손으로 돌리는 자)만 부른다.

[venv 만드는 법 — 한 번만]
    python3 -m venv ~/.cache/hwp5venv
    ~/.cache/hwp5venv/bin/python -m pip install 'setuptools<60' wheel
    ~/.cache/hwp5venv/bin/python -m pip install --no-build-isolation pyhwp six olefile
  ⚠`--no-build-isolation` 과 `setuptools<60` 이 **둘 다** 필요하다 — 그냥 깔면
    `AttributeError: install_layout` 으로 멈춘다(데비안이 손댄 setuptools 와 옛 꾸러미가 안 맞는다).
  ⚠`six` 는 따로 깔아야 한다(안 깔면 `ModuleNotFoundError: No module named 'six'`).
  ⚠★**venv 를 만든 뒤 옮기면 깨진다** — `bin/hwp5html` 첫 줄이 만든 자리의 파이썬을 가리켜서,
    옮기면 `FileNotFoundError: … /bin/hwp5html` 이 난다(파일은 있는데 그렇게 보인다 — 실측).
    ⇒ **쓸 자리에서 바로 만든다.**
  깐 판: pyhwp 0.1b15 · six 1.17.0 · olefile 0.47 · lxml 6.1.3 (실측 2026-09-26)
  같은 목록이 옆 `requirements-hwp.txt` 에 있다. ★저장소 루트에 두지 않는다 — CI 가 집지 않게.

[★`hwp5txt` 를 쓰지 않는다 — 표를 잃는다]
  실측(자연유산 별표3): `hwp5txt` 는 **223줄·6,183자**만 냈다. 지금 raw 는 1,122줄이고
  낱말로 견주니 「조망」 242 → **1**, 「안산」 8 → **0** — **표 내용이 통째로 사라진다.**
  `hwp5html` 은 `<table>` **47개**를 주고 알맹이 글자가 **29,875자**(raw 29,807자)로 온전하다.
  ⇒ **`hwp5html` 로 바꾼 뒤 표를 우리 꼴로 옮긴다.**

[표 꼴은 HWPX 쪽과 **같게**]
  `| 칸 | 칸 |` — 저장소가 이미 쓰는 꼴이고 `admrul_rewrite_clean.hwpx글자` 와 같다.
  두 길이 다른 꼴을 내면 **같은 자료가 두 규약으로 쌓인다.**

쓰는 법(다른 자에서):
    from _hwp_read import hwp글자, venv있나
    if not venv있나(): print(만드는법()); return
    글 = hwp글자('/어디/무엇.hwp')
"""
import html as _html
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

VENV = os.environ.get('HWP_VENV') or os.path.expanduser('~/.cache/hwp5venv')
HWP5HTML = os.path.join(VENV, 'bin', 'hwp5html')


def 만드는법():
    return ('⚠`.hwp` 판독기가 없다. 한 번만 만들면 된다 (결심 ⑬ⓐ):\n'
            '    python3 -m venv %s\n'
            "    %s/bin/python -m pip install 'setuptools<60' wheel\n"
            '    %s/bin/python -m pip install --no-build-isolation pyhwp six olefile\n'
            '  ⚠`--no-build-isolation` 과 `setuptools<60` 이 둘 다 필요하다'
            '(그냥 깔면 AttributeError: install_layout 으로 멈춘다).\n'
            '  다른 자리에 만들었으면 `HWP_VENV=<그 자리>` 로 알려 주면 된다.'
            % (VENV, VENV, VENV))


def venv있나():
    return os.path.exists(HWP5HTML)


def 태그떼기(조각):
    """태그를 **빈 글자로** 뗀다 — ⚠공백으로 바꾸면 낱말이 갈라진다.

    `hwp5html` 은 글자를 꾸밈 단위로 `<span>` 에 쪼개 담는다:
        `<span>국</span><span>가유산</span>` · `<span>도모한</span><span> 다.</span>
    태그를 공백으로 바꾸면 **`국 가유산`·`도모한 다.`** 가 된다(실측으로 걸렸다 —
    처음에 그렇게 썼다가 첫 줄부터 `【 국 가유산 …】` 이 나왔다).
    ⇒ 태그는 빈 글자로 떼고, **문단·칸·줄바꿈(`<br>`·`</p>`)만** 공백이 된다.
    """
    t = re.sub(r'<br\s*/?>|</p\s*>|</div\s*>', ' ', 조각, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    return _html.unescape(t)


def 표줄(html조각):
    """`<table>` 한 덩이를 `| 칸 | 칸 |` 줄들로 바꾼다. HWPX 쪽과 같은 꼴이다.

    ★**표 제목(`<caption>`)을 먼저 싣는다.** `<caption>` 은 표 안에 있지만 `<tr>` 밖이라,
      행만 훑으면 **표 제목이 통째로 사라진다.** 실측으로 걸렸다 — 자연유산 별표3 의
      「▾ 역사문화환경 보존재역내 건축행위 … 마련대상 국가유산 유형」 한 줄이 그렇게 빠졌고,
      증명(②잃은 낱말 12가지)이 그것을 잡아 파일을 못 쓰게 막았다.
    """
    줄 = []
    for cap in re.findall(r'<caption\b[^>]*>(.*?)</caption>', html조각, re.S | re.I):
        글 = re.sub(r'\s+', ' ', 태그떼기(cap)).strip()
        if 글:
            줄.append(글)
    for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', html조각, re.S | re.I):
        칸 = []
        for td in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', tr, re.S | re.I):
            칸.append(re.sub(r'\s+', ' ', 태그떼기(td)).strip())
        if 칸:
            줄.append('| ' + ' | '.join(칸) + ' |')
    return 줄


def hwp글자(path, timeout=1200):
    """`.hwp` 를 글자로 바꾼다. 표는 행 단위(`| 칸 | 칸 |`). 못 읽으면 예외를 던진다.

    ⚠**느리다 — 문턱을 실측으로 잡았다.** `hwp5html` 은 3.3MB(어선구조기준)에 **351초** 걸렸다
      (자연유산 별표3 은 몇 초). 처음 300초로 두었더니 그 한 파일이 시간초과로 막혔다 —
      「판독기가 못 읽는다」가 아니라 **내 문턱이 짧았던** 것이다. 그래서 1200초로 둔다.

    ★**평면 정규식으로 훑지 않는다 — 나무로 훑는다.** 처음엔 `<table>…</table>|<p>…</p>` 를
      정규식으로 차례로 물었는데 **표를 통째로 놓쳤다.** 까닭: `hwp5html` 은 표를
          `<p><span class="TableControl"><table>…</table></span></p>`
      처럼 **문단 안에** 넣고, 표 칸 안에도 `<p>` 가 있다. 그래서 `<p\b[^>]*>.*?</p>` 가
      **표 칸 안의 `</p>` 에서 끊겨** 표가 문단으로 잘못 읽혔다.
      실측: 자연유산 별표3 의 세로쓰기 머리칸(`장/소/성`)이 그대로 남아 V5-20 이 안 줄었다
      (덩이 202 → 197 밖에 안 줄었는데 그 파일만 35덩이였다 — 그래서 들여다봤다).
    ⇒ `xml.etree` 로 파싱해 **문서 순서대로** 훑는다(HWPX 쪽과 같은 방식 · 부모 지도로 표 안팎을 가린다).
    """
    if not venv있나():
        raise RuntimeError(만드는법())
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([HWP5HTML, '--output', tmp, path],
                           capture_output=True, text=True, timeout=timeout)
        f = os.path.join(tmp, 'index.xhtml')
        if not os.path.exists(f):
            raise RuntimeError('hwp5html 이 글을 못 냈다: ' + (r.stderr or '')[-200:])
        h = open(f, encoding='utf-8').read()

    # DOCTYPE 를 떼고 파싱한다(바깥 DTD 를 가져오려 하지 않게).
    h = re.sub(r'<!DOCTYPE[^>]*>', '', h, count=1)
    root = ET.fromstring(h)

    부모 = {}
    for 어버이 in root.iter():
        for 자식 in 어버이:
            부모[id(자식)] = 어버이

    def 이름(el):
        return el.tag.rsplit('}', 1)[-1].lower()

    def 가장가까운표(el):
        x = 부모.get(id(el))
        while x is not None:
            if 이름(x) == 'table':
                return id(x)
            x = 부모.get(id(x))
        return None

    def 속글자(el):
        """그 요소 아래 글자를 다 모은다. ⚠태그 사이에 공백을 넣지 않는다 —
        `hwp5html` 이 글자를 꾸밈 단위로 `<span>` 에 쪼개 담아, 공백을 넣으면
        **`국 가유산`·`도모한 다.`** 가 된다(실측으로 걸렸다)."""
        return re.sub(r'\s+', ' ', ''.join(el.itertext())).strip()

    out = []
    for el in root.iter():
        t = 이름(el)
        if t == 'table':
            if 가장가까운표(el) is not None:
                continue                              # 겹표 — 바깥 표가 제 칸 안에 싣는다
            for cap in el.iter():
                if 이름(cap) == 'caption' and 가장가까운표(cap) == id(el):
                    글 = 속글자(cap)
                    if 글:
                        out.append(글)                # ★표 제목을 잃지 않는다
            for tr in el.iter():
                if 이름(tr) != 'tr' or 가장가까운표(tr) != id(el):
                    continue
                칸 = [속글자(td) for td in tr if 이름(td) in ('td', 'th')]
                if 칸:
                    out.append('| ' + ' | '.join(칸) + ' |')
            continue
        if t != 'p' or 가장가까운표(el) is not None:
            continue
        # 표 밖 문단 — 그 안에 든 표의 글자는 위에서 실었으니 뺀다.
        buf = []
        for x in el.iter():
            if 이름(x) == 'table':
                break                                 # 이 문단에 표가 들어 있다 — 앞부분만 싣는다
            if x is not el and x.text:
                buf.append(x.text)
            elif x is el and x.text:
                buf.append(x.text)
            if x.tail and 가장가까운표(x) is None:
                buf.append(x.tail)
        글 = re.sub(r'[ \t]+', ' ', ''.join(buf)).strip()
        if 글:
            out.append(글)
    return '\n'.join(out)


if __name__ == '__main__':
    import sys
    if not venv있나():
        print(만드는법())
        raise SystemExit(1)
    if len(sys.argv) < 2:
        print('쓰는 법: python3 _hwp_read.py <파일.hwp>   — 글자로 바꿔 찍는다')
        raise SystemExit(2)
    print(hwp글자(sys.argv[1]))
