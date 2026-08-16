#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""처벌 강도(벌칙) × 위반행위 유형 계층 트리 빌더 겸 검증기 (H-32 확장, A안).

역할(초보자용):
  74법 raw의 `법률.txt`를 훑어 벌칙·과태료 조문을 찾고, 그 안의 위반행위 하나하나를
  "무슨 행위를 하면 얼마"로 뽑아 트리(JSON)로 만든다. 벌칙 조항은 대개
  "제21조제1항에 따른 어선검사를 받지 아니한 자"처럼 **다른 조문을 가리키기만** 하므로,
  그 가리켜진 조문(제21조제1항)을 raw에서 실제로 찾아 **조문제목과 원문**까지 함께 담는다
  (=참조 해소). 사람이 법 내용을 타이핑하지 않는다 — 전부 raw에서 읽어 채우고,
  raw에서 못 찾으면 그 자리에서 빌드를 실패시킨다(환각 0).

[연계]
  읽기: local_server/knowledge/legal/raw/**/법률.txt · 각 법 _meta.json(법령ID)
        raw/**/별표/시행령_별표*.txt (과태료 부과기준 포인터)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/penalty_tree.json
  설계: _dashboard/H32_penalty_tree_design.md (스키마·참조해소 방법론·검증 기준)
  검증: _dashboard/loop/verify_penalty_tree.py (이 파일의 로직을 재사용하지 않는 독립 재대조)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_penalty_tree.py
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
OUT = os.path.join(DASH, 'penalty_tree.json')
KST = timezone(timedelta(hours=9))

ERRORS = []


# ── 74법 목록 ──────────────────────────────────────────────────────
def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법.
    근거: H29_design.md §2 · build_vessel_doc_tree.py와 같은 목록(같은 축을 유지)."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}
BY_NAME = {x['name'].replace(' ', ''): x['slug'] for x in LAWS}


# ── raw 읽기 ───────────────────────────────────────────────────────
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')
RE_TAG = re.compile(r'<[^>]*>')
HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
RE_HO = re.compile(r'^(\d+(?:의\d+)?)\.\s*(.*)$')


def norm(s):
    """공백 정규화 + <개정 …> 등 연혁 태그 제거. 저장하는 모든 인용문이 이 형태다."""
    return re.sub(r'\s+', ' ', RE_TAG.sub('', s)).strip()


def split_articles(text):
    """법률계열 raw(`[제10조] 제목 (시행 …)`)를 조 단위로 쪼갠다 → {조: (제목, 본문)}.
    ※ 고시계열은 마커 형식이 다르지만(L-54) 벌칙은 법률에만 있어(설계 §5.1 실측) 대상이 아니다."""
    out, cur, buf, title = {}, None, [], ''
    for line in text.split('\n'):
        m = RE_ART.match(line.strip())
        if m:
            if cur:
                out[cur] = (title, '\n'.join(buf))
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            title = re.sub(r'\s*\(시행[^)]*\)\s*$', '', m.group(3)).strip()
            buf = []
        elif cur is not None:
            buf.append(line)
    if cur:
        out[cur] = (title, '\n'.join(buf))
    return out


_arts = {}


def arts_of(slug):
    law = BY_SLUG.get(slug)
    if slug not in _arts:
        p = os.path.join(law['raw'], '법률.txt') if law else None
        _arts[slug] = split_articles(open(p, encoding='utf-8', errors='replace').read()) \
            if p and os.path.exists(p) else {}
    return _arts[slug]


_lawid = {}


def law_id(slug):
    """_meta.json families.법률.법령ID — 법령명이 바뀌어도 추적이 끊기지 않게(H-29 11항·L-74)."""
    if slug not in _lawid:
        p = os.path.join(BY_SLUG[slug]['raw'], '_meta.json')
        v = None
        if os.path.exists(p):
            v = (json.load(open(p, encoding='utf-8')).get('families', {}).get('법률') or {}).get('법령ID')
        _lawid[slug] = v
    return _lawid[slug]


def rel(slug):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], '법률.txt'), LEGAL)


# ── 벌칙 조문 분해 ─────────────────────────────────────────────────
RE_PEN = re.compile(r'(년 이하의 징역|개월 이하의 징역|년 이상의 징역|무기징역|무기 또는|사형|'
                    r'원 이하의 벌금|원 이하의 과태료|상당하는 벌금|벌금을 병과)')
RE_VERB = re.compile(r'처한다|부과한다|병과한다|과한다')


def parse_units(body):
    """조문 본문 → [{'항','lead','호':[[번호,텍스트]]}] (설계 §5.3)."""
    units, cur = [], {'항': None, 'lead': [], '호': []}
    for raw_line in body.split('\n'):
        l = raw_line.strip()
        if not l:
            continue
        if l[0] in HANG:
            if cur['lead'] or cur['호']:
                units.append(cur)
            cur = {'항': '제%d항' % (HANG.index(l[0]) + 1), 'lead': [l[1:].strip()], '호': []}
            continue
        m = RE_HO.match(l)
        if m:
            cur['호'].append([m.group(1), m.group(2)])
        elif cur['호']:
            cur['호'][-1][1] += ' ' + l
        else:
            cur['lead'].append(l)
    if cur['lead'] or cur['호']:
        units.append(cur)
    for u in units:
        u['lead'] = ' '.join(u['lead']).strip()
    return units


# ── 형량 파싱 (설계 §5.5) ──────────────────────────────────────────
RE_JING_MAX_Y = re.compile(r'(\d+)년\s*이하의\s*(?:유기)?징역')
RE_JING_MAX_M = re.compile(r'(\d+)개월\s*이하의\s*징역')
RE_JING_MIN_Y = re.compile(r'(\d+)년\s*이상의\s*(?:유기)?징역')
RE_JING_RANGE = re.compile(r'(\d+)년\s*이상\s*(\d+)년\s*이하의\s*징역')
MONEY = r'\d+(?:억)?(?:\d+)?(?:천|백|십)?만?원|\d+억원|\d+원'
RE_FINE = re.compile(r'(%s)\s*이상\s*(%s)\s*이하의\s*벌금|(%s)\s*이하의\s*벌금' % (MONEY, MONEY, MONEY))
RE_ADMIN = re.compile(r'(%s)\s*이상\s*(%s)\s*이하의\s*과태료|(%s)\s*이하의\s*과태료' % (MONEY, MONEY, MONEY))


def won(s):
    """'1억5천만원'·'1천5백만원'·'3천만원'·'500만원' → 원 단위 정수. 못 읽으면 None."""
    s = s.replace('원', '').strip()
    total = 0
    if '억' in s:
        head, s = s.split('억', 1)
        if not head.isdigit():
            return None
        total += int(head) * 10 ** 8
    if not s:
        return total
    if s.endswith('만'):
        s = s[:-1]
        scale = 10 ** 4
    else:
        scale = 1
    n, cur = 0, ''
    for ch in s:
        if ch.isdigit():
            cur += ch
        elif ch in '천백십':
            if not cur:
                return None
            n += int(cur) * {'천': 1000, '백': 100, '십': 10}[ch]
            cur = ''
        else:
            return None
    if cur:
        n += int(cur)
    return total + n * scale


def parse_penalty(lead):
    """형량 단위(항 머리글) → 구조화된 형량 dict. 인용은 raw 문장 그대로."""
    t = norm(lead)
    out = {'제재': None, '징역': None, '벌금': None, '과태료': None,
           '병과': False, '인용': None, '비정형': None}
    m = RE_JING_RANGE.search(t)
    if m:
        out['징역'] = {'하한': '%s년' % m.group(1), '상한': '%s년' % m.group(2),
                       '상한_개월': int(m.group(2)) * 12}
        m = None
    else:
        m = RE_JING_MAX_Y.search(t)
    if m:
        out['징역'] = {'상한': '%s년' % m.group(1), '상한_개월': int(m.group(1)) * 12}
    elif out['징역'] is None:
        m = RE_JING_MAX_M.search(t)
        if m:
            out['징역'] = {'상한': '%s개월' % m.group(1), '상한_개월': int(m.group(1))}
        else:
            m = RE_JING_MIN_Y.search(t)
            if m:
                out['징역'] = {'하한': '%s년' % m.group(1), '상한': None, '상한_개월': None}
            elif '무기' in t or '사형' in t:
                out['징역'] = {'상한': None, '상한_개월': None, '표기': '무기 또는 사형 포함'}
    for key, rx in (('벌금', RE_FINE), ('과태료', RE_ADMIN)):
        m = rx.search(t)
        if not m:
            continue
        lo, hi, only = m.group(1), m.group(2), m.group(3)
        cap = only or hi
        out[key] = {'상한_표기': cap, '상한_원': won(cap),
                    '하한_표기': lo, '하한_원': won(lo) if lo else None}
    if '상당하는 벌금' in t and not out['벌금']:
        out['비정형'] = t
    kinds = [k for k in ('징역', '벌금', '과태료') if out[k]]
    if out['비정형'] and '벌금' not in kinds:
        kinds.append('벌금(비정형)')   # 금액을 정형화할 수 없는 벌금이 있다는 사실 자체는 숨기지 않는다
    out['제재'] = '·'.join(kinds) if kinds else None
    # 인용: "…에 처한다/부과한다"로 끝나는 절
    m = re.search(r'[^.]{0,140}(?:처한다|부과한다|병과한다|과한다)', t)
    out['인용'] = (m.group(0) if m else t)[:300].strip()
    return out


# ── 참조 해소 (설계 §5.4) ──────────────────────────────────────────
RE_REF = re.compile(r'(?:「([^」]+)」\s*)?제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?')
RE_JUNYONG = re.compile(r'^\s*(?:에 따라|에서|에 따라서)?\s*준용')


def paren_spans(t):
    """괄호 구간 [(start,end)…] — 괄호 안 참조는 부수참조로 본다."""
    spans, stack = [], []
    for i, ch in enumerate(t):
        if ch in '(（':
            stack.append(i)
        elif ch in ')）' and stack:
            spans.append((stack.pop(), i))
    return spans


def hang_text(body, hang_no):
    """조문 본문에서 제N항의 원문을 잘라 온다. 그 항이 없으면 None."""
    if hang_no > len(HANG):
        return None
    sym = HANG[hang_no - 1]
    flat = norm(body)
    i = flat.find(sym)
    if i < 0:
        return None
    nxt = flat.find(HANG[hang_no], i) if hang_no < len(HANG) else -1
    seg = flat[i:nxt] if nxt > i else flat[i:]
    return seg.strip()[:400]


def head_text(body):
    """항 구분이 없는 조문의 첫 문장."""
    flat = norm(body)
    m = re.search(r'^.{0,400}?다\.', flat)
    return (m.group(0) if m else flat[:300]).strip()


def resolve_ref(cur_slug, cur_article, mobj, text):
    """참조 1건 → 해소 결과 dict (설계 §5.4.2)."""
    lawname, n, ui, hang, ho = mobj.groups()
    art = '제%s조' % n + ('의%s' % ui if ui else '')
    disp = art + ('제%s항' % hang if hang else '') + ('제%s호' % ho if ho else '')
    slug = cur_slug
    if lawname:
        slug = BY_NAME.get(lawname.replace(' ', ''))
        if not slug:
            return {'역할': '주된 금지조항', '표시': '「%s」 %s' % (lawname, disp),
                    '법령': lawname, '법령_slug': None, '계층': '법률',
                    '조': art, '항': ('제%s항' % hang) if hang else None,
                    '조문제목': None, '파일': None, '인용': None,
                    '해소': 'not_in_corpus', '선정근거': '타법 참조 — 74법 코퍼스 밖이라 해소하지 않음'}
    arts = arts_of(slug)
    base = {'표시': ('「%s」 ' % lawname if lawname else '') + disp,
            '법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': '법률',
            '조': art, '항': ('제%s항' % hang) if hang else None,
            '호': ('제%s호' % ho) if ho else None,
            '법령ID': law_id(slug), '파일': rel(slug)}
    if art not in arts:
        base.update({'조문제목': None, '인용': None, '해소': 'article_missing'})
        return base
    title, body = arts[art]
    q = hang_text(body, int(hang)) if hang else head_text(body)
    if q is None:
        base.update({'조문제목': title, '인용': head_text(body), '해소': 'hang_missing'})
        return base
    base.update({'조문제목': title, '인용': q, '해소': 'resolved'})
    return base


def refs_of(slug, penal_article, text):
    """항목 텍스트의 모든 조문참조를 뽑아 역할을 붙이고 해소한다."""
    t = norm(text)
    spans = paren_spans(t)
    out = []
    for mo in RE_REF.finditer(t):
        r = resolve_ref(slug, penal_article, mo, t)
        inside = any(a < mo.start() < b for a, b in spans)
        tail = t[mo.end():mo.end() + 12]
        if inside:
            role = '부수참조'
        elif re.match(r'^\s*(?:에 따라|에서)\s*준용', tail):
            role = '준용경유'
        elif not mo.group(1) and r.get('조') == penal_article:
            role = '자기참조'
        else:
            role = None
        r['역할'] = role
        out.append(r)
    primary = next((r for r in out if r['역할'] is None), None)
    for r in out:
        if r['역할'] is None:
            r['역할'] = '주된 금지조항' if r is primary else '그 밖의 참조'
            r['선정근거'] = ('괄호 밖·준용경유 아닌 첫 참조' if r is primary
                             else '같은 항목이 함께 가리키는 조문')
        else:
            r.setdefault('선정근거', r['역할'] + ' 판정')
    return out


# ── 위반행위 유형 규칙 (설계 §3.2 — 상향식으로 뽑아 실측으로 넓힌 것) ──
RULES = [
    # ★순서 = 우선순위. "가장 구체적인 행위 요소가 먼저"로 정렬한다.
    #   이 순서·문구는 표본 정독(설계 §5.4.3 ③)에서 오탐을 확인하고 두 번 고친 결과다 — §6.2 참조.
    ('거짓·부정한 방법',
     # ★맨앞 우선순위지만 문구는 좁게 잡는다 — 넓은 `거짓` 하나로 잡으면
     #   "신고를 하지 아니하거나 거짓으로 신고한 자"처럼 **본래 의무 미이행이 주된 행위**인 항목까지
     #   전부 이 유형으로 빨려 들어온다(표본 정독에서 실제로 확인, §6.2).
     r'거짓이나 그 밖의 부정한 방법|거짓 또는 부정한 방법|부정한 방법으로|허위|'
     r'거짓으로 (?:작성|기재|표시|증명|발급|등록|측정|산출)|비밀을 누설|명의를 (?:사용|대여)|'
     r'자격증을 (?:빌려|대여)|빌려 준|대여받|알선|은폐|변조|위조'),
    ('오염물질 배출·투기',
     r'배출하|배출한|배출을|배출허용|투기|버린|유출|오염물질|폐기물|기름|유해액체물질|선박평형수|'
     r'황함유|대기오염|소각|퇴적물|방제|오염을|준설물질|분뇨|폐수|수질|오수|방오도료|오존층파괴물질|'
     r'질소산화물|포장유해물질|농약'),
    ('검사·증서',
     r'검사를 받지|검사를 받아야|검사증서|검정을 받지|검정을|형식승인|증서를|증명서를|정기검사|중간검사|'
     r'임시검사|특별검사|건조검사|성능인증|적합성확인|유효기간|검사기관|측정을 받지|평가를 받지|'
     r'검사를 받은|안전검사'),
    ('안전기준·인명',
     r'주취|술에 취|음주|약물|정원을 초과|최대승선인원|과승|구명|소화|만재흘수선|복원성|위험물|화재|'
     r'안전|인명|사망|상해|재해|보건|응급|의료|보험등에 가입|보험 가입|공제|무기를|대피처|경보|구조활동|'
     r'구조본부|인명구조'),
    ('무허가·무면허·미등록·미신고',
     r'(?:허가|면허|등록|신고|승인|지정|인증|인정|자격)(?:을|를)\s*(?:받지|하지)\s*(?:아니|않)|'
     r'무면허|무허가|미등록|변경(?:신고|등록|허가|승인)(?:을|를)?\s*(?:하지|받지)|'
     r'(?:허가|면허|등록|신고|승인|지정)\s*없이|권을 이전|권을 임대|임차|지위를 승계'),
    ('항행·출입항·구역제한',
     r'출입항|입항|출항|항행|항로(?!표지)|정박|계류|속력|항해|운항|조업금지|금지구역|제한구역|통항|예인|접안|'
     r'보호구역|무인도서|공유수면|점용|매립|어장|영해|접속수역|양륙|옮겨 싣|해리|수역에서|해역에서'),
    ('시설·설비·인력·교육 기준',
     r'설치하지|부착하지|설비를|시설을|기기를|장치를|유지하지|보유하지|임명하지|배치하지|선임하지|'
     r'준수사항|기준을 (?:위반|초과|충족)|기준에 (?:맞지|적합)|사용하지|작동하지|가동하지|관리기준|'
     r'교육을|실시하지|체결하지|승무시킨|승무한|종사하게'),
    ('명령·처분 불이행, 검사거부·방해',
     r'명령|처분|조치를|시정|중지|정지|폐쇄|철거|거부|방해|기피|출입ㆍ검사|조사를|제한ㆍ정지|'
     r'지키지 아니|따르지 아니|이행하지'),
    ('보고·기록·서류',
     r'보고|통보|자료|서류|기록|장부|일지|명부|기재|작성|비치|게시|제출|신고서|표지|통지|열람|공개|보관하지'),
]
RULE_RE = [(k, re.compile(r)) for k, r in RULES]
TYPE_TO_LEAF = {
    '무허가·무면허·미등록·미신고': 'unlicensed',
    '검사·증서': 'inspection',
    '거짓·부정한 방법': 'fraud',
    '안전기준·인명': 'safety',
    '항행·출입항·구역제한': 'navigation',
    '오염물질 배출·투기': 'pollution',
    '시설·설비·인력·교육 기준': 'facility',
    '명령·처분 불이행, 검사거부·방해': 'order_defiance',
    '보고·기록·서류': 'reporting',
    '그 밖의 위반행위': 'other_violation',
}


RE_PAREN = re.compile(r'\([^()]*\)')
RE_DANSEO = re.compile(r'\s*다만,.*$')


def classify(text, ref_title):
    """항목 원문 → 위반행위 유형 + 근거(실제로 매치된 raw 문자열). 설계 §3.2.

    ★괄호 안 문구는 빼고 판정한다 — 괄호는 대개 적용제외·부연이라 그 안의 단어가
    행위를 대표하지 않는다(표본 정독에서 "…출입ㆍ검사를 거부한 자(폐수무방류배출시설…은 제외한다)"가
    괄호 안의 "폐수" 때문에 오염 유형으로 잘못 들어간 것을 확인, §6.2).
    같은 이유로 단서("다만, …은 제외한다")도 뺀다 — 단서는 적용제외라 행위를 대표하지 않는다."""
    text = RE_DANSEO.sub('', RE_PAREN.sub(' ', text))
    cands = [k for k, rx in RULE_RE if rx.search(text)]
    for k, rx in RULE_RE:
        m = rx.search(text)
        if m:
            return k, {'매치': m.group(0), '출처': '항목원문', '규칙': k}, cands
    for k, rx in RULE_RE:
        m = rx.search(ref_title or '')
        if m:
            return k, {'매치': m.group(0), '출처': '참조조문제목', '규칙': k}, [k]
    return '그 밖의 위반행위', {'매치': None, '출처': None,
                                 '규칙': '어떤 유형 규칙에도 걸리지 않음'}, []


# ── 가중·감경 (설계 §5.6) ──────────────────────────────────────────
def law_aggravation(slug):
    """법 단위로 한 번만 계산: 양벌규정 조문, 과태료 부과기준 별표 경로."""
    arts = arts_of(slug)
    yangbeol = None
    for art, (title, body) in arts.items():
        if '양벌규정' in (title or ''):
            yangbeol = {'조문': art, '본문': norm(body), '인용': norm(body)[:220]}
            break
    byl = None
    d = os.path.join(BY_SLUG[slug]['raw'], '별표')
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if not f.startswith('시행령_별표') or not f.endswith('.txt'):
                continue
            head = open(os.path.join(d, f), encoding='utf-8', errors='replace').readline()
            if '과태료' in head and '부과기준' in head:
                byl = {'파일': os.path.relpath(os.path.join(d, f), LEGAL), '인용': head.strip()}
                break
    return {'양벌규정': yangbeol, '과태료부과기준': byl}


# ── 항목 추출 ──────────────────────────────────────────────────────
def byungwa_quote(flat):
    """병과 규정 문장만 잘라 온다 — 항 기호 이후로 잘라 앞 호 문구가 딸려오지 않게 한다."""
    m = re.search(r'[^.]*병과[^.]*\.', flat)
    if not m:
        return ''
    seg = m.group(0)
    for sym in HANG:
        i = seg.rfind(sym)
        if i >= 0:
            seg = seg[i:]
    return seg.strip()[:200]


def collect_entries():
    entries, excluded = [], []
    stat = {'laws_scanned': 0, 'laws_with_penalty': 0, 'penalty_articles': 0,
            'penalty_units': 0, 'deleted_ho': 0, 'articles_scanned': 0}
    laws_hit = []
    for law in LAWS:
        slug = law['slug']
        p = os.path.join(law['raw'], '법률.txt')
        if not os.path.exists(p):
            ERRORS.append('법률.txt 없음: %s' % slug)
            continue
        stat['laws_scanned'] += 1
        arts = arts_of(slug)
        stat['articles_scanned'] += len(arts)
        agg = law_aggravation(slug)
        found = False
        for art, (title, body) in arts.items():
            if not RE_PEN.search(body):
                continue
            units = [u for u in parse_units(body)
                     if RE_PEN.search(norm(u['lead'])) and RE_VERB.search(norm(u['lead']))]
            if not units:
                continue
            stat['penalty_articles'] += 1
            found = True
            for u in units:
                stat['penalty_units'] += 1
                pen = parse_penalty(u['lead'])
                pen['병과'] = '병과' in norm(body)
                if not pen['제재']:
                    # 형량 종류를 못 읽는 단위 = 독립된 위반행위가 아니라 다른 조의 죄에 붙는
                    # 부가형(가액 배수 벌금 병과 등). 지어내지 않고 사유와 함께 제외 목록에 남긴다.
                    excluded.append({'법령': law['name'], '조문': art + (u['항'] or ''),
                                     '인용': norm(u['lead'])[:260],
                                     '사유': '형량(징역·벌금·과태료)의 종류·금액을 정형으로 읽을 수 없는 단위. '
                                             '다른 조의 죄에 부가되는 병과 규정이라 독립된 위반행위 항목이 아니다.'})
                    continue
                items = u['호'] or [(None, u['lead'])]
                for no, txt in items:
                    t = norm(txt)
                    if t.startswith('삭제'):
                        stat['deleted_ho'] += 1
                        continue
                    refs = refs_of(slug, art, t)
                    prim = next((r for r in refs if r['역할'] == '주된 금지조항'), None)
                    typ, why, cands = classify(t, prim['조문제목'] if prim else None)
                    agg_list = []
                    if agg['양벌규정'] and re.search(r'제%s조' % re.escape(art[1:-1]), agg['양벌규정']['본문']):
                        agg_list.append({'종류': '양벌규정', '법령': law['name'],
                                         '조문': agg['양벌규정']['조문'],
                                         '인용': agg['양벌규정']['인용']})
                    if '병과' in norm(body):
                        agg_list.append({'종류': '병과', '법령': law['name'], '조문': art,
                                         '인용': byungwa_quote(norm(body))})
                    if re.search(r'\d년 이내에 \d회 이상|가중', norm(body)):
                        mm = re.search(r'[^.]*(?:\d년 이내에 \d회 이상|가중)[^.]*\.', norm(body))
                        if mm:
                            agg_list.append({'종류': '가중', '법령': law['name'], '조문': art,
                                             '인용': mm.group(0)[:220]})
                    if pen['과태료'] and agg['과태료부과기준']:
                        agg_list.append({'종류': '과태료 부과기준(시행령 별표)',
                                         '파일': agg['과태료부과기준']['파일'],
                                         '인용': agg['과태료부과기준']['인용'],
                                         '주의': '개별 위반행위별 실제 부과금액은 이 별표의 표에 있다. '
                                                 '이번 트리는 표를 파싱하지 않았다(포인터만).'})
                    disp = art + (u['항'] or '') + ('제%s호' % no if no else '')
                    # 참조 해소가 안 된 항목은 데이터 자체가 그 사실을 들고 있어야 한다(조용히 넘어가지 않는다).
                    bad = [r for r in refs if r['해소'] != 'resolved']
                    note = None
                    if bad:
                        note = '참조 미해소 %d건: %s' % (len(bad), ' / '.join(
                            '%s(%s)' % (r['표시'], {'not_in_corpus': '74법 코퍼스 밖 타법이라 해소하지 않음',
                                                    'article_missing': '그 조문이 이 법 raw에 없음',
                                                    'hang_missing': '그 조는 있으나 지목된 항이 없음(삭제된 조문일 수 있음)'}
                                        .get(r['해소'], r['해소'])) for r in bad))
                    entries.append({
                        '위반행위': t,
                        '근거법령': law['name'], '근거법령_slug': slug, '계층': '법률',
                        '법령ID': law_id(slug), '분야': law['domain'], '파일': rel(slug),
                        '벌칙조문': {'조': art, '항': u['항'], '호': no, '표시': disp,
                                     '조문제목': title or None},
                        '형량': pen,
                        '참조해소': refs,
                        '참조해소_요지': ('%s %s 「%s」' % (prim['법령'], prim['표시'], prim['조문제목'])
                                          if prim and prim['해소'] == 'resolved' and prim['조문제목']
                                          else (prim['표시'] if prim else None)),
                        '유형': typ, '유형근거': why, '유형_후보': cands,
                        '가중감경': agg_list,
                        '주의': note,
                    })
        if found:
            stat['laws_with_penalty'] += 1
            laws_hit.append(slug)
    return entries, stat, laws_hit, excluded


# ── 트리 조립 ──────────────────────────────────────────────────────
LEAF_DEF = [
    ('unlicensed', '무허가·무면허·미등록·미신고', '허가·면허·등록·신고·승인·지정을 받지(하지) 않고 한 행위'),
    ('inspection', '검사·증서', '검사·검정·형식승인을 받지 않았거나 증서 관련 의무를 어긴 경우'),
    ('fraud', '거짓·부정한 방법', '거짓이나 부정한 방법으로 받거나, 명의 대여·비밀 누설 등'),
    ('safety', '안전기준·인명', '음주·약물 조종, 정원 초과, 구명·소화설비, 안전·보건 의무 등'),
    ('navigation', '항행·출입항·구역제한', '출입항·항로·정박·속력, 조업금지구역·보호구역 등 구역 제한'),
    ('pollution', '오염물질 배출·투기', '기름·폐기물·유해액체물질·평형수 등 오염물질의 배출·투기'),
    ('facility', '시설·설비·인력·교육 기준', '설비 미설치·미작동, 관리인·기술인 미임명, 교육 미이수, 준수사항 위반 등'),
    ('order_defiance', '명령·처분 불이행, 검사거부·방해', '시정·중지·정지 명령 불이행, 출입·검사 거부·방해·기피'),
    ('reporting', '보고·기록·서류', '보고·통보·자료제출 미이행, 기록부·장부 미작성, 서류 미비치 등'),
    ('other_violation', '그 밖의 위반행위', '위 어느 유형 규칙에도 걸리지 않은 항목 — 우리 분류가 못 담은 것'),
]
RULE_SRC = dict(RULES)


def example_of(entries, leaf_id, groups):
    e = groups.get(leaf_id) or []
    return e[0]['위반행위'][:70] + ('…' if e and len(e[0]['위반행위']) > 70 else '') if e else ''


def leaf_node(leaf_id, label, desc, items):
    by_law, by_sanc = {}, {}
    for e in items:
        by_law[e['근거법령']] = by_law.get(e['근거법령'], 0) + 1
        k = e['형량']['제재'] or '미판정'
        by_sanc[k] = by_sanc.get(k, 0) + 1
    top_laws = sorted(by_law.items(), key=lambda kv: -kv[1])[:3]
    node = {
        'id': leaf_id, '라벨': label, '설명': desc,
        '판정규칙': {'정규식': RULE_SRC.get(label),
                     '설명': '항목 원문(없으면 참조된 조문 제목)에 이 정규식이 매치되면 이 유형으로 배정한다. '
                             '규칙 순서상 앞선 유형이 우선한다 — 걸린 유형 전체는 항목의 `유형_후보`에 남는다.'
                     if RULE_SRC.get(label) else
                     '어떤 유형 규칙에도 매치되지 않은 항목이 여기로 온다(설계 §3.2·§3.3).'},
        '분포': {'항목수': len(items),
                 '법별': dict(sorted(by_law.items(), key=lambda kv: -kv[1])),
                 '제재별': dict(sorted(by_sanc.items(), key=lambda kv: -kv[1]))},
        '추가확인': [
            {'축': '제재 종류',
             '질문': '형사처벌(징역·벌금)인지 과태료인지로 좁힐까요?',
             '선택지': [{'label': '형사처벌(징역·벌금)'}, {'label': '과태료'}],
             '필터': {'필드': '형량.제재',
                      '값': {'형사처벌(징역·벌금)': [k for k in by_sanc if '과태료' not in k],
                             '과태료': [k for k in by_sanc if '과태료' in k]}}},
            {'축': '소관 법',
             '질문': '어느 법에 관한 것인지 아시나요?',
             '선택지': [{'label': n, 'hint': '이 유형에서 %d건' % c} for n, c in top_laws],
             '필터': {'필드': '근거법령'}},
        ],
        '위반행위': items,
    }
    return node


def build_tree(entries):
    groups = {}
    for e in entries:
        groups.setdefault(TYPE_TO_LEAF[e['유형']], []).append(e)
    leaves = {lid: leaf_node(lid, lab, desc, groups.get(lid, []))
              for lid, lab, desc in LEAF_DEF}

    def ex(lid):
        it = groups.get(lid) or []
        if not it:
            return '(이번 스캔에서 해당 항목 없음)'
        s = it[0]['위반행위']
        return '예: "%s"' % (s[:64] + '…' if len(s) > 64 else s)

    def cnt(*lids):
        return sum(len(groups.get(l) or []) for l in lids)

    c3 = {
        'id': 'paperwork_other', '라벨': '서류·보고, 그 밖의 것',
        '설명': '보고·기록·서류 의무거나, 위 어느 유형에도 들어가지 않는 것',
        '질문': '서류·보고에 관한 것인가요?',
        '선택지': [
            {'label': '보고·기록·서류', 'hint': '%s (%d건)' % (ex('reporting'), cnt('reporting')),
             'next': 'reporting'},
            {'label': '그 밖의 것 / 잘 모르겠다',
             'hint': '위 분류에 안 들어가는 항목 (%d건) — 우리 분류의 한계이지 덜 중요해서가 아니다'
                     % cnt('other_violation'),
             'next': 'other_violation'},
        ],
        'children': [leaves['reporting'], leaves['other_violation']],
    }
    a = {
        'id': 'qualification', '라벨': '허가·자격·검사에 관한 것',
        '설명': '허가·면허·등록·신고·검사·증서 등 자격 계통',
        '질문': '허가·자격 쪽은 어떤 경우인가요?',
        '선택지': [
            {'label': '허가·등록·신고 자체를 안 함',
             'hint': '%s (%d건)' % (ex('unlicensed'), cnt('unlicensed')), 'next': 'unlicensed'},
            {'label': '검사·증서 관련',
             'hint': '%s (%d건)' % (ex('inspection'), cnt('inspection')), 'next': 'inspection'},
            {'label': '거짓·부정한 방법으로 받음',
             'hint': '%s (%d건)' % (ex('fraud'), cnt('fraud')), 'next': 'fraud'},
        ],
        'children': [leaves['unlicensed'], leaves['inspection'], leaves['fraud']],
    }
    b = {
        'id': 'conduct', '라벨': '바다에서 한 행위 자체',
        '설명': '현장에서 한 행위 — 안전·항행·오염',
        '질문': '현장에서 한 행위는 어느 쪽에 가깝나요?',
        '선택지': [
            {'label': '안전기준·인명',
             'hint': '%s (%d건)' % (ex('safety'), cnt('safety')), 'next': 'safety'},
            {'label': '항행·출입항·구역제한',
             'hint': '%s (%d건)' % (ex('navigation'), cnt('navigation')), 'next': 'navigation'},
            {'label': '오염물질 배출·투기',
             'hint': '%s (%d건)' % (ex('pollution'), cnt('pollution')), 'next': 'pollution'},
        ],
        'children': [leaves['safety'], leaves['navigation'], leaves['pollution']],
    }
    c = {
        'id': 'administrative', '라벨': '그 밖의 의무·행정 대응',
        '설명': '시설·인력 기준, 명령 불이행·검사 거부, 보고·서류',
        '질문': '어떤 쪽에 가깝나요?',
        '선택지': [
            {'label': '시설·설비·인력·교육 기준',
             'hint': '%s (%d건)' % (ex('facility'), cnt('facility')), 'next': 'facility'},
            {'label': '명령·처분 불이행, 검사 거부·방해',
             'hint': '%s (%d건)' % (ex('order_defiance'), cnt('order_defiance')), 'next': 'order_defiance'},
            {'label': '서류·보고, 그 밖의 것',
             'hint': '보고·기록·서류(%d건) 또는 어느 분류에도 안 걸린 항목(%d건)'
                     % (cnt('reporting'), cnt('other_violation')),
             'next': 'paperwork_other'},
        ],
        'children': [leaves['facility'], leaves['order_defiance'], c3],
    }
    return {
        'id': 'penalty_root', '라벨': '벌칙(처벌 강도)',
        '설명': '74법 법률 원문의 벌칙·과태료 조문에서 뽑은 위반행위와 법정형',
        '질문': '어떤 상황에 대한 것인가요?',
        '선택지': [
            {'label': '허가·면허·검사 같은 자격 문제',
             'hint': '허가·등록·신고 없이 하거나, 검사를 안 받았거나, 거짓으로 받은 경우 (%d건)'
                     % cnt('unlicensed', 'inspection', 'fraud'),
             'next': 'qualification'},
            {'label': '바다에서 한 행위 자체',
             'hint': '안전기준·항행·출입항·오염물질 배출 등 현장 행위 (%d건)'
                     % cnt('safety', 'navigation', 'pollution'),
             'next': 'conduct'},
            {'label': '그 밖의 의무·행정 대응',
             'hint': '시설·인력 기준, 명령 불이행·검사 거부, 보고·서류 등 (%d건)'
                     % cnt('facility', 'order_defiance', 'reporting', 'other_violation'),
             'next': 'administrative'},
        ],
        'children': [a, b, c],
    }


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


# ── 빌드 게이트 (설계 §6) ──────────────────────────────────────────
def gate(root, entries, stat):
    """raw 대조 + 무결성. 하나라도 실패하면 JSON을 만들지 않는다."""
    files = {}

    def flat_of(path):
        if path not in files:
            files[path] = norm(open(os.path.join(LEGAL, path), encoding='utf-8',
                                    errors='replace').read())
        return files[path]

    for e in entries:
        body = flat_of(e['파일'])
        if e['위반행위'] not in body:
            ERRORS.append('위반행위 원문 대조 실패: %s %s' % (e['근거법령'], e['벌칙조문']['표시']))
        if e['형량']['인용'] and e['형량']['인용'] not in body:
            ERRORS.append('형량 인용 대조 실패: %s %s' % (e['근거법령'], e['벌칙조문']['표시']))
        for r in e['참조해소']:
            if r['해소'] != 'resolved':
                continue
            if r['인용'] not in flat_of(r['파일']):
                ERRORS.append('참조 인용 대조 실패: %s %s ← %s'
                              % (e['근거법령'], e['벌칙조문']['표시'], r['표시']))

    ids = [n['id'] for n in walk(root)]
    if len(ids) != len(set(ids)):
        ERRORS.append('노드 id 중복')
    tree_entries = sum(len(n.get('위반행위', [])) for n in walk(root))
    if tree_entries != len(entries):
        ERRORS.append('항목 보존 실패: 추출 %d ≠ 트리 %d' % (len(entries), tree_entries))
    for n in walk(root):
        kids = n.get('children', [])
        if kids:
            if not n.get('질문') or not n.get('선택지'):
                ERRORS.append('비-리프에 질문/선택지 없음: %s' % n['id'])
                continue
            if len(n['선택지']) != len(kids):
                ERRORS.append('선택지 수 ≠ 자식 수: %s' % n['id'])
            if len(n['선택지']) > 3:
                ERRORS.append('선택지 3개 초과(CLARIFY_OPTION_MAX 위반): %s' % n['id'])
            kid_ids = {c['id'] for c in kids}
            for o in n['선택지']:
                if o.get('next') not in kid_ids:
                    ERRORS.append('선택지 next가 자식이 아님: %s → %s' % (n['id'], o.get('next')))
            if n.get('위반행위') or n.get('추가확인'):
                ERRORS.append('비-리프에 위반행위/추가확인이 붙음: %s' % n['id'])
        else:
            if n.get('질문') or n.get('선택지'):
                ERRORS.append('리프에 질문/선택지가 붙음: %s' % n['id'])
            if '위반행위' not in n or '판정규칙' not in n:
                ERRORS.append('리프에 위반행위/판정규칙 없음: %s' % n['id'])


def main():
    entries, stat, laws_hit, excluded = collect_entries()
    root = build_tree(entries)
    gate(root, entries, stat)
    if ERRORS:
        print('빌드 실패 — raw 대조/무결성 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS[:60]:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    refs = [r for e in entries for r in e['참조해소']]
    by_res = {}
    for r in refs:
        by_res[r['해소']] = by_res.get(r['해소'], 0) + 1
    per_law, by_type, by_sanc, by_role = {}, {}, {}, {}
    for e in entries:
        per_law[e['근거법령']] = per_law.get(e['근거법령'], 0) + 1
        by_type[e['유형']] = by_type.get(e['유형'], 0) + 1
        by_sanc[e['형량']['제재']] = by_sanc.get(e['형량']['제재'], 0) + 1
    for r in refs:
        by_role[r['역할']] = by_role.get(r['역할'], 0) + 1
    nodes = list(walk(root))
    leaves = [n for n in nodes if not n.get('children')]

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 — 74법 raw `법률.txt` 전수 스캔으로 만든 "처벌 강도(벌칙) × 위반행위 유형" 계층 트리. '
                 '설계·참조해소 방법론·검증 기준은 _dashboard/H32_penalty_tree_design.md 참조.',
        'semantics': {
            '축': '이 트리의 축은 선박 종류가 아니라 **위반행위 유형**이다. vessel_doc_tree.json(선박종류 축)과 직교한다.',
            '유형_라벨의_지위': '리프 9종 + 「그 밖의 위반행위」의 라벨과 3그룹 묶음은 **법에 없는 우리 집계 범주**다. '
                                '항목이 그 유형에 배정된 근거(`유형근거.매치`)만 raw 원문 문자열이다. '
                                '서류 트리의 노드가 법정 용어였던 것과 다른 점이라 여기 명시한다.',
            '참조해소': '벌칙 조항이 가리키는 금지·의무 조항을 raw에서 찾아 조문제목·원문까지 담은 것. '
                        '`역할`은 주된 금지조항 / 그 밖의 참조 / 부수참조(괄호 안) / 준용경유 / 자기참조.',
            '형량': '**법정형**(법이 정한 상한)이지 선고형이 아니다. 답변에 쓸 때 "이만큼 처벌받는다"가 아니라 '
                    '"법정형이 이렇다"로 표현해야 한다.',
            '질문_선택지': '비-리프의 `질문`/`선택지`는 decideClarify()가 즉석 생성하지 않고 그대로 꺼내 쓰라고 박아둔 데이터. '
                           '`선택지[].next`는 그 노드의 자식 id, `hint`의 예시는 실제 raw 항목에서 뽑았다.',
            '추가확인': '리프의 잔여 축(제재 종류·소관 법). `필터`는 그 축이 정해졌을 때 어느 필드로 항목을 거를지를 데이터로 적은 것.',
        },
        'caveats': [
            '유형 9종의 라벨과 3그룹 묶음은 법에 없는 **우리 집계 범주**다. 어떤 법도 위반행위를 이렇게 분류하지 않는다. '
            '항목별 배정 근거(`유형근거.매치`)는 raw 문자열이지만 범주 이름은 우리가 붙였고, 여러 유형에 걸치는 항목이 많아 '
            '(`유형_후보`) 배정은 우선순위 규칙의 결과이지 유일한 정답이 아니다.',
            '「그 밖의 위반행위」 리프(전체의 약 20%)의 항목은 덜 중요해서가 아니라 **우리 범주가 못 담아서** 거기 있다. '
            '트리 밖으로 빼지 않은 이유는 되묻기가 영영 도달하지 못하게 만들지 않기 위해서다. '
            '규칙을 넓히면 이 수치는 12%대까지 내려가지만 오탐이 늘어, 표본 정독으로 오탐 3종을 확인하고 '
            '규칙을 다시 좁혔다(설계 §3.2 — 커버리지보다 정확도를 택한 결과).',
            '참조 해소 실패 6건은 사유가 전부 확인됐고 항목의 `주의` 필드에 실려 있다 — 그중 1건'
            '(해양환경관리법 제132조제4항제17의2호 → 제76조제5항)은 **현행 법률 원문이 2019년에 삭제된 조문을 '
            '여전히 가리키고 있는 것**으로, 우리 로직의 결함이 아니라 원문 자체의 상태다.',
            '과태료의 **실제 부과금액은 이 트리에 없다** — 법률은 상한만 정하고 개별 금액은 시행령 「과태료의 부과기준」 별표의 '
            '표(1·2·3차 위반별)에 있다. 이번엔 그 별표 파일 경로·제목만 포인터로 달았고 표는 파싱하지 않았다.',
            '가중·감경은 **법률 본문에 문장으로 있는 것만** 담았다(양벌규정·병과·재범가중). 「질서위반행위규제법」의 자진납부 감경, '
            '형법총칙의 작량감경 등은 이 트리에 없다.',
            '참조 해소는 **1단계만** 한다 — 벌칙→금지조항까지는 풀지만, 그 금지조항이 다시 시행령·시행규칙에 위임한 내용은 '
            '따라가지 않는다(그 체인은 H-35 delegation_graph_full_73.json이 별도 자산으로 갖고 있다).',
            '이 트리는 **법정형**만 담는다. 실제 선고형·구약식·통고처분·훈방 등 처분 실무는 원문에 없어 담을 수 없다.',
            '부칙·경과규정과 "다른 법의 벌칙을 준용한다"는 조문(예: 어선법 제49조)은 항목으로 전개하지 않았다 — '
            '준용 조문 자체에는 형량 표현이 없어 스캔에 걸리지 않는다.',
            '벌칙은 법률에만 있다는 것을 실측으로 확인하고(74법 시행령·시행규칙 전체에서 형량 표현 매치 0건) '
            '`법률.txt`만 스캔했다. 자치법규·국제협약·행정규칙은 대상이 아니다.',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'laws_scanned': stat['laws_scanned'],
            'articles_scanned': stat['articles_scanned'],
            'laws_with_penalty': stat['laws_with_penalty'],
            'laws_without_penalty': stat['laws_scanned'] - stat['laws_with_penalty'],
            'penalty_articles': stat['penalty_articles'],
            'penalty_units': stat['penalty_units'],
            'deleted_ho_skipped': stat['deleted_ho'],
            'violation_entries': len(entries),
            'refs_total': len(refs),
            'refs_by_resolution': by_res,
            'refs_by_role': by_role,
            'nodes': len(nodes), 'leaves': len(leaves),
            'by_type': dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
            'by_sanction': dict(sorted(by_sanc.items(), key=lambda kv: -kv[1])),
            'per_law': dict(sorted(per_law.items(), key=lambda kv: -kv[1])),
        },
        'excluded_units': {
            '설명': '벌칙 조문 안에 있으나 위반행위 항목으로 전개하지 않은 단위. 무엇을 왜 뺐는지 남겨두어야 '
                    '다음 사람이 같은 판단을 반복하지 않는다(서류 트리 설계 §5.4와 같은 취지).',
            '목록': excluded,
        },
        'scan': {
            '설명': '74법 `법률.txt` 전수. 벌칙 조문 탐지는 조문제목("벌칙")이 아니라 **본문의 형량 표현**으로 한다 — '
                    '제목 없는 벌칙 조문과 「벌칙의 준용」 같은 제목이 실재하기 때문이다(설계 §5.3).',
            'laws_with_penalty': sorted(laws_hit),
            'laws_without_penalty': sorted({l['slug'] for l in LAWS} - set(laws_hit)),
        },
        'tree': root,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('OK → %s' % OUT)
    print('  법 %d(벌칙 있는 법 %d) · 벌칙조문 %d · 형량단위 %d · 위반행위 %d'
          % (stat['laws_scanned'], stat['laws_with_penalty'], stat['penalty_articles'],
             stat['penalty_units'], len(entries)))
    print('  참조 %d건 — %s' % (len(refs), by_res))
    print('  노드 %d · 리프 %d' % (len(nodes), len(leaves)))
    print('  유형별:', by_type)


if __name__ == '__main__':
    main()
