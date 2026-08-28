#!/usr/bin/env python3
"""위키 **본문이 인용하는 조문이 그 페이지 근거 조문 표에 있는지** 전수로 본다.

[왜 있나 — 2026-08-24, 사서 보고로 드러난 게이트 빈틈]
챗봇은 개념/법령 페이지의 `## 근거 조문` 표에서만 근거를 만든다(§6-E). 그래서 본문에 답이
멀쩡히 적혀 있어도 **표에 그 행이 없으면 챗봇은 그 조문을 꺼내지 못한다.**

실제 사고: 어선안전조업법 statutes 페이지가 2026-08-15 에 제5조·제6조 본문 서술을 추가했는데
표에는 그 두 행이 없었다. **여덟 달 가까이 챗봇이 그 조문을 근거로 인용하지 못했고**, 그 하나
때문에 백로그 항목 8건이 계속 미해소로 남아 있었다.

⚠**있던 게이트로는 이걸 못 잡는다.** `reach_eval.js` 는 "표에 **있는** 행이 뜨는가"를 보고,
`citation_table_scan.js` 는 "표 칸이 규칙에 맞나"를 본다. 둘 다 **표에 없는 것**은 볼 수가 없다.
검사가 통과했다고 빈 곳이 없다는 뜻이 아니었다 — H-45 ③("이 검사가 무엇을 안 보고 있나")이
가리키던 자리다.

[★`by_law` 는 "페이지가 속한 법"이지 "조문이 속한 법"이 아니다]
목록을 법별로 묶는 기준은 **페이지 파일 이름**이다. 그게 배정 단위라서 맞다 — 고쳐야 할 위키가
그 법의 것이기 때문이다. 다만 **본문이 인용한 조문 자체는 다른 법(또는 같은 법 하위법령)의 것일 수
있다.** 그래서 항목마다 `원문` 칸에 *그 조번호가 우리 법 어느 계층에 있고 원문 제목이 무엇인지*를
붙여 둔다. 없으면 `원문없음` 표시가 붙는다 — 다른 법 조문일 가능성이 크다는 뜻이지 결론이 아니다.

[무엇을 세나 — 판정하지 않는다. 위치만 준다]
본문에서 **조문 제목이 붙은 인용**(`제71조(안전한 속력)`)을 모아, 그 페이지 근거 조문 표의
조문과 맞춰 본다. 표 어디에도 없으면 후보로 올린다.

[규칙을 왜 이만큼 좁혔나 — 실측으로 단계마다 재고 표본을 눈으로 봤다(L-189)]
  · 조문 표기 전부            → 11,910건 (표 있는 페이지 1,280개 중 1,131개에서 검출)
    쓸모없다. 스치듯 언급한 타법 조문·설명 문맥이 대부분이었다.
  · 조문 **제목이 붙은** 것만  → 1,490건
  · concepts·statutes 로 한정  →   979건   (annexes 는 원래 조문 번호를 나열하는 문서다)
  · 인용문(`>`)·기록 줄 제외   →   802건
표본을 단계마다 눈으로 봤고, 마지막 단계에서는 대부분이 진짜 빈틈이었다
(예: 해상교통안전법 페이지가 제71조(안전한 속력) 조문 내용을 본문에 옮겨 놓고 표에는 안 넣었다).

⚠**그래도 결함 목록이 아니라 확인 목록이다.** 남은 오탐이 있다 — 다른 법 조문을 이 법 이름
없이 언급한 경우 등. **자동으로 고치지 않는다.** 사람(사서)이 보고 `cite_row.js` 로 넣을지 정한다.
그 도구가 ①원문에 그 조가 진짜 있나 ②챗봇이 꺼낼 수 있나 를 넣기 전에 확인해 준다(§8-A ⓪).

[★사서의 판정을 기억한다 — 2026-08-27 신설, 사용자 지적으로 만듦]
종전에는 사서가 "이건 오탐이다"라고 걸러 낸 항목이 **다음 라운드에 그대로 다시 올라왔다.**
백로그 중복등록과 같은 뿌리다 — 항목에 고정 번호가 없어 같은 것인지 알아볼 수가 없었다.
이제 항목마다 `id`(페이지+조문으로 만든 고정 번호)와 `fp`(그 본문 줄의 지문)를 붙이고,
판정을 `_dashboard/body_cite_gap_ruled.json` 에 남긴다.

⚠**판정을 기억한다고 영영 숨기는 것이 아니다.** 세 갈래로 나눈다.
  ⓐ '오탐' + 본문 줄 그대로  → 목록에서 뺀다(`--all` 로 다시 볼 수 있다).
  ⓑ '오탐' + 본문 줄이 바뀜  → **다시 올린다.** 판정의 근거였던 문장이 달라졌기 때문이다.
  ⓒ '도구막힘' 등 그 밖      → 계속 보여 주고 지난 판정을 표시한다.
     도구가 고쳐지면 다시 해야 할 것들이라 숨기면 안 된다
     (2026-08-26 `cite_row.js` 부칙 수정이 실제로 그랬다 — 그때 숨겼으면 11건이 영영 묻혔다).
이유가 비었거나 지금 목록에 없는 번호는 **받지 않는다** — 근거 없는 판정이 쌓이지 않게.

[쓰는 법]
  python3 body_cite_gap.py                  → 전수 집계 + 법별 상위(판정된 오탐은 빠진 수)
  python3 body_cite_gap.py --all            → 오탐으로 뺀 것까지 전부
  python3 body_cite_gap.py --law <이름>      → 한 법만
  python3 body_cite_gap.py --json PATH      → 법별 목록 저장(사서에게 배포할 때 쓴다)
  python3 body_cite_gap.py --rule E6-xxxxxxxx --verdict 오탐 --why "이유" --round 3차
  python3 body_cite_gap.py --rule-file <목록.json> --round 3차
      → 목록 파일은 [{"id":"E6-…","verdict":"오탐","why":"이유"}, …] 꼴
[연계] ← wiki/concepts|statutes/*.md   ⚠읽기 전용 — 위키·raw 를 고치지 않는다.
       ↔ _dashboard/body_cite_gap_ruled.json (판정 기록 — 이 파일만 쓴다)
"""
import os
import re
import sys
import json
import glob
import hashlib
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')
RULED = os.path.join(LEGAL, '_dashboard', 'body_cite_gap_ruled.json')

ART = re.compile(r'제(\d{1,3})조(?:의(\d{1,2}))?')
# ★조문 **제목이 붙은** 것만 인용으로 본다. 제목 없이 번호만 스친 것은 대개 상호참조다.
ART_TITLED = re.compile(r'제(\d{1,3})조(?:의(\d{1,2}))?\s*\(([^)]{2,40})\)')
# "제5조부터 제9조까지" 같은 범위 줄은 통째로 뺀다 — 그 안의 번호를 개별로 세면 오탐이 된다.
RANGE = re.compile(r'제\d{1,3}조(?:의\d{1,2})?\s*(?:부터|~|∼|-)\s*제\d{1,3}조')
# 바로 앞에 다른 법 이름이 오면 그 법 조문이다 — 이 페이지 표에 없는 게 정상이다.
OTHER_LAW = re.compile(r'[가-힣]{2,20}법(?:률)?(?:\s*시행령|\s*시행규칙)?\s*[」\]]?\s*$')
# 변경이력·대조 메모 줄은 인용이 아니다.
NOTE = re.compile(r'현행화|재수집|대조|라운드|확인:|changelog|updated:|검증|판정|→\s*제\d')


def key_of(m):
    return '제%s조%s' % (m.group(1), ('의' + m.group(2)) if m.group(2) else '')


def split_page(text):
    """페이지를 (근거 조문 표, 나머지 본문)으로 가른다.

    예: split_page(md) → ('| 단계 | 법령 | …', '# 제목\\n…')
    [연계] `## 근거 조문` 절 안의 파이프 줄만 표로 친다 — 본문 속 다른 표는 본문이다.
    """
    tbl, body, in_sec = [], [], False
    for ln in text.split('\n'):
        h = re.match(r'^##\s+(.*)$', ln)
        if h:
            in_sec = '근거 조문' in h.group(1)
            body.append(ln)
            continue
        (tbl if (in_sec and ln.lstrip().startswith('|')) else body).append(ln)
    return '\n'.join(tbl), '\n'.join(body)


# ★표 칸의 범위·나열 표기를 낱낱의 조문으로 편다(2026-08-24 신설, 같은 날 **좁혀 다시 씀**).
#
#   [왜] 표에 `제111~118조` 라 적혀 있어도 제112~117조가 "표에 없다"고 잡혔다.
#   실측: 해상교통안전법 사서가 57건 중 53건(93%)을 "이미 표에 범위로 있음"으로 걸러 냈다.
#
#   ⚠**어디까지 펼지는 내 취향이 아니라 챗봇 코드가 정한다.** 처음엔 `제N조~제M조`·`제5조부터
#   제9조까지` 까지 전부 폈다가 되돌렸다 — 챗봇이 그 꼴을 못 읽기 때문이다. 그걸 폈으면
#   **진짜 도달불가를 "이미 있음"으로 덮어** 결함을 숨겼을 것이다(사서 보고가 엇갈려 코드를 직접 봤다).
#
#   챗봇이 실제로 펴는 것만 편다 — `services/legal_retriever.js` 확인 결과:
#     ⓐ filterCitationChainByAnswer 의 범위 갈래 : /제(\d+)\s*[~∼]\s*(\d+)조/
#        → `제111~118조` · `전문(제1~12조)` 는 편다.  `제111조~제118조` 는 **안 편다**(정규식 불일치).
#     ⓑ expandJoEnum : **가운뎃점이 반드시 있어야** 한다
#        (`!/[·ㆍ・,]/.test(s) → return null`). 그래서 `제3·7·9조` · `제9·11·18~21조` 는 펴지만,
#        가운뎃점 없는 순수 범위는 이쪽으로는 안 펴진다(그건 ⓐ가 받는다).
#   ★챗봇 쪽 정규식이 바뀌면 여기도 같이 바꿔야 한다. 안 그러면 이 검사가 조용히 어긋난다.
RANGE_TILDE = re.compile(r'제(\d{1,3})\s*[~∼]\s*(\d{1,3})조')     # ⓐ 챗봇과 같은 꼴
LIST_MID = re.compile(r'제(\d{1,3}(?:\s*[·ㆍ・,]\s*\d{1,3})+)조')   # ⓑ 가운뎃점 나열


def table_articles(tbl):
    """표 칸이 **챗봇 기준으로** 실제로 덮는 조문 번호 집합.

    예: table_articles('| 법 | 제111~118조 |') → {'제111조', …, '제118조'}
    @param {str} tbl `## 근거 조문` 표 부분
    @returns {set[str]}
    [연계] scan() 이 "이 조문이 이미 표에 있나"를 판단하는 근거.
           ⚠`제N조~제M조` 꼴은 일부러 안 편다 — 챗봇이 못 읽으므로 그건 **진짜 도달불가**다.
    """
    have = {key_of(m) for m in ART.finditer(tbl)}
    for m in RANGE_TILDE.finditer(tbl):
        a, b = int(m.group(1)), int(m.group(2))
        if a <= b and b - a <= 200:              # 뒤집힌 표기·오타로 폭주하지 않게
            have |= {'제%d조' % n for n in range(a, b + 1)}
    for m in LIST_MID.finditer(tbl):
        for n in re.findall(r'\d{1,3}', m.group(1)):
            have.add('제%s조' % n)
    return have


def scan(path):
    """한 페이지의 후보 목록. 표가 없거나 표에 조문이 없으면 빈 목록(다른 문제다)."""
    text = open(path, encoding='utf-8').read()
    if '## 근거 조문' not in text:
        return []
    tbl, body = split_page(text)
    have = table_articles(tbl)
    if not have:
        return []
    out, seen = [], set()
    for ln in body.split('\n'):
        s = ln.lstrip()
        if RANGE.search(ln) or NOTE.search(ln) or s.startswith('>'):
            continue
        for m in ART_TITLED.finditer(ln):
            k = key_of(m)
            if k in have or k in seen:
                continue
            if OTHER_LAW.search(ln[:m.start()][-30:].strip()):
                continue
            seen.add(k)
            out.append({'article': k, 'title': m.group(3)[:40], 'line': ln.strip()[:160]})
    return out


def item_id(page_rel, article):
    """항목의 **고정 번호**. 같은 페이지·같은 조문이면 라운드가 바뀌어도 같은 번호가 나온다.

    예: item_id('wiki/statutes/항만법.md', '제5조') → 'E6-3f9a1c22'
    [연계] 사서의 '오탐' 판정을 이 번호로 기억한다(body_cite_gap_ruled.json).
           ⚠본문 줄이 바뀌면 판정이 더는 안 맞을 수 있어, 줄지문을 따로 함께 저장한다.
    """
    h = hashlib.sha1((page_rel + '|' + article).encode('utf-8')).hexdigest()
    return 'E6-' + h[:8]


def line_fp(line):
    """본문 줄의 지문 8자. 줄이 고쳐지면 지문이 달라져 판정을 다시 받게 한다."""
    return hashlib.sha1(re.sub(r'\s+', '', line).encode('utf-8')).hexdigest()[:8]


# ── 그 조번호가 **우리 법 원문 어디에** 있는지 (2026-08-27 신설) ─────────────
#
# [왜] 목록의 `by_law` 는 **페이지가 속한 법**이다(그게 배정 단위라 맞다). 그런데 본문이 인용한
#   조문은 **같은 번호의 하위법령 조문이거나 아예 다른 법 조문**인 경우가 많다.
#   실측(현재 247건): 그 조번호가 우리 법 raw 에 아예 없는 것이 108건이었다.
#   사서는 그걸 하나하나 원문을 열어 확인해야 했고, 2차 오탐 124건의 상당수가 이 유형이었다.
#
# ⚠**판정하지 않는다. 원문에서 읽어 온 사실만 붙인다.**
#   본문 괄호 안의 제목은 위키 작성자가 풀어 쓴 말이라 원문 제목과 자주 다르다
#   (실측: 제목까지 똑같은 것은 247건 중 23건뿐). 그래서 **제목으로 맞히려 들지 않고**,
#   그 조번호가 우리 법 어느 계층에 있고 원문 제목이 무엇인지를 그대로 보여 준다.
#   "우리 법에 없다"도 숨기는 근거로 쓰지 않는다 — 표시만 하고 목록에는 남긴다.
RAW = os.path.join(LEGAL, 'raw')
_RAW_CACHE = {}
ART_BRACKET = re.compile(r'^\[(제\d+조(?:의\d+)?)\]\s*(.*?)\s*(?:\(시행|$)')
ART_PLAIN = re.compile(r'^(제\d+조(?:의\d+)?)\s*\(([^)]{1,60})\)')


def raw_articles(slug):
    """그 법 raw 원문의 {조번호: [(계층, 원문 제목), …]}. 폴더가 없으면 빈 것.

    예: raw_articles('해운법')['제10조'] → [('법률', '사업계획의 변경')]
    [연계] scan_all() 이 항목마다 `원문` 칸을 채우는 데 쓴다. 읽기 전용.
    """
    if slug in _RAW_CACHE:
        return _RAW_CACHE[slug]
    out = collections.defaultdict(list)
    dirs = glob.glob(os.path.join(RAW, '*', slug))
    if dirs:
        d0 = dirs[0]
        for tier in ('법률', '시행령', '시행규칙'):
            for p in sorted(glob.glob(os.path.join(d0, tier + '*.txt'))):
                if os.path.basename(p).startswith('부칙'):
                    continue
                for ln in open(p, encoding='utf-8', errors='replace'):
                    m = ART_BRACKET.match(ln)
                    if m and m.group(2):
                        out[m.group(1)].append((tier, m.group(2)))
        for p in sorted(glob.glob(os.path.join(d0, '행정규칙', '*.txt'))):
            nm = os.path.basename(p)[:-4]
            for ln in open(p, encoding='utf-8', errors='replace'):
                m = ART_PLAIN.match(ln.strip())
                if m:
                    out[m.group(1)].append((nm[:24], m.group(2)))
    _RAW_CACHE[slug] = out
    return out


def load_ruled():
    """이미 판정이 내려진 항목들. 파일이 없으면 빈 것(= 아직 아무 판정도 없다)."""
    try:
        return json.load(open(RULED, encoding='utf-8'))
    except Exception:
        return {}


def save_ruled(d):
    os.makedirs(os.path.dirname(RULED), exist_ok=True)
    json.dump(d, open(RULED, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)


def do_rule(argv):
    """사서의 판정을 기록한다 — `--rule` 하나씩, `--rule-file` 은 한꺼번에.

    예: python3 body_cite_gap.py --rule E6-3f9a1c22 --verdict 오탐 --why "타법 조문을 지나가며 언급" --round 3차
    [연계] 여기 담긴 판정은 다음 라운드 목록에서 빠진다(오탐만 — 도구막힘은 표시만 하고 계속 보여 준다).
    """
    d = load_ruled()
    now = argv[argv.index('--round') + 1] if '--round' in argv else '미기재'
    recs = []
    if '--rule-file' in argv:
        recs = json.load(open(argv[argv.index('--rule-file') + 1], encoding='utf-8'))
    if '--rule' in argv:
        recs.append({'id': argv[argv.index('--rule') + 1],
                     'verdict': argv[argv.index('--verdict') + 1] if '--verdict' in argv else '오탐',
                     'why': argv[argv.index('--why') + 1] if '--why' in argv else ''})
    # 지금 목록에 있는 항목만 받는다 — 없는 번호를 적어 넣으면 조용히 쌓이기만 한다.
    live = {}
    for law, pages in scan_all().items():
        for pg in pages:
            for it in pg['items']:
                live[it['id']] = (law, pg['page'], it['article'], it['fp'])
    ok = bad = 0
    for r in recs:
        i = r.get('id')
        if i not in live:
            print('   ✖ %s — 지금 목록에 없는 번호다(이미 해소됐거나 오타). 건너뛴다.' % i)
            bad += 1
            continue
        law, page, art, fp = live[i]
        if not r.get('why'):
            print('   ✖ %s — 이유가 비었다. 이유 없는 판정은 받지 않는다.' % i)
            bad += 1
            continue
        d[i] = {'판정': r.get('verdict') or '오탐', '이유': r['why'], '라운드': r.get('round') or now,
                '법': law, '페이지': page, '조문': art, '줄지문': fp}
        ok += 1
    save_ruled(d)
    print('판정 %d건 기록 · %d건 거절 → %s' % (ok, bad, os.path.relpath(RULED, LEGAL)))


def scan_all(only=None):
    """전 위키를 훑어 법별 후보를 만든다. 각 항목에 고정 번호(id)와 줄지문(fp)이 붙는다."""
    by_law = collections.defaultdict(list)
    for d in ('concepts', 'statutes'):
        for p in sorted(glob.glob(os.path.join(WIKI, d, '*.md'))):
            base = os.path.basename(p)[:-3]
            law = base.split('__')[0]
            if only and only not in base:
                continue
            hits = scan(p)
            if not hits:
                continue
            rel = os.path.relpath(p, LEGAL)
            arts = raw_articles(law)
            for it in hits:
                it['id'] = item_id(rel, it['article'])
                it['fp'] = line_fp(it['line'])
                found = arts.get(it['article']) or []
                # 같은 계층에서 여러 번 나오는 경우가 있어(발췌본 등) 앞의 넷만 보여 준다.
                it['원문'] = ['%s: %s' % (t, ttl) for t, ttl in found[:4]]
                if not found:
                    it['원문없음'] = '우리 법 raw 에 이 조번호가 없다 — 다른 법 조문일 수 있다(확인 필요)'
            by_law[law].append({'page': rel, 'items': hits})
    return by_law


def main():
    argv = sys.argv[1:]
    if '--rule' in argv or '--rule-file' in argv:
        do_rule(argv)
        return
    only = argv[argv.index('--law') + 1] if '--law' in argv else None
    out_path = argv[argv.index('--json') + 1] if '--json' in argv else None
    show_all = '--all' in argv

    by_law = scan_all(only)
    ruled = load_ruled()

    # ★판정이 있는 항목을 어떻게 다루나 — 세 갈래로 나눈다.
    #   ⓐ '오탐' 이고 본문 줄이 그대로다   → 목록에서 뺀다(다음 라운드에 다시 안 올라온다).
    #   ⓑ '오탐' 인데 본문 줄이 바뀌었다   → 다시 올린다. 판정의 근거였던 문장이 달라졌기 때문이다.
    #   ⓒ '도구막힘' 등 그 밖의 판정      → 계속 보여 주되 표시를 단다.
    #      도구가 고쳐지면 다시 해야 할 것들이라 숨기면 안 된다(2026-08-26 부칙 수정이 실제로 그랬다).
    hidden = reopened = flagged = 0
    for law in list(by_law):
        pages = []
        for pg in by_law[law]:
            keep = []
            for it in pg['items']:
                r = ruled.get(it['id'])
                if not r:
                    keep.append(it)
                    continue
                if r['판정'] == '오탐':
                    if r.get('줄지문') == it['fp'] and not show_all:
                        hidden += 1
                        continue
                    if r.get('줄지문') != it['fp']:
                        it['다시봄'] = '본문 줄이 바뀌었다 — 지난 판정(%s)이 아직 맞는지 확인하라' % r['라운드']
                        reopened += 1
                else:
                    it['지난판정'] = '%s (%s): %s' % (r['판정'], r['라운드'], r['이유'][:60])
                    flagged += 1
                keep.append(it)
            if keep:
                pages.append({'page': pg['page'], 'items': keep})
        if pages:
            by_law[law] = pages
        else:
            del by_law[law]

    total = sum(len(x['items']) for v in by_law.values() for x in v)
    pages = sum(len(v) for v in by_law.values())
    print('■ 본문이 인용하는데 근거 조문 표에 없는 조문 — **확인 목록(판정 아님)**')
    print('   후보 %d건 · 페이지 %d개 · 법 %d개' % (total, pages, len(by_law)))
    print('   ⚠챗봇은 표에서만 근거를 만든다(§6-E). 표에 없으면 본문에 있어도 못 꺼낸다.')
    print('   ⚠남은 오탐이 있다 — 사람이 보고 `cite_row.js` 로 넣을지 정한다. 자동으로 고치지 않는다.')
    if ruled:
        print('   · 지난 라운드에 오탐으로 판정돼 뺀 것 %d건%s' % (hidden, ' (--all 로 함께 본다)' if not show_all else ''))
        if reopened:
            print('   · 오탐이었지만 **본문 줄이 바뀌어 다시 올린 것** %d건' % reopened)
        if flagged:
            print('   · 오탐이 아닌 판정(도구막힘 등)이 달린 것 %d건 — 숨기지 않는다' % flagged)
    else:
        print('   · 아직 기록된 판정이 없다(판정 기록: --rule / --rule-file).')
    # ★그 조번호가 우리 법 원문에 있는지 — 판정이 아니라 사서가 먼저 봐야 할 사실이다.
    nomatch = sum(1 for v in by_law.values() for x in v for it in x['items'] if it.get('원문없음'))
    if total:
        print('   · 그중 **우리 법 raw 에 그 조번호가 아예 없는 것 %d건** — 다른 법 조문일 수 있다.'
              % nomatch)
        print('     (숨기지 않는다. 하위법령·행정규칙에 있을 수도 있어 사람이 봐야 한다.)')
    if by_law:
        print('\n   많은 법 상위 15')
        for law, v in sorted(by_law.items(), key=lambda x: -sum(len(y['items']) for y in x[1]))[:15]:
            n = sum(len(y['items']) for y in v)
            print('     %4d건  %2d페이지  %s' % (n, len(v), law[:50]))
    if out_path:
        json.dump({'total': total, 'pages': pages,
                   'by_law': {k: v for k, v in by_law.items()}},
                  open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n   저장: %s' % out_path)


main()
