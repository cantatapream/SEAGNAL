#!/usr/bin/env python3
"""
이미 받아 둔 응답 기록(clean.jsonl)의 `got`(챗봇이 실제로 내놓은 근거줄)을 다시 채점한다.
서버를 다시 부르지 않는다 — 채점 규칙만 고쳐 다시 매긴다(돈·한도를 더 쓰지 않는다).

[왜 다시 채점하나] 첫 채점기는 기대 근거에서 `제N조` 만 뽑아 비교했다. 그런데 골든 문항의
기대값에는 **별표(예: "별표6")·별지·부칙**이 그대로 들어 있는 것이 많다. 그래서 챗봇이 별표6 을
정확히 내놓았는데도 "조문 틀림"으로 감점됐다. 표본으로 확인한 8건 중 5건이 이 경우였다.
"""
import json, re, sys, collections


def norm(s):
    return re.sub(r'[\s·ㆍ()「」]', '', s or '')


def keys(s):
    """근거줄에서 비교할 열쇠를 뽑는다 — 조문·별표·별지·부칙."""
    s = s or ''
    out = set()
    for m in re.findall(r'제\s*\d+\s*조(?:의\s*\d+)?', s):
        out.add('조' + re.sub(r'\s', '', m))
    for m in re.findall(r'별표\s*\d+(?:의\s*\d+)?', s):
        out.add('표' + re.sub(r'\s', '', m))
    for m in re.findall(r'별지\s*\d+(?:의\s*\d+)?', s):
        out.add('지' + re.sub(r'\s', '', m))
    if '부칙' in s:
        out.add('부칙')
    return out


def tier(s):
    """법령의 층(법률/시행령/시행규칙/고시)을 가른다 — 같은 제N조라도 층이 다르면 다른 조문이다."""
    s = s or ''
    if '시행규칙' in s: return '규칙'
    if '시행령' in s:  return '령'
    return '법'


def split_laws(s):
    """기대 법령 칸은 한 문항에 두 법 이상이 '·'로 묶여 오기도 한다 — 갈라서 각각 본다."""
    return [norm(x) for x in re.split(r'[·ㆍ,]', s or '') if norm(x)]


def rescore(r):
    note = str(r.get('note') or '')
    # 서버가 "내 쪽 사정으로 못 만들었다"고 알려 온 것은 감점하지 않는다(L-263).
    if '쿨다운' in note or '답변 생성 실패' in note:
        return 'skipped'
    if r['verdict'] in ('clarify', 'error', 'skipped'):
        return r['verdict']
    got = r.get('got') or []
    if not got:
        return 'no_evidence'
    want_laws = split_laws(r['expect_law'])
    want = keys(r['expect_article'])
    # 층까지 같은 줄을 먼저 찾고, 없으면 층만 다른 줄을 따로 모은다.
    same, othertier = [], []
    for g in got:
        ng = norm(g)
        for wl in want_laws:
            if wl and wl in ng:
                (same if tier(wl) == tier(g) else othertier).append(g)
                break
    if not same and not othertier:
        return 'no_evidence'
    if not want:
        return 'confirmed' if same else 'wrong_tier'
    for g in same:
        if keys(g) & want:
            return 'confirmed'
    # 조문 번호는 맞는데 층이 다른 경우 — 법 제37조 vs 시행규칙 제37조는 다른 조문이다.
    for g in othertier:
        if keys(g) & want:
            return 'wrong_tier'
    return 'wrong_article' if same else 'no_evidence'


if __name__ == '__main__':
    p = sys.argv[1]
    rows = [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
    seen = set()
    uniq = []
    for r in rows:
        k = (r['law'], r['question'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    for r in uniq:
        r['verdict2'] = rescore(r)
    json.dump(uniq, open(p.replace('.jsonl', '_rescored.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    c = collections.Counter(r['verdict2'] for r in uniq)
    n = len(uniq) - c.get('skipped', 0)
    print(f'기록 {len(uniq)}건 / 잴 수 없었던 것 {c.get("skipped", 0)}건 / 유효 {n}건')
    for k in ['confirmed', 'wrong_tier', 'wrong_article', 'no_evidence', 'clarify', 'error']:
        v = c.get(k, 0)
        print(f'  {k:14s} {v:4d}  ({round(v * 100 / n, 1) if n else 0}%)')
    d = collections.Counter((r['verdict'], r['verdict2']) for r in uniq if r['verdict'] != r['verdict2'])
    if d:
        print('\n[첫 채점 대비 바뀐 것]')
        for (a, b), v in d.most_common():
            print(f'  {a} → {b}: {v}건')
