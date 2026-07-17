#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""어선안전조업법 감사 160문항 Q&A → HTML 아티팩트 생성."""
import re, json, html, os

SRC="/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/audit/어선안전조업및어선원의안전ㆍ보건증진등에관한법률.md"
OUT="/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/qa_어선안전조업법.html"

txt=open(SRC,encoding="utf-8").read()
lines=txt.split("\n")

sections=[]  # {code,title,rows}
cur=None
header=None
def verd(s):
    s=s or ""
    if "full" in s: return "full"
    if "thin" in s: return "thin"
    if "missing" in s: return "missing"
    if "📛" in s or "hole" in s: return "hole"
    if "〰" in s or "awkward" in s: return "awkward"
    return ""
for ln in lines:
    m=re.match(r"^### ([A-D])\.\s*(.+)", ln)
    if m:
        cur={"code":m.group(1),"title":m.group(2).strip(),"rows":[]}
        sections.append(cur); header=None; continue
    if cur is None: continue
    if ln.strip().startswith("|"):
        cells=[c.strip() for c in ln.strip().strip("|").split("|")]
        # 헤더/구분선 스킵
        if re.match(r"^\|?\s*#\s*\|", ln) or set("".join(cells))<=set("-: "):
            if cells and cells[0] in ("#",""): header=cells
            continue
        if not re.match(r"^\d+$", cells[0] or ""): continue
        # 컬럼 매핑: 보통 [#,유형,질문,1R,2R,근거] 또는 [#,유형,질문,2R,근거]
        row={"n":cells[0]}
        if header and "1R 판정" in "|".join(header):
            row["type"]=cells[1] if len(cells)>1 else ""
            row["q"]=cells[2] if len(cells)>2 else ""
            row["r1"]=verd(cells[3] if len(cells)>3 else "")
            row["r2"]=verd(cells[4] if len(cells)>4 else "")
            row["basis"]=cells[5] if len(cells)>5 else ""
        else:
            row["type"]=cells[1] if len(cells)>1 else ""
            row["q"]=cells[2] if len(cells)>2 else ""
            row["r1"]=""
            row["r2"]=verd(cells[3] if len(cells)>3 else "")
            row["basis"]=cells[4] if len(cells)>4 else ""
        cur["rows"].append(row)

allrows=[r for s in sections for r in s["rows"]]
# 통계
from collections import Counter
vc=Counter(r["r2"] for r in allrows)
tc=Counter(r["type"] for r in allrows)
total=len(allrows)
fullpct=round(100*vc.get("full",0)/total) if total else 0

data={"sections":[{"code":s["code"],"title":s["title"],"n":len(s["rows"])} for s in sections],
      "rows":allrows,"stats":{"total":total,"verd":dict(vc),"type":dict(tc),"fullpct":fullpct}}

VLAB={"full":"완전답변","thin":"부실","missing":"페이지없음","hole":"원문미수집","awkward":"어색"}
SECLAB={"A":"회귀확인","B":"신규 심층","C":"전문가","D":"일반인·구어"}
TYPELAB={"T1":"단순의무","T2":"벌칙·과태료","T3":"별표필요","T4":"적용/정의","T5":"예외/조건","T6":"타법연결","T7":"구어/애매"}

payload=json.dumps(data,ensure_ascii=False)

htmlout='''<title>어선안전조업법 위키 감사 · 160문답</title>
<style>
:root{
  --paper:#f5f3ec; --panel:#fffdf7; --ink:#182430; --muted:#5c6b77; --faint:#8494a0;
  --line:#e2dccf; --accent:#0d6e78; --accent-soft:#0d6e7818;
  --full:#1f7a4d; --thin:#b0710b; --missing:#b23b30; --hole:#5a4b93; --awkward:#6b7683;
  --full-bg:#1f7a4d16; --thin-bg:#b0710b16; --missing-bg:#b23b3016; --hole-bg:#5a4b9316; --awkward-bg:#6b768316;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0e1621; --panel:#15202b; --ink:#dde7ef; --muted:#93a3b1; --faint:#63727f;
  --line:#233039; --accent:#3bb2be; --accent-soft:#3bb2be1f;
  --full:#4cc47e; --thin:#e0a53a; --missing:#e46a5e; --hole:#a99ce0; --awkward:#93a3b1;
  --full-bg:#4cc47e1c; --thin-bg:#e0a53a1c; --missing-bg:#e46a5e1c; --hole-bg:#a99ce01c; --awkward-bg:#93a3b118;
}}
:root[data-theme="light"]{--paper:#f5f3ec;--panel:#fffdf7;--ink:#182430;--muted:#5c6b77;--faint:#8494a0;--line:#e2dccf;--accent:#0d6e78;--accent-soft:#0d6e7818;--full:#1f7a4d;--thin:#b0710b;--missing:#b23b30;--hole:#5a4b93;--awkward:#6b7683;--full-bg:#1f7a4d16;--thin-bg:#b0710b16;--missing-bg:#b23b3016;--hole-bg:#5a4b9316;--awkward-bg:#6b768316;}
:root[data-theme="dark"]{--paper:#0e1621;--panel:#15202b;--ink:#dde7ef;--muted:#93a3b1;--faint:#63727f;--line:#233039;--accent:#3bb2be;--accent-soft:#3bb2be1f;--full:#4cc47e;--thin:#e0a53a;--missing:#e46a5e;--hole:#a99ce0;--awkward:#93a3b1;--full-bg:#4cc47e1c;--thin-bg:#e0a53a1c;--missing-bg:#e46a5e1c;--hole-bg:#a99ce01c;--awkward-bg:#93a3b118;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,-apple-system,sans-serif;
  line-height:1.6;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 80px}
header.top{padding:44px 0 24px;border-bottom:1px solid var(--line)}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 10px}
h1{font-size:clamp(24px,4vw,34px);line-height:1.2;margin:0 0 6px;font-weight:800;text-wrap:balance;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:14px;margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:26px 0 4px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tile .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:0 0 6px;font-weight:600}
.tile .v{font-size:26px;font-weight:800;line-height:1}
.tile .v small{font-size:13px;font-weight:600;color:var(--muted)}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;margin:18px 0 2px;border:1px solid var(--line)}
.bar span{display:block}
.barlegend{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.barlegend b{color:var(--ink);font-weight:700}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.controls{position:sticky;top:0;z-index:5;background:var(--paper);padding:16px 0 12px;margin-top:8px;border-bottom:1px solid var(--line)}
.search{width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font-size:14px;font-family:inherit}
.search:focus{outline:2px solid var(--accent);outline-offset:1px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;font-weight:600;transition:.12s}
.chip:hover{border-color:var(--accent)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
:root[data-theme="dark"] .chip[aria-pressed="true"],@media(prefers-color-scheme:dark){.chip[aria-pressed="true"]{color:#0e1621}}
.count{font-size:13px;color:var(--muted);margin:14px 2px 8px}
.qa{display:flex;flex-direction:column;gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 17px;display:grid;grid-template-columns:auto 1fr auto;gap:6px 14px;align-items:start}
.n{font-size:12px;color:var(--faint);font-weight:700;padding-top:3px;min-width:30px}
.q{font-size:15.5px;font-weight:600;color:var(--ink);margin:0;grid-column:2}
.meta{grid-column:2;display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:3px}
.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid var(--line);color:var(--muted);letter-spacing:.02em}
.basis{grid-column:2;color:var(--muted);font-size:13px;margin-top:7px;padding-top:9px;border-top:1px dashed var(--line);line-height:1.55}
.verd{grid-column:3;grid-row:1/3;display:flex;flex-direction:column;align-items:flex-end;gap:5px;white-space:nowrap}
.pill{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;display:inline-flex;align-items:center;gap:4px}
.pill.full{color:var(--full);background:var(--full-bg)} .pill.thin{color:var(--thin);background:var(--thin-bg)}
.pill.missing{color:var(--missing);background:var(--missing-bg)} .pill.hole{color:var(--hole);background:var(--hole-bg)}
.pill.awkward{color:var(--awkward);background:var(--awkward-bg)}
.trans{font-size:11px;color:var(--faint);font-weight:600}
.trans .arrow{opacity:.6;margin:0 3px}
footer{margin-top:40px;color:var(--faint);font-size:12px;text-align:center;line-height:1.7}
@media(max-width:640px){.card{grid-template-columns:auto 1fr;gap:5px 10px}.verd{grid-column:2;grid-row:auto;flex-direction:row;align-items:center;margin-top:4px}.q,.meta,.basis{grid-column:2}}
</style>

<div class="wrap">
<header class="top">
  <p class="eyebrow">SEAGNAL · 나리야 법률 위키 품질감사 (2라운드)</p>
  <h1>어선안전조업 및 어선원의 안전·보건 증진 등에 관한 법률</h1>
  <p class="sub">실제 사용자(어민·낚시인·전문가)가 물을 법한 <b>160개 질문</b>을 던지고, <b>위키만으로</b> 답할 수 있는지 판정했습니다. 감사일 2026-07-16.</p>
  <div class="tiles" id="tiles"></div>
  <div class="bar" id="bar"></div>
  <div class="barlegend" id="legend"></div>
</header>

<div class="controls">
  <input class="search" id="search" placeholder="질문·근거 검색…" autocomplete="off">
  <div class="chips" id="verdchips"></div>
  <div class="chips" id="typechips"></div>
</div>
<p class="count" id="count"></p>
<div class="qa" id="qa"></div>

<footer>
  판정: <span class="dot" style="background:var(--full)"></span>완전답변 = 위키 원문만으로 정확·완전히 답됨 ·
  <span class="dot" style="background:var(--thin)"></span>부실 = 답은 되나 얕음 ·
  <span class="dot" style="background:var(--missing)"></span>페이지없음 ·
  <span class="dot" style="background:var(--hole)"></span>원문미수집 ·
  <span class="dot" style="background:var(--awkward)"></span>어색<br>
  근거 열 = 답의 출처(위키 개념페이지 · 원문 조문). 1R→2R = 1라운드 대비 개선 추이.
</footer>
</div>

<script>
const DATA=__PAYLOAD__;
const VLAB=__VLAB__, SECLAB=__SECLAB__, TYPELAB=__TYPELAB__;
const VORD=["full","thin","missing","hole","awkward"];
const cvar={full:"--full",thin:"--thin",missing:"--missing",hole:"--hole",awkward:"--awkward"};
let fType=new Set(), fVerd=new Set(), q="";

// tiles
const st=DATA.stats;
document.getElementById("tiles").innerHTML=[
  ["질문 수",st.total,""],
  ["완전답변",st.verd.full||0,st.fullpct+"%"],
  ["보완 필요",(st.verd.thin||0)+(st.verd.missing||0)+(st.verd.hole||0),"thin+missing+hole"],
  ["질문 유형",Object.keys(st.type).length,"T1–T7"],
].map(([k,v,s])=>`<div class="tile"><p class="k">${k}</p><div class="v">${v} ${s?`<small>${s}</small>`:""}</div></div>`).join("");

// bar
const bar=document.getElementById("bar"),leg=document.getElementById("legend");
bar.innerHTML=VORD.filter(v=>st.verd[v]).map(v=>`<span style="width:${100*st.verd[v]/st.total}%;background:var(${cvar[v]})"></span>`).join("");
leg.innerHTML=VORD.filter(v=>st.verd[v]).map(v=>`<span><span class="dot" style="background:var(${cvar[v]})"></span>${VLAB[v]} <b>${st.verd[v]}</b></span>`).join("");

// chips
function chip(box,label,active,on){const b=document.createElement("button");b.className="chip";b.textContent=label;b.setAttribute("aria-pressed",active);b.onclick=()=>{on(b);render();};box.appendChild(b);}
const vbox=document.getElementById("verdchips");
VORD.filter(v=>st.verd[v]).forEach(v=>chip(vbox,`${VLAB[v]} ${st.verd[v]}`,false,b=>{const p=b.getAttribute("aria-pressed")==="true";b.setAttribute("aria-pressed",!p);p?fVerd.delete(v):fVerd.add(v);}));
const tbox=document.getElementById("typechips");
Object.keys(TYPELAB).filter(t=>st.type[t]).forEach(t=>chip(tbox,`${t} ${TYPELAB[t]}`,false,b=>{const p=b.getAttribute("aria-pressed")==="true";b.setAttribute("aria-pressed",!p);p?fType.delete(t):fType.add(t);}));
document.getElementById("search").addEventListener("input",e=>{q=e.target.value.trim();render();});

function render(){
  const rows=DATA.rows.filter(r=>
    (!fVerd.size||fVerd.has(r.r2))&&
    (!fType.size||fType.has(r.type))&&
    (!q||(r.q+" "+r.basis).toLowerCase().includes(q.toLowerCase())));
  document.getElementById("count").textContent=`${rows.length}개 표시 / 전체 ${DATA.rows.length}개`;
  document.getElementById("qa").innerHTML=rows.map(r=>{
    const v=r.r2||"";
    const trans=(r.r1&&r.r1!==r.r2)?`<span class="trans">${VLAB[r.r1]||r.r1}<span class="arrow">→</span></span>`:"";
    return `<div class="card">
      <div class="n">${r.n}</div>
      <p class="q">${esc(r.q)}</p>
      <div class="meta"><span class="tag">${r.type} ${TYPELAB[r.type]||""}</span></div>
      ${r.basis?`<div class="basis">${esc(r.basis)}</div>`:""}
      <div class="verd">${trans}<span class="pill ${v}">${VLAB[v]||"—"}</span></div>
    </div>`;}).join("");
}
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
render();
</script>
'''
htmlout=(htmlout.replace("__PAYLOAD__",payload)
    .replace("__VLAB__",json.dumps(VLAB,ensure_ascii=False))
    .replace("__SECLAB__",json.dumps(SECLAB,ensure_ascii=False))
    .replace("__TYPELAB__",json.dumps(TYPELAB,ensure_ascii=False)))
os.makedirs(os.path.dirname(OUT),exist_ok=True)
open(OUT,"w",encoding="utf-8").write(htmlout)
print("생성:",OUT)
print(f"문항 {total}개 · full {vc.get('full',0)}({fullpct}%) thin {vc.get('thin',0)} missing {vc.get('missing',0)} hole {vc.get('hole',0)}")
print("섹션:",[(s['code'],len(s['rows'])) for s in sections])
