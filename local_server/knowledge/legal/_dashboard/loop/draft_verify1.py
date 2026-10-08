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
    목록은 개념 쪽 파일 이름(확장자 없음) 배열.
[연계] ← 3-90 작업 세션(초안 113쪽) · → 2차 에이전트 읽기 · 승격은 사람이 지켜보는 작업 세션이 한다.
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki', 'concepts')
RAW = os.path.join(LEGAL, 'raw')
QUEUE = os.path.join(LEGAL, '_dashboard', 'review_queue.md')

UNITS = ('원', '년', '개월', '월', '일', '시간', '분', '톤', '미터', '센티미터', '밀리미터', '킬로미터', '해리', '노트',
         '킬로그램', '퍼센트', '배', '명', '회', '마력', '킬로와트', '제곱미터', '세제곱미터', '리터', '척')
UNIT_ALIAS = {'m': '미터', 'cm': '센티미터', 'mm': '밀리미터', 'km': '킬로미터', 'kg': '킬로그램', '%': '퍼센트',
              '㎡': '제곱미터', 'm²': '제곱미터', '㎥': '세제곱미터', 'kW': '킬로와트', 'ℓ': '리터', 'L': '리터'}
SIGNALS = ('판독', 'OCR', '출처미확인', '출처 미확인')


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


MONEY = re.compile(r'\d[\d,]*(?:\.\d+)?\s*(?:억\s*(?:\d[\d,]*\s*)?)?(?:천만|백만|만)?\s*(?:\d[\d,]*\s*천)?\s*원(?![가-힣])')
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
    """대기열에서 아직 승인 안 된 REVIEW 항목 id 집합."""
    txt = open(QUEUE, encoding='utf-8').read()
    out = set()
    for blk in re.split(r'\n(?=### )', txt):
        m = re.match(r'### (REVIEW-[^:\s]+):', blk)
        if m and not re.search(r'-\s*승인:\s*\[[xX]\]', blk):
            out.add(m.group(1))
    return out


def main(argv):
    files = json.load(open(argv[0], encoding='utf-8'))
    out_path = argv[argv.index('--out') + 1] if '--out' in argv else None
    open_ids = queue_open()
    res = []
    for name in files:
        p = os.path.join(WIKI, name + '.md')
        md = open(p, encoding='utf-8').read()
        slug = name.split('__')[0]
        body = body_of(md)
        why = []
        refs = sorted(set(re.findall(r'REVIEW-[가-힣A-Za-z0-9ㆍ·]+-\d+', md)))
        pend = [r for r in refs if r in open_ids]
        if pend:
            why.append('대기열에서 안 풀린 확인 항목: ' + ', '.join(pend))
        sig = [s for s in SIGNALS if s in body]
        if sig:
            why.append('판독·출처 신호: ' + ', '.join(sig))
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
                    'pending_review': pend, 'signals': sig, 'pass': not why, 'why': why})
    ok = [r for r in res if r['pass']]
    print('1차 기계 대조 — %d쪽 · 통과 %d · 보류 %d' % (len(res), len(ok), len(res) - len(ok)))
    print('   대조한 값 %d개' % sum(r['values'] for r in res))
    if out_path:
        json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('   판정표:', out_path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
