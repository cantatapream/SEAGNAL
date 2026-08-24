#!/usr/bin/env python3
"""법령 신선도 대조 — 우리가 받아 둔 **법률·시행령·시행규칙** 원문이 지금도 현행판인지 확인한다.

[왜 있나 — 2026-08-24, 사용자 지적으로 만듦]
행정규칙(고시·훈령)은 `admrul_fresh.py` 가 653건을 **전수 대조**해 낡은 사본을 잡아낸다.
그런데 **법률·시행령·시행규칙에는 그런 장치가 없었다.** 있는 것은 매일 새벽 도는
`detect_law_changes.py` 뿐인데, 그건 *"최근 7일 안에 바뀐 게 있나"* 를 묻는 **창(window)** 방식이다.
  · 창 밖에서 바뀐 것은 한 번 놓치면 **다시는 안 잡힌다.**
  · 스캐너가 며칠 안 돌면 그 기간 개정은 통째로 빠진다.
이 스크립트는 창을 쓰지 않는다 — **우리 사본의 판번호와 현행판 번호를 1:1로 맞춰 본다.**
그래서 아무리 오래전에 어긋난 것이라도 잡힌다. 판정은 숫자 비교뿐이라 AI 판단이 없다.

[어떻게 판정하나]
`raw/*/*/_meta.json` 의 `families` 에 계열별 **MST**(그 판 고유번호)와 **법령ID** 가 적혀 있다.
law.go.kr 에 `lawSearch.do?target=eflaw&LID=<법령ID>` 로 그 법의 판 목록을 받아,
**시행일자가 오늘 이전인 것 중 가장 최신** 판의 일련번호와 우리 MST 를 비교한다.

⚠**시행예정 판을 현행으로 착각하면 안 된다**(2026-08-24 실측으로 확인한 함정).
  산업안전보건법을 조회하면 맨 위 세 건의 시행일자가 20270108·20270101·20261208 — 전부 미래다.
  그대로 맨 위와 비교하면 **아직 시행도 안 된 개정 때문에 멀쩡한 사본이 "구버전"으로 잡힌다.**
  그래서 시행일자로 걸러 낸다. 시행예정 판은 결함이 아니라 **참고 정보**로 따로 담는다.

⚠**한계**: 판번호만 본다. 번호가 같아도 우리가 옮겨 적는 과정에서 조문이 빠졌는지는 못 잡는다
  (그건 `mok_audit.py` 몫이다). 통과했다고 원문이 완전하다는 뜻이 아니다.

[쓰는 법]
  python3 law_fresh.py                 → 전수 대조(74법 x 3계열, 수 분)
  python3 law_fresh.py --limit 10      → 앞 10개 법만
  python3 law_fresh.py --out PATH      → 결과 저장 위치 지정
  python3 law_fresh.py --gate          → 구버전이 있으면 종료코드 1

[연계] ← raw/*/*/_meta.json · law.go.kr DRF API
       → _dashboard/law_fresh_report.json (기본) — services/admrul_fresh_scanner.js 가 읽어
         관리자 '원문신선도' 방에 행정규칙 결과와 **같은 목록으로 합쳐** 보여 준다.
       ⚠읽기 전용 — raw·위키를 고치지 않는다.
"""
import json
import os
import sys
import glob
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'raw')
WIKI = os.path.join(ROOT, 'wiki')
OC = 'hyoo1431'
TIERS = ['법률', '시행령', '시행규칙']
KST = timezone(timedelta(hours=9))


def api(url, tries=3):
    """DRF 조회 1회. 못 받으면 None(= "없다"가 아니라 "모른다")."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception:
            time.sleep(1.5 + i)
    return None


def rows_of(lid):
    """법령ID 로 그 법의 판 목록 전부. 예: rows_of('013647') → [{법령일련번호,시행일자,…}, …]"""
    d = api('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&type=JSON&target=eflaw'
            '&display=100&LID=%s' % (OC, lid))
    if not d:
        return None
    arr = (d.get('LawSearch') or {}).get('law') or []
    if isinstance(arr, dict):
        arr = [arr]
    return arr


def pick_current(rows, today):
    """시행일자가 오늘 이전인 판 중 가장 최신. 같은 날짜가 여럿이면 일련번호가 큰 쪽.

    예: pick_current(rows, '20260824') → {'법령일련번호':'270439', '시행일자':'20250401', …}
    @returns (현행판|None, 시행예정판 목록)
    [연계] ★맨 위 판을 그냥 쓰면 시행예정 개정 때문에 오판한다(머리말 참조).
    """
    live, future = [], []
    for r in rows:
        d = str(r.get('시행일자') or '')
        (future if d > today else live).append(r)
    if not live:
        return None, future
    live.sort(key=lambda r: (str(r.get('시행일자') or ''), int(r.get('법령일련번호') or 0)))
    return live[-1], future


def wiki_pages_of(slug):
    """이 법의 위키 페이지 목록 — 관리자 화면의 "무엇을 고쳐야 하나" 칸에 쓴다."""
    out = []
    for pat in ('statutes/%s.md' % slug, 'concepts/%s__*.md' % slug, 'annexes/%s__*.md' % slug):
        for p in sorted(glob.glob(os.path.join(WIKI, pat))):
            out.append(os.path.relpath(p, ROOT))
    return out


def main():
    argv = sys.argv[1:]
    limit = int(argv[argv.index('--limit') + 1]) if '--limit' in argv else None
    out_path = (argv[argv.index('--out') + 1] if '--out' in argv
                else os.path.join(ROOT, '_dashboard', 'law_fresh_report.json'))
    today = datetime.now(KST).strftime('%Y%m%d')

    targets = []
    for mp in sorted(glob.glob(os.path.join(RAW, '*', '*', '_meta.json'))):
        base = os.path.dirname(mp)
        # raw/15_관련타부처/ 는 다른 부처 법을 **연결된 조문만** 발췌해 둔 폴더다.
        # 애초에 전문을 안 받아 온 것이라 판번호 대조 대상이 아니다(mok_audit.py 와 같은 이유).
        if '15_관련타부처' in base:
            continue
        slug = os.path.basename(base)
        try:
            meta = json.load(open(mp, encoding='utf-8'))
        except Exception:
            continue
        fams = meta.get('families') or {}
        for tier in TIERS:
            f = fams.get(tier)
            if isinstance(f, list):
                f = f[0] if f else None
            if not isinstance(f, dict):
                continue
            mst, lid = str(f.get('MST') or ''), str(f.get('법령ID') or '')
            if not mst or not lid:
                continue
            targets.append({'slug': slug, 'tier': tier, 'mst': mst, 'lid': lid,
                            'name': meta.get('법령명') or slug})
    if limit:
        seen, cut = set(), []
        for t in targets:
            if len(seen) >= limit and t['slug'] not in seen:
                break
            seen.add(t['slug'])
            cut.append(t)
        targets = cut

    print('■ 법령 신선도 대조 — 우리 사본의 판번호와 현행판을 맞춰 본다 (기준일 %s KST)' % today)
    print('   대상: %d개 계열' % len(targets))

    rows, fresh, stale, unknown = [], 0, 0, 0
    for i, t in enumerate(targets, 1):
        got = rows_of(t['lid'])
        if got is None:
            verdict, cur, future = '조회실패', None, []
            unknown += 1
        else:
            cur, future = pick_current(got, today)
            if cur is None:
                verdict = '조회실패'
                unknown += 1
            elif str(cur.get('법령일련번호') or '') == t['mst']:
                verdict = '현행'
                fresh += 1
            else:
                verdict = '구버전'
                stale += 1
        title = '%s %s' % (t['name'], t['tier']) if t['tier'] != '법률' else t['name']
        row = {'title': title, 'tier': t['tier'], 'slug': t['slug'],
               'held_ids': [t['mst']], 'verdict': verdict,
               'files': [os.path.relpath(os.path.join(RAW, '*', t['slug'], t['tier'] + '.txt'), ROOT)],
               'current': None if not cur else {
                   'serial': str(cur.get('법령일련번호') or ''),
                   'issued': str(cur.get('시행일자') or ''),
                   'no': str(cur.get('공포번호') or ''),
                   'state': str(cur.get('법령명한글') or '')},
               # 시행예정은 결함이 아니다. "곧 이렇게 바뀐다"는 참고 정보로만 담는다.
               'pending': [{'serial': str(x.get('법령일련번호') or ''),
                            'issued': str(x.get('시행일자') or ''),
                            'no': str(x.get('공포번호') or '')} for x in (future or [])][:5]}
        if verdict == '구버전':
            row['wiki_pages'] = wiki_pages_of(t['slug'])
        rows.append(row)
        print('[%d/%d] %s %s' % (i, len(targets), verdict, title), flush=True)
        time.sleep(0.15)

    rep = {'checked': len(targets), 'fresh': fresh, 'stale': stale, 'unknown': unknown,
           'basis_date': today, 'rows': rows}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print('\n현행 %d / 구버전 %d / 조회실패 %d (총 %d) -> %s'
          % (fresh, stale, unknown, len(targets), out_path))
    if '--gate' in argv and stale:
        print('\n❌ 구버전 %d건 — 재수집이 필요하다.' % stale)
        for r in rows:
            if r['verdict'] == '구버전':
                print('   · %s (보유 %s → 현행 %s, 시행 %s)'
                      % (r['title'][:50], ','.join(r['held_ids']),
                         r['current']['serial'], r['current']['issued']))
        sys.exit(1)


if __name__ == '__main__':
    main()
