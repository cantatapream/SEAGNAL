#!/usr/bin/env python3
"""raw 조문 파일에 **목(가.·나.·다.)이 통째로 빠진 곳**을 원본과 직접 대조해 찾는다.

[왜 있나 — 2026-08-23, 25차 결함 검증에서 발견]
선박안전법 시행규칙 제18조①1호("승선인원에 산입되지 않는 사람")는 law.go.kr 원본에
가.·나.·다. 3개 목이 실재하는데(API 직접 조회로 확인), 우리 raw 에는 **호 제목만 남고
목이 통째로 빠져** 있었다. 감사관은 그 raw 를 읽고 "원문 자체에 규정이 없다(content_gap)"고
판정했다 — 실제로는 우리가 수집을 빠뜨린 것(collection_hole)이다.

**이 둘은 해결 경로가 정반대다.** content_gap 은 "없다고 정직하게 쓰기"가 최선이고
collection_hole 은 "다시 받아오기"가 답이다. 뒤바뀌면 그 항목은 영원히 안 고쳐진다 —
"법에 없는 것"으로 분류되는 순간 아무도 다시 찾지 않기 때문이다.

[어떻게 찾나 — 추측하지 않는다. 원본과 숫자를 맞춰 본다]
`_meta.json` 의 MST 로 law.go.kr DRF 원본을 받아 **목이 몇 개인지 세고**, 같은 계열의
우리 raw txt 에서 **목 줄이 몇 개인지 세어** 비교한다. 원본에 있는데 우리에게 없으면 누락이다.
어림짐작하지 않는다 — 양쪽 다 실제로 센 숫자다.

⚠**한계(반드시 알고 쓸 것)**: 이 검사는 **목의 개수**만 본다. 개수가 맞아도 내용이 잘렸거나
표가 유실된 것은 못 잡는다. 통과했다고 수집이 완전하다는 뜻이 아니다.
그리고 별표·행정규칙 파일은 대상이 아니다(조문 구조가 아니라 문서라서 MST 대조가 안 된다).

[고치는 법] 누락이 나오면 `recollect_jomun.py` 로 그 계열을 다시 받는다 —
그 도구는 목을 제대로 옮긴다(63행). 빠진 파일들은 그 도구가 생기기 전에 수집된 것이다.

[쓰는 법]
  python3 mok_audit.py                 → 전수 대조(427개 계열, API 호출 있음 — 수 분 걸림)
  python3 mok_audit.py --law 선박안전법   → 한 법만
  python3 mok_audit.py --gate          → 누락이 있으면 종료코드 1

[연계] ← raw/*/*/_meta.json · law.go.kr DRF API   → _dashboard/mok_audit.json
       ⚠읽기 전용 — 파일을 고치지 않는다. 고치는 것은 recollect_jomun.py 몫이다.
"""
import os
import re
import sys
import json
import glob
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
KINDS = [('법률', '법률.txt'), ('시행령', '시행령.txt'), ('시행규칙', '시행규칙.txt')]

argv = sys.argv[1:]
only = argv[argv.index('--law') + 1] if '--law' in argv else None
# 결과 파일 위치를 밖에서 정할 수 있게 한다(2026-09-20, C-2).
#   기본값은 종전과 같은 `_dashboard/mok_audit.json` 이라 손으로 돌릴 때 동작이 안 바뀐다.
#   ⚠서버 정기작업은 반드시 `--out local_server/data/...` 로 **볼륨**에 써야 한다 —
#     이미지 안(`_dashboard/`)에 쓰면 배포할 때마다 관리자가 처리하던 목록이 통째로 사라진다
#     (`services/admrul_fresh_scanner.js` 머리말 「저장 위치」와 같은 이유다).
OUT = (argv[argv.index('--out') + 1] if '--out' in argv
       else os.path.join(LEGAL, '_dashboard', 'mok_audit.json'))

# recollect_jomun.py 가 목을 6칸 들여쓰기로 적는다(63행). 옛 수집본도 같은 관례를 따랐다.
MOK_LINE = re.compile(r'^\s{4,}[가-힣]\s*\.')

import law_api_guard                 # DRF 오류쪽 판별 + 현행 시행일 판 고정(L-294·L-295)


def L(x):
    return x if isinstance(x, list) else ([x] if x else [])


def api(url, tries=3):
    """DRF 원본을 받는다. 빈 응답이 간헐적으로 오므로 몇 번 다시 시도한다.

    ★**"권한이 없다"와 "네트워크가 흔들린다"를 갈라서 알려 준다** (2026-09-21 신설).
    종전에는 JSON 이 아니면 전부 똑같이 조용히 재시도하고 None 을 줬다. 그래서 law.go.kr 이
    HTTP **200** 과 함께 *"미신청된 목록/본문에 대한 접근입니다"* 라는 HTML 을 돌려줘도
    **네트워크 탓처럼** 보였고, 573계열이 전부 `판정 불가` 로 나오는 동안 **원인이 어디에도
    안 드러났다.** 권한 문제는 재시도로 절대 안 풀리므로 **그 자리에서 한 번 크게 알린다.**
    """
    warned = False
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.strip().startswith('{'):
                return json.loads(body)
            # JSON 이 아니다 — 오류쪽인지 본다. `<h2>` 안에 사유가 들어온다.
            if not warned:
                warned = True
                m = re.search(r'<h2>([^<]{3,80})</h2>', body)
                if m:
                    print('   ⛔law.go.kr 이 본문 대신 오류쪽을 줬다: "%s"' % m.group(1), flush=True)
                    print('      → 재시도로 풀리는 문제가 아니다. OC 계정의 target 신청 상태를 확인할 것.', flush=True)
                    return None      # 권한 문제는 더 두드려 봐야 소용없다
        except Exception:
            pass
        time.sleep(1 + i)
    return None


def api_mok_count(mst):
    """원본에서 목이 몇 개인지 센다. 못 받으면 None(=판정 불가, 0 이 아니다)."""
    # ★target 을 `eflaw` → `law` 로 바꿨다 (2026-09-21).
    #   [왜] 이 OC 계정은 **「현행법령(시행일) 본문 조회」 API 를 신청하지 않았다.**
    #   ⚠처음에 나는 이것을 "`eflaw` 를 신청하지 않았다"고 적었는데 **틀렸다**(2026-09-21 정정).
    #     `lawSearch.do?target=eflaw`(목록)는 JSON 을 정상으로 준다 — 즉 `eflaw` 는 열려 있다.
    #     법제처는 *법령종류* 체크와 *목록/본문 API* 신청을 **따로** 받고, 빠진 것은 뒤쪽 한 건이다.
    #   그 target 으로 **본문**을 부르면 law.go.kr 이
    #   HTTP **200** 과 함께 HTML 오류쪽을 준다 — *"미신청된 목록/본문에 대한 접근입니다."*
    #   `api()` 는 "JSON 이 아니면 실패"로 보고 세 번 재시도한 뒤 None 을 주므로, 겉으로는
    #   **"원본 응답 없음(=모른다)"** 으로만 보였다. 한 건에 26초씩 쓰고 573계열 전부가
    #   `판정 불가` 로 나오는데 **원인이 권한이라는 것이 어디에도 안 드러났다**(2026-09-21 실측).
    #   ⚠교훈: **HTTP 200 이라고 성공이 아니다.** 아래 `api()` 가 그 구분을 하도록 함께 고쳤다.
    #   [왜 `law` 로 바꿔도 되나] **MST 가 판(version)을 고정한다** — target 이 달라도 같은 MST 면
    #   같은 문서다. 실측으로 확인했다: 폐기물관리법 시행규칙 `MST=289271` 을 `target=law` 로
    #   부르니 `시행일자=20260918` 이 왔고, 우리 raw 머리말이 적어 둔
    #   *"target=eflaw, MST=289271, 시행 20260918"* 과 **같다.** 응답 구조(조문→항→호→목)도 같다.
    # ★2026-09-21 재수정: `target=law&MST=` 만으로는 **어느 시행일 판이 올지 못 고른다.**
    #   287955→20260701(현행은 20260828) · 288973→20270101(**시행예정**, 현행은 20260825).
    #   목 개수를 우리 raw(현행 판)와 견주는 점검이므로 **다른 판을 세면 그 자체가 오판이다.**
    #   그래서 현행 시행일자를 조회해 efYd 로 못 박는 공용 함수를 쓴다.
    d = law_api_guard.fetch_law_body(api, OC, mst)
    if not d:
        return None, None
    root = d.get('법령', d)
    n, spots = 0, []
    for a in L(root.get('조문', {}).get('조문단위')):
        for h in L(a.get('항')):
            for x in L(h.get('호')):
                mk = L(x.get('목'))
                if mk:
                    n += len(mk)
                    spots.append('제%s조 %s' % (a.get('조문번호'), str(x.get('호내용'))[:40]))
    return n, spots


rows, no_answer, not_found, excerpt = [], [], [], []

# ★"이 파일은 일부러 일부만 받아온 것"이라고 스스로 밝힌 표시(2026-08-23 신설).
#   `raw/15_관련타부처/` 밑에는 다른 부처 법을 **연결된 조문만** 발췌한 파일이 많다.
#   원본 전체와 목 개수를 비교하면 당연히 모자라므로 "누락"으로 잡히는데, 이건 결함이 아니라
#   의도된 설계다. 실측: 첫 전수 실행에서 누락 68건 중 66건이 이 경우였고, 사람이 파일을
#   하나씩 열어 머리말을 읽고 걸러 냈다. 그 판단을 도구가 대신하게 한다.
#   ⚠표시가 없는 발췌본은 여전히 못 가른다 — 그건 누락으로 잡히고 사람이 봐야 한다.
EXCERPT_MARK = re.compile(
    r'부분\s*수집|발췌\s*수집|\[발췌|연결\s*조문만|전체를\s*편입하지\s*않|일부만\s*수집|해당\s*조문만')


def is_excerpt(path):
    """파일 머리말(앞 12줄)이 '나는 발췌본이다'라고 밝히고 있나."""
    try:
        with open(path, encoding='utf-8') as f:
            head = ''.join(next(f, '') for _ in range(12))
    except Exception:
        return False
    return bool(EXCERPT_MARK.search(head))


metas = sorted(glob.glob(os.path.join(RAW, '*', '*', '_meta.json')))
targets = []
for mp in metas:
    base = os.path.dirname(mp)
    law = os.path.basename(base)
    if only and only not in law:
        continue
    try:
        meta = json.load(open(mp, encoding='utf-8'))
    except Exception:
        continue
    for kind, fn in KINDS:
        fam = (meta.get('families') or {}).get(kind)
        # 계열이 여러 개인 법이 있어 리스트로 적힌 곳이 있다(예: 시행규칙이 부처별로 둘).
        # 첫 항목의 MST 를 쓰되, 리스트라는 사실 자체를 기록해 나중에 사람이 볼 수 있게 한다.
        multi = isinstance(fam, list)
        if multi:
            fam = fam[0] if fam else None
        if not isinstance(fam, dict) or not fam.get('MST'):
            continue
        p = os.path.join(base, fn)
        if os.path.exists(p):
            targets.append((law, kind + ('(계열 여러 개 중 첫째)' if multi else ''), fam['MST'], p))
            continue
        # ★파일이 표준 이름이 아닐 때 조용히 사라지던 자리다(2026-08-23 적대검증에서 발견).
        #   `families` 에 계열이 있다고 적혀 있는데 `시행령.txt` 가 없으면, 종전에는 그 계열이
        #   **대상에도·누락에도·판정불가에도 안 잡히고 그냥 없어졌다** — "모른다"는 신호조차 없었다.
        #   실제로 해양경찰법은 시행령이 `시행령_해양경찰위원회규정.txt` 처럼 개별 이름이라
        #   시행령 3건이 통째로 빠졌고, 그 사실을 도구가 알려주지 않았다.
        #   이제 ①같은 계열 이름으로 시작하는 파일을 찾아보고 ②그래도 없으면 **못 찾았다고 기록**한다.
        alt = sorted(glob.glob(os.path.join(base, kind + '_*.txt')))
        if alt:
            for ap in alt:
                targets.append((law, '%s(%s)' % (kind, os.path.basename(ap)[:-4]), fam['MST'], ap))
        else:
            not_found.append('%s %s — `%s` 없음(families 에는 있다고 적혀 있다, MST=%s)'
                             % (law, kind, fn, fam['MST']))

print('■ 목 누락 대조 — 원본(law.go.kr)과 우리 raw 의 목 개수를 맞춰 본다')
print('   대상 계열: %d개' % len(targets))

for i, (law, kind, mst, p) in enumerate(targets, 1):
    ours = sum(1 for ln in open(p, encoding='utf-8') if MOK_LINE.match(ln))
    theirs, spots = api_mok_count(mst)
    if theirs is None:
        no_answer.append('%s %s (MST=%s)' % (law, kind, mst))
        continue
    if theirs > ours:
        rec = {'law': law, 'kind': kind, 'mst': mst,
               'file': os.path.relpath(p, LEGAL),
               'api_mok': theirs, 'raw_mok': ours, 'missing': theirs - ours,
               'spots': spots[:12]}
        # 스스로 발췌본이라 밝힌 파일은 "모자란 것"이 정상이다 — 결함 목록과 갈라 담는다.
        (excerpt if is_excerpt(p) else rows).append(rec)
    if i % 40 == 0:
        print('   ... %d/%d 대조' % (i, len(targets)), flush=True)

print('\n   ❌원본에 있는데 우리에게 없는 계열 : %d개  ← 고칠 것' % len(rows))
print('   ⏭️발췌본이라 모자란 것이 정상    : %d개  (파일이 스스로 밝힘)' % len(excerpt))
print('   ⚠원본을 못 받아 판정 못 한 계열  : %d개' % len(no_answer))
print('   ⚠파일을 못 찾아 못 본 계열       : %d개  ← 종전에는 조용히 사라지던 것' % len(not_found))
if not_found:
    print('\n   [파일을 못 찾음] families 에는 있다고 적혀 있는데 표준 이름 파일이 없다')
    for x in not_found[:15]:
        print('     · ' + x)
    if len(not_found) > 15:
        print('     … 외 %d개' % (len(not_found) - 15))
if rows:
    rows.sort(key=lambda r: -r['missing'])
    print('   빠진 목 총 개수                  : %d개' % sum(r['missing'] for r in rows))
    print('\n   많이 빠진 순 상위 20')
    for r in rows[:20]:
        print('     %4d개  %s %s  (원본 %d / 우리 %d)'
              % (r['missing'], r['law'], r['kind'], r['api_mok'], r['raw_mok']))

# ★누락이 **0건이어도 반드시 쓴다**(2026-09-20, C-2).
#   종전에는 `if rows:` 안에서만 써서, 누락이 0이면 파일이 아예 안 생겼다. 그러면 읽는 쪽이
#   **지난 번 파일을 지금 결과로 착각**한다 — 다 고쳐 놓고도 화면에는 옛 누락이 계속 뜨거나,
#   반대로 한 번도 안 돌린 것과 "돌렸는데 깨끗한 것"을 구별할 수 없다.
#   쓰는 도중에 죽어도 반쯤 쓰인 JSON 이 남지 않게 임시파일 → rename 으로 갈아끼운다.
_payload = {'missing': rows, 'no_answer': no_answer,
            'excerpt_ok': excerpt, 'file_not_found': not_found,
            'checked': len(targets), 'missing_moks': sum(r['missing'] for r in rows),
            # ⚠`time.strftime` 는 **컨테이너 지역시각**(여기서는 UTC)을 준다. 거기에 'KST' 를
            #   붙이면 아홉 시간 틀린 시각에 맞다고 적는 꼴이다. 오프셋을 직접 더한다.
            'ran_at': time.strftime('%Y-%m-%d %H:%M:%S KST', time.gmtime(time.time() + 9 * 3600))}
_tmp = OUT + '.tmp'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(_tmp, 'w', encoding='utf-8') as _f:
    json.dump(_payload, _f, ensure_ascii=False, indent=1)
    _f.flush()
    os.fsync(_f.fileno())
os.replace(_tmp, OUT)
print('\n   목록 저장: %s  (누락 %d계열 / 대조 %d계열)' % (OUT, len(rows), len(targets)))

if no_answer:
    print('\n   ⚠판정 못 한 계열(원본 응답 없음 — "없다"가 아니라 "모른다"다):')
    for x in no_answer[:15]:
        print('     ', x)

if '--gate' in argv and rows:
    sys.exit(1)
