import json, re, urllib.request, urllib.parse, time, sys

OC="hyoo1431"
def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(1)
    return None

def search_mst(name):
    q=urllib.parse.quote(name)
    d=api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=eflaw&type=JSON&query={q}")
    if not d: return None
    laws=d.get('LawSearch',{}).get('law',[])
    if isinstance(laws,dict): laws=[laws]
    # 현행 & 정확히 이름 일치(법률 우선)
    cur=[l for l in laws if l.get('현행연혁코드')=='현행' and l.get('법령명한글','').strip()==name]
    if not cur:
        cur=[l for l in laws if l.get('현행연혁코드')=='현행' and l.get('법령명한글','').startswith(name)]
    return cur[0]['법령일련번호'] if cur else None

def get_refs(mst):
    d=api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON&MST={mst}")
    if not d: return set()
    jo=d.get('법령',{}).get('조문',{}).get('조문단위',[])
    if isinstance(jo,dict): jo=[jo]
    text=json.dumps(jo, ensure_ascii=False)
    refs=set(re.findall(r'「([^」]+)」', text))
    # 시행령/시행규칙/별표 등 제외, 법·법률만
    return {r for r in refs if r.endswith('법') or r.endswith('법률')}

# BFS
seen={}  # name -> mst
frontier=['어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률']
edges=[]
level=0
all_laws=set(frontier)
while frontier and level<3:
    print(f"--- Level {level}: {len(frontier)}개 법 처리 ---", file=sys.stderr)
    nxt=[]
    for name in frontier:
        if name in seen: continue
        mst=search_mst(name)
        seen[name]=mst
        if not mst:
            print(f"  [MST 못찾음] {name}", file=sys.stderr); continue
        refs=get_refs(mst)
        for r in refs:
            edges.append((name,r))
            if r not in all_laws:
                all_laws.add(r); nxt.append(r)
        print(f"  {name[:20]}: {len(refs)}개 인용", file=sys.stderr)
        time.sleep(0.3)
    frontier=list(set(nxt))
    level+=1

print(f"\n총 발견 법령 수(3단계): {len(all_laws)}")
print(f"단계별 누적: L0=1")
