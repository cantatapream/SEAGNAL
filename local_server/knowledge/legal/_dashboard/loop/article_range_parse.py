# -*- coding: utf-8 -*-
"""꼬리표의 **사람 말 `조문범위`** 를 기계가 읽는 조문 번호 목록으로 편다. (3-3 = ⓐ)

무엇이 문제였나
  타법은 전문을 안 받고 **필요한 조문만 발췌**해 둔다. 어디까지 받았는지는
  `families.<계층>.조문범위` 에 **사람 말로** 적혀 있다:

      "제5조(「지방세기본법」…의 적용), 제28조제1항제9호·⑥(어업권 등록면허세 세율)"

  기계가 이 줄을 못 읽어서 **「이 조문이 우리 발췌 안에 있나」를 검사할 수 없었다.**
  그래서 챗봇이 발췌 밖 조문을 물으면 **「법에 없다」와 「우리가 안 받았다」가 구분이 안 된다.**
  ⇒ 사용자 확정 ⓐ: `조문범위_기계` 라는 **배열 칸**을 나란히 둔다.

왜 옛 글을 안 지우나
  사람 말에는 **까닭**이 적혀 있다(*"어업권·양식업권 등록면허세 세율"*).
  배열은 그것을 못 담는다. 그래서 **둘을 함께 둔다** — 이 저장소 규약
  (옛 서술을 지우지 않고 정정·보강만 붙인다)과 같다.

무엇을 조심했나 (환각 0)
  ★**한 항목이라도 못 읽으면 그 자리는 배열을 아예 안 만든다.**
    절반만 펴서 그중 하나를 「받은 조문」이라고 내보이는 것이 제일 나쁘다
    (`article_text.js` 의 `expandJoEnum()` 과 같은 규약).
  ★**동그라미 숫자는 항이다** — `제18조⑦` = 제18조제7항, `제28조제1항제9호·⑥` 의
    `⑥` 은 앞 조의 **제6항**이다(호가 아니다). 실측으로 확인했다.
  ★**별지서식은 조가 아니다** — `별지 제9호서식` 은 조문 목록에 안 넣고
    `서식` 갈래로 따로 적는다.
  ★가운뎃점 묶음은 **바로 앞 마디와 같은 단위**로 편다 — `제63ㆍ64조`는 조,
    `제8조제7·8·9항`은 항, `제2조제1호·제3호`는 호.

[연계] → `raw/**/_meta.json` 의 `families.<계층>.조문범위_기계`
        ← 세는 자: `_dashboard/loop/article_range_gate.js`(V5-36)
사용법: python3 article_range_parse.py [--apply] [--list]
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
from _touched import Touched                                      # noqa: E402

CIRCLED = {c: i + 1 for i, c in enumerate('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳')}
MID = '[·ㆍ・]'
RANGE = '[~∼～]'

# ★가장 중요한 가드 — 「안 받았다」가 적혀 있으면 배열을 만들지 않는다.
#   실측: 1969년선박톤수측정협약이 *"제5~22조(…절차조항)는 여전히 미수집"* 이라 적었다.
#   그냥 읽으면 **안 받은 조문을 받았다고 적게 된다** — 이 저장소에서 가장 하면 안 되는 일이다.
#   ⚠`제외` 는 가드에 넣지 않는다 — 섬발전촉진법의 *"섬의 정의 및 제외(제주도 본도 등)"* 처럼
#     **받은 조문의 내용 설명**인 경우가 있다(실측).
NEGATIVE = re.compile(r'미수집|미제공|미확보|안\s*받|못\s*받|수집\s*안|빠졌|없음\s*확인')

PAREN = re.compile(r'\([^()]*\)')
BRACKET = re.compile(r'[「」『』]')
FORM = re.compile(r'별지\s*제\s*(\d+)\s*호(?:의\s*(\d+))?\s*서식')
ANNEX = re.compile(r'(부속서\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX0-9]+|별표\s*\d+(?:의\d+)?|별지\s*\d+)')
JO = re.compile(r'제\s*(\d+)\s*조(?:\s*의\s*(\d+))?')
# 조 단위 가운뎃점 묶음·범위를 먼저 펴 놓는다 (`제63ㆍ64조` → `제63조·제64조`)
JO_GROUP = re.compile(r'제\s*((?:\d+\s*' + MID + r'\s*)+\d+)\s*조')
JO_RANGE = re.compile(r'제\s*(\d+)\s*' + RANGE + r'\s*(\d+)\s*조')
JO_BRANCH_RANGE = re.compile(r'제\s*(\d+)\s*조\s*의\s*(\d+)\s*' + RANGE + r'\s*(\d+)')
# `제735의3조` — `의` 가 `조` 앞에 온 뒤집힌 표기(실측: 상법)
JO_FLIP = re.compile(r'제\s*(\d+)\s*의\s*(\d+)\s*조')
HANG = re.compile(r'제\s*(\d+)\s*항')
HO = re.compile(r'제\s*(\d+)\s*호')
HANG_GROUP = re.compile(r'(?:제\s*)?((?:\d+\s*' + MID + r'\s*)+\d+)\s*항')
HO_GROUP = re.compile(r'(?:제\s*)?((?:\d+\s*' + MID + r'\s*)+\d+)\s*호')
# 아직 안 읽은 「숫자 + 단위」가 남아 있으면 **못 읽은 것**이다. 설명 글자만 남으면 버린다.
LEFTOVER_UNIT = re.compile(r'\d+\s*(?:조|항|호|목|편|장|절|관)')

# ★괄호 **안**에 적힌 「이 조는 일부만」 표시. 이것을 버리면 **조 전체를 받은 것처럼** 적힌다
#   (실측 2026-09-24: `제2조(정의, 7·8호만)` · `제2조(정의, 일부)` · `제4조(제목만)`).
#   ⚠괄호 **밖**의 `만` 은 뜻이 다르다 — `제1조(일반의무)만 발췌` 는 「목록이 제1조 하나뿐」
#     이라는 말이고 제1조 자체는 온전하다. 그래서 괄호 안만 본다.
PARTIAL_IN_PAREN = re.compile(r'일부|제목만|[\d\s·ㆍ・]+호만|[\d\s·ㆍ・]+항만|일부만')
JO_WITH_PAREN = re.compile(r'제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*\(([^()]*)\)')


def normalize(s):
    """가운뎃점 묶음·범위·뒤집힌 표기를 **펴 놓은** 뒤에 읽는다."""
    s = BRACKET.sub(' ', str(s or ''))
    s = JO_FLIP.sub(lambda m: f'제{m.group(1)}조의{m.group(2)}', s)
    s = JO_BRANCH_RANGE.sub(
        lambda m: '·'.join(f'제{m.group(1)}조의{n}'
                           for n in range(int(m.group(2)), int(m.group(3)) + 1)), s)
    s = JO_RANGE.sub(
        lambda m: '·'.join(f'제{n}조' for n in range(int(m.group(1)), int(m.group(2)) + 1)), s)
    s = JO_GROUP.sub(
        lambda m: '·'.join(f'제{n}조' for n in re.findall(r'\d+', m.group(1))), s)
    return s


def strip_parens(s):
    prev = None
    while prev != s:
        prev = s
        s = PAREN.sub(' ', s)
    return s


def jo_label(n, branch):
    return f'제{n}조의{branch}' if branch else f'제{n}조'


def partials_of(text):
    """괄호 안에 「일부만」이 적힌 조 표기들 — 온전히 받은 것처럼 적지 않기 위해 따로 모은다."""
    out = []
    for m in JO_WITH_PAREN.finditer(str(text or '')):
        if PARTIAL_IN_PAREN.search(m.group(3)):
            lab = jo_label(m.group(1), m.group(2))
            if lab not in out:
                out.append(lab)
    return out


def parse(text):
    """→ (조문목록, 서식목록, 부속서·별표목록, 못읽은조각, 가드사유)"""
    s = str(text or '')
    if NEGATIVE.search(s):
        return [], [], [], [], '「안 받았다」가 적혀 있다 — 기계가 가르면 안 받은 것을 받았다고 적는다'
    jos, forms, annexes, bad = [], [], [], []
    # ① 별지서식·부속서·별표를 먼저 떼어 낸다 — 이들은 **조가 아니다**
    for m in FORM.finditer(s):
        forms.append('별지 제%s호%s서식' % (m.group(1), ('의' + m.group(2)) if m.group(2) else ''))
    s = FORM.sub(' ', s)
    # ★괄호 설명을 **별표를 떼기 전에** 먼저 지운다 —
    #   `별표1 제3호나목2)(호소 생활환경기준)ㆍ제3호라목1)` 처럼 괄호가 두 조각 **사이에**
    #   끼어 있으면 뒤엣것을 못 먹고 그 `제3호` 가 앞 조의 호로 새어 든다(실측 2026-09-24).
    s = strip_parens(s)
    # ★별표·부속서는 그 뒤에 딸린 호·목까지 **한 조각으로** 떼어 낸다 —
    #   `별표1 제3호나목2)` 의 `제3호` 를 조문의 호로 읽으면 엉뚱한 것을 가리킨다(실측).
    def _annex(m):
        annexes.append(re.sub(r'\s+', ' ', m.group(0)).strip())
        return ' '
    # ★가운뎃점으로 이어지는 호·목 묶음까지 **한 조각으로** 먹는다 —
    #   `별표1 제3호나목2)ㆍ제3호라목1)` 의 뒤엣것을 놓치면 그 `제3호` 가
    #   앞 조의 호로 새어 들어가 **없는 조문(제2조제3호)을 만들어 낸다**(실측 2026-09-24).
    _SUB = r'(?:\s*제?\s*\d+\s*호)?(?:\s*[가-하]\s*목)?(?:\s*\d+\s*\))?(?:\s*규칙\s*\d+)?'
    s = re.sub(ANNEX.pattern + _SUB + r'(?:\s*[·ㆍ・]' + _SUB + r')*', _annex, s)
    s = normalize(s)
    last = None                                     # 앞 마디의 조 — `제3항` 만 적힌 마디가 잇는다
    for chunk in re.split(r'[,;/+]', s):
        chunk = chunk.strip()
        if not chunk:
            continue
        got, last2 = _parse_chunk(chunk, last)
        if got is None:
            bad.append(re.sub(r'\s+', ' ', chunk)[:60])
        else:
            jos.extend(got)
            if last2:
                last = last2
    seen, out = set(), []
    for j in jos:
        if j not in seen:
            seen.add(j); out.append(j)
    return out, forms, annexes, bad, ''


def _parse_chunk(chunk, last):
    """마디 하나 → (조 표기 목록, 이 마디의 마지막 조). 못 읽으면 (None, None)."""
    ms = list(JO.finditer(chunk))
    if not ms:
        # 조가 없는 마디. 항·호만 적혀 있으면 **앞 조를 잇는다**(실측: `제5조(안전인증 등) 제3항`).
        subs = _parse_sub(last, chunk) if last else None
        if subs:
            return subs, last
        # 읽을 「숫자+단위」가 없으면 설명 글자다 — 버린다.
        return ([], None) if not LEFTOVER_UNIT.search(chunk) else (None, None)
    out = []
    for i, m in enumerate(ms):
        base = jo_label(m.group(1), m.group(2))
        seg = chunk[m.end(): ms[i + 1].start() if i + 1 < len(ms) else len(chunk)]
        subs = _parse_sub(base, seg)
        if subs is None:
            return None, None
        out.extend(subs)
    return out, jo_label(ms[-1].group(1), ms[-1].group(2))


def _parse_sub(base, seg):
    """조 뒤에 붙은 항·호를 읽는다. 아무것도 없으면 조 하나. 못 읽으면 None."""
    hangs, hos = [], []
    for grp in HANG_GROUP.findall(seg):
        hangs += [int(n) for n in re.findall(r'\d+', grp)]
    for grp in HO_GROUP.findall(seg):
        hos += [int(n) for n in re.findall(r'\d+', grp)]
    rest = HANG_GROUP.sub(' ', seg)
    rest = HO_GROUP.sub(' ', rest)
    for m in HANG.finditer(rest):
        hangs.append(int(m.group(1)))
    for m in HO.finditer(rest):
        hos.append(int(m.group(1)))
    rest = HANG.sub(' ', rest)
    rest = HO.sub(' ', rest)
    for ch in rest:
        if ch in CIRCLED:
            hangs.append(CIRCLED[ch])
    rest = ''.join(' ' if ch in CIRCLED else ch for ch in rest)
    # ★`제`가 없는 맨숫자 호 — `제2조(정의)4호` 처럼 적힌 것(실측: 수산업협동조합법).
    #   괄호를 떼면 `4호` 만 남는다. 앞의 `제N조`·`제N항`·`제N호` 는 이미 위에서 먹었으니
    #   여기 남은 「숫자+호」는 이 조의 호로 읽는다.
    for m in re.finditer(r'(\d+)\s*호', rest):
        hos.append(int(m.group(1)))
    rest = re.sub(r'\d+\s*호', ' ', rest)
    # 아직 안 읽은 「숫자+단위」가 남으면 못 읽은 것이다. 설명 글자만 남으면 버린다.
    if LEFTOVER_UNIT.search(rest):
        return None
    if not hangs and not hos:
        return [base]
    hs, os_ = sorted(set(hangs)), sorted(set(hos))
    # ★항과 호가 **함께** 적힌 자리 — 사람 말은 하나를 가리킨다(`제2조제1항제11호`).
    #   이것을 `제2조제1항` 과 `제2조제11호` 로 **쪼개면 없는 조문을 만들어 낸다**
    #   (실측 2026-09-24 물류정책기본법에서 실제로 그렇게 잘못 적었다).
    #   · 항이 하나면 → 붙여 적는다(사람 말 그대로).
    #   · 항이 여럿이면서 호도 있으면 → **짝을 기계가 지어내지 않는다.** 사람 몫이다
    #     (`제28조제1항제9호·⑥` 은 「제1항제9호 그리고 제6항」인지 다른 뜻인지 기계가 못 가린다).
    if hs and os_:
        if len(hs) > 1:
            return None
        return [f'{base}제{hs[0]}항제{o}호' for o in os_]
    return [f'{base}제{h}항' for h in hs] or [f'{base}제{o}호' for o in os_]


def main():
    apply_ = '--apply' in sys.argv
    show = '--list' in sys.argv
    touched = Touched('article_range_parse') if apply_ else None
    tally = collections.Counter()
    for r, _d, fs in os.walk(RAW):
        if '_meta.json' not in fs or '/_대기/' in r.replace(os.sep, '/'):
            continue
        p = os.path.join(r, '_meta.json')
        try:
            j = json.load(open(p, encoding='utf-8'))
        except Exception:
            continue
        fam = j.get('families')
        if not isinstance(fam, dict):
            continue
        changed = False
        for layer, v in fam.items():
            if not isinstance(v, dict) or not v.get('조문범위'):
                continue
            tally['자리'] += 1
            jos, forms, annexes, bad, guard = parse(v['조문범위'])
            here = os.path.relpath(r, RAW)[:38]
            if guard:
                tally['★가드 — 사람 몫'] += 1
                if show:
                    print('⛔ %-38s %-12s %s' % (here, layer, guard))
                continue
            if bad:
                tally['못 읽음(배열 안 만든다)'] += 1
                if show:
                    print('❌ %-38s %-12s 못 읽은 조각: %s' % (here, layer, ' | '.join(bad)))
                continue
            if not (jos or forms or annexes):
                tally['조문 표기가 없다'] += 1
                if show:
                    print('·  %-38s %-12s (조문 표기 없음) %s' % (here, layer, v['조문범위'][:45]))
                continue
            tally['읽었다'] += 1
            if show:
                extra = ''
                if forms:
                    extra += '  [서식]' + '·'.join(forms)
                if annexes:
                    extra += '  [별표·부속서]' + '·'.join(annexes)
                part = [x for x in partials_of(v['조문범위']) if x in jos]
                if part:
                    extra += '  ⚠일부만:' + '·'.join(part)
                print('✅ %-38s %-12s %d개 %s%s' % (
                    here, layer, len(jos), '·'.join(jos)[:62], extra))
            if apply_:
                if jos:
                    v['조문범위_기계'] = jos
                if forms:
                    v['서식범위_기계'] = forms
                if annexes:
                    v['별표부속서범위_기계'] = annexes
                part = [x for x in partials_of(v['조문범위']) if x in jos]
                if part:
                    v['조문범위_일부만_기계'] = part
                v['_조문범위_기계_출처'] = (
                    'article_range_parse (3-3 = ⓐ, 2026-09-24) — 위 `조문범위` 사람 말을 그대로 '
                    '읽어 편 것이다. 사람 말은 **까닭**을 담고 있어 지우지 않는다. '
                    '한 조각이라도 못 읽으면 이 칸을 아예 만들지 않는다(환각 0). '
                    '「미수집」이 적힌 자리는 기계가 손대지 않는다 — 안 받은 것을 받았다고 '
                    '적게 되기 때문이다.')
                changed = True
        if apply_ and changed:
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(j, f, ensure_ascii=False, indent=2)
            touched.add(p)
    print()
    for k in sorted(tally):
        print(f'  {k:28s} {tally[k]}')
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
