"""그림 값 검토장(게시판 한 곳) — `_dashboard/review/*.html` 19쪽을 한 게시물로 묶는다. (3-28 · 확인판 D1 ⓑ)

쪽마다 본문은 d/NN.json 으로 떼어 필요할 때 불러온다. 고른 것은 게시판 저장소 `review/<f+sha1(이름)[:12]>` 에
{이름, 원문, S(JSON), at} 로 남는다 — 저장소 파일 쪽(build_review_html.py)과 같은 문서 이름이다.
사용법: python3 build.py [결과폴더]   (게시할 것: 결과폴더/그림값_검토장.html + d/*.json · 약 5MB 라 저장소에 두지 않는다)
게시본: https://claude.ai/artifact/6T39qbcgpkzWJwSsHsbKJu
"""
import glob, json, re, os, html, sys
R=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),'review')+os.sep
OUT=sys.argv[1] if len(sys.argv)>1 else '/tmp/figrev'
os.makedirs(os.path.join(OUT,'d'),exist_ok=True)
items=[]
for f in sorted(glob.glob(R+'*.html')):
    s=open(f,encoding='utf-8').read()
    if 'td.rv' not in s or 'const KEY=' not in s: continue
    name=re.search(r"const KEY='review:([^']*)'",s).group(1)
    title=html.unescape(re.search(r'<h1>(.*?)</h1>',s).group(1))
    rel=html.unescape(re.search(r'원문: <code>raw/(.*?)</code>',s).group(1))
    total=int(re.search(r'확인할 값 <b>(\d+)</b>',s).group(1))
    body=re.search(r'<main>(.*)</main>',s,re.S).group(1)
    n=body.count('class="rv"')
    assert n==total,(f,n,total)
    items.append(dict(name=name,title=title,rel=rel,total=total,body=body))
items.sort(key=lambda x:-x['total'])
idx=[]
for i,it in enumerate(items):
    fn='d/%02d.json'%i
    json.dump(it,open(os.path.join(OUT,fn),'w',encoding='utf-8'),ensure_ascii=False)
    idx.append(dict(f=fn,name=it['name'],title=it['title'],rel=it['rel'],total=it['total']))
t=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'template.html'),encoding='utf-8').read()
open(os.path.join(OUT,'그림값_검토장.html'),'w',encoding='utf-8').write(t.replace('__IDX__',json.dumps(idx,ensure_ascii=False)))
print(len(items),'쪽',sum(x['total'] for x in items),'값')
