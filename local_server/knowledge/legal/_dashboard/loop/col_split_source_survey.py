#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V5-20(표가 열 단위로 펼쳐진 자리)이 남긴 쪽마다 **원본 `.hwp`/`.hwpx` 가 있는지 전수 조사한다.

[왜]
  마리나 지침에서 보았듯이, 같은 고시의 첨부에 **PDF 와 `.hwp` 가 같이** 올라와 있는 일이 흔하다.
  우리 전사본은 PDF 쪽에서 왔고 그래서 표가 열 단위로 펼쳐졌다. `.hwp` 가 있으면 되살릴 수 있다.
  ★어느 쪽에 `.hwp` 가 있는지 **짐작하지 않는다 — 창구에 묻는다.**

[읽는 것] `node col_split_scan.js --list` 의 줄(`N줄  <경로>:<행>`) — 게이트가 쓰는 그 자를 그대로 쓴다(L-136).
[묻는 곳] 행정규칙: `lawService.do?target=admrul&ID=<ID>` 의 `첨부파일`.
[가리는 것]
  ⓐ `.hwp`/`.hwpx` 첨부가 있다      → `admrul_body_rewrite_hwp.py` 선언에 넣으면 된다
  ⓑ PDF 만 있다                     → 이 길로는 못 한다(P-13·3-25 · 원본 표 모양이 필요하다)
  ⓒ 머리에 ID 가 없다               → 창구 밖(해경 공고·조례 등) · 다른 길을 찾아야 한다
  ⓓ 별표 파일(법령/행정규칙 별표)    → 별표 창구가 따로다 → `byl_rewrite_hwp.py` 쪽

쓰는 법:  python3 _dashboard/loop/col_split_source_survey.py [--limit N]
내는 것:  `_dashboard/col_split_source_survey.json`
⚠**게이트에서 부르지 마라** — 창구를 부른다(망이 필요하다).
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(LEGAL, '_dashboard', 'col_split_source_survey.json')
OC = 'hyoo1431'
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0


def 받기(url):
    for 판 in range(4):
        r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                            '--retry-delay', '2', '-m', '60', url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith('{'):
            try:
                return json.loads(r.stdout)
            except Exception:
                pass
        time.sleep(2 ** 판)
    return None


def 훑기():
    """게이트가 쓰는 그 자를 그대로 돌린다(L-136) — 우리가 다시 세지 않는다."""
    r = subprocess.run(['node', os.path.join(HERE, 'col_split_scan.js'), '--list'],
                       capture_output=True, text=True, cwd=LEGAL)
    쪽 = {}
    for l in r.stdout.split('\n'):
        m = re.match(r'\s*(\d+)줄\s+(.+?):(\d+)\s*$', l)
        if not m:
            continue
        쪽.setdefault(m.group(2), {'줄': 0, '덩이': 0})
        쪽[m.group(2)]['줄'] += int(m.group(1))
        쪽[m.group(2)]['덩이'] += 1
    return 쪽


def main():
    쪽 = 훑기()
    if not 쪽:
        print('  ❌ 훑는 자가 아무것도 안 냈다 — col_split_scan.js 를 확인해라')
        return 1
    차례 = sorted(쪽.items(), key=lambda x: -x[1]['줄'])
    if LIMIT:
        차례 = 차례[:LIMIT]
    결과 = []
    무 = {'ⓐhwp있다': 0, 'ⓑPDF만': 0, 'ⓒID없다': 0, 'ⓓ별표': 0, '못물었다': 0}
    print('  ── V5-20 이 남긴 %d쪽에 원본 `.hwp` 가 있는지 묻는다 ──' % len(차례))
    for 경로, 수 in 차례:
        p = os.path.join(RAW, 경로)
        한칸 = {'경로': 경로, '줄': 수['줄'], '덩이': 수['덩이']}
        if not os.path.exists(p):
            한칸['가름'] = 'ⓒID없다'
            한칸['까닭'] = '그 파일이 없다'
            무['ⓒID없다'] += 1
            결과.append(한칸)
            continue
        # ⚠머리 창을 넉넉히 잡는다 — 옛 판에는 **격리 문구**(L-244)가 앞에 7줄 붙어 있어
        #   8줄로 끊으면 그 아래 `ID:` 를 놓친다(실측: 무역항 구판 사본 한쪽을 「ID 없다」로 오판했다).
        머리 = ''.join(open(p, encoding='utf-8').readlines()[:24])
        if '/별표/' in 경로:
            한칸['가름'] = 'ⓓ별표'
            한칸['까닭'] = '별표 창구가 따로다 — byl_rewrite_hwp.py 쪽'
            무['ⓓ별표'] += 1
            결과.append(한칸)
            continue
        m = re.search(r'^ID:\s*(\d{6,})', 머리, re.M)
        if not m:
            한칸['가름'] = 'ⓒID없다'
            한칸['까닭'] = '머리에 ID 가 없다(창구 밖 · 해경 공고 등)'
            무['ⓒID없다'] += 1
            결과.append(한칸)
            continue
        ID = m.group(1)
        한칸['ID'] = ID
        d = 받기('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=admrul&ID=%s&type=JSON' % (OC, ID))
        if not d:
            한칸['가름'] = '못물었다'
            한칸['까닭'] = '창구가 JSON 을 안 줬다 — 다시 물어라'
            무['못물었다'] += 1
            결과.append(한칸)
            continue
        첨 = (d.get('AdmRulService') or d).get('첨부파일') or {}
        이름 = 첨.get('첨부파일명') or []
        주소 = 첨.get('첨부파일링크') or []
        이름 = 이름 if isinstance(이름, list) else [이름]
        주소 = 주소 if isinstance(주소, list) else [주소]
        한칸['첨부'] = list(이름)
        hwp = [(n, 주소[i] if i < len(주소) else '') for i, n in enumerate(이름)
               if str(n).lower().endswith(('.hwp', '.hwpx'))]
        # 우리 전사가 어느 PDF 에서 왔는지 — 같은 이름의 hwp 가 있으면 그것이 짝이다
        전사 = re.search(r'첨부파일\s*"([^"]+)"', 머리)
        짝 = None
        if 전사 and hwp:
            줄기 = re.sub(r'\.pdf$', '', 전사.group(1), flags=re.I).strip()
            for n, u in hwp:
                if re.sub(r'\.(hwp|hwpx)$', '', n, flags=re.I).strip() == 줄기:
                    짝 = (n, u)
                    break
        한칸['전사한_PDF'] = 전사.group(1) if 전사 else None
        if hwp:
            한칸['가름'] = 'ⓐhwp있다'
            한칸['hwp첨부'] = [n for n, _ in hwp]
            한칸['이름이_같은_짝'] = 짝[0] if 짝 else None
            한칸['flSeq'] = (re.search(r'flSeq=(\d+)', 짝[1]) or [None, None])[1] if 짝 else None
            무['ⓐhwp있다'] += 1
        else:
            한칸['가름'] = 'ⓑPDF만'
            한칸['까닭'] = '첨부에 hwp/hwpx 가 없다'
            무['ⓑPDF만'] += 1
        결과.append(한칸)

    json.dump({'언제': time.strftime('%Y-%m-%d %H:%M'), '쪽수': len(결과),
               '가름': 무, '쪽': 결과}, open(OUT, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n  가름: ' + ' · '.join('%s %d' % (k, v) for k, v in 무.items()))
    print('\n  ── ⓐ 되살릴 수 있는 쪽 (줄 많은 순) ──')
    for x in sorted([x for x in 결과 if x['가름'] == 'ⓐhwp있다'], key=lambda x: -x['줄']):
        print('   %4d줄  %s\n            hwp 첨부: %s%s'
              % (x['줄'], x['경로'][:88], ' / '.join(x['hwp첨부'])[:90],
                 ('  ★이름이 같은 짝 flSeq=%s' % x['flSeq']) if x.get('flSeq') else '  (이름이 같은 짝은 없다)'))
    print('\n  적었다 → %s' % os.path.relpath(OUT, LEGAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
