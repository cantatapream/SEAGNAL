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

★**번호가 같아도 판이 다를 수 있다**(2026-09-10 실측). 한 MST 가 시행일 여럿으로 등재되는 단계시행이 있다 —
  「해양환경관리법 시행령」 287499 는 20260630·20260701·20260828 세 개다. 그래서 번호가 같으면
  **우리 파일 안 조문 머리글의 `(시행 …)`** 과 현행판 시행일도 맞춰 본다(`file_effective_date`).

★**이 파일이 옳았다는 것이 2026-09-21 에 확인됐다.** 다른 11곳은 `lawService.do?target=law&MST=`
  만으로 받고 있었고, 그 호출은 한 MST 에 시행일 판이 여럿일 때 **옛 판이나 시행예정 판**을 준다
  (도선법 시행령 243569 → 2년 전 20230101 판). 그 결함으로 A-2 전수 점검이 통째로 무효가 됐다(L-297).
  이 파일의 방식을 **공용 모듈 `law_api_guard.py`(current_efyd / fetch_law_body)로 빼서** 나머지
  도구에 물렸다. ⚠이 파일은 **그대로 둔다** — 이미 옳고, 굳이 공용 모듈로 바꿔 쓸 이유가 없다.
  다만 판 고르는 규칙을 고칠 일이 생기면 **두 곳을 같이** 봐야 한다.

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
import re
import sys
import glob
import time
import urllib.request
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _fail_reasons                                 # 3-80 — 실패한 까닭을 버리지 않는다

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
                body = r.read().decode('utf-8', 'replace')
            try:
                return json.loads(body)
            except ValueError:
                _fail_reasons.note_body(body)       # 오류 쪽 HTML 이 왔다 — 첫 글자를 까닭으로 남긴다
        except Exception as e:
            _fail_reasons.note(e)
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


def file_effective_date(slug, tier):
    """우리 raw 파일이 **어느 시행일 판**인지. 조문 머리글의 `(시행 YYYYMMDD` 첫 값. 없으면 None.

    ★왜 필요한가 (2026-09-10 실측): **한 MST 가 시행일 여러 개로 등재되는 경우가 있다.**
      「해양환경관리법 시행령」 MST 287499 는 `lawSearch(target=eflaw&LID=010632)` 응답에
      시행일 20260630 · 20260701 · 20260828 로 세 번 나온다(공포는 제36478호 하나 —
      개정 조문마다 시행일을 달리 둔 단계시행이다). 우리 파일은 20260701 판이었고
      현행은 20260828 판이라 **제89조⑥ 삭제·제94조⑤ 2의2·2의3 신설**을 갖고 있지 않았다.
      그런데 MST 숫자만 비교하면 287499 == 287499 이라 **'현행'으로 통과한다.**
      이 유형은 이 게이트로는 영원히 안 잡히던 자리다.
    [연계] recollect_tier.old_effective_date 와 같은 규칙(파일 안 첫 `(시행 …`)을 쓴다.
    """
    for p_ in sorted(glob.glob(os.path.join(RAW, '*', slug, tier + '.txt'))):
        # raw/15_관련타부처/ 는 **발췌본**이라 판번호 대조 대상이 아니다(위 targets 루프와 같은 이유).
        # 같은 법이 두 폴더에 있을 때 발췌본을 집으면 엉뚱한 시행일을 읽는다(2026-09-10 실측:
        # 해양환경관리법 법률이 전문 20260828 인데 발췌본 20260701 을 읽어 오판할 뻔했다).
        if '15_관련타부처' in p_:
            continue
        try:
            with open(p_, encoding='utf-8', errors='replace') as f:
                m = re.search(r'\(시행 (\d{8})', f.read())
        except Exception:
            continue
        if m:
            return m.group(1)
    return None


def wiki_pages_of(slug):
    """이 법의 위키 페이지 목록 — 관리자 화면의 "무엇을 고쳐야 하나" 칸에 쓴다."""
    out = []
    for pat in ('statutes/%s.md' % slug, 'concepts/%s__*.md' % slug, 'annexes/%s__*.md' % slug):
        for p in sorted(glob.glob(os.path.join(WIKI, pat))):
            out.append(os.path.relpath(p, ROOT))
    return out


def judge(t, cur):
    """우리 사본과 현행판을 견줘 판정한다 → `(verdict, same_eff_case)`.

    ★왜 함수로 뺐나 (2026-09-25): 아래 **두 번째 마디**(조회실패 재시도)가 같은 판정을 다시 해야 하는데,
      루프 안의 if/elif 를 베끼면 자가 둘이 된다(§0-E · 뿌리 사슬 ⑥ — 같은 것을 재도 답이 달라진다).
    ⚠판정 이름은 그냥 `'구버전'` 으로 둔다 — 관리자 화면(`services/admrul_fresh_scanner.js`)이
      `verdict === '구버전'` 만 큐에 올리므로 새 이름을 만들면 화면에서 사라진다.
      어떤 종류인지는 `same_mst_diff_eff` 플래그로 따로 남긴다.
    """
    if cur is None:
        return '조회실패', False
    if str(cur.get('법령일련번호') or '') == t['mst']:
        # ★번호가 같아도 **시행일이 다르면 다른 판이다**(file_effective_date 주석 참조).
        feff = file_effective_date(t['slug'], t['tier'])
        ceff = str(cur.get('시행일자') or '')
        if feff and ceff and feff < ceff:
            return '구버전', True
        return '현행', False
    return '구버전', False


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

    rows = []
    for i, t in enumerate(targets, 1):
        same_eff_case = False
        got = rows_of(t['lid'])
        # ★수는 끝에서 줄을 보고 다시 센다(두 번째 마디가 판정을 바꿀 수 있다) — 여기서 올리지 않는다.
        if got is None:
            cur, future = None, []
        else:
            cur, future = pick_current(got, today)
        verdict, same_eff_case = judge(t, cur)
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
        if same_eff_case:
            row['same_mst_diff_eff'] = True
            row['file_eff'] = file_effective_date(t['slug'], t['tier'])
            row['note'] = ('일련번호는 같은데 우리 파일은 %s 판, 현행은 %s 판이다 — 한 번호가 시행일을 '
                           '여럿 갖는 단계시행이다. recollect_tier.py --one %s %s %s %s 로 받는다.'
                           % (row['file_eff'], row['current']['issued'], t['slug'], t['tier'],
                              t['mst'], row['current']['issued']))
        rows.append(row)
        print('[%d/%d] %s %s' % (i, len(targets), verdict, title), flush=True)
        time.sleep(0.15)

    # ★**두 번째 마디 — 「조회실패」를 끝에서 한 번 더 두들긴다** (2026-09-25 신설, P-20 후속)
    #   [무슨 일이 있었나] 2026-09-20 판이 `조회실패 16`, 오늘 1차가 `6` 이었다. 그 6건을 **하나씩
    #   다시 두들겨 보니 6건 다 열렸고, 전부 우리 판이 현행과 같았다**(일련번호까지 동일).
    #   즉 「조회실패」는 결함이 아니라 **그 순간 망이 끊긴 것**이었고, 보고서가 그것을 결함처럼 적고 있었다.
    #   ★같은 병을 P-20 에서 이미 만났다 — `backfill_lawid` 가 망오류를 「법령ID 없음」이라 적어
    #   13층이 나흘 동안 방치됐다. **까닭을 뭉치거나 한 번만 두들기면, 다음 사람이 엉뚱한 곳을 본다.**
    #   행정규칙 쪽에는 이미 `admrul_fresh_pass2.py` 가 있었는데 **법률 계열에는 없었다.**
    #   [무엇을 하나] 1차에서 `조회실패` 로 남은 줄만 다시 조회해 **같은 판정 함수 `judge()`** 로 다시 매긴다.
    #   ⚠재시도해도 안 열리면 그대로 `조회실패` 로 둔다 — 없는 것을 있다고 하지 않는다.
    retry = [r for r in rows if r['verdict'] == '조회실패']
    if retry:
        print('\n■ 두 번째 마디 — 조회실패 %d건을 다시 두들긴다' % len(retry), flush=True)
        by_slug_tier = {(t['slug'], t['tier']): t for t in targets}
        for r in retry:
            t = by_slug_tier.get((r['slug'], r['tier']))
            if not t:
                continue
            got = rows_of(t['lid'])
            cur2, fut2 = (None, []) if got is None else pick_current(got, today)
            v2, same2 = judge(t, cur2)
            if v2 == '조회실패':
                print('   · %s — 다시 두들겨도 안 열린다' % r['title'][:44], flush=True)
                continue
            r['verdict'] = v2
            r['2차에_열렸다'] = True
            r['current'] = None if not cur2 else {
                'serial': str(cur2.get('법령일련번호') or ''),
                'issued': str(cur2.get('시행일자') or ''),
                'no': str(cur2.get('공포번호') or ''),
                'state': str(cur2.get('법령명한글') or '')}
            r['pending'] = [{'serial': str(x.get('법령일련번호') or ''),
                             'issued': str(x.get('시행일자') or ''),
                             'no': str(x.get('공포번호') or '')} for x in (fut2 or [])][:5]
            if v2 == '구버전':
                r['wiki_pages'] = wiki_pages_of(t['slug'])
            if same2:
                r['same_mst_diff_eff'] = True
                r['file_eff'] = file_effective_date(t['slug'], t['tier'])
            print('   · %s → %s (2차에 열렸다)' % (r['title'][:44], v2), flush=True)
            time.sleep(0.15)

    # ★수는 **줄에서 다시 센다** — 루프 안에서 올리던 카운터는 두 번째 마디와 어긋날 수 있다.
    fresh = sum(1 for r in rows if r['verdict'] == '현행')
    stale = sum(1 for r in rows if r['verdict'] == '구버전')
    unknown = sum(1 for r in rows if r['verdict'] == '조회실패')
    rep = {'checked': len(targets), 'fresh': fresh, 'stale': stale, 'unknown': unknown,
           '2차에_열린_줄': sum(1 for r in rows if r.get('2차에_열렸다')),
           'fail_reasons': _fail_reasons.top(),
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
