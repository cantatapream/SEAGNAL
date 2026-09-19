#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사람이 눈으로 봐 줘야 하는 "그림으로만 있는 표" 작업지를 HTML 한 장으로 만든다.

왜 있나 (2026-09-19, 사용자 지시):
  법령·고시 원문에 표·도해가 **그림으로만** 들어 있는 곳이 있다. 우리 수집기는 그 자리에
  `<img id="…">` 만 남기고 글자는 못 가져온다. 그래서 챗봇이 그 표의 값을 읽지 못한다.
  사용자가 직접 원문을 보고 옮겨 적어 주기로 해서, **보고 → 적고 → 내보내는** 한 화면을 만든다.
  (첫 판은 목록만 있어 "뭘 확인해서 어디에 적으라는 것이냐"는 지적을 받았다. 이 판이 그 보완이다.)

무엇을 담나:
  기준법(15_관련타부처 제외) raw 에서 `<img id>` 를 가리키는데 대응하는 판독문(_이미지/<id>.txt)이
  없는 자리 전부. 각 항목마다
    ①무엇이 문제인지 ②어디를 열어 봐야 하는지(원문·그림 링크) ③무엇을 적어 주면 되는지
    ④적는 칸(판정 + 옮겨적기 + 메모) ⑤진행 저장(브라우저) ⑥내보내기(JSON 파일·클립보드)
  를 둔다. 내보낸 JSON 을 그대로 주면 `_이미지/<번호>.txt` 로 옮겨 실을 수 있다.

사용법: python3 local_server/knowledge/legal/_dashboard/loop/img_worksheet.py
        (인자 없음 — raw 를 다시 훑어 작업지를 새로 쓴다. 판독문을 채워 넣을수록 항목이 줄어든다.)

[연계] 입력 raw/**/*.txt · _이미지/ · 출력 _dashboard/사람확인_그림표.html
       되받는 형식 {"판정","옮겨적음","메모"} × 이미지번호 — 판독문 적재 시 사용
"""
import html, json, os, re, urllib.parse

ROMAN = r'[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]'


def scan():
    """raw 를 훑어 "그림을 가리키는데 판독문이 없는 자리"를 전부 모은다.

    기준법만 본다 — `15_관련타부처` 는 우리 법이 아니라 인용 대상이라 뺀다(그쪽까지 넣으면 618곳).
    """
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'raw')
    root = os.path.abspath(root)
    out = []
    for dirpath, _dirs, files in os.walk(root):
        if any(x in dirpath for x in ('_이미지', '_구판', '_대기')):
            continue
        for fn in sorted(files):
            if not fn.endswith('.txt'):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root)
            if rel.startswith('15_'):
                continue
            try:
                txt = open(p, encoding='utf-8').read()
            except Exception:
                continue
            if '<img id=' not in txt:
                continue
            head = '\n'.join(txt.split('\n')[:10])
            m = re.search(r'^ID:(\d+)', head, re.M)
            aid = m.group(1) if m else ''
            parts = rel.split(os.sep)
            domain, law = parts[0], parts[1]
            cands = [os.path.join(dirpath, '_이미지'),
                     os.path.join(os.path.dirname(dirpath), '_이미지')]
            cur, inbuchik, seq = '', ('부칙_' in fn), 0
            for line in txt.split('\n'):
                if re.match(r'^\s*부\s*칙', line):
                    inbuchik = True
                h = (re.match(r'^(제[0-9]+조(?:의[0-9]+)?\([^)]{0,40}\))', line)
                     or re.match(r'^\[(제[0-9]+조(?:의[0-9]+)?)\]\s*([^(\n]{0,40})', line)
                     or re.match(r'^\s*(%s+\s*\.?\s*[^\n]{0,30}?)(?=\s|$)' % ROMAN, line)
                     or re.match(r'^\s*(<별표[^>]{0,20}>)', line)
                     or re.match(r'^\s*(별표\s*제?\s*\d+\s*호?)', line))
                if h:
                    cur = (h.group(1).strip() if h.lastindex == 1
                           else '%s(%s)' % (h.group(1), h.group(2).strip()))[:48]
                for i in re.findall(r'<img id="(\d+)"', line):
                    seq += 1
                    if any(os.path.exists(os.path.join(c, i + '.txt')) for c in cands):
                        continue
                    png = any(os.path.exists(os.path.join(c, i + '.png')) for c in cands)
                    ctx = re.sub(r'<img id="\d+"></img>', '▣표ㆍ그림▣', line).strip()
                    out.append({'domain': domain, 'law': law, 'file': fn[:-4], 'path': rel,
                                'id': aid, 'img': i, 'art': cur, 'seq': seq, 'png': png,
                                'buchik': inbuchik, 'ctx': ctx[:280]})
    return out

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(LEGAL, '_dashboard', '사람확인_그림표.html')
items = scan()

IMG = 'https://www.law.go.kr/LSW/flDownload.do?flSeq=%s'


def src_link(r):
    """그 원문을 국가법령정보센터에서 여는 주소."""
    f, law = r['file'], r['law']
    if r['id']:
        return 'https://www.law.go.kr/admRulInfoP.do?admRulSeq=' + r['id']
    base = f.replace('부칙_', '')
    if base in ('법률', '법'):
        name = law
    elif base in ('시행령', '시행규칙'):
        name = law + base
    else:
        return 'https://www.law.go.kr/행정규칙/' + urllib.parse.quote(f)
    return 'https://www.law.go.kr/법령/' + urllib.parse.quote(name)


def kind(r):
    f = r['file'].replace('부칙_', '')
    return {'법률': '법률', '법': '법률', '시행령': '시행령', '시행규칙': '시행규칙'}.get(f, '고시ㆍ행정규칙')


rows = []
for r in items:
    rows.append({
        'dom': r['domain'], 'law': r['law'], 'file': r['file'],
        'art': r['art'] or ('이 원문의 %d번째 그림' % r.get('seq', 0)),
        'hasart': bool(r['art']),
        'ctx': r['ctx'], 'img': r['img'], 'png': r['png'], 'buchik': r['buchik'],
        'kind': kind(r), 'src': src_link(r), 'imgurl': IMG % r['img'],
    })
# 조문이 특정되는 본칙 항목을 앞에 둔다 — 사람이 확인하기 쉬운 순서.
rows.sort(key=lambda x: (x['buchik'], not x['hasart'], x['dom'], x['law'], x['file'], int(x['img'])))

n = len(rows)
n_png = sum(1 for r in rows if r['png'])
n_bu = sum(1 for r in rows if r['buchik'])
n_file = len({(r['law'], r['file']) for r in rows})
doms = sorted({r['dom'] for r in rows})

CSS = """
:root{--paper:#f5f3ec;--panel:#fffdf7;--ink:#182430;--muted:#5c6b77;--faint:#8494a0;
 --line:#e2dccf;--accent:#0d6e78;--warn:#b0710b;--warn-bg:#b0710b14;--ok:#1f7a4d;--ok-bg:#1f7a4d14;
 --done:#0d6e78;--done-bg:#0d6e7812;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0e1621;--panel:#15202b;--ink:#dde7ef;
 --muted:#93a3b1;--faint:#63727f;--line:#233039;--accent:#3bb2be;--warn:#e0a53a;--warn-bg:#e0a53a1c;
 --ok:#4cc47e;--ok-bg:#4cc47e1c;--done:#3bb2be;--done-bg:#3bb2be18;}}
:root[data-theme="dark"]{--paper:#0e1621;--panel:#15202b;--ink:#dde7ef;--muted:#93a3b1;--faint:#63727f;
 --line:#233039;--accent:#3bb2be;--warn:#e0a53a;--warn-bg:#e0a53a1c;--ok:#4cc47e;--ok-bg:#4cc47e1c;
 --done:#3bb2be;--done-bg:#3bb2be18;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
 font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,-apple-system,sans-serif;
 line-height:1.65;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;}
.wrap{max-width:1000px;margin:0 auto;padding:0 16px 90px}
header.top{padding:38px 0 20px;border-bottom:1px solid var(--line)}
.eyebrow{font-size:12px;letter-spacing:.14em;color:var(--accent);font-weight:700;margin:0 0 10px}
h1{font-size:clamp(23px,4vw,31px);line-height:1.22;margin:0 0 10px;font-weight:800;text-wrap:balance}
h2{font-size:16px;margin:26px 0 10px;font-weight:800}
.sub{color:var(--muted);font-size:14.5px;margin:0;max-width:66ch}
.how{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:22px 0 0}
.how ol{margin:8px 0 0;padding-left:20px}
.how li{margin:7px 0;font-size:14px}
.how li b{color:var(--accent)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:11px;margin:20px 0 0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.tile .k{font-size:11px;letter-spacing:.05em;color:var(--faint);margin:0 0 5px;font-weight:600}
.tile .v{font-size:24px;font-weight:800;line-height:1}
.tile .v small{font-size:12.5px;font-weight:600;color:var(--muted)}
.bar{margin-top:14px;height:9px;border-radius:6px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);width:0%}
.controls{position:sticky;top:0;z-index:5;background:var(--paper);padding:13px 0 11px;border-bottom:1px solid var(--line)}
.search{width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:10px;
 background:var(--panel);color:var(--ink);font-size:14px;font-family:inherit}
.search:focus{outline:2px solid var(--accent);outline-offset:1px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.chip,.act{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;
 padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;font-weight:600}
.chip:hover,.act:hover{border-color:var(--accent)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--paper)}
.act{border-radius:9px;color:var(--accent)}
.act.solid{background:var(--accent);color:var(--paper);border-color:var(--accent)}
.count{font-size:13px;color:var(--muted);margin:14px 2px 10px}
.list{display:flex;flex-direction:column;gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 17px}
.card.done{border-color:var(--done);box-shadow:inset 3px 0 0 var(--done)}
.hd{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.no{color:var(--faint);font-weight:700;font-size:12px}
.law{font-weight:700;font-size:15px}
.art{color:var(--accent);font-weight:700;font-size:13.5px}
.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}
.tag.ok{color:var(--ok);background:var(--ok-bg);border-color:transparent}
.tag.no{color:var(--warn);background:var(--warn-bg);border-color:transparent}
.tag.done{color:var(--done);background:var(--done-bg);border-color:transparent}
.block{margin-top:12px;padding-top:11px;border-top:1px dashed var(--line)}
.lbl{font-size:11.5px;font-weight:800;letter-spacing:.04em;color:var(--faint);margin:0 0 5px}
.ctx{color:var(--muted);font-size:13px;margin:0;word-break:break-all}
.ctx mark{background:var(--warn-bg);color:var(--warn);font-weight:700;padding:0 5px;border-radius:4px}
.ask{font-size:13.5px;margin:0;color:var(--ink)}
.ask b{color:var(--accent)}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.btn{font-size:12.5px;font-weight:700;text-decoration:none;padding:6px 12px;border-radius:8px;
 border:1px solid var(--line);color:var(--accent);background:transparent;cursor:pointer;font-family:inherit}
.btn:hover{border-color:var(--accent)}
.btn.solid{background:var(--accent);color:var(--paper);border-color:var(--accent)}
.shot{margin-top:10px;border:1px solid var(--line);border-radius:10px;overflow:auto;background:#fff}
.shot img{display:block;max-width:100%}
.opts{display:flex;flex-wrap:wrap;gap:7px}
.opt{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:9px;
 padding:6px 11px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;background:transparent}
.opt input{accent-color:var(--accent);margin:0}
.opt:has(input:checked){border-color:var(--accent);color:var(--accent);background:var(--done-bg)}
textarea,input.memo{width:100%;margin-top:7px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;
 background:var(--paper);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.6}
input.memo{font-family:inherit}
textarea:focus,input.memo:focus{outline:2px solid var(--accent);outline-offset:1px}
textarea{min-height:92px;resize:vertical}
.hint{font-size:12px;color:var(--faint);margin:6px 0 0}
footer{margin-top:44px;color:var(--faint);font-size:12.5px;line-height:1.8;border-top:1px solid var(--line);padding-top:18px}
.dock{position:fixed;left:0;right:0;bottom:0;z-index:9;background:var(--panel);border-top:1px solid var(--line);
 padding:10px 16px;display:flex;flex-wrap:wrap;gap:9px;align-items:center;justify-content:center}
.dock .st{font-size:13px;font-weight:700;color:var(--muted);margin-right:6px}
@media(max-width:640px){.wrap{padding:0 16px 120px}}
"""

JS = r"""
const KEY='seagnal_img_worksheet_v1';
let store={};
try{ store=JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ store={}; }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(store)); }catch(e){} }

const cards=[...document.querySelectorAll('.card')];
const q=document.getElementById('q'), cnt=document.getElementById('cnt');
const bar=document.getElementById('bar'), doneN=document.getElementById('doneN');
let dom='전체', only='전체';

function rec(id){ return store[id] || (store[id]={}); }
function filled(id){ const r=store[id]; return !!(r && (r['판정'] || (r['옮겨적음']||'').trim() || (r['메모']||'').trim())); }

function paint(c){
  const id=c.dataset.img, on=filled(id);
  c.classList.toggle('done',on);
  c.querySelector('.tag.done').style.display = on?'':'none';
}
function progress(){
  const n=cards.filter(c=>filled(c.dataset.img)).length;
  doneN.textContent=n; bar.style.width=(n/cards.length*100).toFixed(1)+'%';
}
function apply(){
  const t=q.value.trim().toLowerCase(); let n=0;
  for(const c of cards){
    const okDom = dom==='전체' || c.dataset.dom===dom;
    const f=filled(c.dataset.img);
    const okOnly = only==='전체'
      || (only==='본칙만' && c.dataset.buchik==='0')
      || (only==='아직 안 적음' && !f)
      || (only==='적은 것만' && f);
    const okQ = !t || c.dataset.find.includes(t);
    const show = okDom && okOnly && okQ;
    c.style.display = show?'':'none'; if(show) n++;
  }
  cnt.textContent = n+'건 보이는 중 (전체 '+cards.length+'건)';
}

// 입력 복원 + 연결
for(const c of cards){
  const id=c.dataset.img, r=store[id]||{};
  const ta=c.querySelector('textarea'), memo=c.querySelector('.memo');
  if(r['옮겨적음']) ta.value=r['옮겨적음'];
  if(r['메모']) memo.value=r['메모'];
  if(r['판정']){ const el=c.querySelector('input[type=radio][value="'+CSS.escape(r['판정'])+'"]'); if(el) el.checked=true; }
  c.querySelectorAll('input[type=radio]').forEach(el=>el.addEventListener('change',()=>{
    rec(id)['판정']=el.value; save(); paint(c); progress(); if(only!=='전체') apply();
  }));
  ta.addEventListener('input',()=>{ rec(id)['옮겨적음']=ta.value; save(); paint(c); progress(); });
  memo.addEventListener('input',()=>{ rec(id)['메모']=memo.value; save(); paint(c); progress(); });
  paint(c);
}
progress(); 

q.addEventListener('input',apply);
for(const g of ['dom','only']){
  document.querySelectorAll('.chip[data-g="'+g+'"]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.chip[data-g="'+g+'"]').forEach(x=>x.setAttribute('aria-pressed','false'));
    b.setAttribute('aria-pressed','true');
    if(g==='dom') dom=b.dataset.v; else only=b.dataset.v;
    apply();
  }));
}
document.querySelectorAll('.peek').forEach(b=>b.addEventListener('click',e=>{
  e.preventDefault();
  const box=b.closest('.card').querySelector('.shot');
  if(box.dataset.on==='1'){ box.innerHTML=''; box.dataset.on='0'; b.textContent='그림 여기서 보기'; return; }
  box.innerHTML='<img alt="원문 표 그림" src="'+b.dataset.img+'">'; box.dataset.on='1';
  b.textContent='그림 접기';
}));

// ── 내보내기 ─────────────────────────────────────────────
function payload(){
  const out={형식:'seagnal-img-worksheet', 만든날:'2026-09-19', 항목:[]};
  for(const c of cards){
    const id=c.dataset.img; if(!filled(id)) continue;
    const r=store[id];
    out.항목.push({이미지번호:id, 법:c.dataset.law, 원문:c.dataset.file, 조문:c.dataset.art,
      판정:r['판정']||'', 옮겨적음:r['옮겨적음']||'', 메모:r['메모']||''});
  }
  return out;
}
function dl(){
  const p=payload();
  if(!p.항목.length){ alert('아직 적으신 것이 없습니다. 한 건이라도 적으신 뒤에 내보내 주세요.'); return; }
  const blob=new Blob([JSON.stringify(p,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='그림표_확인결과_'+p.항목.length+'건.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
async function copy(){
  const p=payload();
  if(!p.항목.length){ alert('아직 적으신 것이 없습니다.'); return; }
  const s=JSON.stringify(p,null,1);
  try{ await navigator.clipboard.writeText(s); alert(p.항목.length+'건을 복사했습니다. 대화창에 붙여 넣어 주세요.'); }
  catch(e){ const t=document.createElement('textarea'); t.value=s; document.body.appendChild(t);
    t.select(); document.execCommand('copy'); t.remove(); alert(p.항목.length+'건을 복사했습니다.'); }
}
function load(ev){
  const f=ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{
    const p=JSON.parse(rd.result);
    for(const it of (p.항목||[])) store[it.이미지번호]={판정:it.판정,옮겨적음:it.옮겨적음,메모:it.메모};
    save(); location.reload();
  }catch(e){ alert('읽지 못했습니다: '+e.message); } };
  rd.readAsText(f);
}
function wipe(){
  if(!confirm('적으신 내용을 전부 지웁니다. 계속할까요? (되돌릴 수 없습니다)')) return;
  store={}; save(); location.reload();
}
document.getElementById('dl').addEventListener('click',dl);
document.getElementById('cp').addEventListener('click',copy);
document.getElementById('ld').addEventListener('change',load);
document.getElementById('wipe').addEventListener('click',wipe);
apply();
"""


def esc(s):
    return html.escape(str(s), quote=True)


OPTS = [
    ('옮겨 적었음', '표 내용을 아래 칸에 옮겨 적었습니다'),
    ('표가 아님', '표·수치가 아니라 도장ㆍ서명ㆍ도해 그림입니다'),
    ('안 열림', '링크가 안 열리거나 그림이 안 보입니다'),
    ('나중에', '판단이 어려워 넘깁니다'),
]

cards = []
for i, r in enumerate(rows, 1):
    find = ' '.join([r['law'], r['file'], r['art'], r['ctx'], r['dom']]).lower()
    ctx = esc(r['ctx']).replace('▣표ㆍ그림▣', '<mark>▣ 이 자리가 그림 ▣</mark>')
    opts = ''.join(
        f'<label class="opt" title="{esc(t)}"><input type="radio" name="v{r["img"]}" value="{esc(v)}">{esc(v)}</label>'
        for v, t in OPTS)
    where = ('그 고시 화면에서' if r['kind'] == '고시ㆍ행정규칙' else '그 법령 화면에서')
    findhow = (f"<b>{esc(r['art'])}</b> 을 찾아 그 표를 보시면 됩니다."
               if r['hasart'] else
               "위 ①에 적힌 문장을 <b>본문에서 찾아(Ctrl+F)</b> 그 바로 옆의 표를 보시면 됩니다.")
    cards.append(f"""<article class="card" data-img="{esc(r['img'])}" data-dom="{esc(r['dom'])}"
 data-law="{esc(r['law'])}" data-file="{esc(r['file'])}" data-art="{esc(r['art'])}"
 data-buchik="{1 if r['buchik'] else 0}" data-find="{esc(find)}">
  <div class="hd">
    <span class="no">{i:03d}</span>
    <span class="law">{esc(r['law'])}</span>
    <span class="tag">{esc(r['kind'])}{'ㆍ부칙' if r['buchik'] else ''}</span>
    <span class="art">{esc(r['art'])}</span>
    <span class="tag {'ok' if r['png'] else 'no'}">{'그림 받아둠' if r['png'] else '그림도 없음'}</span>
    <span class="tag done" style="display:none">적음</span>
  </div>

  <div class="block">
    <p class="lbl">① 무엇이 문제인가</p>
    <p class="ask">원문 이 자리에 <b>그림이 한 장</b> 들어 있는데, 우리는 그 안의 글자를 가져오지 못했습니다.
    그래서 <b>아래 원문에서 ▣ 표시된 자리가 통째로 비어 있습니다</b> — 챗봇은 이 조문을 찾아 주기는 해도
    <b>그림 안의 내용은 답하지 못합니다.</b>
    <span class="hint" style="display:block;margin-top:5px">그림이 무엇인지는 우리도 모릅니다 —
    수치표일 수도 있고, 도해ㆍ서식ㆍ도장처럼 옮겨 적을 글자가 없는 것일 수도 있습니다. 그 판단부터 부탁드립니다.</span></p>
    <p class="ctx" style="margin-top:8px">{ctx}</p>
  </div>

  <div class="block">
    <p class="lbl">② 어디를 보면 되나</p>
    <p class="ask"><b>「그림 여기서 보기」</b>를 누르면 그 표 그림이 바로 이 화면에 뜹니다(제일 빠릅니다).
    글씨가 작거나 잘리면 <b>「원문 보기」</b>로 국가법령정보센터를 열어 {where} {findhow}</p>
    <div class="acts">
      <button class="btn peek" data-img="{esc(r['imgurl'])}">그림 여기서 보기</button>
      <a class="btn solid" href="{esc(r['src'])}" target="_blank" rel="noopener">원문 보기(국가법령정보센터)</a>
      <a class="btn" href="{esc(r['imgurl'])}" target="_blank" rel="noopener">그림 새 창</a>
    </div>
    <div class="shot" data-on="0"></div>
  </div>

  <div class="block">
    <p class="lbl">③ 무엇을 적어 주시면 되나</p>
    <p class="ask">그림이 <b>표라면</b> 칸 이름과 값을 보이는 대로 적어 주시면 됩니다. 모양은 안 맞춰도 됩니다 —
    한 줄에 한 칸씩, 값은 <b>쉼표로</b> 나눠 주시면 제가 표로 만듭니다.
    <b>숫자·단위는 원문 그대로</b>(예: 3.5킬로그램, 2개 이상) 적어 주세요.</p>
    <div class="opts" style="margin-top:9px">{opts}</div>
    <textarea placeholder="예)&#10;구분, 비치수량, 설치장소&#10;총톤수 2톤 미만, 1개, 조타실 출입구&#10;총톤수 2톤 이상 5톤 미만, 2개, 조타실ㆍ기관실"></textarea>
    <input class="memo" type="text" placeholder="메모 — 이상한 점이나 하시고 싶은 말 (예: 글씨가 번져 두 칸이 안 보임)">
    <p class="hint">적으시는 즉시 이 브라우저에 자동 저장됩니다. 창을 닫았다 열어도 남아 있습니다.
    다 적으신 뒤 아래 <b>「내보내기」</b>로 파일을 받아 저에게 주시면 제가 위키에 싣습니다.</p>
  </div>
</article>""")

chips_dom = ''.join(
    f'<button class="chip" data-g="dom" data-v="{esc(d)}" aria-pressed="false">{esc(d)}</button>'
    for d in doms)

page = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>그림표 확인 작업지</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <p class="eyebrow">사람 확인 요청 · 2026-09-19</p>
  <h1>그림으로만 있는 표 — 보고 적어 주시는 작업지</h1>
  <p class="sub">법령·고시 원문에 표가 <b>그림 한 장</b>으로만 들어 있는 자리 {n}곳입니다.
  우리 수집기는 그림의 글자를 못 가져오기 때문에, 챗봇이 그 표의 숫자·기준을 답하지 못합니다.
  보시고 적어 주시면 그대로 위키에 실어 챗봇이 읽게 만듭니다.</p>

  <div class="how">
    <p class="lbl">이렇게 하시면 됩니다</p>
    <ol>
      <li>맨 아래 <b>「본칙만」</b>을 먼저 누르세요 — 급하지 않은 부칙 서식 {n_bu}곳이 빠지고 <b>{n - n_bu}곳</b>만 남습니다.</li>
      <li>항목마다 <b>「그림 여기서 보기」</b>를 눌러 표를 봅니다. 잘 안 보이면 <b>「원문 보기」</b>로 원문을 엽니다.</li>
      <li>표의 칸 이름과 값을 <b>적는 칸</b>에 옮겨 적습니다. 표가 아니라 도장·도해 그림이면 <b>「표가 아님」</b>만 눌러 주셔도 됩니다.</li>
      <li>중간에 그만두셔도 됩니다 — <b>적으시는 즉시 자동 저장</b>되고, 다시 여시면 그대로 이어집니다.</li>
      <li>끝나면 화면 아래 <b>「내보내기」</b>로 파일을 받아 저에게 주세요. 한 건만 적으셔도 보내 주시면 그만큼 반영합니다.</li>
    </ol>
  </div>

  <div class="tiles">
    <div class="tile"><p class="k">확인할 자리</p><p class="v">{n}<small> 곳</small></p></div>
    <div class="tile"><p class="k">해당 원문</p><p class="v">{n_file}<small> 개</small></p></div>
    <div class="tile"><p class="k">본칙(먼저 볼 것)</p><p class="v">{n - n_bu}<small> 곳</small></p></div>
    <div class="tile"><p class="k">부칙(나중에)</p><p class="v">{n_bu}<small> 곳</small></p></div>
    <div class="tile"><p class="k">적으신 것</p><p class="v"><span id="doneN">0</span><small> / {n}</small></p></div>
  </div>
  <div class="bar"><i id="bar"></i></div>

  <h2>가장 먼저 봐 주시면 좋은 것</h2>
  <p class="sub"><b>「총톤수 10톤 미만 소형어선의 구조 및 설비기준」 제59조</b> — 소화기 비치수량표입니다.
  어제 대기열을 정리하다 <b>"사람이 옮겨 적어야 할 것"으로 확정된 유일한 건</b>이고,
  실제로 어민이 물어볼 만한 내용(배 크기별 소화기 몇 개)이라 값이 큽니다.
  위 찾기 칸에 <b>소화기</b> 라고 치시면 바로 나옵니다.</p>
</header>

<div class="controls">
  <input id="q" class="search" type="search" placeholder="법 이름ㆍ조문ㆍ내용으로 찾기 (예: 소화기, 어선, 별표)">
  <div class="chips">
    <button class="chip" data-g="dom" data-v="전체" aria-pressed="true">전체 분야</button>
    {chips_dom}
  </div>
  <div class="chips">
    <button class="chip" data-g="only" data-v="전체" aria-pressed="true">전부</button>
    <button class="chip" data-g="only" data-v="본칙만" aria-pressed="false">본칙만</button>
    <button class="chip" data-g="only" data-v="아직 안 적음" aria-pressed="false">아직 안 적음</button>
    <button class="chip" data-g="only" data-v="적은 것만" aria-pressed="false">적은 것만</button>
  </div>
</div>

<p class="count" id="cnt"></p>
<div class="list">
{''.join(cards)}
</div>

<footer>
  <b>이 숫자가 어디서 나왔나</b> — 2026-09-19 에 <code>raw/</code> 전체를 훑어,
  본문이 <code>&lt;img id="…"&gt;</code> 로 그림을 가리키는데 그에 대응하는 판독문
  <code>_이미지/&lt;번호&gt;.txt</code> 가 없는 자리를 전부 센 것입니다.
  다른 부처 법령을 모아 둔 <code>15_관련타부처</code> 는 뺐습니다(그쪽까지 넣으면 {n + 338}곳입니다).<br>
  <b>링크가 가리키는 곳</b> — 「원문 보기」는 국가법령정보센터의 그 법령ㆍ고시 페이지,
  「그림」은 국가법령정보센터가 그 표 그림을 내려 주는 주소(<code>flDownload.do</code>)입니다.
  둘 다 2026-09-19 에 실제로 열리는 것을 확인했습니다.<br>
  <b>적으신 내용은 어디에 저장되나</b> — 이 브라우저 안에만 저장됩니다(자동). 인터넷으로 아무 데도 보내지 않습니다.
  저에게 오려면 <b>반드시 「내보내기」</b>를 눌러 파일을 주셔야 합니다.
  다른 기기에서 이어 하시려면 그 파일을 <b>「불러오기」</b>로 열면 됩니다.<br>
  <b>관리자 화면의 「수집대기 52건」과는 다른 숫자입니다</b> —
  그 52건은 카드 글에 "수집"이라는 낱말이 있는지로 기계가 나눈 것이라 실제 수집 문제가 아닌 것이 섞여 있습니다.
  이 작업지는 파일을 직접 세어 만든 것입니다.
</footer>
</div>

<div class="dock">
  <span class="st">적으신 것 <b id="doneN2"></b></span>
  <button class="act solid" id="dl">내보내기 (파일로 받기)</button>
  <button class="act" id="cp">클립보드로 복사</button>
  <label class="act" for="ld">불러오기</label>
  <input id="ld" type="file" accept="application/json,.json" style="display:none">
  <button class="act" id="wipe">전부 지우기</button>
</div>

<script>{JS}
const mirror=()=>{{ document.getElementById('doneN2').textContent=document.getElementById('doneN').textContent+' / {n}'; }};
new MutationObserver(mirror).observe(document.getElementById('doneN'),{{childList:true,characterData:true,subtree:true}});
mirror();
</script>
</body>
</html>"""

open(OUT, 'w', encoding='utf-8').write(page)
print('썼다:', OUT, len(page), '자 /', n, '건')
