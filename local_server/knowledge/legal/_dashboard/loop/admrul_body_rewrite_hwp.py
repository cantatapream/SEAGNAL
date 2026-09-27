#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""행정규칙 **본문** raw 를 원본 `.hwp` 첨부에서 다시 쓴다 — 표는 행 단위로.
선언: `_dashboard/hwp_body_rewrite.json`

[왜 — 결심 ⑬ⓐ · 3-36 · V5-20]
  이 본문들은 첨부 **PDF** 를 PyMuPDF 로 전사한 것이라 표가 **열 단위로 펼쳐져** 있다.
  같은 고시의 첨부에 **`.hwp` 원본**이 같이 올라와 있다 — 그것을 읽으면 원본의 행·열 짝이 온다.
  ★P-8 「짝을 넘겨짚으면 그것이 바로 환각이다」 — 짐작하지 않고 읽는다.

[★판독기가 못 하는 것 — 수식]
  구형 `.hwp` 의 수식은 `EqEdit` 기록으로 들어 있는데 pyhwp 는 그것을 **빈 칸**으로만 낸다.
  실측(마리나 지침): `hwp5proc xml` 에 `<EqEdit>` 60개 · `script` 속성 0개 · `hwp5html` 은 표식조차 안 낸다.
  ⇒ 옛 PDF 전사본이 담고 있던 **수식 줄을 그대로** 옮겨 둔다. 자리는 「닻」으로 정한다 —
    옛 글에서 그 줄 앞으로 걸어가, **새 글의 한 줄에만** 통째로 드는 옛 줄을 찾아 그 뒤에 넣는다.
    닻이 여럿인 줄은 건너뛰고 더 뒤로 간다(G-34). 하나도 못 찾으면 **쓰지 않는다.**

[증명 — 하나라도 못 넘으면 쓰지 않고 까닭을 적는다]
  ①**옛 몸통 줄이 새 글에서 하나도 안 빠진다** — 가장 센 자다
     ⚠낱말 자는 못 쓴다: PDF 가 낱말을 줄바꿈으로 쪼개 놓아 새 글에서 **붙는** 것이 정상이다
     (실측: 「적/절한」→「적절한」 · 옛에만 있는 낱말 226가지가 전부 이 까닭이었다).
  ②표 줄이 늘었다   ③알맹이 글자(PUA 뺀 것)가 5% 넘게 줄지 않았다
  ④옛 `[부칙]` 블록이 새 글에 그대로 있다   ⑤쓴 뒤 다시 읽어 증명한 글과 같다

쓰는 법:
    python3 _dashboard/loop/admrul_body_rewrite_hwp.py                # 마른 실행
    python3 _dashboard/loop/admrul_body_rewrite_hwp.py --apply        # 증명을 넘은 것만 쓴다
    python3 _dashboard/loop/admrul_body_rewrite_hwp.py --dump <폴더>   # 옛·새를 뽑아 사람이 견준다

[연계] ← `_dashboard/hwp_body_rewrite.json` · `_hwp_read.py`(판독기 · venv 필요)
        → `raw/<법폴더>/행정규칙/<이름>.txt` · `_touched.py` · V5-20(`col_split_scan.js`)
⚠**게이트에서 부르지 마라** — 판독기가 venv 에 있고 CI 는 파이썬 꾸러미를 깔지 않는다.
"""
import collections
import json
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                        # noqa: E402
from _hwp_read import hwp글자, venv있나, 만드는법                      # noqa: E402
from admrul_rewrite_clean import hwpx글자                             # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
DECL = os.path.join(LEGAL, '_dashboard', 'hwp_body_rewrite.json')
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
APPLY = '--apply' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
DUMP = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None

구분선 = '=' * 80
쪽번호 = re.compile(r'^\s*[-–—－]\s*\d{1,3}\s*[-–—－]\s*$')   # PDF 밑단 쪽번호 — 내용이 아니다

# ★같은 글자로 보는 짝 — **선언이 갖는다**(L-386 규칙을 코드에 박지 않는다).
#   옛 전사본은 PDF, 새 글은 원본 hwp/hwpx 다. 같은 기호를 서로 다르게 적으므로
#   이 짝표 없이는 **잃은 것이 하나도 없는데도** 막힌다(2026-09-27 여섯 쪽 실측).
_짝 = json.load(open(DECL, encoding='utf-8'))['★같은 글자로 보는 짝 (표기 차이 · 전부 실측)']
짝_낱말 = sorted(_짝['수식 script 낱말 ↔ 기호']['짝'].items(), key=lambda x: -len(x[0]))
짝_글자 = dict(_짝['깨진 글꼴 짝 ↔ 뜻']['짝'])
짝_글자.update(_짝['대시류는 한 가지로 본다']['짝'])


def 받기(url, 바이너리=False):
    """curl 로 받는다 — urllib 은 이 프록시 뒤에서 더 약하다(3-65 에서 실측)."""
    for 판 in range(4):
        if 바이너리:
            with tempfile.NamedTemporaryFile(delete=False) as f:
                tmp = f.name
            r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                                '--retry-delay', '2', '-m', '180', '-L', url, '-o', tmp],
                               capture_output=True, text=True)
            if r.returncode == 0 and os.path.getsize(tmp) > 1000:
                return tmp
            os.unlink(tmp)
        else:
            r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                                '--retry-delay', '2', '-m', '60', url], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip().startswith('{'):
                try:
                    return json.loads(r.stdout)
                except Exception:
                    pass
        time.sleep(2 ** 판)
    return None


def 첨부주소(ID, 파일명, 적어둔):
    """그 고시의 첨부 목록에서 **이름이 똑같은** 하나를 골라 주소를 돌려준다.

    ⚠이름이 하나만 맞아야 쓴다 — 여럿이면 기계가 고르지 않는다(G-34).
      적어둔 flSeq 와 다르면 **그 사실을 알린다**(원본이 갈렸을 수 있다 · 막지는 않는다).
    """
    u = ('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=admrul&ID=%s&type=JSON'
         % (OC, ID))
    d = 받기(u)
    if not d:
        return None, '본문 JSON 을 못 받았다', None
    r = (d.get('AdmRulService') or d).get('첨부파일') or {}
    이름들 = r.get('첨부파일명') or []
    주소들 = r.get('첨부파일링크') or []
    이름들 = 이름들 if isinstance(이름들, list) else [이름들]
    주소들 = 주소들 if isinstance(주소들, list) else [주소들]
    맞 = [i for i, n in enumerate(이름들) if str(n).strip() == 파일명]
    if not 맞:
        return None, '그 이름의 첨부가 없다 — 받은 이름: %s' % 이름들, None
    if len(맞) > 1:
        return None, '같은 이름의 첨부가 %d개다 — 기계가 고르지 않는다(G-34)' % len(맞), None
    link = str(주소들[맞[0]])
    seq = (re.search(r'flSeq=(\d+)', link) or [None, ''])[1]
    알림 = None if seq == 적어둔 else 'flSeq 가 적어둔 것과 다르다 %s → %s' % (적어둔, seq)
    return link.replace('http://law.go.kr', 'https://www.law.go.kr'), 알림, seq


def 고름(t):
    """견주기 위한 고른 꼴 — PDF 쪽 표기 차이와 깨진 글꼴을 뺀다.

    ★PDF 전사본에는 사용자영역(U+E000~U+F8FF) 글자가 섞여 있다 — **읽을 수 없는 쓰레기**다
      (마리나 지침 582자). 그것을 내용으로 세면 영원히 못 넘는 자가 된다.
    ⚠순서가 중요하다: **PUA 를 지우기 전에** 짝표를 먼저 쓴다 — 짝의 한쪽이 PUA 글자다
      (`\uf0e8`→`→`). 순서를 바꾸면 그 짝이 사라져 짝을 못 맞춘다.
    """
    for k, v in 짝_낱말:                     # 수식 script 낱말 → 기호 (긴 것부터)
        t = t.replace(k, v)
    for k, v in 짝_글자.items():              # 깨진 글꼴·대시류 → 뜻
        t = t.replace(k, v)
    t = (t.replace('ᆞ', '·').replace('ㆍ', '·').replace('․', '·').replace('·', '·')
          .replace('ᄋ', '○').replace('ㅇ', '○').replace('∘', '○').replace('◦', '○')
          .replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'"))
    t = re.sub(r'[\ue000-\uf8ff\x0c]', '', t)
    return re.sub(r'[\s|]', '', t)


def 내용줄(t):
    """PDF **쪽번호 줄**(`- 1 -`)을 뺀 줄들. 원본 `.hwp`/`.hwpx` 글에는 쪽번호가 없다.

    ⚠실측으로 걸렸다: 이것을 내용으로 세는 바람에 세 쪽이 「빠진 줄 1줄」로 막혔다.
      쪽번호는 **닻도 없다**(글 맨 앞에 온다) — 그래서 「자리를 못 정했다」로도 막혔다.
    """
    return [l for l in t.split('\n') if not 쪽번호.match(l)]


def 없는글자종(옛몸, 새글):
    """옛 몸통에 있는데 새 글에 **한 번도 안 나오는** 글자의 종류. 이것이 「잃었나」를 재는 자다.

    ★왜 「수」가 아니라 「종류」인가 — 2026-09-27 실측으로 알아냈다.
      **PDF 는 쪽마다 표 머리줄을 되풀이한다.** 무역항 구판에서 「사용료의 종류 / 감면율 /
      사용료 면제대상 선박 및 화물」이 옛 전사본에 **7번**, 원본 HWPX 에 **1번** 나온다
      (HWPX 는 「머리줄 반복」을 셈이 아니라 표 속성으로 담는다).
      그래서 낱글자 **수**를 맞추라고 하면 영원히 못 넘는다 — 원본이 더 적은 것이 맞다.
      ⇒ 잃었는지는 **종류가 사라졌는가**로 본다. 한 종류가 통째로 없어지면 진짜 잃은 것이다.
    ⚠이 자의 한계: 같은 글자가 여러 번 나오다 한 번으로 줄면 못 잡는다. 그래서 「알맹이 ±5%」와
      「표 줄이 늘었다」를 함께 본다. 순서는 원본을 구조대로 읽어 오는 것으로 지킨다.
    """
    b = set(고름(새글))
    return sorted({c for c in 고름('\n'.join(내용줄(옛몸))) if c not in b})


def 모자란글자(옛몸, 새글):
    """옛 몸통에 있고 새 글에 **없는 글자**를 센다 — 이것이 「잃었나」를 재는 자다.

    ★왜 줄이 아니라 글자인가
      PDF 전사본은 낱말을 줄바꿈으로 쪼개 놓았고(「적/절한」), 표를 열 단위로 펼쳐 놓았다.
      그래서 **줄 대조는 못 쓴다.** 더 나쁜 것은, HWPX 는 수식을 script 로 내주는데
      (`rmM_R over W`) PDF 는 그것을 `( M R / W )` 로 쪼개 놓아, 줄 대조로 보면
      **있는 것이 없어 보인다.** 실측(선박복원성기준): 그 착각 때문에 이미 있는 수식을
      100줄이나 다시 끼워 넣어 글자가 +8.4% 늘었다 — 겹친 것이다.
    ⚠이 자의 한계: 글자 수만 보므로 **순서가 뒤바뀐 것은 못 잡는다.** 순서는 원본을
      구조대로 읽어 오는 것으로 지킨다(표는 행 단위로 읽는다).
    """
    a = collections.Counter(고름('\n'.join(내용줄(옛몸))))
    b = collections.Counter(고름(새글))
    return {c: a[c] - b.get(c, 0) for c in a if a[c] > b.get(c, 0)}


def 나누기(옛):
    """옛 raw 를 머리말 / 몸통 / 부칙 세 토막으로 가른다. 돌려주는 것: (머리, 몸통, 부칙, 구분선있었나)

    ⚠구분선(`===…`)이 **없는 파일도 있다** — 실측: 어선구조기준. 그때는 **첫 빈 줄 앞까지**를
      머리말로 본다(별표 쪽 도구가 쓰는 그 규칙). ★없던 구분선을 새로 넣지 않는다 —
      파일의 꼴을 우리가 바꾸면 그것을 읽는 자(파서·시험)가 어긋난다.
    """
    앞뒤 = 옛.split(구분선, 1)
    if len(앞뒤) == 2:
        머리, 나머지, 있었나 = 앞뒤[0].rstrip('\n'), 앞뒤[1].lstrip('\n'), True
    else:
        L = 옛.split('\n')
        끝 = len(L)
        for i, l in enumerate(L[:14]):
            if i and not l.strip():
                끝 = i
                break
        머리, 나머지, 있었나 = '\n'.join(L[:끝]).rstrip('\n'), '\n'.join(L[끝:]).lstrip('\n'), False
    쪼 = re.split(r'\n(\[부칙\]\n)', 나머지, maxsplit=1)
    if len(쪼) == 3:
        return 머리, 쪼[0].rstrip('\n'), (쪼[1] + 쪼[2]).rstrip('\n'), 있었나
    return 머리, 나머지.rstrip('\n'), '', 있었나


def 수식되살리기(옛몸, 새줄, 없는것):
    """새 글에 없는 옛 줄을 **닻 뒤**에 끼워 넣는다. 돌려주는 것: (새줄, 넣은수, 못한줄)

    ★길이 문턱(3자)만 쓰면 **한 글자 수식 줄**(`σ`·`τ`)을 놓친다 — 실측으로 걸렸다
      (알루미늄선: 24줄을 넣고도 σ·τ·α 가 여전히 없었다).
      그래서 「없어진 글자를 담은 줄」은 **길이와 무관하게** 넣는다.
    """
    옛줄 = 옛몸.split('\n')
    고른새 = [고름(l) for l in 새줄]
    한덩이 = ''.join(고른새)
    없는 = set(없는것)
    끼움 = {}                       # 새 글 줄번호 → 그 뒤에 넣을 옛 줄들
    못한 = []
    for k, l in enumerate(옛줄):
        if 쪽번호.match(l):
            continue                  # PDF 쪽번호는 내용이 아니다
        s = 고름(l)
        꼭 = bool(set(s) & 없는)          # 없어진 글자를 담았다 — 길이와 무관하게 넣는다
        if not 꼭 and (len(s) < 3 or s in 한덩이):
            continue
        닻 = None
        for j in range(k - 1, -1, -1):
            t = 고름(옛줄[j])
            if len(t) < 8:
                continue
            걸린 = [i for i, n in enumerate(고른새) if t in n]
            if len(걸린) == 1:       # 하나뿐일 때만 자리가 **정해진다**
                닻 = 걸린[0]
                break
            # 여럿이면 기계가 고르지 않는다 — 더 뒤로 걸어간다(G-34)
        if 닻 is None:
            못한.append(l.strip())
            continue
        끼움.setdefault(닻, []).append(l.rstrip())
    나온 = []
    for i, l in enumerate(새줄):
        나온.append(l)
        for x in 끼움.get(i, []):
            나온.append(x)
    return 나온, sum(len(v) for v in 끼움.values()), 못한


def main():
    decl = json.load(open(DECL, encoding='utf-8'))
    # venv(pyhwp)는 **구형 `.hwp`** 를 읽을 때만 필요하다 — `.hwpx` 는 zip+xml 이라 맨손으로 읽는다.
    if any(not it['첨부파일명'].lower().endswith('.hwpx') for it in decl['본문']) and not venv있나():
        print(만드는법())
        return 2
    보고, 한것, 막힌것 = [], 0, 0
    touched = Touched('admrul_body_rewrite_hwp') if APPLY else None

    print('  ── 행정규칙 본문을 원본 `.hwp` 에서 다시 쓴다 (%s) ──'
          % ('실제로 쓴다' if APPLY else '마른 실행 · 쓰지 않는다'))
    후보 = [it for it in decl['본문'] if not (ONLY and ONLY not in it['이름'])]
    for it in 후보:
        이름 = it['이름']
        p = os.path.join(RAW, it['법폴더'], '행정규칙', 이름 + '.txt')
        if not os.path.exists(p):
            보고.append('❌ %s — 그 raw 가 없다: %s' % (이름, os.path.relpath(p, LEGAL)))
            막힌것 += 1
            continue
        옛 = open(p, encoding='utf-8').read()
        머리, 옛몸, 부칙, 구분선있었나 = 나누기(옛)
        if not 머리:
            보고.append('❌ %s — 머리말 구분선을 못 찾았다(우리 규약이 아니다)' % 이름)
            막힌것 += 1
            continue

        url, 알림, seq = 첨부주소(it['ID'], it['첨부파일명'], it.get('적어둔_flSeq'))
        if not url:
            보고.append('❌ %s — %s' % (이름, 알림))
            막힌것 += 1
            continue
        hwp = 받기(url, 바이너리=True)
        if not hwp:
            보고.append('❌ %s — 첨부를 못 받았다' % 이름)
            막힌것 += 1
            continue
        try:
            # ★첨부가 구형 `.hwp` 인지 `.hwpx` 인지로 판독기를 가른다.
            #   실측(조사 58쪽): 이름이 같은 짝 14쪽 가운데 `.hwp` 2쪽 · `.hwpx` 12쪽 —
            #   `.hwpx` 가 오히려 흔하다. pyhwp 는 `.hwpx` 를 못 읽는다(구형 전용).
            몸통 = (hwpx글자(hwp) if it['첨부파일명'].lower().endswith('.hwpx')
                  else hwp글자(hwp))
        except Exception as e:
            보고.append('❌ %s — 판독기가 못 읽었다: %s' % (이름, str(e)[:140]))
            막힌것 += 1
            continue
        finally:
            os.unlink(hwp)

        # ★되살릴지는 **선언이 정한다**(L-386 규칙을 코드에 박지 않는다 · G-34 기계가 고르지 않는다).
        #   판독기가 수식을 못 내주는 것이 **실측으로 확인된 쪽만** 참으로 적어 둔다.
        #   그렇지 않은 쪽에 되살리기를 하면 **이미 있는 것을 또 넣어** 글이 부푼다 —
        #   실측: 선박복원성기준 +8.4% · 부두운영회사 +7.2% 가 모두 그 겹침이었다
        #   (HWPX 는 수식을 script 로 내준다 — `rmM_R over W`. PDF 는 그것을 `( M R / W )` 로
        #    쪼개 놓아, 줄 대조로 보면 **있는 것이 없어 보인다.**)
        순판독없는것 = 없는글자종(옛몸, 몸통)
        if it.get('수식되살리기'):
            새줄, 넣은수, 못한 = 수식되살리기(옛몸, 몸통.split('\n'), 순판독없는것)
        else:
            새줄, 넣은수, 못한 = 몸통.split('\n'), 0, []
        새몸 = '\n'.join(새줄)

        # ★정정 문구는 **실제로 한 일만** 적는다 — 경우가 둘이다(둘을 한 문구로 쓰면 거짓이 섞인다).
        hwpx = it['첨부파일명'].lower().endswith('.hwpx')
        판독 = 'zip+XML 로 직접' if hwpx else 'pyhwp 로'
        수식말 = (
            ('⚠원본의 **수식을 판독기가 내주지 못한다** — %s. 그래서 옛 PDF 전사본이 담고 있던 '
             '수식 줄 %d줄을 **그 글자 그대로** 원문 순서대로 제자리(바로 앞 문단 뒤)에 옮겨 두었다. '
             '지어낸 것은 없다. ⚠옮긴 줄은 PDF 가 줄바꿈으로 쪼개 놓은 조각이라 **옆 문장을 일부 되풀이할 수 있다** '
             '— 잃는 것보다 겹치는 쪽을 골랐다.'
             % (('pyhwp 가 `EqEdit` 를 빈 칸으로만 낸다' if not hwpx
                 else '수식이 `BinData/ole*.ole` OLE 개체 안에 있어 section XML 에 기호가 한 번도 안 나온다'),
                넣은수))
            if 넣은수 else
            ('원본의 수식은 `<hp:equation><hp:script>` 로 담겨 있어 **그 script 를 그대로** 실었다'
             '(예: `{sum _{…}}`·`` `TIMES` ``). 옛 PDF 전사본에서 옮겨 온 줄은 **없다.**'
             if hwpx else
             '수식은 이 고시에 없다 — 옮겨 온 줄이 없다.'))
        정정 = ('※ 전사 방법 정정(%s): 위 안내의 PDF 전사본은 표를 **열 단위로 펼쳐** 놓았다. 같은 고시의 첨부 '
              '«%s»(flSeq=%s)를 %s 다시 읽어 표를 **행 단위**(`| 칸 | 칸 |`)로 되살렸다 — '
              '원본이 가진 행·열 짝을 읽은 것이고 짐작한 것이 아니다. %s'
              % (time.strftime('%Y-%m-%d'), it['첨부파일명'], seq, 판독, 수식말))

        # ★두 번 돌려도 정정 줄이 겹치지 않게 한다 — 옛 정정 줄은 새 것으로 갈아 끼운다.
        머리줄들 = [l for l in 머리.split('\n') if not l.startswith('※ 전사 방법 정정(')]
        새 = ('\n'.join(머리줄들) + '\n' + 정정 + '\n\n'
              + ((구분선 + '\n') if 구분선있었나 else '')
              + 새몸.strip('\n') + '\n'
              + (('\n' + 부칙 + '\n') if 부칙 else ''))

        # ── 증명 ────────────────────────────────────────────────
        없는것 = 없는글자종(옛몸, 새몸 + '\n' + 부칙)
        모자람 = 모자란글자(옛몸, 새몸 + '\n' + 부칙)
        확인덩이 = 고름(새몸) + 고름(부칙)
        빠진줄 = [l.strip() for l in 내용줄(옛몸)
                if len(고름(l)) >= 3 and 고름(l) not in 확인덩이]
        알 = lambda t: len(고름(t))
        옛표 = len([1 for l in 옛몸.split('\n') if l.strip().startswith('|')])
        새표 = len([1 for l in 새몸.split('\n') if l.startswith('|')])
        막힘, 벌써 = [], False
        if 못한:
            막힘.append('자리를 못 정한 수식 줄 %d줄 %s' % (len(못한), 못한[:3]))
        if 없는것:
            막힘.append('①새 글에서 **통째로 없어진 글자** %d종 %s' % (len(없는것), 없는것[:14]))
        if 새표 < 옛표:
            막힘.append('②표 줄이 **줄었다** %d → %d' % (옛표, 새표))
        elif 새표 == 옛표 and 옛표 > 0:
            벌써 = True      # 이미 다시 쓴 쪽을 또 돌린 것이다 — 흠이 아니다
        if 알(새몸) < 알(옛몸) * 0.95:
            막힘.append('③알맹이 글자가 5%% 넘게 줄었다 %d → %d' % (알(옛몸), 알(새몸)))
        if 부칙 and 부칙 not in 새:
            막힘.append('④부칙 블록을 잃었다')

        보고.append('%s %s%s\n'
                    '       표    행으로 실은 줄 옛 %d줄 → 새 %d줄 (줄 수 %d → %d)\n'
                    '       글자  알맹이(PUA 뺀 것) 옛 %s자 → 새 %s자 (%+.1f%%)\n'
                    '       잃음  통째로 없어진 글자 순판독 %d종 → 되살린 뒤 %d종'
                    ' · (참고) 낱글자 수 차이 %d자(PDF 가 쪽마다 표 머리를 되풀이한다)\n'
                    '       수식  옛 전사본에서 제자리로 옮긴 줄 %d줄 · 자리 못 정한 줄 %d줄'
                    ' · (참고) 줄 대조로 못 찾은 옛 줄 %d줄\n'
                    '       부칙  %s%s'
                    % ('✅' if not 막힘 else '❌', 이름[:52],
                       ('  ⚠' + 알림) if 알림 else '',
                       옛표, 새표, 옛몸.count('\n') + 1, 새몸.count('\n') + 1,
                       '{:,}'.format(알(옛몸)), '{:,}'.format(알(새몸)),
                       100 * (알(새몸) - 알(옛몸)) / max(1, 알(옛몸)),
                       len(순판독없는것), len(없는것), sum(모자람.values()),
                       넣은수, len(못한), len(빠진줄),
                       ('이어받았다 (%d줄)' % (부칙.count('\n') + 1)) if 부칙 else '옛 파일에 없었다',
                       '\n       ※표 줄이 그대로다 — 이 쪽은 **이미 다시 쓴** 것이다(흠이 아니다)' if 벌써 else '')
                    + (('\n       ★막혔다: ' + ' / '.join(막힘)) if 막힘 else ''))
        if DUMP:
            os.makedirs(DUMP, exist_ok=True)
            바른이름 = re.sub(r'[/\\]', '__', it['법폴더'].split('/')[-1] + '_' + 이름)
            open(os.path.join(DUMP, 바른이름 + '.옛.txt'), 'w', encoding='utf-8').write(옛)
            open(os.path.join(DUMP, 바른이름 + '.새.txt'), 'w', encoding='utf-8').write(새)
        if 막힘:
            막힌것 += 1
            continue
        if APPLY:
            open(p, 'w', encoding='utf-8').write(새)
            touched.add(p)
            if open(p, encoding='utf-8').read() != 새:
                보고.append('       ❌ ⑤쓴 뒤 확인 — 디스크 글이 증명한 글과 다르다')
                막힌것 += 1
                continue
            한것 += 1

    print('\n'.join('  ' + x for x in 보고))
    print('\n  통과 %d · 막힌 것 %d' % (한것 if APPLY else (len(후보) - 막힌것), 막힌것))
    if APPLY and touched:
        touched.save()
    return 0 if not 막힌것 else 1


if __name__ == '__main__':
    sys.exit(main())
