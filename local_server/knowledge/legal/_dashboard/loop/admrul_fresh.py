#!/usr/bin/env python3
"""행정규칙 신선도 대조 — 수집해 둔 원문의 일련번호를 law.go.kr 현행본과 기계 대조한다.

무엇을 하나:
  raw/ 밑 '행정규칙' 경로의 .txt 파일 머리글에 적힌 `ID:<행정규칙일련번호>` 를 읽어,
  law.go.kr DRF `lawSearch.do?target=admrul` 이 지금 내려주는 현행 일련번호와 비교한다.
  다르면 그 파일(과 그 파일에서 뽑아낸 별표들)은 구버전이다.

왜 필요한가:
  24차 라운드에서 '위험물 선박운송 기준'이 2016년판(2100000059129)으로 수집돼 있어
  삭제된 조문을 현행처럼 위키에 싣고 있었다. 사람이 전수로 눈으로 볼 일이 아니라
  API 응답과 1:1로 맞춰보면 끝나는 결정론적 작업이라 스크립트로 만든다.
  (CLAUDE.md 결정로그: "구멍 탐지류 작업 — AI보다 로직(API 직접대조) 우선")

[연계]
  - 읽음: local_server/knowledge/legal/raw/**/행정규칙/**/*.txt (머리글 ID)
  - 호출: https://www.law.go.kr/DRF/lawSearch.do (OC=hyoo1431, target=admrul)
  - 씀:   _dashboard/admrul_fresh_report.json
사용법: python3 admrul_fresh.py [--limit N] [--out PATH]
"""
import json, os, re, subprocess, sys, time
from urllib.parse import quote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'raw')
OC = 'hyoo1431'
CA = '/root/.ccr/ca-bundle.crt'
PROXY = os.environ.get('HTTPS_PROXY', '')

TITLE_RE = re.compile(r'^\[[^\]]*\]\s*(.+?)\s*$')
ID_RE = re.compile(r'^ID:\s*(\d+)')


def norm(s):
    return re.sub(r'\s+', '', str(s or ''))


def strip_org(s):
    """제목 앞에 우리가 붙여 둔 '(강릉해양경찰서)' 같은 기관 표시를 떼어낸다.

    law.go.kr 공식 행정규칙명에는 이 표시가 없어서, 붙인 채로 대조하면
    전부 '조회실패'로 나온다(첫 시험에서 25건 중 11건).
    """
    return re.sub(r'^\s*\([^)]{2,20}\)\s*', '', str(s or '')).strip()


def scan_files():
    """머리글에 ID가 적힌 행정규칙 원문 파일을 모은다. -> [{path,title,id}]"""
    out = []
    for dirpath, _dirs, files in os.walk(RAW):
        if '행정규칙' not in dirpath:
            continue
        for fn in files:
            if not fn.endswith('.txt'):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding='utf-8', errors='replace') as f:
                    head = [next(f, '') for _ in range(6)]
            except Exception:
                continue
            rid = title = None
            for ln in head:
                if rid is None:
                    m = ID_RE.match(ln.strip())
                    if m:
                        rid = m.group(1)
                if title is None and ln.startswith('['):
                    m = TITLE_RE.match(ln.strip())
                    if m:
                        title = m.group(1)
            if rid and title:
                out.append({'path': os.path.relpath(p, ROOT), 'title': title, 'id': rid})
    return out


def api_current(title):
    """제목으로 현행 행정규칙을 조회해 (일련번호, 발령일자, 발령번호)를 돌려준다."""
    q = strip_org(title)
    url = ('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&type=JSON&target=admrul'
           '&display=20&query=%s' % (OC, quote(q)))
    cmd = ['curl', '-sS', '--max-time', '25', '--cacert', CA]
    if PROXY:
        cmd += ['--proxy', PROXY]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)['AdmRulSearch']
    except Exception:
        return None
    arr = d.get('admrul') or []
    if isinstance(arr, dict):
        arr = [arr]
    wants = {norm(title), norm(q)}
    for x in arr:
        if norm(x.get('행정규칙명')) in wants:
            return {'serial': str(x.get('행정규칙일련번호') or ''),
                    'issued': str(x.get('발령일자') or ''),
                    'no': str(x.get('발령번호') or ''),
                    'state': str(x.get('현행연혁구분') or '')}
    return None


def main():
    limit = None
    out_path = os.path.join(ROOT, '_dashboard', 'admrul_fresh_report.json')
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == '--limit':
            limit = int(args[i + 1])
        elif a == '--out':
            out_path = args[i + 1]

    files = scan_files()
    by_title = {}
    for f in files:
        by_title.setdefault(f['title'], []).append(f)
    titles = sorted(by_title)
    if limit:
        titles = titles[:limit]

    rows, stale, fresh, unknown = [], 0, 0, 0
    for i, t in enumerate(titles, 1):
        cur = api_current(t)
        held = sorted({f['id'] for f in by_title[t]})
        if cur is None:
            verdict = '조회실패'
            unknown += 1
        elif cur['serial'] in held:
            verdict = '현행'
            fresh += 1
        else:
            verdict = '구버전'
            stale += 1
        rows.append({'title': t, 'held_ids': held, 'current': cur, 'verdict': verdict,
                     'files': [f['path'] for f in by_title[t]]})
        print('[%d/%d] %s %s' % (i, len(titles), verdict, t), flush=True)
        time.sleep(0.15)

    rep = {'checked': len(titles), 'fresh': fresh, 'stale': stale, 'unknown': unknown,
           'rows': rows}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print('\n현행 %d / 구버전 %d / 조회실패 %d (총 %d) -> %s'
          % (fresh, stale, unknown, len(titles), out_path))


if __name__ == '__main__':
    main()
