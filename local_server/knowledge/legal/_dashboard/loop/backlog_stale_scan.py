#!/usr/bin/env python3
"""백로그 미해소 항목 중 **이미 위키가 답하고 있을 가능성이 있는 것**을 추려 낸다(후보 목록).

왜 (2026-08-31, 백로그 13회차에서 사서 넷이 독립적으로 같은 것을 보고했다):
  · 해운법 S26 은 근거란에 "grep '26조의4' 결과 0건"이라 적혀 있었는데 다시 돌리니 4건이었다.
  · 해양생태계는 과거 라운드가 원문을 확인해 위키에 정확히 써 놓고도 **체크박스만 안 바꾼 항목이 26건**.
  · 수산종자의 "제주 특례가 위키 어디에도 없다" 판정은 두 라운드 전에 이미 반영된 것이었다.
  · 낚시의 "닻·싱커·건현 규정 위키 전무" 3건은 19차 감사에서 이미 해소돼 있었다.
  즉 **백로그가 낡은 전제를 품고 라운드를 넘어온다.** 사서가 매번 손으로 찾아내고 있다.

무엇을 하나
  미해소 줄의 **항목 ID**(둘째 칸, 예 `L6`·`U8`·`R12-W11`)가 그 법의 위키 본문에
  이미 언급돼 있는지 본다. 언급돼 있으면 과거 라운드가 그 항목을 대응했다는 흔적이므로
  **"이미 답이 있을 수 있다"는 후보**로 뽑는다.

⚠이건 판정이 아니라 **후보 목록이다.** 그대로 체크하면 안 된다.
  같은 ID가 라운드마다 **다른 질문에 재사용**된다(해양생태계 사서가 G2·N37 등 6건에서 실측).
  그래서 반드시 **질문 본문과 위키 인용문을 사람(사서)이 대조**해야 한다.
  이 도구는 "어디를 먼저 볼지"만 좁혀 준다.

[연계]
  - 읽음: _dashboard/backlog/*.md · wiki/**/*.md · _dashboard/law_raw_paths.json(법 이름)
  - 씀:   _dashboard/backlog_stale_candidates.json (후보 목록만 — 백로그는 건드리지 않는다)
사용법: python3 backlog_stale_scan.py [--law <법이름>] [--top N]
"""
import glob, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(LEGAL, '_dashboard', 'backlog_stale_candidates.json')

# ★ID 는 **글자와 숫자를 모두** 가진 것만 쓴다(2026-08-31, 처음 만들고 바로 표본을 열어 고침).
#   처음에는 숫자만 있는 ID(`109`·`118`·`155`)도 받았는데, 그러면 위키 안의 조문번호·쪽번호에
#   전부 걸려 수산종자산업육성법 한 법에서만 248건이 후보로 나왔다 — 표본 셋을 열어 보니
#   전부 오탐이었다. 순수 숫자 ID 는 뺀다.
ID_OK = re.compile(r'^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]+)*$')
# ★`R6`·`R19` 처럼 **라운드 번호와 똑같이 생긴 ID** 도 뺀다(표본을 열어 보고 추가).
#   수상구조법 R6 후보를 열어 보니 위키의 변경이력 "3라운드 연속(R4ㆍR5ㆍR6)" 에 걸린 것이었다
#   — 항목 ID 가 아니라 라운드 표기다. `R12-W11` 처럼 뒤가 붙은 것은 그대로 쓴다.
ID_BAD = re.compile(r'^R\d+$')


def wiki_text_of(law):
    """그 법의 위키 페이지 전문을 하나로 이어 붙인다(concepts·statutes·annexes·comparisons)."""
    buf = []
    for sub in ('concepts', 'statutes', 'annexes', 'comparisons'):
        for p in glob.glob(os.path.join(LEGAL, 'wiki', sub, law + '*.md')):
            buf.append(open(p, encoding='utf-8').read())
    return '\n'.join(buf)


def main():
    only = sys.argv[sys.argv.index('--law') + 1] if '--law' in sys.argv else None
    top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 10
    res = {}
    for f in sorted(glob.glob(os.path.join(LEGAL, '_dashboard', 'backlog', '*.md'))):
        law = os.path.basename(f)[:-3]
        if only and only != law:
            continue
        wiki = wiki_text_of(law)
        if not wiki:
            continue
        hits = []
        for i, line in enumerate(open(f, encoding='utf-8'), 1):
            if not line.startswith('- [ ]'):
                continue
            parts = [p.strip() for p in line[5:].split('|')]
            if len(parts) < 3:
                continue                       # 집계 요약문 — 질문이 아니다
            ident = parts[1]
            if not ID_OK.match(ident) or ID_BAD.match(ident) or len(ident) < 2:
                continue
            # 위키가 그 ID 를 언급하나 — `(R11-P23)`·`8R-E53 대응` 같은 꼴로 적힌다
            if re.search(r'(?<![A-Za-z0-9])' + re.escape(ident) + r'(?![A-Za-z0-9])', wiki):
                q = max(parts, key=len)
                hits.append({'행': i, 'ID': ident, '질문': re.sub(r'\s+', ' ', q)[:110]})
        if hits:
            res[law] = hits
    tot = sum(len(v) for v in res.values())
    print(f'후보(위키가 이미 그 ID 를 언급하는 미해소 항목): {tot}건 · {len(res)}개 법')
    print('⚠판정이 아니라 후보다 — 같은 ID 가 라운드마다 다른 질문에 재사용되므로 사람이 대조해야 한다.\n')
    for law, v in sorted(res.items(), key=lambda x: -len(x[1]))[:top]:
        print(f'  {len(v):5d}  {law}')
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n후보 목록:', OUT)


if __name__ == '__main__':
    main()
