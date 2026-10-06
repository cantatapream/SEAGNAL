#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-43 — 조 머리줄(`[제N조]`) 이 하나도 없는 자치법규 원문을 **다시 받아** 제 꼴로 바꾼다.

[무엇이 문제였나] V5-31(`article_head_missing_gate.js`)이 `raw/_자치법규` 에서 **19개**를 짚었다.
  본문에 평문 `제N조(…)` 는 있는데 `[제N조]` 머리줄이 하나도 없어
  `article_text.js` 의 `extractArticleBlock` 이 **한 조도 못 연다**. 눌러도 안 열린다.

[왜 손으로 안 끼우나] `raw/` 는 불변이고(규약), 무엇보다 **머리줄을 손으로 끼우는 순간
  「원문 그대로」가 깨진다.** 조 경계를 내가 정하게 되기 때문이다 — 조문 안의 타법 인용
  (`「○○조례」 제7조에 따라`)을 새 조로 오인할 수 있다(`ordin_to_folder.py` 머리말 참조).
  그래서 **다시 받아서**, 이미 있는 **운영 변환기를 그대로 부른다**(L-136).

[자는 하나만 쓴다 — 뿌리 사슬 ⑥] 대상 목록을 여기서 다시 세지 않는다.
  `article_head_missing_gate.js` 의 `find()` 를 **node 로 불러** 그대로 받는다.
  여기서 따로 세면 자가 둘이 되고, 값이 갈리는 순간 무엇이 맞는지 아무도 모른다.

[무엇을 지키나]
  · **머리말은 글자 그대로 옮긴다.** ⚠REVIEW·수집 사유 메모는 **왜 받았는지의 증거**다 —
    지우지 않는다(저장소 관례: 옛 서술을 지우지 않고 정정만 붙인다).
  · 조문 본문은 DRF 가 준 `조내용` 을 그대로 쓴다. 정규식으로 잘라내지 않는다.
  · **다시 받은 판이 예전 판과 다를 수 있다.** 그래서 조 번호 집합과 시행일을 견줘
    **바뀐 것을 전부 보고한다**(조용히 덮어쓰지 않는다).
  · ★**조문 뒤에 붙은 손일(별표 전사·대조 메모)은 잃지 않는다.** 19개를 먼저 재 보니
    둘이 그런 것을 갖고 있었다 — `울릉군제증명수수료징수조례` 의 **별표1 hwp→html 전사 15줄**,
    `제주특별자치도사무전결처리규칙` 의 **별표2 엑셀 직접 대조 메모 6줄**.
    이것은 **다시 받아서 나오지 않는다**(첨부파일을 손으로 변환한 결과다).
    그냥 받아 덮었으면 **되찾을 수 없는 것을 지울 뻔했다.**
    → 조문 뒤 꼬리 중 **부칙이 아닌 것**은 글자 그대로 새 파일 끝에 옮겨 붙인다.

쓰는 법:
    python3 _dashboard/loop/ordin_recollect.py            # 무엇을 받아 어떻게 바꿀지만 보여준다
    python3 _dashboard/loop/ordin_recollect.py --apply    # 실제로 받아 쓴다
    python3 _dashboard/loop/ordin_recollect.py --only 울릉군   # 이름에 그 말이 든 것만

[연계] → `raw/_자치법규/**` · `_dashboard/law_raw_paths.json`
        ← `article_head_missing_gate.js`(대상 목록) · `ordin_to_folder.py`(변환기 `convert`)
        ← `_touched.py`(되돌리기 기록)
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                     # noqa: E402
from ordin_to_folder import convert                              # noqa: E402  ★운영 변환기를 그대로 부른다

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
ORDIN = os.path.join(RAW, '_자치법규')
CATALOG = os.path.join(ORDIN, '_ordin_catalog.json')
PATHS_JSON = os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json')
GATE = os.path.join(HERE, 'article_head_missing_gate.js')
# 한 번 찾은 MST 는 적어 둔다 — 망이 간헐적이라(L-322) 같은 검색을 두 번 하지 않기 위해서다.
MST_CACHE = os.path.join(HERE, 'baseline', 'ordin_mst.json')
OC = 'hyoo1431'

# 본문이 시작되는 자리 — 평문 조 머리(`제1조(`) 또는 원시 필드 덤프의 `000000` 줄.
BODY_LINE_RE = re.compile(r'^(?:제\d+조(?:의\d+)?\(|0{6,}$)')
MST_RE = re.compile(r'MST=(\d+)')
SERIAL_RE = re.compile(r'자치법규일련번호\s*(\d+)')
ART_NO_RE = re.compile(r'(?:^|\n)제(\d+)조(?:의(\d+))?\(')
ART_LINE_RE = re.compile(r'^제\d+조(?:의\d+)?\(')
BUCHIK_LINE_RE = re.compile(r'^부\s*칙')
HEAD_NO_RE = re.compile(r'(?m)^\[제(\d+)조(?:의(\d+))?\]')


def api(url, tries=25):
    """law.go.kr 은 막힌 것이 아니라 **간헐적**이다(L-322). 재시도를 붙이면 열린다."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception as e:                                   # noqa: BLE001
            last = e
            time.sleep(min(1.2 + 0.4 * i, 6.0))
    print('      ⚠%d회 다 실패: %s' % (tries, last))
    return None


def targets():
    """대상 목록을 **게이트에게 묻는다**(자를 둘로 만들지 않는다)."""
    out = subprocess.run(
        ['node', '-e', "console.log(JSON.stringify(require(%r).find()))" % GATE],
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def split_head(text):
    """머리말과 본문을 가른다. 본문 첫 줄을 못 찾으면 (전체, '') 로 돌려준다."""
    lines = text.split('\n')
    for i, ln in enumerate(lines):
        if BODY_LINE_RE.match(ln.strip()):
            return '\n'.join(lines[:i]).rstrip(), '\n'.join(lines[i:])
    return text.rstrip(), ''


def split_tail(body):
    """조문 뒤에 남은 것을 가른다 → (부칙꼴 줄, 그 밖의 꼬리).

    **그 밖의 꼬리**가 손일이다 — 별표 전사·대조 메모. 다시 받아도 안 나온다.
    부칙은 DRF 가 다시 주므로 굳이 두 벌 남기지 않는다(단, 새 부칙이 비면 옛것을 남긴다).
    """
    lines = body.split('\n')
    last = max([i for i, ln in enumerate(lines) if ART_LINE_RE.match(ln.strip())], default=-1)
    buchik, rest = [], []
    for ln in lines[last + 1:]:
        t = ln.strip()
        # 원시 필드 덤프의 찌꺼기(`Y`/`N`·숫자만 있는 줄)는 손일이 아니다 — 버린다.
        if re.fullmatch(r'[YN]|\d+', t):
            continue
        (buchik if BUCHIK_LINE_RE.match(t) else rest).append(ln)
    return '\n'.join(buchik).strip(), '\n'.join(rest).strip()


def flat(name):
    """이름을 견주는 **한 가지 방법**만 쓴다 — 뿌리 사슬 ⑥.

    law.go.kr 은 가운뎃점을 `ㆍ`(U+318D) 로 쓰고 우리 파일은 `·`(U+00B7) 로 적은 곳이 있다.
    안 씻고 견주면 **같은 조례를 못 찾는다**(실측: 인천광역시 각종 위원회…조례).
    한글·숫자·영문만 남기고 나머지는 전부 떤다.
    """
    return re.sub(r'[^0-9A-Za-z가-힣]', '', name)


def find_mst(head, name, catalog, cache):
    m = MST_RE.search(head) or SERIAL_RE.search(head)
    if m:
        return m.group(1), '머리말'
    key = flat(name)
    if key in cache:
        return cache[key], '적어 둔 것'
    for rows in catalog.values():
        for r in rows:
            if flat(r.get('명', '')) == key:
                # ★목록의 `ID` 는 **자치법규ID** 다 — `MST=`(자치법규일련번호)로 부르면 「일치하는 자치법규가
                #   없습니다」가 온다(2026-10-06 실측 8곳 · 3-77). `ID=` 로 한 번 불러 **현행 일련번호**로 바꿔 준다.
                #   못 바꾸면 이 길을 쓰지 않고 아래 이름 검색으로 넘어간다(틀린 번호를 돌려주지 않는다).
                d = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=ordin&type=JSON&ID=%s'
                        % (OC, r['ID']))
                b = list(d.values())[0] if isinstance(d, dict) and d else None
                serial = str(((b or {}).get('자치법규기본정보') or {}).get('자치법규일련번호') or '') if isinstance(b, dict) else ''
                if serial:
                    cache[key] = serial
                    return serial, '목록(_ordin_catalog) ID→현행 일련번호'
                break
    # ★가운뎃점이 든 이름은 **그대로 물으면 0건**이 온다(실측: 인천광역시 각종 위원회의 설치·운영…).
    #   답이 없는 게 아니라 **묻는 말이 안 먹힌 것**이다 — 점을 띄어쓰기로 바꿔 한 번 더 묻는다.
    for q in (name, re.sub(r'[·ㆍ・]', ' ', name)):
        d = api('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&target=ordin&type=JSON&display=100&query=%s'
                % (OC, urllib.parse.quote(q)))
        rows = ((d or {}).get('OrdinSearch', {}) or {}).get('law') or []
        if isinstance(rows, dict):
            rows = [rows]
        for r in rows:
            if flat(str(r.get('자치법규명', ''))) == key:
                cache[key] = str(r.get('자치법규일련번호'))
                return cache[key], '검색'
        if q != name:
            break
    return None, '못 찾음'


def _label(a, b):
    return '제%s조의%s' % (a, b) if b else '제%s조' % a


def arts_old(body):
    return {_label(a, b) for a, b in ART_NO_RE.findall(body)}


def arts_new(text):
    return {_label(a, b) for a, b in HEAD_NO_RE.findall(text)}


def title_of(head):
    """머리말 첫 줄 `[조례] 울릉군 제증명 수수료 징수 조례` 에서 이름만 뽑는다."""
    first = head.split('\n', 1)[0]
    return re.sub(r'^\[[^\]]*\]\s*', '', first).strip()


def dest_of(src):
    """납작한 `<시도>/<이름>.txt` 는 `<시도>/<이름>/법률.txt` 로 간다(`ordin_to_folder` 와 같은 규칙)."""
    if os.path.basename(src) in ('법률.txt', '시행규칙.txt'):
        return src
    return os.path.join(src[:-4], '법률.txt')


def fix_paths(apply_):
    """`law_raw_paths.json` 에 자치법규 폴더 이름을 채운다(망이 필요 없다).

    납작한 `<시도>/<이름>.txt` 를 폴더로 옮기면 **이름표가 없어 챗봇이 못 찾는다** —
    `ordin_to_folder.py --paths` 가 하던 일과 같은 규칙이다(기존 항목은 손대지 않는다).
    """
    m = json.load(open(PATHS_JSON, encoding='utf-8'))
    repo = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
    add = []
    for sido in sorted(os.listdir(ORDIN)):
        d = os.path.join(ORDIN, sido)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            f = os.path.join(d, name)
            if os.path.isdir(f) and name not in m:
                add.append((name, os.path.relpath(f, repo)))
    print('이름표가 없는 자치법규 폴더 %d개' % len(add))
    for k, v in add:
        print('  ＋%s → %s' % (k, v))
    if apply_ and add:
        for k, v in add:
            m[k] = v
        json.dump(m, open(PATHS_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        t = Touched('ordin_recollect_paths')
        t.add(PATHS_JSON)
        t.save()
        print('law_raw_paths.json 에 %d개를 넣었다(기존 항목은 손대지 않았다).' % len(add))
    return 0


def run():
    apply_ = '--apply' in sys.argv
    if '--paths' in sys.argv:
        return fix_paths(apply_)
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    catalog = json.load(open(CATALOG, encoding='utf-8')) if os.path.exists(CATALOG) else {}
    cache = json.load(open(MST_CACHE, encoding='utf-8')) if os.path.exists(MST_CACHE) else {}
    rows = targets()
    if only:
        rows = [r for r in rows if only in r['파일']]
    print('대상 %d개 (게이트 V5-31 이 짚은 것 그대로)' % len(rows))
    touched = Touched('ordin_recollect') if apply_ else None
    done = failed = 0
    for r in rows:
        src = os.path.join(RAW, r['파일'])
        text = open(src, encoding='utf-8').read()
        head, body = split_head(text)
        old_buchik, keep = split_tail(body)
        name = title_of(head)
        mst, how = find_mst(head, name, catalog, cache)
        print('\n· %s' % r['파일'])
        print('    이름=%s  MST=%s (%s)' % (name, mst, how))
        if not mst:
            failed += 1
            continue
        d = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=ordin&type=JSON&MST=%s' % (OC, mst))
        if not d:
            failed += 1
            continue
        b = (d.get('LawService') or d.get('OrdinService') or {})
        info = b.get('자치법규기본정보') or {}
        jo = b.get('조문')
        if not jo:
            print('    ⚠조문이 안 왔다 — 손대지 않는다')
            failed += 1
            continue
        got = '%s\n\n%s' % (head, str(jo))
        buchik = b.get('부칙')
        if buchik:
            got += '\n부칙: %s' % (str(buchik) if not isinstance(buchik, str) else buchik)
        new = convert(got)
        if new is None:
            print('    ⚠변환기가 못 읽었다 — 손대지 않는다')
            failed += 1
            continue
        # ★손일을 잃지 않는다 — 새 부칙이 비면 옛 부칙도 되살린다.
        extra = []
        if keep:
            extra.append('')
            extra.append('--- 아래는 다시 받기(%s) 전 파일에 사람이 적어 둔 것을 글자 그대로 옮긴 것이다 ---'
                         % time.strftime('%Y-%m-%d'))
            extra.append(keep)
        if old_buchik and '[부칙]' not in new:
            extra.append('')
            extra.append(old_buchik)
        if extra:
            new = new.rstrip() + '\n' + '\n'.join(extra) + '\n'
        if keep:
            print('    ✅손일 %d줄을 그대로 옮겼다 (다시 받아도 안 나오는 것)' % len(keep.split('\n')))
        old_set, new_set = arts_old(body), arts_new(new)
        key = lambda x: [int(n) for n in re.findall(r'\d+', x)]
        gone, added = sorted(old_set - new_set, key=key), sorted(new_set - old_set, key=key)
        print('    조: 예전 평문 %d개 → 새 머리줄 %d개' % (len(old_set), len(new_set)))
        if gone:
            print('    ⚠예전에 있었는데 새 판에 없는 조: %s' % ', '.join(gone[:12]))
        if added:
            print('    ＋새로 생긴 조: %s' % ', '.join(added[:12]))
        sido = str(info.get('시행일자') or '')
        m_old = re.search(r'시행\s*(\d{8})', head)
        if sido and m_old and m_old.group(1) != sido:
            print('    ⚠시행일이 바뀌었다: %s → %s (새 판이다)' % (m_old.group(1), sido))
        dst = dest_of(src)
        if dst != src:
            print('    폴더로 옮긴다: %s' % os.path.relpath(dst, RAW))
        if not apply_:
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'w', encoding='utf-8').write(new)
        touched.add(dst)
        if dst != src:
            os.remove(src)
            touched.add(src)
        done += 1
    json.dump(cache, open(MST_CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    print('\n=== 바꾼 것 %d개 · 못 한 것 %d개 ===' % (done, failed))
    if apply_:
        touched.save()
        print('되돌리기 기록을 남겼다(_touched).')
        print('⚠다음으로 `node _dashboard/loop/article_head_missing_gate.js` 를 다시 돌려 확인한다.')
    return 1 if failed and not rows else 0


if __name__ == '__main__':
    sys.exit(run())
