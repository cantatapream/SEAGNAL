import json, re, urllib.request, urllib.parse, time, sys
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

OC="hyoo1431"
def api(url):
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.lstrip()[:1] in '{[':
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None          # 재시도로 안 풀린다
        except Exception:
            pass
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
    # ★`eflaw` 를 efYd 없이 부르던 자리다 (2026-09-21 수정).
    #   [무엇이 잘못이었나] `lawService.do?target=eflaw` 는 **efYd 가 없으면** HTTP **200** 과 함께
    #   *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다. api() 가 그것을 네트워크 오류처럼
    #   삼켰으므로 이 호출은 **조용히 아무것도 안 주고 있었다.**
    #   ⚠**권한 문제가 아니다.** 신청은 처음부터 다 돼 있었고, 맞는 efYd 를 주면 JSON 이 온다.
    #     나는 저 문구를 하루에 두 번 오진했다 — "호스트 불통"(L-294), "eflaw 미신청"(L-295).
    #   [왜 그냥 target=law 로 안 바꿨나] 한 MST 가 시행일 판을 둘 이상 가지면 `target=law&MST=`
    #   는 **옛 판이나 시행예정 판**을 준다 — 287955→20260701(현행은 20260828),
    #   288973→**20270101 시행예정**(현행은 20260825). 아직 시행도 안 된 법문을 현행인 양 저장한다.
    #   [그래서] 현행 시행일자를 조회해 `efYd` 로 못 박는 공용 함수를 쓴다.
    #   근거와 실측표는 law_api_guard.py 머리말 · fetch_law_body() 참조.
    d=law_api_guard.fetch_law_body(api, OC, mst)
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
