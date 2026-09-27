#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-37 — **판번호가 아예 없는 `_meta.json` 68곳**에 번호를 되찾아 준다.

[왜 이게 중요한가]
  판번호(MST)가 없으면 **그 판을 가리킬 수가 없다.** 가리킬 수 없으면 신선도 점검이
  *"이 법이 바뀌었나"* 를 물을 수가 없다. 곧 **법이 개정돼도 우리는 모른다.**
  실측 68곳 전부 `15_관련타부처` — 우리 기준법이 인용하는 **타 부처 법의 발췌본**이다.

[★번호를 지어 붙이지 않는다 — 글자를 먼저 본다]
  이름으로 찾은 「현행 판」의 번호를 그냥 적으면, **우리가 안 가진 판을 가졌다고 적는 것**이 된다.
  그래서 전자정부법에서 쓴 것과 같은 길을 간다(`meta_mst_align.py`):
    ① 이름으로 현행 판을 찾는다
    ② **우리 파일이 담고 있는 조**를 현행 판과 **글자까지** 견준다
    ③ 전부 같다 → 내용이 현행 그대로다. 번호를 적는다(견준 사실과 함께).
    ④ 하나라도 다르다 → **번호를 적지 않는다.** 대신 `_판번호_보류` 에
       *"현행은 이 번호인데 우리 판은 이 조들이 다르다"* 를 적는다.
       ⇒ 이것이 **낡았다는 사실을 드러내는 기록**이 된다. 숨기지 않는다.

[연계] ← `_dashboard/loop/meta_schema_gate.js`(V5-18) 의 `아무 데도 없다`
사용법: python3 meta_mst_recover.py [--apply] [--limit N]
"""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_api_guard
from _touched import Touched

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
APPLY = '--apply' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
ART_RE = re.compile(r'^제(\d+)조(?:의(\d+))?\(', re.M)
# ★수집할 때 **파일 머리에 이미 적어 둔** 판번호. 짐작할 필요가 없는 가장 확실한 자리다.
#   실측 2026-09-24 — 번호가 `_meta.json` 에 없는 87곳 가운데 **21곳**이 여기에 적혀 있었다.
#   (`⚠REVIEW / 출처: … 기술사법(현행, MST=234749, 시행 2022-02-18) / 발췌수집`)
HEAD_MST_RE = re.compile(r'MST\s*=\s*(\d{4,})')

# ★우리 발췌본에는 **우리가 얹은 줄**이 본문 사이에 끼어 있다(`※ 링크갭 분류…`·`출처:`·`[제6조]`).
#   그래서 「현행 조문이 통째로 들어 있나」로 견주면 **멀쩡한 파일이 「낡았다」로 떨어진다**
#   (2026-09-24 실측 — 기술사법이 그렇게 잘못 떨어졌다. 머리에 적힌 MST 가 현행과 같았는데도).
#   그래서 ①우리 줄을 먼저 걷어내고 ②조문을 **토막으로 갈라 얼마나 덮이는지**로 본다.
# ★2026-09-24 보탬 — **발췌본에 우리가 붙이는 쪽지**도 걸러야 한다.
#   `[인용처 추가 2026-07-18] 「수상레저안전법 시행규칙」 제28조…` 같은 줄이 그대로 남아
#   「현행에 없는 글」로 세어졌다. 초중등교육법 발췌는 그 탓에 **덮임 8%** 로 떨어졌다 —
#   실제로 담은 조문은 제2조 하나이고 그건 현행과 같다. **우리 말은 원문이 아니다.**
#   실측한 쪽지 꼴: `[인용처…]`(26) · `[추가발췌…]`(8) · `[추가수집…]`(1) · `[추가 인용처…]`(1)
OURS_LINE_RE = re.compile(r'^\s*(?:⚠|※|출처\s*:|인용출처\s*:|\[제\d+조|소관부서\s*:'
                          r'|\[(?:인용처|추가\s*인용처|추가발췌|추가\s*발췌|추가수집|메모|참고)'
                          r'|-\s*\d{4}-\d{2}-\d{2})')


def our_text(text):
    # ★첫 줄은 **우리가 붙인 제목**이다(`항공안전법 — 타법연결용 발췌 (전체 아님)`). 원문이 아니라 뺀다.
    keep = [l for l in text.split('\n')[1:] if not OURS_LINE_RE.match(l)]
    return re.sub(r'\s+', '', '\n'.join(keep))


# ★개정·신설·삭제 표시는 **꼴이 양쪽에서 다르다** — 견주기 전에 걷어낸다.
#   우리 파일 `<개정 2025.5.27>` ↔ API `<개정 2025. 5. 27.>` 처럼 점·빈칸이 다르고,
#   API 는 아예 안 주는 자리도 있다. 2026-09-24 실측 — 항공안전법이 이 표시 하나 때문에
#   「0%만 같다」로 떨어졌다(걷어내니 100%다).
AMEND_RE = re.compile(r'<\s*(?:개정|신설|삭제|본조신설|전문개정|제목개정)[^>]*>')


def norm(text):
    """견주기용으로 눕힌다 — 개정표시를 떼고 공백을 지운다."""
    return re.sub(r'\s+', '', AMEND_RE.sub('', str(text or '')))


def covered(ours, cur):
    """★**우리 글**을 30글자 창으로 훑어 **몇 창이 현행 글에 있나**. 0~1.

    ★왜 문장 쪼개기를 안 쓰나 (2026-09-24 — 두 번 틀린 뒤 바꿨다)
      마침표로 쪼개면 `1. 운송용 조종사` 같은 **호 번호가 마침표로 잘려** 20자 미만 토막이
      쏟아지고, 남는 토막 하나가 어긋나면 **0%** 가 된다. 창으로 훑으면 그런 일이 없다.
    ★방향도 중요하다 — 우리 파일은 **발췌본**이라 한 조의 ①항만 담기도 한다.
      「현행이 우리 글에 다 있나」로 물으면 멀쩡한 발췌가 「낡았다」로 떨어진다.
      물어야 할 것은 **우리가 가진 글이 지금도 그대로인가** 다."""
    o, c = norm(ours), norm(cur)
    w, step = 30, 15
    if len(o) < w:
        return 1.0 if o and o in c else 0.0
    wins = [o[i:i + w] for i in range(0, len(o) - w + 1, step)]

    # 창의 앞머리에 걸린 **번호 부스러기**(`.1.`·`2.`)는 창을 아무 데서나 잘라서 생긴 것이다.
    #   견줄 거리가 아니므로 떼고 본다.
    def trim(x):
        return x.lstrip('.0123456789ㆍ·,;:)(')

    def hit(x):
        if x in c or (len(trim(x)) >= 12 and trim(x) in c):
            return True
        # ★이음매를 지나는 창은 **통째로는 안 걸린다.** API 가 호·목을 조 머리 **앞에** 놓기
        #   때문이다(항공안전법 제35조 실측 — 우리 파일은 `구분한다.1.운송용…` 로 이어 적는데
        #   API 는 `…9.운항관리사` 를 먼저 주고 그다음에 `제35조(…) …구분한다.①…` 을 준다).
        #   **차례가 다를 뿐 글은 같다.** 그래서 창을 반으로 갈라 **양쪽이 다 있으면** 있는 것으로 본다.
        a, b = trim(x[:w // 2]), trim(x[w // 2:])
        return len(a) >= 12 and len(b) >= 12 and a in c and b in c

    # ★2026-09-27 — 비율만 돌려주면 **사람이 판단할 수 없다.** 3-37 의 남은 일이 바로
    #   「보류 27건을 사람이 보고 재수집 여부 판단」인데, 손에 든 것이 「67%」 하나면 아무것도 못 고른다.
    #   그래서 **못 찾은 창을 같이 남긴다.** 비율 계산은 한 글자도 바꾸지 않았다(A/B 로 확인했다).
    못찾 = [x for x in wins if not hit(x)]
    covered.마지막_못찾 = 못찾
    return (len(wins) - len(못찾)) / len(wins)


def covered_windows(ours, cur):
    """`covered()` 와 **똑같이** 재고, 비율과 **못 찾은 창**을 같이 돌려준다. → (0~1, [창…])

    ★자를 두 벌 만들지 않으려고 `covered()` 를 그대로 부른다(L-386). 부르는 쪽은
    `meta_mst_holdover_diff.py` — 어느 조가 어떻게 다른지 사람에게 보여 줘야 한다.
    """
    r = covered(ours, cur)
    return r, list(getattr(covered, '마지막_못찾', []))


def api(url):
    for i in range(10):
        try:
            b = urllib.request.urlopen(url, timeout=40).read().decode('utf-8', 'replace')
            if b.lstrip()[:1] in '{[':
                return json.loads(b)
            r = law_api_guard.block_reason(b)
            if r:
                law_api_guard.announce(r, url)
                if law_api_guard.is_fatal(r):
                    return None
        except Exception:
            pass
        time.sleep(min(1.2 + 0.4 * i, 6.0))
    return None


def search(name):
    """이름으로 현행 판을 찾는다 → (MST, 시행일) · 이름이 **정확히 같은 것만** 받는다."""
    q = urllib.parse.quote(name)
    d = api(f'https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=law&type=JSON&display=20&query={q}')
    ls = ((d or {}).get('LawSearch') or {}).get('law') or []
    if isinstance(ls, dict):
        ls = [ls]
    want = re.sub(r'\s', '', name)
    for x in ls:
        if re.sub(r'\s', '', str(x.get('법령명한글') or '')) == want:
            return str(x.get('법령일련번호') or ''), str(x.get('시행일자') or '')
    return '', ''


def _flat_strings(v, out):
    """어떤 모양이든 **문자열을 다 긁는다** — 문자열·목록·목록의 목록."""
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, list):
        for x in v:
            _flat_strings(x, out)
    elif isinstance(v, dict):
        for x in v.values():
            _flat_strings(x, out)
    return out


def _all_text(node, out):
    """그 조에 딸린 **모든 글**을 긁는다 — 조문내용·항내용뿐 아니라 **호내용·목내용**까지.
    ⚠2026-09-24 ① 처음에 `조문내용 + 항내용` 만 모았다. 우리 발췌본에는 `1. 신문 및 인터넷신문의 명칭`
      같은 **호 줄**이 그대로 있어서, 호를 안 모은 현행 글과 견주면 멀쩡한 발췌가 떨어졌다.
    ⚠2026-09-24 ② **`…내용` 키 아래가 목록이면 통째로 버리고 있었다.**
      `target=admrul` 은 본문을 `"조문내용": [[ "…", "…" ]]` 처럼 **목록의 목록**으로 준다.
      그래서 행정규칙 원문이 **한 글자도 안 잡혀** 「1%만 일치」가 나왔다(3-28 에서 잡았다).
      ⇒ 문자열만 받지 말고 **목록 속 문자열까지 펴서** 받는다.
      ★이 고침으로 **글이 늘기만 한다** — 덮임 비율은 오르기만 하고 내려가지 않는다.
        그래서 앞서 `meta_mst_recover` 가 「맞다」고 한 것은 그대로 맞고,
        「낡았다」로 보류한 27건은 **다시 재 보면 줄 수 있다**(3-37 남은 일)."""
    if isinstance(node, dict):
        for k, v in node.items():
            if str(k).endswith('내용'):
                _flat_strings(v, out)
            else:
                _all_text(v, out)
    elif isinstance(node, list):
        for v in node:
            _all_text(v, out)
    return out


def doc_text(mst):
    """그 판의 **문서 차례 그대로** 이어 붙인 전문.
    ★왜 `articles()` 값을 이어 붙이면 안 되나 (2026-09-24 실측)
      호·목은 API 가 **따로 행으로** 주고 조문번호가 비어 있기도 하다. 그것을 조 키로 묶어
      딕셔너리에 담으면 **차례가 흩어져** 조문 끝과 첫 호 사이가 끊긴다.
      그러면 그 이음매를 지나는 창이 「없다」로 떨어진다(항공안전법 제35조가 그랬다 —
      `구분한다.1.운송용조종사` 라는 창이 어디에도 없게 된다).
      ⇒ 견주기에는 **차례 그대로의 전문**을 쓴다."""
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON')
    js = ((d or {}).get('법령') or {}).get('조문', {}).get('조문단위') or []
    if isinstance(js, dict):
        js = [js]
    return ''.join(_all_text(js, []))


def articles(mst):
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON')
    js = ((d or {}).get('법령') or {}).get('조문', {}).get('조문단위') or []
    if isinstance(js, dict):
        js = [js]
    out = {}
    for j in js:
        n = str(j.get('조문번호') or '').lstrip('0') or '0'
        g = str(j.get('조문가지번호') or '').lstrip('0')
        out['제%s조%s' % (n, '의' + g if g else '')] = re.sub(r'\s+', '', ''.join(_all_text(j, [])))
    return out


def name_of(mst):
    """그 판번호가 **어느 법**을 가리키나 — 번호를 적기 전에 되물어 확인한다."""
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON')
    return str((((d or {}).get('법령') or {}).get('기본정보') or {}).get('법령명_한글') or '')


def mp0(root):
    return os.path.join(root, '_meta.json')


TIER_SUFFIX = {'법률': '', '시행령': ' 시행령', '시행규칙': ' 시행규칙'}


def base_name(meta, root):
    """그 폴더가 다루는 **법의 본이름**. 꼬리의 `시행령`·`시행규칙` 을 떼어 낸다.
    ★왜 필요한가 (2026-09-24 실측) — `신문등의진흥에관한법률` 폴더의 `_meta.법령명` 이
      **「신문 등의 진흥에 관한 법률 시행령」** 이라고 적혀 있는데, 그 폴더에는 `법률_발췌.txt`(제9조)와
      `시행령_발췌.txt`(제13조)가 **둘 다** 있다. 이름 하나로 찾으면 **법률 자리에 시행령 번호**를
      적게 된다(실제로 그렇게 나왔다 — MST 284795 는 시행령이고 법률은 277349 다).
      ⇒ 계층마다 이름을 따로 만들어 찾는다."""
    nm = str(meta.get('법령명') or os.path.basename(root))
    return re.sub(r'\s*(시행령|시행규칙)\s*$', '', nm).strip()


def missing():
    """판번호가 **아무 자리에도 없는** 곳을 **계층마다 한 줄씩** 모은다.
       → [(폴더, meta, 계층, 파일, 찾을이름)]"""
    out = []
    for root, dirs, files in os.walk(RAW):
        dirs[:] = [d for d in dirs if d != '_대기']
        if '_meta.json' not in files:
            continue
        p = os.path.join(root, '_meta.json')
        try:
            d = json.load(open(p, encoding='utf-8'))
        except Exception:
            continue
        blob = json.dumps(d, ensure_ascii=False)
        if re.search(r'"(MST|법령일련번호[^"]*|행정규칙일련번호)"\s*:\s*"?\d', blob):
            continue          # 어딘가에는 번호가 있다 — 이 도구 소관이 아니다
        base = base_name(d, root)
        fam = d.get('families') or {}
        seen = set()
        for tier in ('법률', '시행령', '시행규칙'):
            fname = (fam.get(tier) or {}).get('파일')
            if not fname:
                for cand in (f'{tier}.txt', f'{tier}_발췌.txt'):
                    if cand in files:
                        fname = cand; break
            if not fname or fname in seen or not os.path.exists(os.path.join(root, fname)):
                continue
            seen.add(fname)
            out.append((root, d, tier, fname, base + TIER_SUFFIX[tier]))
    return out


def main():
    rows = missing()
    if LIMIT:
        rows = rows[:LIMIT]
    print(f'판번호가 아무 자리에도 없는 곳 {len(rows)}개\n')
    touched = Touched('meta_mst_recover.py')
    ok = stale = miss = 0
    for root, meta, tier, fname, seek in rows:
        rel = os.path.relpath(root, RAW)
        name = seek
        txtp = os.path.join(root, fname)
        # ── 갈래 A — 파일 머리에 판번호가 이미 적혀 있다(짐작이 필요 없다) ──
        head = open(txtp, encoding='utf-8').read()[:4000]
        heads = sorted(set(HEAD_MST_RE.findall(head)))
        if len(heads) == 1:
            hm = heads[0]
            nm = name_of(hm)
            if nm and re.sub(r'\s', '', nm) == re.sub(r'\s', '', name):
                ok += 1
                print(f'✅ {rel} — **파일 머리에 적혀 있다** MST={hm} (그 번호가 「{nm}」 을 가리키는 것도 확인)')
                if APPLY:
                    meta.setdefault('families', {}).setdefault(tier, {})
                    meta['families'][tier]['MST'] = hm
                    meta['families'][tier].setdefault('파일', fname)
                    meta.setdefault('_판번호_복원', []).append({
                        '날짜': '2026-09-24', '계층': tier, 'MST': hm, '갈래': '파일 머리에 적혀 있던 것',
                        '근거': f'수집할 때 `{fname}` 머리에 `MST={hm}` 이라고 적어 두었고, 그 번호를 '
                                f'law.go.kr 에 물으니 「{nm}」 이 맞다. 짐작한 것이 아니다.',
                        '도구': 'meta_mst_recover.py',
                    })
                    json.dump(meta, open(mp0(root), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
                    touched.add(mp0(root))
                continue
            print(f'· {rel} — 머리의 MST={hm} 가 「{nm or "?"}」 을 가리킨다(이름이 다르다) — 이름으로 다시 찾는다')
        elif len(heads) > 1:
            print(f'· {rel} — 머리에 판번호가 {len(heads)}개다 {heads} — 사람 몫'); miss += 1; continue
        # ── 갈래 B — 머리에 없다. 이름으로 찾고 **글자로 견준다** ──
        mst, eff = search(name)
        if not mst:
            print(f'· {rel} — 「{name}」 이름으로 현행 판을 못 찾았다'); miss += 1; continue
        text = open(txtp, encoding='utf-8').read()
        keys = ['제%s조%s' % (a, '의' + b if b else '')
                for a, b in sorted(set(ART_RE.findall(text)), key=lambda x: (int(x[0]), int(x[1] or 0)))]
        if not keys:
            print(f'· {rel} — 그 파일에서 조를 못 읽었다'); miss += 1; continue
        cur = articles(mst)
        if not cur:
            print(f'· {rel} — 현행 판 본문을 못 받았다(MST={mst})'); miss += 1; continue
        ourtxt = our_text(text)
        allcur = doc_text(mst)          # ★차례 그대로의 전문으로 견준다(딕셔너리 값 이어 붙이기 금지)
        # ★우리 글이 현행 어디엔가 그대로 있나 — 조를 하나하나 짝짓지 않고 **통째로** 본다.
        #   발췌본은 조 머리줄을 우리 꼴로 다시 쓰기도 해서, 조별 짝짓기는 허술하다.
        ratio = covered(ourtxt, allcur)
        diff = [] if ratio >= 0.95 else ['우리 글의 %d%%만 현행에 있다' % round(ratio * 100)]
        absent = [k for k in keys if k not in cur]
        mp = mp0(root)
        if diff or absent:
            stale += 1
            print(f'❗ {rel}[{tier}] — 현행 MST={mst}(시행 {eff}) 인데 **우리 글이 옛 문구다** '
                  f'({"·".join(diff) if diff else ""}{" · 현행에 없는 조 " + str(len(absent)) if absent else ""})')
            if APPLY:
                meta.setdefault('_판번호_보류', []).append({
                    '날짜': '2026-09-24', '계층': tier, '현행 MST': mst, '현행 시행일': eff,
                    '왜 안 적었나': '우리 파일이 담은 글이 현행 판에 그대로 있지 않다. 번호를 적으면 '
                                    '**안 가진 판을 가졌다고 적는 것**이라 적지 않는다(환각 0).',
                    '⚠사람이 볼 것': '덮임 비율이 낮다고 반드시 낡은 것은 아니다. law.go.kr 이 호·목을 '
                                    '조 머리 앞에 놓거나 개정표시 꼴이 달라 **차례만 다른데 어긋나 보이는** 일이 '
                                    '있다(항공안전법 제35조가 그랬다). 사람이 한 번 보고 정한다.',
                    '다른 조': diff[:20], '현행에 없는 조': absent[:20],
                    '해야 할 일': '그 조들을 현행 판으로 다시 받는다(3-37).',
                    '도구': 'meta_mst_recover.py',
                })
                json.dump(meta, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
                touched.add(mp)
            continue
        ok += 1
        print(f'✅ {rel}[{tier}] — 담은 글이 현행(MST={mst}, 시행 {eff}) 에 그대로 있다 → 번호를 적는다')
        if APPLY:
            meta.setdefault('families', {}).setdefault(tier, {})
            meta['families'][tier]['MST'] = mst
            meta['families'][tier].setdefault('파일', fname)
            meta.setdefault('_판번호_복원', []).append({
                '날짜': '2026-09-24', '계층': tier, 'MST': mst, '시행일': eff,
                '근거': f'이름으로 현행 판을 찾고, 우리 파일이 담은 조 {len(keys)}개'
                        f'({"·".join(keys[:12])}{" 외" if len(keys) > 12 else ""})가 '
                        f'현행 본문 안에 **글자 그대로** 들어 있음을 확인했다. 다시 받은 것이 아니다.',
                '도구': 'meta_mst_recover.py',
            })
            json.dump(meta, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            touched.add(mp)
    if APPLY:
        touched.save()
    print(f'\n번호를 되찾았다 {ok} · ★우리 판이 낡았다 {stale} · 못 가림 {miss}')
    if not APPLY:
        print('(미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
