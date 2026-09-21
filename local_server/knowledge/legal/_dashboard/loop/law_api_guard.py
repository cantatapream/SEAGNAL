#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/law_api_guard.py
# 역할: law.go.kr DRF 가 **본문 대신 오류쪽(HTML)을 줬을 때 그 사유를 읽어 준다.**
#       "권한이 없다"와 "네트워크가 흔들린다"를 갈라서, 앞의 것은 재시도를 멈추게 한다.
# ============================================================================
#
# [왜 있나 — 2026-09-21, L-294 의 직접 후속]
#   DRF 의 `api()` 는 도구마다 따로 있었고, **전부 같은 결함**이 있었다:
#
#       try: return json.load(r)
#       except Exception: time.sleep(1.5)     # ← HTML 도 여기로 떨어진다
#       return None
#
#   law.go.kr 은 신청 안 된 target 을 부르면 **HTTP 404 가 아니라 HTTP 200** 과 함께
#   *"미신청된 목록/본문에 대한 접근입니다."* 라는 **HTML 안내쪽**을 준다. 위 코드는 그것을
#   `json.load` 실패로만 보고 **네트워크 오류와 똑같이** 삼켰다. 그래서 화면에 남는 말은
#   `응답없음` / `판정 불가` 뿐이었고 — **"권한이 없다"가 "모르겠다"로 바뀌어 나왔다.**
#
#   그 대가가 컸다. A-2 가 3/3 실패했을 때 나는 "law.go.kr 이 불통"이라 판단하고 **작업 넷을
#   한꺼번에 보류**했으며, 7시간 동안 83번을 헛되이 두드렸다(그 탐침도 같은 target 을 썼다).
#   실제로는 호스트가 멀쩡했고 `target=law` 는 내내 정상이었다.
#
# [무엇이 진짜였나 — 2026-09-21 실측, 8회 재시도로 터널 잡음 제거]
#   ★**권한 문제가 아니었다. `efYd` 가 필수인 것이었다.**
#   | 호출                                             | 결과                          |
#   |--------------------------------------------------|-------------------------------|
#   | `lawService` `eflaw` + **맞는 efYd** (246611+20230628) | JSON 177,917 B 시행일=20230628 |
#   | `lawService` `eflaw` + efYd **없음**               | HTTP 200 + HTML `미신청된 …`   |
#   | `lawService` `eflaw` + efYd **엉뚱**(20250101)     | HTTP 200 + HTML `미신청된 …`   |
#   | `lawService` `law` + MST 만                        | JSON 177,467 B 시행일=20230628 |
#   항만법 283707+20260227(198,849 B) 로도 같은 꼴로 재현됐다.
#
#   ⚠**그러므로 `미신청된 목록/본문에 대한 접근입니다` 를 "권한이 없다"로 읽으면 안 된다.**
#     law.go.kr 은 *"인자가 틀려서 그런 판을 못 찾겠다"* 도 이 문구로 답한다. 나는 이 문구를
#     하루 사이에 **두 번 오진**했다 — 처음엔 "호스트 불통"(L-294), 다음엔 "eflaw 미신청".
#     신청은 처음부터 다 돼 있었다. **오류 문구는 증거가 아니라 주장이다.**
#
# [★`target=law` 는 안전한 대체가 아니다 — 2026-09-21 실측]
#   한 MST 가 시행일 판을 둘 이상 가질 때 `target=law&MST=` 는 **어느 판이 올지 고를 수 없다.**
#   | MST                          | `target=law` 가 준 판          | 실제 현행      |
#   |------------------------------|-------------------------------|---------------|
#   | 287955 해양환경관리법 시행규칙 | 20260701 (부칙 52)            | 20260828 (53) |
#   | 288973 농수산물품질관리법 시행령 | **20270101 = 시행예정**        | 20260825      |
#   뒤엣것은 **아직 시행도 안 된 법문을 현행인 양** 준다. 오늘이 2026-09-21 이다.
#   그래서 이 모듈은 `target=law` 로 갈아타지 않고, **현행 시행일자를 조회해 efYd 로 못 박는다.**
#
# [어떻게 현행 시행일자를 아나]
#   `lawSearch.do?target=eflaw&LID=<법령ID>&display=100` 이 그 법의 시행일 판을 **전부** 주고
#   `현행연혁코드` 로 `현행`/`시행예정` 을 구분해 준다(288973 → 20270101 시행예정 · 20260825 현행).
#   `법령ID` 는 `_meta.json` 의 families 에도, `lawService` 응답의 `기본정보.법령ID` 에도 있다.
#
# [★이 방식은 우리가 이미 알고 있던 것이다 — 그게 이 모듈의 존재 이유다]
#   `law_fresh.py` 가 **2026-09-10 부터** 똑같이 하고 있었다. 그 머리말에 이렇게 적혀 있다 —
#     "★번호가 같아도 판이 다를 수 있다. 한 MST 가 시행일 여럿으로 등재되는 단계시행이 있다 —
#      「해양환경관리법 시행령」 MST 287499 는 시행일 20260630·20260701·20260828 로 세 번 나온다.
#      **MST 숫자만 비교하면 287499 == 287499 이라 '현행'으로 통과한다.**"
#   `recollect_tier.py` 머리말에도 같은 반례가 적혀 있었다.
#   **그런데 그 앎이 그 두 파일에만 갇혀 있었고**, 나머지 11곳은 모른 채로 `target=law&MST=` 를
#   불렀다. 그래서 A-2 전수 점검 하나가 통째로 무효가 됐다(L-297).
#   → **이 모듈은 새 지식이 아니라 "한 파일에 갇혀 있던 지식"을 꺼내 공용으로 만든 것이다.**
#     새로 알게 된 것이 생기면 여기에 적어 모두가 쓰게 한다. 한 도구에만 적지 않는다.
#   ⚠`law_fresh.py`·`admrul_fresh.py` 는 **고치지 않았다** — 이미 옳고, 건드리면 위험만 는다.
#
# [연계]
#   - 씀: loop/collect.py · collect_gap.py · crawl.py · recollect_jomun.py · recollect_byl.py
#         detect_law_changes.py · recollect_tier.py · collect_pending_law.py
#         그리고 그 복사본인 _dashboard/collect.py
#   - 같은 판단을 mok_audit.py 는 제 api() 안에 직접 갖고 있다(먼저 만든 쪽이다).
# ============================================================================
import re

_H2 = re.compile(r'<h2>([^<]{3,80})</h2>')

#: 이 말이 들어 있으면 **재시도가 의미 없다** — 사람이 신청을 고쳐야 풀린다.
_FATAL = ('미신청', '인증', '권한', '차단', '등록되지')


def block_reason(body):
    """DRF 응답 본문(str)을 보고 **오류쪽이면 사유 한 줄**을, 아니면 None 을 준다.

    JSON 이 아니라고 해서 전부 오류쪽인 것은 아니다(터널이 끊기면 빈 문자열이 온다).
    `<h2>` 가 잡힐 때만 "서버가 사유를 말해 줬다"고 본다.
    """
    if not body:
        return None
    m = _H2.search(body)
    return m.group(1).strip() if m else None


def is_fatal(reason):
    """그 사유가 **재시도로 안 풀리는 것**인가."""
    return bool(reason) and any(w in reason for w in _FATAL)


def announce(reason, url=''):
    """사유를 눈에 띄게 찍는다. 삼키지 않는 것이 이 모듈의 존재 이유다."""
    print('   ⛔law.go.kr 이 본문 대신 오류쪽을 줬다: "%s"' % reason, flush=True)
    if url:
        print('      부른 곳: %s' % url, flush=True)
    if is_fatal(reason):
        print('      → 재시도로 풀리는 문제가 아니다. ⚠**먼저 인자를 의심할 것** — `lawService`+`eflaw`'
              ' 는 `efYd` 가 없거나 그 MST 의 실제 시행일자가 아니면 이 문구를 준다(권한과 무관).',
              flush=True)


#: 한 실행 안에서 같은 법령ID 를 두 번 묻지 않는다. {(법령ID, MST): 시행일자}
#  ⚠**성공한 답만** 담는다. 실패(None)를 담으면 터널이 한 번 흔들린 것이 그 실행 내내 굳는다.
_EFYD_CACHE = {}


def current_efyd(api, oc, lid, mst=None):
    """그 **법령ID** 의 현행 시행일자(YYYYMMDD 문자열). 못 찾으면 None.

    예: current_efyd(api, 'hyoo1431', '003205') → '20260825'
        (같은 법령ID 에 20270101 시행예정 판이 같이 있어도 현행만 고른다)

    @param api  도구마다 다른 재시도 정책을 그대로 쓰기 위해 함수로 받는다
    @param lid  법령ID — `_meta.json` families 또는 `기본정보.법령ID`
    @param mst  주면 그 일련번호 행을 우선한다(같은 법에 다른 MST 가 섞일 때)
    """
    if not lid:
        return None
    key = (str(lid), str(mst or ''))
    if key in _EFYD_CACHE:
        return _EFYD_CACHE[key]
    d = api('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&target=eflaw&type=JSON'
            '&LID=%s&display=100' % (oc, lid))
    rows = ((d or {}).get('LawSearch') or {}).get('law') or []
    if isinstance(rows, dict):
        rows = [rows]
    cur = [r for r in rows if r.get('현행연혁코드') == '현행']
    if mst:
        same = [r for r in cur if str(r.get('법령일련번호')) == str(mst)]
        if same:
            cur = same
    if not cur:
        return None
    # 현행이 여럿일 리는 없지만, 있으면 가장 늦게 시행된 것을 고른다.
    ans = max(str(r.get('시행일자') or '') for r in cur) or None
    if ans:
        _EFYD_CACHE[key] = ans
    return ans


def fetch_law_body(api, oc, mst, lid=None, warn=True):
    """MST 의 **현행 시행일 판** 본문 JSON. 못 받으면 None.

    왜 이렇게 도나 — 위 머리말 [★`target=law` 는 안전한 대체가 아니다] 참조.
      ① `target=law&MST=` 로 한 번 받는다. 여기서 `법령ID` 와 그 응답의 `시행일자` 를 얻는다.
      ② `법령ID` 로 **현행 시행일자**를 조회한다(최대 2번 — 터널이 끊기는 일이 잦다).
         못 정하면 **None 을 준다.** 틀릴 수 있는 판을 주느니 안 주는 쪽이다.
      ③ ①의 시행일자가 그것과 **같으면 ①을 그대로 쓴다**(호출 2번으로 끝).
         **다르면** `target=eflaw&MST=&efYd=<현행>` 으로 다시 받는다(호출 3번).
    ③의 '다르면' 이 바로 종전에 **조용히 틀린 판을 저장하던** 자리다.
    """
    body = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=law&type=JSON&MST=%s'
               % (oc, mst))
    if not body:
        # ⚠여기도 한마디 한다. 조용한 실패 경로를 하나라도 남기면 그게 다음 오진의 씨앗이다
        #   (L-294 가 정확히 그렇게 났다). 실측: 항만법 283707 이 이 경로로 말없이 None 이 됐다.
        if warn:
            print('   ✗MST %s: 본문을 못 받았다(첫 조회). 못 받은 것으로 둔다.' % mst, flush=True)
        return None
    info = (body.get('법령') or {}).get('기본정보') or {}
    got = str(info.get('시행일자') or '')
    # ⚠조회가 한 번 실패했다고 **틀릴 수 있는 판으로 물러서지 않는다.** 처음엔 그렇게 짰다가
    #   287955 가 터널 한 번 끊긴 것만으로 20260701(옛 판)을 받아들이는 것을 실측으로 봤다.
    #   목록에는 `MST=287955 시행일=20260828 연혁=현행` 이 멀쩡히 있었다. 조용히 옛 판을 주느니
    #   **아무것도 안 주는 쪽**이 옳다 — 호출한 도구는 이미 "못 받음"을 다룰 줄 안다(환각 0).
    want = None
    for _ in range(2):            # api() 가 안에서 이미 3~4번 두드린다 — 바깥은 2번이면 족하다
        want = current_efyd(api, oc, lid or info.get('법령ID'), mst)
        if want:
            break
    if not want:
        if warn:
            print('   ✗MST %s: 현행 시행일자를 못 정했다 — target=law 가 준 %s 판이 현행인지 **모른다.**'
                  % (mst, got or '?'), flush=True)
            print('      틀린 판을 저장하지 않도록 이 건은 받지 않은 것으로 둔다.', flush=True)
        return None
    if got == want:
        return body
    if warn:
        print('   ↻MST %s: target=law 는 %s 판을 줬는데 현행은 %s 다 — efYd 로 다시 받는다.'
              % (mst, got or '?', want), flush=True)
    # ⚠`fixed or body` 라고 쓰면 안 된다. 재조회가 한 번 실패한 것만으로 **방금 틀렸다고 판정한
    #   그 판**을 도로 내주게 된다. 실제로 288973 이 그렇게 20270101(시행예정)을 통과했다.
    #   물러설 곳을 두지 않는다 — 못 받으면 못 받은 것이다.
    for _ in range(2):
        fixed = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=eflaw&type=JSON'
                    '&MST=%s&efYd=%s' % (oc, mst, want))
        if fixed:
            done = str(((fixed.get('법령') or {}).get('기본정보') or {}).get('시행일자') or '')
            if done == want:
                return fixed
            if warn:
                print('   ✗MST %s: efYd=%s 로 불렀는데 %s 판이 왔다 — 받지 않는다.'
                      % (mst, want, done or '?'), flush=True)
            return None
    if warn:
        print('   ✗MST %s: 현행은 %s 인데 그 판을 못 받았다 — 틀린 판(%s)을 주지 않고 비운다.'
              % (mst, want, got or '?'), flush=True)
    return None
