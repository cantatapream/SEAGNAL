#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-6 (결심 ②ⓐ) — **고시 11쪽의 「적용범위」를 사람이 눌러서 확정하는 HTML 을 만든다.**

[결심] 2026-09-24 사장님 ⓐ — *사람이 한 번 읽고 확정한다. 다만 HTML 확인판으로 부담을 줄인다.*

[왜 기계가 못 쓰나 — 지어내지 않는다]
  고시에는 「이 고시는 ○○에 적용한다」가 **조문 하나로 딱 적혀 있지 않은 경우**가 많다.
  제1조(목적) + 총칙의 적용·제외 조 + 위임근거 **셋을 같이 읽어야** 범위가 나온다.
  이 셋을 기계가 한 문장으로 합치면 그것이 **환각**이다(G-34 — 기계가 고르지 않는다).
  ⇒ 기계가 하는 일은 딱 둘이다: **원문을 그대로 오려 놓는 것**, 그리고 **고른 것을 받아 적는 것**.

[이 쪽에서 할 수 있는 일]
  · 왼쪽 — 그 고시의 **원문 세 토막**(목적 · 적용/제외 · 위임근거)을 그대로 본다
  · 오른쪽 — 「적용범위·제외」와 「타법 연결」 두 칸에 **넣을 글**을 고른다
      `원문 그대로 쓴다` 를 누르면 그 토막이 칸에 들어간다(손으로 고쳐도 된다)
      `모르겠다` 를 누르면 그 자리는 **비운 채로 표시**된다 — 억지로 채우지 않는다
  · 다 하고 `내보내기` 를 누르면 JSON 이 내려받아진다 → 그 파일을 주시면 위키에 반영한다
  · 누른 것은 브라우저에 저장된다(localStorage) — 닫았다 열어도 이어서 할 수 있다

[연계] ← `_dashboard/notice_scope_prep.md`(원문만 모아 둔 것, `notice_scope_prep.py` 가 만든다)
        → 내보낸 JSON → 위키 `## 적용범위·제외` · `## 타법 연결`
사용법: python3 build_scope_html.py   →  `_dashboard/review_html/고시_적용범위.html`
"""
import html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
PREP = os.path.join(LEGAL, '_dashboard', 'notice_scope_prep.md')
OUT_DIR = os.path.join(LEGAL, '_dashboard', 'review_html')
OUT = os.path.join(OUT_DIR, '고시_적용범위.html')


def parse_prep():
    """준비 파일을 고시별로 가른다 → [{이름, 원문경로, 칸:[{어디, 제목, 글}]}]"""
    txt = open(PREP, encoding='utf-8').read()
    docs = []
    for chunk in re.split(r'^## ', txt, flags=re.M)[1:]:
        lines = chunk.split('\n')
        name = lines[0].strip()
        rawp = ''
        m = re.search(r'원문:\s*`([^`]+)`', chunk)
        if m:
            rawp = m.group(1)
        slots = []
        # `### → \`## 무엇\` 에 넣을 원문` 아래의 `**제목** — 원문 그대로` + ``` 블록
        for sec in re.split(r'^### ', chunk, flags=re.M)[1:]:
            head = sec.split('\n')[0]
            where = '적용범위·제외' if '적용범위' in head else ('타법 연결' if '타법' in head else head.strip())
            got = False
            for t, body in re.findall(r'\*\*([^*]+)\*\*[^\n]*\n+```\n(.*?)\n```', sec, re.S):
                slots.append({'어디': where, '제목': t.strip(), '글': body.strip()})
                got = True
            # ★「타법 연결」 은 ``` 블록이 아니라 **표**로 적혀 있다 (2026-09-24 실측 —
            #   처음에 ``` 만 찾아 22자리 가운데 11자리를 놓쳤다). 표도 그대로 받는다.
            if not got:
                tbl = [l for l in sec.split('\n')[1:] if l.strip().startswith('|')]
                if tbl:
                    slots.append({'어디': where, '제목': '준비된 표 그대로', '글': '\n'.join(tbl).strip()})
        docs.append({'이름': name, '원문경로': rawp, '칸': slots})
    return docs


TPL = '''<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>고시 적용범위 확정</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--line:#d8d8d8;--soft:#f6f6f6;--ok:#0a7d32;--no:#b3261e;--warn:#8a6d00}
*{box-sizing:border-box}body{margin:0;font:15px/1.7 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;background:#fff;border-bottom:2px solid var(--fg);padding:12px 16px;z-index:9}
h1{margin:0 0 4px;font-size:18px}.sub{font-size:13px;color:#555}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
button{font:inherit;padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer}
button:hover{background:var(--soft)}
button.go{border-color:var(--ok);color:var(--ok)}button.skip{border-color:var(--warn);color:var(--warn)}
button.big{border:2px solid var(--fg);font-weight:700}
main{padding:16px;max-width:1400px;margin:0 auto}
.doc{border:1px solid var(--line);border-radius:10px;margin-bottom:22px;overflow:hidden}
.doc>h2{margin:0;padding:10px 14px;background:var(--soft);font-size:16px;border-bottom:1px solid var(--line)}
.doc>h2 .p{font-weight:400;font-size:12px;color:#666;display:block}
.slot{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--line)}
.side{padding:12px 14px}.side+.side{border-left:1px solid var(--line)}
.tag{font-size:12px;color:#666;margin-bottom:6px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);border:1px solid var(--line);
border-radius:6px;padding:10px;margin:0 0 8px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:340px;overflow:auto}
textarea{width:100%;min-height:150px;font:13px/1.6 ui-monospace,Menlo,monospace;padding:8px;
border:1px solid var(--line);border-radius:6px;resize:vertical}
.state{font-size:13px;font-weight:700;margin-left:8px}
.state.done{color:var(--ok)}.state.skip{color:var(--warn)}
@media(max-width:900px){.slot{grid-template-columns:1fr}.side+.side{border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<header>
 <h1>고시 적용범위 확정 — __N__자리</h1>
 <div class="sub">왼쪽이 <b>원문</b>입니다. 오른쪽 칸에 들어갈 글을 정해 주세요.
  <b>「원문 그대로 쓴다」</b>를 누르면 그 토막이 칸에 들어갑니다(고쳐 쓰셔도 됩니다).
  정할 수 없으면 <b>「모르겠다」</b>를 누르세요 — <b>억지로 채우지 않습니다.</b></div>
 <div class="bar">
  <span id="cnt"></span>
  <button class="big" onclick="save()">내보내기 (JSON)</button>
  <button onclick="if(confirm('누른 것을 모두 지웁니다. 계속할까요?')){localStorage.removeItem(KEY);location.reload()}">처음부터</button>
 </div>
</header>
<main>__BODY__</main>
<script>
const KEY='scope_review_v1';
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
function put(id,txt){const t=document.getElementById('t_'+id);t.value=txt;mark(id,'done')}
function skip(id){const t=document.getElementById('t_'+id);t.value='';mark(id,'skip')}
function mark(id,how){S[id]={상태:how,글:document.getElementById('t_'+id).value};
 localStorage.setItem(KEY,JSON.stringify(S));
 const e=document.getElementById('s_'+id);
 e.className='state '+how;e.textContent=how==='done'?'✓ 정했습니다':'— 모르겠다고 표시했습니다';count()}
function edited(id){if(!S[id])S[id]={상태:'done',글:''};S[id].글=document.getElementById('t_'+id).value;
 S[id].상태=S[id].글.trim()?'done':'skip';localStorage.setItem(KEY,JSON.stringify(S));
 const e=document.getElementById('s_'+id);e.className='state '+S[id].상태;
 e.textContent=S[id].상태==='done'?'✓ 정했습니다':'— 비어 있습니다';count()}
function count(){const all=document.querySelectorAll('textarea').length;
 const d=Object.values(S).filter(x=>x.상태==='done').length;
 const s=Object.values(S).filter(x=>x.상태==='skip').length;
 document.getElementById('cnt').textContent=`정한 것 ${d} · 모르겠다 ${s} · 남은 것 ${all-d-s} / 모두 ${all}`}
function save(){const out={만든날:new Date().toISOString().slice(0,10),무엇:'3-6 고시 적용범위 확정',자리:[]};
 document.querySelectorAll('[data-slot]').forEach(el=>{const id=el.dataset.slot;
  out.자리.push({id,고시:el.dataset.doc,어디:el.dataset.where,근거:el.dataset.title,
   상태:(S[id]||{}).상태||'미정',글:document.getElementById('t_'+id).value})});
 const b=new Blob([JSON.stringify(out,null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='고시_적용범위_확정.json';a.click()}
window.addEventListener('DOMContentLoaded',()=>{for(const [id,v] of Object.entries(S)){
 const t=document.getElementById('t_'+id);if(!t)continue;t.value=v.글||'';
 const e=document.getElementById('s_'+id);e.className='state '+v.상태;
 e.textContent=v.상태==='done'?'✓ 정했습니다':'— 모르겠다고 표시했습니다'}count()})
</script></body></html>'''


def main():
    if not os.path.exists(PREP):
        print('❌ 준비 파일이 없다:', PREP); return 1
    docs = parse_prep()
    n = 0
    parts = []
    for d in docs:
        rows = []
        # 「어디」별로 묶어 한 칸씩 만든다
        wheres = []
        for s in d['칸']:
            if s['어디'] not in wheres:
                wheres.append(s['어디'])
        for w in wheres:
            srcs = [s for s in d['칸'] if s['어디'] == w]
            sid = re.sub(r'\W+', '_', f"{d['이름']}_{w}")
            n += 1
            left = ''.join(
                f'<div class="tag">{html.escape(s["제목"])} — 원문 그대로</div>'
                f'<pre>{html.escape(s["글"])}</pre>'
                f'<button class="go" onclick="put(\'{sid}\',{json.dumps(s["글"], ensure_ascii=False)})">'
                f'이 원문 그대로 쓴다</button> '
                for s in srcs)
            rows.append(
                f'<div class="slot" data-slot="{sid}" data-doc="{html.escape(d["이름"])}" '
                f'data-where="{html.escape(w)}" data-title="{html.escape("·".join(s["제목"] for s in srcs))}">'
                f'<div class="side"><div class="tag"><b>원문</b> — 이 고시에서 오려 온 것입니다</div>{left}</div>'
                f'<div class="side"><div class="tag"><b>위키 「## {html.escape(w)}」 에 들어갈 글</b>'
                f'<span class="state" id="s_{sid}"></span></div>'
                f'<textarea id="t_{sid}" oninput="edited(\'{sid}\')" '
                f'placeholder="왼쪽 「이 원문 그대로 쓴다」를 누르거나, 직접 적으세요"></textarea>'
                f'<div style="margin-top:6px"><button class="skip" onclick="skip(\'{sid}\')">'
                f'모르겠다 (비워 둔다)</button></div></div></div>')
        parts.append(
            f'<section class="doc"><h2>{html.escape(d["이름"])}'
            f'<span class="p">원문: {html.escape(d["원문경로"])}</span></h2>{"".join(rows)}</section>')
    os.makedirs(OUT_DIR, exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(
        TPL.replace('__BODY__', ''.join(parts)).replace('__N__', str(n)))
    print(f'▣ 만들었다: {os.path.relpath(OUT, LEGAL)}')
    print(f'   고시 {len(docs)}개 · 정할 자리 {n}개 · {os.path.getsize(OUT)//1024}KB')
    print('   브라우저로 열어 누르시고, `내보내기` 로 받은 JSON 을 주시면 위키에 반영합니다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
