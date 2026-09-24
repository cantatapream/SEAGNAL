# -*- coding: utf-8 -*-
"""그림 속 표를 **눈으로 대조**하는 HTML 검토장을 만든다. (3-28)

무엇을 푸는가
  원문이 **그림(이미지)** 인 표를 사람이 글자로 옮겨 적었고, 옮긴 값마다 `(⚠REVIEW)` 를
  붙여 두었다 — *"이 숫자 눈으로 다시 확인해 주세요"* 라는 뜻이다. 실측 **803개 · 36파일**,
  그중 **상위 8파일이 675개(84%)** 다.
  기계는 그림 속 숫자를 못 읽는다. **사람이 그림과 표를 나란히 놓고 봐야 한다.**
  ⇒ 그 「나란히 놓기」를 만들어 준다.

무엇을 담나
  · 원본 그림(`_이미지/<id>.png`)을 **파일 안에 통째로 넣는다**(base64).
    ★경로 참조로 두면 파일 하나만 열었을 때 그림이 안 뜬다 — 검토장은 **혼자 서야** 한다.
  · 그 그림 바로 뒤에 붙어 있는 표를 **그대로** 보여준다.
  · `(⚠REVIEW)` 가 붙은 칸마다 **맞음 / 고침(값 입력) / 모름** 을 고를 수 있다.
  · 고른 것은 브라우저에 저장되고(`localStorage`), **JSON·CSV 로 내려받을 수 있다.**

어떻게 짝을 짓나 (넘겨짚지 않는다)
  원문 꼴이 정해져 있다 — `<img id="N">` 다음 줄이 `【이미지판독 N】(원본이미지: _이미지/N.png)`
  이고 그 뒤에 `[표]` 가 온다. **그 순서를 그대로 읽는다.**
  짝을 못 지은 표는 **버리지 않고** 「그림 없음」으로 따로 싣는다 — 값은 봐야 하기 때문이다.

[연계] ← `raw/**\/행정규칙/*.txt` + `_이미지/*.png` → `_dashboard/review/<이름>.html`
사용법: python3 build_review_html.py [--top N] [--all]
"""
import os, re, sys, json, base64, html, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(LEGAL, '_dashboard', 'review')

REVIEW = '(⚠REVIEW)'
IMG = re.compile(r'<img id="(\d+)">')
READ = re.compile(r'【이미지판독\s*(\d+)】')


def files_with_review():
    out = []
    for r, _d, fs in os.walk(RAW):
        if '_이미지' in r:
            continue
        for f in fs:
            if not f.endswith('.txt'):
                continue
            p = os.path.join(r, f)
            try:
                t = open(p, encoding='utf-8').read()
            except Exception:
                continue
            n = t.count(REVIEW)
            if n:
                out.append((n, p))
    out.sort(reverse=True)
    return out


def blocks_of(path):
    """(그림id, 표줄목록) 목록. 그림 없는 표는 id=None 으로 싣는다."""
    lines = open(path, encoding='utf-8').read().split('\n')
    out, cur_id, table = [], None, []
    for ln in lines:
        m = IMG.search(ln) or READ.search(ln)
        if m:
            if table:
                out.append((cur_id, table)); table = []
            cur_id = m.group(1)
            continue
        if ln.startswith('|'):
            table.append(ln)
        elif table and not ln.strip():
            out.append((cur_id, table)); table = []
    if table:
        out.append((cur_id, table))
    return [(i, t) for i, t in out if any(REVIEW in x for x in t)]


def png_data(path, img_id):
    p = os.path.join(os.path.dirname(path), '_이미지', f'{img_id}.png')
    if not os.path.exists(p):
        return None
    return 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()


def cells(row):
    return [c.strip() for c in row.strip().strip('|').split('|')]


def build(path):
    name = os.path.splitext(os.path.basename(path))[0]
    rel = os.path.relpath(path, RAW)
    blocks = blocks_of(path)
    total = sum(1 for _i, t in blocks for r in t for c in cells(r) if REVIEW in c)
    parts, seq = [], 0
    for img_id, table in blocks:
        data = png_data(path, img_id) if img_id else None
        rows = []
        for ri, row in enumerate(table):
            cs = cells(row)
            if all(set(c) <= set('-: ') for c in cs):
                continue                                    # 마크다운 구분줄
            tds = []
            for ci, c in enumerate(cs):
                if REVIEW in c:
                    seq += 1
                    val = c.replace(REVIEW, '').strip()
                    tds.append(
                        f'<td class="rv" data-k="{seq}">'
                        f'<div class="val">{html.escape(val)}</div>'
                        f'<div class="btns">'
                        f'<button class="ok" data-k="{seq}" data-v="맞음">맞음</button>'
                        f'<button class="fx" data-k="{seq}" data-v="고침">고침</button>'
                        f'<button class="un" data-k="{seq}" data-v="모름">모름</button>'
                        f'</div>'
                        f'<input class="newv" data-k="{seq}" placeholder="바른 값" hidden>'
                        f'<div class="mark" data-k="{seq}"></div></td>')
                else:
                    tag = 'th' if ri == 0 else 'td'
                    tds.append(f'<{tag}>{html.escape(c)}</{tag}>')
            rows.append('<tr>' + ''.join(tds) + '</tr>')
        img_html = (f'<img src="{data}" alt="원본 그림 {img_id}">' if data
                    else f'<p class="noimg">⚠원본 그림을 못 찾았다'
                         f'{" (id " + img_id + ")" if img_id else " (이 표엔 그림 짝이 없다)"} — '
                         f'값은 그대로 확인해야 한다</p>')
        parts.append(f'<section><div class="pane img">{img_html}</div>'
                     f'<div class="pane tbl"><table>{"".join(rows)}</table></div></section>')
    return name, rel, total, seq, '\n'.join(parts)


TPL = '''<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--line:#d8d8d8;--soft:#f6f6f6;--ok:#137333;--fx:#a50e0e;--un:#8a6d00;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e8e8e8;--line:#3a3d42;--soft:#1e2126;--ok:#5bb974;--fx:#f28b82;--un:#fdd663;--accent:#8ab4f8}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#e8e8e8;--line:#3a3d42;--soft:#1e2126;--ok:#5bb974;--fx:#f28b82;--un:#fdd663;--accent:#8ab4f8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px}
h1{margin:0 0 4px;font-size:17px}
.meta{font-size:13px;opacity:.75}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.bar button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--line);border-radius:7px;background:var(--soft);color:var(--fg);cursor:pointer}
.bar button.primary{background:var(--accent);color:#fff;border-color:transparent}
.count{font-size:13px;margin-left:auto;opacity:.8}
main{padding:16px;max-width:1400px;margin:0 auto}
section{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid var(--line)}
@media (max-width:900px){section{grid-template-columns:1fr}}
.pane{min-width:0}
.pane.img{position:sticky;top:96px;align-self:start}
.pane.img img{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff}
.noimg{padding:14px;border:1px dashed var(--line);border-radius:8px;font-size:13px;color:var(--un)}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--line);padding:5px 7px;vertical-align:top;text-align:left}
th{background:var(--soft);font-weight:600}
td.rv{background:var(--soft);min-width:130px}
td.rv .val{font-weight:700;margin-bottom:4px;word-break:break-all}
td.rv .btns{display:flex;gap:3px}
td.rv button{font:inherit;font-size:11px;padding:2px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--fg);cursor:pointer}
td.rv input.newv{margin-top:4px;width:100%;font:inherit;font-size:12px;padding:3px 5px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--fg)}
td.rv .mark{font-size:11px;margin-top:3px;font-weight:700}
td.rv[data-s="맞음"]{outline:2px solid var(--ok);outline-offset:-2px}
td.rv[data-s="고침"]{outline:2px solid var(--fx);outline-offset:-2px}
td.rv[data-s="모름"]{outline:2px solid var(--un);outline-offset:-2px}
footer{padding:20px 16px 50px;font-size:12.5px;opacity:.75;max-width:1400px;margin:0 auto}
</style></head><body>
<header>
  <h1>__TITLE__</h1>
  <div class="meta">원문: <code>raw/__REL__</code> · 확인할 값 <b>__TOTAL__</b>개<br>
  왼쪽이 <b>원문 그림</b>, 오른쪽이 <b>옮겨 적은 표</b>입니다. 노란 칸이 확인할 값입니다.</div>
  <div class="bar">
    <button class="primary" id="dlJson">JSON 내려받기</button>
    <button id="dlCsv">CSV 내려받기</button>
    <button id="allOk">남은 것 전부 「맞음」</button>
    <button id="reset">지우기</button>
    <span class="count" id="count"></span>
  </div>
</header>
<main>__BODY__</main>
<footer>
  · 고른 것은 <b>이 브라우저에 저장</b>됩니다(다른 기기·다른 사람에게는 안 갑니다). 끝나면 <b>내려받아</b> 주세요.<br>
  · 「고침」을 누르면 바른 값을 적는 칸이 열립니다. 적은 값은 내려받는 파일에 함께 담깁니다.<br>
  · 원문 그림이 안 뜨는 표는 <span style="color:var(--un)">노란 안내</span>가 대신 나옵니다 — 그 값도 확인 대상입니다.
</footer>
<script>
const KEY='review:__NAME__';
let S={};
try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){S={}}
const tds=[...document.querySelectorAll('td.rv')];
function paint(){
  for(const td of tds){
    const k=td.dataset.k, s=S[k];
    if(!s){td.removeAttribute('data-s');td.querySelector('.mark').textContent='';continue}
    td.dataset.s=s.state;
    const inp=td.querySelector('.newv');
    inp.hidden = s.state!=='고침';
    if(s.state==='고침'&&inp.value!==(s.value||''))inp.value=s.value||'';
    td.querySelector('.mark').textContent =
      s.state==='고침' ? '고침 → '+(s.value||'(값을 적어 주세요)') : s.state;
  }
  const done=Object.keys(S).length;
  document.getElementById('count').textContent=done+' / '+tds.length+' 확인함';
  try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('td.rv button'); if(!b)return;
  const k=b.dataset.k, v=b.dataset.v;
  if(S[k]&&S[k].state===v){delete S[k]} else {S[k]={state:v,value:(S[k]||{}).value||'',
    orig:document.querySelector('td.rv[data-k="'+k+'"] .val').textContent}}
  paint();
  if(S[k]&&S[k].state==='고침'){const i=document.querySelector('input.newv[data-k="'+k+'"]');i.hidden=false;i.focus()}
});
document.addEventListener('input',e=>{
  const i=e.target.closest('input.newv'); if(!i)return;
  const k=i.dataset.k; S[k]=S[k]||{state:'고침',orig:''}; S[k].value=i.value; paint();
});
function rows(){
  return tds.map(td=>{const k=td.dataset.k,s=S[k]||{};
    return {번호:+k, 옮겨적은값:td.querySelector('.val').textContent,
            판정:s.state||'', 바른값:s.value||''}});
}
function dl(name,text,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();
}
document.getElementById('dlJson').onclick=()=>dl('__NAME___검토.json',
  JSON.stringify({원문:'raw/__REL__',확인한때:new Date().toISOString(),결과:rows()},null,1),'application/json');
document.getElementById('dlCsv').onclick=()=>{
  const r=rows(); const esc=v=>'"'+String(v).replace(/"/g,'""')+'"';
  dl('__NAME___검토.csv','\\uFEFF'+['번호,옮겨적은값,판정,바른값',
    ...r.map(x=>[x.번호,x.옮겨적은값,x.판정,x.바른값].map(esc).join(','))].join('\\n'),'text/csv');
};
document.getElementById('allOk').onclick=()=>{
  if(!confirm('아직 안 고른 값을 전부 「맞음」으로 표시합니다. 계속할까요?'))return;
  for(const td of tds){const k=td.dataset.k; if(!S[k])S[k]={state:'맞음',value:'',
    orig:td.querySelector('.val').textContent}}
  paint();
};
document.getElementById('reset').onclick=()=>{
  if(!confirm('고른 것을 모두 지웁니다. 계속할까요?'))return;
  S={};try{localStorage.removeItem(KEY)}catch(e){};
  for(const i of document.querySelectorAll('input.newv')){i.value='';i.hidden=true}
  paint();
};
paint();
</script></body></html>'''


def wiki_cited_admrul():
    """위키가 실제로 짚는 행정규칙 raw 경로. **사용자에게 닿는 파일을 먼저 하기 위한 자다.**
    ★2026-09-24 실측(3-28 / G-24) — `(⚠REVIEW)` 가 붙은 파일 **78개 중 위키가 인용하는 것은 39개(50%)**.
      표시 837개 중 **인용 파일 안에 있는 것은 315개**이고, 그 **73%(230개)가 파일 셋**에 몰려 있다
      (어선설비기준 132 · 선박소방설비기준 57 · 선박설비기준 41 — 셋 다 이미 검토장이 있다).
      ⇒ 남은 것은 **85개 · 36파일**. 인용 안 하는 파일의 표시는 **사용자에게 닿지 않는다** — 뒤로 민다.
    """
    import os as _os
    wiki = _os.path.join(LEGAL, 'wiki')
    pat = re.compile(r'raw/[^\s`"“”,)]+\.txt')
    out = set()
    for root, dirs, fs in _os.walk(wiki):
        for f in fs:
            if not f.endswith('.md'):
                continue
            try:
                t = open(_os.path.join(root, f), encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            for m in pat.findall(t):
                if '/행정규칙/' in m:
                    out.add(m)
    return out


def main():
    top = 8
    cited_only = '--cited' in sys.argv          # 위키가 인용하는 파일만
    skip_made = '--skip-made' in sys.argv       # 이미 만든 검토장은 건너뛴다
    for i, a in enumerate(sys.argv):
        if a == '--top' and i + 1 < len(sys.argv):
            top = int(sys.argv[i + 1])
    allf = '--all' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    fw = files_with_review()
    print(f'(⚠REVIEW) 가 있는 파일 {len(fw)}개 · 값 {sum(n for n, _ in fw)}개')
    if cited_only:
        cited = wiki_cited_admrul()
        before = len(fw)
        fw = [(n, p) for n, p in fw
              if os.path.relpath(p, os.path.dirname(RAW)).replace(os.sep, '/') in cited]
        print(f'  ★위키가 인용하는 것만 남긴다: {before} → {len(fw)}개 · 값 {sum(n for n, _ in fw)}개')
    if skip_made:
        keep = []
        for n, p in fw:
            name = os.path.splitext(os.path.basename(p))[0]
            out = os.path.join(OUT, re.sub(r'[^0-9A-Za-z가-힣]', '_', name) + '.html')
            if os.path.exists(out):
                print(f'  ⏭️  이미 검토장이 있다: {name[:44]} (값 {n})')
            else:
                keep.append((n, p))
        fw = keep
    targets = fw if (allf or cited_only) else fw[:top]
    print(f'검토장을 만들 대상: {len(targets)}개 · 값 {sum(n for n, _ in targets)}개'
          f' ({sum(n for n, _ in targets) * 100 // max(1, sum(n for n, _ in fw))}%)')
    made = []
    for n, p in targets:
        name, rel, total, seq, body = build(p)
        if not seq:
            print(f'  · {name[:40]:40s} 표에서 못 찾음(값 {n}개는 표 밖에 있다) — 건너뜀')
            continue
        h = (TPL.replace('__TITLE__', html.escape(name))
                .replace('__REL__', html.escape(rel))
                .replace('__NAME__', re.sub(r'[^0-9A-Za-z가-힣]', '_', name))
                .replace('__TOTAL__', str(seq))
                .replace('__BODY__', body))
        out = os.path.join(OUT, re.sub(r'[^0-9A-Za-z가-힣]', '_', name) + '.html')
        open(out, 'w', encoding='utf-8').write(h)
        made.append((seq, os.path.relpath(out, LEGAL), os.path.getsize(out)))
        print(f'  ✅ {name[:40]:40s} 값 {seq:4d}개 · {os.path.getsize(out) // 1024:5d}KB')
    print(f'\n  → {OUT} 에 {len(made)}개')
    return 0


if __name__ == '__main__':
    sys.exit(main())
