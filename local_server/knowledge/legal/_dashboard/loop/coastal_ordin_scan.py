#!/usr/bin/env python3
"""3-22 — **연안 시군구가 어디인지 전국 자치법규로 세어 정한다.** 선언: `_dashboard/coastal_ordin.json`

[왜 다시 세나 — 2026-09-26 실측]
  `raw/_자치법규` 의 174건은 `collect_ordin.py` 가 **상한 둘**에 걸려 받은 것이다:
    `CAP_KW = 40`(키워드당 40건) · `display=100` 인데 **쪽 넘김이 없다**(첫 100건만 본다).
  실측: 이름에 「해수욕장」이 든 조례가 전국 **62건**인데 우리는 **9곳**뿐이었다.
  ⇒ 그 목록으로 「연안 시군구」를 정의하면 **내 손안의 것을 세계라고 부르는 것**이 된다(L-384).

[이 자가 하는 일] 선언에 적힌 낱말로 **쪽을 끝까지 넘겨** 전수를 세고,
  ①낱말마다 전국 건수 ②지자체별 건수 ③**연안 시군구 목록**(해수욕장·어항 조례를 둔 곳)을
  `_dashboard/coastal_ordin_scan.json` 에 적는다. **raw 는 건드리지 않는다**(받는 것은 다음 자의 일).

[정의] 연안 시군구 = **해수욕장 조례 또는 어항 조례를 둔 기초자치단체.**
  까닭과 한계는 선언 파일(`coastal_ordin.json`)에 적혀 있다 — 여기서 정하지 않는다.

[쓰는 법] python3 _dashboard/loop/coastal_ordin_scan.py            # 전수로 세고 적는다
          python3 _dashboard/loop/coastal_ordin_scan.py --only 해수욕장
[연계] 선언 ← `_dashboard/coastal_ordin.json` · 결과 → `_dashboard/coastal_ordin_scan.json`
"""
import json, os, re, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
DECL = os.path.join(LEGAL, '_dashboard', 'coastal_ordin.json')
OUT = os.path.join(LEGAL, '_dashboard', 'coastal_ordin_scan.json')
OC = 'hyoo1431'
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None

# 기초자치단체 이름만 남긴다(`전라남도 무안군` → `무안군`, `부산광역시 사하구` → `부산광역시 사하구`).
#   ⚠광역시의 구는 이름이 겹친다(부산 중구·인천 중구·대구 중구) — **시도를 붙여 둔다.**
SIDO_NAMES = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시',
              '세종특별자치시', '경기도', '강원특별자치도', '강원도', '충청북도', '충청남도', '전북특별자치도',
              '전라북도', '전라남도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시']
SIDO = re.compile('^(' + '|'.join(SIDO_NAMES) + r')\s*')
BASIC = re.compile(r'([가-힣]{1,10}(?:시|군|구))\s*$')


def 받기(url):
    """curl 로 받는다 — 프록시 뒤에서 간헐적으로 끊긴다(실측). 끊기면 다시 부른다."""
    for _ in range(5):
        r = subprocess.run(['curl', '-sS', '--max-time', '30', url,
                            '-H', 'User-Agent: Mozilla/5.0'], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith('{'):
            try:
                return json.loads(r.stdout)
            except Exception:
                pass
        time.sleep(1.5)
    return None


def 목록(kw, page, n=100):
    u = ('https://www.law.go.kr/DRF/lawSearch.do'
         f'?OC={OC}&target=ordin&type=JSON&display={n}&page={page}&query={urllib.parse.quote(kw)}')
    d = 받기(u)
    if not d:
        return None, None
    s = d.get('OrdinSearch') or {}
    rows = s.get('law')
    if rows is None:
        rows = []
    elif isinstance(rows, dict):
        rows = [rows]
    try:
        tot = int(s.get('totalCnt') or 0)
    except Exception:
        tot = 0
    return rows, tot


def 지자체(기관명, 조례명):
    t = str(기관명 or '').strip()
    if not t:
        t = str(조례명 or '').split()[0] if 조례명 else ''
    시도 = ''
    m = SIDO.match(t)
    if m:
        시도 = m.group(1)
        t = t[m.end():].strip()
    b = BASIC.search(t)
    if not b:
        return (시도 or t or '기타'), 시도          # 시·도 자체가 만든 조례
    return ((시도 + ' ' + b.group(1)).strip() if 시도 else b.group(1)), 시도


def main():
    decl = json.load(open(DECL, encoding='utf-8'))
    종류 = decl['조례4종']
    결과 = {'_잰날': '2026-09-26', '_정의': decl['★연안 시군구를 무엇으로 정의하나'],
           '낱말별': {}, '지자체별': {}, '연안시군구': []}
    해수욕장어항 = set()
    for 이름, spec in 종류.items():
        for kw in spec['낱말']:
            if ONLY and ONLY != kw:
                continue
            rows, tot = 목록(kw, 1)
            if rows is None:
                print(f"  ⚠{kw} — 못 불렀다")
                결과['낱말별'][kw] = {'전국': None, '받은목록': 0, '⚠': '못 불렀다'}
                continue
            all_rows = list(rows)
            page = 2
            while len(all_rows) < tot and page <= 60:      # 쪽을 끝까지 넘긴다(상한을 안 건다)
                more, _ = 목록(kw, page)
                if not more:
                    break
                all_rows += more
                page += 1
                time.sleep(0.2)
            곳 = {}
            for r in all_rows:
                g, _시도 = 지자체(r.get('지자체기관명'), r.get('자치법규명'))
                곳[g] = 곳.get(g, 0) + 1
                결과['지자체별'].setdefault(g, {})[kw] = 결과['지자체별'].get(g, {}).get(kw, 0) + 1
                if kw in ('해수욕장', '어항'):
                    해수욕장어항.add(g)
            결과['낱말별'][kw] = {'전국': tot, '받은목록': len(all_rows), '지자체수': len(곳), '종류': 이름}
            print(f"  {kw:8s} 전국 {tot:5d} · 목록 {len(all_rows):5d} · 지자체 {len(곳):4d}"
                  + ('' if len(all_rows) >= tot else f'  ⚠{tot - len(all_rows)}건 못 받음'))
    # ★기초와 광역을 **가른다**. 정의는 「기초자치단체」인데 처음엔 둘을 섞어 「64곳」이라 셌다
    #   (실측 2026-09-26: 64 = 기초 57 + 광역 7). 광역이 만든 조례도 연안 지자체의 증거이긴 하나
    #   **시군구가 아니다** — 버리지 않고 따로 적는다.
    기초 = sorted(x for x in 해수욕장어항 if x not in SIDO_NAMES)
    광역 = sorted(x for x in 해수욕장어항 if x in SIDO_NAMES)
    결과['연안시군구'] = 기초
    결과['_연안시군구수'] = len(기초)
    결과['연안광역'] = 광역
    결과['_연안광역수'] = len(광역)
    결과['_가른까닭'] = ('정의는 「기초자치단체」다. 광역(도·광역시)이 만든 해수욕장·어항 조례도 '
                     '그 지역이 연안이라는 증거지만 **시군구가 아니다** — 버리지 않고 따로 센다.')
    json.dump(결과, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"\n  ★연안 시군구(기초, 해수욕장·어항 조례를 둔 곳) **{len(기초)}곳**"
          f"  · 광역이 만든 것 {len(광역)}곳(따로 센다)")
    print(f"  적었다 → {os.path.relpath(OUT, LEGAL)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
