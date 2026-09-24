# -*- coding: utf-8 -*-
"""본문 인용 **뜻풀이 판정**을 눈으로 하는 HTML 검토장을 만든다. (3-41 ②)

왜 사람이 보나
  ①(값 숫자)는 기계가 원문과 맞대어 볼 수 있다 — `cite_number_raw.js` 가 한다.
  ★그런데 실측해 보니 **전체 247건 중 기계가 판정할 수 있는 것은 5건뿐**이었다
    (맞음 3 · 어긋남 후보 2). 나머지 **242건은 값 숫자가 없는 「뜻풀이 인용」** 이다 —
    *"이 조문이 이 뜻으로 인용된 것이 맞나"* 는 **법리 판단**이라 기계가 못 한다.
  ⇒ 이 검토장이 **그 242건**을 한 자리에 모아 판정할 수 있게 한다.

무엇을 나란히 놓나
  · 위키가 적은 **인용 줄**(그대로)
  · 그 항목이 가리키는 **법·조·제목**
  · 왜 기계가 못 했는지(`값 숫자가 없다` · `다른 문서의 조를 가리킨다` …)
  · 판정 단추 — **맞다 / 틀렸다 / 고쳐야 한다 / 모르겠다** + 까닭 적는 칸

무엇을 안 하나
  · 판정을 **기계가 미리 찍어 두지 않는다**(G-34). 빈칸으로 둔다.
  · 내려받은 판정을 **자동으로 위키에 반영하지 않는다** — 그건 다음 걸음이다.

[연계] ← `_dashboard/cite_human_review.json`(`cite_number_raw.js` 가 만든다)
        → `_dashboard/review/본문인용_뜻풀이판정.html`
사용법: python3 build_cite_review_html.py
"""
import os, sys, json, html, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
DASH = os.path.join(LEGAL, '_dashboard')
OUT = os.path.join(DASH, 'review')

TPL = '''<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>본문 인용 판정</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--line:#d8d8d8;--soft:#f6f6f6;--ok:#137333;--no:#a50e0e;--fix:#8a6d00;--un:#5f6368;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e8e8e8;--line:#3a3d42;--soft:#1e2126;--ok:#5bb974;--no:#f28b82;--fix:#fdd663;--un:#9aa0a6;--accent:#8ab4f8}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#e8e8e8;--line:#3a3d42;--soft:#1e2126;--ok:#5bb974;--no:#f28b82;--fix:#fdd663;--un:#9aa0a6;--accent:#8ab4f8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px}
h1{margin:0 0 4px;font-size:17px}
.meta{font-size:13px;opacity:.78}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.bar button,.bar select{font:inherit;font-size:13px;padding:6px 11px;border:1px solid var(--line);border-radius:7px;background:var(--soft);color:var(--fg);cursor:pointer}
.bar button.primary{background:var(--accent);color:#fff;border-color:transparent}
.count{font-size:13px;margin-left:auto;opacity:.85}
main{padding:16px;max-width:1000px;margin:0 auto}
article{border:1px solid var(--line);border-radius:10px;padding:13px 15px;margin:0 0 14px;background:var(--soft)}
article[data-s]{background:var(--bg)}
article[data-s="맞다"]{border-left:5px solid var(--ok)}
article[data-s="틀렸다"]{border-left:5px solid var(--no)}
article[data-s="고쳐야"]{border-left:5px solid var(--fix)}
article[data-s="모르겠다"]{border-left:5px solid var(--un)}
.hd{font-size:12.5px;opacity:.8;margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap}
.hd b{font-weight:700;opacity:1}
.line{font-size:14px;white-space:pre-wrap;word-break:break-word;border-left:3px solid var(--line);padding-left:10px;margin:8px 0}
.why{font-size:12.5px;color:var(--fix);margin-bottom:6px}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.acts button{font:inherit;font-size:12.5px;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
textarea{margin-top:7px;width:100%;min-height:52px;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);resize:vertical}
footer{padding:18px 16px 50px;font-size:12.5px;opacity:.75;max-width:1000px;margin:0 auto}
@media (max-width:520px){main,header{padding-left:16px;padding-right:16px}}
</style></head><body>
<header>
  <h1>본문 인용 판정 — 뜻풀이 __N__건</h1>
  <div class="meta">위키 본문이 조문을 인용했는데 <b>기계가 확인하지 못한</b> 자리입니다.
  «이 조문이 이 뜻으로 인용된 것이 맞나»를 봐 주세요.<br>
  전체 247건 중 기계가 판정한 것은 <b>5건</b>뿐이었습니다(맞음 3 · 어긋남 후보 2).</div>
  <div class="bar">
    <button class="primary" id="dlJson">JSON 내려받기</button>
    <button id="dlCsv">CSV 내려받기</button>
    <select id="filter">
      <option value="">전부 보기</option><option value="todo">아직 안 본 것</option>
      <option value="맞다">맞다</option><option value="틀렸다">틀렸다</option>
      <option value="고쳐야">고쳐야</option><option value="모르겠다">모르겠다</option>
    </select>
    <button id="reset">지우기</button>
    <span class="count" id="count"></span>
  </div>
</header>
<main id="list">__BODY__</main>
<footer>· 고른 것은 <b>이 브라우저에 저장</b>됩니다. 끝나면 <b>내려받아</b> 주세요.<br>
· 판정을 기계가 미리 찍어 두지 않았습니다 — 전부 빈칸입니다.<br>
· 내려받은 판정은 <b>자동으로 위키에 반영되지 않습니다</b>. 반영은 다음 걸음입니다.</footer>
<script>
const KEY='cite-review';
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
const arts=[...document.querySelectorAll('article')];
function paint(){
  const f=document.getElementById('filter').value;
  let done=0;
  for(const a of arts){
    const k=a.dataset.k,s=S[k];
    if(s&&s.state){a.dataset.s=s.state;done++}else{a.removeAttribute('data-s')}
    const t=a.querySelector('textarea'); if(s&&t.value!==(s.note||''))t.value=s.note||'';
    const st=s&&s.state?s.state:'';
    a.hidden = f ? (f==='todo' ? !!st : st!==f) : false;
  }
  document.getElementById('count').textContent=done+' / '+arts.length+' 판정함';
  try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('.acts button'); if(!b)return;
  const a=b.closest('article'),k=a.dataset.k,v=b.dataset.v;
  if(S[k]&&S[k].state===v){S[k].state=''}else{S[k]={state:v,note:(S[k]||{}).note||''}}
  paint();
});
document.addEventListener('input',e=>{
  const t=e.target.closest('textarea'); if(!t)return;
  const k=t.closest('article').dataset.k; S[k]=S[k]||{state:''}; S[k].note=t.value; paint();
});
document.getElementById('filter').onchange=paint;
function rows(){return arts.map(a=>{const k=a.dataset.k,s=S[k]||{};return{
  번호:+k, 법:a.dataset.law, 조:a.dataset.jo, 쪽:a.dataset.page,
  기계가못한까닭:a.dataset.why, 인용줄:a.querySelector('.line').textContent,
  판정:s.state||'', 까닭:s.note||''}})}
function dl(n,t,ty){const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([t],{type:ty}));a.download=n;a.click()}
document.getElementById('dlJson').onclick=()=>dl('본문인용_판정.json',
  JSON.stringify({만든때:new Date().toISOString(),결과:rows()},null,1),'application/json');
document.getElementById('dlCsv').onclick=()=>{const r=rows(),esc=v=>'"'+String(v).replace(/"/g,'""')+'"';
  dl('본문인용_판정.csv','\\uFEFF'+['번호,법,조,쪽,기계가못한까닭,인용줄,판정,까닭',
    ...r.map(x=>[x.번호,x.법,x.조,x.쪽,x.기계가못한까닭,x.인용줄,x.판정,x.까닭].map(esc).join(','))
  ].join('\\n'),'text/csv')};
document.getElementById('reset').onclick=()=>{if(!confirm('판정을 모두 지웁니다. 계속할까요?'))return;
  S={};try{localStorage.removeItem(KEY)}catch(e){};
  for(const t of document.querySelectorAll('textarea'))t.value='';paint()};
paint();
</script></body></html>'''


def main():
    src = os.path.join(DASH, 'cite_human_review.json')
    d = json.load(open(src, encoding='utf-8'))
    items = d['목록']
    parts = []
    for i, it in enumerate(items, 1):
        e = html.escape
        parts.append(
            f'<article data-k="{i}" data-law="{e(it.get("law",""))}" data-jo="{e(it.get("article",""))}" '
            f'data-page="{e(it.get("page",""))}" data-why="{e(it.get("_왜",""))}">'
            f'<div class="hd"><b>{e(it.get("law",""))}</b> {e(it.get("article",""))}'
            f'<span>· {e(it.get("title","") or "(제목 없음)")}</span>'
            f'<span style="opacity:.6">· {e(os.path.basename(it.get("page","")))}</span></div>'
            f'<div class="why">기계가 못한 까닭: {e(it.get("_왜",""))}</div>'
            f'<div class="line">{e(it.get("line",""))}</div>'
            f'<div class="acts">'
            f'<button data-v="맞다">맞다</button><button data-v="틀렸다">틀렸다</button>'
            f'<button data-v="고쳐야">고쳐야 한다</button><button data-v="모르겠다">모르겠다</button>'
            f'</div><textarea placeholder="까닭·고칠 내용(선택)"></textarea></article>')
    h = TPL.replace('__N__', str(len(items))).replace('__BODY__', '\n'.join(parts))
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, '본문인용_뜻풀이판정.html')
    open(out, 'w', encoding='utf-8').write(h)
    c = collections.Counter(x.get('_왜', '?') for x in items)
    print(f'항목 {len(items)}개')
    for k, v in c.most_common():
        print(f'  {v:4d}  {k}')
    print(f'\n  → {os.path.relpath(out, LEGAL)} · {os.path.getsize(out)//1024}KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
