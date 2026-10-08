#!/usr/bin/env python3
"""고시(행정규칙) raw 에 빠져 있는 **별표·별지서식**을 API 에서 받아 채운다.

왜 (L-219 의 두 번째 축, 2026-08-31):
  고시 수집기가 부칙을 한 번도 저장하지 않았던 것과 같은 구조로 **별표도 빠져 있다.**
  `admrul_annex_survey.py` 로 전량 대조한 결과 — 아예 없는 것 139건, 수가 모자란 것 42건.
  예: 「동해지역 항만출입절차 및 보안업무 운영세칙」은 API 에 별표가 22건인데 raw 에는 0건이고,
  정작 본문이 그 별표를 여섯 번 가리킨다.

★어디에 쓰나 — 이걸 틀리면 받아 놓고도 챗봇이 못 읽는다 (2026-08-31 실측으로 확인)
  `article_text.js` 는 고시 별표를 **`raw/<도메인>/<법>/별표/` 폴더**에서 찾는다
  (`ctx.base + '/별표'`). 파일명은 `<고시명>_별표N.txt`, 첫 줄에 `[<고시명>] 별표N — 제목`
  꼴로 **고시 이름과 번호**가 있어야 임자와 번호를 읽는다(머리말 4줄로 임자를 확인한다).
  ⚠`행정규칙/<고시명>_별표/` 같은 하위폴더에 넣으면 **어느 코드도 읽지 않는다** —
  오늘 오전에 내가 그렇게 넣었다가 이 사실을 뒤늦게 확인하고 옮겼다.

무엇을 하나
  survey 결과(_dashboard/admrul_annex_survey.json)의 '빠짐'·'수가모자람' 목록을 돌며
  API 의 별표단위를 위 규칙대로 `<법>/별표/` 에 파일로 쓴다.
  **이미 있는 파일은 절대 덮어쓰지 않는다** — 사람이 전사한 것(이미지 판독·HWP 전사)을 날리지 않기 위해서다.

[연계]
  - 읽음: _dashboard/admrul_annex_survey.json · raw/*/*/행정규칙/*.txt (머리글 ID)
  - 호출: https://www.law.go.kr/DRF/lawService.do (OC=hyoo1431, target=admrul)
  - 씀:   raw/<도메인>/<법>/별표/<고시명>_별표N.txt (새 파일만) ·
          _dashboard/admrul_annex/report_<시각>.json · _dashboard/touched/…
사용법: python3 admrul_fill_annex.py [--dry] [--limit N] [--skip <경로조각>] [--relink]
  --relink : 이미 쓴 파일이 **제목·출처뿐**이면 빠진 `별표서식파일링크:` 한 줄만 덧붙인다(지우지 않는다).
  --refix  : 이미 쓴 파일이 **글자 하나씩 쪼개진 꼴**이면 본문만 다시 쓴다(우리 API 수집본만 · 사람 전사본은 안 건드린다).
  --refresh <고시파일…> : 새 판으로 갈아끼운 고시의 별표 파일을 그 판에 맞춘다(API 수집본만 · 3-89 · refresh_annex()).
"""
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _admrul_id import find_id   # ★판번호를 찾는 단 한 곳(P-19b)
import glob, json, os, re, sys, time, urllib.request
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OC = 'hyoo1431'
SURVEY = os.path.join(LEGAL, '_dashboard', 'admrul_annex_survey.json')
REPORT_DIR = os.path.join(LEGAL, '_dashboard', 'admrul_annex')


def api(url, tries=4):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            last = str(e)
            time.sleep(1.5 * (i + 1))
    return {'_err': last}


def id_of(path):
    """머리글 8줄에서 `ID:`, 없으면 옆 `_admrul.json` 의 행정규칙일련번호."""
    # ★판번호를 찾는 법은 `_admrul_id.find_id()` 한 곳에 있다(P-19b · L-386, 2026-09-25).
    #   이 자도 `^ID:` 와 `_admrul.json` 을 **제 손으로** 다시 구현하고 있었다. 한 곳으로 모으면
    #   라벨이 `행정규칙일련번호:`·`MST` 인 것과 곁 파일에 되찾아 둔 것까지 함께 읽는다.
    rid, _w = find_id(path)
    if rid:
        return rid
    text = open(path, encoding='utf-8').read()
    m = re.search(r'^ID:(\d+)', '\n'.join(text.split('\n')[:8]), re.M)
    if m:
        return m.group(1)
    mp = os.path.join(os.path.dirname(path), '_admrul.json')
    if not os.path.exists(mp):
        return None
    try:
        d = json.load(open(mp, encoding='utf-8'))
    except Exception:
        return None
    base = os.path.basename(path)
    for k, v in (d.items() if isinstance(d, dict) else []):
        if isinstance(v, dict) and (v.get('파일') == base or k + '.txt' == base):
            n = str(v.get('행정규칙일련번호') or '').strip()
            if n.isdigit():
                return n
    return None


def title_of(path):
    """고시 이름 — 머리글 `[고시/행정규칙] 이름` 또는 `행정규칙명: 이름`, 없으면 파일명."""
    head = open(path, encoding='utf-8').read().split('\n')[:8]
    for l in head:
        m = re.match(r'^\[[^\]]*\]\s*(.+)$', l.strip())
        if m:
            return m.group(1).strip()
        m = re.match(r'^행정규칙명\s*:\s*(.+)$', l.strip())
        if m:
            return m.group(1).strip()
    return os.path.basename(path)[:-4]


def safe(s):
    return re.sub(r'[\\/:*?"<>|\s]', '', s)


# ★`별표내용` 은 **문자열일 때도 있다** — 그러면 글자 하나하나가 한 줄이 된다 (2026-09-25 실측).
#   [무슨 일이 있었나] 종전 코드는 `for r in (u.get('별표내용') or []): rows0.extend(...)` 였다.
#   값이 리스트인 줄 알았는데 **문자열**인 응답이 있다 — 파이썬에서 문자열을 돌리면 **글자**가 나온다.
#   그래서 「항만시설장비검사기준 별표9」(`별표내용` = `" [별표 9] 삭 제(2021.9.29)"` · 22자)가
#   **18줄, 한 줄에 한 글자**로 저장됐다. 게이트 **V5-20**(표가 열 단위로 펼쳐진 자리)이
#   줄 2201 → 2226 으로 늘어 빨간불을 세웠고, 그 셋이 전부 오늘 새로 받은 파일이었다.
#   ★오늘 쓴 745개 중 **12개**가 이 꼴이었다.
#   [뿌리] L-382 — **값이 어떤 꼴인지 안 보고 이름으로 짐작한다.** 이번에도 「내용이니 리스트겠지」였다.
#   ⚠리스트 안에 리스트가 오는 꼴(행마다 칸 배열)은 그대로 둔다 — 그건 실제 표다.
def body_rows(u):
    c = u.get('별표내용')
    if c is None:
        return []
    if isinstance(c, str):
        return c.split('\n')          # 글자로 쪼개지 않는다
    out = []
    for r in c:
        if isinstance(r, list):
            out.extend(r)
        elif isinstance(r, str):
            out.extend(r.split('\n'))
        else:
            out.append(r)
    return out


TODAY = time.strftime('%Y-%m-%d')

# ★API 의 링크 칸 이름은 `별표서식파일링크` 다 — `PDF` 가 끼지 않는다 (2026-09-25 실측).
#   [무슨 일이 있었나] 이 도구는 `u.get('별표서식PDF파일링크')` 를 봤다. **그런 칸은 없다.**
#   그래서 링크를 한 번도 적지 못했고, 글이 안 오는 별표(서식·도안은 HWP·이미지뿐이다)는
#   제목·출처만 든 **빈 파일**로 남았다 — 게이트 V5-39 가 「까닭도 없이 빈 것 46개」로 잡아냈다.
#   실측(ID=2100000079889): 칸 이름은 `별표제목·별표번호·별표키·별표내용·별표구분·별표서식파일링크·별표가지번호`
#   이고 `별표내용` 은 `""`, `별표서식파일링크` 는 `/LSW/flDownload.do?flSeq=29267130` 이었다.
#   ★P-17 에서 배운 것과 같은 병이다 — **갈래는 값이 아니라 칸 이름에 있다.**
#   옛 이름도 함께 본다(응답이 바뀌어도 안 잃게).
def link_of(u):
    for k in ('별표서식파일링크', '별표서식PDF파일링크'):
        v = (u.get(k) or '').strip()
        if v:
            return v
    return ''


# 이미 쓴 파일이 **글자 하나씩 쪼개진 꼴**인가 — `--refix` 대상을 고르는 자.
#   ⚠사람이 전사한 것을 절대 덮지 않으려고 **두 조건을 함께** 본다:
#     ① 머리의 `출처:` 줄이 **우리 API 수집**이라고 말한다(사람 전사본에는 이 줄이 없다)
#     ② 본문 줄의 **60% 이상이 한 글자**이고 줄이 5개 이상이다
#   이 둘이 다 맞을 때만 다시 쓴다. 실제 표가 열 단위로 펼쳐진 것(P-13·3-25)은 글자가 아니라
#   **낱말·칸**이므로 ②에 안 걸린다 — 그건 원문이 그런 것이라 손대지 않는다.
def is_char_split(path):
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except OSError:
        return False
    if not any(l.startswith('출처:') and 'API' in l for l in lines[:4]):
        return False
    body = [l for l in lines[2:] if l.strip() and not l.startswith(_META_HEAD)]
    if len(body) < 5:
        return False
    one = sum(1 for l in body if len(l.strip()) == 1)
    return one / len(body) > 0.6


# 별표 파일이 **제목·출처뿐인가**(글도 주소도 없다). 읽는 쪽 `article_text.bylBodyKind` 의
# `'none'` 과 같은 것을 보되, 여기서는 `--relink` 대상을 고르는 데만 쓴다.
_META_HEAD = ('출처', '고시명', '법령명', 'ID', '위임근거', '수집일', '수집방식',
              '별표서식파일링크', '별표서식PDF파일링크')


def is_bare(path):
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except OSError:
        return False
    if any('flDownload.do' in l or 'http' in l for l in lines):
        return False
    for l in lines[1:]:
        t = l.strip()
        if not t:
            continue
        if any(t.startswith(h + ':') for h in _META_HEAD):
            continue
        return False        # 본문 글이 있다
    return True


def unit_key(u, rows0):
    """API 별표단위 하나의 파일 키 — `별표9의2` · `별지3` · 번호 없으면 `별표0`.
    main()(빈 별표 채우기)과 refresh_annex()(새 판으로 갈아끼운 고시의 별표 맞추기)가 **같은 자**를 쓴다."""
    # ★가지번호(9의2·9의3)를 잃지 않는다 (2026-08-31 실측).
    #   API 의 `별표번호` 는 **가지번호를 안 준다** — 「위험물 선박운송 기준」은 별표9·별표9의2·
    #   별표9의3 이 셋 다 `별표번호: 0009` 로 온다. 그대로 쓰면 파일 이름이 겹쳐 뒤의 둘이
    #   통째로 사라진다(이미 있으면 건너뛰므로 조용히 없어진다).
    #   ⓐ내용 첫 줄의 `[별표 9의2]` 표기가 가장 확실하고,
    #   ⓑ없으면 `별표키` 뒤 두 자리(000900=본, 000902=의2, 000903=의3)로 만든다.
    head0 = str(rows0[0]) if rows0 else ''
    # ★서식은 `[별지 제3호의2서식]` 처럼 숫자와 `의` 사이에 `호` 가 낀다 (3-89, 2026-10-08 실측).
    #   종전 정규식은 `3` 바로 뒤의 `의` 만 봐서 3호와 3호의2 가 같은 `별지3` 이 됐다 — main() 은
    #   「이미 있으면 건너뜀」 이라 뒤의 것이 **조용히 사라졌다**. `호` 를 건너뛰고, 그래도 없으면
    #   API 의 `별표가지번호`(00=본, 02=의2)를 본다.
    # ★3-91: 머리가 `【별지 제1호의 1 서식】` 처럼 **겹낫표**로 오는 고시가 있다(포항항 출입절차 운영세칙 등).
    #   `[` 만 보던 종전 정규식은 이 줄을 못 읽어 아래 `별표키` 길로 갔다.
    m0 = re.match(r'\s*[\[【]?\s*(별표|별지|서식)\s*제?\s*(\d+)\s*호?(?:\s*의\s*(\d+))?', head0)
    gubun = (u.get('별표구분') or (m0.group(1) if m0 else '별표')).strip()
    if m0:
        ga = m0.group(3)
        if not ga:
            gv = str(u.get('별표가지번호') or '').strip()
            ga = str(int(gv)) if gv.isdigit() and int(gv) > 0 else None
        no = m0.group(2) + ('의' + ga if ga else '')
    else:
        # ★번호가 없으면 **`0` 으로 둔다 — 지어내지 않는다** (2026-09-26, 3-67).
        #   종전에는 `or '1'` 이었다. 그러면 API 가 `별표번호: "0000"`(원문에 번호가 없다)을
        #   줄 때 **우리가 `별표1` 이라는 번호를 만들어 붙인다**. 그것은 환각 0 위반이고,
        #   사장님 결심 ⑥ⓑ(2026-09-24)가 이미 「`0` 그대로 두고 『원문에 번호가 없다』고
        #   적는다」로 정한 그 자리다(→ `nonum_byl_note.py`).
        #   ⚠이 저장소의 다른 도구 8개는 전부 `or '0'` 이었다 — 여기 한 곳만 어긋나 있었다
        #   (collect.py·recollect_byl.py·byl_tier_fill.py·admrul_byl_links.py 등).
        base_no = str(u.get('별표번호') or '').lstrip('0') or '0'
        bkey = str(u.get('별표키') or '')
        br = bkey[-2:] if len(bkey) >= 3 else ''
        # ★3-91: 가지 `01` 도 가지다 — 원문 「제1호의 1」 이 `000101` 로 온다. `> 1` 로 막아 두었더니
        #   `별지1`(000100)과 `별지1의1`(000101)이 같은 이름이 되어 뒤의 것이 「이미 있음」 으로 조용히 빠졌다
        #   (포항항 5개 중 2개 · 목포항 출입절차 19개 중 4개 · 평택당진 · 내항해운 · 목포항 운영세칙 각 1개).
        no = base_no + ('의' + str(int(br)) if br.isdigit() and int(br) > 0 else '')
    key = ('별표' if gubun == '별표' else '별지') + no
    return key


def refresh_annex(paths, dry=False, touched=None):
    """새 판으로 갈아끼운(또는 새로 받은) 고시의 `<법>/별표/` 파일을 **그 판**에 맞춘다 → 보고 dict

    왜 (3-89, 2026-10-08 실제로 당했다): `article_text.js` 는 고시 별표를 본문 파일이 아니라
    `<법>/별표/<고시명>_별표N.txt` 에서 읽는다. 그런데 고시 갱신(`refresh_file`)은 본문 파일만 갈아끼워서
    「선박교통관제에 관한 규정」은 본문이 2026-10호인데 별표1·2 파일은 옛 판(2100000260394)을 그대로
    말하고 있었다 — 챗봇은 그 옛 별표로 답한다. main() 은 「이미 있는 파일은 절대 덮지 않는다」라서 못 고친다.

    규칙:
      · 파일 머리 `출처:` 가 **이 API 수집본**(`행정규칙 API … ID=`)이고 ID 가 지금 판과 다르면 → 새 판으로 다시 쓴다.
      · 출처가 API 가 아닌 파일(사람 전사·HWP 판독)은 **덮지 않는다** — `사람전사_그대로` 로만 보고한다.
      · 없던 별표는 새로 쓴다. 새 판에 없어진 별표 파일은 **지우지 않고** `새판에없음` 으로 보고한다(G-34).
    @param paths 고시 본문 파일 경로들(raw/…/행정규칙/<이름>.txt)
    예: refresh_annex(['…/선박교통관제에관한법률/행정규칙/선박교통관제에관한규정.txt'])
        → {'다시썼다': [...], '새로썼다': [...], '그대로(같은판)': [...], '사람전사_그대로': [...], '새판에없음': [...], '실패': [...]}
    """
    own = touched is None
    touched = touched or Touched('admrul_fill_annex_refresh')
    rep = {'다시썼다': [], '새로썼다': [], '그대로(같은판)': [], '사람전사_그대로': [], '새판에없음': [], '실패': [], '별표없음': [], '키겹침': []}
    for p in paths:
        aid = id_of(p)
        name = os.path.basename(p)
        if not aid:
            rep['실패'].append(name + ' (ID 없음)')
            continue
        d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={aid}")
        if not isinstance(d, dict) or '_err' in d:
            rep['실패'].append(name)
            continue
        units = ((d.get('AdmRulService', d)).get('별표') or {}).get('별표단위')
        gosi = title_of(p)
        byldir = os.path.join(os.path.dirname(os.path.dirname(p)), '별표')
        old = set(glob.glob(os.path.join(byldir, f"{safe(gosi)}_별표*.txt")) +
                  glob.glob(os.path.join(byldir, f"{safe(gosi)}_별지*.txt")))
        if units is None:
            rep['별표없음'].append(name)
            continue
        if not isinstance(units, list):
            units = [units]
        seen = set()
        for u in units:
            rows = body_rows(u)
            key = unit_key(u, rows)
            out = os.path.join(byldir, f"{safe(gosi)}_{key}.txt")
            rel = os.path.relpath(out, LEGAL)
            if out in seen:          # 한 판 안에서 키가 겹치면 덮지 않는다(앞의 것을 지운다) — 사람이 본다
                rep['키겹침'].append(rel)
                continue
            seen.add(out)
            if os.path.exists(out):
                head = open(out, encoding='utf-8').read().split('\n')[:4]
                src = next((l for l in head if l.startswith('출처:')), '')
                whole = open(out, encoding='utf-8').read()
                # API 수집본이라도 뒤에 사람이 판독문·검토 표시를 덧붙였으면 덮지 않는다(L-176 · refresh_file 과 같은 표시).
                if '행정규칙 API' not in src or any(m in whole for m in ('【이미지판독', '⚠REVIEW', '첨부파일 전사', '판독불가')):
                    rep['사람전사_그대로'].append(rel)
                    continue
                if f'ID={aid}' in src:
                    rep['그대로(같은판)'].append(rel)
                    continue
                bucket = '다시썼다'
            else:
                bucket = '새로썼다'
            txt = (f"[{gosi}] {key} — {(u.get('별표제목') or '').strip()}\n"
                   f"출처: 국가법령정보센터 행정규칙 API target=admrul ID={aid} (수집 {TODAY})\n")
            link = link_of(u)
            if link:
                txt += f"별표서식파일링크: {link}\n"
            if not dry:
                os.makedirs(byldir, exist_ok=True)
                open(out, 'w', encoding='utf-8').write(txt + '\n' + '\n'.join(str(r) for r in rows) + '\n')
                touched.add(out)
            rep[bucket].append(rel)
        rep['새판에없음'] += [os.path.relpath(x, LEGAL) for x in sorted(old - seen)]
    if not dry and own:              # 남이 넘긴 기록이면 저장은 그쪽이 한다
        touched.save()
    return rep


def main():
    dry = '--dry' in sys.argv
    if '--refresh' in sys.argv:
        paths = [a for a in sys.argv[sys.argv.index('--refresh') + 1:] if not a.startswith('--')]
        rep = refresh_annex(paths, dry)
        for k, v in rep.items():
            print(f"{k}: {len(v)}건" + (''.join('\n   · ' + x for x in v) if v and k != '그대로(같은판)' else ''))
        return
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    skip = sys.argv[sys.argv.index('--skip') + 1] if '--skip' in sys.argv else None
    relink = '--relink' in sys.argv
    refix = '--refix' in sys.argv

    sv = json.load(open(SURVEY, encoding='utf-8'))
    names = [r['파일'] for r in sv.get('빠짐', [])] + [r['파일'] for r in sv.get('수가모자람', [])]
    touched = Touched('admrul_fill_annex')
    rep = {'쓴파일': [], '다시썼다': [], '다시쓸것이없다': [], '주소붙였다': [], '주소도없다': [], '이미있어건너뜀': [],
           '고시못찾음': [], 'ID없음': [], '실패': [], '별표없음': []}
    done = 0
    fail_run = 0          # 연속 실패 수 — 사이트가 죽었을 때 일찍 멈추려고 센다
    FAIL_RUN_MAX = 8

    # ★같은 고시가 여러 법 폴더에 복사돼 있으면 **전부** 채운다 (2026-08-31 실측).
    #   전에는 hits[0] 하나만 채웠다. 그런데 「목포항 항만시설운영세칙」처럼
    #   항만법과 선박의입항및출항등에관한법률 두 곳에 같은 이름으로 놓인 고시가 27개 있고,
    #   article_text.js 는 **그 페이지가 속한 법 폴더**에서만 별표를 찾으므로
    #   한 쪽만 채우면 다른 쪽 위키는 계속 "그 별표가 없다"가 된다.
    targets = []
    for name in names:
        hits = sorted(glob.glob(os.path.join(LEGAL, 'raw', '*', '*', '행정규칙', name)))
        if not hits:
            rep['고시못찾음'].append(name)
            continue
        targets.extend(hits)

    for p in targets:
        if skip and skip in p:
            continue
        name = os.path.basename(p)
        aid = id_of(p)
        if not aid:
            rep['ID없음'].append(name)
            continue
        if limit is not None and done >= limit:
            break
        d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={aid}")
        done += 1
        if not isinstance(d, dict) or '_err' in d:
            rep['실패'].append(name)
            # ★사이트가 죽으면 **일찍 멈춘다**(2026-08-31, 내가 당했다).
            #   law.go.kr 이 응답을 끊기 시작했는데(심야 점검 이력이 있다) 이 도구는
            #   751건을 끝까지 돌며 재시도만 반복했다 — 한 건에 최대 15초씩, 남은 시간이
            #   몇 시간이었다. 그동안 새로 받은 것은 0건이다.
            #   연속 실패가 이어지면 "지금은 사이트가 안 된다"는 뜻이므로 멈추고 알린다.
            fail_run += 1
            if fail_run >= FAIL_RUN_MAX:
                print(f'⚠연속 {fail_run}건 실패 — 지금은 law.go.kr 이 응답하지 않는다. 여기서 멈춘다.')
                print('  받아 온 것은 그대로 저장돼 있다. 사이트가 회복된 뒤 다시 돌려라.')
                break
            continue
        fail_run = 0
        units = ((d.get('AdmRulService', d)).get('별표') or {}).get('별표단위')
        if units is None:
            rep['별표없음'].append(name)
            continue
        if not isinstance(units, list):
            units = [units]

        lawdir = os.path.dirname(os.path.dirname(p))          # …/<법>
        byldir = os.path.join(lawdir, '별표')
        gosi = title_of(p)
        for u in units:
            rows0 = body_rows(u)
            key = unit_key(u, rows0)
            fn = f"{safe(gosi)}_{key}.txt"
            out = os.path.join(byldir, fn)
            if os.path.exists(out):
                # ★`--relink` — **이미 쓴 파일에 빠진 내려받기 주소만 붙인다** (2026-09-25 신설).
                #   위 `link_of` 버그로 주소를 못 적은 파일이 46개 생겼다. 그 파일을 **지우지 않는다**
                #   (지워서 초록을 만들면 위키가 짚던 자리가 사라진다 — G-34). 한 줄을 덧붙여
                #   `linkOnly` 로 만든다. 글이 있는 파일은 건드리지 않는다.
                # ★`--refix` — **글자 하나씩 쪼개져 저장된 파일만** 다시 쓴다 (2026-09-25 신설).
                #   `별표내용` 이 문자열인 응답을 리스트로 착각해 745개 중 12개가 그 꼴이 됐다.
                #   게이트 V5-20 이 잡았다(줄 2201 → 2226). 기준선을 다시 굽지 않고 **수집을 고친다**(G-49).
                if refix and is_char_split(out):
                    rows_new = body_rows(u)
                    if not rows_new:
                        rep['다시쓸것이없다'].append(fn)
                        continue
                    if not dry:
                        txt = open(out, encoding='utf-8').read().split('\n')
                        head_keep = []
                        for l in txt:
                            if l.strip() and (l.startswith('[') or l.startswith(_META_HEAD)):
                                head_keep.append(l)
                            elif head_keep:
                                break
                        open(out, 'w', encoding='utf-8').write(
                            '\n'.join(head_keep) + '\n\n' + '\n'.join(rows_new) + '\n')
                        touched.add(out)
                    rep['다시썼다'].append(fn)
                    continue
                if relink and is_bare(out):
                    lk = link_of(u)
                    if not lk:
                        rep['주소도없다'].append(fn)
                        continue
                    if not dry:
                        txt = open(out, encoding='utf-8').read().split('\n')
                        at = 1
                        for i, l in enumerate(txt):
                            if l.startswith('출처:'):
                                at = i + 1
                                break
                        txt.insert(at, f'별표서식파일링크: {lk}')
                        open(out, 'w', encoding='utf-8').write('\n'.join(txt))
                        touched.add(out)
                    rep['주소붙였다'].append(fn)
                    continue
                rep['이미있어건너뜀'].append(fn)
                continue
            rows = rows0
            head = (f"[{gosi}] {key} — {(u.get('별표제목') or '').strip()}\n"
                    # ★날짜를 박아 두지 않는다 (2026-09-25 고침).
                    #   전에는 `(수집 2026-08-31)` 이 **글자 그대로** 박여 있어서, 오늘 새로 받은
                    #   725개 파일이 전부 「8월 31일에 받았다」고 적었다 — 출처에 거짓 날짜가 남는다.
                    f"출처: 국가법령정보센터 행정규칙 API target=admrul ID={aid} (수집 {TODAY})\n")
            link = link_of(u)
            if link:
                head += f"별표서식파일링크: {link}\n"
            if not dry:
                os.makedirs(byldir, exist_ok=True)
                open(out, 'w', encoding='utf-8').write(head + '\n' + '\n'.join(rows) + '\n')
                touched.add(out)
            rep['쓴파일'].append(os.path.relpath(out, LEGAL))

    for k in rep:
        print(f"{k}: {len(rep[k])}건")
    if not dry:
        os.makedirs(REPORT_DIR, exist_ok=True)
        o = os.path.join(REPORT_DIR, f'report_{touched.stamp}.json')
        json.dump(rep, open(o, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.save()
        print('보고서:', o)


if __name__ == '__main__':
    main()
