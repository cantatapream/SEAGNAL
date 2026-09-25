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
                                [--progress PATH] [--resume PATH]
  --gate : 구버전이 1건이라도 있으면 종료코드 1. 주간 점검 Routine 이 이 코드로 판단한다.
           verify_all.sh 상시 게이트로는 넣지 않는다 — 매 실행이 653회 API 호출이라 무겁다.

  --progress PATH : 한 건을 판정할 때마다 그 줄을 PATH 에 **곧바로 덧붙여 적는다**(JSONL).
  --resume PATH   : PATH 에 이미 판정된 제목은 **다시 묻지 않고 그 결과를 그대로 쓴다.**

★왜 있나 (2026-09-20).
  이 점검은 824건 x 3회 재시도라 두 시간 가까이 걸리는데, 결과를 **맨 끝에 한 번에** 썼다.
  그래서 중간에 프로세스가 사라지면 그때까지 물어본 것이 **통째로 없어졌다.**
  실제로 2026-09-20 에 389/824 에서 죽어 한 시간 어치가 날아갔다(로그에 오류 한 줄 없었다).
  law.go.kr 은 터널이 교환 도중 끊기는 일이 잦아(`ws_closed_mid_exchange`) 이 사고는 또 난다.
  두 플래그를 같이 쓰면 죽은 자리에서 이어받는다:
      python3 admrul_fresh.py --out R.json --progress P.jsonl --resume P.jsonl
  ⚠**기본값은 종전 그대로다.** 두 인자를 안 주면 파일을 하나도 더 만들지 않는다 —
    서버 정기작업(`services/admrul_fresh_scanner.js`)은 `--out` 만 주므로 동작이 안 바뀐다.
  ⚠이어받기는 **판정을 다시 하지 않는다.** 이어받은 줄은 그때 물어본 답이다. 날짜가 지나면
    그만큼 낡는다 — 죽은 실행을 잇는 용도이지, 어제 결과를 오늘 재활용하라는 뜻이 아니다.
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
    # 2026-08-24 추가 — 위 어항공단 정관과 **똑같은 이유**인데 빠져 있었다.
    # 2차 대조가 이 ID(2200000091523)로 본문을 열자 「부부재산약정등기 사무처리 지침」(2001년
    # 등기예규)이 나왔다. 전혀 다른 문서다 — 2200000 계열은 행정규칙 번호 체계가 아니라서
    # 같은 번호가 다른 문서를 가리킨다. 그 엉뚱한 이름으로 다시 검색해 **"구버전"이라는
    # 가짜 판정**이 나왔다. 형제 항목을 뺄 때 이것도 같이 뺐어야 했다.
    '한국해양교통안전공단 정관': 'ID 2200000091523 — 2200000 계열(어항공단 정관과 동일). '
                       '이 ID 로 열면 「부부재산약정등기 사무처리 지침」이 나온다',
    # 2026-09-10 추가 — 위 둘과 **똑같은 2200000 계열**인데 빠져 있었다. 2차 대조가 이 ID
    # (2200000092763)로 본문을 열자 「농촌근대화촉진법 제170조의 확정일부 있는 서류」(1962년)가
    # 나와 'ID불일치'로 남아 있었다. 공단 내부규정이라 행정규칙 창구로는 애초에 확인이 안 된다.
    '(한국어촌어항공단) 바다해설사 양성 및 운영에 관한 지침':
        'ID 2200000092763 — 2200000 계열(어항공단 정관과 동일). 이 ID 로 열면 '
        '「농촌근대화촉진법 제170조의 확정일부 있는 서류」가 나온다. 공단규정은 이 창구 밖이다',
}

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _admrul_id import find_id   # noqa: E402  ★판번호를 찾는 단 한 곳(P-19b)

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


# ★"이 파일은 일부러 남겨 둔 옛 판"이라고 스스로 밝힌 표시(2026-08-24 신설).
#   예: `(원주지방환경청)공공폐수처리시설기본계획통합고시_2026-144호_구판전사.txt`
#   현행본을 따로 받아 두고 옛 판을 근거 보존용으로 남긴 것이라 **낡은 것이 정상**이다.
#   그런데 신선도 점검이 이걸 "구버전"으로 잡아 재수집 대상으로 올렸다 — 그대로 따르면
#   일부러 남겨 둔 보존본을 현행본으로 덮어써 **보존한 이유가 사라진다.**
#   `mok_audit.py` 가 발췌본을 가르는 것과 같은 취지다.
ARCHIVE_MARK = re.compile(r'구\s*판|전사본|보존용|보존\)|폐지\s*당시')


def is_archive(title, path):
    """제목이나 파일명이 스스로 '옛 판 보존본'이라 밝히고 있나."""
    return bool(ARCHIVE_MARK.search(str(title or '')) or ARCHIVE_MARK.search(os.path.basename(path or '')))


def held_is_live(serial):
    """우리가 가진 일련번호 자체가 지금 `현행여부: Y` 인가. → True/False/None(조회실패)

    ★왜 필요한가 (2026-09-10 실측으로 드러남):
      `strip_org()` 가 제목 앞의 기관 표시를 떼어내는 바람에 **다른 기관의 같은 이름 고시**와
      구분이 안 된다. 실측:
        우리 「(해양경찰청) 긴급구조지원기관 능력평가에 관한 규정」 ID 2100000249244
            = 해양경찰청 고시 2024-10 · **현행여부 Y** · 「재난안전법 시행령」 제66조의3제5항(해양)
        검색이 고른 현행 2100000280102 = **소방청** 고시 2026-27 · 같은 이름 · 제66조의3제2항(육상)
      이름만 맞춰 "구버전"으로 판정했고, 그대로 재수집했으면 **해양 고시를 육상 고시로 갈아치울
      뻔했다**(본문 20,846자 → 396자).
    ⚠한계: "우리 것이 Y" 는 "재수집하면 안 된다"까지만 말해 준다. 둘 중 어느 쪽이 이 자리에 맞는
      문서인지는 사람이 본다. 그래서 '현행'으로 되돌리되 이유를 row 에 적어 남긴다.
    """
    url = ('https://www.law.go.kr/DRF/lawService.do?OC=%s&type=JSON&target=admrul&ID=%s'
           % (OC, serial))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                d = json.loads(r.read().decode('utf-8', 'replace'))
            b = (d.get('AdmRulService') or {}).get('행정규칙기본정보') or {}
            v = str(b.get('현행여부') or '').strip()
            return (v == 'Y') if v else None
        except Exception:
            time.sleep(1.5)
    return None


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
            # ★판번호를 찾는 법은 **`_admrul_id.find_id()` 한 곳**에 있다(P-19b · L-386).
            #   전에는 여기서 `^ID:` 만 봤고, 그 탓에 **71개 파일을 구조적으로 못 따라갔다.**
            #   재 보니 그중 28개는 **번호가 이미 있었다** — 라벨이 `행정규칙일련번호:`(13)·`MST`(1)
            #   이거나 같은 폴더 `_admrul.json` 에 있었다(14). 받아 올 것은 **43** 뿐이다.
            #   ⚠raw 는 고치지 않는다 — 번호는 이미 있으니 **읽는 자를 고치는 것**이 옳다.
            rid, _where = find_id(p, ''.join(head))
            title = None
            for ln in head:
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
    hits = [x for x in arr if norm(x.get('행정규칙명')) in wants]
    if hits:
        # ★★검색 결과의 **첫 줄을 현행으로 쓰면 안 된다**(2026-08-24, 사용자 지적으로 발견).
        #   API 는 **아직 시행 안 된 개정 고시**도 같은 이름으로 함께 내려주고,
        #   그것이 발령일자가 최신이라 첫 줄에 온다. 응답에 `현행연혁구분` 이 함께 실려 있어
        #   어느 것이 지금 시행 중인지 API 가 직접 알려 주는데, 종전 코드는 그 칸을 **읽어서
        #   담기만 하고 고르는 데는 안 썼다.**
        #   실측(「선내 안전·보건 및 사고예방 기준」):
        #     2100000282752 발령 2026-07-20 · **시행 2026-10-21** · 현행여부 N  ← 첫 줄
        #     2100000260292 발령 2025-06-13 · 시행 2025-06-13 · 현행여부 Y  ← 우리가 가진 것
        #   첫 줄을 쓰는 바람에 **지금 시행 중인 멀쩡한 사본이 "구버전"으로 판정**됐다.
        #   그대로 재수집했으면 시행 중인 고시를 **아직 시행도 안 된 판으로 갈아치울 뻔했다.**
        live = [x for x in hits if str(x.get('현행연혁구분') or '').strip() == '현행']
        pick = live[0] if live else None
        # 시행예정 판은 결함이 아니라 "곧 이렇게 바뀐다"는 예고다. 따로 담아 보여만 준다.
        pend = [{'serial': str(x.get('행정규칙일련번호') or ''),
                 'issued': str(x.get('발령일자') or ''),
                 'no': str(x.get('발령번호') or '')} for x in hits if x is not pick][:5]
        if pick is None:
            # 이름은 맞는데 어느 것도 '현행'이 아니다 — 폐지됐거나 표기가 특이한 경우다.
            # 임의로 하나 고르지 않는다.
            return None, '현행표시없음', [str(x.get('행정규칙명') or '') for x in hits[:5]]
        return ({'serial': str(pick.get('행정규칙일련번호') or ''),
                 'issued': str(pick.get('발령일자') or ''),
                 'no': str(pick.get('발령번호') or ''),
                 'state': str(pick.get('현행연혁구분') or ''),
                 'pending': pend,
                 # 우리가 가진 번호가 이 목록에서 어떤 상태로 표시되는지도 함께 돌려준다.
                 # ★"아직 시행 전인 판을 우리가 이미 갖고 있다"는 사고를 잡기 위한 것이다
                 #   (2026-08-24 — 첫 줄을 현행으로 쓰던 옛 판정 때문에 실제로 그렇게
                 #   덮어썼을 수 있어 확인이 필요해졌다).
                 'all': [{'serial': str(x.get('행정규칙일련번호') or ''),
                          'state': str(x.get('현행연혁구분') or ''),
                          'issued': str(x.get('발령일자') or '')} for x in hits]},
                '현행확인', [])
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
    progress_path = None
    resume_path = None
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == '--limit':
            limit = int(args[i + 1])
        elif a == '--out':
            out_path = args[i + 1]
        elif a == '--progress':
            progress_path = args[i + 1]
        elif a == '--resume':
            resume_path = args[i + 1]

    files = scan_files()
    by_title = {}
    for f in files:
        by_title.setdefault(f['title'], []).append(f)
    # 스스로 '옛 판 보존본'이라 밝힌 것은 낡은 것이 정상이므로 감시 대상에서 뺀다.
    archived = [t for t, fs_ in by_title.items()
                if all(is_archive(t, f['path']) for f in fs_)]
    for t in archived:
        by_title.pop(t)
    if archived:
        print('보존본이라 제외 %d건 (낡은 것이 정상 — 파일이 스스로 밝힘):' % len(archived))
        for t in archived:
            print('  · ' + t[:70])
        print()
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

    rows, stale, fresh, unknown, mismatch, future_held = [], 0, 0, 0, 0, 0
    total = len(titles)

    def tally(verdict):
        """판정 낱말 하나로 집계 칸을 정한다 — 이어받은 줄과 새로 물은 줄이 **같은 규칙**을 타게.

        [연계] 이어받기(--resume)가 쓴다. 줄마다 verdict 만 보고 세므로, 이어받은 줄과
          지금 물어본 줄의 집계 방식이 어긋날 수가 없다.
        """
        return {'현행': 'fresh', '구버전': 'stale', '미래판보유': 'future_held',
                '이름불일치': 'mismatch', '현행표시없음': 'mismatch'}.get(verdict, 'unknown')

    # ★이어받기 — 죽은 실행이 남긴 줄을 그대로 쓰고, 그 제목은 다시 묻지 않는다.
    #   ⚠깨진 줄(쓰다 만 마지막 줄)은 버린다. 프로세스가 쓰는 도중 사라지면 그럴 수 있다.
    if resume_path and os.path.exists(resume_path):
        done, broken = {}, 0
        with open(resume_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    broken += 1
                    continue
                if r.get('title'):
                    done[r['title']] = r          # 같은 제목이 둘이면 나중 것이 이긴다
        keep = [t for t in titles if t in done]
        for t in keep:
            r = done[t]
            rows.append(r)
            k = tally(r.get('verdict'))
            if k == 'fresh':
                fresh += 1
            elif k == 'stale':
                stale += 1
            elif k == 'future_held':
                future_held += 1
            elif k == 'mismatch':
                mismatch += 1
            else:
                unknown += 1
        titles = [t for t in titles if t not in done]
        print('이어받기: 이미 판정된 %d건은 다시 묻지 않는다 (남은 %d건)%s'
              % (len(keep), len(titles), (' · 깨진 줄 %d개 버림' % broken) if broken else ''))
        skipped_extra = len(done) - len(keep)
        if skipped_extra:
            print('   ⚠이어받기 파일에 있으나 이번 대상이 아닌 제목 %d건은 안 쓴다'
                  ' (대상 목록이 그새 바뀌었다는 뜻이다).' % skipped_extra)
        print()

    prog = open(progress_path, 'a', encoding='utf-8') if progress_path else None
    base = len(rows)
    for i, t in enumerate(titles, base + 1):
        same_name_note = None
        cur, why, cands = api_current(t)
        held = sorted({f['id'] for f in by_title[t]})
        if cur is None:
            # "못 받았다"와 "받았는데 이름이 안 맞는다"는 **완전히 다른 문제다.**
            # 뭉뚱그리면 고칠 방법이 정반대인 둘이 같은 칸에 쌓여 아무도 손을 못 댄다.
            verdict = why
            if why in ('이름불일치', '현행표시없음'):
                mismatch += 1
            else:
                unknown += 1
        elif cur['serial'] in held:
            verdict = '현행'
            fresh += 1
        else:
            verdict = '구버전'
            stale += 1
            # ★우리가 가진 번호가 **그 자체로 현행**이면 구버전일 수 없다 — 이름만 같은
            #   다른 기관 고시를 현행으로 잘못 고른 것이다(위 held_is_live 주석의 실측 사례).
            #   구버전으로 잡힌 몇 건에만 호출하므로 비용은 사실상 없다.
            if held_is_live(held[0]) is True:
                verdict = '현행'
                stale -= 1
                fresh += 1
                same_name_note = ('보유 ID %s 는 지금도 현행(Y)이다. 검색이 고른 %s 는 '
                                  '이름만 같은 다른 문서일 가능성이 높다 — 재수집 금지, 사람이 확인.'
                                  % (held[0], cur['serial']))
        # ★우리가 가진 번호가 **아직 시행 전인 판**이면 그것도 사고다(구버전의 반대 경우).
        #   옛 판정이 검색 첫 줄(=시행예정 판)을 현행으로 보고 재수집했다면 이렇게 남는다.
        if cur and verdict != '현행':
            for x in (cur.get('all') or []):
                if x['serial'] in held and x['state'] != '현행':
                    verdict = '미래판보유'
                    stale -= 1
                    future_held += 1
                    break
        row = {'title': t, 'held_ids': held, 'current': cur, 'verdict': verdict,
               'files': [f['path'] for f in by_title[t]]}
        if same_name_note:
            row['same_name_note'] = same_name_note
        if verdict in ('이름불일치', '현행표시없음'):
            row['candidates'] = cands
        if cur and cur.get('pending'):
            row['pending'] = cur.pop('pending')
        if cur:
            cur.pop('all', None)
        # 구버전일 때만 위키를 훑는다 — 전수로 하면 653건 x 위키 1,283개라 쓸데없이 무겁다.
        if verdict == '구버전':
            row['wiki_pages'] = wiki_pages_citing(t)
        rows.append(row)
        # ★한 건마다 곧바로 적는다 — flush + fsync 까지 해야 프로세스가 사라져도 남는다.
        #   버퍼에만 있으면 죽는 순간 함께 사라져 이어받기가 무의미해진다.
        if prog:
            prog.write(json.dumps(row, ensure_ascii=False) + '\n')
            prog.flush()
            os.fsync(prog.fileno())
        print('[%d/%d] %s %s' % (i, total, verdict, t), flush=True)
        time.sleep(0.15)

    if prog:
        prog.close()

    rep = {'checked': total, 'fresh': fresh, 'stale': stale, 'unknown': unknown,
           'mismatch': mismatch, 'future_held': future_held, 'rows': rows}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print('\n현행 %d / 구버전 %d / ★미래판보유 %d / 이름불일치 %d / 응답없음 %d (총 %d) -> %s'
          % (fresh, stale, future_held, mismatch, unknown, total, out_path))
    if future_held:
        print('   ★미래판보유 = 우리가 **아직 시행 전인 판**을 갖고 있다는 뜻이다. 즉 지금 시행 중인')
        print('     내용과 다른 것을 현행처럼 싣고 있다. 구버전보다 더 나쁠 수 있다 — 먼저 볼 것.')
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
