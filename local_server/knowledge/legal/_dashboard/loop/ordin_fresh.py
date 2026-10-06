#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-78(b) 조례 신선도 대조 — 우리가 받아 둔 **자치법규(조례·규칙)** 원문이 지금도 현행판인지 확인한다.

[왜 있나 — 2026-10-06 실측]
  매주 도는 원문 신선도 점검(`services/admrul_fresh_scanner.js`)은 **행정규칙(`admrul_fresh.py`)과
  법률·시행령·시행규칙(`law_fresh.py`)** 만 봤다. 매일 새벽 개정감지(`detect_law_changes.py`)도
  `target=eflaw`·`target=admrul` 만 묻는다. **`target=ordin`(자치법규)을 묻는 정기 점검은 하나도 없었다** —
  `admrul_fresh.py` 는 자치법규로 보이는 것을 오히려 감시에서 빼 두었다.
  그래서 조례 416건을 이름으로 하나씩 현행과 견줘 보니 **12건이 옛 판**(부산 수상레저 2024→2026-09-23 등),
  **2건은 이름이 바뀌어**(전라남도 → 전남광주통합특별시) 현행 목록에 우리 이름이 아예 없었다.

[어떻게 판정하나 — 숫자 비교뿐, AI 판단 없음]
  ① 우리 파일 머리말에서 **이름 · 지자체 · 시행일**을 읽는다(머리말 꼴이 둘이다:
     `지자체: 부산광역시 · 시행 20240925 · …` / `지자체: 경상남도 · 자치법규일련번호(MST): 1698231 · 시행일자: 20220414`).
  ② `lawSearch.do?target=ordin&query=<이름>` 으로 현행 목록을 받아 **이름이 같은 줄**을 고른다.
     ★가운뎃점(`ㆍ`/`·`)이 든 이름은 그대로 물으면 0건이 온다 — 점을 띄어 한 번 더 묻는다(`ordin_recollect.find_mst` 와 같은 길).
     ★같은 이름이 여러 지자체에 있다(강원 고성군 · 경남 고성군) — **`지자체기관명` 이 우리 지자체로 시작하는 줄**만 남긴다.
  ③ 현행 시행일 > 우리 시행일 → `구버전` / 같으면 `현행`.
     현행 시행일이 **오늘보다 뒤**(시행예정)면 결함이 아니다 — `현행` 으로 두고 `pending` 에 참고로 담는다
     (`law_fresh.py` 와 같은 규칙. ⚠한계: 그때는 지금 시행 중인 판을 따로 볼 수 없다).
  ④ 이름으로 못 찾으면 **지자체 머리를 뗀 이름**(「전라남도 수산부산물…」→「수산부산물…」)으로 다시 묻고,
     우리 지자체 폴더와 같은 지자체의 줄을 `이름바뀜의심` 후보로 담는다. **같은 문서라고 단정하지 않는다** —
     사람이 확인한다(관리자 카드의 ①번 할 일). 후보도 없으면 `이름불일치`(확인 못 한 것 — 「이상 없음」이 아니다).
  ⑤ 망이 끊겨 답을 못 받으면 `조회실패` — 끝에서 한 번 더 두들긴다(`law_fresh.py` 두 번째 마디와 같은 이유).

[무엇을 쓰나] `law_fresh.py` 와 **같은 보고서 꼴** — `services/admrul_fresh_scanner.js` 가 세 점검을 한 목록으로 합친다.
  { checked, fresh, stale, unknown, mismatch, renamed, basis_date, rows:[{title, tier:'조례', slug, verdict,
    held_ids, files, current:{serial, issued, no, state}, pending, rename_candidates, wiki_pages}] }
  ⚠읽기 전용 — raw·위키를 고치지 않는다. 다시 받는 것은 `ordin_recollect.py --from-report` 가 한다(사람이 돌린다).

쓰는 법:
    python3 _dashboard/loop/ordin_fresh.py                 # 전수(416건, 수 분)
    python3 _dashboard/loop/ordin_fresh.py --only 부산     # 경로에 그 말이 든 것만
    python3 _dashboard/loop/ordin_fresh.py --out PATH      # 결과 저장 위치
    python3 _dashboard/loop/ordin_fresh.py --gate          # 구버전·이름바뀜의심이 있으면 종료코드 1

[연계] ← raw/_자치법규/<시도>/<이름>/{법률,시행규칙}.txt · law.go.kr DRF(target=ordin)
       → _dashboard/ordin_fresh_report.json(기본) · services/admrul_fresh_scanner.js(관리자 '원문신선도' 방)
       → ordin_recollect.py --from-report(다시 받기)
"""
import concurrent.futures as cf
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'raw')
ORDIN = os.path.join(RAW, '_자치법규')
WIKI = os.path.join(ROOT, 'wiki')
OC = 'hyoo1431'
KST = timezone(timedelta(hours=9))
TIER_FILES = ('법률.txt', '시행규칙.txt')

DATE_RE = re.compile(r'시행(?:일자)?\s*:?\s*(\d{8})')
SIDO_RE = re.compile(r'지자체\s*:\s*([^·\n]+)')
MST_RE = re.compile(r'(?:MST\)?\s*:?\s*|자치법규일련번호\s*)(\d{5,})')
# 이름 앞의 지자체 머리 — 「부산광역시 」「고성군 」「부산광역시 기장군 」. 이름바뀜 후보를 찾을 때만 뗀다.
HEAD_RE = re.compile(r'^(?:\S+(?:특별자치도|특별자치시|특별시|광역시|도)\s+)?(?:\S+(?:시|군|구)\s+)?')


def flat(name):
    """이름을 견주는 한 가지 방법 — `ordin_recollect.flat` 과 같다(가운뎃점 `ㆍ`/`·` 차이를 지운다)."""
    return re.sub(r'[^0-9A-Za-z가-힣]', '', str(name or ''))


def api(url, tries=8):
    """DRF 조회 1회. law.go.kr 은 간헐적으로 끊긴다(L-322). 못 받으면 None(= "없다"가 아니라 "모른다")."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception:                                        # noqa: BLE001
            time.sleep(min(1.2 + 0.6 * i, 5.0))
    return None


def search(q):
    """이름 검색 → 줄 목록. 망 실패면 None."""
    d = api('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&target=ordin&type=JSON&display=100&query=%s'
            % (OC, urllib.parse.quote(q)))
    if not isinstance(d, dict):
        return None
    rows = (d.get('OrdinSearch') or {}).get('law') or []
    return [rows] if isinstance(rows, dict) else rows


def read_head(path):
    """우리 파일 머리말 → (이름, 지자체, 시행일, 일련번호|'').
    예: ('부산광역시 수상레저활동 안전관리 조례', '부산광역시', '20240925', '')"""
    with open(path, encoding='utf-8', errors='replace') as f:
        head = ''.join(f.readline() for _ in range(3))
    first = head.split('\n', 1)[0]
    title = re.sub(r'^\[[^\]]*\]\s*', '', first).strip()
    m = SIDO_RE.search(head)
    sido = re.sub(r'^\(구\)', '', m.group(1).strip()) if m else ''
    d = DATE_RE.search(head)
    k = MST_RE.search(head)
    return title, sido, d.group(1) if d else '', k.group(1) if k else ''


def same_place(row, places):
    """검색 줄의 `지자체기관명` 이 우리 지자체(머리말 · 폴더) 중 하나로 시작하나."""
    org = flat(row.get('지자체기관명'))
    return any(p and org.startswith(flat(p)) for p in places)


def cur_of(r):
    return {'serial': str(r.get('자치법규일련번호') or ''), 'issued': str(r.get('시행일자') or ''),
            'no': str(r.get('공포번호') or ''), 'state': str(r.get('지자체기관명') or '')}


# 우리가 이미 가진 조례 이름 → 파일(flat 이름 열쇠). main() 이 채운다.
#   ★2026-10-06 실측: 「전라남도 수산부산물…」 의 새 이름 「전남광주통합특별시 수산부산물…」 은 **이미 따로 받아 두었다.**
#   그것을 모르고 옛 사본에 새 판을 덮어써 **같은 조례가 두 벌**이 될 뻔했다(되돌렸다). 후보가 이미 우리 것이면 표시한다.
HELD = {}


def judge_one(path, today):
    """파일 하나를 판정한다 → 보고서 줄(dict)."""
    rel = os.path.relpath(path, ROOT)
    folder = os.path.relpath(os.path.dirname(path), ORDIN)          # 예 '부산광역시/부산광역시수상레저활동안전관리조례'
    tier = '조례' if os.path.basename(path) == '법률.txt' else '조례 시행규칙'
    title, sido, mine, mst = read_head(path)
    places = [sido, folder.split('/')[0]]
    row = {'title': title, 'tier': tier, 'slug': folder, 'files': [rel], 'held_ids': [mst] if mst else [],
           'file_eff': mine, 'current': None, 'pending': [], 'verdict': '조회실패'}
    hits, net_ok = [], True
    for q in dict.fromkeys((title, re.sub(r'[·ㆍ・]', ' ', title))):
        rows = search(q)
        if rows is None:
            net_ok = False
            continue
        hits = [r for r in rows if flat(r.get('자치법규명')) == flat(title)]
        if hits:
            break
    if len(hits) > 1:
        hits = [r for r in hits if same_place(r, places)] or hits
    if len(hits) > 1:
        row['verdict'] = '여럿'
        row['note'] = '같은 이름이 지자체 여럿에 있고 우리 지자체로 가르지 못했다: ' + ' / '.join(
            '%s(%s)' % (r.get('지자체기관명'), r.get('시행일자')) for r in hits)
        return row
    if hits:
        cur = cur_of(hits[0])
        if cur['issued'] > today:
            row['pending'] = [cur]
            row['verdict'] = '현행' if mine else '조회실패'
            row['note'] = '현행 목록의 판이 시행예정(%s)이다 — 지금 시행 중인 판과는 따로 견주지 못했다.' % cur['issued']
            return row
        row['current'] = cur
        if not mine:
            row['verdict'] = '이름불일치'
            row['note'] = '우리 머리말에 시행일이 없어 견주지 못했다.'
        else:
            row['verdict'] = '구버전' if cur['issued'] > mine else '현행'
        return row
    if not net_ok:
        return row                                                    # 조회실패 — 끝에서 다시 두들긴다
    # ④ 이름으로 없다 → 지자체 머리를 뗀 이름으로 후보를 찾는다(단정하지 않는다).
    core = HEAD_RE.sub('', title).strip()
    cands = []
    if core and core != title:
        rows = search(core)
        if rows is None:
            return row
        # 이름에 시·군·구가 있으면 후보도 **그 시·군·구**여야 한다 — 「고성군 어항관리 조례」를 강원 양양군 것과 잇지 않는다.
        gu = re.findall(r'(\S+(?:시|군|구))\s', title[:len(title) - len(core)] + ' ')
        cands = [r for r in rows if flat(r.get('자치법규명')).endswith(flat(core)) and same_place(r, places)
                 and (not gu or flat(r.get('지자체기관명')).endswith(flat(gu[-1])))]
    if cands:
        row['verdict'] = '이름바뀜의심'
        row['rename_candidates'] = [{'name': r.get('자치법규명'), 'serial': str(r.get('자치법규일련번호') or ''),
                                     'issued': str(r.get('시행일자') or ''), 'org': r.get('지자체기관명'),
                                     # ★후보가 아직 시행 전이면 표시한다 — 지금 시행 중인 판이 아니다(다시 받기가 막는다).
                                     'future': str(r.get('시행일자') or '') > today,
                                     'held_as': HELD.get(flat(r.get('자치법규명')), '')}
                                    for r in cands[:5]]
        held = [c['held_as'] for c in row['rename_candidates'] if c['held_as']]
        if held:
            # 새 이름 조례가 이미 있다 = 이 옛 사본은 **폐지된 옛 조례**일 공산이 크다(통합 조례 부칙이 옛 조례를 폐지한다).
            #   다시 받을 것이 아니다 — 옛 사본을 어떻게 둘지(폐지 표기·지우기)는 사람이 정한다(G-34).
            row['superseded_by'] = held[0]
            row['note'] = '새 이름 조례가 이미 우리에게 있다: %s — 이 옛 사본은 다시 받지 않는다(두 벌이 된다).' % held[0]
    else:
        row['verdict'] = '이름불일치'
        row['note'] = '이 이름으로 현행 목록에 없고, 같은 지자체에 비슷한 이름도 없다 — 폐지됐을 수 있다(확인 못 함).'
    return row


def wiki_pages_for(rows):
    """구버전·이름바뀜의심 줄마다 그 원문을 부르는 위키 쪽(폴더 이름 또는 조례 이름이 든 쪽)."""
    need = [r for r in rows if r['verdict'] in ('구버전', '이름바뀜의심')]
    if not need:
        return
    texts = {}
    for p in glob.glob(os.path.join(WIKI, '**', '*.md'), recursive=True):
        try:
            texts[os.path.relpath(p, ROOT)] = open(p, encoding='utf-8').read()
        except Exception:                                        # noqa: BLE001
            pass
    for r in need:
        leaf = r['slug'].split('/')[-1]
        r['wiki_pages'] = sorted(k for k, t in texts.items() if leaf in t or r['title'] in t)


def main():
    argv = sys.argv[1:]
    only = argv[argv.index('--only') + 1] if '--only' in argv else None
    out_path = (argv[argv.index('--out') + 1] if '--out' in argv
                else os.path.join(ROOT, '_dashboard', 'ordin_fresh_report.json'))
    today = datetime.now(KST).strftime('%Y%m%d')
    every = sorted(p for p in glob.glob(os.path.join(ORDIN, '*', '*', '*.txt')) if os.path.basename(p) in TIER_FILES)
    for p in every:
        HELD.setdefault(flat(read_head(p)[0]), os.path.relpath(p, ROOT))
    files = [p for p in every if not only or only in p]
    print('■ 조례 신선도 대조 — 우리 사본의 시행일과 현행을 맞춰 본다 (기준일 %s KST) · 대상 %d건'
          % (today, len(files)), flush=True)
    rows = []
    with cf.ThreadPoolExecutor(6) as ex:
        for i, r in enumerate(ex.map(lambda p: judge_one(p, today), files), 1):
            rows.append(r)
            if i % 50 == 0 or i == len(files):
                print('   … %d/%d' % (i, len(files)), flush=True)
    # 두 번째 마디 — 조회실패만 천천히 다시(`law_fresh.py` 와 같은 이유: 그 순간 망이 끊긴 것이 대부분이다).
    for i, r in enumerate(rows):
        if r['verdict'] == '조회실패' and not r['pending']:
            r2 = judge_one(os.path.join(ROOT, r['files'][0]), today)
            if r2['verdict'] != '조회실패':
                r2['2차에_열렸다'] = True
            rows[i] = r2
    wiki_pages_for(rows)
    for r in rows:
        if r['verdict'] != '현행':
            print('  %s  %s  (우리 %s → 현행 %s)' % (r['verdict'], r['slug'], r['file_eff'] or '?',
                                                ((r.get('current') or {}).get('issued')) or '-'), flush=True)
    cnt = lambda v: sum(1 for r in rows if r['verdict'] == v)
    rep = {'checked': len(rows), 'fresh': cnt('현행'), 'stale': cnt('구버전'), 'renamed': cnt('이름바뀜의심'),
           'mismatch': cnt('이름불일치') + cnt('여럿'), 'unknown': cnt('조회실패'),
           '2차에_열린_줄': sum(1 for r in rows if r.get('2차에_열렸다')),
           'basis_date': today, 'rows': rows}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print('\n현행 %d / 구버전 %d / 이름바뀜의심 %d / 이름불일치·여럿 %d / 조회실패 %d (총 %d) -> %s'
          % (rep['fresh'], rep['stale'], rep['renamed'], rep['mismatch'], rep['unknown'], len(rows),
             os.path.relpath(out_path, ROOT)))
    if '--gate' in argv and (rep['stale'] or rep['renamed']):
        sys.exit(1)


if __name__ == '__main__':
    main()
