#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""H-33 조문-위키 커버리지 전수조사: 각 법의 raw 원문 전체 조문 목록과, 위키(statutes+concepts)가
   실제로 인용한 조문 목록을 대조해 "위키에 한 번도 인용 안 된 조문"을 기계적으로 찾아낸다.
   감사(질문 시뮬레이션)가 우연히 못 물어봐서 놓친 thin/missing 사각지대를 없애는 보완 장치 —
   H-28(raw 수집완결성)과 같은 원리를 wiki 반영완결성에 적용한 것. AI 미사용, 순수 텍스트 대조.
   [연계] 입력 build_data.json(법 목록)·raw/<law>/{법률,시행령,시행규칙}.txt·wiki/statutes,concepts
         출력 _dashboard/coverage/<slug>.json(법별 상세)·_dashboard/coverage_report.md(요약)
   [로드 순서] 단독 실행(python3 lint_coverage.py). lint_xref→lint_full→lint_index→lint_build 다음
              단계로 기존 lint 체인 끝에 편입(H-33)."""
import json, os, re, glob

LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
WIKI = f'{LEGAL}/wiki'
DASH = f'{LEGAL}/_dashboard'
COVDIR = f'{DASH}/coverage'

FAMILY_BY_FILE = {'법률.txt': '법률', '시행령.txt': '시행령', '시행규칙.txt': '시행규칙'}

ARTICLE_HEADER_RE = re.compile(r'\[제(\d+조(?:의\d+)?)\]')
# 위키 인용: "시행령 제N조" / "시행규칙 제N조" 처럼 가족 접두어가 붙었으면 그 가족, 없으면 법률로 간주.
CITATION_RE = re.compile(r'(시행령|시행규칙)?\s*제(\d+조(?:의\d+)?)')


def extract_raw_articles(path):
    """raw 텍스트 파일에서 [제N조]/[제N조의M] 헤더로 조문번호 집합을 뽑는다."""
    if not os.path.exists(path):
        return set()
    try:
        text = open(path, encoding='utf-8').read()
    except Exception:
        return set()
    return set(ARTICLE_HEADER_RE.findall(text))


def extract_wiki_citations(paths):
    """위키 md 파일들에서 가족별 인용 조문번호 집합을 뽑는다. 반환: {'법률': set, '시행령': set, '시행규칙': set}"""
    out = {'법률': set(), '시행령': set(), '시행규칙': set()}
    for p in paths:
        try:
            text = open(p, encoding='utf-8').read()
        except Exception:
            continue
        for fam, jo in CITATION_RE.findall(text):
            key = fam if fam else '법률'
            out[key].add(jo)
    return out


def find_wiki_files(slug):
    pats = [
        f'{WIKI}/statutes/{slug}.md',
        f'{WIKI}/concepts/{slug}__*.md',
    ]
    files = []
    for pat in pats:
        files.extend(glob.glob(pat))
    return files


def main():
    data = json.load(open(f'{os.path.dirname(__file__)}/build_data.json', encoding='utf-8'))
    laws = data['all']
    os.makedirs(COVDIR, exist_ok=True)

    summary = []
    for law in laws:
        slug, raw_dir, txt_files = law['slug'], law['raw'], law.get('txt', [])
        wiki_files = find_wiki_files(slug)
        if not wiki_files:
            summary.append({'law': law['name'], 'slug': slug, 'skip': 'no_wiki_files'})
            continue

        cited = extract_wiki_citations(wiki_files)
        per_family = {}
        total_raw = 0
        total_uncited = 0
        uncited_detail = {}
        for fname in txt_files:
            fam = FAMILY_BY_FILE.get(fname)
            if not fam:
                continue
            raw_articles = extract_raw_articles(os.path.join(raw_dir, fname))
            if not raw_articles:
                continue
            uncited = sorted(raw_articles - cited.get(fam, set()),
                              key=lambda x: (int(re.match(r'\d+', x).group()), x))
            per_family[fam] = {'raw_count': len(raw_articles), 'uncited_count': len(uncited)}
            uncited_detail[fam] = uncited
            total_raw += len(raw_articles)
            total_uncited += len(uncited)

        result = {
            'law': law['name'], 'slug': slug,
            'total_raw_articles': total_raw,
            'total_uncited': total_uncited,
            'coverage_pct': round(100 * (total_raw - total_uncited) / total_raw, 1) if total_raw else None,
            'per_family': per_family,
            'uncited_articles': uncited_detail,
        }
        json.dump(result, open(f'{COVDIR}/{slug}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        summary.append(result)
        print(f"{law['name']}: raw {total_raw}개 조문 중 {total_uncited}개 위키 미인용 (커버리지 {result['coverage_pct']}%)")

    # 요약 리포트: 미인용 건수 많은 순
    scored = [s for s in summary if s.get('total_raw_articles')]
    scored.sort(key=lambda s: -s['total_uncited'])
    lines = ['# H-33 조문-위키 커버리지 전수조사 — 요약 리포트', '',
             '각 법의 raw 원문(법률·시행령·시행규칙) 전체 조문 중, 위키(statutes+concepts)가 '
             '단 한 번도 인용하지 않은 조문 수. **주의: 이건 "0번 인용" 후보 목록이지, 확정된 gap이 아니다** — '
             '조문이 이미 다른 조문에 통합 서술됐거나(예: 정의조문 전체를 표로 옮김), 부칙·경과규정처럼 '
             '위키 반영이 애초에 불필요한 경우도 섞여 있다. 3차패스에서 사람/AI가 이 후보를 하나씩 실제로 '
             '판단해야 한다(H-33 원 취지).', '',
             '| 법 | 전체 조문 | 미인용 | 커버리지 |', '|---|---|---|---|']
    for s in scored[:40]:
        lines.append(f"| {s['law']} | {s['total_raw_articles']} | {s['total_uncited']} | {s['coverage_pct']}% |")
    open(f'{DASH}/coverage_report.md', 'w', encoding='utf-8').write('\n'.join(lines))
    print(f"\n완료: {COVDIR}/*.json + {DASH}/coverage_report.md")


if __name__ == '__main__':
    main()
