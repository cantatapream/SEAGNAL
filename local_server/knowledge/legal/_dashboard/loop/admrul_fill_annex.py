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
사용법: python3 admrul_fill_annex.py [--dry] [--limit N] [--skip <경로조각>]
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


def main():
    dry = '--dry' in sys.argv
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    skip = sys.argv[sys.argv.index('--skip') + 1] if '--skip' in sys.argv else None

    sv = json.load(open(SURVEY, encoding='utf-8'))
    names = [r['파일'] for r in sv.get('빠짐', [])] + [r['파일'] for r in sv.get('수가모자람', [])]
    touched = Touched('admrul_fill_annex')
    rep = {'쓴파일': [], '이미있어건너뜀': [], '고시못찾음': [], 'ID없음': [], '실패': [], '별표없음': []}
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
            rows0 = []
            for r in (u.get('별표내용') or []):
                rows0.extend(r if isinstance(r, list) else [r])
            # ★가지번호(9의2·9의3)를 잃지 않는다 (2026-08-31 실측).
            #   API 의 `별표번호` 는 **가지번호를 안 준다** — 「위험물 선박운송 기준」은 별표9·별표9의2·
            #   별표9의3 이 셋 다 `별표번호: 0009` 로 온다. 그대로 쓰면 파일 이름이 겹쳐 뒤의 둘이
            #   통째로 사라진다(이미 있으면 건너뛰므로 조용히 없어진다).
            #   ⓐ내용 첫 줄의 `[별표 9의2]` 표기가 가장 확실하고,
            #   ⓑ없으면 `별표키` 뒤 두 자리(000900=본, 000902=의2, 000903=의3)로 만든다.
            head0 = str(rows0[0]) if rows0 else ''
            m0 = re.match(r'\s*\[?\s*(별표|별지|서식)\s*제?\s*(\d+)(?:\s*의\s*(\d+))?', head0)
            gubun = (u.get('별표구분') or (m0.group(1) if m0 else '별표')).strip()
            if m0:
                no = m0.group(2) + ('의' + m0.group(3) if m0.group(3) else '')
            else:
                base_no = str(u.get('별표번호') or '').lstrip('0') or '1'
                bkey = str(u.get('별표키') or '')
                br = bkey[-2:] if len(bkey) >= 3 else ''
                no = base_no + ('의' + str(int(br)) if br.isdigit() and int(br) > 1 else '')
            key = ('별표' if gubun == '별표' else '별지') + no
            fn = f"{safe(gosi)}_{key}.txt"
            out = os.path.join(byldir, fn)
            if os.path.exists(out):
                rep['이미있어건너뜀'].append(fn)
                continue
            rows = rows0
            head = (f"[{gosi}] {key} — {(u.get('별표제목') or '').strip()}\n"
                    f"출처: 국가법령정보센터 행정규칙 API target=admrul ID={aid} (수집 2026-08-31)\n")
            link = u.get('별표서식PDF파일링크')
            if link:
                head += f"별표서식PDF파일링크: {link}\n"
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
