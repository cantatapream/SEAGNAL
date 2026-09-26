#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-22 — 연안 시군구 조례를 **온전함을 증명한 것만** 받는다. 선언: `_dashboard/coastal_ordin.json`

[왜 증명이 먼저인가 — 3-68 에서 배웠다]
  3-68(고시 다시 받기)에서 나는 **받아 쓴 뒤에** 온전함을 쟀다. 그 사이에
  조문이 쪼그라든 파일과 이미지판독 블록을 잃은 파일이 raw 에 들어갔다.
  이 자는 순서를 뒤집는다 — **증명이 통과한 것만 파일이 된다.**

[자는 하나만 쓴다] 받을 목록을 여기서 다시 세지 않는다.
  `coastal_ordin_scan.py` 가 적어 둔 `_dashboard/coastal_ordin_targets.json` 을 **그대로 읽는다**.
  거기 없는 것은 받지 않는다(낱말·겹낱말·연안 판정은 그 자와 선언 파일의 몫이다).

[운영 함수를 자로 쓴다 — L-136]
  ⑴ 꼴 바꾸기: `ordin_to_folder.convert` — **챗봇이 읽는 그 변환기**를 그대로 부른다.
  ⑵ 열어 보기: `services/article_text.js` 의 `extractArticleBlock` 을 node 로 불러
     **첫 조·가운데 조·마지막 조가 실제로 열리는지** 본다.
     내가 만든 정규식으로 "열릴 것 같다"고 판정하지 않는다.

[무엇을 증명하나 — 하나라도 못 넘으면 **쓰지 않고 까닭을 적는다**]
  ①조가 하나라도 있다                     ②`convert` 가 None 을 주지 않는다(dict 를 다 읽었다)
  ③`[제N조]` 머리줄 수 = 조 수            ④운영 파서가 첫·가운데·마지막 조를 **연다**
  ⑤제1조가 있다(조례는 제1조로 시작한다)   ⑥조 번호에 구멍이 없다(「삭제」는 봐준다)
  ⑦부칙이 있다                            ⑧본문이 빈 조가 절반을 넘지 않는다
  ⑨별표를 하나도 잃지 않는다(`별표단위` 수 = `_links.json` 에 적은 수)
  ⑩**이미 있는 파일은 건드리지 않는다** — 손으로 전사해 넣은 별표·대조 메모가 있다
     (`ordin_recollect.py` 머리말: 울릉군 별표1 전사 15줄·제주 별표2 대조 메모 6줄).

[한 판 전체를 셈으로 잠근다] 목표 수 = 쓴 것 + 막힌 것 + 이미 있던 것.
  안 맞으면 마지막에 ❌ 로 말한다 — **조용히 사라지는 것이 없다.**

[별표는 본문이 안 온다] 조례 `별표단위` 는 `별표내용` 이 비어 있고 첨부파일 주소만 온다
  (3-49 실측 41개 중 0개). 그래서 `별표/_links.json` 에 **길만 적는다** — 3-49 와 같은 꼴.
  진짜 번호는 **제목 안**에 있다(`별표번호` 는 일련번호다 — 3-49 참조).

쓰는 법:
    python3 _dashboard/loop/coastal_ordin_collect.py              # 마른 실행 — 받아서 재기만 한다
    python3 _dashboard/loop/coastal_ordin_collect.py --apply      # 증명을 넘은 것만 쓴다
    python3 _dashboard/loop/coastal_ordin_collect.py --only 강릉   # 이름·지자체에 그 말이 든 것만
    python3 _dashboard/loop/coastal_ordin_collect.py --limit 20   # 앞 20건만(시험)
    python3 _dashboard/loop/coastal_ordin_collect.py --check       # ★증명이 「아니오」를 말할 수 있나(게이트)

[연계] ← `_dashboard/coastal_ordin_targets.json`(받을 목록) · `_dashboard/coastal_ordin.json`(선언)
        ← `ordin_to_folder.convert`(운영 변환기) · `services/article_text.js`(운영 파서) · `_touched.py`
        → `raw/_자치법규/<시도>/<조례>/법률.txt` · `…/별표/_links.json`
        → `_dashboard/law_raw_paths.json` · `_dashboard/coastal_ordin_collect_report.json`
"""
import json, os, re, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                        # noqa: E402
import ordin_to_folder as OF                                        # noqa: E402  ★운영 변환기

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
ORDIN = os.path.join(LEGAL, 'raw', '_자치법규')
DECL = os.path.join(LEGAL, '_dashboard', 'coastal_ordin.json')
TARGETS = os.path.join(LEGAL, '_dashboard', 'coastal_ordin_targets.json')
REPORT = os.path.join(LEGAL, '_dashboard', 'coastal_ordin_collect_report.json')
PATHS_JSON = os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json')
ART = os.path.join(REPO, 'local_server', 'services', 'article_text.js')
OC = 'hyoo1431'

APPLY = '--apply' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0

SIDO_NAMES = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시',
              '세종특별자치시', '경기도', '강원특별자치도', '강원도', '충청북도', '충청남도', '전북특별자치도',
              '전라북도', '전라남도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시']
# 시도 앞가지 — 폴더 이름이 두 시도에 겹칠 때만 쓴다(`고성군어항관리조례` 가 강원·경남 둘 다다).
#   이미 `강원고성군해수욕장관리·운영및지원조례` 라는 관례가 `law_raw_paths.json` 에 있다 — 그대로 따른다.
시도앞가지 = {'강원특별자치도': '강원', '강원도': '강원', '경기도': '경기', '경상남도': '경남', '경상북도': '경북',
          '전라남도': '전남', '전라북도': '전북', '전북특별자치도': '전북', '충청남도': '충남', '충청북도': '충북',
          '제주특별자치도': '제주', '부산광역시': '부산', '인천광역시': '인천', '울산광역시': '울산',
          '대구광역시': '대구', '광주광역시': '광주', '대전광역시': '대전', '서울특별시': '서울',
          '세종특별자치시': '세종', '전남광주통합특별시': '전남광주'}


def safe(n):
    """`collect_ordin.py` 와 **같은 이름짓기**를 쓴다 — 두 자가 다른 이름을 쓰면 같은 조례가 둘이 된다."""
    return re.sub(r'[\/:*?"<>|]', '', str(n or '')).replace(' ', '')[:70]


def 시도of(기관명):
    for s in SIDO_NAMES:
        if str(기관명 or '').startswith(s):
            return s
    return None


def 받기(url):
    """curl 로 받는다 — 프록시 뒤에서 간헐적으로 끊긴다(실측 L-322).

    ★**curl 자신의 `--retry` 를 켠다.** 처음엔 파이썬 쪽에서만 다시 걸었는데
      같은 MST 가 손으로는 받아지고 이 자로는 「못 받았다」가 됐다 — `Recv failure:
      Connection reset by peer` 는 curl 이 **안에서** 다시 걸어야 넘어간다.
      파이썬 쪽 되풀이도 그대로 둔다(둘이 겹쳐야 끝까지 간다).
    """
    for 판 in range(4):
        r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                            '--retry-delay', '2', '--max-time', '60', url,
                            '-H', 'User-Agent: Mozilla/5.0'], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith('{'):
            try:
                return json.loads(r.stdout)
            except Exception:
                pass
        time.sleep(2 ** 판)
    return None


def 본문받기(mst):
    d = 받기('https://www.law.go.kr/DRF/lawService.do'
           f'?OC={OC}&target=ordin&type=JSON&MST={urllib.parse.quote(str(mst))}')
    if not d:
        return None
    return d.get('LawService') or d.get('OrdinService') or {}


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def 납작한꼴(기본, 조들, 부칙, 메모=()):
    """`collect_ordin.py` 가 쓰던 **그 꼴**로 만든다 — `convert` 가 읽는 입이 그것이다.

    머리말(지자체·시행일) → 빈 줄 → 한 줄에 조 dict 하나 → 빈 줄 → `[부칙]` 블록.
    ⚠부칙을 `부칙: …` 한 줄로 적으면 안 된다 — `buchik_of` 의 그 갈래는 `.+` 라서
      줄바꿈이 든 부칙의 **첫 줄만** 살아남는다. `[부칙]` 블록은 끝까지 가져간다.
    """
    머리 = ('[조례] %s\n지자체: %s · 시행 %s · 분야 %s'
          % (기본.get('자치법규명'), 기본.get('지자체기관명'),
             기본.get('시행일자'), 기본.get('자치법규종류')))
    for 줄 in 메모:
        머리 += '\n' + 줄
    몸 = '\n'.join(str(d) for d in 조들)
    끝 = ('\n\n[부칙]\n' + 부칙.strip()) if str(부칙 or '').strip() else ''
    return 머리 + '\n\n' + 몸 + 끝 + '\n'


def 조번호목록(조들):
    out = []
    for d in 조들:
        n = L(d.get('조문번호'))
        out.append(OF.jo_label(n[0]) if n else None)
    return out


# ★장 머리는 조가 아니다 — 조례 응답은 「제1장 총 칙」을 **조문번호 000000 · 조문여부 N** 으로 보낸다.
#   `jo_label('000000')` 이 「제0조」를 주므로 변환된 파일에 `[제0조]` 줄이 생긴다(선언 파일 참조).
#   ⚠운영 파서는 그 블록을 **일부러 비운다** — `extractArticleBlock` 끝에서
#     `while (… /^(제\d+[편장절]\s|부칙)/ …) lines.pop()` 로 편장절 줄을 걷어내기 때문이다.
#     그래서 제0조를 「열리나」로 물으면 **늘 빈 것**이 나온다. 그것은 흠이 아니라 설계다.
#   ⇒ 증명의 ④(열리나)·⑥(번호에 구멍)은 **진짜 조만** 본다. 처음에 이것을 안 가려
#     「강릉시 어항 관리 조례」가 ④에 막혔다 — 자가 틀린 것이었다.
def 진짜조번호(조목록):
    return [j for j in 조목록 if j and j != '제0조']


NODE_열어보기 = r'''
const A = require(process.argv[2]);
const text = require('fs').readFileSync(process.argv[3], 'utf8');
const jos = JSON.parse(process.argv[4]);
const out = [];
for (const jo of jos) {
  let ok = false, why = '';
  try {
    const r = A.extractArticleBlock(text, jo);
    // ⚠`r.body || r.text || r` 로 쓰면 안 된다 — body 가 빈 글자일 때 `|| r` 로 넘어가
    //   **객체가 '[object Object]' 로 바뀌어** 「열렸다」가 된다(실측으로 걸린 내 버그).
    //   꼴은 {title, effectiveDate, body, addenda} 이거나 null 이다. body 만 본다.
    if (r === null || r === undefined) { why = '못 찾았다(null)'; }
    else if (typeof r.body !== 'string') { why = 'body 가 글자가 아니다'; }
    else if (r.body.trim().length === 0) { why = '본문이 비었다'; }
    else { ok = true; }
  } catch (e) { why = String(e && e.message || e); }
  out.push({ jo, ok, why });
}
process.stdout.write('<<<답>>>' + JSON.stringify(out));
'''
# ⚠node 가 `article_text.js` 를 들이면 **`[Gemini] 키 …` 머리글이 stdout 에 먼저 찍힌다.**
#   그래서 "앞이 `[` 면 JSON" 이라고 보면 안 된다 — 그 머리글도 `[` 로 시작한다(실측).
#   표식을 두고 그 뒤만 읽는다.
답표식 = '<<<답>>>'


def 운영파서로열어본다(새글, 조목록, tmpdir):
    """★내 정규식이 아니라 **챗봇이 쓰는 그 함수**로 연다. 첫·가운데·마지막 조를 본다."""
    있는 = 진짜조번호(조목록)
    if not 있는:
        return [], '진짜 조(제1조 이상)가 하나도 없다'
    고를것 = sorted({있는[0], 있는[len(있는) // 2], 있는[-1]}, key=있는.index)
    f = os.path.join(tmpdir, 'peek.txt')
    open(f, 'w', encoding='utf-8').write(새글)
    js = os.path.join(tmpdir, 'peek.js')
    open(js, 'w', encoding='utf-8').write(NODE_열어보기)
    r = subprocess.run(['node', js, ART, f, json.dumps(고를것, ensure_ascii=False)],
                       capture_output=True, text=True, cwd=REPO)
    if r.returncode != 0 or 답표식 not in r.stdout:
        return [], 'node 가 못 돌았다: ' + ((r.stderr or '') + (r.stdout or ''))[-160:]
    return json.loads(r.stdout.split(답표식, 1)[1]), ''


def 증명(기본, 조들, 부칙, 별표, 새글, tmpdir):
    """(막힘목록, 메모목록) 을 돌려준다. 막힘이 비면 통과 — 메모는 파일 머리에 적는다."""
    막힘, 메모 = [], []
    if not 조들:
        return ['①조가 하나도 없다'], 메모
    if 새글 is None:
        return ['②convert 가 None — dict 를 다 못 읽었다(손대지 않는다)'], 메모

    조목록 = 조번호목록(조들)
    못읽은 = [i for i, j in enumerate(조목록) if not j]
    if 못읽은:
        막힘.append('②조문번호를 못 읽은 조 %d개' % len(못읽은))

    머리수 = len(re.findall(r'(?m)^\[제\d+조(?:의\d+)?\]', 새글))
    if 머리수 != len(조들):
        막힘.append('③머리줄 %d개 ≠ 조 %d개' % (머리수, len(조들)))

    열림, 오류 = 운영파서로열어본다(새글, 조목록, tmpdir)
    if 오류:
        막힘.append('④운영 파서를 못 불렀다 — ' + 오류)
    else:
        안열린것 = [x['jo'] + ('(' + x['why'] + ')' if x['why'] else '') for x in 열림 if not x['ok']]
        if 안열린것:
            막힘.append('④운영 파서가 못 연 조: ' + ' · '.join(안열린것))

    if '제1조' not in 조목록:
        막힘.append('⑤제1조가 없다 — 앞이 잘린 것으로 본다(첫 조 %s)' % (조목록[0] or '?'))

    번호 = [int(re.match(r'제(\d+)조', j).group(1)) for j in 진짜조번호(조목록)
          if re.match(r'제(\d+)조', j)]
    if 번호:
        구멍 = [n for n in range(min(번호), max(번호) + 1) if n not in set(번호)]
        삭제꼴 = re.findall(r'제(\d+)조[^\n]{0,20}삭제', 새글)
        진짜구멍 = [n for n in 구멍 if str(n) not in set(삭제꼴)]
        if 진짜구멍:
            # ★막을 것과 적을 것을 가른다 (2026-09-26 실측으로 고쳤다).
            #   처음엔 구멍이 하나라도 있으면 막았다. 그래서 세 조례가 막혔는데
            #   **원문에 정말 그 조가 없었다**: 영덕군 해수욕장 운영조례(조 15개 중 제14조 없음) ·
            #   강진군 어항관리 조례(44개 중 제38조) · 고흥군 어업지도선 운영 관리 규칙(45개 중 제35조).
            #   ELIS 는 **삭제된 조를 「삭제」 표시도 없이 뺀다**(응답·HTML 둘 다 없다 — 실측).
            #   ⇒ 막으면 그 지자체 조례가 **아예 없는 것**이 된다 — 그게 더 나쁘다.
            #     그리고 제14조를 지어낼 수는 없다.
            #   ⑥이 원래 잡으려던 것은 **받다가 잘린 것**이다. 잘리면 구멍이 **토막으로** 난다
            #   (뒤가 통째로 없거나 가운데 여러 개가 연달아 없다). 그래서:
            #     · 연달아 3개 이상 없거나, 빠진 것이 조 수의 20%를 넘으면 **막는다**.
            #     · 그보다 작으면 **파일 머리에 정직하게 적고 통과시킨다**(3-7 정직문구 결).
            토막, 길이, 앞 = 0, 0, None
            for n in 진짜구멍:
                길이 = 길이 + 1 if 앞 is not None and n == 앞 + 1 else 1
                토막 = max(토막, 길이)
                앞 = n
            큰구멍 = 토막 >= 3 or len(진짜구멍) * 5 > len(번호)
            적을것 = '제' + '조·제'.join(str(n) for n in 진짜구멍[:8]) + '조'
            if 큰구멍:
                막힘.append('⑥조 번호에 구멍 %d개(연달아 %d개) — 받다가 잘린 것으로 본다 (%s%s)'
                            % (len(진짜구멍), 토막, 적을것, ' …' if len(진짜구멍) > 8 else ''))
            else:
                메모.append('⚠받은 원문에 %s가 없다 — 지어내지 않고 그대로 둔다'
                          '(ELIS 는 삭제된 조를 표시 없이 뺀다 · 3-22 실측 2026-09-26).' % 적을것)

    if not str(부칙 or '').strip():
        막힘.append('⑦부칙이 없다')

    빈조 = sum(1 for d in 조들 if len(str(d.get('조내용') or '').strip()) < 12)
    if 빈조 * 2 > len(조들):
        막힘.append('⑧본문이 빈 조가 %d/%d — 절반을 넘는다' % (빈조, len(조들)))

    return 막힘, 메모


def 별표길(별표):
    """3-49 와 같은 꼴 — 제목·원본 주소만 적는다. 본문은 안 온다(지어내지 않는다)."""
    out = []
    for b in L((별표 or {}).get('별표단위')):
        out.append({'제목': b.get('별표제목'), '주소': b.get('별표첨부파일명'),
                    '확장자': b.get('별표첨부파일구분'), '별표구분': b.get('별표구분'),
                    '일련번호': b.get('별표번호'), '별표키': b.get('별표키'),
                    '_주의': '진짜 번호는 제목 안에 있다 — `별표번호` 는 일련번호다(3-49 실측)'})
    return out


def 조dict(번호, 제목, 내용):
    return {'조문번호': [번호, 번호], '조제목': 제목, '조내용': 내용, '조문여부': 'Y'}


# ── 온전한 한 벌 — 이것이 통과하지 않으면 자가 너무 빡빡한 것이다 ────────────────
온전한기본 = {'자치법규명': '시험시 어항 관리 조례', '지자체기관명': '시험도 시험시',
          '시행일자': '20260101', '자치법규종류': 'C0001'}
온전한조 = [조dict('000100', '목적', '제1조(목적) 이 조례는 시험을 목적으로 한다.'),
        조dict('000200', '정의', '제2조(정의) ① 「시험」이란 시험하는 것을 말한다.'),
        조dict('000300', '적용범위', '제3조(적용범위) ① 이 조례는 시험에 적용한다.')]
온전한부칙 = '부칙 <조례 제1호, 2026.1.1.> 이 조례는 공포한 날부터 시행한다.'


def 증명시험():
    """★증명이 「아니오」라고 말할 수 있는지 시험한다.

    한 번도 막지 않는 자는 자가 아니다(G-49). 갈래마다 **일부러 깨뜨린 한 벌**을 넣어
    그 번호가 실제로 떠오르는지 본다. 하나라도 안 떠오르면 **게이트가 빨간불**이 된다.
    """
    tmp = os.path.join(HERE, '.코스탈시험')
    os.makedirs(tmp, exist_ok=True)
    통과, 실패 = 0, []

    def 재기(기본, 조들, 부칙, 별표=None, 새글=...):
        납작 = 납작한꼴(기본, 조들, 부칙)
        글 = (OF.convert(납작) if 조들 else None) if 새글 is ... else 새글
        return 증명(기본, 조들, 부칙, 별표, 글, tmp)[0]        # 막힘만 본다

    def ok(무엇, 맞나, 덧붙임=''):
        nonlocal 통과
        if 맞나:
            통과 += 1
        else:
            실패.append('%s  %s' % (무엇, 덧붙임))

    # ⓪온전한 것은 통과해야 한다
    막힘 = 재기(온전한기본, 온전한조, 온전한부칙)
    ok('온전한 한 벌은 통과한다', not 막힘, '막혔다: %s' % 막힘)

    # ①조가 하나도 없다
    ok('①조가 없으면 막는다', any(x.startswith('①') for x in 재기(온전한기본, [], 온전한부칙)))

    # ②convert 가 None
    ok('②convert 가 None 이면 막는다',
       any(x.startswith('②') for x in 재기(온전한기본, 온전한조, 온전한부칙, None, None)))

    # ③머리줄 수가 조 수와 다르다 — 머리줄 하나를 지운 글을 넣는다
    납작 = 납작한꼴(온전한기본, 온전한조, 온전한부칙)
    깎은글 = OF.convert(납작).replace('[제2조] 정의\n', '', 1)
    ok('③머리줄이 모자라면 막는다',
       any(x.startswith('③') for x in 증명(온전한기본, 온전한조, 온전한부칙, None, 깎은글, tmp)[0]))

    # ④운영 파서가 못 연다 — 마지막 조의 본문이 비어 있는 글
    #   ⚠처음엔 「머리줄만 줄줄이 있는 글」로 시험했는데 **그게 안 통했다**:
    #     `extractArticleBlock('제1조')` 이 다음 머리줄까지를 본문으로 삼아 **빈 것이 아니었다**.
    #     그래서 마지막 조를 머리줄만 남긴다 — 뒤에 끊을 것이 없으니 본문이 정말로 빈다.
    빈글 = '[조례] 시험\n\n[제1조] 목적\n① 시험이다.\n\n[제2조] 정의\n① 시험이다.\n\n[제3조]\n'
    ok('④운영 파서가 못 열면 막는다',
       any(x.startswith('④') for x in 증명(온전한기본, 온전한조, 온전한부칙, None, 빈글, tmp)[0]))

    # ⑤제1조가 없다
    ok('⑤제1조가 없으면 막는다',
       any(x.startswith('⑤') for x in 재기(온전한기본, 온전한조[1:], 온전한부칙)))

    # ⑥큰 구멍(연달아 3개)은 막는다 — 제1조·제5조만(제2·3·4조가 연달아 없다)
    큰구멍조 = [온전한조[0], 조dict('000500', '벌칙', '제5조(벌칙) ① 이 조례를 어기면 아니 된다.')]
    ok('⑥연달아 3개 빠지면 막는다', any(x.startswith('⑥') for x in 재기(온전한기본, 큰구멍조, 온전한부칙)))

    # ⑥★작은 구멍은 **막지 않고 적는다** — 조가 넉넉히 있고 하나만 빠진 때
    #   (실측: 강진군 어항관리 조례 조 44개 중 제38조 하나가 원문에 없다 — 지어낼 수 없다)
    긴조 = [조dict('%04d00' % n, '제%d조' % n, '제%d조(제목) ① 시험 본문이다. 넉넉히 적는다.' % n)
          for n in list(range(1, 12)) + list(range(13, 23))]      # 제12조 하나만 없다
    막힘작은, 메모작은 = 증명(온전한기본, 긴조, 온전한부칙, None,
                       OF.convert(납작한꼴(온전한기본, 긴조, 온전한부칙)), tmp)
    ok('⑥작은 구멍(하나)은 막지 않는다', not any(x.startswith('⑥') for x in 막힘작은),
       '막힘: %s' % 막힘작은)
    ok('⑥작은 구멍은 파일 머리에 정직하게 적는다',
       any('제12조' in x and '지어내지 않고' in x for x in 메모작은), '메모: %s' % 메모작은)

    # ⑥-그러나 「삭제」는 봐준다
    삭제조 = [온전한조[0], 조dict('000200', '', '제2조 삭제'),
           조dict('000300', '적용범위', '제3조(적용범위) ① 이 조례는 시험에 적용한다.')]
    막힘삭제 = 재기(온전한기본, 삭제조, 온전한부칙)
    ok('⑥「삭제」된 조는 구멍으로 안 센다', not any(x.startswith('⑥') for x in 막힘삭제),
       '막힘: %s' % 막힘삭제)

    # ⑦부칙이 없다
    ok('⑦부칙이 없으면 막는다', any(x.startswith('⑦') for x in 재기(온전한기본, 온전한조, '')))

    # ⑧본문이 빈 조가 절반을 넘는다
    빈조 = [온전한조[0], 조dict('000200', '', '제2조'), 조dict('000300', '', '제3조')]
    ok('⑧본문이 빈 조가 절반을 넘으면 막는다', any(x.startswith('⑧') for x in 재기(온전한기본, 빈조, 온전한부칙)))

    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    print('  3-22 증명 시험 — %d PASS / %d FAIL' % (통과, len(실패)))
    for x in 실패:
        print('    ❌ %s' % x)
    return 0 if not 실패 else 1


def 이미있는폴더():
    m = {}
    for 시도 in sorted(os.listdir(ORDIN)):
        p = os.path.join(ORDIN, 시도)
        if not os.path.isdir(p):
            continue
        for x in os.listdir(p):
            if os.path.isdir(os.path.join(p, x)):
                m[x] = 시도
            elif x.endswith('.txt'):
                m[x[:-4]] = 시도
    return m


def main():
    if '--check' in sys.argv:
        return 증명시험()
    if not os.path.exists(TARGETS):
        print('❌ 받을 목록이 없다 — 먼저 coastal_ordin_scan.py 를 돌린다: %s'
              % os.path.relpath(TARGETS, LEGAL))
        return 2
    T = json.load(open(TARGETS, encoding='utf-8'))
    목표 = [(g, r) for g, v in sorted(T['지자체별'].items()) for r in v]
    if ONLY:
        목표 = [(g, r) for g, r in 목표 if ONLY in g or ONLY in str(r.get('명'))]
    if LIMIT:
        목표 = 목표[:LIMIT]
    있던 = 이미있는폴더()

    tmpdir = os.path.join(HERE, '.코스탈임시')
    os.makedirs(tmpdir, exist_ok=True)
    touched = Touched('coastal_ordin_collect') if APPLY else None

    쓴것, 막힌것, 있던것, 못받은것, 쓴뒤어긋남 = [], [], [], [], []
    print('  ── 3-22 연안 조례 받기 (%s) — 목표 %d건 ──'
          % ('실제로 쓴다' if APPLY else '마른 실행 · 쓰지 않는다', len(목표)))
    for g, r in 목표:
        이름 = safe(r['명'])
        시도 = 시도of(r.get('기관명')) or g.split()[0]
        if 이름 in 있던:
            있던것.append({'지자체': g, '명': r['명'], '있는곳': 있던[이름]})
            continue
        b = 본문받기(r['MST'])
        if not b:
            못받은것.append({'지자체': g, '명': r['명'], 'MST': r['MST'], '까닭': '망이 끝내 안 열렸다'})
            print('  ⚠못 받았다  %s' % r['명'])
            continue
        기본 = b.get('자치법규기본정보') or {}
        조들 = L((b.get('조문') or {}).get('조'))
        부칙 = (b.get('부칙') or {}).get('부칙내용') or ''
        납작 = 납작한꼴(기본, 조들, 부칙)
        새글 = OF.convert(납작) if 조들 else None
        막힘, 메모 = 증명(기본, 조들, 부칙, b.get('별표'), 새글, tmpdir)
        if 메모:
            # 정직문구를 머리에 얹고 **다시 변환한다** — 증명한 글과 쓰는 글이 같아야 한다
            #   (쓴 뒤 확인이 `뒤글 != 새글` 로 그것을 잡는다).
            새글 = OF.convert(납작한꼴(기본, 조들, 부칙, 메모))
        길 = 별표길(b.get('별표'))
        기록 = {'지자체': g, '명': r['명'], 'MST': r['MST'], '낱말': r.get('낱말'),
              '조수': len(조들), '별표수': len(길), '시행': 기본.get('시행일자')}
        if 메모:
            기록['머리에_적은_정직문구'] = 메모
        if 막힘:
            기록['막힌까닭'] = 막힘
            막힌것.append(기록)
            print('  ❌ %-38s %s' % (r['명'][:38], ' / '.join(막힘)))
            continue
        기록['쓸곳'] = os.path.relpath(os.path.join(ORDIN, 시도, 이름, '법률.txt'), LEGAL)
        쓴것.append(기록)
        print('  ✅ %-38s 조 %3d · 별표 %2d' % (r['명'][:38], len(조들), len(길)))
        if APPLY:
            folder = os.path.join(ORDIN, 시도, 이름)
            os.makedirs(folder, exist_ok=True)
            dst = os.path.join(folder, '법률.txt')
            open(dst, 'w', encoding='utf-8').write(새글)
            touched.add(dst)
            if 길:
                os.makedirs(os.path.join(folder, '별표'), exist_ok=True)
                lp = os.path.join(folder, '별표', '_links.json')
                옛 = json.load(open(lp, encoding='utf-8')) if os.path.exists(lp) else {}
                옛.setdefault('_무엇', '조례 별표는 본문이 안 온다 — 원본으로 가는 길만 적는다(3-49·3-22).')
                옛['별표'] = 길
                json.dump(옛, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
                touched.add(lp)
                # ⑨별표를 하나도 잃지 않았나 — 쓴 뒤에 다시 세어 본다
                다시 = json.load(open(lp, encoding='utf-8'))
                if len(다시.get('별표') or []) != len(길):
                    print('    ❌ 별표 수가 어긋났다 %d ≠ %d' % (len(다시.get('별표') or []), len(길)))
            # ★쓴 뒤에 **디스크에 있는 그 파일**을 다시 읽어 운영 파서로 열어 본다.
            #   증명은 메모리 속 글로 했다 — 디스크에 온전히 떨어졌는지는 다른 물음이다(3-68 의 교훈).
            뒤글 = open(dst, encoding='utf-8').read()
            뒤열림, 뒤오류 = 운영파서로열어본다(뒤글, 조번호목록(조들), tmpdir)
            안열린뒤 = [] if 뒤오류 else [x['jo'] for x in 뒤열림 if not x['ok']]
            if 뒤오류 or 안열린뒤 or 뒤글 != 새글:
                기록['⚠쓴_뒤_확인'] = (뒤오류 or ('안 열린 조: ' + ' '.join(안열린뒤) if 안열린뒤
                                            else '디스크 글이 증명한 글과 다르다'))
                쓴뒤어긋남.append(기록)
                print('    ❌ 쓴 뒤 확인이 어긋났다 — %s' % 기록['⚠쓴_뒤_확인'])
            있던[이름] = 시도
        time.sleep(0.2)

    합 = len(쓴것) + len(막힌것) + len(있던것) + len(못받은것)
    print()
    print('  통과 %d · 막힘 %d · 이미 있던 것 %d · 못 받은 것 %d'
          % (len(쓴것), len(막힌것), len(있던것), len(못받은것)))
    print('  %s 셈이 맞나 — 목표 %d = 합 %d' % ('✅' if 합 == len(목표) else '❌', len(목표), 합))
    if APPLY:
        print('  %s 쓴 뒤 확인 — 어긋난 파일 %d개' % ('✅' if not 쓴뒤어긋남 else '❌', len(쓴뒤어긋남)))

    if APPLY and 쓴것:
        m = json.load(open(PATHS_JSON, encoding='utf-8'))
        더한것, 앞가지붙인것 = 0, []
        for x in 쓴것:
            folder = os.path.dirname(os.path.join(LEGAL, x['쓸곳']))
            key, rel = os.path.basename(folder), os.path.relpath(folder, REPO)
            if key in m and m[key] != rel:
                # ★두 시도에 같은 이름이 있다 — 앞가지를 붙인다(기존 항목은 손대지 않는다).
                시도 = os.path.basename(os.path.dirname(folder))
                key2 = 시도앞가지.get(시도, 시도) + key
                if key2 not in m:
                    m[key2] = rel
                    앞가지붙인것.append(key2)
                    더한것 += 1
            elif key not in m:
                m[key] = rel
                더한것 += 1
        json.dump(m, open(PATHS_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.add(PATHS_JSON)
        print('  law_raw_paths.json 에 %d개 넣었다 (앞가지를 붙인 것 %d개: %s)'
              % (더한것, len(앞가지붙인것), ' · '.join(앞가지붙인것) or '없다'))

    # ★`--only` 로 돌린 판은 **따로 적는다.** 전수 보고서를 반쪽으로 덮으면
    #   다음 사람이 「267건 중 1건만 했다」고 읽는다(실제로 한 번 덮었다).
    보고서 = REPORT if not (ONLY or LIMIT) else REPORT.replace('.json', '_부분.json')
    json.dump({'_잰날': time.strftime('%Y-%m-%d'), '_실제로썼나': APPLY,
               '_이_판은_반쪽인가': bool(ONLY or LIMIT),
               '_목표': len(목표), '_통과': len(쓴것), '_막힘': len(막힌것),
               '_이미있던것': len(있던것), '_못받은것': len(못받은것),
               '_셈이맞나': 합 == len(목표), '_쓴뒤어긋남': len(쓴뒤어긋남),
               '통과': 쓴것, '막힘': 막힌것, '이미있던것': 있던것, '못받은것': 못받은것,
               '쓴뒤어긋남': 쓴뒤어긋남},
              open(보고서, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('  적었다 → %s' % os.path.relpath(보고서, LEGAL))
    if APPLY and touched:
        touched.save()
    for f in ('peek.txt', 'peek.js'):
        p = os.path.join(tmpdir, f)
        if os.path.exists(p):
            os.remove(p)
    if os.path.isdir(tmpdir) and not os.listdir(tmpdir):
        os.rmdir(tmpdir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
