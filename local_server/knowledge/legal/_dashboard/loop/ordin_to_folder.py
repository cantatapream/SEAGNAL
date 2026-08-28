#!/usr/bin/env python3
"""조례(자치법규) 원문을 **챗봇이 열 수 있는 꼴**로 바꿔 폴더에 넣는다.

무엇을 고치려는 것인가 (배경은 `_dashboard/ORDIN_LINK_FINDING.md`):
  근거 조문 표에서 눌러도 원문이 안 열리는 줄 261개 가운데 63개가 **조례**였다.
  조례 원문은 이미 받아 놨는데(166개 파일) 챗봇이 그 파일을 ①찾지도 못하고 ②찾아도 못 읽는다.
   ①`law_raw_paths.json`(법명 → raw 폴더)에 조례가 없다. 그 표는 "폴더"를 가리키는데
     조례는 폴더 없이 `<시도>/<이름>.txt` 로 납작하게 놓여 있었다.
   ②조례 파일 생김새가 법률·시행령과 다르다. `article_text.js` 의 법률 파서는 줄머리 `[제10조]` 를,
     고시 파서는 줄머리 `제10조(` 를 찾는데, 조례 파일 146개는 파이썬 dict 를 그대로 적어 둔 꼴이라
     둘 중 어느 쪽에도 안 걸린다.

이 스크립트가 하는 일:
  `raw/_자치법규/<시도>/<이름>.txt`
      → `raw/_자치법규/<시도>/<이름>/법률.txt`   (조례·규칙 본체)
      → `raw/_자치법규/<시도>/<부모조례>/시행규칙.txt`  (조례의 시행규칙. 부모가 없으면 자기 폴더의 시행규칙.txt)
  내용은 법률 계열 표기(`[제N조] 제목` + 본문)로 바꿔 쓴다. **원문 글자는 그대로 옮기고,
  줄바꿈만 넣는다.**

지어내지 않기 위해 지키는 것:
  - 조문은 dict 의 `조내용` 을 그대로 쓴다. 정규식으로 "제N조처럼 보이는 곳"을 잘라내지 않는다
    (조문 안의 다른 법 인용 `「○○조례」제7조에 따라` 를 새 조로 오인할 수 있다).
  - **항(①②③…)에서만 줄을 나눈다.** 호(`1.` `2.`)는 나누지 않는다 — 조문 안 인용(`제2조제1항`)과
    헷갈릴 수 있고, `article_text.js` 는 "호 번호가 1부터 차례가 아니면 쪼개기를 포기하고 항을
    통째로 보여준다"는 계약을 이미 갖고 있어 그대로 두는 편이 안전하다.
  - 파일 머리말(지자체·시행일·⚠REVIEW 메모)과 `[부칙]` 블록은 **잃지 않고** 그대로 옮긴다.
  - 조문이 하나도 없는 파일(별표만 발췌해 둔 것)은 **건드리지 않는다.**

쓰는 법:
    python3 _dashboard/loop/ordin_to_folder.py            # 무엇을 할지만 보여준다(파일 안 바꿈)
    python3 _dashboard/loop/ordin_to_folder.py --apply    # 실제로 옮긴다
    python3 _dashboard/loop/ordin_to_folder.py --apply --paths   # 옮긴 뒤 law_raw_paths.json 도 갱신

[연계] → `_dashboard/law_raw_paths.json`(--paths) · `services/article_text.js` 의 resolveBase/TIER_FILE
        ← `_dashboard/ORDIN_LINK_FINDING.md`(왜 하는지) · `_touched.py`(되돌리기 기록)
"""
import ast, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                    # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
ORDIN = os.path.join(LEGAL, 'raw', '_자치법규')
PATHS_JSON = os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json')

DICT_RE = re.compile(r"\{'조문번호':.*?'조문여부':\s*'[YN]'\s*\}")
HANG_RE = re.compile(r'(?<!^)(?=[①-⑳])')          # 항 마커 앞에서만 자른다
PLAIN_ART_RE = re.compile(r'(?:^|\n)제\d+조(?:의\d+)?\(')
# 조문 덩어리가 시작되는 자리 — 한 줄에 dict 하나씩인 꼴(`{'조문번호'`)과
# 파일 전체가 한 줄짜리 큰 덩어리인 꼴(`{'조': [`) 두 가지가 있다(실측 7개 · 142개).
BODY_START_RE = re.compile(r"\{'조'\s*:|\{'조문번호'\s*:")
BUCHIK_RE = re.compile(r"(?m)^부칙:\s*(.+)$")


def jo_label(num):
    """조문번호 6자리를 조 표기로 바꾼다. 예: '000100' → '제1조', '001002' → '제10조의2'."""
    s = str(num)
    if len(s) != 6 or not s.isdigit():
        return None
    jo, ga = int(s[:4]), int(s[4:])
    return '제%d조의%d' % (jo, ga) if ga else '제%d조' % jo


def body_of(jo, content):
    """`조내용`에서 앞머리 `제N조(제목)` 표기를 떼고 항마다 줄을 나눈다.

    예: body_of('제3조', '제3조(복무규정)① 승무원의…② 승무원은…')
        → '① 승무원의…\n② 승무원은…'
    앞머리를 못 떼면 **원문을 통째로 남긴다**(글자를 잃는 것이 섞여 나오는 것만큼 나쁘다).
    """
    t = str(content or '').strip()
    m = re.match(r'^' + re.escape(jo) + r'\s*(?:\([^)]*\))?\s*', t)
    if m:
        t = t[m.end():]
    return HANG_RE.sub('\n', t).strip()


def buchik_of(text):
    """부칙을 원문 그대로 뽑는다. 두 꼴이 있고, 없으면 빈 문자열.

    ⑴ `[부칙]` 아래에 평문으로 붙어 있는 꼴(한 줄에 dict 하나씩인 파일).
    ⑵ 파일 끝에 `부칙: {'부칙공포일자': …, '부칙내용': '…'}` 한 줄로 붙어 있는 꼴.
    ⑶ 파일 끝에 `부칙: 부칙 <조례 제7403호…> 이 조례는 …` 처럼 **평문 한 줄**로 붙어 있는 꼴.
    어느 쪽도 아니면 **지어내지 않고 빈 문자열**을 돌려준다.
    """
    i = text.find('\n[부칙]')
    if i >= 0:
        return text[i + 1:].strip()
    m = BUCHIK_RE.search(text)
    if not m:
        return ''
    raw = m.group(1).strip()
    if raw.startswith('{'):
        try:
            o = ast.literal_eval(raw)
        except Exception:
            return ''
        raw = str(o.get('부칙내용', '') or '').strip()
    return '[부칙]\n' + raw if raw else ''


def convert(text):
    """조례 원문 한 벌을 법률 계열 표기로 바꾼다. 조문을 못 찾으면 None(=건드리지 않음)."""
    dicts = DICT_RE.findall(text)
    arts = []
    for d in dicts:
        try:
            o = ast.literal_eval(d)
        except Exception:
            return None                                  # 하나라도 못 읽으면 통째로 포기한다
        jo = jo_label(o.get('조문번호', [''])[0])
        if not jo:
            return None
        arts.append((jo, str(o.get('조제목', '') or '').strip(), body_of(jo, o.get('조내용'))))
    if not arts:
        return None

    m0 = BODY_START_RE.search(text)
    head = text[:m0.start()].rstrip() if m0 else ''
    tail = buchik_of(text)

    out = [head, ''] if head else []
    for jo, title, body in arts:
        out.append('[%s] %s' % (jo, title) if title else '[%s]' % jo)
        if body:
            out.append(body)
        out.append('')
    if tail:
        out.append(tail)
    return '\n'.join(out).rstrip() + '\n'


def plan():
    """무엇을 어디로 옮길지 정한다. [(원본경로, 새경로, 새내용 또는 None(그대로 옮김))]"""
    stems = {}
    for d, _, fs in os.walk(ORDIN):
        for f in fs:
            if f.endswith('.txt'):
                stems.setdefault(d, []).append(f[:-4])
    jobs, skipped = [], []
    for d, names in sorted(stems.items()):
        nameset = set(names)
        for stem in sorted(names):
            src = os.path.join(d, stem + '.txt')
            text = open(src, encoding='utf-8').read()
            if not DICT_RE.search(text) and not PLAIN_ART_RE.search(text):
                skipped.append((src, '조문이 없다(별표 발췌본)'))
                continue
            new = convert(text) if DICT_RE.search(text) else text   # 평문 꼴은 그대로 쓴다
            if new is None:
                skipped.append((src, 'dict 를 못 읽었다 — 손대지 않는다'))
                continue
            if stem.endswith('시행규칙'):
                parent = stem[:-len('시행규칙')]
                folder = parent if parent in nameset else stem
                dst = os.path.join(d, folder, '시행규칙.txt')
            else:
                dst = os.path.join(d, stem, '법률.txt')
            jobs.append((src, dst, new))
    return jobs, skipped


def main():
    apply_ = '--apply' in sys.argv
    jobs, skipped = plan()
    print('옮길 파일 %d개 · 손대지 않을 파일 %d개' % (len(jobs), len(skipped)))
    for s, why in skipped:
        print('  ⏭️  %s  — %s' % (os.path.relpath(s, LEGAL), why))
    if not apply_:
        for s, dst, _ in jobs[:8]:
            print('  · %s → %s' % (os.path.relpath(s, LEGAL), os.path.relpath(dst, LEGAL)))
        print('  … (--apply 를 붙이면 실제로 옮긴다)')
        return

    touched = Touched('ordin_to_folder')
    for src, dst, new in jobs:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'w', encoding='utf-8').write(new)
        os.remove(src)
        touched.add(dst)
        touched.add(src)
    print('옮김 %d개' % len(jobs))

    if '--paths' in sys.argv:
        m = json.load(open(PATHS_JSON, encoding='utf-8'))
        added = 0
        for _, dst, _ in jobs:
            folder = os.path.dirname(dst)
            key = os.path.basename(folder)
            rel = os.path.relpath(folder, REPO)
            if key not in m:
                m[key] = rel
                added += 1
        json.dump(m, open(PATHS_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.add(PATHS_JSON)
        print('law_raw_paths.json 에 %d개 이름을 새로 넣었다(기존 항목은 손대지 않음).' % added)
    touched.save()


if __name__ == '__main__':
    main()
