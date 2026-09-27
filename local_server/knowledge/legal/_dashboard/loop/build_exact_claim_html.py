#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-57 뒤쪽 (결심 ⑨) — **「원문 그대로」라던 인용 중 기계가 못 고친 것을 사람이 눌러 확정하는 HTML.**

[결심] 2026-09-25 사장님 — *먼저 갈래를 나눈다.* (처음 추천 ⓐ「따옴표를 떼어 우리 정리로 표시」는
  **전제가 틀려서** 바뀐 것이다 — 아래 참조.)

[왜 ⓐ 를 몰아 쓸 수 없나 — 내가 틀렸던 자리]
  처음에 *"이 18건은 원문에 없는 말이다"* 라고 적었다. **틀렸다.**
  `exact_claim_recheck` 가 **그 쪽의 법 폴더만** 뒤진다고 믿었고(그건 사실이다),
  그래서 남의 법 원문을 옮긴 인용이 「없다」로 떨어진다고 봤다. 거기까지는 맞았는데 —
  ★**진짜 까닭은 딴 데 있었다.** `exact_claim_fix.py` 는 이미 `raw/` 전체를 본다.
  그 자의 `best_window()` 가 **창을 「자르기 전」 닮음으로 골라서** 갈래를 뒤집고 있었다:
    원문에 한자 괄호가 더 붙은 자리(`주의(注意)`·`병과(倂科)`)는 원문이 더 길어
    **꼬리가 창 밖으로 밀리는데**, 그래도 짧은 창이 닮음은 높게 나와 이겼다.
    잘린 꼬리 탓에 갈래가 `뺐다` → `다르다` 로 뒤집혀 **진짜 원문 인용 둘이 사람 몫으로 떨어졌다**
    (형법 제14조 · 형사소송법 제250조).
  ⇒ 그 버그를 고치니 **고칠 수 있다 6 → 9**(줄바꿈이 든 원문 1건은 일부러 뺐다).
  ⇒ 남은 **15건**은 `raw/` 전체에도 없다. 그런데 **한 갈래가 아니다**:
      ① 우리가 쉽게 풀어 쓴 말인데 따옴표를 쳐 원문처럼 보이는 것
      ② 우리가 `...` 로 줄여 쓴 진짜 원문(줄임표가 마침표 셋이라 토막이 어긋난 것)
      ③ 우리가 갖지 않은 법의 원문
    셋에 같은 처방을 쓰면 **원문인데 원문이 아니라고 적는 일**이 또 생긴다.
    ★그래서 기계는 **고르지 않는다**(G-34). 증거만 나란히 놓고 사람이 누른다.

[이 쪽에서 할 수 있는 일]
  · 왼쪽 — 위키가 따옴표 안에 적은 글, 그리고 **기계가 찾은 가장 닮은 원문**(어느 파일인지까지)
  · 오른쪽 — 셋 중 하나를 누른다
      `원문대로 고친다`   그 원문 글자로 갈아 끼운다(자동으로 안 되니 여기서 받는다)
      `우리 정리다`       따옴표를 떼고 「우리 정리」로 표시한다 — 원문 인용이 아니라고 밝힌다
      `그대로 둔다`       손대지 않는다(까닭을 적을 수 있다)
  · `내보내기` 를 누르면 JSON 이 내려받아진다 → 그 파일을 주시면 위키에 반영한다
  · 누른 것은 브라우저에 저장된다(localStorage) — 닫았다 열어도 이어서 할 수 있다

[연계] ← `exact_claim_fix.py`(닮은 창을 찾는 자) → 내보낸 JSON → 위키 인용 글자
사용법: python3 build_exact_claim_html.py   →  `_dashboard/review_html/인용_원문대조.html`
"""
import html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(LEGAL, '_dashboard', 'review_html')
OUT = os.path.join(OUT_DIR, '인용_원문대조.html')
# `exact_claim_fix.py` 를 그대로 불러 쓴다 — 닮은 창을 찾는 법을 두 번 적지 않는다(L-136).
sys.path.insert(0, HERE)
import exact_claim_fix as ECF
import exact_claim_recheck as ECR


def rows():
    """`exact_claim_fix` 와 **같은 자**로 갈라, 사람 몫만 돌려준다."""
    items = json.load(open(ECF.REVIEW, encoding='utf-8'))
    pool = ECF.load_pool()
    out = []
    for k, it in enumerate(items, 1):
        quote = it['인용']
        parts = [t for t in re.split(r'…|\.\.\.', quote) if len(ECR.flat(t)) >= 8] or [quote]
        mine = [x for x in pool if any(x[0].endswith(r.replace('raw/', '')) or r in x[0]
                                      for r in it.get('본raw', []))]
        res = []
        for part in parts:
            need = ECR.flat(part)
            best, bp = (0.0, '', '다르다'), None
            for p, fl, ix, raw in ECF.shortlist(need, pool, mine):
                r, got, kind = ECF.best_window(need, fl, ix, raw)
                if r > best[0]:
                    best, bp = (r, got, kind), p
                if best[0] >= 0.995:
                    break
            res.append({'위키': part.strip(), '원문': (best[1] or '').strip(),
                        '닮음': round(best[0], 3), '갈래': best[2],
                        '파일': os.path.relpath(bp, LEGAL) if bp else ''})
        worst = min(r['닮음'] for r in res)
        multiline = any('\n' in r['원문'] for r in res)
        machine = all(r['갈래'] == '뺐다' for r in res) and worst >= 0.80 and not multiline
        if machine:                     # 기계가 이미 고친 것은 사람에게 안 묻는다
            continue
        out.append({'번호': k, '쪽': it['쪽'], '줄': it['줄'], '토막': res,
                    '닮음': worst,
                    # ★까닭은 **닮음을 먼저** 본다. 줄바꿈을 먼저 보면 닮음 0.08 짜리에도
                    #   「줄바꿈이 있다」고 적힌다 — 그건 못 찾은 것이지 줄바꿈 탓이 아니다.
                    '기계가못한까닭': ('raw 전체에서도 닮은 원문을 못 찾았다' if worst < 0.80
                                 else '원문에 줄바꿈이 있다 — 끼우면 글 구조가 바뀐다' if multiline
                                 else '토막 중에 「뺀 것뿐」이 아닌 것이 있다')})
    return out


CSS = """
:root{--bg:#fff;--fg:#15181c;--line:#dfe3e8;--mut:#5b6672;--card:#f7f9fb;
      --ok:#0b6b3a;--ours:#8a5a00;--skip:#4a5560}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;--card:#1b1f23;
  --ok:#5fd39b;--ours:#e0ad4d;--skip:#9aa4ae}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#14171a;--fg:#e8ebee;--line:#2c3237;--mut:#9aa4ae;
  --card:#1b1f23;--ok:#5fd39b;--ours:#e0ad4d;--skip:#9aa4ae}
*{box-sizing:border-box}
body{margin:0;padding:20px 16px 80px;background:var(--bg);color:var(--fg);
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.wrap{max-width:1040px;margin:0 auto}
h1{font-size:21px;margin:0 0 6px}
.lead{color:var(--mut);margin:0 0 22px}
.item{border:1px solid var(--line);border-radius:10px;margin:0 0 18px;overflow:hidden}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;
  padding:10px 14px;background:var(--card);border-bottom:1px solid var(--line)}
.num{font-weight:700}
.pg{font-size:13px;color:var(--mut);word-break:break-all}
.why{font-size:13px;color:var(--ours)}
.body{padding:12px 14px}
.frag{border-top:1px dashed var(--line);padding:10px 0}
.frag:first-child{border-top:0;padding-top:0}
.lb{font-size:12px;color:var(--mut);margin:0 0 3px}
.tx.none{background:#fff8e1;border-color:#e8c35a}
.tx{white-space:pre-wrap;word-break:break-word;background:var(--card);
  border-radius:6px;padding:8px 10px;margin:0 0 8px;font-size:14px}
.meta{font-size:12px;color:var(--mut);word-break:break-all}
.pick{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line)}
button{font:inherit;padding:7px 12px;border-radius:7px;border:1px solid var(--line);
  background:var(--bg);color:var(--fg);cursor:pointer}
button.on[data-k="원문대로"]{border-color:var(--ok);color:var(--ok);font-weight:700}
button.on[data-k="우리정리"]{border-color:var(--ours);color:var(--ours);font-weight:700}
button.on[data-k="그대로"]{border-color:var(--skip);color:var(--skip);font-weight:700}
textarea{width:100%;min-height:52px;font:inherit;padding:8px 10px;border-radius:7px;
  border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.outbox{border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 18px;
  background:var(--card)}
.outbox textarea{width:100%;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:10px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.outrow{display:flex;gap:10px;align-items:center;margin-top:8px}
.bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;
  padding:10px 16px;background:var(--card);border-top:1px solid var(--line);
  /* 폰에서 홈바에 가리지 않게 — 아래 여백을 바 스스로 더한다 */
  padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px))}
.bar .big{padding:9px 16px;font-weight:700}
.cnt{color:var(--mut);font-size:13px}
@media (max-width:640px){body{padding:16px 16px 92px}}
"""

JS = """
const KEY='exact_claim_review_v1';
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
function draw(){
  document.querySelectorAll('.item').forEach(el=>{
    const id=el.dataset.id, s=S[id]||{};
    el.querySelectorAll('button[data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===s.고른것));
    const t=el.querySelector('textarea'); if(t&&t.value!==(s.메모||''))t.value=s.메모||'';
  });
  const n=Object.values(S).filter(x=>x&&x.고른것).length;
  document.getElementById('cnt').textContent=n+' / '+TOTAL+' 고르셨습니다';
}
function put(id,k){S[id]=Object.assign({},S[id],{고른것:k});store();draw()}
function memo(id,v){S[id]=Object.assign({},S[id],{메모:v});store()}
function store(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
function collect(){
  const out={만든날:new Date().toISOString().slice(0,10),자:'build_exact_claim_html.py',고른것:[]};
  document.querySelectorAll('.item').forEach(el=>{
    const id=el.dataset.id,s=S[id]||{};
    out.고른것.push({번호:+id,쪽:el.dataset.pg,줄:+el.dataset.ln,
      고른것:s.고른것||'',메모:s.메모||'',원문:el.dataset.got||''});
  });
  return JSON.stringify(out,null,1);
}
// ★내보내기는 **두 길**을 다 준다 (2026-09-25).
//   까닭: 이 쪽을 아티팩트로 올려 폰에서 누르실 수 있게 했는데, 아티팩트 안에서는
//   **파일 내려받기가 막혀 있다**(a[download] 가 아무 일도 안 한다). 그래서 내려받기만 두면
//   사장님이 눌러도 **아무 일도 안 일어나고, 화면은 그것을 알려 주지도 않는다.**
//   ⇒ 글을 화면에 띄우고 **복사**를 준다(복사는 된다). 내려받기는 되는 데서만 덧붙는다.
function save(){
  const txt=collect();
  const box=document.getElementById('outbox'), ta=document.getElementById('outjson');
  ta.value=txt; box.hidden=false; ta.focus(); ta.select();
  try{
    const b=new Blob([txt],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(b);
    a.download='인용_원문대조_확정.json';a.click();
  }catch(e){}
  box.scrollIntoView({block:'center'});
}
function copyOut(){
  const ta=document.getElementById('outjson'), msg=document.getElementById('copymsg');
  const done=()=>{msg.textContent='복사했습니다 — 대화창에 붙여 주십시오.';};
  try{
    navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();msg.textContent='아래 글을 직접 복사해 주십시오.';});
  }catch(e){ta.select();msg.textContent='아래 글을 직접 복사해 주십시오.';}
}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');
  if(b)put(b.closest('.item').dataset.id,b.dataset.k)});
document.addEventListener('input',e=>{if(e.target.tagName==='TEXTAREA')
  memo(e.target.closest('.item').dataset.id,e.target.value)});
draw();
"""


def build(data):
    e = html.escape
    P = []
    P.append('<!doctype html><html lang="ko"><head><meta charset="utf-8">')
    P.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
    P.append('<title>인용 원문대조</title><style>%s</style></head><body><div class="wrap">' % CSS)
    P.append('<h1>「원문 그대로」라던 인용 — 기계가 못 고친 %d자리</h1>' % len(data))
    P.append('<p class="lead">기계는 <b>고르지 않습니다</b>. 찾은 증거만 나란히 놓았습니다. '
             '셋 중 하나를 눌러 주시고 <b>내보내기</b> 를 누르시면 됩니다.<br>'
             '· <b>원문대로 고친다</b> — 오른쪽 원문이 맞다. 그 글자로 갈아 끼운다<br>'
             '· <b>우리 정리다</b> — 원문 인용이 아니다. 따옴표를 떼고 「우리 정리」로 표시한다<br>'
             '· <b>그대로 둔다</b> — 손대지 않는다(까닭을 적어 주시면 등록부에 남깁니다)</p>')
    for d in data:
        got = d['토막'][0]['원문'] if d['토막'] else ''
        P.append('<div class="item" data-id="%d" data-pg="%s" data-ln="%d" data-got="%s">'
                 % (d['번호'], e(d['쪽']), d['줄'], e(got)))
        P.append('<div class="head"><span class="num">[%d]</span>'
                 '<span class="pg">%s:%d</span>'
                 '<span class="why">기계가 못 한 까닭 — %s (닮음 %.2f)</span></div>'
                 % (d['번호'], e(d['쪽']), d['줄'], e(d['기계가못한까닭']), d['닮음']))
        P.append('<div class="body">')
        for f in d['토막']:
            P.append('<div class="frag">')
            P.append('<p class="lb">위키가 따옴표 안에 적은 글</p><div class="tx">%s</div>' % e(f['위키']))
            # ★닮음이 너무 낮으면 「가장 닮은 원문」을 **원문 후보로 내밀지 않는다.**
            #   실측(2026-09-27, 브라우저로 열어 봄): 19토막 중 6토막이 닮음 0.30 미만이고,
            #   그 자리에는 엉뚱한 조각이 원문 후보로 올라와 있었다 — 보기 —
            #     위키: "검정은 의무가 아니므로 받았을 수도 안 받았을 수도 있고 …"
            #     보여 준 「가장 닮은 원문」: "정)\n이 법은 낚시의 관리 및 육성에"  (닮음 0.14)
            #   이런 조각은 견줄 거리가 아니라 **헷갈리게 하는 것**이다. 기계가 못 찾았다고 말하는 것이
            #   맞다(L-384 — 「없다」는 가장 비싼 주장이니, 찾지 못했다고만 적는다).
            낮 = f['닮음'] < 0.30
            if 낮:
                P.append('<p class="lb">기계가 찾은 가장 닮은 원문</p>'
                         '<div class="tx none">— <b>닮은 원문을 찾지 못했습니다</b>(닮음 %.2f). '
                         '아래에 기계가 집은 조각이 있지만 <b>견줄 거리가 못 됩니다</b> — '
                         '이 글은 원문 인용이 아니라 <b>우리 정리</b>일 가능성이 큽니다.</div>'
                         % f['닮음'])
                if f['원문']:
                    P.append('<details><summary style="font-size:12px;color:#777;cursor:pointer">'
                             '기계가 집은 조각 보기 (참고 안 됨)</summary>'
                             '<div class="tx">%s</div></details>' % e(f['원문']))
            else:
                P.append('<p class="lb">기계가 찾은 가장 닮은 원문</p><div class="tx">%s</div>'
                         % (e(f['원문']) or '<i>— 닮은 원문을 못 찾았다</i>'))
            P.append('<p class="meta">닮음 %.3f%s · %s · %s</p>'
                     % (f['닮음'], ' ★너무 낮아 견줄 수 없다' if 낮 else '',
                        e(f['갈래']), e(f['파일']) or '—'))
            P.append('</div>')
        P.append('</div>')
        P.append('<div class="pick">'
                 '<button data-k="원문대로">원문대로 고친다</button>'
                 '<button data-k="우리정리">우리 정리다</button>'
                 '<button data-k="그대로">그대로 둔다</button>'
                 '</div>')
        P.append('<div class="body"><textarea placeholder="까닭·메모 (선택)"></textarea></div>')
        P.append('</div>')
    P.append('<div id="outbox" class="outbox" hidden>'
             '<p class="lb">고르신 것 — 이 글을 <b>복사해 대화창에 붙여</b> 주시면 제가 위키에 반영합니다.</p>'
             '<textarea id="outjson" readonly rows="10"></textarea>'
             '<div class="outrow"><button onclick="copyOut()">복사</button>'
             '<span class="cnt" id="copymsg"></span></div></div>')
    P.append('</div><div class="bar"><button class="big" onclick="save()">내보내기</button>'
             '<span class="cnt" id="cnt"></span></div>')
    P.append('<script>const TOTAL=%d;%s</script></body></html>' % (len(data), JS))
    return '\n'.join(P)


def main():
    data = rows()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(build(data))
    print('사람 몫 %d자리 → %s' % (len(data), os.path.relpath(OUT, LEGAL)))
    for d in data:
        print('  [%2d] 닮음 %.2f  %s:%d  — %s'
              % (d['번호'], d['닮음'], d['쪽'].split('/')[-1], d['줄'], d['기계가못한까닭']))
    print('\n   브라우저로 열어 누르시고, `내보내기` 로 받은 JSON 을 주시면 위키에 반영합니다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
