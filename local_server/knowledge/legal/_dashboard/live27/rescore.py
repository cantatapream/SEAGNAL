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


# ⚠층(법률/시행령/시행규칙)을 따로 채점하려던 시도는 걷어냈다(2026-09-07).
#   골든 문항의 `expect_law` 칸은 대개 **부모 법 이름(묶음 열쇠)** 이고 층 정보가 아니다.
#   예: 「농수산물품질관리법 | 별표4」 — 그런데 이 법 법률.txt 에는 '별표' 가 0건이고
#   별표4 는 시행규칙에 있다(내용도 질문과 일치: "가. 거짓이나 그 밖의 부정한 방법 → 지정 취소").
#   즉 챗봇이 「시행규칙 별표4」라고 답한 것이 맞고 라벨이 부정확했다. 층으로 감점하면
#   챗봇이 맞은 것을 틀렸다고 세게 된다. 그래서 조문·별표 번호만 대조한다.


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
    # 기대 법령이 근거줄에 하나라도 나왔는가.
    hits = [g for g in got if any(wl and wl in norm(g) for wl in want_laws)]
    if not hits:
        return 'no_evidence'
    if not want:
        return 'confirmed'          # 기대값에 조문·별표 표기가 없으면 법만 맞으면 통과
    # 기대 근거가 여러 개인 문항이 많다(예: "제90조제2항제1호·시행령 별표2").
    # 맞음/틀림 둘로 가르지 말고 **몇 개 중 몇 개를 댔는지**로 본다.
    hit_keys = set()
    for g in hits:
        hit_keys |= keys(g)
    matched = hit_keys & want
    if not matched:
        return 'wrong_article'      # 법은 맞는데 기대한 조문·별표는 하나도 없음
    if matched == want:
        return 'confirmed'
    return 'partial'                # 일부만 댔다 — 답이 불완전할 수 있는 자리


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
    for k in ['confirmed', 'partial', 'wrong_article', 'no_evidence', 'clarify', 'error']:
        v = c.get(k, 0)
        print(f'  {k:14s} {v:4d}  ({round(v * 100 / n, 1) if n else 0}%)')
    d = collections.Counter((r['verdict'], r['verdict2']) for r in uniq if r['verdict'] != r['verdict2'])
    if d:
        print('\n[첫 채점 대비 바뀐 것]')
        for (a, b), v in d.most_common():
            print(f'  {a} → {b}: {v}건')
