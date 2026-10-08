#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""법령·위임고시 변동감지(H-29 1~4·8~12항) — 소관부처 단위 "광역질의" 몇 번으로 최근 변동을
   훑고, baseline(우리 raw가 아는 법령ID·고시제목)과 매치되는 것만 깊이 파고들어 변경조문까지
   뽑아 큐에 쌓는다. 판정은 100% 로직이며 raw·위키를 절대 고치지 않는다(AI 트리아지·사람 승인은 후속).
[연계] 입력: _dashboard/law_change_baseline.json(build_change_baseline.py 산출)
             _dashboard/law_aliases.json(공식 약칭 — 신규 고시의 관련법 판정에 보조 사용)
       API : lawSearch.do?target=eflaw(법령 광역질의) · target=admrul(행정규칙 광역질의)
             lawService.do?target=eflaw&MST=…&efYd=…(매치건만 조문단위 딥다이브)
             lawService.do?target=admrul&ID=…(발령일자 직접비교용, 후보건만 · 신규 고시는 본문까지 읽어 관련법 판정)
       출력: _dashboard/law_change_queue.json (status:pending 누적 — H-29 5~7항 승인방이 소비할 스키마)
             ★서버(services/legal_amendment_scanner.js)는 `--out local_server/data/law_change_queue.json`
               으로 Fly 볼륨에 쓰게 한다 — 이미지 안 경로에 쓰면 배포마다 초기화된다(2026-09-10).
[로드 순서] backfill_lawid.py → build_change_baseline.py → 이 스크립트(주기 실행, 기본 최근 7일).
            사용법: python3 detect_law_changes.py [--days 7] [--out <law_change_queue.json 경로>]
            실측 API 스펙·설계 근거는 _dashboard/H29_design.md §4·§6·§7.
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))   # 컨테이너는 UTC로 도니 KST는 명시 변환(CLAUDE.md 시간 표기 규칙)
OC = "hyoo1431"
# 이 파일 기준 상대경로(…/_dashboard/loop → legal). 서비스 컨테이너는 /app 에 있으므로
# /home/user/SEAGNAL 절대경로를 박으면 baseline 을 못 열어 종료코드 1 로 죽는다(2026-09-10 실측 정정).
LEGAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BASELINE = f"{LEGAL}/_dashboard/law_change_baseline.json"
ALIASES = f"{LEGAL}/_dashboard/law_aliases.json"
QUEUE = f"{LEGAL}/_dashboard/law_change_queue.json"   # 기본값. 서버는 --out 으로 볼륨 경로를 준다
SLEEP = 0.25
# 진행률 보고 — 관리자 화면 「지금 스캔」의 게이지 바가 이 줄을 읽는다(사람이 읽는 print 와 섞여도
# 되도록 `@@PROG ` 접두어를 붙인 한 줄 JSON 이다). 서비스 쪽(legal_amendment_scanner.js)이
# stdout 을 줄 단위로 훑어 이 줄만 골라 쓴다. 이 줄이 없어도 스캔 자체는 그대로 돈다.
def prog(**kw):
    """진행률 한 줄을 stdout 에 찍는다. 예: prog(phase='행정규칙', done=3, total=8, label='해양수산부')"""
    try:
        print("@@PROG " + json.dumps(kw, ensure_ascii=False), flush=True)
    except Exception:
        pass   # 진행률 때문에 스캔이 죽으면 안 된다

MAX_PAGES = 10          # 광역질의 페이징 안전상한(1페이지 100건)
PENDING_YEARS = 5       # 시행예정 전수질의(W3)가 훑을 미래 범위

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_change_baseline import norm_title  # noqa: E402  (baseline과 같은 정규화 규칙을 공유)
from recollect_jomun import article_lines     # noqa: E402  (raw 파일과 같은 꼴로 조문 본문을 만든다)
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

# 층 이름 → raw 폴더 안 파일 이름. 옛 조문 본문을 우리 원문에서 찾을 때 쓴다.
LAYER_FILE = {"법률": "법률.txt", "시행령": "시행령.txt", "시행규칙": "시행규칙.txt"}


# ★몇 번 묻고 몇 번 답을 받았나(3-80). 광역질의가 실패하면 `search_rows` 가 빈 목록을 돌려주는데,
#   그것은 「최근 바뀐 것이 없다」와 **구별되지 않는다** — 망이 막힌 날에도 「개정 없음」으로 끝났다.
#   하나도 답을 못 받았으면 끝에서 실패로 죽어, 서버(legal_amendment_scanner)가 「스캔 실패」로 적게 한다.
API_STAT = {'ok': 0, 'fail': 0, 'why': {}}


def _api_fail(why):
    API_STAT['fail'] += 1
    k = re.sub(r'OC=[^&\s]+', 'OC=…', str(why))[:160]
    API_STAT['why'][k] = API_STAT['why'].get(k, 0) + 1


def api(url):
    """DRF API 1회 호출(JSON). 3회까지 재시도하고 그래도 안 되면 None.
    예: api('https://www.law.go.kr/DRF/lawSearch.do?…') → {'LawSearch': {...}}
    @param {str} url 완성된 요청 URL
    @returns {dict|None}
    [연계] collect_contacts.py·recollect_jomun.py와 같은 호출 관례(OC=hyoo1431, User-Agent 지정).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.lstrip()[:1] in '{[':
                API_STAT['ok'] += 1
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            _api_fail('JSON 이 아닌 응답: ' + (reason or re.sub(r'<[^>]+>', ' ', body).strip()[:120] or '(빈 응답)'))
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None          # 재시도로 안 풀린다
        except Exception as e:
            _api_fail('%s: %s' % (type(e).__name__, e))
        time.sleep(1.5)
    return None


def search_rows(target, key, extra):
    """lawSearch 광역질의를 페이징하며 행 목록을 모은다.
    예: search_rows('eflaw','law','&org=1192000&ancYd=20260803~20260810') → [{법령ID:…}, …]
    @param {str} target eflaw(법령) 또는 admrul(행정규칙)
    @param {str} key 응답 안의 행 배열 키('law' 또는 'admrul')
    @param {str} extra 추가 쿼리스트링(앞에 & 포함)
    @returns {list[dict]} 실패 시 빈 리스트
    [연계] target=law가 아니라 eflaw를 쓰는 이유는 H29_design.md §4 — law는 현행본만 색인해
           시행예정(예고)본을 통째로 놓친다(수산업법 285535 실측).
    """
    rows, page = [], 1
    while page <= MAX_PAGES:
        d = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target={target}"
                f"&display=100&page={page}{extra}")
        if not d:
            break
        box = d.get("LawSearch") or d.get("AdmRulSearch") or {}
        got = box.get(key) or []
        if isinstance(got, dict):
            got = [got]
        rows.extend(got)
        total = int(box.get("totalCnt") or 0)
        if len(rows) >= total or not got:
            break
        page += 1
        time.sleep(SLEEP)
    return rows


def index_baseline(base):
    """baseline을 조회용 인덱스 2개로 편다 — 법령ID→(법,층) / 정규화고시제목→(법,고시).
    예: by_lawid['001486'] → (수산업법 dict, '법률', {MST:'270747',…})
    @param {dict} base law_change_baseline.json 내용
    @returns {tuple[dict, dict]}
    [연계] 광역질의 결과와의 대조는 전부 이 인덱스로만 한다(법령명 문자열 대조 금지 — H-29 11항).
    """
    by_lawid, by_admrul = {}, {}
    for law in base["laws"]:
        for layer, fam in law["families"].items():
            by_lawid[fam["법령ID"]] = (law, layer, fam)
        for a in law["admruls"]:
            by_admrul.setdefault(a["제목정규화"], []).append((law, a))
    return by_lawid, by_admrul


def changed_articles(mst, efyd):
    """개정본 조문 배열에서 "이번에 바뀐 조문"만 뽑는다(조문변경여부=Y).
    예: changed_articles('285535','20261022') → [{'조문번호':'8','조문제목':'마을어업 등의 면허',…}, …]
    @param {str} mst 법령일련번호  @param {str} efyd 그 버전의 시행일자(YYYYMMDD)
    @returns {tuple[list, dict]} (변경조문 목록, 기본정보) — 조회 실패 시 ([], {})
    [연계] recollect_jomun.py가 이미 쓰는 필드(조문번호/조문제목/조문시행일자/조문제개정유형)를
           그대로 읽는다. ★시행예정본은 efYd를 함께 줘야 응답이 온다(안 주면 {} — 2026-08-10 실측).
    """
    # ★`efYd` 는 **선택이 아니라 필수**다 (2026-09-21 실측으로 확정).
    #   `lawService.do?target=eflaw` 는 efYd 가 **없거나 그 MST 의 실제 시행일자가 아니면**
    #   HTTP **200** 과 함께 *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다.
    #   ⚠**이 문구를 권한 문제로 읽으면 안 된다.** 같은 MST 에 맞는 efYd 를 주면 그 자리에서
    #     JSON 이 온다 — 선박안전법 246611+20230628 → 177,917 B, 항만법 283707+20260227 → 198,849 B.
    #     즉 **신청은 돼 있다.** law.go.kr 이 "인자가 틀렸다"를 "미신청"이라고 말할 뿐이다.
    #   (내가 이 문구를 두 번 오진했다 — 처음엔 "호스트 불통", 다음엔 "eflaw 미신청". L-294·L-295)
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON"
            f"&MST={mst}&efYd={efyd}")
    body = (d or {}).get("법령") or {}
    jos = ((body.get("조문") or {}).get("조문단위")) or []
    if isinstance(jos, dict):
        jos = [jos]
    out = []
    for j in jos:
        if j.get("조문변경여부") != "Y":
            continue
        # ★새 조문 **본문**도 싣는다(2026-09-10 사용자 지시 "변경 전, 후"). 종전에는 번호·제목만 남기고
        #   본문을 버려서, 관리자 카드가 "무엇이 어떻게 바뀌는지"를 못 보여 줬다. 응답에 이미 들어 있다.
        out.append({"조문번호": str(j.get("조문번호", "")), "조문가지번호": str(j.get("조문가지번호", "") or ""),
                    "조문제목": j.get("조문제목", ""), "조문제개정유형": j.get("조문제개정유형", ""),
                    "조문시행일자": str(j.get("조문시행일자", "")),
                    "새본문": "\n".join(article_lines(j, with_head=False)).strip()})
    return out, body.get("기본정보") or {}


def article_label(no, ga):
    """조문 번호를 사람이 읽는 이름으로. 예: article_label('54','2') → '제54조의2'"""
    lab = "제%s조" % str(no)
    if ga and str(ga).strip("0"):
        lab += "의%s" % str(int(ga))
    return lab


def old_article_text(raw_rel, layer, no, ga):
    """우리 raw 원문에서 **지금 쓰고 있는 그 조의 본문**을 꺼낸다(= 개정 전 문장).
    예: old_article_text('raw/07_해양환경생태/공유수면관리및매립에관한법률', '법률', '21', '')
        → '① 공유수면관리청은 …'
    @param {str} raw_rel  큐 항목 law.raw (legal 기준 상대경로. 옛 항목은 절대경로일 수 있다)
    @param {str} layer    '법률'·'시행령'·'시행규칙'
    @param {str} no, ga   조문번호·조문가지번호
    @returns {str|None}  못 찾으면 None — **"없다"와 "안 찾아봤다"를 구분해야 하므로** 빈 문자열을 쓰지 않는다.
    [연계] → 카드의 '개정 전' 칸. 여기서 None 이면 그 조가 지금 원문에 없다는 뜻이라 **신설**로 본다.
    """
    fn = LAYER_FILE.get(layer or "")
    if not fn or not raw_rel:
        return None
    i = str(raw_rel).find("raw/")
    path = os.path.join(LEGAL, str(raw_rel)[i:]) if i >= 0 else os.path.join(LEGAL, str(raw_rel))
    path = os.path.join(path, fn)
    try:
        src = open(path, encoding="utf-8").read()
    except Exception:
        return None
    lab = re.escape(article_label(no, ga))
    m = re.search(r"^\[" + lab + r"\][^\n]*\n([\s\S]*?)(?=\n\[제\d|\n부칙|\Z)", src, re.M)
    return m.group(1).strip() if m else None


def admrul_detail(admrul_id):
    """행정규칙 1건의 발령일자·시행일자·안정ID를 조회한다(ID 크기 비교 금지, 날짜로 판단).
    예: admrul_detail('2100000282754') → {'발령일자':'20260720','시행일자':'20261021','행정규칙ID':'61410',…}
    @param {str} admrul_id 행정규칙일련번호
    @returns {dict|None}
    [연계] L-59 — lsDelegated/검색이 주는 ID는 최신본을 보장하지 않는다. 그래서 "ID가 다르다"는
           신호가 나오면 반드시 양쪽 발령일자를 실제로 받아 비교한다.
    """
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={admrul_id}")
    info = ((d or {}).get("AdmRulService") or {}).get("행정규칙기본정보")
    return info or None


def rel_raw(p):
    """baseline 의 raw 경로(세션 절대경로가 박혀 있음)를 legal 기준 상대경로로 바꾼다.
    예: rel_raw('<저장소뿌리>/local_server/knowledge/legal/raw/10_항만물류/항만법') → 'raw/10_항만물류/항만법'
    @param {str} p 절대 또는 상대 경로
    @returns {str} 'raw/…' 꼴(못 찾으면 원문 그대로)
    [연계] 큐 항목 law.raw 에만 쓴다 — baseline 파일 자체는 고치지 않는다(트랙 D 소유).
    """
    i = (p or "").find("/raw/")
    return p[i + 1:] if i >= 0 else (p or "")


def norm_law_text(s):
    """법령명 대조용 정규화 — 공백·가운뎃점·마침표를 지운다(제목 정규화 norm_title 과 별개: 괄호는 남긴다).
    예: norm_law_text('「선박의 입항 및 출항 등에 관한 법률」 제5조') → '「선박의입항및출항등에관한법률」제5조'
    """
    return re.sub(r"[\s·ㆍ‧・.]", "", s or "")


def build_law_name_index(base):
    """관련법 판정용 이름표. 정식명(공백 제거 = slug 와 같음)은 본문 어디에 있어도 매치,
    공식 약칭은 「」 안에 있을 때만 매치(짧아서 오탐 위험 — '영해법'·'갯벌법' 등).
    예: build_law_name_index(base) → [('선박의입항및출항등에관한법률', False, {...}), ('「선박입출항법」', True, {...}), …]
    @returns {list[tuple[str, bool, dict]]} (정규화 패턴, 약칭여부, {slug,name})
    [연계] 약칭 출처는 collect_law_aliases.py 가 만든 law_aliases.json(법령ID 로 대조 — 이름 대조 금지, H-29 11항).
    """
    try:
        rows = json.load(open(ALIASES, encoding="utf-8")).get("항목") or []
    except Exception:
        rows = []
    alias_by_id = {r["법령ID"]: r.get("약칭", "") for r in rows if not r.get("derived") and r.get("약칭")}
    idx = []
    for law in base["laws"]:
        ref = {"slug": law["slug"], "name": law["name"]}
        idx.append((norm_law_text(law["name"]), False, ref))
        lid = (law["families"].get("법률") or {}).get("법령ID", "")
        if alias_by_id.get(lid):
            idx.append(("「" + norm_law_text(alias_by_id[lid]) + "」", True, ref))
    return idx


def admrul_fulltext(admrul_id):
    """행정규칙 상세 응답에서 사람이 읽는 글(조문내용·제개정이유·개정문·별표 제목)을 한 문자열로 모은다.
    예: admrul_fulltext('2100000283804') → '「국가유산수리 등에 관한 법률」 제14조의2 및 …'
    @returns {str|None} 조회 실패(3회 재시도 후에도 응답 없음) 시 None — 빈 문자열과 구분해야 "무관"으로 오판하지 않는다
    [연계] ★실측(2026-09-10, ID 2100000283804·2100000283648·2100000283594): 상세 응답 키는
           행정규칙기본정보·조문내용·첨부파일·부칙·제개정이유(·개정문·별표)뿐이고 "관련법령"·"위임근거" 같은
           구조화 필드는 없다. 그래서 관련법은 본문 텍스트에서 우리 법 이름 인용을 찾는 방식으로만 판정한다.
    """
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={admrul_id}")
    if not d:
        return None
    svc = d.get("AdmRulService") or {}
    parts = []

    def walk(v):
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
    for key in ("조문내용", "제개정이유", "개정문", "별표"):
        walk(svc.get(key))
    return "\n".join(parts)


def related_laws_in(text, name_index):
    """본문에 인용된 우리 법을 찾는다(정식명은 어디서나, 약칭은 「」 안에서만).
    예: related_laws_in('「해운법」 제3조…', idx) → [{'slug':'해운법','name':'해운법'}]
    @returns {list[dict]} slug 순, 중복 없음
    """
    t = norm_law_text(text)
    found = {}
    for pat, _is_alias, ref in name_index:
        if pat and pat in t:
            found[ref["slug"]] = ref
    return [found[k] for k in sorted(found)]


def _dept_set(s):
    """「농림축산식품부,식품의약품안전처,해양수산부」 → {세 부처}. 빈 값이면 빈 집합.
    예: _dept_set('농림축산식품부') <= _dept_set('농림축산식품부,해양수산부') → True (이관 아님)"""
    return {p.strip() for p in str(s or '').split(',') if p.strip()}


def make_item(kind, law, layer, ident, before, after, arts, evidence, related=None):
    """큐 항목 1건을 H-29 5~7항(승인방)이 그대로 소비할 스키마로 만든다.
    예: make_item('law_pending', 수산업법, '법률', {'법령ID':'001486'}, before, after, arts, {'query':'W3'})
    @param {list|None} related 관련법 [{slug,name}] — 없으면 law 자신(slug 있을 때) 또는 [] (신규 고시는 호출측이 본문 판정 결과를 준다)
    @returns {dict} status/scheduled_for/ai_recommendation은 후속 단계가 채울 자리(지금은 pending/null)
    [연계] 스키마 정의는 H29_design.md §7. dedupe_key로 재실행 시 중복 적재를 막는다.
           related_laws 가 빈 항목은 services/legal_amendment_scanner.js 가 관리자 큐에 올리지 않는다(무관 고시 차단).
    """
    key_id = ident.get("법령ID") or ident.get("행정규칙ID") or ident.get("ID", "")
    ver = (after or {}).get("MST") or (after or {}).get("ID", "")
    when = (after or {}).get("시행일자") or (after or {}).get("발령일자", "")
    return {
        "id": f"chg_{datetime.now(KST).strftime('%Y%m%d')}_{abs(hash((kind, key_id, ver, when))) % 0xFFFFFF:06x}",
        "dedupe_key": f"{kind}|{key_id}|{ver}|{when}",
        "detected_at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "kind": kind,
        "law": {"slug": law["slug"], "name": law["name"], "raw": rel_raw(law["raw"])},
        "related_laws": related if related is not None else ([{"slug": law["slug"], "name": law["name"]}] if law["slug"] else []),
        "layer": layer,
        "식별자": ident,
        "before": before,
        "after": after,
        "공포일자": (after or {}).get("공포일자") or (after or {}).get("발령일자", ""),
        "시행일자": (after or {}).get("시행일자", ""),
        "changed_articles": arts,
        "ai_recommendation": None,
        "status": "pending",
        "scheduled_for": None,
        "evidence": evidence,
    }


def scan_laws(base, by_lawid, days):
    """법령 광역질의 3종(W1 공포범위·W2 시행범위·W3 시행예정전수)을 돌리고, 법령ID가 baseline에
    있는 행만 골라 MST/법령명/소관부처명 차이를 항목으로 만든다.
    @param {dict} base baseline  @param {dict} by_lawid 법령ID 인덱스  @param {int} days 최근 N일
    @returns {tuple[list, int]} (큐 항목들, 실행한 질의 수)
    [연계] W1만으로는 오래전 공포·이제 시행되는 법(W2)과 공포일이 창 밖인 예고본(W3)을 놓친다
           — 셋 다 두는 근거는 H29_design.md §6. W1·W2는 부처 필터 없이 전부처를 훑는다
           (최근 7일 실측 61·36건으로 작고, org로 좁히면 법이 다른 부처로 이관됐을 때 그 법이
           질의 결과에서 통째로 사라져 H-29 9항 부처변경을 영영 못 잡는다). W3만 부처별.
    """
    today = datetime.now(KST).date()
    frm = (today - timedelta(days=days)).strftime("%Y%m%d")
    to = today.strftime("%Y%m%d")
    tomorrow = (today + timedelta(days=1)).strftime("%Y%m%d")
    far = (today + timedelta(days=365 * PENDING_YEARS)).strftime("%Y%m%d")
    queries = 0
    seen, items = set(), []
    plans = [("W1", "", f"&ancYd={frm}~{to}"), ("W2", "", f"&efYd={frm}~{to}")]
    plans += [("W3", org, f"&org={org}&efYd={tomorrow}~{far}") for org in base["ministries"]]
    prog(phase='법령', done=0, total=len(plans), label='시작')
    for tag, org, extra in plans:
        queries += 1
        prog(phase='법령', done=queries, total=len(plans), label=f"{tag} {org or '전부처'}")
        for row in search_rows("eflaw", "law", extra):
            lid = str(row.get("법령ID", ""))
            hit = by_lawid.get(lid)
            if not hit:
                continue
            law, layer, fam = hit
            mst, efyd = str(row.get("법령일련번호", "")), str(row.get("시행일자", ""))
            if (lid, mst, efyd) in seen:
                continue
            seen.add((lid, mst, efyd))
            status = row.get("현행연혁코드", "")
            after = {"MST": mst, "법령명": row.get("법령명한글", ""),
                     "공포번호": str(row.get("공포번호", "")), "공포일자": str(row.get("공포일자", "")),
                     "시행일자": efyd, "소관부처명": row.get("소관부처명", ""),
                     "현행연혁코드": status}
            ev = {"query": tag, "org": org}
            # 소관부처 이관(H-29 9항) — MST가 그대로여도 부처명만 바뀔 수 있어 따로 본다
            # ★문자열이 아니라 **부처 집합**으로 견준다(3-89, 2026-10-08 — 오탐 4건).
            #   검색 목록(lawSearch)은 공동소관을 「농림축산식품부,식품의약품안전처,해양수산부」처럼 쉼표로 다 주는데,
            #   기준선(build_change_baseline — 상세 lawService)은 첫 부처 하나만 적는다. 그래서 농수산물 품질관리법은
            #   1999년 판부터 한 번도 안 바뀐 소관이 스캔마다 「소관부처 변경」 카드로 올라왔다(원산지표시법도 같다).
            #   기준선 부처가 지금 목록에 다 들어 있으면 이관이 아니다. 빠진 부처가 있을 때만 카드를 낸다.
            if row.get("소관부처명") and not _dept_set(fam.get("소관부처명")) <= _dept_set(row["소관부처명"]):
                items.append(make_item("law_dept_changed", law, layer, {"법령ID": lid},
                                       {"소관부처명": fam.get("소관부처명", "")},
                                       {"소관부처명": row["소관부처명"], "MST": mst, "시행일자": efyd},
                                       [], ev))
            if mst == fam["MST"]:
                continue    # 우리가 이미 가진 바로 그 버전 — 변동 아님
            # 법령명 변경(H-29 11항) — 법령ID가 같은데 이름이 다르면 개명
            if row.get("법령명한글") and row["법령명한글"] != fam.get("법령명"):
                items.append(make_item("law_renamed", law, layer, {"법령ID": lid},
                                       {"법령명": fam.get("법령명", ""), "MST": fam["MST"]},
                                       after, [], ev))
            if status == "연혁" and str(row.get("공포일자", "")) <= fam.get("공포일자", ""):
                continue    # 우리 것보다 오래된 과거 버전 — 무시
            arts, info = changed_articles(mst, efyd)
            # ★개정 전 본문을 우리 raw 에서 붙이고, 지금 원문에 그 조가 아예 없으면 **신설**로 표시한다
            #   (2026-09-10 사용자 지시). API 의 `조문제개정유형` 은 '일부개정'·'타법개정' 만 오고
            #   신설 여부를 알려 주지 않는다(실측 68건 전부 그 둘) — 그래서 원문 대조로 가른다.
            for _a in arts:
                _old = old_article_text(rel_raw(law["raw"]), layer, _a["조문번호"], _a["조문가지번호"])
                _a["옛본문"] = _old if _old is not None else ""
                _a["신설"] = _old is None
            time.sleep(SLEEP)
            if info.get("소관부처"):
                소관 = info["소관부처"]
                after["소관부처명"] = 소관.get("content", after["소관부처명"]) if isinstance(소관, dict) else after["소관부처명"]
            kind = "law_pending" if status == "시행예정" else "law_amended"
            before = {k: fam.get(k, "") for k in ("MST", "법령명", "공포번호", "공포일자", "시행일자", "소관부처명")}
            items.append(make_item(kind, law, layer, {"법령ID": lid}, before, after, arts, ev))
        time.sleep(SLEEP)
    return items, queries


def scan_admruls(base, by_admrul, days, name_index):
    """행정규칙 광역질의(발령일자 내림차순 페이징)로 최근 N일 발령분을 훑어, 우리가 아는 고시의
    개정본(admrul_amended)과 우리 목록에 없는 신규 발령(admrul_unknown_new)을 가른다.
    @param {list} name_index build_law_name_index() 결과 — 신규 고시 본문에서 우리 법 인용을 찾는 데 쓴다
    @returns {tuple[list, int]} (큐 항목들, 실행한 질의 수)
    [연계] date 파라미터는 범위(~)를 지원하지 않음이 실측 확인돼(H29_design.md §4) sort=ddes로
           페이징하며 컷오프에서 끊는다. 개정 확정은 반드시 양쪽 발령일자 비교(L-59).
           신규 고시(admrul_unknown_new)는 부처 기준으로만 걸려 우리 법과 무관한 것이 대부분이라
           (실측 2026-09-10: 기존 39건 소급 판정), 본문(1회 상세 조회)에서 우리 법 이름이 인용될 때만 related_laws 를 채운다.
    """
    cutoff = (datetime.now(KST).date() - timedelta(days=days)).strftime("%Y%m%d")
    items, queries = [], 0
    orgs = base["ministries"]
    detail_hits = 0        # 고시 본문·상세를 실제로 받아 온 횟수(게이지 옆 살아 있는 숫자)
    prog(phase='행정규칙', done=0, total=len(orgs), label='시작')
    for org in orgs:
        queries += 1
        prog(phase='행정규칙', done=queries, total=len(orgs), label=org, detail=detail_hits)
        rows, page = [], 1
        while page <= MAX_PAGES:
            got = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target=admrul"
                      f"&display=100&page={page}&org={org}&sort=ddes")
            box = (got or {}).get("AdmRulSearch") or {}
            batch = box.get("admrul") or []
            if isinstance(batch, dict):
                batch = [batch]
            if not batch:
                break
            rows.extend([r for r in batch if str(r.get("발령일자", "")) >= cutoff])
            if str(batch[-1].get("발령일자", "")) < cutoff:
                break
            page += 1
            time.sleep(SLEEP)
        for row in rows:
            title = row.get("행정규칙명", "")
            nt = norm_title(title)
            m = re.search(r"ID=(\d+)", row.get("행정규칙상세링크", "") or "")
            new_id = m.group(1) if m else ""
            ev = {"query": "A1", "org": org, "발령일자": str(row.get("발령일자", ""))}
            hits = by_admrul.get(nt)
            if not hits:
                law0 = {"slug": "", "name": "", "raw": ""}
                # 본문을 못 받았으면(API 실패) "무관"으로 단정하지 않는다 — evidence.relevance='unchecked' 로
                # 남기고, 스캐너(JS)는 이런 건은 거르지 않고 관리자에게 그대로 보여 준다(소급 실측 39건 중 1건이 이 경우).
                text = admrul_fulltext(new_id) if new_id else None
                related = related_laws_in(text, name_index) if text is not None else []
                ev["relevance"] = "checked" if text is not None else "unchecked"
                detail_hits += 1
                prog(phase='행정규칙', done=queries, total=len(orgs), label=org, detail=detail_hits)
                time.sleep(SLEEP)
                items.append(make_item("admrul_unknown_new", law0, "행정규칙",
                                       {"행정규칙ID": str(row.get("행정규칙ID", "")), "ID": new_id},
                                       {}, {"제목": title, "ID": new_id,
                                            "발령일자": str(row.get("발령일자", "")),
                                            "시행일자": str(row.get("시행일자", "")),
                                            "소관부처명": row.get("소관부처명", ""),
                                            "제개정구분명": row.get("제개정구분명", "")}, [], ev, related))
                continue
            for law, a in hits:
                if not new_id or new_id == a["ID"]:
                    continue
                cur, old = admrul_detail(new_id), admrul_detail(a["ID"])
                detail_hits += 2
                prog(phase='행정규칙', done=queries, total=len(orgs), label=org, detail=detail_hits)
                time.sleep(SLEEP)
                if not cur or not old:
                    continue
                if str(cur.get("행정규칙ID", "")) != str(old.get("행정규칙ID", "")):
                    continue    # 제목이 비슷해도 다른 문서 — 행정규칙ID(개정돼도 불변)가 다르면 개정본이 아니다
                if str(cur.get("발령일자", "")) <= str(old.get("발령일자", "")):
                    continue    # L-59: ID가 달라도 실제로는 더 오래된 판 — 오탐이므로 버린다
                items.append(make_item("admrul_amended", law, "행정규칙",
                                       {"행정규칙ID": str(cur.get("행정규칙ID", "")), "ID": new_id},
                                       {"제목": a["제목"], "ID": a["ID"], "행정규칙ID": str(old.get("행정규칙ID", "")),
                                        "발령일자": str(old.get("발령일자", "")),
                                        "시행일자": str(old.get("시행일자", ""))},
                                       {"제목": title, "ID": new_id, "발령일자": str(cur.get("발령일자", "")),
                                        "시행일자": str(cur.get("시행일자", "")),
                                        "소관부처명": cur.get("소관부처명", ""),
                                        "제개정구분명": cur.get("제개정구분명", "")}, [], ev))
        time.sleep(SLEEP)
    return items, queries


def run(days, out=QUEUE):
    base = json.load(open(BASELINE, encoding="utf-8"))
    by_lawid, by_admrul = index_baseline(base)
    name_index = build_law_name_index(base)
    print(f"baseline {base['law_count']}법 · 법령ID {len(by_lawid)} · 고시 {len(by_admrul)} · "
          f"부처 {len(base['ministries'])}곳 — 최근 {days}일 스캔 시작", flush=True)
    law_items, q1 = scan_laws(base, by_lawid, days)
    print(f"법령 광역질의 {q1}회 → 후보 {len(law_items)}건", flush=True)
    adm_items, q2 = scan_admruls(base, by_admrul, days, name_index)
    if API_STAT['ok'] == 0:
        # ★하나도 답을 못 받았다 — 「개정 없음」이 아니라 「확인 못 함」이다. 큐를 건드리지 않고 실패로 끝낸다.
        why = ' / '.join('%s ×%d' % kv for kv in sorted(API_STAT['why'].items(), key=lambda kv: -kv[1])[:3])
        print('❌ law.go.kr 이 한 번도 답하지 않았다(실패 %d회) — 개정 여부를 확인하지 못했다. 까닭: %s'
              % (API_STAT['fail'], why or '기록 없음'), file=sys.stderr, flush=True)
        sys.exit(2)
    unrelated = sum(1 for i in adm_items if i["kind"] == "admrul_unknown_new" and not i["related_laws"]
                    and i["evidence"].get("relevance") == "checked")
    print(f"행정규칙 광역질의 {q2}회 → 후보 {len(adm_items)}건 (신규 고시 중 우리 법과 무관 {unrelated}건 — "
          f"큐에는 related_laws:[] 로 남기고 관리자 큐에는 안 올림)", flush=True)

    try:
        queue = json.load(open(out, encoding="utf-8"))
    except Exception:
        queue = {"updated_at": "", "scans": [], "items": []}
    known = {i["dedupe_key"] for i in queue["items"]}
    fresh = []
    for i in law_items + adm_items:      # 이번 실행 안에서 생긴 중복(같은 고시가 두 법에 위임 등)도 함께 제거
        if i["dedupe_key"] in known:
            continue
        known.add(i["dedupe_key"])
        fresh.append(i)
    queue["items"].extend(fresh)
    queue["updated_at"] = datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S+09:00")
    queue["scans"].append({"ran_at": queue["updated_at"], "days": days,
                           "queries": q1 + q2, "candidates": len(law_items) + len(adm_items),
                           "new_items": len(fresh)})
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(queue, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    by_kind = {}
    for i in fresh:
        by_kind[i["kind"]] = by_kind.get(i["kind"], 0) + 1
    print(f"\n=== 신규 {len(fresh)}건 적재(누적 {len(queue['items'])}건) → {out}\n    유형별: {by_kind} ===",
          flush=True)


if __name__ == "__main__":
    n, out = 7, QUEUE
    if "--days" in sys.argv:
        n = int(sys.argv[sys.argv.index("--days") + 1])
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    run(n, out)
