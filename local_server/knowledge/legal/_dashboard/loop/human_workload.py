#!/usr/bin/env python3
# human_workload.py — 최종 사람 검수량을 **분야별**로 집계(모든 자동처리 후 남는 진짜 사람 몫).
# 역할(초보자용): 리뷰큐의 미승인 엔트리를 유형별로 분류해 "사람이 실제로 봐야 하는 게 분야별로 몇 건인지" 센다.
# 분류: ①별표OCR값확정(수치) ②법리·유권해석 ③판례확인 ④입법연혁(의도vs누락) ⑤제품설계판단 ⑥수집대기 ⑦기타
# [연계] 입력 _dashboard/review_queue.md(미승인) · 출력 stdout 요약 + _dashboard/human_workload.json
import re, json, os
LEGAL=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
Q=os.path.join(LEGAL,'_dashboard','review_queue.md')

txt=open(Q,encoding='utf-8').read()
# 엔트리 분해
blocks=re.split(r'(?=^### REVIEW-)',txt,flags=re.M)
cats={'별표OCR값확정':[], '법리·유권해석':[], '판례확인':[], '입법연혁(의도vs누락)':[], '제품설계판단':[], '수집대기':[], '기타해석':[]}
pending=0
for b in blocks:
    if not b.startswith('### REVIEW-'): continue
    if re.search(r'^-\s*승인:\s*\[[xX]\]', b, re.M): continue   # 이미 승인
    # ★"해당 없음"도 사람 대기가 아니다(2026-08-23, 적대검증에서 발견).
    #   review_queue.md 가 스스로 `- 승인: 해당 없음(재수집 필요 항목, 사람 승인 대상 아님)` 이라
    #   적어 둔 항목을, 위 정규식이 `[x]` 만 걸러내는 바람에 **사람 검수 대기로 잘못 셌다.**
    #   실측: 대기 143 + 해당없음 2 = 145 로 보고되던 것이 옳게는 143 이다.
    #   숫자 자체는 작지만, "사람이 봐야 할 일이 몇 건인가"는 사람의 시간을 배분하는 근거라
    #   틀리면 안 된다.
    if re.search(r'^-\s*승인:\s*해당\s*없음', b, re.M): continue
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
