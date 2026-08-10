#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zone_tree.json 독립 재대조 검증기 (설계 §6).

역할(초보자용):
  빌더(build_zone_tree.py)가 만든 트리를 **빌더 로직을 하나도 쓰지 않고** 다시 검사한다.
  빌더가 조문을 딕셔너리로 쪼개 인용문을 뽑았다면, 이쪽은 파일 전체를 통짜 문자열로 읽어
  ①인용문이 그 파일에 실제로 있는지 ②그 인용문이 정말 그 조(條)의 범위 안에 있는지
  ③법령ID가 _meta.json과 맞는지를 각각 따로 확인한다. 구조(질문·선택지·id·요약 수치)도
  JSON만 보고 다시 센다.

  같은 코드를 재사용하면 같은 착각을 공유하므로(서류 트리에서 실제로 그랬다), 일부러
  다른 방식으로 짰다.

[연계]
  읽기: _dashboard/zone_tree.json · raw/**/*.txt · raw/**/_meta.json
  설계: _dashboard/H32_zone_tree_design.md §6

실행: python3 local_server/knowledge/legal/_dashboard/loop/verify_zone_tree.py
      (실패가 있으면 종료코드 1)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
TREE = os.path.join(DASH, 'zone_tree.json')

FAIL = []
CHECKED = {'quote': 0, 'article_span': 0, 'lawid': 0, 'struct': 0}


def norm(s):
    """인용문 비교용 정규화 — 공백 접기 + 이미지 태그 제거(빌더의 `flatten`과 같은 규칙이지만
    이 파일이 스스로 다시 구현한다. 규칙 자체가 틀렸다면 두 구현 모두 틀리므로, 이 정규화가
    무엇을 하는지 설계문서 §2.3에 명시해 두었다)."""
    return re.sub(r'\s+', ' ', re.sub(r'<img[^>]*>|</img>', ' ', s)).strip()


def article_span(flat_text, article):
    """파일 통짜 문자열에서 `[제N조]`(가지번호 포함) 헤더의 시작~다음 헤더 시작 구간을 돌려준다.
    빌더처럼 줄 단위로 쪼개 딕셔너리를 만들지 않고, 헤더 위치만 훑는 방식이다."""
    heads = [(m.start(), m.group(1)) for m in re.finditer(r'\[(제\d+조(?:의\d+)?)\]', flat_text)]
    for idx, (pos, name) in enumerate(heads):
        if name == article:
            end = heads[idx + 1][0] if idx + 1 < len(heads) else len(flat_text)
            return pos, end
    return None


def check_source(kind, node_id, label, law_slug, tier, article, quote, law_id, path):
    """인용 1건을 raw 원문과 재대조한다."""
    full = os.path.join(LEGAL, path)
    if not os.path.exists(full):
        FAIL.append('%s %s / %s — 파일 없음: %s' % (kind, node_id, label, path))
        return
    flat = norm(open(full, encoding='utf-8', errors='replace').read())
    q = quote[2:].strip() if quote.startswith('…') else quote
    CHECKED['quote'] += 1
    at = flat.find(q)
    if at < 0:
        FAIL.append('%s %s / %s — 인용문이 raw 파일에 없음 (%s %s %s)'
                    % (kind, node_id, label, law_slug, tier, article))
        return
    CHECKED['article_span'] += 1
    base = re.sub(r'제(\d+)조(?:의(\d+))?.*$', lambda m: '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else ''),
                  article)
    span = article_span(flat, base)
    if span is None:
        FAIL.append('%s %s / %s — 조문 헤더를 찾지 못함: %s %s'
                    % (kind, node_id, label, tier, base))
    elif not (span[0] <= at < span[1]):
        FAIL.append('%s %s / %s — 인용문이 %s 범위 밖에 있음(다른 조의 문장을 인용했을 수 있음)'
                    % (kind, node_id, label, base))
    # 법령ID 재대조
    CHECKED['lawid'] += 1
    meta = os.path.join(os.path.dirname(full), '_meta.json')
    if not os.path.exists(meta):
        FAIL.append('%s %s / %s — _meta.json 없음' % (kind, node_id, label))
        return
    fam = json.load(open(meta, encoding='utf-8')).get('families', {}).get(tier)
    if isinstance(fam, list):
        fam = fam[0] if fam else None
    got = (fam or {}).get('법령ID')
    if got != law_id:
        FAIL.append('%s %s / %s — 법령ID 불일치: 트리 %s ≠ _meta %s'
                    % (kind, node_id, label, law_id, got))


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def main():
    d = json.load(open(TREE, encoding='utf-8'))
    ids, nodes, rules, leaves = [], [], [], []
    for t in d['trees']:
        tree_nodes = list(walk(t['tree']))
        nodes += tree_nodes
        titles = {r['제목'] for n in tree_nodes for r in n.get('적용', [])}
        for n in tree_nodes:
            ids.append(n['id'])
            if not n.get('children'):
                leaves.append(n)
            # ── 출처 재대조
            for p in n.get('provenance', []):
                check_source('노드출처', n['id'], p['조문'], p['법령_slug'], p['계층'],
                             p['조문'], p['인용'], p.get('법령ID'), p['파일'])
            for p in (n.get('포함근거', {}) or {}).get('근거', []):
                check_source('포함근거', n['id'], p['조문'], p['법령_slug'], p['계층'],
                             p['조문'], p['인용'], p.get('법령ID'), p['파일'])
            # ── payload 재대조
            for r in n.get('적용', []):
                rules.append(r)
                check_source('적용', n['id'], r['제목'], r['근거법령_slug'], r['계층'],
                             r['근거조문'], r['인용'], r.get('법령ID'), r['파일'])
                CHECKED['struct'] += 1
                if r['유형'] not in ('적용법령', '의무', '제한', '허가·신고', '완화', '관할', '처벌'):
                    FAIL.append('적용 %s / %s — 알 수 없는 유형: %s' % (n['id'], r['제목'], r['유형']))
                if r['구역범위'] not in ('이 구역만', '이 구역 이상', '이 구역 이하'):
                    FAIL.append('적용 %s / %s — 알 수 없는 구역범위: %s' % (n['id'], r['제목'], r['구역범위']))
                if r['구역범위'] != '이 구역만' and t['id'] != 'navigation_zone':
                    FAIL.append('적용 %s / %s — 서열 없는 트리에서 구역범위 사용' % (n['id'], r['제목']))
            # ── 구조 검사
            CHECKED['struct'] += 1
            for ax in n.get('추가확인', []):
                if not ax.get('질문') or not ax.get('선택지'):
                    FAIL.append('노드 %s — 추가확인(%s)에 질문/선택지가 없음' % (n['id'], ax.get('축')))
                for title in ax.get('영향', []):
                    if title not in titles:
                        FAIL.append('노드 %s — 추가확인(%s) 영향이 실재하지 않는 항목을 가리킴: %s'
                                    % (n['id'], ax.get('축'), title))
            kid_ids = [c['id'] for c in n.get('children', [])]
            if kid_ids:
                if not n.get('질문') or not n.get('선택지'):
                    FAIL.append('노드 %s — 비-리프인데 질문/선택지가 없음' % n['id'])
                else:
                    if len(n['선택지']) != len(kid_ids):
                        FAIL.append('노드 %s — 선택지 수(%d) ≠ 자식 수(%d)'
                                    % (n['id'], len(n['선택지']), len(kid_ids)))
                    if len(n['선택지']) > 3:
                        FAIL.append('노드 %s — 선택지가 3개를 넘음(CLARIFY_OPTION_MAX 위반)' % n['id'])
                    for o in n['선택지']:
                        if o.get('next') not in kid_ids:
                            FAIL.append('노드 %s — 선택지 next(%s)가 자식이 아님' % (n['id'], o.get('next')))
                        if not o.get('label') or not o.get('hint'):
                            FAIL.append('노드 %s — 선택지에 label/hint가 없음' % n['id'])
                if n.get('추가확인'):
                    FAIL.append('노드 %s — 비-리프에 추가확인이 붙음' % n['id'])
            else:
                if n.get('질문') or n.get('선택지'):
                    FAIL.append('노드 %s — 리프에 질문/선택지가 붙음' % n['id'])
            if t['id'] == 'navigation_zone' and n['id'] != t['tree']['id'] and '서열' not in n:
                FAIL.append('노드 %s — 항해구역 트리인데 서열이 없음' % n['id'])

    if len(set(ids)) != len(ids):
        dup = [i for i in set(ids) if ids.count(i) > 1]
        FAIL.append('id 중복: %s' % dup)

    # ── 요약 수치 재계산(빌더가 적은 값을 그대로 믿지 않는다)
    s = d['summary']
    for key, got in (('nodes', len(nodes)), ('leaves', len(leaves)),
                     ('rule_entries', len(rules)), ('trees', len(d['trees']))):
        if s.get(key) != got:
            FAIL.append('summary.%s 불일치: 기록 %s ≠ 실제 %s' % (key, s.get(key), got))
    laws = {r['근거법령_slug'] for r in rules}
    if s.get('laws_contributing_to_trees') != len(laws):
        FAIL.append('summary.laws_contributing_to_trees 불일치: 기록 %s ≠ 실제 %s'
                    % (s.get('laws_contributing_to_trees'), len(laws)))
    # 스캔 파일 수 독립 재계수
    def flat_laws(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat_laws(os.path.join(HERE, 'audit12_groups.json'))
    run = flat_laws(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    all_laws = base + [x for x in run if x['slug'] not in slugs]
    files = 0
    for law in all_laws:
        for root, _dirs, fs in os.walk(law['raw']):
            if os.path.basename(root) not in ('별표', '_이미지'):
                files += sum(1 for f in fs if f.endswith('.txt')
                             and os.path.basename(root) in (os.path.basename(law['raw']), '행정규칙'))
    if s.get('laws_in_scope') != len(all_laws):
        FAIL.append('summary.laws_in_scope 불일치: 기록 %s ≠ 실제 %s' % (s.get('laws_in_scope'), len(all_laws)))
    if s.get('files_scanned') != files:
        FAIL.append('summary.files_scanned 불일치: 기록 %s ≠ 실제 %s' % (s.get('files_scanned'), files))

    print('재대조: 인용 %d건 · 조문범위 %d건 · 법령ID %d건 · 구조검사 %d건 (법 %d · 파일 %d)'
          % (CHECKED['quote'], CHECKED['article_span'], CHECKED['lawid'], CHECKED['struct'],
             len(all_laws), files))
    if FAIL:
        print('실패 %d건:' % len(FAIL))
        for f in FAIL:
            print('  -', f)
        sys.exit(1)
    print('실패 0건 — 트리의 모든 노드·항목이 raw 원문과 일치.')


if __name__ == '__main__':
    main()
