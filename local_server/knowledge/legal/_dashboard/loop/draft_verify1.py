#!/usr/bin/env python3
"""초안(draft) 승격 **1차 재점검 — 기계 대조** (_SCHEMA §5-D ⓑ 의 1차).

[왜 있나 — 3-90, 2026-10-08]
  사장님이 초안승인 방에 일괄 승인 버튼을 찾으셨고, §5-D ⓑ-1(일괄 승급 금지)을 지키는 쪽으로
  「작업 세션에서 검증·승격」을 고르셨다. §5-D ⓑ 는 숫자가 든 쪽을 **서로 다른 두 번** 더 본 뒤에만
  올리라고 한다 — 1차는 기계(이 도구), 2차는 만들지도 1차를 돌리지도 않은 **다른 에이전트의 읽기**.
  이 도구는 1차만 한다. **승격하지 않는다** — 판정표만 낸다.

[무엇을 보나 — 쪽마다]
  ① 승격 전제(§5-D ⓐ): `markUnresolvedReview()` 가 [미확인]으로 옮기는 줄이 0개인가 → 호출자가 고른 목록을 받는다.
  ② 그 쪽이 가리키는 `REVIEW-<약칭>-NN` 항목이 대기열(`review_queue.md`)에서 **아직 승인 안 됐으면 보류** —
     배너 예외 때문에 ①에 안 걸려도, 그 쪽이 스스로 「미해소로 draft 유지」라 적어 둔 경우가 있다.
  ③ 판독·OCR·출처미확인 신호(§5-D ⓐ-2)가 있으면 보류.
  ④ 본문의 **숫자로 된 법적 효과**(금액·기간·수량·규격·비율)를 하나씩 뽑아, 그 법의 raw 원문 전체
     (`raw/*/<법>/` 아래 모든 .txt — 법률·령·규칙·별표·행정규칙·_대기)에 **같은 값**이 있는지 본다(EXACT).
     금액은 「3천만원」「3,000만원」「30,000,000원」을 같은 값으로 친다(원 단위 정수로 바꿔 견준다).
     다른 법의 숫자는 그 쪽이 「」 로 이름을 댄 법의 원문까지만 본다 — 그 밖의 법에서 찾아 맞추지 않는다
     (전체 원문에서 찾으면 어떤 숫자든 어딘가에 있어 대조가 무의미해진다).
  변경 이력 표·frontmatter·근거 조문 표의 시행일 칸(YYYY-MM-DD)은 세지 않는다.

[쓰는 법]
  python3 draft_verify1.py <쪽파일목록.json> [--out 판정.json]
    목록은 개념 쪽 파일 이름(확장자 없음) 배열. 개념 쪽이 아니면 「comparisons/이름」 처럼 폴더를 붙인다(1-8).
[연계] ← 3-90 작업 세션(초안 113쪽) · → 2차 에이전트 읽기 · 승격은 사람이 지켜보는 작업 세션이 한다.
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI_ROOT = os.path.join(LEGAL, 'wiki')
WIKI = os.path.join(WIKI_ROOT, 'concepts')
RAW = os.path.join(LEGAL, 'raw')
QUEUE = os.path.join(LEGAL, '_dashboard', 'review_queue.md')

UNITS = ('원', '년', '개월', '월', '일', '시간', '분', '톤', '미터', '센티미터', '밀리미터', '킬로미터', '해리', '노트',
         '킬로그램', '퍼센트', '배', '명', '회', '마력', '킬로와트', '제곱미터', '세제곱미터', '리터', '척')
UNIT_ALIAS = {'m': '미터', 'cm': '센티미터', 'mm': '밀리미터', 'km': '킬로미터', 'kg': '킬로그램', '%': '퍼센트',
              '㎡': '제곱미터', 'm²': '제곱미터', '㎥': '세제곱미터', 'kW': '킬로와트', 'ℓ': '리터', 'L': '리터'}
# ★1-8(2026-10-08) — 판독 신호 낱말은 `_dashboard/ocr_words.json` 한 곳에서 읽는다(promote_guard.js 와 같은 목록).
SIGNALS = tuple(json.load(open(os.path.join(LEGAL, '_dashboard', 'ocr_words.json'), encoding='utf-8'))['낱말'])
CONTACTS = os.path.join(LEGAL, '_dashboard', 'contacts_collected.json')


def won(txt):
    """「3억5천만원」「3,000만원」「30,000,000원」 → 정수 원. 못 읽으면 None."""
    t = txt.replace(',', '').replace(' ', '')
    m = re.fullmatch(r'(?:(\d+)억)?(?:(\d+)천만|(\d+)백만|(\d+)만)?(?:(\d+)천)?(\d+)?원', t)
    if not m or not any(m.groups()):
        return None
    a, cm, bm, mn, ch, rest = m.groups()
    v = 0
    if a: v += int(a) * 10 ** 8
    if cm: v += int(cm) * 10 ** 7
    if bm: v += int(bm) * 10 ** 6
    if mn: v += int(mn) * 10 ** 4
    if ch: v += int(ch) * 1000
    if rest: v += int(rest)
    return v


# 「원」 뒤: 글자가 아니거나 **조사**(「5만원을」「300만원 이하」「30만원으로」)면 금액이다 — 「원장」「원칙」 은 아니다.
#   ★3-91: 조사를 막아 두었더니 원문 「초과 시간당 5만원을 추가한다」(선박평형수법 시행규칙 별표17)를 원문 쪽에서
#   못 읽어, 위키의 맞는 값 「5만원」 이 「원문에 없는 값」 으로 나왔다.
_JOSA = r'(?:을|를|이|은|는|으로|에|의|과|와|까지|씩|도|만|부터|에서|이하|이상|미만|초과|이내|정도|씩을)'
MONEY = re.compile(r'\d[\d,]*(?:\.\d+)?\s*(?:억\s*(?:\d[\d,]*\s*)?)?(?:천만|백만|만)?\s*(?:\d[\d,]*\s*천)?\s*원(?:(?![가-힣])|(?=' + _JOSA + r'))')
QTY = re.compile(r'(\d[\d,]*(?:\.\d+)?)\s*(개월|년|월|일|시간|분|톤|미터|센티미터|밀리미터|킬로미터|해리|노트|킬로그램|퍼센트|배|명|회|마력|킬로와트|제곱미터|세제곱미터|리터|척|m²|㎡|㎥|kW|km|cm|mm|kg|m|%|ℓ)(?![가-힣a-zA-Z])')
DATE = re.compile(r'\d{4}\s*[-.년]\s*\d{1,2}\s*[-.월]\s*\d{1,2}\s*일?')


def values(text):
    """본문에서 숫자로 된 법적 효과를 뽑는다 → [(종류, 정규값, 원래 글자)]"""
    out = []
    t = DATE.sub(' ', text)
    for m in MONEY.finditer(t):
        v = won(m.group(0))
        if v is not None and v > 0:
            out.append(('금액', v, m.group(0).strip()))
    t2 = MONEY.sub(' ', t)
    for m in QTY.finditer(t2):
        n = m.group(1).replace(',', '')
        u = UNIT_ALIAS.get(m.group(2), m.group(2))
        if u == '월':            # 「3월」 은 달 이름일 수 있다 — 기간이면 「개월」 로 쓴다
            continue
        if u == '년' and len(n) == 4 and 1900 <= int(n) <= 2100:   # 「2022년」 은 연도(시점)지 법적 효과가 아니다
            continue
        out.append(('수량', (n, u), m.group(0).strip()))
    return out


def body_of(md):
    """frontmatter·변경 이력 표·인용 블록의 승격 기록을 뺀 본문."""
    md = re.sub(r'\A---\n.*?\n---\n', '', md, flags=re.S)
    i = md.find('\n## 변경 이력')
    if i >= 0:
        md = md[:i]
    return md


_RAW_CACHE = {}
_NAME2SLUG = None


def name2slug():
    """「법령명」(띄어쓰기 뺀 것) → raw 폴더 slug. _meta.json 의 법령명과 폴더 이름 둘 다 받는다."""
    global _NAME2SLUG
    if _NAME2SLUG is None:
        _NAME2SLUG = {}
        for d in glob.glob(os.path.join(RAW, '*', '*')):
            if not os.path.isdir(d):
                continue
            slug = os.path.basename(d)
            _NAME2SLUG[slug] = slug
            try:
                nm = json.load(open(os.path.join(d, '_meta.json'), encoding='utf-8')).get('법령명') or ''
                if nm:
                    _NAME2SLUG[re.sub(r'\s', '', nm)] = slug
            except Exception:
                pass
    return _NAME2SLUG


def cited_slugs(md):
    """쪽이 「」 로 인용한 법의 raw slug 들 — 「○○법 시행령」 은 ○○법 폴더로 간다."""
    out = set()
    m = name2slug()
    for nm in re.findall(r'「([^」]{2,60})」', md):
        k = re.sub(r'\s', '', nm)
        k = re.sub(r'(시행령|시행규칙)$', '', k)
        if k in m:
            out.add(m[k])
    return out


def raw_values(slug):
    if slug in _RAW_CACHE:
        return _RAW_CACHE[slug]
    dirs = glob.glob(os.path.join(RAW, '*', slug))
    money, qty = set(), set()
    for d in dirs:
        for f in glob.glob(os.path.join(d, '**', '*.txt'), recursive=True):
            try:
                t = open(f, encoding='utf-8').read()
            except Exception:
                continue
            for k, v, _ in values(t):
                (money if k == '금액' else qty).add(v)
    _RAW_CACHE[slug] = (money, qty, bool(dirs))
    return _RAW_CACHE[slug]


def queue_open():
    """대기열에서 **아직 사람 판단을 기다리는** REVIEW 항목 id 집합.

    ★1-8(2026-10-08) — 관리자 방과 **같은 규칙 파일**(`_dashboard/review_queue_rules.json`)로 센다.
    종전에는 `- 승인: [x]` 만 닫힘으로 봐서, 관리자 방이 닫힘으로 세는 「해당 없음」·「쪼갬」(하위 카드로 나눈 부모)을
    열린 것으로 셌다 — 3-90 의 「안 풀린 확인 항목」 43쪽이 가리킨 카드 39장 중 관리자 방 기준 대기는 0장이었다.
    카드 경계도 관리자 방(`routes/legal.js parseReviewQueue`)·`human_workload.py` 와 같게 잡는다(REVIEW 가 아닌 `### ` 가 앞 카드를 닫는다).
    """
    rules = json.load(open(os.path.join(LEGAL, '_dashboard', 'review_queue_rules.json'), encoding='utf-8'))
    head, close = re.compile(rules['카드머리']), re.compile(rules['카드닫기'])
    ok_, na, split = re.compile(rules['승인'], re.M), re.compile(rules['해당없음'], re.M), re.compile(rules['쪼갬'], re.M)
    blocks, cur = [], None
    for line in open(QUEUE, encoding='utf-8').read().split('\n'):
        if head.match(line):
            if cur is not None:
                blocks.append(cur)
            cur = line + '\n'
            continue
        if close.match(line):
            if cur is not None:
                blocks.append(cur)
                cur = None
            continue
        if cur is not None:
            cur += line + '\n'
    if cur is not None:
        blocks.append(cur)
    out = set()
    for b in blocks:
        m = ok_.search(b)
        if (m and m.group(1).lower() == 'x') or na.search(b) or split.search(b):
            continue
        hm = re.match(r'^###\s+(REVIEW-[^:\s]+):', b)
        if hm:
            out.add(hm.group(1))
    return out


_PHONE_SRC = None
PHONE = re.compile(r'(?:☎\s*|(?:신고\s*)?전화(?:번호)?\s*\(?\s*)(\d{3,4}(?:-\d{3,4}){0,2})(?![\d가-힣R])|(?<![\d-])(0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4})(?![\d-])')


def phones(text):
    """본문의 전화번호 — 「☎ 122」「신고전화(122)」「061-280-1707」「1588-5119」 꼴."""
    return sorted({(a or b) for a, b in PHONE.findall(text)})


def phone_sources():
    """전화번호의 출처로 인정하는 것 — raw 원문 전체 · 수집한 연락처(`contacts_collected.json`)에 나오는 번호."""
    global _PHONE_SRC
    if _PHONE_SRC is None:
        found = set()
        num = re.compile(r'\d{2,4}(?:-\d{3,4}){0,2}')
        try:
            found |= set(num.findall(open(CONTACTS, encoding='utf-8').read()))
        except Exception:
            pass
        for f in glob.glob(os.path.join(RAW, '**', '*.txt'), recursive=True):
            try:
                t = open(f, encoding='utf-8').read()
            except Exception:
                continue
            for a, b in PHONE.findall(t):
                found.add(a or b)
        _PHONE_SRC = found
    return _PHONE_SRC


def main(argv):
    files = json.load(open(argv[0], encoding='utf-8'))
    out_path = argv[argv.index('--out') + 1] if '--out' in argv else None
    open_ids = queue_open()
    res = []
    for name in files:
        # ★1-8 — 개념 쪽만이 아니다: 「comparisons/…」·「annexes/…」 처럼 폴더를 붙여 주면 그 쪽을 본다.
        p = os.path.join(WIKI_ROOT, name + '.md') if '/' in name else os.path.join(WIKI, name + '.md')
        md = open(p, encoding='utf-8').read()
        slug = os.path.basename(name).split('__')[0]
        body = body_of(md)
        why = []
        refs = sorted(set(re.findall(r'REVIEW-[가-힣A-Za-z0-9ㆍ·]+-\d+', md)))
        pend = [r for r in refs if r in open_ids]
        if pend:
            why.append('대기열에서 안 풀린 확인 항목: ' + ', '.join(pend))
        sig = [s for s in SIGNALS if s in body]
        if sig:
            why.append('판독·출처 신호: ' + ', '.join(sig))
        # ★1-8 — 「같은 숫자, 다른 뜻」: 3-92 에서 원문 어디에도 없는 「해양경찰청 ☎ 122」 가 1차를 통과했다
        #   (raw 의 「제122호서식」 같은 다른 글자 덕). 전화번호는 숫자 값이 아니라 **연락처 출처**로 따로 본다.
        nophone = [ph for ph in phones(body) if ph not in phone_sources()]
        if nophone:
            why.append('출처(raw·수집 연락처)에 없는 전화번호: ' + ', '.join(nophone))
        money, qty, has_raw = raw_values(slug)
        if not has_raw:
            why.append('raw 폴더를 못 찾았다: ' + slug)
        # 다른 법의 숫자를 인용한 줄 — 그 쪽이 「」 로 이름을 댄 법의 원문까지 본다(그 밖의 법은 보지 않는다).
        cited = sorted(cited_slugs(md) - {slug})
        money, qty = set(money), set(qty)
        for c in cited:
            m2, q2, _ = raw_values(c)
            money |= m2
            qty |= q2
        vals = values(body)
        miss = []
        for k, v, src in vals:
            if k == '금액' and v not in money:
                miss.append(src)
            elif k == '수량' and v not in qty:
                miss.append(src)
        if miss:
            why.append('원문에 없는 값 %d개: %s' % (len(set(miss)), ' · '.join(sorted(set(miss))[:12])))
        res.append({'file': name, 'law': slug, 'cited': cited, 'values': len(vals), 'missing': sorted(set(miss)),
                    'pending_review': pend, 'signals': sig, 'phones_unsourced': nophone, 'pass': not why, 'why': why})
    ok = [r for r in res if r['pass']]
    print('1차 기계 대조 — %d쪽 · 통과 %d · 보류 %d' % (len(res), len(ok), len(res) - len(ok)))
    print('   대조한 값 %d개' % sum(r['values'] for r in res))
    if out_path:
        json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('   판정표:', out_path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
