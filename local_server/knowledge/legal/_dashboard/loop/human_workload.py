#!/usr/bin/env python3
# human_workload.py — 최종 사람 검수량을 **분야별**로 집계(모든 자동처리 후 남는 진짜 사람 몫).
# 역할(초보자용): 리뷰큐의 미승인 엔트리를 유형별로 분류해 "사람이 실제로 봐야 하는 게 분야별로 몇 건인지" 센다.
# 분류: ①별표OCR값확정(수치) ②법리·유권해석 ③판례확인 ④입법연혁(의도vs누락) ⑤제품설계판단 ⑥수집대기 ⑦기타
# [연계] 입력 _dashboard/review_queue.md(미승인) · 출력 stdout 요약 + _dashboard/human_workload.json
import re, json, os
LEGAL=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
Q=os.path.join(LEGAL,'_dashboard','review_queue.md')

txt=open(Q,encoding='utf-8').read()

# ★2026-09-23 (3-17 · G-11) — **규칙을 여기 적지 않는다.** 서버와 이 스크립트가 따로 적어 두는 바람에
#   두 숫자가 어긋난 채 방치됐다(아래 옛 주석 참조). 이제 셋이 **한 파일**을 읽는다:
#     `_dashboard/review_queue_rules.json`  ← 서버 `routes/legal.js` · 여기 · V5-30 게이트
RULES=json.load(open(os.path.join(LEGAL,'_dashboard','review_queue_rules.json'),encoding='utf-8'))
RE_HEAD=re.compile(RULES['카드머리'])
RE_CLOSE=re.compile(RULES['카드닫기'])
RE_OK=re.compile(RULES['승인'],re.M)
RE_NA=re.compile(RULES['해당없음'],re.M)
RE_SPLIT=re.compile(RULES['쪼갬'],re.M)

# ★카드 경계도 서버와 같게 잡는다 — **REVIEW 가 아닌 `### ` 제목은 앞 카드를 닫는다**(P-10).
#   종전에는 `re.split(r'(?=^### REVIEW-)')` 로 잘라서, 카드 뒤에 `### 〔기록〕` 같은 제목이 오면
#   그 아래 `- 승인:` 줄까지 **앞 카드 몫으로 빨아들였다.** 서버에서 실제로 승인 2장이 뒤집혔던
#   바로 그 병이다(9435·9468·9515행). 여기만 안 고치면 또 어긋난다.
def _cards(text):
    out=[]; cur=None
    for line in text.split('\n'):
        if RE_HEAD.match(line):
            if cur is not None: out.append(cur)
            cur=line+'\n'; continue
        if RE_CLOSE.match(line):
            if cur is not None: out.append(cur); cur=None
            continue
        if cur is not None: cur+=line+'\n'
    if cur is not None: out.append(cur)
    return out

blocks=_cards(txt)
cats={'별표OCR값확정':[], '법리·유권해석':[], '판례확인':[], '입법연혁(의도vs누락)':[], '제품설계판단':[], '수집대기':[], '기타해석':[]}
pending=0
for b in blocks:
    if not b.startswith('### REVIEW-'): continue
    m=RE_OK.search(b)
    if m and m.group(1).lower()=='x': continue                     # 이미 승인
    # ★"해당 없음"도 사람 대기가 아니다(2026-08-23, 적대검증에서 발견).
    #   review_queue.md 가 스스로 `- 승인: 해당 없음(재수집 필요 항목, 사람 승인 대상 아님)` 이라
    #   적어 둔 항목을, 위 정규식이 `[x]` 만 걸러내는 바람에 **사람 검수 대기로 잘못 셌다.**
    #   실측: 대기 143 + 해당없음 2 = 145 로 보고되던 것이 옳게는 143 이다.
    #   숫자 자체는 작지만, "사람이 봐야 할 일이 몇 건인가"는 사람의 시간을 배분하는 근거라
    #   틀리면 안 된다.
    #   ⚠2026-09-18: 이 규칙이 **글자 모양으로** 찾고 있어 쉽게 깨진다는 것이 드러났다. 같은 날
    #   깨진 카드를 고치며 `- 승인: 해당 없음(…)` 을 `- 승인: [ ] 해당 없음 — …`(기계가 읽는 꼴)로
    #   바꿨더니 이 규칙이 더 이상 안 걸렸다. `[ ]` 가 앞에 붙은 꼴도 받도록 넓힌다.
    if RE_NA.search(b): continue
    # ★쪼갠 부모 카드도 사람 몫이 아니다(2026-09-18 사용자 확정, 서버 routes/legal.js 와 같은 규칙).
    #   논점이 여럿인 카드를 하위 카드로 나눴을 때, 판단은 하위 카드에서 한다. 부모를 지우지 못하는
    #   이유는 위키 96곳이 그 카드 번호를 참조하기 때문이다. 부모까지 세면 대기 수가 부풀려진다.
    #   ⚠이 규칙은 **서버와 여기 두 곳에만** 있다. 한쪽만 고치면 두 숫자가 어긋난다 — 실제로
    #   `해당 없음` 처리가 여기에만 있어 어긋난 채 방치돼 있었다.
    if RE_SPLIT.search(b): continue
    pending+=1
    hid=re.match(r'^###\s+(REVIEW-\S+)', b).group(1)
    low=b
    # 우선순위 분류(위에서부터 먼저 걸리는 것)
    if re.search(r'AI 제안값|별표\s*\d+\s*OCR|박스표|판독', low) and re.search(r'제안값|OCR|판독', low):
        cats['별표OCR값확정'].append(hid)
    elif re.search(r'수집|재수집|미확보|law\.go\.kr|공개법령|DRF', low) and re.search(r'needs_collect|수집', low):
        cats['수집대기'].append(hid)
    elif re.search(r'판례|대법원|해석례', low):
        cats['판례확인'].append(hid)
    elif re.search(r'입법연혁|의도.*누락|누락.*의도|입법오류|개정이유', low):
        cats['입법연혁(의도vs누락)'].append(hid)
    elif re.search(r'좌표|판정\s*로직|제품\s*설계|실시간\s*판정|매핑.*설계', low):
        cats['제품설계판단'].append(hid)
    elif re.search(r'유권해석|법리|법제처|실무\s*해석|사업성|영리성|재량', low):
        cats['법리·유권해석'].append(hid)
    else:
        cats['기타해석'].append(hid)

out={'pending_total':pending,'by_category':{k:len(v) for k,v in cats.items()},'detail':{k:v for k,v in cats.items()}}
json.dump(out,open(os.path.join(LEGAL,'_dashboard','human_workload.json'),'w'),ensure_ascii=False,indent=1)
print(f'=== 사람 검수 대상(미승인) 총 {pending}건 — 분야별 ===')
for k,v in cats.items():
    if v: print(f'  · {k}: {len(v)}건')
print('저장: _dashboard/human_workload.json')
