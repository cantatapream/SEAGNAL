# -*- coding: utf-8 -*-
"""본문 인용 목록(3-41)에서 **숫자·금액 인용만 골라 원문과 기계로 맞대어 본다.**

무엇이 나뉘나 (사용자 지시 2026-09-24: "1번 진행. 그리고 뜻풀이 인용(사람)으로 갈라서 제공")
  ① **숫자 대조 가능** — 그 항목에 raw 원문이 딸려 있고, 위키 줄에 **값 숫자**
     (금액·기간·비율·치수·인원 …)가 있다. ⇒ **이 도구가 판정한다.**
  ② **뜻풀이** — 값 숫자가 없거나 raw 원문이 없다. ⇒ **사람이 본다**(HTML 검토 도구로 넘긴다).

★값 숫자와 **가리키는 숫자**를 가른다 (여기서 한 번 틀렸다)
  처음엔 `\\d+` 에 단위를 붙여 세었더니 `2026-07-27`(날짜) · `제2조제4·5호`(조번호) ·
  `법률 제11578호`(공포번호)가 죄다 「숫자 인용」으로 들어왔다. 그것들은 **값이 아니라 주소**다.
  ⇒ 단위 흰목록으로만 잡고, 조·항·호·목·장·편·절·서식·법률 제N호·네 자리 연도는 **뺀다**.

어떻게 판정하나 (환각 0)
  위키 줄에서 뽑은 값 숫자가 **그 조 원문에 글자 그대로 있나**를 본다.
  · 다 있으면        → `맞음`
  · 하나라도 없으면  → `어긋남 후보` (★「틀렸다」고 단정하지 않는다 — 원문이 한글로
    적었거나(`일억원`) 다른 조에서 끌어온 값일 수 있다. 사람이 볼 목록에 올린다)
  · 값 숫자가 없으면 → `②뜻풀이`

[연계] ← `_dashboard/body_cite_gap.json`(V5-8c 가 만든다)
        → `_dashboard/cite_number_check.json` · `_dashboard/cite_human_review.json`(②)
사용법: python3 cite_number_check.py [--write]
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
DASH = os.path.join(LEGAL, '_dashboard')

# ★값 단위 흰목록. 「주소 단위」(조·항·호·목·장·편·절·서식·급·종)는 **넣지 않는다.**
UNIT = (r'원|만원|억원|천원|퍼센트|%|일|개월|년간|시간|분|초|미터|m|밀리미터|mm|센티미터|cm'
        r'|킬로미터|km|톤|킬로그램|kg|그램|리터|ℓ|L|명|인|배|회|차|노트|마일|해리|도|세|점|층|척')
VALUE = re.compile(r'(?<![조항호목장편절제])(\d[\d,]*(?:\.\d+)?)\s*(' + UNIT + r')(?![가-힣])')
# 빼야 할 것들 — 날짜·공포번호·조문 주소
DROP = [
    re.compile(r'\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}'),        # 2026-07-27
    re.compile(r'\d{4}\s*년\s*\d{1,2}\s*월'),                       # 2012년 12월
    re.compile(r'(법률|대통령령|부령|제)\s*제?\s*\d+\s*호'),           # 법률 제11578호
    re.compile(r'제\s*\d+\s*(조|항|호|목|장|편|절)'),                 # 제2조제4호
    re.compile(r'별표\s*\d+|별지\s*제?\s*\d+'),
    re.compile(r'[A-Z]\d+-\d+|\b[A-Z]{1,3}\d{1,3}\b'),             # E6-5558048a · R16-08 · QP19
]


def values_of(line):
    s = str(line or '')
    for d in DROP:
        s = d.sub(' ', s)
    out = []
    for m in VALUE.finditer(s):
        out.append((m.group(1).replace(',', ''), m.group(2)))
    # 같은 값이 여러 번 나오면 한 번만
    seen, uniq = set(), []
    for v in out:
        if v not in seen:
            seen.add(v); uniq.append(v)
    return uniq


def in_raw(num, raw_text):
    """값이 원문에 글자 그대로 있나. 천 단위 쉼표 유무를 둘 다 본다."""
    if num in raw_text:
        return True
    if len(num) > 3:                                  # 12000 ↔ 12,000
        with_comma = '{:,}'.format(int(num)) if num.isdigit() else num
        if with_comma in raw_text:
            return True
    return False


def main():
    write = '--write' in sys.argv
    d = json.load(open(os.path.join(DASH, 'body_cite_gap.json'), encoding='utf-8'))
    items = []
    for law, pages in d['by_law'].items():
        for pg in pages:
            for it in pg['items']:
                it['law'] = law
                it['page'] = pg['page']
                items.append(it)
    tally = collections.Counter()
    ok, miss, human = [], [], []
    for it in items:
        raws = it.get('원문') or []
        vals = values_of(it.get('line', ''))
        if not raws or not vals:
            tally['② 뜻풀이 — 사람이 본다'] += 1
            it['_왜'] = ('그 조 원문이 raw 에 없다' if not raws else '값 숫자가 없다 — 뜻풀이 인용이다')
            human.append(it)
            continue
        raw_text = '\n'.join(str(x) for x in raws)
        bad = [f'{n}{u}' for n, u in vals if not in_raw(n, raw_text)]
        if bad:
            tally['① 어긋남 후보 — 사람 확인'] += 1
            it['_안맞는값'] = bad
            it['_찾은값'] = [f'{n}{u}' for n, u in vals]
            miss.append(it)
        else:
            tally['① 맞음 — 기계가 확인'] += 1
            it['_맞은값'] = [f'{n}{u}' for n, u in vals]
            ok.append(it)
    print('본문 인용 항목 전체:', len(items), '  ★등록부는 376 이라 적혀 있으나 실측은 이 수다')
    for k in sorted(tally):
        print(f'  {k:28s} {tally[k]}')
    print()
    print('=== ① 맞음 표본 6 ===')
    for it in ok[:6]:
        print('  ✅ %-22s %-8s %s' % (it['law'][:22], it['article'], '·'.join(it['_맞은값'])))
    print()
    print('=== ① 어긋남 후보 표본 8 (★「틀렸다」가 아니다 — 사람이 볼 목록) ===')
    for it in miss[:8]:
        print('  ⚠ %-22s %-8s 없는값 %s   (찾은값 %s)'
              % (it['law'][:22], it['article'], '·'.join(it['_안맞는값'])[:40],
                 '·'.join(it['_찾은값'])[:40]))
    if write:
        json.dump({'_뜻': '① 숫자·금액 인용을 원문과 기계로 맞대어 본 결과. 범위: body_cite_gap.json 전체',
                   '_주의': '「어긋남 후보」는 틀렸다는 말이 아니다 — 원문이 한글로 적었거나 다른 조에서 끌어온 값일 수 있다',
                   '전체': len(items), '맞음': len(ok), '어긋남후보': len(miss), '뜻풀이': len(human),
                   '맞음목록': ok, '어긋남후보목록': miss},
                  open(os.path.join(DASH, 'cite_number_check.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        json.dump({'_뜻': '② 뜻풀이 인용 — 법 판단이라 사람이 본다. HTML 검토 도구가 이 파일을 읽는다',
                   '전체': len(human), '목록': human},
                  open(os.path.join(DASH, 'cite_human_review.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        print('\n  → _dashboard/cite_number_check.json · cite_human_review.json 에 적었다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
