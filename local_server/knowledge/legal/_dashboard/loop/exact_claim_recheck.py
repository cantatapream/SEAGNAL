# -*- coding: utf-8 -*-
"""스스로 「원문과 똑같다」고 적어 둔 자리를 raw 와 다시 맞춰 본다. (3-33 · G-29)

왜 만드나
  위키 쪽 곳곳에 "raw 원문과 EXACT 대조 확인" 같은 줄이 붙어 있다.
  그 줄은 **스스로 적은 것**이다. 아무도 다시 안 맞춰 봤는데, 그 줄이 있다는
  이유로 재대조를 건너뛰게 된다(3-15 에서 실제로 그랬다).

세는 법 (뿌리 사슬 ⑥ — 재는 법을 먼저 적는다)
  · **살아 있는 주장**만 센다 — 앞머리 꼬리표 칸, 또는 `>` 각주.
    `| 2026-08-17 | …` 꼴 **이력 표 줄은 과거 서술**이라 세지 않는다(지우지도 않는다).
  · **검증 주장**과 **규약 되풀이**를 가른다.
    "EXACT 일치 확인"·"전수 대조" 는 주장이다.
    "원문 그대로 보존(요약 금지, 스키마 8절)" 은 **어떻게 쓰라는 규약**이지 주장이 아니다.
  · 주장 한 줄에 큰따옴표 인용이 있으면 **그 인용을 raw 에서 찾아본다.**
    인용이 없으면 「잴 수 없다」로 둔다 — **못 찾은 것과 같이 세지 않는다.**

맞추는 법
  · `…` 로 줄인 인용은 토막으로 갈라 **토막이 전부** 있어야 확인으로 친다.
  · 공백·줄바꿈은 지우고 본다(원문은 줄을 접어 두는 자리가 많다).
  · 어느 raw 를 볼지: ①줄이 `raw/…txt` 를 짚었으면 그것 ②아니면 쪽 이름의 법 폴더
    (`_dashboard/law_raw_paths.json`) 아래 `.txt` 전부.
"""
import os, re, sys, json, unicodedata

HERE  = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
ROOT  = os.path.dirname(os.path.dirname(os.path.dirname(LEGAL)))   # 지도 값이 저장소 뿌리 기준이다
RAW   = os.path.join(LEGAL, 'raw')
WIKI  = os.path.join(LEGAL, 'wiki')

VERIFY = re.compile(r'(EXACT\s*(일치|대조|확인)|전량\s*EXACT|원문\s*EXACT|전수\s*대조'
                    r'|재대조\s*(완료|확인)|원문\s*대조\s*[(:：]|대조\s*확인|일치\s*확인|grep\s*대조)')
RULE   = re.compile(r'(요약[·ㆍ]?\s*재?해석?\s*금지|요약\s*금지|그대로\s*보존|스키마\s*8\s*절)')
HIST   = re.compile(r'^\|\s*\d{4}-\d{2}-\d{2}')
# 따옴표 짝은 **같은 꼴끼리** 짚는다 — “…” 와 "…" 를 섞어 짚으면 엉뚱한 토막이 잡힌다.
# ⚠따옴표 짝은 **왼쪽부터 차례로** 짚는다. 길이 조건을 정규식 안에 넣으면 짧은 인용을
#   건너뛰면서 **그 닫는 따옴표와 다음 여는 따옴표**를 한 짝으로 잘못 묶는다(내 자의 버그였다).
#   그래서 먼저 다 짚고, 길이는 **짚은 뒤에** 거른다.
QUOTE  = re.compile(r'“([^“”]*)”|"([^"]*)"')
# 우리가 쓴 표시는 원문에 없다 — 견주기 전에 떼어 낸다.
MARKUP = re.compile(r'(\*\*|\*|`|\[\[|\]\])')
# ★raw 는 `"도선"이란` 으로 쓰고 위키는 `「도선」이란` 으로 쓴다. **인용부호 꼴이 달라서**
#   같은 글이 안 맞는 일이 있었다(내 자의 버그였다 — 도선법 제2조로 확인). 부호는 떼고 본다.
# ★raw 는 `제3ㆍ5호`, 위키는 `제3·5호` 로 쓴다. **가운뎃점 꼴이 달라서** 같은 글이 안 맞았다
#   (상법·수산업법 인용으로 확인 — 또 내 자의 버그였다). 점·줄표·물결표는 한 꼴로 눕혀 본다.
SAME = {'ㆍ': '·', '‧': '·', '•': '·', '∙': '·', '・': '·', '\u2219': '·',
        '—': '-', '–': '-', '─': '-', '∼': '~', '～': '~', '～': '~'}
QUOTECH = '\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f"\'\uff02\u00ab\u00bb'
# 원문 인용이 아니라 **우리 말**인 따옴표 — 이런 것은 「잴 거리」가 아니다.
OURS   = re.compile(r'(감사|H-\d|raw/|대조|확인|미인덱스|승격|승급|불가\b|\[제\d+조\]|wiki'
                    r'|판단할 수 없다|권장|검수|아니다|없다\b|이다\b|미반영|본 위키|이 쪽)')
# 원문이 **칸으로 쪼개진 표**면 글자를 이어 붙인 인용은 통째로는 절대 안 맞는다.
BOX    = '─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋'
RAWPATH= re.compile(r'raw/[^\s`"“”,·)]+\.txt')

def flat(s):
    """공백을 다 지우고 본다 — 원문은 줄을 접어 두는 자리가 많다."""
    t = MARKUP.sub('', unicodedata.normalize('NFC', s))
    t = ''.join(SAME.get(ch, ch) for ch in t if ch not in BOX and ch not in QUOTECH)
    return re.sub(r'\s+', '', t)

def law_map():
    try:
        return json.load(open(os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json'), encoding='utf-8'))
    except Exception:
        return {}

def claims():
    """살아 있는 검증 주장을 모은다 → [(쪽, 줄번호, 줄)]"""
    out = []
    for root, dirs, files in os.walk(WIKI):
        for f in sorted(files):
            if not f.endswith('.md'):
                continue
            p = os.path.join(root, f)
            lines = open(p, encoding='utf-8').read().split('\n')
            fm_end = lines.index('---', 1) if lines and lines[0] == '---' and '---' in lines[1:] else -1
            for i, ln in enumerate(lines):
                s = ln.strip()
                live = (fm_end > 0 and i < fm_end) or s.startswith('>')
                if not live or HIST.match(s):
                    continue
                if VERIFY.search(s):
                    out.append((p, i + 1, s))
    return out

def raw_pool(page, line, lmap, cache):
    """이 주장이 무엇과 대조했다는 것인가 → 읽어 볼 raw 본문들"""
    named = RAWPATH.findall(line)
    paths = []
    for n in named:
        ap = os.path.join(LEGAL, n)
        if os.path.exists(ap):
            paths.append(ap)
    if not paths:
        slug = os.path.basename(page).split('__')[0]
        rel = lmap.get(slug)
        if rel:
            base = os.path.join(ROOT, rel)
            base = base if os.path.isdir(base) else os.path.dirname(base)
            for r, _d, fs_ in os.walk(base):
                for f in fs_:
                    if f.endswith('.txt'):
                        paths.append(os.path.join(r, f))
    body = []
    for ap in paths:
        if ap not in cache:
            try:
                cache[ap] = flat(open(ap, encoding='utf-8').read())
            except Exception:
                cache[ap] = ''
        body.append((ap, cache[ap]))
    return body

def win_ratio(q, bodies, w=8, step=4):
    """표로 쪼개진 원문을 견주는 법 — 인용을 8글자 창으로 훑어 **몇 창이 원문에 있나**.
       한 줄로 이어 붙인 인용은 칸 표에서는 통째로 못 맞는다. 통째로 못 맞는 것을
       **없는 것**이라 부르면 표를 담은 쪽은 전부 거짓말쟁이가 된다."""
    f = flat(q)
    if len(f) < w:
        return 1.0 if any(f in b for _a, b in bodies) else 0.0
    wins = [f[i:i + w] for i in range(0, len(f) - w + 1, step)]
    hit = sum(1 for x in wins if any(x in b for _a, b in bodies))
    return hit / len(wins)


_WIDE = []


def wide_pool():
    """쪽 이름의 법에서 못 찾았을 때 — **raw 전체**에서 다시 찾아본다.
       개념 쪽은 **다른 법을 인용**하는 일이 잦다. 제 법에서 안 나온다고
       「원문에 없다」고 적으면, 그건 내 자가 좁은 것이지 쪽이 틀린 게 아니다."""
    if _WIDE:
        return _WIDE
    buf, cur = [], []
    for r, _d, fs_ in os.walk(RAW):
        for f in fs_:
            if not f.endswith('.txt'):
                continue
            try:
                cur.append(flat(open(os.path.join(r, f), encoding='utf-8').read()))
            except Exception:
                pass
            if len(cur) >= 120:
                buf.append('\u0001'.join(cur)); cur = []
    if cur:
        buf.append('\u0001'.join(cur))
    _WIDE.extend(('raw 전체', b) for b in buf)
    return _WIDE


def main():
    lmap, cache = law_map(), {}
    tally = {'확인됨': 0, '확인됨(표로 쪼개짐)': 0, '확인됨(제 법이 아닌 다른 raw)': 0, '못 찾음': 0, '잴 수 없음(인용 없음)': 0, '잴 수 없음(raw 못 찾음)': 0}
    misses = []
    for page, ln, text in claims():
        quotes = [q for q in (a or b for a, b in QUOTE.findall(text)) if len(q) >= 8]
        quotes = [q for q in quotes if not OURS.search(q)]     # 우리 말은 빼고 **원문 인용만**
        if not quotes:
            tally['잴 수 없음(인용 없음)'] += 1
            continue
        pool = raw_pool(page, text, lmap, cache)
        if not pool:
            tally['잴 수 없음(raw 못 찾음)'] += 1
            continue
        bad, part, widehit = [], [], []
        for q in quotes:
            parts = [flat(x) for x in re.split(r'…+|\.\.\.+', q) if flat(x)]
            if not parts:
                continue
            if any(all(pt in b for pt in parts) for _ap, b in pool):
                continue                       # 통째로 있다
            wide = wide_pool()
            if all(any(pt in b for _a, b in wide) for pt in parts):
                widehit.append(q)              # 제 법이 아니라 **다른 raw** 에 있다
                continue
            r = min(win_ratio(x, pool) for x in parts)
            if r >= 0.9:
                part.append((q, r))            # 표로 쪼개져 있을 뿐 글자는 다 있다
            else:
                bad.append((q, r))
        if bad:
            tally['못 찾음'] += 1
            misses.append((page, ln, bad, [os.path.relpath(a, LEGAL) for a, _ in pool][:3]))
        elif part:
            tally['확인됨(표로 쪼개짐)'] += 1
        elif widehit:
            tally['확인됨(제 법이 아닌 다른 raw)'] += 1
        else:
            tally['확인됨'] += 1
    for k, v in tally.items():
        print(f'{k:22s} {v:5d}')
    print('합계', sum(tally.values()))
    if misses:
        print(f'\n=== raw 에서 못 찾은 인용을 담은 주장 {len(misses)}개 ===')
        for page, ln, bad, pool in misses[:int(os.environ.get('SHOW', '40'))]:
            print(f'\n· {os.path.relpath(page, LEGAL)}:{ln}')
            for q, r in bad[:3]:
                print(f'    ✗ ({r:.0%}) "{q[:110]}"')
            print(f'    본 raw: {", ".join(pool)}')
    json.dump([{'쪽': os.path.relpath(p, LEGAL), '줄': l,
                '못찾은인용': [{'글': q, '맞은창': round(x, 2)} for q, x in b], '본raw': r}
               for p, l, b, r in misses],
              open(os.path.join(HERE, '..', 'exact_claim_misses.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # ── 게이트 모드 (2026-09-24 추가, G-29) ──────────────────────────────────
    # ★3-33 은 *"이 자는 판정자가 못 된다"* 며 게이트로 만들지 않았다. **그 판단은 옳다** —
    #   「못 찾음」은 빨간불 가운데 참이 소수라 게이트로 삼으면 거짓 경보가 된다.
    #   그런데 **판정할 수 있는 숫자가 하나 있다**: **「잴 수 없음(인용 없음)」**.
    #   *"원문과 똑같다"* 고 적어 놓고 **무엇과 똑같은지 인용을 안 적은 줄**은,
    #   참·거짓 이전에 **확인이 구조적으로 불가능**하다. 오탐이 있을 수 없다.
    #   ⇒ 그것만 잠근다. ★줄을 지워서 초록을 만들지 않는다(G-34) — **인용을 적어야** 줄어든다.
    if '--gate' in sys.argv or '--update' in sys.argv:
        base_f = os.path.join(HERE, 'baseline', 'exact_claim.json')
        now = {'인용없음': tally['잴 수 없음(인용 없음)']}
        잴수있다 = sum(v for k, v in tally.items() if k != '잴 수 없음(인용 없음)')
        print()
        print('  V5-43 「원문과 똑같다」면서 **무엇과 똑같은지 안 적은 줄** (G-29)')
        print(f'    살아 있는 EXACT 주장 {sum(tally.values())}줄')
        print(f'    ·  인용이 있어 잴 수 있다   {잴수있다:5}')
        print(f"    {'❌' if now['인용없음'] else '✅'} ★인용이 없어 못 잰다     {now['인용없음']:5}"
              '   확인이 **구조적으로 불가능**하다')
        if '--update' in sys.argv:
            os.makedirs(os.path.dirname(base_f), exist_ok=True)
            json.dump(now, open(base_f, 'w', encoding='utf-8'), ensure_ascii=False)
            print('    기준선을 다시 구웠다:', now)
        if '--gate' in sys.argv:
            try:
                base = json.load(open(base_f, encoding='utf-8'))
            except Exception:
                print('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다')
                return 0
            if now['인용없음'] > base['인용없음']:
                print(f"    ❌ 늘었다 인용없음 {base['인용없음']}→{now['인용없음']}")
                print('       고치는 법: 그 줄에 **무엇과 맞췄는지 큰따옴표로 인용**을 적는다.')
                print('       ★주장을 지우지 않는다 — 지우면 확인한 사실까지 사라진다.')
                return 1
            print('    ✅ 기준선 그대로 — 늘지 않았다' if now['인용없음'] == base['인용없음']
                  else f"    ✅ 줄었다 인용없음 {base['인용없음']}→{now['인용없음']} — `--update` 로 잠근다")
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
