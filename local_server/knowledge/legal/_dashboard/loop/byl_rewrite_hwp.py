#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""별표 raw 를 **원본 `.hwp` 에서 다시 쓴다 — 표는 행 단위로.** 선언: `_dashboard/hwp_byl_rewrite.json`

[왜 — 결심 ⑬ⓐ (2026-09-26 사장님 「들여」)]
  `3-36`(열 단위로 펼쳐진 표)의 가장 큰 것이 별표였고, 그 원본이 **구형 `.hwp`** 라 막혀 있었다.
  판독기를 들였으니(`_hwp_read.py`) 이제 **원본이 가진 행·열 짝을 읽어** 되살린다.
  ★P-8 이 못박은 *「짝을 넘겨짚으면 그것이 바로 환각이다」* 를 지킨다 — **짐작하지 않고 읽는다.**

[길이 왜 다른가]
  행정규칙 본문은 `lawService.do?target=admrul&ID=` 가 첨부 목록을 준다. 그런데 **별표는 그 길이
  JSON 을 안 준다**(HTML 오류쪽이 온다 — 실측). 대신 **검색** `lawSearch.do?target=admbyl&query=<말>`
  이 줄마다 `별표서식파일링크`(`/LSW/flDownload.do?flSeq=…`)를 준다. 그것으로 받는다.
  ⚠저장소에 `admbyl` 을 부르는 자가 하나도 없었다 — 이 길은 이번에 찾았다.

[증명 — 하나라도 못 넘으면 **쓰지 않고 까닭을 적는다**]
  ①**새로 생긴 낱말이 0** — 지어내지 않았다(가장 센 자다)
  ②우리 머리말을 뺀 뒤 **잃은 낱말이 0**
  ③**표 줄이 늘었다** — 열로 풀려 있던 것이 행으로 돌아왔다
  ④알맹이 글자가 **5% 넘게 줄지 않았다**
  ⑤**쓴 뒤 그 파일을 다시 읽어** 증명한 글과 같다

[머리말은 잃지 않는다] 파일 첫 두 줄(`[…] 별표N — …` · `출처: …`)은 **우리가 붙인 것**이다.
  글자를 새로 받아도 그것은 그대로 옮기고, 새 출처를 한 줄 **덧붙인다**(옛 줄을 지우지 않는다).

쓰는 법:
    python3 _dashboard/loop/byl_rewrite_hwp.py              # 마른 실행 — 재기만 한다
    python3 _dashboard/loop/byl_rewrite_hwp.py --apply      # 증명을 넘은 것만 쓴다
    python3 _dashboard/loop/byl_rewrite_hwp.py --dump <폴더>  # 옛·새를 파일로 뽑아 사람이 견준다

[연계] ← `_dashboard/hwp_byl_rewrite.json`(선언) · `_hwp_read.py`(판독기 · venv 필요)
        → `raw/<법폴더>/별표/<이름>.txt` · `_touched.py`(되돌리기) · V5-20(`col_split_scan.js`)
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
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                        # noqa: E402
from _hwp_read import hwp글자, venv있나, 만드는법                      # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
DECL = os.path.join(LEGAL, '_dashboard', 'hwp_byl_rewrite.json')
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
APPLY = '--apply' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
DUMP = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None

낱말 = re.compile(r'[가-힣]{2,}|\d+(?:\.\d+)?|[A-Za-z]{2,}')


def 받기(url, 바이너리=False):
    """curl 로 받는다 — urllib 은 이 프록시 뒤에서 더 약하다(3-65 에서 실측)."""
    for 판 in range(4):
        if 바이너리:
            with tempfile.NamedTemporaryFile(delete=False) as f:
                tmp = f.name
            r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                                '--retry-delay', '2', '-m', '120', '-L', url, '-o', tmp],
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


def 별표찾기(찾는말, 별표번호, 공식명):
    """검색으로 그 별표 줄을 찾아 내려받기 주소를 돌려준다. **고르는 규칙을 선언이 정한다.**

    ⚠흔한 말로 짝을 맞히지 않는다 — **별표번호와 공식 별표명이 둘 다 맞아야** 쓴다
      (오늘 느슨한 이름 맞히기로 헛일을 만든 일이 있다).
    """
    u = ('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&target=admbyl&type=JSON&display=100&query=%s'
         % (OC, urllib.parse.quote(찾는말)))
    d = 받기(u)
    if not d:
        return None, '검색을 못 받았다'
    b = d.get('admRulBylSearch') or {}
    rows = b.get('admrulbyl')
    rows = rows if isinstance(rows, list) else ([] if rows is None else [rows])
    맞는것 = [r for r in rows
           if str(r.get('별표번호') or '') == 별표번호
           and 공식명.replace(' ', '') in str(r.get('별표명') or '').replace(' ', '')]
    if not 맞는것:
        return None, ('그 별표를 못 찾았다(받은 줄 %d개 · 번호 %s · 공식명으로 걸러 0건)'
                      % (len(rows), 별표번호))
    if len(맞는것) > 1:
        return None, '같은 번호·이름이 %d개다 — 기계가 고르지 않는다(G-34)' % len(맞는것)
    link = str(맞는것[0].get('별표서식파일링크') or '')
    if not link:
        return None, '그 줄에 내려받기 주소가 없다'
    return 'https://www.law.go.kr' + link, 맞는것[0]


def 머리말(옛):
    """우리가 붙인 머리말을 그대로 돌려준다 — 첫 빈 줄 앞까지."""
    L = 옛.split('\n')
    끝 = 0
    for i, l in enumerate(L[:12]):
        if not l.strip():
            끝 = i
            break
        끝 = i + 1
    return L[:끝]


def main():
    if not venv있나():
        print(만드는법())
        return 2
    decl = json.load(open(DECL, encoding='utf-8'))
    보고, 한것, 막힌것 = [], 0, 0
    touched = Touched('byl_rewrite_hwp') if APPLY else None

    print('  ── 별표를 원본 `.hwp` 에서 다시 쓴다 (%s) ──'
          % ('실제로 쓴다' if APPLY else '마른 실행 · 쓰지 않는다'))
    for it in decl['별표']:
        이름 = it['이름']
        if ONLY and ONLY not in 이름:
            continue
        p = os.path.join(RAW, it['법폴더'], '별표', 이름 + '.txt')
        if not os.path.exists(p):
            보고.append('❌ %s — 그 raw 가 없다: %s' % (이름, os.path.relpath(p, LEGAL)))
            막힌것 += 1
            continue
        옛 = open(p, encoding='utf-8').read()
        url, 정보 = 별표찾기(it['찾는말'], it['별표번호'], it['공식_별표명'])
        if not url:
            보고.append('❌ %s — %s' % (이름, 정보))
            막힌것 += 1
            continue
        hwp = 받기(url, 바이너리=True)
        if not hwp:
            보고.append('❌ %s — 첨부를 못 받았다' % 이름)
            막힌것 += 1
            continue
        try:
            몸통 = hwp글자(hwp)
        except Exception as e:
            보고.append('❌ %s — 판독기가 못 읽었다: %s' % (이름, str(e)[:120]))
            막힌것 += 1
            continue
        finally:
            os.unlink(hwp)

        머리 = 머리말(옛)
        새출처 = ('출처: 국가법령정보센터 별표 첨부 **HWP** 판독 «%s» — %s 다시 읽었다(결심 ⑬ⓐ). '
               '★표를 **행 단위**(`| 칸 | 칸 |`)로 실었다 — 원본이 가진 행·열 짝을 읽은 것이고 '
               '짐작한 것이 아니다.' % (str(정보.get('별표명'))[:60], time.strftime('%Y-%m-%d')))
        새 = '\n'.join(머리 + [새출처, ''] ) + '\n' + 몸통 + '\n'

        # ── 증명 ────────────────────────────────────────────────
        머리글 = '\n'.join(머리)
        옛몸 = 옛[len(머리글):] if 옛.startswith(머리글) else 옛
        a, b = collections.Counter(낱말.findall(옛몸)), collections.Counter(낱말.findall(몸통))
        새낱말 = sorted([w for w in b if b[w] > a.get(w, 0)], key=lambda w: -(b[w] - a.get(w, 0)))
        잃은낱말 = sorted([w for w in a if a[w] > b.get(w, 0)], key=lambda w: -(a[w] - b.get(w, 0)))
        알 = lambda t: len(re.sub(r'[\s|]', '', t))
        옛표 = len([1 for l in 옛.split('\n') if l.strip().startswith('|')])
        새표 = len([1 for l in 몸통.split('\n') if l.startswith('|')])
        막힘 = []
        if 새낱말:
            막힘.append('①새로 생긴 낱말 %d가지 — 지어낸 것이 있다 %s' % (len(새낱말), 새낱말[:5]))
        if 잃은낱말:
            막힘.append('②잃은 낱말 %d가지 %s' % (len(잃은낱말), 잃은낱말[:5]))
        if 새표 <= 옛표:
            막힘.append('③표 줄이 안 늘었다 %d → %d' % (옛표, 새표))
        if 알(몸통) < 알(옛몸) * 0.95:
            막힘.append('④알맹이 글자가 5%% 넘게 줄었다 %d → %d' % (알(옛몸), 알(몸통)))

        보고.append('%s %s\n'
                    '       표    행으로 실은 줄 옛 %d줄 → 새 %d줄\n'
                    '       글자  알맹이 옛 %s자 → 새 %s자 (%+.1f%%)\n'
                    '       낱말  새로 생긴 것 %d가지 · 잃은 것 %d가지'
                    % ('✅' if not 막힘 else '❌', 이름[:52], 옛표, 새표,
                       '{:,}'.format(알(옛몸)), '{:,}'.format(알(몸통)),
                       100 * (알(몸통) - 알(옛몸)) / max(1, 알(옛몸)),
                       len(새낱말), len(잃은낱말))
                    + (('\n       ★막혔다: ' + ' / '.join(막힘)) if 막힘 else ''))
        if DUMP:
            os.makedirs(DUMP, exist_ok=True)
            open(os.path.join(DUMP, 이름 + '.옛.txt'), 'w', encoding='utf-8').write(옛)
            open(os.path.join(DUMP, 이름 + '.새.txt'), 'w', encoding='utf-8').write(새)
        if 막힘:
            막힌것 += 1
            continue
        if APPLY:
            open(p, 'w', encoding='utf-8').write(새)
            touched.add(p)
            뒤 = open(p, encoding='utf-8').read()
            if 뒤 != 새:
                보고.append('       ❌ 쓴 뒤 확인 — 디스크 글이 증명한 글과 다르다')
            한것 += 1

    print('\n'.join('  ' + x for x in 보고))
    print('\n  통과 %d · 막힌 것 %d' % (한것 if APPLY else (len(decl['별표']) - 막힌것), 막힌것))
    if APPLY and touched:
        touched.save()
    return 0 if not 막힌것 else 1


if __name__ == '__main__':
    sys.exit(main())
