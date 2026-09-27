#!/usr/bin/env node
/**
 * §6-F 항목수 대조의 **사람 몫**을 눌러서 확정하는 쪽을 만든다. (2026-09-24, 2026-09-27 다시 짬)
 *
 * [왜 사람이 해야 하나 — 기계가 못 하는 것을 분명히 한다]
 *   원문 쪽 수는 기계가 센다(`article_text.countBoxRows`). **위키 쪽 수는 못 센다.**
 *   위키는 원문 표를 **다시 짜기** 때문이다 — `〃` 를 풀어 쓰고, 비고를 목록으로 내리고, 칸을 합친다.
 *   3-28 에서도 박스 표 80쪽 중 자동 대조가 맞은 것은 **9쪽뿐**이었다.
 *   ★2026-09-27 재측정 — 위키의 **별표 표만** 바르게 세어 원문과 견줘도 **38 중 36 이 다르다.**
 *     즉 「사람이 세야 한다」는 전제는 **맞다**(옛 근거 숫자가 틀렸어도 결론은 그대로다 — 재서 확인했다).
 *
 * [★2026-09-27 — 이 쪽을 다시 짠 까닭. 사장님께 내밀기 전에 실측으로 세 가지가 드러났다]
 *   ① **위키 쪽에 표가 3덩이씩 보였다(38/38).** 옛 `mdTables()` 가 파일의 표를 전부 긁어서
 *      「근거 조문」·「변경 이력」 표까지 함께 보여 줬다. 별표는 그중 하나뿐이니
 *      **어느 것을 세라는 건지 알 수 없는 물음**이었다. ⇒ `별표표()` 로 머리글을 보고 가른다.
 *   ② **위키에 적힌 「기계 셈 N행」이 38개 모두 틀렸다.** `annex_rowcount_fill.countMdRows()` 가
 *      파일 전체를 세고 머리줄까지 세었다. 보기 — 국제항해선박 시행규칙 별표2:
 *        별표 표(머리1+데이터4=5) + 근거 조문(1+4=5) + 변경 이력(1+1=2) = **12**  ← 위키에 적힌 수
 *        별표 표만 데이터 줄로 세면 **4** (원문 4행과 같다)
 *      바르게 다시 센 값과 적힌 값이 같은 것은 **0/38** 이다. ⇒ 이 쪽은 적힌 수를 **쓰지 않고**
 *      제가 다시 세어 「후보」로만 보인다. (위키 줄 자체의 정정은 `annex_rowcount_fill.js` 몫이다)
 *   ③ **위키에 별표 표가 아예 없는 자리가 7개.** 그 7개에 「이 표가 몇 행이냐」고 물으면
 *      셀 표가 없다. ⇒ **물음이 다르다** — 따로 묶어 「표로 안 옮겼다, 어떻게 할까」를 묻는다.
 *
 * [이 쪽에서 하는 일]
 *   ① 이 별표가 무엇인가 · ② 기계가 센 것과 못 센 것 · ③ 무엇을 어떻게 세나 · ④ 두 표를 나란히
 *   왼쪽 원문에는 **기계가 논리 행으로 센 줄에 `▸` 를 달아** 둔다 — 같은 기준으로 세실 수 있도록.
 *   ⚠단 표시 개수가 `countBoxRows` 값과 안 맞으면 **표시를 떼고 그렇다고 적는다**
 *     (틀린 안내는 없는 안내보다 나쁘다).
 *   오른쪽 위키는 **별표 표만**, 표마다 따로, 각 표의 데이터 줄 수를 붙여 보인다.
 *   수가 다르면 **까닭 칸**이 열린다 — §6-F 가 요구하는 그 까닭이다(비워 두면 게이트가 잡는다).
 *   `내보내기 — 복사` → 채팅방에 붙여넣을 글. `파일로 내림` → 같은 글을 .txt 로.
 *
 * [연계] ← `wiki/annexes/*.md` 의 `항목수 대조(§6-F): … 위키 미확인(…)` 줄
 *         ← 세는 법의 임자 `local_server/services/article_text.countBoxRows`(L-136 · §6-F)
 *         → `annex_rowcount_gate.js`(V5-40) 가 확정된 줄을 검사한다
 * 사용법: node build_rowcount_html.js  →  `_dashboard/review_html/별표_항목수.html`
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki', 'annexes');
const OUT_DIR = path.join(LEGAL, '_dashboard', 'review_html');
const OUT = path.join(OUT_DIR, '별표_항목수.html');
// ★세는 법의 임자는 운영 코드다(L-136) — 여기서 따로 구현하지 않는다.
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));   // 게이트와 같은 길로 부른다

const ROW_RE = /항목수\s*대조\s*\(?§?6-F\)?\s*[::]\s*원문\s*(\d+)\s*행\s*\/\s*위키\s*미확인\s*\(\s*기계\s*셈\s*(\d+)\s*행\s*\)/;
const SRC_RE = /^[ \t]*>?[ \t]*(?:★)?[ \t]*raw[ \t]*원문[ \t]*[::][ \t]*`?(raw\/[^`\s]+\.txt)`?/gm;

// ★별표 표를 골라내는 법은 **공용 모듈 한 곳**에 있다(L-386) — `_byl_wiki_table.js`.
//   예전에는 이 자와 `annex_rowcount_fill.js` 가 각자 세었고 **둘 다 파일의 표를 전부 긁었다.**
const { 별표표, 마디수, 원문큰마디, 없는큰마디: 없는큰마디찾기 } = require('./_byl_wiki_table.js');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 원문 표에서 **기계가 논리 행으로 센 줄**에 `▸` 를 붙인다. → `{글, 센수}`
 * `countBoxRows` 와 **같은 판정을 그대로 되짚는다** — 세는 법을 여기서 새로 만들지 않는다.
 * 부르는 쪽이 `센수 === countBoxRows(...)` 를 확인하고, 안 맞으면 표시를 버린다.
 */
function 행표시(text) {
    const BOX_V = /[│┃|┤├┬┼┴┌┐└┘╡╢╞╟╪╫]/;
    const BOX_H = /[─━┄┈]/g;
    const out = [];
    let 센수 = 0;
    let inRow = false;
    for (const l of String(text || '').split('\n')) {
        const bare = l.replace(/\s/g, '');
        let 머리 = '  ';
        if (!bare || !BOX_V.test(l)) { inRow = false; }
        else {
            const h = (bare.match(BOX_H) || []).length;
            if (h * 2 >= bare.length) { inRow = false; }
            else if (!inRow) { 센수++; inRow = true; 머리 = '▸ '; }
        }
        out.push(머리 + l);
    }
    return { 글: out.join('\n'), 센수 };
}

const TPL = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>별표 항목수 대조</title><style>
:root{color-scheme:light;--bg:#fff;--fg:#17191c;--line:#dde1e6;--soft:#f5f7f9;--band:#eef3fa;
      --ok:#0a7d32;--warn:#8a6d00;--no:#b3261e;--mut:#5b6672;--accent:#0b57d0}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#14161a;--fg:#e8eaed;--line:#333941;--soft:#1c1f24;--band:#1b2330;
  --ok:#6ddb92;--warn:#e8c35a;--no:#ff9c94;--mut:#9aa4b0;--accent:#8ab4f8}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#14161a;--fg:#e8eaed;--line:#333941;--soft:#1c1f24;--band:#1b2330;
  --ok:#6ddb92;--warn:#e8c35a;--no:#ff9c94;--mut:#9aa4b0;--accent:#8ab4f8}
*{box-sizing:border-box}
body{margin:0;font:15px/1.7 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;background:var(--bg);border-bottom:2px solid var(--fg);padding:12px 16px;z-index:9}
h1{margin:0 0 4px;font-size:18px}.sub{font-size:13px;color:var(--mut)}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
button{font:inherit;padding:6px 12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:6px;cursor:pointer}
button:hover{background:var(--soft)}button.big{border:2px solid var(--fg);font-weight:700}
main{padding:16px;max-width:1500px;margin:0 auto}
.intro{background:var(--band);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:0 0 20px}
.intro h2{margin:14px 0 6px;font-size:15px}.intro h2:first-child{margin-top:0}
.intro p,.intro li{margin:4px 0;font-size:14px}.intro ul{margin:4px 0 4px 20px;padding:0}
.intro code{background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:12px}
.intro details{margin-top:10px}.intro summary{cursor:pointer;font-weight:700;font-size:14px}
h2.grp{margin:26px 0 10px;font-size:16px;border-bottom:2px solid var(--fg);padding-bottom:4px}
.item{border:1px solid var(--line);border-radius:10px;margin-bottom:22px;overflow:hidden}
.item.done{border-color:var(--ok)}
.item>h3{margin:0;padding:10px 14px;background:var(--soft);font-size:15px;border-bottom:1px solid var(--line)}
.item>h3 .p{font-weight:400;font-size:12px;color:var(--mut);display:block;word-break:break-all}
.sec{padding:10px 14px;border-bottom:1px solid var(--line);font-size:14px}
.sec b.k{display:inline-block;min-width:1.4em}
.sec.hint{background:var(--band)}
.sec code{background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:12px}
.two{display:grid;grid-template-columns:1fr 1fr}
.side{padding:12px 14px;min-width:0}.side+.side{border-left:1px solid var(--line)}
.tag{font-size:12px;color:var(--mut);margin-bottom:6px}
pre{white-space:pre;overflow:auto;background:var(--soft);border:1px solid var(--line);border-radius:6px;
padding:10px;margin:0 0 8px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:460px}
.tbl{margin-bottom:10px}.tbl .cap{font-size:12px;color:var(--mut);margin-bottom:4px}
.ask{padding:12px 14px;background:var(--band);display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
label{font-size:13px}
input[type=number]{width:90px;font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
input[type=text]{flex:1;min-width:280px;font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.why{display:none;width:100%;margin-top:6px}.why.on{display:flex;gap:8px;align-items:center}
.st{font-size:13px;font-weight:700}.st.ok{color:var(--ok)}.st.need{color:var(--no)}
.pick{display:flex;gap:8px;flex-wrap:wrap}
.pick button.on{background:var(--ok);color:#fff;border-color:var(--ok);font-weight:700}
.big-gap{color:var(--no);font-weight:700}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--fg);color:var(--bg);
padding:10px 16px;border-radius:8px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:99}
#toast.on{opacity:1}
@media(max-width:1000px){.two{grid-template-columns:1fr}.side+.side{border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<header><h1>별표 항목수 대조 — __N__자리</h1>
<div class="sub">위키가 <b>몇 행인지</b>만 적어 주시면 됩니다. 아래 설명을 먼저 한 번 읽어 주십시오.</div>
<div class="bar"><span id="cnt"></span>
<button class="big" onclick="copyOut()">내보내기 — 복사</button>
<button onclick="save()">파일로 내림</button>
<button onclick="if(confirm('적은 것을 모두 지웁니다.')){try{localStorage.removeItem(KEY)}catch(e){}location.reload()}">처음부터</button>
</div></header><main>
<div class="intro">
<h2>무엇이 문제인가</h2>
<p>법의 <b>별표</b>는 대개 표입니다. 우리는 그 표를 원문에서 베껴 위키에 옮겨 적었습니다.
그런데 <b>옮기다가 줄이 빠졌는지 아무도 확인하지 않았습니다.</b>
한 줄이 빠지면 챗봇은 그 줄을 영원히 모릅니다.</p>

<h2>기계가 한 것 / 못 한 것</h2>
<ul>
<li><b>원문이 몇 행인지 — 기계가 셌습니다.</b> 세는 자는 챗봇이 쓰는 그 함수입니다(<code>countBoxRows</code>).
    왼쪽 원문에서 <b><code>▸</code> 가 붙은 줄</b>이 기계가 「한 행」으로 센 줄입니다.</li>
<li><b>위키가 몇 행인지 — 기계가 못 셉니다.</b> 위키는 원문 표를 그대로 베낀 것이 아니라
    <b>다시 짠</b> 것이기 때문입니다. <code>〃</code> 를 풀어 쓰고, 비고를 아래 목록으로 내리고, 칸을 합칩니다.
    실제로 재 보니 <b>38자리 중 36자리에서 두 수가 다릅니다</b> — 기계가 숫자를 채우면 거짓 「어긋남」이 쏟아집니다.
    그래서 <b>이 한 가지만</b> 사장님께 여쭙습니다.</li>
</ul>

<h2>행을 어떻게 세나 — 기계와 같은 기준으로</h2>
<p><b>줄이 아니라 「항목이 바뀌는 자리」를 셉니다.</b> 원문 표에서 한 항목이 두세 줄에 걸쳐 적혀 있어도
그건 <b>한 행</b>입니다. 가로 구분선(<code>├──┼──┤</code>)으로 나뉜 덩이 하나가 한 행입니다.</p>
<p>위키 표에서는 <b><code>|</code> 로 시작하는 데이터 줄 하나</b>가 한 행이고,
맨 위 이름줄(<code>| 구분 | 내용 |</code>)과 <code>|---|---|</code> 는 세지 않습니다.
오른쪽 위키 표마다 <b>제가 미리 센 수를 「후보」로 붙여</b> 두었습니다.
맞으면 그 수를 그대로 적어 주시고, 제가 잘못 세었으면 고쳐 적어 주십시오.</p>

<h2>수가 다르면 — 그게 잘못이라는 뜻이 아닙니다</h2>
<p>위키를 다시 짰기 때문에 수는 <b>달라도 정상</b>입니다. 그래서 수가 다르면 <b>까닭 칸</b>이 열립니다.
「원문의 <code>〃</code> 를 풀어 적었다」, 「비고를 아래 목록으로 내렸다」 같이 한 줄만 적어 주시면 됩니다.
그 까닭이 있으면 게이트가 통과시키고, 없으면 <b>빠진 줄로 보고 잡습니다.</b></p>
<p class="big-gap">⚠ 원문보다 위키가 <b>크게 적은</b> 자리는 붉게 표시했습니다 — 거기는 까닭이 아니라
<b>정말 빠진 것</b>일 가능성이 큽니다. 그렇게 보이면 까닭 칸에 「빠진 것 같다」고만 적어 주십시오.</p>

<h2>★고르지 않으셔도 됩니다</h2>
<p>모르겠는 칸은 비워 두고 넘기셔도 됩니다. 내보내기는 <b>적으신 것만</b> 담습니다.
적은 것은 이 브라우저에 저장되니 창을 닫아도 남습니다.</p>

<details><summary>말 풀이</summary>
<ul>
<li><b>별표</b> — 법 본문 뒤에 붙는 표·목록. 기준·요건·금액 같은 실제 숫자가 여기 있습니다.</li>
<li><b>§6-F</b> — 우리 규약에서 「별표를 옮겼으면 항목 수를 대조해 적어라」고 정한 마디입니다.</li>
<li><b>원문(raw)</b> — 국가법령정보센터에서 받아 온, 손대지 않은 글.</li>
<li><b>위키</b> — 챗봇이 실제로 읽는 우리 문서. 여기가 틀리면 챗봇이 틀립니다.</li>
<li><b>게이트</b> — 올리기 전에 자동으로 도는 검사. 까닭 없는 어긋남은 여기서 막힙니다.</li>
</ul></details>
</div>
__BODY__</main><div id="toast"></div>
<script>
const KEY='rowcount_review_v2';let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
const D=__DATA__;
let 종=0;
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('on');
 clearTimeout(종);종=setTimeout(()=>t.classList.remove('on'),1600)}
function 저장(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}

/* ── 표가 있는 칸: 수를 적는다 ── */
function chg(id){
 const o=document.getElementById('o_'+id),w=document.getElementById('w_'+id),
       y=document.getElementById('y_'+id),wy=document.getElementById('wy_'+id),
       st=document.getElementById('s_'+id),el=document.getElementById(id);
 const ov=o.value===''?null:Number(o.value), wv=w.value===''?null:Number(w.value);
 const diff = wv!==null && ov!==null && ov!==wv;
 y.className='why'+(diff?' on':'');
 S[id]={원문:ov,위키:wv,까닭:wy.value};저장();
 if(wv===null){st.className='st need';st.textContent='— 아직 안 적었습니다'}
 else if(diff&&!wy.value.trim()){st.className='st need';st.textContent='★수가 다릅니다 — 까닭을 한 줄 적어 주세요'}
 else if(diff){st.className='st ok';st.textContent='✓ 적었습니다 (수가 다르고 까닭이 있음)'}
 else{st.className='st ok';st.textContent='✓ 적었습니다 (수가 같음)'}
 el.classList.toggle('done', wv!==null && (!diff || !!wy.value.trim()));
 count()}

/* ── 표가 없는 칸: 무엇을 할지 고른다 ── */
function pickNo(id,값){
 const v=S[id]||{};
 if(v.판정===값){S[id]={메모:v.메모||''};저장();칠no(id);toast('물렸습니다');count();return}
 S[id]={판정:값,메모:v.메모||((document.getElementById('m_'+id)||{}).value||'')};저장();칠no(id);count();
 toast('적었습니다 — '+값)}
function memoNo(id){const v=S[id]||{};v.메모=document.getElementById('m_'+id).value;S[id]=v;저장()}
function 칠no(id){
 const el=document.getElementById(id),st=document.getElementById('s_'+id),v=S[id]||{};
 el.querySelectorAll('.pick button').forEach(b=>b.classList.toggle('on',b.dataset.v===v.판정));
 st.className='st '+(v.판정?'ok':'need');
 st.textContent=v.판정?('✓ '+v.판정):'— 아직 안 고르셨습니다';
 el.classList.toggle('done',!!v.판정)}

function count(){
 const 표칸=Object.keys(D).filter(k=>D[k].종류==='표');
 const 없칸=Object.keys(D).filter(k=>D[k].종류==='표없음'||D[k].종류==='마디');
 const a=표칸.filter(k=>{const v=S[k]||{};return v.위키!==null&&v.위키!==undefined&&
   (v.원문===v.위키||(v.까닭||'').trim())}).length;
 const b=없칸.filter(k=>(S[k]||{}).판정).length;
 document.getElementById('cnt').textContent=
   '수를 적은 칸 '+a+' / '+표칸.length+'  ·  고른 칸 '+b+' / '+없칸.length}

function 내보내기글(){
 const L=['# 별표 항목수 대조 (§6-F) — 판정 결과',
          '# 내보낸 때 '+new Date().toLocaleString('ko-KR'),''];
 let n=0;
 Object.keys(D).forEach((k,i)=>{
  const d=D[k],v=S[k]||{};
  if(d.종류==='표'){
   if(v.위키===null||v.위키===undefined)return;
   n++;L.push('['+(i+1)+'] '+d.쪽);
   L.push('    원문 '+v.원문+'행  ·  위키 '+v.위키+'행'+(v.원문===v.위키?'  (같음)':'  (다름)'));
   if(v.까닭&&v.까닭.trim())L.push('    까닭: '+v.까닭.trim());
   L.push('')}
  else{
   if(!v.판정)return;
   n++;L.push('['+(i+1)+'] '+d.쪽+(d.종류==='마디'?'   ※별표를 마디로 풀어 적은 자리':'   ※위키에 별표 표가 없는 자리'));
   L.push('    판정: '+v.판정);
   if(v.메모&&v.메모.trim())L.push('    메모: '+v.메모.trim());
   L.push('')}});
 if(!n)L.push('(아직 적으신 칸이 없습니다)','');
 L.push('---JSON---',JSON.stringify(S));
 return L.join('\\n')}

async function copyOut(){
 const t=내보내기글();
 try{await navigator.clipboard.writeText(t);toast('복사했습니다 — 채팅방에 붙여넣어 주세요')}
 catch(e){const ta=document.getElementById('out');ta.hidden=false;ta.value=t;ta.focus();ta.select();
  toast('복사가 막혔습니다 — 아래 글상자가 열렸으니 직접 복사해 주세요')}}
function save(){
 const b=new Blob([내보내기글()],{type:'text/plain;charset=utf-8'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);
 a.download='별표_항목수_확정.txt';a.click();
 toast('내려받지 못하면 「복사」를 눌러 주세요')}

window.addEventListener('DOMContentLoaded',()=>{
 Object.keys(D).forEach(k=>{
  const d=D[k],v=S[k]||{};
  if(d.종류==='표'){
   const o=document.getElementById('o_'+k);if(!o)return;
   if(v.원문!=null)o.value=v.원문;
   if(v.위키!=null)document.getElementById('w_'+k).value=v.위키;
   document.getElementById('wy_'+k).value=v.까닭||'';
   chg(k)}
  else{const m=document.getElementById('m_'+k);if(m&&v.메모)m.value=v.메모;칠no(k)}});
 count()})
</script>
<textarea id="out" hidden style="width:100%;height:220px;font:12px ui-monospace,monospace"></textarea>
</body></html>`;

function main() {
    const 표칸 = [];
    const 없칸 = [];
    const 마디칸 = [];
    for (const f of fs.readdirSync(WIKI).filter((x) => x.endsWith('.md')).sort()) {
        const txt = fs.readFileSync(path.join(WIKI, f), 'utf8');
        const m = ROW_RE.exec(txt);
        if (!m) continue;
        SRC_RE.lastIndex = 0;
        const src = [...new Set([...txt.matchAll(SRC_RE)].map((x) => x[1]))].filter((p) => p.includes('/별표/'));
        const raw = src.map((p) => {
            try { return fs.readFileSync(path.join(LEGAL, p), 'utf8'); } catch (_) { return '(원문 파일을 못 읽었다: ' + p + ')'; }
        }).join('\n\n');
        // ★기계가 센 줄에 표시를 붙이고, **표시 개수가 운영 함수 값과 맞는지 확인한다.**
        const 표시 = 행표시(raw);
        const 참값 = AT.countBoxRows(raw);
        const 표시맞나 = 표시.센수 === 참값;
        const 표들 = 별표표(txt);
        const 후보 = 표들.reduce((a, x) => a + x.데이터행, 0);
        // ★별표를 `###` 마디로 풀어 놓은 쪽은 **행으로 견줄 수 없다**(표 한 줄 = 한 항목이 아니다).
        //   실측: 수산업법 시행령 별표2 는 원문 154행을 어업 40종 마디로 835줄에 담았다 — 「154 대 18」로
        //   보이지만 빠진 것은 없었다. 그 6쪽은 물음을 바꿔 따로 묶는다(2026-09-27).
        const 마디 = 마디수(txt);
        const 큰마디 = 원문큰마디(raw);
        const 없는큰마디 = 없는큰마디찾기(raw, txt);
        const 한글 = (t) => (String(t).match(/[가-힣]/g) || []).length;
        const it = {
            f, 쪽: f.replace(/\.md$/, ''), src, 원문: Number(m[1]), 적힌: Number(m[2]),
            원문글: 표시맞나 ? 표시.글 : raw, 표시맞나, 참값, 표들, 후보,
            마디, 큰마디, 없는큰마디, 한글원문: 한글(raw), 한글위키: 한글(txt),
        };
        if (마디 >= 3) 마디칸.push(it);
        else if (표들.length) 표칸.push(it);
        else 없칸.push(it);
    }

    const 데이터 = {};
    const 칸글 = (it, id, 차례, 모두) => {
        const 큰차 = it.후보 > 0 && it.후보 * 2 <= it.원문;
        const 위키쪽 = it.표들.map((t, j) =>
            `<div class="tbl"><div class="cap">표 ${j + 1}${it.표들.length > 1 ? ` / ${it.표들.length}` : ''}`
            + ` — 데이터 줄 <b>${t.데이터행}</b>개 (제가 센 수)`
            + (t.머리글 !== '(머리글 없음)' ? ` · 마디 「${esc(t.머리글)}」` : '')
            + `</div><pre>${esc(t.글.slice(0, 7000))}</pre></div>`).join('');
        return `<section class="item" id="${id}" data-it="${id}" data-page="${esc(it.f)}">
 <h3>${차례} / ${모두} · ${esc(it.쪽)}<span class="p">원문: ${esc(it.src.join(' · ')) || '(적힌 원문 경로가 없다)'}</span></h3>
 <div class="sec"><b class="k">①</b> <b>우리가 아는 것</b> — 기계가 원문을 <b>${it.원문}행</b>으로 세었습니다
   ${it.표시맞나 ? '(왼쪽에서 <code>▸</code> 가 붙은 줄이 그 행들입니다)'
                : '(⚠이 자리는 줄마다 표시를 붙이지 못했습니다 — 표시 없이 원문만 보입니다)'}.</div>
 <div class="sec"><b class="k">②</b> <b>무엇이 막혔나</b> — 위키가 몇 행인지는 기계가 못 셉니다.
   위키는 원문 표를 <b>다시 짠</b> 것이라, 줄을 나누거나 합친 자리가 있습니다.
   제가 위키의 별표 표를 세어 본 값은 <b>${it.후보}</b>입니다 — <b>후보일 뿐 판정이 아닙니다.</b>
   ${큰차 ? '<span class="big-gap">⚠원문의 절반도 안 됩니다 — 옮기다 빠진 것일 수 있습니다.</span>' : ''}</div>
 <div class="sec hint"><b class="k">③</b> <b>무엇을 보시면 되나</b> —
   오른쪽 위키 표에서 <b><code>|</code> 로 시작하는 데이터 줄</b>을 세어 주십시오
   (맨 위 이름줄과 <code>|---|</code> 는 빼고). 왼쪽 원문의 <code>▸</code> 개수와 견주시면 됩니다.
   ${it.표들.length > 1 ? `<b>이 자리는 위키 표가 ${it.표들.length}덩이입니다 — 다 합쳐 세어 주십시오.</b>` : ''}</div>
 <div class="two">
  <div class="side"><div class="tag"><b>원문 표</b> (raw · 손대지 않은 글)${it.표시맞나 ? ' · <code>▸</code> = 기계가 센 한 행' : ''}</div>
   <pre>${esc(it.원문글.slice(0, 9000))}</pre></div>
  <div class="side"><div class="tag"><b>위키 별표 표</b> — 이 표(들)가 몇 행인지 세어 주세요</div>${위키쪽}</div>
 </div>
 <div class="ask"><b class="k">④</b>
  <label>원문 <input type="number" id="o_${id}" value="${it.원문}" oninput="chg('${id}')"> 행 <span style="color:var(--mut)">(기계가 셈 · 틀렸으면 고치셔도 됩니다)</span></label>
  <label>위키 <input type="number" id="w_${id}" placeholder="${it.후보}" oninput="chg('${id}')"> 행 <span style="color:var(--mut)">(제가 센 후보 ${it.후보})</span></label>
  <span class="st need" id="s_${id}">— 아직 안 적었습니다</span>
  <div class="why" id="y_${id}"><label style="flex:1;display:flex;gap:8px;align-items:center">까닭
   <input type="text" id="wy_${id}" placeholder="왜 수가 다른가요? (예: 원문의 〃 를 풀어 적었다 / 비고를 아래 목록으로 내렸다 / 빠진 것 같다)" oninput="chg('${id}')"></label></div>
 </div></section>`;
    };

    const 없칸글 = (it, id, 차례, 모두) => `<section class="item" id="${id}" data-it="${id}" data-page="${esc(it.f)}">
 <h3>${차례} / ${모두} · ${esc(it.쪽)}<span class="p">원문: ${esc(it.src.join(' · ')) || '(적힌 원문 경로가 없다)'}</span></h3>
 <div class="sec"><b class="k">①</b> <b>우리가 아는 것</b> — 원문은 표이고, 기계가 <b>${it.원문}행</b>으로 세었습니다.</div>
 <div class="sec"><b class="k">②</b> <b>무엇이 막혔나</b> — <b>위키에 그 표가 없습니다.</b>
   글로 풀어 적었거나, 옮기지 않았거나, 첨부 파일로만 두었습니다.
   그래서 「몇 행이냐」는 물음이 성립하지 않습니다 — 대신 <b>어떻게 할지</b>를 여쭙습니다.</div>
 <div class="sec hint"><b class="k">③</b> <b>무엇을 보시면 되나</b> — 왼쪽 원문을 보시고,
   <b>이 표가 챗봇이 답할 때 필요한 표인지</b>만 판단해 주십시오.
   필요하면 제가 위키에 표로 옮기겠습니다. 필요 없으면 그렇게 적어 두고 게이트에서 뺍니다.</div>
 <div class="two">
  <div class="side"><div class="tag"><b>원문 표</b> (raw)${it.표시맞나 ? ' · <code>▸</code> = 기계가 센 한 행' : ''}</div>
   <pre>${esc(it.원문글.slice(0, 9000))}</pre></div>
  <div class="side"><div class="tag"><b>위키 쪽</b></div><p>(별표 표가 없습니다)</p></div>
 </div>
 <div class="ask"><b class="k">④</b>
  <div class="pick">
   <button data-v="표로 옮겨라" onclick="pickNo('${id}','표로 옮겨라')">표로 옮겨라 — 챗봇에 필요하다</button>
   <button data-v="글로 둬도 된다" onclick="pickNo('${id}','글로 둬도 된다')">글로 둬도 된다</button>
   <button data-v="옮길 필요 없다" onclick="pickNo('${id}','옮길 필요 없다')">옮길 필요 없다 — 게이트에서 빼라</button>
   <button data-v="모르겠다" onclick="pickNo('${id}','모르겠다')">모르겠다 — 넘긴다</button>
  </div>
  <span class="st need" id="s_${id}">— 아직 안 고르셨습니다</span>
  <label style="flex:1;display:flex;gap:8px;align-items:center;width:100%">메모
   <input type="text" id="m_${id}" placeholder="한 줄 적어 두실 것이 있으면" oninput="memoNo('${id}')"></label>
 </div></section>`;

    const 마디칸글 = (it, id, 차례, 모두) => `<section class="item" id="${id}" data-it="${id}" data-page="${esc(it.f)}">
 <h3>${차례} / ${모두} · ${esc(it.쪽)}<span class="p">원문: ${esc(it.src.join(' · ')) || '(적힌 원문 경로가 없다)'}</span></h3>
 <div class="sec"><b class="k">①</b> <b>우리가 아는 것</b> — 원문은 표이고 기계가 <b>${it.원문}행</b>으로 세었습니다.
   그런데 위키는 그 표를 <b>표로 옮기지 않고 「${it.마디}개 마디」로 풀어 적었습니다</b>(문서 전체 기준).</div>
 <div class="sec"><b class="k">②</b> <b>무엇이 막혔나</b> — <b>행으로 견줄 수 없습니다.</b>
   표 한 줄이 한 항목이 아니기 때문입니다. 그래서 「${it.원문}행 대 ${it.후보}행」처럼 보이지만
   그건 <b>구조가 다른 것</b>이고, 빠졌다는 뜻이 아닙니다.</div>
 <div class="sec hint"><b class="k">③</b> <b>그래서 제가 다른 자로 대조했습니다</b>
   <ul style="margin:6px 0 0 20px;padding:0">
   <li>원문의 <b>큰 마디 ${it.큰마디.length}가지</b>(${esc(it.큰마디.slice(0, 5).join(' · '))}${it.큰마디.length > 5 ? ' …' : ''})
       가운데 <b>위키에 이름조차 없는 것 ${it.없는큰마디.length}가지</b>${it.없는큰마디.length ? `: <span class="big-gap">${esc(it.없는큰마디.join(' · '))}</span>` : ''}</li>
   <li>한글 글자 수 — 원문 <b>${it.한글원문}</b> · 위키 <b>${it.한글위키}</b>
       ${it.한글위키 >= it.한글원문 ? '(위키가 더 많습니다 — 위키는 설명·근거표를 덧붙이므로 정상입니다)'
                                  : '<span class="big-gap">(위키가 더 적습니다 — 줄여 적었을 수 있습니다)</span>'}</li>
   </ul>
   ⚠글자 수는 <b>참고일 뿐 판정이 아닙니다</b> — 위키가 덧붙인 글이 섞여 있어 이것만으로는 누락을 가릴 수 없습니다.</div>
 <div class="two">
  <div class="side"><div class="tag"><b>원문 표</b> (raw)${it.표시맞나 ? ' · <code>▸</code> = 기계가 센 한 행' : ''}</div>
   <pre>${esc(it.원문글.slice(0, 9000))}</pre></div>
  <div class="side"><div class="tag"><b>위키 쪽</b> — 마디로 풀어 적은 글${it.표들.length ? ` (표도 ${it.표들.length}덩이 있습니다)` : ''}</div>
   ${it.표들.length ? it.표들.map((t, j) => `<div class="tbl"><div class="cap">표 ${j + 1} — 데이터 줄 <b>${t.데이터행}</b>개`
       + (t.머리글 !== '(머리글 없음)' ? ` · 마디 「${esc(t.머리글)}」` : '') + `</div><pre>${esc(t.글.slice(0, 5000))}</pre></div>`).join('')
     : '<p>(표는 없고 글로만 적혀 있습니다)</p>'}</div>
 </div>
 <div class="ask"><b class="k">④</b>
  <div class="pick">
   <button data-v="행 대조 면제 — 마디로 풀어 적었다고 기록" onclick="pickNo('${id}','행 대조 면제 — 마디로 풀어 적었다고 기록')">행 대조 면제 — 「마디로 풀어 적었다」고 기록</button>
   <button data-v="내가 직접 볼 것이 있다" onclick="pickNo('${id}','내가 직접 볼 것이 있다')">내가 직접 볼 것이 있다</button>
   <button data-v="줄여 적은 것 같다 — 다시 옮겨라" onclick="pickNo('${id}','줄여 적은 것 같다 — 다시 옮겨라')">줄여 적은 것 같다 — 다시 옮겨라</button>
   <button data-v="모르겠다" onclick="pickNo('${id}','모르겠다')">모르겠다 — 넘긴다</button>
  </div>
  <span class="st need" id="s_${id}">— 아직 안 고르셨습니다</span>
  <label style="flex:1;display:flex;gap:8px;align-items:center;width:100%">메모
   <input type="text" id="m_${id}" placeholder="한 줄 적어 두실 것이 있으면" oninput="memoNo('${id}')"></label>
 </div></section>`;

    let 몸 = '';
    if (표칸.length) {
        몸 += `<h2 class="grp">가. 위키에 표가 있는 자리 — ${표칸.length}칸 (위키가 몇 행인지 적어 주세요)</h2>`;
        표칸.forEach((it, k) => {
            const id = 'r' + k;
            데이터[id] = { 종류: '표', 쪽: it.쪽, 원문: it.원문, 후보: it.후보 };
            몸 += 칸글(it, id, k + 1, 표칸.length);
        });
    }
    if (없칸.length) {
        몸 += `<h2 class="grp">나. 위키에 별표 표가 없는 자리 — ${없칸.length}칸 (물음이 다릅니다)</h2>`
            + `<p style="font-size:14px;color:var(--mut);margin:0 0 14px">`
            + `이 ${없칸.length}칸은 「몇 행이냐」를 물을 수 없습니다 — 셀 표가 위키에 없기 때문입니다. `
            + `예전 검토장은 이것까지 함께 물어서 <b>답할 수 없는 칸이 섞여</b> 있었습니다(2026-09-27 고침).</p>`;
        없칸.forEach((it, k) => {
            const id = 'n' + k;
            데이터[id] = { 종류: '표없음', 쪽: it.쪽, 원문: it.원문, 후보: 0 };
            몸 += 없칸글(it, id, k + 1, 없칸.length);
        });
    }

    if (마디칸.length) {
        몸 += `<h2 class="grp">다. 별표를 「마디」로 풀어 적은 자리 — ${마디칸.length}칸 (행으로 견줄 수 없습니다)</h2>`
            + `<p style="font-size:14px;color:var(--mut);margin:0 0 14px">`
            + `이 ${마디칸.length}칸은 위키가 원문 표를 <b>표가 아니라 마디로 풀어</b> 적었습니다. `
            + `행 수를 견주면 큰 누락처럼 보이지만 구조가 다른 것입니다 — 실측으로 확인했습니다`
            + `(수산업법 시행령 별표2: 「154행 대 18행」으로 보이나 원문의 어업 46가지가 위키에 모두 있고 `
            + `문서가 주장한 원문 20,099자도 정확했습니다). <b>제가 다른 자로 대조한 결과를 칸마다 적어 두었습니다.</b></p>`;
        마디칸.forEach((it, k) => {
            const id = 'd' + k;
            데이터[id] = { 종류: '마디', 쪽: it.쪽, 원문: it.원문, 후보: it.후보 };
            몸 += 마디칸글(it, id, k + 1, 마디칸.length);
        });
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, TPL.replace('__BODY__', 몸)
        .replace('__N__', String(표칸.length + 없칸.length + 마디칸.length))
        .replace('__DATA__', JSON.stringify(데이터)), 'utf8');
    const 표시못 = [...표칸, ...없칸].filter((x) => !x.표시맞나);
    const 큰차 = 표칸.filter((x) => x.후보 > 0 && x.후보 * 2 <= x.원문);
    console.log(`▣ 만들었다: ${path.relative(LEGAL, OUT)}`);
    console.log(`   자리 ${표칸.length + 없칸.length + 마디칸.length}개`
        + ` = 표 중심 ${표칸.length} + 마디로 풀어 적은 것 ${마디칸.length} + 위키에 표가 없는 것 ${없칸.length}`);
    for (const x of 마디칸) {
        console.log(`       [마디 ${String(x.마디).padStart(2)}] 원문 ${String(x.원문).padStart(3)}행`
            + ` · 큰마디 ${x.큰마디.length}가지 중 위키에 없는 것 ${x.없는큰마디.length}`
            + ` · 한글 ${x.한글원문}→${x.한글위키}${x.한글위키 < x.한글원문 ? ' ★줄었다' : ''}   ${x.쪽.slice(0, 46)}`);
    }
    console.log(`   · 줄 표시를 못 붙인 자리 ${표시못.length}개 (붙인 수가 countBoxRows 값과 안 맞아 일부러 뗐다)`);
    console.log(`   · 위키가 원문의 절반도 안 되는 자리 ${큰차.length}개 — 빠진 것일 수 있다`);
    for (const x of 큰차) console.log(`       원문 ${String(x.원문).padStart(3)} → 위키 ${String(x.후보).padStart(3)}   ${x.쪽}`);
    console.log(`   · ${Math.round(fs.statSync(OUT).size / 1024)}KB`);
    return 0;
}

if (require.main === module) process.exit(main());
