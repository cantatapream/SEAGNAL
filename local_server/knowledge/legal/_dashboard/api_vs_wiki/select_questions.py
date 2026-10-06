#!/usr/bin/env python3
"""
select_questions.py — 비교 실험(위키 vs 법제처 API)에 쓸 질문지를 골든 문항에서 고른다.

[역할] 골든 문항(`_dashboard/loop/pinned/golden_questions.json`, 원문으로 정답 조문을 확인해 둔 것)
  중에서 **답이 어느 층(법률·시행령·시행규칙·별표·행정규칙)에 있는지**별로 고르게 뽑는다.
  위임 사슬을 끝까지 따라가야 하는 질문(별표·행정규칙)을 일부러 많이 넣는다 — 이 실험이
  보려는 것이 바로 "API 로 그 흐름을 따라갈 수 있는가"이기 때문이다.
[결정론] 같은 입력이면 늘 같은 질문지가 나온다(무작위 씨앗 고정). 그래야 세 방식이 같은 문제를 푼다.
[출력] 같은 폴더의 questions.json — {pilot:[10], main:[40]} (pilot 은 main 의 앞부분 부분집합)
[연계] ← run_all.sh 가 읽는다. 골든 파일은 읽기만 한다.
"""
import json, os, random, re

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, '..', 'loop', 'pinned', 'golden_questions.json')
OUT = os.path.join(HERE, 'questions.json')

# 층별 몫(합 40). 법률만으로 답이 나오는 문항이 골든의 64%라 그대로 뽑으면 위임 사슬을 거의 못 본다.
QUOTA = {'법률': 12, '시행령': 7, '시행규칙': 6, '별표': 10, '행정규칙': 5}
PILOT_PER_LAYER = 2   # 시험 10문항 = 층마다 2개
# 혼자서는 뜻이 안 서는 문항을 뺀다 — 감사 메모가 섞였거나(★재질문·라운드·회귀)
# 앞 대화를 전제로 한 것(「이 법」). 세 방식 모두에 똑같이 불리하지만 비교 신호만 흐린다.
NOISY = re.compile(r'★|라운드|회귀|재질문|이 법')


def layer(q):
    """정답 근거가 있는 층. 예: expect_article='별표4' → '별표'."""
    s = q['expect_law'] + ' ' + q['expect_article']
    if re.search(r'별표|별지', s):
        return '별표'
    if re.search(r'고시|기준|규정|훈령|지침|요령', q['expect_law']):
        return '행정규칙'
    if '시행규칙' in s:
        return '시행규칙'
    if '시행령' in s:
        return '시행령'
    return '법률'


def main():
    qs = json.load(open(GOLDEN, encoding='utf-8'))['questions']
    usable = [q for q in qs if q.get('verified') and not q.get('drop') and not q.get('skip')
              and not NOISY.search(q['question'])]
    rnd = random.Random(20261006)
    main_list, used_laws = [], set()
    for lay, n in QUOTA.items():
        pool = [q for q in usable if layer(q) == lay]
        rnd.shuffle(pool)
        # 한 법에 몰리지 않게 — 아직 안 쓴 법을 먼저 고르고, 모자라면 나머지에서 채운다.
        first = [q for q in pool if q['law'] not in used_laws]
        rest = [q for q in pool if q['law'] in used_laws]
        picked = []
        for q in first + rest:
            if len(picked) >= n:
                break
            if q['law'] in {p['law'] for p in picked}:
                continue
            picked.append(q)
        for q in first + rest:   # 법이 모자라 n 을 못 채웠으면 중복 법도 허용
            if len(picked) >= n:
                break
            if q not in picked:
                picked.append(q)
        for q in picked:
            used_laws.add(q['law'])
            main_list.append({'id': f'{lay}-{len([m for m in main_list if m["layer"] == lay]) + 1:02d}',
                              'layer': lay, 'law': q['law'], 'question': q['question'].strip().strip('"“”').strip(),
                              'expect_law': q['expect_law'], 'expect_article': q['expect_article'],
                              'in_wiki': q.get('in_wiki')})
    pilot = []
    for lay in QUOTA:
        pilot += [m for m in main_list if m['layer'] == lay][:PILOT_PER_LAYER]
    json.dump({'source': 'golden_questions.json (verified, drop/skip 제외)', 'usable': len(usable),
               'quota': QUOTA, 'pilot': [m['id'] for m in pilot], 'main': main_list},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'골든 사용가능 {len(usable)}문항 → 본실험 {len(main_list)} · 시험 {len(pilot)} → {OUT}')


if __name__ == '__main__':
    main()
