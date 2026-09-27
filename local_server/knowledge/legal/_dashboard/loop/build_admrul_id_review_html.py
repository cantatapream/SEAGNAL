#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""행정규칙 **판번호 짝맞추기**를 눈으로 하는 검토장을 만든다. (P-19b · 결심 ⑭)

[왜 사람이 보나]
  `admrul_id_recover.py` 가 제목으로, 그다음 기관명으로 창구를 뒤져 **후보를 손에 쥐여 주는
  것까지** 했다. 그런데 「곰섬갯벌 출입통제**장소**」와 「곰섬 갯벌 출입통제**구역** 지정 공고」가
  **같은 것인지**는 법령 판단이라 기계가 못 한다(G-34). 그것이 `P-19b` 의 마지막 26건이다.

[무엇을 나란히 놓나]
  · 우리 파일 경로와 **머리 3줄**(그 파일이 무엇인지 눈으로 본다)
  · 우리가 가진 제목 · 왜 못 맞췄는지(`이름불일치`·`응답없음`) · 후보를 어떻게 찾았는지
  · **후보 목록** — 「같다 / 아니다」 단추

[★순위를 어떻게 매기나 — 그리고 왜 그것이 「고르는 것」이 아닌가]
  후보가 열둘씩 붙어 있어 그대로는 못 고른다. 그래서 **차례만** 바꿔 놓는다.
  ⚠**흔한 말로 재면 엉뚱한 것이 위로 온다** — 나는 이미 한 번 그 실수를 했다
    (`출입통제`·`장소` 같은 말로 짝을 맞혀 **없는 일감 78줄**을 만들었다).
  ⇒ 흔한 말 목록을 **손으로 적지 않는다.** 그 항목의 후보들 안에서 **여러 후보에 두루 나오는 말**
    (`해양경찰서`·`고시`·`지정`)은 **가리는 힘이 없으므로 저절로 빠지고**, 몇몇에만 나오는 말
    (`곰섬`·`하조대`)이 무겁게 세어진다. 자기가 자기를 재는 셈이라 목록이 낡지 않는다.
  ★그리고 **겹친 고유한 말을 그대로 보여 준다** — 왜 그 차례인지 사장님이 검사할 수 있게.
  ★**미리 찍어 두지 않는다.** 1위라도 빈칸으로 둔다(G-34).

[무엇을 안 하나]
  · 판정을 raw 나 `_admrul.json` 에 **자동으로 반영하지 않는다** — 그건 다음 걸음이다.
  · 후보에 답이 없을 수 있다. 「후보에 없다」 단추를 따로 둔다.

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


def 고름(t):
    """한글만 남긴다 — 띄어쓰기·괄호·기호가 달라도 같은 말을 같게 본다."""
    return re.sub(r'[^가-힣]', '', str(t or ''))


def 두자쪼가리(t):
    s = 고름(t)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def 겹친말(우리, 후보):
    """두 글에 **함께 있는 2자 이상 토막**을 긴 것부터 돌려준다(보여 주기용)."""
    a, b = 고름(우리), 고름(후보)
    찾은 = []
    for n in range(len(a), 1, -1):
        for i in range(len(a) - n + 1):
            조각 = a[i:i + n]
            if 조각 in b and not any(조각 in x for x in 찾은):
                찾은.append(조각)
    return 찾은


def 차례매기기(우리제목, 후보들):
    """★흔한 말 목록을 손으로 적지 않는다 — **이 후보 무리 안에서** 흔한 말이 저절로 빠진다."""
    조각모음 = [두자쪼가리(c) for c in 후보들]
    몇군데 = collections.Counter()
    for s in 조각모음:
        몇군데.update(s)
    n = max(1, len(후보들))
    우리 = 두자쪼가리(우리제목)
    점수 = []
    for c, s in zip(후보들, 조각모음):
        겹 = 우리 & s
        # 여러 후보에 두루 나오는 조각은 가리는 힘이 없다 — 무게를 1/몇군데 로 준다
        점 = sum(1.0 / 몇군데[g] for g in 겹)
        # 후보 절반 넘게 나오는 조각은 「흔한 말」이라 보여 주지 않는다
        고유 = [g for g in 겹 if 몇군데[g] <= n * 0.5]
        점수.append((점, c, 고유))
    점수.sort(key=lambda x: -x[0])
    return 점수


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


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    칸 = d.get('사람이볼것') or []
    if not 칸:
        print('  ❌ `사람이볼것` 이 비었다 — admrul_id_recover.py 를 먼저 돌려라')
        return 1

    몸 = []
    후보없음 = 0
    순위무의미 = 0
    for i, it in enumerate(칸, 1):
        후보 = it.get('후보') or []
        if not 후보:
            후보없음 += 1
        매김 = 차례매기기(it.get('제목') or '', 후보)
        # ★순위가 뜻이 없는 칸을 숨기지 않는다 — 1·2위 점수가 같으면 차례는 아무 말도 안 한다.
        뜻없다 = len(매김) > 1 and (매김[0][0] - 매김[1][0]) <= 0.001
        if 뜻없다:
            순위무의미 += 1
        키 = 'it%03d' % i
        줄 = ''.join('<div class="hd">%s</div>' % html.escape(x) for x in 머리3줄(it.get('파일') or ''))
        칸글 = []
        for j, (점, c, 고유) in enumerate(매김, 1):
            ID = (re.search(r'ID\s*(\d{6,})', c) or [None, ''])[1]
            말 = (' · 겹치는 고유한 말: <b>' + html.escape(' / '.join(sorted(고유, key=len, reverse=True)[:6])) + '</b>') if 고유 else ' · <span class="mut">고유하게 겹치는 말이 없다</span>'
            칸글.append(
                '<div class="cand"><div class="ct"><span class="rank">%d</span> %s</div>'
                '<div class="why">점수 %.2f%s</div>'
                '<div class="btns"><button class="yes" onclick="pick(\'%s\',\'%s\')">같다 — 이 ID 로 한다</button>'
                '<button class="no" onclick="no(\'%s\',\'%s\')">아니다</button></div></div>'
                % (j, html.escape(c), 점, 말, 키, html.escape(ID), 키, html.escape(ID)))
        if not 매김:
            칸글.append('<div class="cand"><div class="mut">후보가 하나도 없다 — 기관 이름으로도 0건이었다.</div></div>')
        if 뜻없다:
            칸글.insert(0, '<div class="flat">⚠<b>이 칸은 차례가 뜻이 없습니다</b> — 1위와 2위 점수가 같습니다'
                          '(고유하게 겹치는 말이 없어 가릴 근거가 없습니다). 아래 순서를 믿지 마시고 직접 보십시오.</div>')
        몸.append(
            '<section class="item" id="%s"><div class="head">'
            '<span class="num">%d / %d</span>'
            '<span class="why2">%s</span><span class="why2">%s</span>'
            '<span class="how">%s</span>'
            '<span class="state" id="s_%s">아직 안 봄</span></div>'
            '<div class="body"><div class="pg">%s</div>%s'
            '<div class="ours"><b>우리가 가진 제목</b><br>%s</div>'
            '%s'
            '<div class="tail"><button class="none" onclick="none_(\'%s\')">후보에 없다 (창구에 그 고시가 없거나 폐지된 듯하다)</button>'
            '<button class="skip" onclick="skip(\'%s\')">모르겠다 — 넘긴다</button>'
            '<input class="memo" id="m_%s" placeholder="까닭을 적어 두실 수 있습니다(선택)" oninput="memo(\'%s\')">'
            '</div></div></section>'
            % (키, i, len(칸), html.escape(it.get('사유') or ''), html.escape(it.get('갈래') or ''),
               html.escape(it.get('후보찾은법') or '—'), 키,
               html.escape(it.get('파일') or ''), 줄,
               html.escape(it.get('제목') or ''), ''.join(칸글), 키, 키, 키, 키))

    페이지 = TPL.replace('@@잰날@@', html.escape(str(d.get('잰날') or ''))) \
                .replace('@@수@@', str(len(칸))) \
                .replace('@@후보없음@@', str(후보없음)) \
                .replace('@@순위무의미@@', str(순위무의미)) \
                .replace('@@몸@@', '\n'.join(몸))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(페이지)
    print('  ✅ 검토장을 냈다 — %s' % os.path.relpath(OUT, LEGAL))
    print('     칸 %d개 · 후보가 하나도 없는 것 %d개 · 차례가 뜻이 없는 칸 %d개'
          % (len(칸), 후보없음, 순위무의미))
    return 0


TPL = '''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>행정규칙 판번호 짝맞추기</title><style>
:root{color-scheme:light;--bg:#fff;--fg:#15181c;--line:#dfe3e8;--mut:#5b6672;--card:#f7f9fb;
      --ok:#0b6b3a;--no:#a50e0e;--warn:#8a5a00;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;--card:#1b1f23;
  --ok:#5fd39b;--no:#f28b82;--warn:#e0ad4d;--accent:#8ab4f8}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;
  --card:#1b1f23;--ok:#5fd39b;--no:#f28b82;--warn:#e0ad4d;--accent:#8ab4f8}
*{box-sizing:border-box}
body{margin:0;padding:20px 16px 90px;background:var(--bg);color:var(--fg);
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.wrap{max-width:1040px;margin:0 auto}
h1{font-size:21px;margin:0 0 6px}
.lead{color:var(--mut);margin:0 0 10px}
.note{border:1px solid var(--warn);border-radius:10px;padding:10px 14px;margin:0 0 20px;
  background:var(--card);font-size:14px}
.item{border:1px solid var(--line);border-radius:10px;margin:0 0 18px;overflow:hidden}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:10px 14px;
  background:var(--card);border-bottom:1px solid var(--line)}
.num{font-weight:700}
.why2{font-size:13px;color:var(--warn)}
.how{font-size:13px;color:var(--mut)}
.state{margin-left:auto;font-size:13px;color:var(--mut)}
.body{padding:12px 14px}
.pg{font-size:12.5px;color:var(--mut);word-break:break-all;margin-bottom:6px}
.hd{font-size:13px;color:var(--mut);white-space:pre-wrap;word-break:break-word;
  border-left:3px solid var(--line);padding-left:8px;margin:2px 0}
.ours{margin:12px 0 10px;padding:10px;border:1px solid var(--line);border-radius:8px;
  background:var(--card);word-break:break-word}
.cand{border-top:1px dashed var(--line);padding:10px 0}
.ct{word-break:break-word}
.rank{display:inline-block;min-width:22px;font-weight:700;color:var(--accent)}
.why{font-size:13px;color:var(--mut);margin:4px 0 6px}
.mut{color:var(--mut)}
.flat{border:1px solid var(--warn);border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13.5px;color:var(--warn)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;font-size:13.5px;padding:6px 12px;border-radius:7px;cursor:pointer;
  border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button.yes{border-color:var(--ok);color:var(--ok)}
button.no{border-color:var(--no);color:var(--no)}
button.none{border-color:var(--warn);color:var(--warn)}
.tail{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;
  border-top:1px solid var(--line);padding-top:10px}
.memo{flex:1 1 240px;min-width:0;font:inherit;font-size:13.5px;padding:6px 10px;
  border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg)}
.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 16px;
  padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));
  background:var(--card);border-top:1px solid var(--line);display:flex;gap:10px;
  align-items:center;flex-wrap:wrap}
.done{border-color:var(--ok)!important}
@media (max-width:520px){.head{gap:6px}.state{margin-left:0;width:100%}}
</style></head><body><div class="wrap">
<h1>행정규칙 판번호 짝맞추기 — @@수@@건</h1>
<p class="lead">잰 날 @@잰날@@ · `P-19b` 의 마지막 · 후보가 하나도 없는 것 @@후보없음@@건 · <b>차례가 뜻이 없는 칸 @@순위무의미@@건</b></p>
<div class="note">
<b>이 차례는 기계가 매긴 <u>참고 순위일 뿐</u>입니다 — 고르는 것은 사장님입니다.</b><br>
순위는 <b>그 항목의 후보들 안에서 여러 후보에 두루 나오는 말</b>(해양경찰서·고시·지정)을
저절로 빼고, 몇몇에만 나오는 말(곰섬·하조대)을 무겁게 세어 매겼습니다.
<b>겹치는 고유한 말</b>을 같이 적어 두었으니 그 근거를 직접 보실 수 있습니다.<br>
1위라도 <b>미리 찍어 두지 않았습니다.</b> 「같다」는 그 ID 를 우리 파일의 판번호로 쓰겠다는 뜻이고,
「후보에 없다」는 창구에 그 고시가 없거나 폐지된 듯하다는 뜻입니다.<br>
누른 것은 이 브라우저에만 남습니다. 다 하시면 아래 <b>내려받기</b>를 눌러 파일로 주십시오.
</div>
@@몸@@
</div>
<div class="bar">
<span id="cnt">0 / @@수@@</span>
<button onclick="save()">판정 내려받기 (JSON)</button>
<button onclick="if(confirm('누른 것을 모두 지웁니다. 계속할까요?')){localStorage.removeItem(KEY);location.reload()}">처음부터</button>
</div>
<script>
const KEY='admrul_id_match_v1';
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
function 적기(k){const e=document.getElementById('s_'+k);const v=S[k];
 if(!v){e.textContent='아직 안 봄';document.getElementById(k).classList.remove('done');return}
 e.textContent={pick:'같다 → ID '+(v.ID||''),no:'아니다',none:'후보에 없다',skip:'모르겠다'}[v.판정]||'';
 document.getElementById(k).classList.add('done')}
function 저장(){localStorage.setItem(KEY,JSON.stringify(S));
 document.getElementById('cnt').textContent=Object.keys(S).length+' / @@수@@'}
function put(k,o){S[k]=Object.assign({},S[k],o);저장();적기(k)}
function pick(k,id){put(k,{판정:'pick',ID:id})}
function no(k,id){const v=S[k]||{};const x=new Set(v.아니다||[]);x.add(id);put(k,{판정:v.판정==='pick'?'pick':'no',아니다:[...x]})}
function none_(k){put(k,{판정:'none'})}
function skip(k){put(k,{판정:'skip'})}
function memo(k){put(k,{메모:document.getElementById('m_'+k).value})}
function save(){const b=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);
 a.download='행정규칙_판번호_짝맞추기_판정.json';a.click()}
for(const k in S){const m=document.getElementById('m_'+k);if(m&&S[k].메모)m.value=S[k].메모;적기(k)}
저장();
</script></body></html>
'''


if __name__ == '__main__':
    sys.exit(main())
