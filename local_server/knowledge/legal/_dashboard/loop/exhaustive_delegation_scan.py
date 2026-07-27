#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""H-28 전수조사: 73법 전체 조문의 위임체인을 lsDelegated API로 전수 대조해 collection_hole을
   감사(질문 시뮬레이션)에 의존하지 않고 baseline으로 확정한다. 순수 API 호출+로컬파일 대조만
   수행하는 로직 전용 1차 패스(AI 미사용) — 애매한 잔여만 사람/AI 2차 검토 대상으로 남긴다.
   [연계] 입력 _meta.json(법률/시행령/시행규칙 MST)·raw/.../행정규칙/_admrul.json
         출력 _dashboard/delegation_scan_result.json(법별 상세)·_dashboard/delegation_scan_report.md(요약)
   [로드 순서] 단독 실행(python3 exhaustive_delegation_scan.py). Workflow/Agent 불필요."""
import json, os, re, time, urllib.request

OC = 'hyoo1431'
LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

STRUCTURAL_PATTERNS = [
    (r'관보에?\s*고시', '관보 고시'),
    (r'(지방자치단체|시\s*[·ㆍ]?\s*도|시장\s*[·ㆍ]?\s*군수\s*[·ㆍ]?\s*구청장).{0,15}조례', '지자체 조례'),
    (r'총회', '국제기구/단체 총회 내부규칙'),
    (r'협약|조약', '국제협약/조약'),
]
NOTICE_PATTERNS = [
    r'정하여\s*고시한다', r'고시하는\s*바에\s*따', r'고시한다', r'훈령으로\s*정한다', r'예규로\s*정한다',
]


def api(url, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.5)
    return None


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def s(x):
    if x is None:
        return ''
    if isinstance(x, list):
        return '\n'.join(s(i) for i in x)
    return str(x)


def build_raw_law_registry(legal_root, all_73_slugs):
    """raw/에 이미 수집된 모든 법(73법 본체 + 15_관련타부처 인용 타법)의 정규화된 이름 집합을 만든다.
    인용법령(위임구분=인용법령) 대상이 실제로 raw에 있는지 대조하는 데 쓴다."""
    names = set(all_73_slugs)
    other = os.path.join(legal_root, 'raw', '15_관련타부처')
    if os.path.isdir(other):
        for d in os.listdir(other):
            if os.path.isdir(os.path.join(other, d)):
                names.add(d)
    return names


def normalize_law_name(name):
    return re.sub(r'\s+', '', name or '')


def load_admrul_ids(law_raw_dir):
    path = os.path.join(law_raw_dir, '행정규칙', '_admrul.json')
    ids = set()
    if os.path.exists(path):
        try:
            d = json.load(open(path, encoding='utf-8'))
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, dict) and v.get('ID'):
                        ids.add(str(v['ID']))
        except Exception:
            pass
    return ids


def scan_delegation(mst):
    """이 MST의 위임조문정보 전체를 걷어 (조문번호, 위임구분, 대상ID/제목, 라인텍스트) 리스트로 반환.
    반환 status: 'ok'(위임 있음) | 'empty'(API 정상응답, 위임 0건 — 정상 상태) | 'api_fail'(네트워크/파싱 실패, 재확인 필요)."""
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=lsDelegated&type=JSON&MST={mst}")
    out = []
    if d is None:
        return out, 'api_fail'
    if not d or 'lsDelegated' not in d:
        return out, 'empty'
    try:
        units = L(d['lsDelegated']['법령']['위임조문정보'])
    except (KeyError, TypeError):
        return out, 'empty'
    for u in units:
        jo = s((u.get('조정보') or {}).get('조문번호'))
        jomok = ''
        for w in L(u.get('위임정보')):
            kinds = L(w.get('위임구분'))
            titles = L(w.get('위임법령제목'))
            ids = L(w.get('위임법령일련번호'))
            for wj in L(w.get('위임법령조문정보')):
                line = s(wj.get('라인텍스트'))
                jomok2 = s(wj.get('조항호목')) or jomok
                for idx, kind in enumerate(kinds or ['']):
                    out.append({
                        '조문번호': jo,
                        '조항호목': jomok2,
                        '위임구분': kind,
                        '대상제목': titles[idx] if idx < len(titles) else (titles[0] if titles else ''),
                        '대상ID': ids[idx] if idx < len(ids) else (ids[0] if ids else ''),
                        '라인텍스트': line,
                    })
    return out, 'ok'


def classify_structural(text):
    for pat, label in STRUCTURAL_PATTERNS:
        if re.search(pat, text):
            return label
    return None


def notice_delegation_in_text(text):
    for pat in NOTICE_PATTERNS:
        if re.search(pat, text):
            return True
    return False


def scan_raw_text_for_notice_clauses(law_raw_dir, family_files):
    """raw 원문(법률.txt/시행령.txt/시행규칙.txt)에서 '~고시한다'류 위임 문구가 있는 조문번호를 찾는다."""
    found = []
    for fname in family_files:
        path = os.path.join(law_raw_dir, fname)
        if not os.path.exists(path):
            continue
        try:
            content = open(path, encoding='utf-8').read()
        except Exception:
            continue
        for m in re.finditer(r'제(\d+)조(?:의(\d+))?[^\n]{0,400}', content):
            article_text = m.group(0)
            if notice_delegation_in_text(article_text):
                jo = m.group(1) + (('의' + m.group(2)) if m.group(2) else '')
                found.append({'파일': fname, '조문번호': jo, '문맥': article_text[:200]})
    return found


def main():
    data = json.load(open(os.path.join(LEGAL, '_dashboard/loop/build_data.json'), encoding='utf-8'))
    laws = data['all']
    raw_registry = build_raw_law_registry(LEGAL, {l['slug'] for l in laws})
    result = []
    for i, law in enumerate(laws):
        name, slug, raw_dir = law['name'], law['slug'], law['raw']
        meta_path = os.path.join(raw_dir, '_meta.json')
        if not os.path.exists(meta_path):
            result.append({'law': name, 'slug': slug, 'error': 'no _meta.json'})
            continue
        meta = json.load(open(meta_path, encoding='utf-8'))
        families = meta.get('families', {})
        admrul_ids = load_admrul_ids(raw_dir)

        delegations = []
        api_status = {}
        for fam, info in families.items():
            mst = info.get('MST')
            if not mst:
                continue
            entries, status = scan_delegation(mst)
            api_status[fam] = status
            for e in entries:
                e['출처계층'] = fam
                delegations.append(e)
            time.sleep(0.3)

        uncollected = []
        structural = []
        seen_ids = set()
        for e in delegations:
            if e['위임구분'] == '위임행정규칙' and e['대상ID']:
                aid = str(e['대상ID'])
                if aid in seen_ids:
                    continue
                seen_ids.add(aid)
                if aid not in admrul_ids:
                    uncollected.append(e)
            struct_label = classify_structural(e.get('라인텍스트', ''))
            if struct_label:
                structural.append({**e, '구조유형': struct_label})

        family_files = [v.get('파일', '').replace('.json', '.txt') for v in families.values()]
        notice_clauses = scan_raw_text_for_notice_clauses(raw_dir, family_files)
        delegated_articles = {e['조문번호'] for e in delegations if e['위임구분'] == '위임행정규칙'}
        genuine_candidates = [n for n in notice_clauses if n['조문번호'] not in delegated_articles]

        # 인용법령(타법 인용) 중 raw에 그 법 자체가 없는 경우 — 별도 유형(uncollected_sibling)
        cited_uncollected = []
        seen_cited = set()
        for e in delegations:
            if e['위임구분'] == '인용법령' and e['대상제목']:
                norm = normalize_law_name(e['대상제목'])
                if norm in seen_cited or norm == slug:
                    continue
                seen_cited.add(norm)
                if norm not in raw_registry:
                    cited_uncollected.append(e)

        result.append({
            'law': name, 'slug': slug,
            'api_status': api_status,
            'total_delegation_points': len(delegations),
            'uncollected_c_candidates': uncollected,
            'structural_b_candidates': structural,
            'genuine_a_candidates': genuine_candidates,
            'cited_law_uncollected_candidates': cited_uncollected,
        })
        print(f"[{i+1}/{len(laws)}] {name}: 위임{len(delegations)}건 / uncollected후보{len(uncollected)} / structural후보{len(structural)} / genuine후보{len(genuine_candidates)} / 인용타법미수집{len(cited_uncollected)}")

    out_path = os.path.join(LEGAL, '_dashboard/delegation_scan_result.json')
    json.dump(result, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"\n완료: {out_path}")


if __name__ == '__main__':
    main()
