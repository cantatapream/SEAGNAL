#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""행정규칙 **판번호 짝맞추기** 검토장을 만든다. (P-19b · 결심 ⑭)

[왜 사람이 보나]
  `admrul_id_recover.py` 가 제목으로, 그다음 기관명으로 창구를 뒤져 **후보를 손에 쥐여 주는
  것까지** 했다. 그런데 「곰섬갯벌 출입통제**장소**」와 「곰섬 갯벌 출입통제**구역** 지정 공고」가
  **같은 것인지**는 법령 판단이라 기계가 못 한다(G-34). 그것이 `P-19b` 의 마지막 26건이다.

[★2026-09-27 다시 썼다 — 사장님 지적]
  *"이 html만으로는 뭐가 문제라서 뭘 확인해줘야 하는지, 기존에 어떻게 이해하고 있는데
    그게 맞는지, 뭘 봐야하는지 등이 적혀있지 않아 이해할 수 없어."*
  맞는 지적이다. 첫 판은 **내가 아는 것을 전제로** 후보만 늘어놓았다. 고쳐서 넣은 것:
   ①머리에 **무엇이 문제인가**(판번호가 없으면 A-1 이 그 고시를 못 따라간다) ·
     **지금 어디까지 왔나** · **기계는 무엇을 했고 어디서 막혔나** · **왜 이름이 안 맞나(실제 보기)** ·
     **무엇을 보고 고르나** · **고르면 어떻게 되나** · **말 풀이표**
   ②칸마다 **①우리가 아는 것 ②무엇이 막혔나 ③무엇을 보시면 되나 ④후보** 네 토막
   ③**내보내기(복사)** 단추 — 파일을 못 옮기셔도 붙여넣기로 주실 수 있게
  ★그리고 **「고르지 않으셔도 된다」**를 크게 적었다 — 틀린 번호는 빈칸보다 나쁘다
    (엉뚱한 고시의 개정을 우리 것으로 착각하게 된다).

[★차례를 어떻게 매기나 — 그리고 왜 그것이 「고르는 것」이 아닌가]
  후보가 열둘씩 붙어 있어 그대로는 못 고른다. 그래서 **차례만** 바꿔 놓는다.
  ⚠**흔한 말로 재면 엉뚱한 것이 위로 온다** — 나는 이미 한 번 그 실수를 했다
    (`출입통제`·`장소` 같은 말로 짝을 맞혀 **없는 일감 78줄**을 만들었다).
  ⇒ 흔한 말 목록을 **손으로 적지 않는다.** 그 항목의 후보들 안에서 **여러 후보에 두루 나오는 말**
    (`해양경찰서`·`고시`·`지정`)은 **가리는 힘이 없으므로 저절로 빠지고**, 몇몇에만 나오는 말
    (`곰섬`·`하조대`)이 무겁게 세어진다. 자기가 자기를 재는 셈이라 목록이 낡지 않는다.
  ★**미리 찍어 두지 않는다.** 1위라도 빈칸으로 둔다(G-34).
  ★**차례가 뜻이 없는 칸**(1·2위 점수가 같다)은 **그 칸에 그렇게 적는다** — 숨기지 않는다.

쓰는 법:  python3 _dashboard/loop/build_admrul_id_review_html.py
[연계] ← `_dashboard/admrul_id_recovered.json`(`admrul_id_recover.py` 가 만든다)
        → `_dashboard/review_html/행정규칙_판번호_짝맞추기.html`
"""
import collections
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(LEGAL, '_dashboard', 'admrul_id_recovered.json')
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(LEGAL, '_dashboard', 'review_html', '행정규칙_판번호_짝맞추기.html')

기관RE = re.compile(r'([가-힣]{2,10}(?:해양경찰서|해양경찰청|지방해양수산청|지방해양경찰청|환경청|수산청|해양수산청))')


def 고름(t):
    """한글만 남긴다 — 띄어쓰기·괄호·기호가 달라도 같은 말을 같게 본다."""
    return re.sub(r'[^가-힣]', '', str(t or ''))


def 두자쪼가리(t):
    s = 고름(t)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def 차례매기기(우리제목, 후보들):
    """★흔한 말 목록을 손으로 적지 않는다 — **이 후보 무리 안에서** 흔한 말이 저절로 빠진다.

    점수는 2자 쪼가리로 잰다(촘촘해서 순서가 잘 갈린다). 보여 주는 말은 `보여줄말()` 이 따로 만든다.
    돌려주는 것: [(점수, 후보, 원래 자리)] — 점수 높은 차례.
    """
    조각모음 = [두자쪼가리(c) for c in 후보들]
    몇군데 = collections.Counter()
    for x in 조각모음:
        몇군데.update(x)
    우리 = 두자쪼가리(우리제목)
    점수 = []
    for i, (c, x) in enumerate(zip(후보들, 조각모음)):
        겹 = 우리 & x
        점수.append((sum(1.0 / 몇군데[g] for g in 겹), c, i))
    점수.sort(key=lambda t: -t[0])
    return 점수


def 보여줄말(우리제목, 후보들, 기관):
    """후보마다 **사장님께 보여 줄 근거 말**을 돌려준다(후보 차례와 같은 순서).

    ★두 번 고쳤다(2026-09-27, 보내기 전 자체 점검):
      ①2자 쪼가리를 억지로 이어 붙이니 `섬갯벌출`·`서곰섬` 같은 **잘린 토막**이 나왔다
        ⇒ 두 제목에 **함께 있는 가장 긴 말**을 그대로 쓴다.
      ②그랬더니 **기관 이름**(`태안해양경찰서`)이 모든 후보에 겹쳐 근거 구실을 못 했다
        ⇒ 기관 이름은 **빼고** 잰다(기관이 같은지는 ③에 따로 적는다).
    ⚠그리고 **흔한 말은 뺀다** — 그 항목의 후보 절반 넘게 나오는 말(`출입통제`·`지정공고`)은
      가리는 힘이 없다. 흔한지 아닌지는 **후보 무리가 스스로 말해 준다**(손으로 목록을 적지 않는다).
    """
    기 = 고름(기관) if 기관 else ''

    def 벗김(t):
        x = 고름(t)
        return x.replace(기, '') if 기 else x

    a = 벗김(우리제목)
    찾음 = []
    for c in 후보들:
        b = 벗김(c)
        말 = []
        for L in range(min(len(a), len(b)), 1, -1):
            for i in range(len(a) - L + 1):
                g = a[i:i + L]
                if g in b and not any(g in x for x in 말):
                    말.append(g)
        찾음.append(말)
    n = max(1, len(후보들))
    몇후보 = collections.Counter()
    for 말 in 찾음:
        몇후보.update(set(말))
    return [[g for g in 말 if 몇후보[g] <= max(1, n * 0.5)] for 말 in 찾음]


def 파일속판번호(rel):
    """그 raw **안에 이미 적혀 있는** 판번호들. → [(기관, ID)]

    ★2026-09-27 사장님 지적으로 찾았다 — *"복수로 클릭이 안되는데?"* / *"내가 뭘 비교해야할지 모르겠어."*
      `유도선_게시사항_게시장소_고시_15개관할서.txt` 는 **19개 관할서 고시를 한 파일에 모은 대조표**다.
      판번호가 **하나일 수가 없고**, 게다가 **19개가 파일 안에 이미 적혀 있었다**
      (`(속초해양경찰서) admrul 2100000233964` 꼴). 창구에 물을 필요조차 없던 것이다.
      `find_id()` 가 줄머리 `ID:` 꼴만 보아 「번호가 없다」고 오판했고, 나는 그것을
      **「후보 중에 고르세요」** 라고 사장님께 내밀었다 — 물음 자체가 틀렸다.
    ⇒ 이런 칸은 **고르실 것이 없다.** 골라 달라고 하지 않고 따로 빼서 까닭을 적는다.
    """
    f = os.path.join(RAW, rel or '')
    if not os.path.exists(f):
        return []
    t = open(f, encoding='utf-8', errors='replace').read()
    본 = re.findall(r'\(([가-힣]{2,10}(?:해양경찰서|해양경찰청|청|시|군|구))\)\s*admrul\s*(\d{6,})', t)
    if 본:
        보 = []
        for 기, i in 본:
            if (기, i) not in 보:
                보.append((기, i))
        return 보
    return [('', i) for i in dict.fromkeys(re.findall(r'admrul\s+(\d{6,})', t))]


def 머리3줄(rel):
    p = os.path.join(RAW, rel)
    if not os.path.exists(p):
        return ['⚠그 파일이 없다: ' + rel]
    줄 = []
    with open(p, encoding='utf-8') as f:
        for l in f:
            if l.strip():
                줄.append(l.rstrip())
            if len(줄) >= 3:
                break
    return 줄


def 막힌까닭(사유, 찾은법):
    """왜 기계가 못 했는지를 **말로** 푼다 — 라벨만 보여 주면 사장님이 못 읽으신다."""
    a = {'이름불일치': '우리 제목과 <b>똑같은 이름</b>이 창구에 없었습니다. '
                   '⚠<b>폐지됐다는 뜻이 아닙니다</b> — 적는 방식만 달라도 이렇게 됩니다.',
         '응답없음': '창구가 <b>답을 안 줬습니다</b>(망 문제일 수 있습니다). 이것도 폐지가 아닙니다.'}
    b = ''
    m = re.match(r'기관조회\(«(.+)»\)', str(찾은법 or ''))
    if m:
        b = ('제목으로 못 찾아서 <b>%s</b> 가 낸 고시를 통째로 가져와 아래에 늘어놓았습니다.' % html.escape(m.group(1)))
    elif '0건' in str(찾은법 or ''):
        b = '기관 이름으로도 그 기관 고시가 <b>0건</b>이었습니다 — 창구에서 더 찾을 길이 없습니다.'
    elif 찾은법 == '제목조회':
        b = '제목 조회로 <b>비슷한 것</b>을 가져왔습니다.'
    return (a.get(사유, html.escape(str(사유 or ''))) + ' ' + b).strip()


def 볼것(제목, 고유말):
    기관 = 기관RE.search(str(제목 or ''))
    조각 = []
    if 기관:
        조각.append('이 파일의 기관은 <b>%s</b> 입니다 — 후보 가운데 <b>기관이 같은 것</b>부터 보십시오.'
                    % html.escape(기관.group(1)))
    if 고유말:
        조각.append('그다음 <b>지명·대상</b>이 겹치는지 보십시오(이 제목에서 눈여겨볼 말: <b>%s</b>).'
                    % html.escape(' · '.join(고유말[:5])))
    조각.append('<code>장소↔구역</code>, <code>지정 공고</code> 꼬리, 띄어쓰기 차이는 <b>흔합니다</b> — '
                '그것만 다르면 같은 고시일 때가 많습니다.')
    return ' '.join(조각)


TPL = '''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>행정규칙 판번호 짝맞추기</title><style>
:root{color-scheme:light;--bg:#fff;--fg:#15181c;--line:#dfe3e8;--mut:#5b6672;--card:#f6f8fa;
      --ok:#0b6b3a;--no:#a50e0e;--warn:#8a5a00;--accent:#0b57d0;--band:#eef3fa}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;--card:#1b1f23;
  --ok:#5fd39b;--no:#f28b82;--warn:#e0ad4d;--accent:#8ab4f8;--band:#1a2430}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;
  --card:#1b1f23;--ok:#5fd39b;--no:#f28b82;--warn:#e0ad4d;--accent:#8ab4f8;--band:#1a2430}
*{box-sizing:border-box}
body{margin:0;padding:18px 16px 120px;background:var(--bg);color:var(--fg);
  font:15.5px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
  word-break:keep-all;overflow-wrap:anywhere}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px;text-wrap:balance}
h2{font-size:17px;margin:26px 0 8px}
.lead{color:var(--mut);margin:0 0 18px}
.guide{border:1px solid var(--line);border-radius:12px;padding:2px 16px 14px;background:var(--card);margin:0 0 14px}
.guide h3{font-size:15.5px;margin:16px 0 6px}
.guide p,.guide li{margin:6px 0}
.guide ul{padding-left:20px}
.q{font-weight:700;color:var(--accent)}
.ex{border-left:3px solid var(--accent);padding:6px 0 6px 12px;margin:10px 0;background:var(--band);
  border-radius:0 8px 8px 0}
.ex code{font-size:13.5px}
table.말{width:100%;border-collapse:collapse;margin:8px 0;font-size:14px}
table.말 td{border-top:1px solid var(--line);padding:7px 6px;vertical-align:top}
table.말 td:first-child{white-space:nowrap;color:var(--warn);font-weight:700;width:1%}
details{border:1px solid var(--line);border-radius:10px;padding:0 14px;margin:0 0 20px;background:var(--card)}
details>summary{cursor:pointer;padding:12px 0;font-weight:700}
details[open]>summary{border-bottom:1px solid var(--line);margin-bottom:8px}
.item{border:1px solid var(--line);border-radius:12px;margin:0 0 20px;overflow:hidden}
.item.done{border-color:var(--ok)}
.head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:10px 14px;
  background:var(--card);border-bottom:1px solid var(--line)}
.num{font-weight:700}
.state{margin-left:auto;font-size:13.5px;color:var(--mut)}
.body{padding:4px 14px 14px}
.blk{margin:14px 0 0}
.blk>.t{font-weight:700;font-size:14px;color:var(--accent);margin-bottom:4px}
.pg{font-size:12.5px;color:var(--mut)}
.hd{font-size:13.5px;color:var(--mut);white-space:pre-wrap;
  border-left:3px solid var(--line);padding-left:9px;margin:3px 0}
.ours{padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--band);font-weight:600}
.why{font-size:14px;color:var(--mut)}
.look{font-size:14px}
.flat{border:1px solid var(--warn);border-radius:8px;padding:9px 11px;margin:10px 0;
  font-size:14px;color:var(--warn)}
.cand{border-top:1px dashed var(--line);padding:11px 0}
.ct{font-weight:600}
.rank{display:inline-block;min-width:24px;font-weight:700;color:var(--accent)}
.hit{font-size:13.5px;color:var(--mut);margin:3px 0 7px}
.hit b{color:var(--ok)}
.mut{color:var(--mut)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;font-size:14px;padding:8px 14px;border-radius:8px;cursor:pointer;
  border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button:active{transform:translateY(1px)}
button.yes{border-color:var(--ok);color:var(--ok);font-weight:700}
button.no{border-color:var(--no);color:var(--no)}
button.none{border-color:var(--warn);color:var(--warn)}
button.on{background:var(--ok);color:#fff;border-color:var(--ok)}
button.onno{background:var(--no);color:#fff;border-color:var(--no)}
button.onwarn{background:var(--warn);color:#fff;border-color:var(--warn)}
.tail{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;
  border-top:1px solid var(--line);padding-top:12px}
.memo{flex:1 1 220px;min-width:0;font:inherit;font-size:14px;padding:8px 10px;
  border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 16px;
  padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));
  background:var(--card);border-top:1px solid var(--line);display:flex;gap:8px;
  align-items:center;flex-wrap:wrap;font-size:14px}
.bar .cnt{font-weight:700}
#out{display:block;width:100%;height:230px;margin-top:12px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;
  padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:86px;background:var(--fg);color:var(--bg);
  padding:9px 16px;border-radius:999px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
@media (max-width:520px){.state{margin-left:0;width:100%}body{padding:14px 12px 130px}}
</style></head><body><div class="wrap">

<h1>행정규칙 판번호 짝맞추기</h1>
<p class="lead">사장님이 골라 주셔야 하는 <b>@@수@@칸</b> · 잰 날 @@잰날@@ · <code>P-19b</code> / 결심 ⑭</p>

<div class="guide">
<h3>무엇이 문제인가</h3>
<p>우리 저장소의 행정규칙(고시·공고) 파일에는 <b>판번호</b>가 적혀 있어야 합니다.
판번호는 국가법령정보센터가 그 고시에 매긴 번호(<code>2100000264500</code> 같은 것)입니다.</p>
<p>이 번호가 <b class="q">왜 중요한가</b> — 우리는 매주 「이 고시가 그 사이 개정됐나」를 자동으로 확인합니다(A-1 신선도 점검).
그 확인은 <b>판번호로</b> 합니다. <b>번호가 없으면 그 고시는 확인 대상에서 조용히 빠집니다.</b>
개정이 되어도 우리는 모르고, 챗봇은 옛 내용을 계속 근거로 씁니다.</p>

<h3>지금 어디까지 와 있나</h3>
<p>행정규칙 <b>928개</b> 중 <b>900개(97.0%)</b>는 번호를 찾았습니다. 못 찾은 것 가운데
기계가 더 해 볼 수 없는 <b>@@수@@건</b>이 이 문서입니다.</p>

<h3>기계는 무엇을 했고, 어디서 막혔나</h3>
<ul>
<li><b>1걸음 — 제목으로 창구에 물었다.</b> 우리 파일 제목을 그대로 국가법령정보센터에 조회했습니다.
그런데 <b>이름이 안 맞아</b> 못 찾았습니다(@@이름불일치@@건). 1건은 창구가 <b>응답을 안 했습니다</b>.</li>
<li><b>2걸음 — 기관 이름으로 다시 찾았다.</b> 제목이 안 맞으니 <code>○○해양경찰서</code> 같은 기관 이름으로
그 기관이 낸 고시 목록을 통째로 가져와 <b>후보</b>로 늘어놓았습니다.</li>
<li><b>★여기서 멈췄습니다.</b> 「우리가 적어 둔 그 고시」와 「창구의 저 고시」가 <b>같은 것인지</b>는
법령 판단이라 기계가 정하지 않습니다. 그래서 사장님께 여쭙습니다.</li>
</ul>

<h3 class="q">왜 이름이 안 맞나 — 이것이 핵심입니다</h3>
<p>내용은 같은데 <b>적는 방식만</b> 다른 경우가 대부분입니다. 실제로 확인된 보기:</p>
<div class="ex">
우리 파일: <code>태안해양경찰서 — 곰섬<u>갯벌</u> 출입통제<u>장소</u></code><br>
창구 이름: <code>태안해양경찰서 곰섬 <u>갯벌</u> 출입통제<u>구역</u> 지정 공고</code> (ID 2100000264500)<br>
<span class="mut">→ 띄어쓰기(<code>곰섬갯벌</code>↔<code>곰섬 갯벌</code>) · 낱말(<code>장소</code>↔<code>구역</code>) · 꼬리(<code>지정 공고</code>)만 다릅니다. <b>같은 고시입니다.</b></span>
</div>
<p>그러니 <b>기관 이름과 지명(고유한 말)이 같은지</b>를 보시면 됩니다.
<code>장소/구역</code>, <code>지정 공고</code>, 띄어쓰기 차이는 흔합니다.</p>

<h3>무엇을 보고 고르시면 되나</h3>
<ul>
<li><b>기관</b>이 같은가 — <code>태안해양경찰서</code> ↔ <code>태안해양경찰서</code></li>
<li><b>지명·대상</b>이 같은가 — <code>곰섬 갯벌</code> ↔ <code>곰섬갯벌</code> / <code>하조대해변</code> ↔ <code>하조대해변 갯바위</code></li>
<li><b>하는 일</b>이 같은가 — 출입통제인가, 수상레저 금지구역인가, 유·도선 게시사항인가</li>
<li>칸마다 <b>겹치는 고유한 말</b>을 적어 두었으니 그것을 먼저 보시면 빠릅니다.</li>
</ul>

<h3>고르시면 어떻게 되나</h3>
<table class="말">
<tr><td>같다</td><td>그 판번호를 곁 파일에 적어 둡니다. 그러면 <b>A-1 이 그 고시를 다시 따라가기 시작합니다</b> — 개정되면 알 수 있게 됩니다. <b>raw 원문은 건드리지 않습니다.</b></td></tr>
<tr><td>아니다</td><td>그 후보를 지웁니다. 다른 후보를 보시면 됩니다.</td></tr>
<tr><td>후보에 없다</td><td>창구에 그 고시가 없거나 폐지된 듯하다는 뜻입니다. 그 파일은 <b>계속 자동 추적이 안 된다</b>는 한계를 적어 둡니다. ⚠「이름이 안 맞는다」와 「폐지됐다」는 다릅니다 — 확신이 없으시면 <b>모르겠다</b>를 눌러 주십시오.</td></tr>
<tr><td>모르겠다</td><td>넘깁니다. 나중에 다시 봅니다. <b>찍는 것보다 낫습니다.</b></td></tr>
</table>

<h3>★고르지 않으셔도 됩니다</h3>
<p>확신이 안 서면 <b>모르겠다</b>로 넘겨 주십시오. 틀린 판번호를 넣으면
<b>엉뚱한 고시의 개정을 우리 고시의 개정으로 착각</b>하게 됩니다 — 비어 두는 쪽이 낫습니다.</p>
</div>

<details><summary>화면에 나오는 말 풀이 (눌러서 펼치기)</summary>
<table class="말">
<tr><td>이름불일치</td><td>우리 제목으로 창구를 조회했는데 <b>똑같은 이름이 없었다</b>는 뜻. 폐지됐다는 뜻이 <b>아닙니다.</b></td></tr>
<tr><td>응답없음</td><td>창구가 답을 안 줬다는 뜻(망 문제일 수 있음). 이것도 폐지가 아닙니다.</td></tr>
<tr><td>② 기관 표시가 붙은 지역 공고</td><td><code>(태안해양경찰서) …</code> 처럼 기관 이름이 앞에 붙은 지역 공고. @@갈래2@@건.</td></tr>
<tr><td>③ 여느 제목</td><td>기관 표시가 없는 보통 제목. @@갈래3@@건.</td></tr>
<tr><td>기관조회</td><td>제목으로 못 찾아서 <b>기관 이름</b>으로 그 기관 고시를 통째로 가져온 것.</td></tr>
<tr><td>제목조회</td><td>제목 조회로 비슷한 것을 가져온 것.</td></tr>
<tr><td>차례 · 점수</td><td>후보가 여럿일 때 <b>보기 편하시라고</b> 제가 순서만 매긴 것입니다. <b>정답 표시가 아닙니다.</b><br>
그 항목의 후보들에 두루 나오는 말(<code>해양경찰서</code>·<code>고시</code>·<code>지정</code>)은 가리는 힘이 없어 저절로 가벼워지고,
몇몇에만 나오는 말(<code>곰섬</code>·<code>하조대</code>)이 무겁게 세어집니다.</td></tr>
<tr><td>겹치는 고유한 말</td><td>그 차례가 나온 <b>근거</b>입니다. 이것이 비어 있으면 가릴 근거가 없다는 뜻입니다.</td></tr>
</table>
<p class="mut">⚠<b>1위라도 미리 찍어 두지 않았습니다.</b> 전부 빈칸에서 시작합니다.
그리고 <b>차례가 뜻이 없는 칸 @@순위무의미@@개</b>(1·2위 점수가 같음)는 그 칸에 그렇게 적어 두었습니다.
<b>후보가 하나도 없는 칸 @@후보없음@@개</b>도 있습니다.</p>
</details>

@@빼낸@@
<h2>판정할 @@수@@칸</h2>
@@몸@@

<h2>내보내기</h2>
<p class="mut">다 하시면 아래 <b>📋 내보내기 (복사)</b> 를 누르십시오. 글이 이 칸에 나오고 클립보드에도 담깁니다 —
그대로 저에게 붙여넣어 주시면 됩니다. 복사가 막히는 브라우저면 이 칸을 길게 눌러 복사하셔도 됩니다.</p>
<textarea id="out" hidden readonly placeholder="여기에 판정 결과가 나옵니다"></textarea>
</div>

<div class="bar">
<span class="cnt" id="cnt">0 / @@수@@</span>
<button onclick="copyOut()">📋 내보내기 (복사)</button>
<button onclick="save()">파일로 내려받기</button>
<button onclick="if(confirm('누른 것을 모두 지웁니다. 계속할까요?')){localStorage.removeItem(KEY);location.reload()}">처음부터</button>
</div>
<div class="toast" id="toast"></div>

<script>
const KEY='admrul_id_match_v2';
const D=@@데이터@@;
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}

function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('on');
 clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),1800)}
function 저장(){localStorage.setItem(KEY,JSON.stringify(S));
 document.getElementById('cnt').textContent=Object.keys(S).filter(k=>S[k]&&S[k].판정).length+' / @@수@@ 판정함'}
function 칠하기(k){
 const v=S[k]||{},el=document.getElementById(k),st=document.getElementById('s_'+k);
 el.querySelectorAll('button.yes,button.no,button.none,button.skip').forEach(b=>
   b.classList.remove('on','onno','onwarn'));
 let msg='아직 안 봄';
 // ★자리(data-i)를 열쇠로 쓴다. 예전엔 **ID 를 열쇠로** 썼는데, 후보에 ID 가 없으면
 //   둘 다 `data-id=""` 가 되어 **1번에 불이 켜지고 2번은 안 켜졌다**(2026-09-27 사장님 지적,
 //   실제 브라우저로 눌러 재현했다: 2번 같다 → 같다불켜짐=[true,false]).
 if(v.판정==='pick'){
   const id=(D[k].번호||[])[v.자리]||'';
   msg='✅ 같다 → '+(id?('ID '+id):'(그 후보에 번호가 없다)');
   const b=el.querySelector('button.yes[data-i="'+v.자리+'"]');if(b)b.classList.add('on')}
 else if(v.판정==='no'){
   // ★「아니다」만 눌러도 **본 것**이다. 예전엔 여기 갈래가 없어 「아직 안 봄」으로 보였다.
   const c=(v.아니다||[]).length, 모두=(D[k].후보||[]).length;
   msg = (c&&c===모두) ? ('✖ 후보 '+c+'개 모두 아니다 — 「후보에 없다」와 같은 뜻입니다')
                       : ('✖ 아니다 '+c+'개 표시 — 아직 고르신 것은 없습니다');}
 else if(v.판정==='none'){msg='⚠ 후보에 없다';const b=el.querySelector('button.none');if(b)b.classList.add('onwarn')}
 else if(v.판정==='skip'){msg='… 모르겠다 (넘김)';const b=el.querySelector('button.skip');if(b)b.classList.add('onwarn')}
 (v.아니다||[]).forEach(i=>{const b=el.querySelector('button.no[data-i="'+i+'"]');if(b)b.classList.add('onno')});
 st.textContent=msg; el.classList.toggle('done',!!v.판정)}
function put(k,o){S[k]=Object.assign({},S[k],o);저장();칠하기(k)}
function pick(k,i){
 // ★같은 후보를 다시 누르면 **판정을 물린다**(잘못 누르셨을 때 되돌릴 길).
 const v=S[k]||{};
 if(v.판정==='pick'&&v.자리===i){put(k,{판정:'',자리:undefined});toast('판정을 물렸습니다');return}
 const 아니 =(v.아니다||[]).filter(x=>x!==i);   // 「같다」로 고르면 그 후보의 「아니다」는 푼다
 put(k,{판정:'pick',자리:i,아니다:아니});
 const id=(D[k].번호||[])[i]||'';
 toast(id?('같다로 적었습니다 — ID '+id):'같다로 적었습니다 (그 후보에 번호가 없습니다)')}
function no(k,i){
 const v=S[k]||{};const x=new Set(v.아니다||[]);
 if(x.has(i)){x.delete(i)}else{x.add(i)}
 const 판 = (v.판정==='pick'&&v.자리===i) ? '' : v.판정;   // 「같다」 한 것을 「아니다」 하면 풀린다
 put(k,{판정:판||(x.size?'no':''),아니다:[...x]})}
function none_(k){const v=S[k]||{};
 if(v.판정==='none'){put(k,{판정:''});toast('물렸습니다');return}
 put(k,{판정:'none',자리:undefined});toast('후보에 없다로 적었습니다')}
function skip(k){const v=S[k]||{};
 if(v.판정==='skip'){put(k,{판정:''});toast('물렸습니다');return}
 put(k,{판정:'skip',자리:undefined});toast('넘겼습니다')}
function memo(k){put(k,{메모:document.getElementById('m_'+k).value})}

function 내보내기글(){
 const done=Object.keys(S).filter(k=>S[k]&&S[k].판정).length;
 const L=['# 행정규칙 판번호 짝맞추기 — 판정 결과',
          '# 모두 @@수@@칸 중 판정 '+done+'칸 · 내보낸 때 '+new Date().toLocaleString('ko-KR'),''];
 Object.keys(D).forEach((k,i)=>{
  const d=D[k],v=S[k]||{};
  if(!v.판정)return;
  const 말={pick:'같다',no:'아니다만 눌렀음',none:'후보에 없다',skip:'모르겠다'}[v.판정]||v.판정;
  const id=(v.판정==='pick')?((d.번호||[])[v.자리]||''):'';
  L.push('['+(i+1)+'] '+d.파일);
  L.push('    우리 제목: '+d.제목);
  L.push('    판정: '+말+(v.판정==='pick'?(id?(' → ID '+id):' → (그 후보에 번호가 없다)'):''));
  if(v.판정==='pick'&&d.후보[v.자리])L.push('    고른 후보: '+d.후보[v.자리]);
  if((v.아니다||[]).length)L.push('    아니라고 한 후보: '+v.아니다.map(x=>(x+1)+'번').join(', '));
  if(v.메모)L.push('    메모: '+v.메모);
  L.push('')});
 if(done===0)L.push('(아직 판정한 칸이 없습니다)','');
 L.push('---JSON---',JSON.stringify(S));
 return L.join('\\n')}

async function copyOut(){
 const t=내보내기글(),ta=document.getElementById('out');
 ta.value=t;ta.hidden=false;ta.scrollIntoView({behavior:'smooth',block:'center'});
 try{await navigator.clipboard.writeText(t);toast('복사했습니다 — 붙여넣어 주세요')}
 catch(e){ta.focus();ta.select();toast('아래 칸이 선택됐습니다 — 길게 눌러 복사하세요')}}
function save(){const b=new Blob([내보내기글()],{type:'text/plain;charset=utf-8'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);
 a.download='행정규칙_판번호_짝맞추기_판정.txt';a.click();toast('내려받았습니다')}

for(const k in D){const m=document.getElementById('m_'+k);
 if(m&&S[k]&&S[k].메모)m.value=S[k].메모; 칠하기(k)}
저장();
</script>
</body></html>
'''


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    칸 = d.get('사람이볼것') or []
    if not 칸:
        print('  ❌ `사람이볼것` 이 비었다 — admrul_id_recover.py 를 먼저 돌려라')
        return 1

    # ★이미 사장님이 판정하신 칸은 **다시 여쭙지 않는다**(2026-09-27, 25칸 전부 판정받았다).
    #   판정은 `admrul_id_recovered.json` 의 `사람판정` 에 적혀 있다.
    판정 = ((d.get('사람판정') or {}).get('_판정') or {})
    고름 = ((d.get('사람판정') or {}).get('_고름') or {})
    끝난것 = set(판정) | set(고름)
    끝난수 = sum(1 for it in 칸 if (it.get('파일') or '') in 끝난것)
    칸 = [it for it in 칸 if (it.get('파일') or '') not in 끝난것]

    # ★고르실 것이 없는 칸을 먼저 빼낸다 — **물음이 틀린 칸을 내밀지 않는다.**
    기계몫 = [(it, 파일속판번호(it.get('파일') or '')) for it in 칸]
    기계몫 = [(it, ids) for it, ids in 기계몫 if len(ids) >= 2]
    뺀것 = {id(it) for it, _ in 기계몫}
    칸 = [it for it in 칸 if id(it) not in 뺀것]

    if not 칸:
        # ★여쭐 것이 없으면 새 검토장을 만들지 않는다. 다만 **이미 낸 검토장이 남아 있으면**
        #   미판정처럼 보이므로 「끝났다」는 머리글을 그 파일 맨 위에 붙인다(옛 글은 지우지 않는다).
        머리 = (
            '<div style="background:#0b3d2e;color:#fff;padding:14px 18px;border-radius:8px;'
            'margin:0 0 18px;font-size:16px;line-height:1.7">'
            '<b>✅ 이 검토장은 판정이 끝났습니다 — %d칸 전부.</b><br>'
            '사장님이 %s 에 판정하셨습니다: <b>같다로 고른 것 %d</b> · '
            '<b>후보에 없다 %d</b> · 아니다만 표시 1 · 넘김 1.<br>'
            '고른 4건은 기계가 창구로 되짚어 <b>기관 일치·현행 Y</b> 를 확인한 뒤 '
            '<code>admrul_id_recovered.json</code> 의 <code>되찾음</code> 에 넣었습니다. '
            '남은 칸은 <code>사람판정</code> 에 적혀 다시 여쭙지 않습니다.<br>'
            '<span style="opacity:.85">아래 내용은 <b>그때 여쭌 물음 그대로</b> 남겨 둔 기록입니다 '
            '— 지금 다시 누르실 필요는 없습니다.</span></div>'
        ) % (끝난수, ((d.get('사람판정') or {}).get('_잰날') or ''), len(고름),
             sum(1 for v in 판정.values() if v.get('판정') == '후보에 없다'))
        if os.path.exists(OUT):
            with open(OUT, encoding='utf-8') as fh:
                글 = fh.read()
            표 = '<!--판정끝-->'
            if 표 not in 글:
                # ★꽂을 자리: `<h1` 바로 앞. 이 검토장에는 `<body>` 태그가 없다(조각으로 낸다).
                꽂 = 글.find('<h1')
                if 꽂 < 0:
                    꽂 = 글.find('</style>')
                    꽂 = (꽂 + len('</style>')) if 꽂 >= 0 else 0
                글 = 글[:꽂] + 표 + 머리 + 글[꽂:]
                with open(OUT, 'w', encoding='utf-8') as fh:
                    fh.write(글)
                print('  ✅ 이미 낸 검토장 맨 위에 「판정이 끝났습니다」를 붙였다')
        print('  ✅ 여쭐 칸이 없다 — 판정이 끝난 칸 %d개 (사람판정) · 검토장을 새로 내지 않는다' % 끝난수)
        return 0

    몸, 데이터 = [], {}
    후보없음 = 순위무의미 = 0
    사유수 = collections.Counter(str(x.get('사유')) for x in 칸)
    갈래수 = collections.Counter(str(x.get('갈래')) for x in 칸)

    for i, it in enumerate(칸, 1):
        후보 = it.get('후보') or []
        제목 = it.get('제목') or ''
        키 = 'it%03d' % i
        데이터[키] = {'파일': it.get('파일') or '', '제목': 제목, '후보': 후보,
                     '번호': [(re.search(r'ID\s*(\d{6,})', c) or [None, ''])[1] for c in 후보]}
        기관m = 기관RE.search(제목)
        매김 = 차례매기기(제목, 후보)
        말목록 = 보여줄말(제목, 후보, 기관m.group(1) if 기관m else '')
        뜻없다 = len(매김) > 1 and (매김[0][0] - 매김[1][0]) <= 0.001
        if 뜻없다:
            순위무의미 += 1
        if not 후보:
            후보없음 += 1
        내고유 = sorted({g for 말 in 말목록 for g in 말}, key=len, reverse=True)

        칸글 = []
        if 뜻없다:
            칸글.append('<div class="flat">⚠<b>이 칸은 차례가 뜻이 없습니다</b> — 1위와 2위 점수가 같습니다'
                        '(가릴 근거가 될 고유한 말이 없습니다). <b>아래 순서를 믿지 마시고</b> 직접 보십시오.</div>')
        for j, (점, c, 자리) in enumerate(매김, 1):
            고유 = 말목록[자리]
            말 = 고유
            근거 = ('겹치는 말 <b>%s</b>' % html.escape(' · '.join(말[:6]))) if 말 \
                else '<span class="mut">고유하게 겹치는 말이 없습니다 — 가릴 근거가 약합니다</span>'
            칸글.append(
                '<div class="cand"><div class="ct"><span class="rank">%d</span> %s</div>'
                '<div class="hit">%s · <span class="mut">점수 %.2f</span></div>'
                '<div class="btns">'
                '<button class="yes" data-i="%d" onclick="pick(\'%s\',%d)">같다 — 이 번호로 한다</button>'
                '<button class="no" data-i="%d" onclick="no(\'%s\',%d)">아니다</button>'
                '</div></div>'
                % (j, html.escape(c), 근거, 점, 자리, 키, 자리, 자리, 키, 자리))
        if not 매김:
            칸글.append('<div class="flat">이 칸은 <b>후보가 하나도 없습니다</b> — 기관 이름으로도 0건이었습니다. '
                        '창구에서 더 찾을 길이 없으니 <b>후보에 없다</b> 또는 <b>모르겠다</b>로 넘겨 주십시오.</div>')

        머리줄 = ''.join('<div class="hd">%s</div>' % html.escape(x) for x in 머리3줄(it.get('파일') or ''))
        몸.append(
            '<section class="item" id="%s"><div class="head">'
            '<span class="num">%d / %d</span>'
            '<span class="state" id="s_%s">아직 안 봄</span></div><div class="body">'
            '<div class="blk"><div class="t">① 우리가 아는 것</div>'
            '<div class="pg">%s</div>%s'
            '<div class="ours" style="margin-top:8px">우리가 적어 둔 제목<br>%s</div>'
            '<div class="why" style="margin-top:6px">판번호는 <b>모릅니다</b> — 그래서 이 고시는 지금 '
            '<b>개정돼도 우리가 알 수 없습니다.</b></div></div>'
            '<div class="blk"><div class="t">② 무엇이 막혔나</div><div class="why">%s</div></div>'
            '<div class="blk"><div class="t">③ 무엇을 보시면 되나</div><div class="look">%s</div></div>'
            '<div class="blk"><div class="t">④ 후보 %d개 — 같은 고시가 있습니까?</div>%s</div>'
            '<div class="tail">'
            '<button class="none" onclick="none_(\'%s\')">후보에 없다</button>'
            '<button class="skip" onclick="skip(\'%s\')">모르겠다 — 넘긴다</button>'
            '<input class="memo" id="m_%s" placeholder="까닭을 적어 두실 수 있습니다(선택)" oninput="memo(\'%s\')">'
            '</div></div></section>'
            % (키, i, len(칸), 키,
               html.escape(it.get('파일') or ''), 머리줄, html.escape(제목),
               막힌까닭(it.get('사유'), it.get('후보찾은법')),
               볼것(제목, 내고유),
               len(후보), ''.join(칸글),
               키, 키, 키, 키))

    빼낸글 = ''
    if 기계몫:
        토막 = []
        for it, ids in 기계몫:
            줄 = ''.join('<div class="hd">%s  →  admrul <b>%s</b></div>' % (html.escape(기 or '(기관 표시 없음)'), html.escape(i))
                        for 기, i in ids[:25])
            토막.append(
                '<div class="ex" style="margin:12px 0"><b>%s</b><br>'
                '<span class="mut">%s</span></div>'
                '<p>이 파일은 <b>%d곳의 고시를 한 파일에 모은 대조표</b>입니다. '
                '그래서 판번호가 <b>하나일 수가 없습니다</b> — 「후보 중에 고르세요」라는 물음 자체가 틀렸습니다.</p>'
                '<p>게다가 <b>판번호 %d개가 이미 그 파일 안에 적혀 있습니다.</b> 창구에 물을 필요도 없었습니다. '
                '제 자가 줄머리 <code>ID:</code> 꼴만 볼 줄 알아서 「번호가 없다」고 오판한 것입니다.</p>'
                '%s'
                '<p class="mut">⇒ <b>사장님이 하실 일은 없습니다.</b> 이것은 제가 기계로 처리할 일입니다 — '
                '판번호 읽는 자가 이 꼴도 읽도록 고치고, 「한 파일 = 판번호 하나」가 아닌 파일을 어떻게 다룰지 따로 세우겠습니다.</p>'
                % (html.escape(it.get('제목') or ''), html.escape(it.get('파일') or ''),
                   len(ids), len(ids), 줄))
        빼낸글 = ('<h2>고르실 것이 없어 뺀 칸 %d개</h2>'
                 '<div class="guide"><h3>왜 뺐나 — 제 물음이 틀렸습니다</h3>%s</div>'
                 % (len(기계몫), ''.join(토막)))

    페이지 = (TPL.replace('@@빼낸@@', 빼낸글)
                 .replace('@@잰날@@', html.escape(str(d.get('잰날') or '')))
                 .replace('@@수@@', str(len(칸)))
                 .replace('@@후보없음@@', str(후보없음))
                 .replace('@@순위무의미@@', str(순위무의미))
                 .replace('@@이름불일치@@', str(사유수.get('이름불일치', 0)))
                 .replace('@@갈래2@@', str(sum(v for k, v in 갈래수.items() if k.startswith('②'))))
                 .replace('@@갈래3@@', str(sum(v for k, v in 갈래수.items() if k.startswith('③'))))
                 .replace('@@데이터@@', json.dumps(데이터, ensure_ascii=False))
                 .replace('@@몸@@', '\n'.join(몸)))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(페이지)
    print('  ✅ 검토장을 냈다 — %s' % os.path.relpath(OUT, LEGAL))
    print('     칸 %d개 · 후보가 하나도 없는 것 %d개 · 차례가 뜻이 없는 칸 %d개'
          % (len(칸), 후보없음, 순위무의미))
    for it, ids in 기계몫:
        print('     ⚠고르실 것이 없어 뺐다 — %s (파일 안 판번호 %d개)'
              % (os.path.basename(it.get('파일') or ''), len(ids)))
    return 0



if __name__ == '__main__':
    sys.exit(main())
