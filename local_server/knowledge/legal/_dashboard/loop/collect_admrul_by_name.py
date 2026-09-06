#!/usr/bin/env python3
"""고시(행정규칙)를 **이름으로 찾아** 그 법 폴더에 받아 둔다.

[왜 있나 — 2026-09-01]
`collect_admrul.py` 는 lsDelegated(위임법령) 매핑으로만 받아 온다. 그런데 위키가 짚는데도
그 매핑에 안 잡히는 고시가 있다 — 예를 들어 **해양경찰서마다 따로 낸** 「유선·도선 및
유선장·도선장 게시사항 및 게시장소에 관한 고시」 16종은 유선및도선사업법의 위임 목록에
안 뜨는데(각 해양경찰서장이 발령), 위키 근거 조문 표는 그 고시들을 짚는다.
V5-8 게이트 "고시 파일을 못 고름" 에 16줄로 잡혀 있었다.

[무엇을 하나]
law.go.kr 행정규칙 검색(target=admrul)에 질의를 넣어 나온 것들을 그 법 폴더의
`행정규칙/` 에 받는다. 파일 꼴은 `collect_admrul.py` 와 같다(`[고시/행정규칙] 이름` + `ID:...`).
**이미 있는 파일은 덮어쓰지 않는다.**

⚠검색 결과를 그대로 다 받으므로, **질의를 좁게 쓰고 먼저 --dry 로 목록을 눈으로 본다.**
   엉뚱한 고시가 섞이면 그 법 폴더가 오염된다.

사용법:
  python3 collect_admrul_by_name.py <법폴더> "<검색어>" [--apply]
  예) python3 collect_admrul_by_name.py raw/10_항만물류/유선및도선사업법 "유선장 게시사항"
[연계] → raw/<도메인>/<법>/행정규칙/<고시명>.txt · _admrul.json
       ⚠받은 뒤에는 `python3 sync_notice_index.py --apply` 로 고시 지도를 갱신한다(V5-8c).
"""
import json, os, re, sys, time, urllib.parse, urllib.request

OC = 'hyoo1431'
LEGAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def api(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def s(x):
    if x is None:
        return ''
    if isinstance(x, list):
        return '\n'.join(s(i) for i in x)
    return str(x)


def safe(n):
    return re.sub(r'[\\/:*?"<>|]', '', n).replace(' ', '')[:60]


def fetch_body(sid):
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={sid}")
    if not d:
        return None, {}
    b = d.get('AdmRulService', {})
    info = b.get('행정규칙기본정보', {})
    jo = s(b.get('조문내용'))
    byl = b.get('별표', {})
    byltxt = ''
    if byl:
        for un in L(byl.get('별표단위') if isinstance(byl, dict) else byl):
            byltxt += '\n[별표] ' + s(un.get('별표제목')) + '\n' + re.sub(r'<[^>]+>', ' ', s(un.get('별표내용')))
    body = (jo + ('\n\n' + byltxt if byltxt.strip() else '')).strip()
    return body, info


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return
    folder = sys.argv[1]
    query = sys.argv[2]
    apply = '--apply' in sys.argv
    base = folder if os.path.isabs(folder) else os.path.join(LEGAL, folder)
    if not os.path.isdir(base):
        print('그런 법 폴더가 없다:', base)
        return

    d = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target=admrul"
            f"&display=100&query={urllib.parse.quote(query)}")
    arr = L(((d or {}).get('AdmRulSearch') or {}).get('admrul'))
    print(f'검색 「{query}」 → {len(arr)}건')
    if not arr:
        return

    outdir = os.path.join(base, '행정규칙')
    os.makedirs(outdir, exist_ok=True)
    cat_path = os.path.join(outdir, '_admrul.json')
    try:
        catalog = json.load(open(cat_path, encoding='utf-8'))
    except Exception:
        catalog = {}

    saved = skipped = failed = 0
    for x in arr:
        title = s(x.get('행정규칙명')).strip()
        sid = s(x.get('행정규칙일련번호')).strip()
        fn = safe(title) + '.txt'
        out = os.path.join(outdir, fn)
        mark = '이미있음' if os.path.exists(out) else '받는다'
        print(f'  [{mark}] {title}  ({x.get("행정규칙종류")}, {x.get("소관부처명")})')
        if os.path.exists(out):
            skipped += 1
            continue
        if not apply:
            continue
        body, info = fetch_body(sid)
        if not body:
            print('     ⚠본문을 못 받았다 — 건너뛴다.')
            failed += 1
            continue
        hdr = f"소관부처: {info.get('소관부처명') or x.get('소관부처명') or ''} · 종류: {x.get('행정규칙종류') or ''}"
        open(out, 'w', encoding='utf-8').write(f"[고시/행정규칙] {title}\nID:{sid} · {hdr}\n\n{body}")
        catalog[title] = {'ID': sid, '위임': []}
        saved += 1
        time.sleep(0.25)

    print(f'\n받음 {saved} · 이미있어 건너뜀 {skipped} · 본문 실패 {failed}')
    if apply and saved:
        json.dump(catalog, open(cat_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('⚠다음: python3 sync_notice_index.py --apply  (고시 지도 갱신, V5-8c)')
    if not apply:
        print('(--apply 를 붙이면 실제로 받는다)')


main()
