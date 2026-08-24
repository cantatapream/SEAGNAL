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
사용법: python3 admrul_fresh.py [--limit N] [--out PATH] [--gate]
  --gate : 구버전이 1건이라도 있으면 종료코드 1. 주간 점검 Routine 이 이 코드로 판단한다.
           verify_all.sh 상시 게이트로는 넣지 않는다 — 매 실행이 653회 API 호출이라 무겁다.
"""
import json, os, re, sys, time
import urllib.request
from urllib.parse import quote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'raw')
WIKI = os.path.join(ROOT, 'wiki')
OC = 'hyoo1431'

# 자동 감시에서 뺀 문서 (사용자 확정 2026-08-23)
# 행정규칙 API 의 ID 체계가 아니라 이 창구로는 본문 조회 자체가 안 된다.
# 자치법규나 공공기관 내부규정으로 보이며, 억지로 "조회실패"로 매주 보고되면
# 진짜 문제가 그 잡음에 묻힌다. 성격이 확인되면 그때 맞는 창구로 옮긴다.
EXCLUDED = {
    '어항구 설정(장승포항)': 'ID 2003245 — 7자리로 행정규칙 일련번호 체계가 아니다(자치법규 추정)',
    '한국어촌어항공단 정관': 'ID 2200000092569 — 2200000 계열. 정관은 법령이 아니라 기관 내부규정이다',
}

TITLE_RE = re.compile(r'^\[[^\]]*\]\s*(.+?)\s*$')
ID_RE = re.compile(r'^ID:\s*(\d+)')


def norm(s):
    return re.sub(r'\s+', '', str(s or ''))


# ★우리가 제목 뒤에 붙여 둔 메모(" — 제2026-144호 구판 전사본(보존)" 같은 것).
#   검색어에 그대로 들어가면 law.go.kr 이 아무것도 못 찾는다(2026-08-24 실측으로 확인).
MEMO_RE = re.compile(r'\s*[—\-–]\s*제?\d{4}-\d+호.*$|\s*\(보존\)\s*$|\s*구판\s*전사본.*$')


def strip_org(s):
    """제목 앞에 우리가 붙여 둔 '(강릉해양경찰서)' 같은 기관 표시를 떼어낸다.

    law.go.kr 공식 행정규칙명에는 이 표시가 없어서, 붙인 채로 대조하면
    전부 '조회실패'로 나온다(첫 시험에서 25건 중 11건).
    """
    return MEMO_RE.sub('', re.sub(r'^\s*\([^)]{2,20}\)\s*', '', str(s or ''))).strip()


def wiki_pages_citing(title):
    """이 행정규칙을 인용하는 위키 페이지 목록. 관리자 화면의 "무엇을 고쳐야 하나" 칸에 쓴다.

    ★왜 필요한가: 구버전이라는 사실만 알려주면 관리자는 **어디를 고쳐야 하는지 모른다.**
      제목(기관 표시를 뗀 것)을 위키 본문에서 그대로 찾는다 — 판정하지 않고 위치만 준다.
      찾는 방식이 단순하므로(문자열 포함) 놓치는 것이 있을 수 있다. 있는 것만 보여준다.
    """
    q = strip_org(title)
    if len(q) < 4:
        return []
    hits = []
    for dirpath, _dirs, files in os.walk(WIKI):
        for fn in files:
            if not fn.endswith('.md'):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding='utf-8', errors='replace') as f:
                    if q in f.read():
                        hits.append(os.path.relpath(p, ROOT))
            except Exception:
                continue
    return sorted(hits)


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
    """제목으로 현행 행정규칙을 조회한다. → (정보|None, 사유, 후보목록)

    사유는 셋 중 하나다: `현행확인` · `이름불일치`(응답은 왔는데 공식명이 우리 제목과 다름) ·
    `응답없음`(API 가 답을 안 줌). ★셋을 뭉뚱그리면 안 된다 — 고치는 방법이 서로 다르다.

    ★2026-08-24 — `curl` 호출에서 파이썬 표준 `urllib` 로 바꿨다.
      종전에는 `curl --cacert /root/.ccr/ca-bundle.crt` 를 썼는데, 그 인증서 파일은
      **개발 컨테이너에만 있는 것**이라 실제 서버(fly.io)에서 돌리면 첫 호출부터
      전부 실패한다. 서버 정기작업으로 옮기기로 했으므로(관리자센터 '원문신선도' 방)
      환경에 따라 있고 없고가 갈리는 파일·외부 명령에 기대지 않게 고쳤다.
      같은 저장소의 `detect_law_changes.py`(매일 새벽 개정감지, 이미 서버에서 돌던 것)가
      쓰는 방식과 똑같이 맞췄다 — urllib 는 `HTTPS_PROXY` 환경변수를 스스로 따르므로
      개발 컨테이너에서도 그대로 동작한다.
    """
    q = strip_org(title)
    url = ('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&type=JSON&target=admrul'
           '&display=20&query=%s' % (OC, quote(q)))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    body = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read().decode('utf-8', 'replace')
            break
        except Exception:
            time.sleep(1.5)
    if body is None:
        return None, '응답없음', []
    try:
        d = json.loads(body)['AdmRulSearch']
    except Exception:
        return None, '응답없음', []
    arr = d.get('admrul') or []
    if isinstance(arr, dict):
        arr = [arr]
    wants = {norm(title), norm(q)}
    for x in arr:
        if norm(x.get('행정규칙명')) in wants:
            return ({'serial': str(x.get('행정규칙일련번호') or ''),
                     'issued': str(x.get('발령일자') or ''),
                     'no': str(x.get('발령번호') or ''),
                     'state': str(x.get('현행연혁구분') or '')}, '현행확인', [])
    # ★여기가 종전에 "조회실패"로 뭉뚱그려지던 자리다(2026-08-24 실측으로 갈라냈다).
    #   응답은 멀쩡히 왔는데 **우리 파일 제목과 law.go.kr 공식명이 다른 것**이다.
    #   실측 12건 표본 중 10건이 이 경우였다 — 예:
    #     우리 "수상레저활동 금지구역 **공고**"      ↔ 공식 "… 금지구역 **지정 고시**"
    #     우리 "해양레저활동 **허가대상수역** 고시"   ↔ 공식 "… **허가필요수역** 고시"
    #   ⚠**비슷하다고 자동으로 이어 붙이면 안 된다.** 이 API 는 검색어와 기관이 달라도
    #   다른 기관 고시를 1위로 내놓는다(군산 검색에 강릉 고시가 1위로 나왔다).
    #   그래서 **판정하지 않고 후보만 담아** 사람이 보게 한다.
    return None, '이름불일치', [str(x.get('행정규칙명') or '') for x in arr[:5]]


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
    skipped = [t for t in by_title if t in EXCLUDED]
    for t in skipped:
        by_title.pop(t)
    titles = sorted(by_title)
    if skipped:
        print('감시 제외 %d건 (사용자 확정 2026-08-23):' % len(skipped))
        for t in skipped:
            print('  · %s — %s' % (t, EXCLUDED[t]))
        print()
    if limit:
        titles = titles[:limit]

    rows, stale, fresh, unknown, mismatch = [], 0, 0, 0, 0
    for i, t in enumerate(titles, 1):
        cur, why, cands = api_current(t)
        held = sorted({f['id'] for f in by_title[t]})
        if cur is None:
            # "못 받았다"와 "받았는데 이름이 안 맞는다"는 **완전히 다른 문제다.**
            # 뭉뚱그리면 고칠 방법이 정반대인 둘이 같은 칸에 쌓여 아무도 손을 못 댄다.
            verdict = why
            if why == '이름불일치':
                mismatch += 1
            else:
                unknown += 1
        elif cur['serial'] in held:
            verdict = '현행'
            fresh += 1
        else:
            verdict = '구버전'
            stale += 1
        row = {'title': t, 'held_ids': held, 'current': cur, 'verdict': verdict,
               'files': [f['path'] for f in by_title[t]]}
        if verdict == '이름불일치':
            row['candidates'] = cands
        # 구버전일 때만 위키를 훑는다 — 전수로 하면 653건 x 위키 1,283개라 쓸데없이 무겁다.
        if verdict == '구버전':
            row['wiki_pages'] = wiki_pages_citing(t)
        rows.append(row)
        print('[%d/%d] %s %s' % (i, len(titles), verdict, t), flush=True)
        time.sleep(0.15)

    rep = {'checked': len(titles), 'fresh': fresh, 'stale': stale, 'unknown': unknown,
           'mismatch': mismatch, 'rows': rows}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print('\n현행 %d / 구버전 %d / 이름불일치 %d / 응답없음 %d (총 %d) -> %s'
          % (fresh, stale, mismatch, unknown, len(titles), out_path))
    if mismatch:
        print('   ⚠이름불일치 = 우리 파일 제목과 law.go.kr 공식명이 달라 **확인하지 못한 것**이다.')
        print('     "이상 없음"이 아니다. 제목을 맞춰 주면 그다음부터 자동으로 확인된다.')
    if '--gate' in args and stale:
        print('\n❌ 구버전 %d건 — 재수집이 필요하다(admrul_recollect_stale.py).' % stale)
        for r in rows:
            if r['verdict'] == '구버전':
                print('   · %s (보유 %s → 현행 %s)'
                      % (r['title'][:50], ','.join(r['held_ids']), r['current']['serial']))
        sys.exit(1)


if __name__ == '__main__':
    main()
