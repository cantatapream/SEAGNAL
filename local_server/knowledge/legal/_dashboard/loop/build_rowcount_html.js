#!/usr/bin/env node
/**
 * §6-F 항목수 대조의 **사람 몫**을 눌러서 확정하는 쪽을 만든다. (2026-09-24)
 *
 * [왜 사람이 해야 하나 — 기계가 못 하는 것을 분명히 한다]
 *   원문 쪽 수는 기계가 센다(`countBoxRows`). **위키 쪽 수는 못 센다.**
 *   위키는 원문 표를 **다시 짜기** 때문이다 — `〃` 를 풀어 쓰고, 비고를 목록으로 내리고, 칸을 합친다.
 *   실측: 낚시 시행령 별표1 은 **원문 5행 / 위키 표 13줄**. 같은 내용을 다르게 그린 것이다.
 *   3-28 에서도 박스 표 80쪽 중 자동 대조가 맞은 것은 **9쪽뿐**이었다.
 *   ⇒ 기계가 숫자를 채우면 **190쪽에 거짓 「어긋남」** 이 생긴다. 그래서 사람이 센다(G-34).
 *
 * [이 쪽에서 하는 일]
 *   왼쪽 — 원문 표(raw) 그대로 · 오른쪽 — 위키에 옮겨진 표 그대로
 *   가운데 — 「원문 N행」은 기계 값(고칠 수 있다) · 「위키 M행」을 사람이 적는다
 *   수가 다르면 **까닭 칸**이 열린다 — §6-F 가 요구하는 그 까닭이다(비워 두면 게이트가 잡는다)
 *   `내보내기` → JSON. 그 파일을 주시면 위키 38쪽에 반영한다.
 *
 * [연계] ← `wiki/annexes/*.md` 의 `항목수 대조(§6-F): … 위키 미확인(…)` 줄
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

const ROW_RE = /항목수\s*대조\s*\(?§?6-F\)?\s*[::]\s*원문\s*(\d+)\s*행\s*\/\s*위키\s*미확인\s*\(\s*기계\s*셈\s*(\d+)\s*행\s*\)/;
const SRC_RE = /^[ \t]*>?[ \t]*(?:★)?[ \t]*raw[ \t]*원문[ \t]*[::][ \t]*`?(raw\/[^`\s]+\.txt)`?/gm;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 위키 쪽에서 **표만** 오려 낸다 — 표 아닌 글까지 보여 주면 세는 눈이 흐려진다. */
function mdTables(text) {
    const out = [];
    let cur = [];
    for (const l of text.split('\n')) {
        if (l.trim().startsWith('|')) { cur.push(l); continue; }
        if (cur.length) { out.push(cur.join('\n')); cur = []; }
    }
    if (cur.length) out.push(cur.join('\n'));
    return out.filter((t) => t.split('\n').length >= 2);
}

const TPL = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>별표 항목수 대조</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--line:#d8d8d8;--soft:#f6f6f6;--ok:#0a7d32;--warn:#8a6d00;--no:#b3261e}
*{box-sizing:border-box}body{margin:0;font:15px/1.7 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;background:#fff;border-bottom:2px solid var(--fg);padding:12px 16px;z-index:9}
h1{margin:0 0 4px;font-size:18px}.sub{font-size:13px;color:#555}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
button{font:inherit;padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer}
button:hover{background:var(--soft)}button.big{border:2px solid var(--fg);font-weight:700}
main{padding:16px;max-width:1500px;margin:0 auto}
.item{border:1px solid var(--line);border-radius:10px;margin-bottom:22px;overflow:hidden}
.item>h2{margin:0;padding:10px 14px;background:var(--soft);font-size:15px;border-bottom:1px solid var(--line)}
.item>h2 .p{font-weight:400;font-size:12px;color:#666;display:block}
.two{display:grid;grid-template-columns:1fr 1fr}
.side{padding:12px 14px;min-width:0}.side+.side{border-left:1px solid var(--line)}
.tag{font-size:12px;color:#666;margin-bottom:6px}
pre{white-space:pre;overflow:auto;background:var(--soft);border:1px solid var(--line);border-radius:6px;
padding:10px;margin:0 0 8px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:420px}
.ask{padding:12px 14px;border-top:1px solid var(--line);background:#fffdf5;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
label{font-size:13px}input[type=number]{width:90px;font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px}
input[type=text]{flex:1;min-width:280px;font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px}
.why{display:none;width:100%;margin-top:6px}.why.on{display:flex;gap:8px;align-items:center}
.st{font-size:13px;font-weight:700}.st.ok{color:var(--ok)}.st.need{color:var(--no)}
@media(max-width:1000px){.two{grid-template-columns:1fr}.side+.side{border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<header><h1>별표 항목수 대조 — __N__자리</h1>
<div class="sub">왼쪽이 <b>원문 표</b>, 오른쪽이 <b>위키 표</b>입니다. <b>위키가 몇 행인지</b>만 적어 주세요.
 원문 행수는 기계가 세었습니다(틀렸으면 고치셔도 됩니다). <b>두 수가 다르면 까닭 칸이 열립니다</b> —
 일부러 덜 옮겼으면 그 까닭을 적어 주세요(§6-F).</div>
<div class="bar"><span id="cnt"></span>
<button class="big" onclick="save()">내보내기 (JSON)</button>
<button onclick="if(confirm('적은 것을 모두 지웁니다.')){localStorage.removeItem(KEY);location.reload()}">처음부터</button>
</div></header><main>__BODY__</main>
<script>
const KEY='rowcount_review_v1';let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
function chg(id){const o=document.getElementById('o_'+id),w=document.getElementById('w_'+id),
 y=document.getElementById('y_'+id),wy=document.getElementById('wy_'+id),st=document.getElementById('s_'+id);
 const ov=Number(o.value),wv=w.value===''?null:Number(w.value);
 const diff=wv!==null&&ov!==wv;y.className='why'+(diff?' on':'');
 S[id]={원문:ov,위키:wv,까닭:wy.value};localStorage.setItem(KEY,JSON.stringify(S));
 if(wv===null){st.className='st need';st.textContent='— 아직 안 적었습니다'}
 else if(diff&&!wy.value.trim()){st.className='st need';st.textContent='★수가 다릅니다 — 까닭을 적어 주세요'}
 else{st.className='st ok';st.textContent='✓ 적었습니다'}count()}
function count(){const all=document.querySelectorAll('[data-it]').length;
 const d=Object.values(S).filter(x=>x.위키!==null&&x.위키!==undefined&&(x.원문===x.위키||(x.까닭||'').trim())).length;
 document.getElementById('cnt').textContent=\`적은 것 \${d} / 모두 \${all}\`}
function save(){const out={만든날:new Date().toISOString().slice(0,10),무엇:'§6-F 별표 항목수 대조',자리:[]};
 document.querySelectorAll('[data-it]').forEach(el=>{const id=el.dataset.it;
  out.자리.push({쪽:el.dataset.page,원문:Number(document.getElementById('o_'+id).value),
   위키:document.getElementById('w_'+id).value===''?null:Number(document.getElementById('w_'+id).value),
   까닭:document.getElementById('wy_'+id).value})});
 const b=new Blob([JSON.stringify(out,null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='별표_항목수_확정.json';a.click()}
window.addEventListener('DOMContentLoaded',()=>{for(const [id,v] of Object.entries(S)){
 const o=document.getElementById('o_'+id);if(!o)continue;
 if(v.원문!=null)o.value=v.원문;if(v.위키!=null)document.getElementById('w_'+id).value=v.위키;
 document.getElementById('wy_'+id).value=v.까닭||'';chg(id)}count()})
</script></body></html>`;

function main() {
    const items = [];
    for (const f of fs.readdirSync(WIKI).filter((x) => x.endsWith('.md')).sort()) {
        const txt = fs.readFileSync(path.join(WIKI, f), 'utf8');
        const m = ROW_RE.exec(txt);
        if (!m) continue;
        SRC_RE.lastIndex = 0;
        const src = [...new Set([...txt.matchAll(SRC_RE)].map((x) => x[1]))].filter((p) => p.includes('/별표/'));
        const raw = src.map((p) => {
            try { return fs.readFileSync(path.join(LEGAL, p), 'utf8'); } catch (_) { return '(못 읽었다)'; }
        }).join('\n\n');
        items.push({ f, 원문: m[1], 기계: m[2], src, raw, tbl: mdTables(txt).join('\n\n') });
    }
    const body = items.map((it, k) => {
        const id = 'i' + k;
        return `<section class="item" data-it="${id}" data-page="${esc(it.f)}">
 <h2>${esc(it.f.replace(/\.md$/, ''))}<span class="p">원문: ${esc(it.src.join(' · '))}</span></h2>
 <div class="two">
  <div class="side"><div class="tag"><b>원문 표</b> (raw)</div><pre>${esc(it.raw.slice(0, 9000))}</pre></div>
  <div class="side"><div class="tag"><b>위키 표</b> — 이 표가 몇 행인지 세어 주세요</div><pre>${esc(it.tbl.slice(0, 9000)) || '(표가 없습니다)'}</pre></div>
 </div>
 <div class="ask">
  <label>원문 <input type="number" id="o_${id}" value="${it.원문}" oninput="chg('${id}')"> 행 <span style="color:#666">(기계가 셈)</span></label>
  <label>위키 <input type="number" id="w_${id}" placeholder="?" oninput="chg('${id}')"> 행 <span style="color:#666">(기계 셈 후보 ${it.기계})</span></label>
  <span class="st need" id="s_${id}">— 아직 안 적었습니다</span>
  <div class="why" id="y_${id}"><label style="flex:1;display:flex;gap:8px;align-items:center">까닭
   <input type="text" id="wy_${id}" placeholder="왜 수가 다른가요? (예: 원문의 〃 를 풀어 적었다 / 비고를 아래 목록으로 내렸다)" oninput="chg('${id}')"></label></div>
 </div></section>`;
    }).join('');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, TPL.replace('__BODY__', body).replace('__N__', String(items.length)), 'utf8');
    console.log(`▣ 만들었다: ${path.relative(LEGAL, OUT)}`);
    console.log(`   자리 ${items.length}개 · ${Math.round(fs.statSync(OUT).size / 1024)}KB`);
    return 0;
}

if (require.main === module) process.exit(main());
