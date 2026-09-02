#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위임 행정규칙 조회 기록을 만든다 — "규정이 없다"고 말하려면 이 기록이 있어야 한다(_SCHEMA.md §6-B-1 ⓑ).

왜 (2026-09-01, 16회차에서 사서 둘이 같은 실수를 했다):
  §6-B-1 ⓑ 는 *"'없음'으로 합격을 주려면 그 판정 옆에 국가법령정보센터(law.go.kr DRF) 조회를
  실제로 했다는 기록을 함께 적는다 — ①무엇을 ②target ③질의어 ④결과 건수 ⑤조회일.
  기록이 없으면 합격이 아니라 미확인이다"* 라고 정한다.
  그런데 사서들은 **이미 받아 둔 raw 파일을 grep 한 것**을 조회 기록이라고 적었다.
  둘은 다르다 — raw 에 없는 고시가 그 사항을 정하고 있으면 raw grep 은 그걸 못 본다.
  매번 사서에게 API 를 치게 하는 것도 낭비다(같은 법에 30건이면 30번 친다).
  그래서 **법 단위로 한 번 조회해 기록을 만들어 두고, 그 법의 모든 "없음" 판정이 그것을 가리키게** 한다.

무엇을 하나
  그 법의 _meta.json 에 있는 families(법률·시행령·시행규칙) MST 로 lsDelegated 를 조회해
  **law.go.kr 이 "이 법이 위임했다"고 말하는 행정규칙 목록**을 받는다.
  그리고 `raw/<도메인>/<법>/행정규칙/` 에 실제로 수집된 파일과 대조해
  **빠진 것이 있는지**까지 같이 찍는다. 빠진 것이 있으면 "없다"고 말하면 안 된다 —
  아직 안 받은 고시가 그 사항을 정하고 있을 수 있기 때문이다.

⚠이 도구는 **위임 행정규칙만** 본다. 위임 관계가 없는 별개 고시·훈령은 잡지 못한다.
  그런 것까지 봐야 하면 `lawSearch.do?target=admrul&query=` 를 따로 쳐야 한다.

[연계]
  - 읽음: raw/*/<법>/_meta.json · raw/*/<법>/행정규칙/*.txt · _dashboard/law_raw_paths.json
  - 씀:   _dashboard/delegated_sweep/<법>.md  (사서가 그대로 인용할 수 있는 조회 기록)
사용법: python3 delegated_sweep.py <법이름> [<법이름> ...]
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OUTDIR = os.path.join(LEGAL, '_dashboard', 'delegated_sweep')
KST = timezone(timedelta(hours=9))


def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.2)
    return None


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def squash(s):
    """이름 비교용 정규화 — 공백·밑줄·따옴표·가운뎃점을 다 지운다.
    ⚠밑줄을 안 지웠다가 이미 수집된 파일을 "없다"고 잘못 보고했다(2026-09-01 첫 실행에서 잡음).
    raw 파일명은 공백을 밑줄로 바꿔 저장하기 때문이다."""
    return re.sub(r'[\s_「」『』·ㆍ・,\-()（）]', '', str(s or ''))


def sweep(law):
    paths = json.load(open(os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json'), encoding='utf-8'))
    rel = paths.get(law)
    if not rel:
        print(f'✖ {law}: law_raw_paths.json 에 없다'); return None
    base = os.path.join(os.path.dirname(LEGAL), *[]) if False else os.path.join('/home/user/SEAGNAL', rel)
    meta_p = os.path.join(base, '_meta.json')
    if not os.path.exists(meta_p):
        print(f'✖ {law}: _meta.json 이 없다 ({meta_p})'); return None
    meta = json.load(open(meta_p, encoding='utf-8'))
    fams = meta.get('families') or {}

    # ⚠families 의 값이 **목록일 수 있다**(2026-09-01 전수 조회 중 해양경찰법에서 터졌다).
    #   한 계층에 여러 대통령령이 걸린 법이 그렇다 — 해양경찰법 시행령은 위원회 규정·긴급중요사건
    #   범위 규정·과학기술진흥 규정 셋이다. 그래서 목록이면 하나씩 다 조회한다.
    asked, found = [], {}
    fam_items = []
    for tier, f in fams.items():
        for one in (f if isinstance(f, list) else [f]):
            if isinstance(one, dict):
                fam_items.append((tier, one))
    for tier, f in fam_items:
        mst = str(f.get('MST') or '')
        if not mst:
            continue
        asked.append((f.get('법령명') or tier, mst))
        d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=lsDelegated&type=JSON&MST={mst}')
        if d is None:
            print(f'  ⚠ {law} {tier}(MST={mst}) 응답 없음 — 이 기록은 불완전하다')
            continue
        try:
            units = L(d['lsDelegated']['법령']['위임조문정보'])
        except (KeyError, TypeError):
            units = []
        for u in units:
            for w in L(u.get('위임정보')):
                for a in L(w.get('위임행정규칙조문정보')):
                    sid = str(a.get('위임행정규칙일련번호') or '')
                    title = str(a.get('위임행정규칙제목') or '')
                    if sid and sid != '0' and title:
                        found.setdefault(title, set()).add(sid)

    # ★대조는 **ID 로 먼저** 한다(2026-09-01 두 번 데었다).
    #   파일 이름으로만 맞추면 이미 받아 둔 것을 "없다"고 잘못 보고한다 —
    #   raw 파일명은 줄여 저장돼 있다(예: 「군산항 도선사의 승선·하선 구역 고시」 → 승선하선구역_군산항.txt).
    #   다행히 수집된 파일 머리에 `ID:2100000270010` 이 적혀 있으므로 그것으로 맞춘다.
    #   ID 가 없는 옛 파일만 이름으로 맞춘다.
    admdir = os.path.join(base, '행정규칙')
    have_txt, have_titles, have_ids = [], [], set()
    if os.path.isdir(admdir):
        for n in sorted(os.listdir(admdir)):
            if n.startswith('_') or not n.endswith('.txt'):
                continue
            have_txt.append(n[:-4])
            try:
                head = open(os.path.join(admdir, n), encoding='utf-8').read(600)
            except Exception:
                head = ''
            for m in re.finditer(r'\bID[=:]\s*(\d{6,})', head):
                have_ids.add(m.group(1))
            # ★파일 이름 말고 **파일이 스스로 적어 둔 제목**으로 맞춘다(2026-09-01).
            #   raw 파일명은 줄여 저장되지만(`승선하선구역_군산항.txt`),
            #   머리줄에는 원래 제목이 그대로 있다(`[고시/행정규칙] 군산항 도선사의 승선·하선 구역 고시`).
            #   이걸 쓰면 도선법 8건처럼 "이름만 줄인 것"을 글자 겹침에 기대지 않고 정확히 맞출 수 있다.
            #   (머리줄이 있는 파일은 2026-09-01 기준 2,146개 중 795개다 — 없으면 예전처럼 파일명으로 본다.)
            mt = re.match(r'\[고시/행정규칙\]\s*(.+)', head)
            if mt:
                have_titles.append(mt.group(1).strip())
    # ★이름도 흔들린다(2026-09-01 세 번째로 데었다).
    #   ⓐ raw 파일명이 줄여 저장된다 — 「군산항 도선사의 승선·하선 구역 고시」 → `승선하선구역_군산항.txt`.
    #   ⓑ lsDelegated 가 주는 ID 가 **옛 판**일 수 있다 — 군산항은 API 가 219772 를 주는데
    #      우리가 가진 파일은 270010(더 최신)이다. ID 만 맞추면 최신본을 "없다"고 잘못 본다.
    #   그래서 ID·정확이름·**글자 겹침**을 다 본 뒤에도 안 맞는 것만 남기고,
    #   그것도 "없다"가 아니라 **"확인 필요"** 라고 부른다 — 도구는 "안 받은 것"과
    #   "다른 이름·다른 판으로 받아 둔 것"을 못 가른다.
    def bigrams(x):
        x = squash(x)
        return {x[i:i + 2] for i in range(len(x) - 1)} or {x}

    def similar(a, b):
        A, B = bigrams(a), bigrams(b)
        return len(A & B) / max(1, min(len(A), len(B)))

    #   ⓒ ★글자 겹침은 "수집됨"의 근거가 못 된다(2026-09-01 네 번째로 데었다).
    #      「임산물 표준규격」을 `농산물표준규격.txt` 와 0.83 으로 맞춰 "✅ raw 수집됨" 이라고 적었는데,
    #      그 고시는 raw 어디에도 없었다(ID 2100000076109 전수검색 0건). 이 분야는
    #      **농산물·수산물·임산물**처럼 한 글자만 다른 이름이 떼로 있어 글자 겹침이 특히 위험하다.
    #      그래서 겹침으로 맞은 것은 ✅ 가 아니라 **별도 칸(유사이름 — 사람이 확인)** 으로 뺀다.
    missing, fuzzy = [], {}
    for t in found:
        if found[t] & have_ids:
            continue
        if any(squash(t) == squash(h) for h in have_txt + have_titles):
            continue
        near = [h for h in have_txt if similar(t, h) >= 0.6]
        if near:
            fuzzy[t] = near
            continue
        missing.append(t)

    now = datetime.now(KST).strftime('%Y-%m-%d')
    os.makedirs(OUTDIR, exist_ok=True)
    try:
        CONFIRMED = json.load(open(os.path.join(OUTDIR, '_confirmed.json'), encoding='utf-8'))
    except Exception:
        CONFIRMED = {}
    out = os.path.join(OUTDIR, law + '.md')
    with open(out, 'w', encoding='utf-8') as fp:
        fp.write(f'# {law} — 위임 행정규칙 조회 기록\n\n')
        fp.write(f'> `_SCHEMA.md` §6-B-1 ⓑ 가 요구하는 조회 기록이다. 이 법에서 **"규정이 없다"**고 적을 때\n')
        fp.write(f'> 이 파일을 근거로 인용한다. 인용문 예:\n')
        fp.write(f'> `(조회기록: law.go.kr DRF target=lsDelegated, MST {"·".join(m for _, m in asked)} — '
                 f'위임 행정규칙 {len(found)}건, {now} 조회. _dashboard/delegated_sweep/{law}.md)`\n\n')
        fp.write(f'- **조회일**: {now} (KST)\n')
        fp.write(f'- **target**: `lsDelegated` (위임법령)\n')
        fp.write(f'- **질의어(MST)**: ' + ' · '.join(f'{t}={m}' for t, m in asked) + '\n')
        fp.write(f'- **결과 건수**: 위임 행정규칙 {len(found)}건\n\n')
        fp.write('## law.go.kr 이 말하는 위임 행정규칙\n\n')
        if not found:
            fp.write('(없음 — 이 법은 위임 행정규칙이 없다고 응답했다)\n\n')
            # ★"위임 0건"을 "하위규정이 전무하다"로 읽으면 안 된다(2026-09-02, 26회차 사서 제안).
            #   해양과학조사법이 그 예다 — 위임 행정규칙은 0건인데 예규는 실제로 있다(위임 관계가 아닌 형태).
            fp.write('> ⚠**0건은 "이 법에 하위규정이 하나도 없다"는 뜻이 아니다.** 이 조회는 **위임 관계가\n')
            fp.write('> 등록된 행정규칙**만 센다. 위임 없이 따로 만든 고시·훈령·예규는 여기 안 잡힌다\n')
            fp.write('> (실제 사례: 해양과학조사법은 위임 0건인데 예규가 있다). 그러니 이 기록으로\n')
            fp.write('> **"이 법에는 고시가 없다"고 쓰지 마라** — 말할 수 있는 것은 "위임 행정규칙이 없다"까지다.\n\n')
        for t in sorted(found):
            said_m = CONFIRMED.get(law, {}).get(t)
            if t in missing and said_m:
                # 사람이 이미 본 것은 그 결론을 보여 준다 — 못 받는 이유가 확인됐으면 매번 다시 쫓지 않는다.
                pre = '☐사람이 봤으나 결론 못 냄: ' if str(said_m).startswith('⚠') else '✔사람이 확인함: '
                mark = pre + said_m
            elif t in missing:
                mark = '⚠확인 필요(raw 에서 못 찾음)'
            elif t in fuzzy:
                # 사람이 이미 눈으로 확인한 것은 그 결론을 그대로 보여 준다(_confirmed.json).
                # 안 그러면 라운드마다 같은 39건을 다시 확인하게 된다.
                said = CONFIRMED.get(law, {}).get(t)
                # 사람이 봤지만 결론을 못 낸 것(⚠로 시작)은 "확인함"이라고 쓰면 안 된다.
                pre = '☐사람이 봤으나 결론 못 냄: ' if str(said).startswith('⚠') else '✔사람이 확인함: '
                mark = (pre + said) if said else (
                    '⚠유사이름만 있음 — 사람이 확인할 것 (닮은 파일: ' + ' · '.join(fuzzy[t]) + ')')
            else:
                mark = '✅ raw 수집됨'
            fp.write(f'- {t} (ID {"·".join(sorted(found[t]))}) — {mark}\n')
        fp.write('\n## raw 에 있는 행정규칙 파일\n\n')
        for h in have_txt:
            fp.write(f'- {h}\n')
        fp.write('\n## 이 기록을 어떻게 쓰나\n\n')
        unseen = {t: v for t, v in fuzzy.items() if not CONFIRMED.get(law, {}).get(t)}
        if unseen:
            fp.write('⚠**아래 고시는 이름이 닮은 파일이 있을 뿐, 그 고시 자체를 찾은 것이 아니다.**\n')
            fp.write('이 분야는 **농산물·수산물·임산물**처럼 한 글자만 다른 이름이 떼로 있다.\n')
            fp.write('닮은 파일을 열어 정말 같은 고시인지 눈으로 확인하기 전에는 "받아 뒀다"고 쓰면 안 된다.\n\n')
            for t in sorted(unseen):
                fp.write(f'- {t} — 닮은 파일: ' + ' · '.join(unseen[t]) + '\n')
            fp.write('\n')
        if missing:
            fp.write('⚠**아래 고시를 raw 에서 못 찾았다.** 그러나 이것이 곧 "안 받았다"는 뜻은 아니다 —\n')
            fp.write('도구는 **다른 이름·다른 판으로 이미 받아 둔 것**과 구별하지 못한다(실측으로 세 번 헷갈렸다).\n')
            fp.write('**하나씩 눈으로 확인한 뒤에만** "안 받았다"고 말할 수 있다.\n')
            fp.write('확인 결과 정말 없으면, 그것을 받기 전에는 이 법에서 "규정이 없다"고 단정하면 안 된다.\n\n')
            for t in missing:
                fp.write(f'- {t}\n')
        elif not unseen:
            fp.write('law.go.kr 이 말하는 위임 행정규칙이 **전부 raw 에 수집돼 있다.**\n')
            fp.write('따라서 이 법의 raw 전문(법률·시행령·시행규칙·위 행정규칙)을 대조해 없으면,\n')
            fp.write('그것은 §6-B-1 ⓑ 가 요구하는 조회를 거친 "없음"이다.\n')
        fp.write('\n⚠이 조회는 **위임 관계가 있는 행정규칙만** 본다. 위임 없이 따로 있는 고시·훈령은 못 잡는다.\n')
    print(f'✅ {law}: 위임 {len(found)}건 · 확인필요 {len(missing)}건 · 유사이름 {len(fuzzy)}건 '
          f'→ {os.path.relpath(out, LEGAL)}')
    return {'law': law, 'found': len(found), 'missing': missing, 'fuzzy': sorted(fuzzy)}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    for law in sys.argv[1:]:
        sweep(law)
