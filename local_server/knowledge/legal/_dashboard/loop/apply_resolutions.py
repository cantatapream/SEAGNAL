#!/usr/bin/env python3
# apply_resolutions.py — review_resolve 판정을 **단독(직렬)** 적용. (공유파일 쓰기는 여기 한 곳에서만 = ⚠경합없음)
# 역할(초보자용): 리졸버가 낸 판정(resolved/needs_collect/human)을 실제로 반영한다.
#   resolved → 리뷰큐에 [x]자동확정 표시 + 대상 wiki 페이지 canonical 승격(+값정정 각인).
#   needs_collect → 수집큐(collect_queue.json)에 적재(다음 수집 트랙). human → 그대로 둠.
# 입력: scratchpad/pending_reviews.json(idx→엔트리), scratchpad/resolve_decisions.json(판정)
# 출력: review_queue.md(승인표시), wiki/concepts/*.md(승격), collect_queue.json(적재)
import json, os, re

LEGAL = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DASH = os.path.join(LEGAL, '_dashboard')
QUEUE = os.path.join(DASH, 'review_queue.md')
CONCEPTS = os.path.join(LEGAL, 'wiki', 'concepts')
COLLECTQ = os.path.join(DASH, 'collect_queue.json')
SP = '/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
DATE = '2026-07-20'

pending = json.load(open(f'{SP}/pending_reviews.json', encoding='utf-8'))
decisions = json.load(open(f'{SP}/resolve_decisions.json', encoding='utf-8'))
by_idx = {e['idx']: e for e in pending}
dec_by_idx = {d['idx']: d for d in decisions if 'idx' in d}

def page_path(tp, last_slug):
    """targetPage 문자열 → (concept 파일 절대경로 or None, new_slug). 서버 applyToWikiPages와 동일 규칙."""
    base = tp.strip()
    base = re.sub(r'^wiki/concepts/', '', base)
    if '(신규)' in tp or '신규' in tp:      # 신규 페이지 요청은 승격 대상 아님(존재 안 함)
        return (None, last_slug)
    m = re.search(r'([^\s]+?\.md)', base)     # 파일명(.md까지) 추출, 뒤 주석 절단
    if not m:
        return (None, last_slug)
    fn = m.group(1)
    if fn.startswith('__') and last_slug:     # 약칭/후속 페이지: 앞 페이지의 법 slug 상속
        fn = last_slug + fn
    new_slug = fn.split('__')[0] if '__' in fn else last_slug
    full = os.path.normpath(os.path.join(CONCEPTS, fn))
    if not (full == CONCEPTS or full.startswith(CONCEPTS + os.sep)):  # 경로이탈 차단
        return (None, new_slug)
    return (full, new_slug)

def promote(full, evidence, corrected):
    """draft/review → canonical + 각인. 이미 canonical이면 skip. @returns 'promoted'|'already'|'missing'"""
    if not full or not os.path.isfile(full):
        return 'missing'
    txt = open(full, encoding='utf-8').read()
    sm = re.search(r'^status:\s*(\S+)', txt, re.M)
    cur = sm.group(1).strip() if sm else 'draft'
    if cur == 'canonical':
        return 'already'
    if sm:
        txt = txt[:sm.start()] + 'status: canonical' + txt[sm.end():]
    stamp = f'\n> AI 자동확정(재검증 원문대조, {DATE}): 근거 확인'
    if corrected:
        stamp += f' · 확정값 정정: {corrected}'
    stamp += '\n'
    if stamp.strip() not in txt:
        txt = txt.rstrip() + '\n' + stamp
    tmp = full + '.tmp'; open(tmp, 'w', encoding='utf-8').write(txt); os.replace(tmp, full)
    return 'promoted'

# ── 1) review_queue.md 재파싱(순서) → pending idx별 라인범위 ──
lines = open(QUEUE, encoding='utf-8').read().split('\n')
# 엔트리 시작줄 인덱스
starts = [i for i, ln in enumerate(lines) if re.match(r'^###\s+REVIEW-', ln)]
starts.append(len(lines))
pending_pos = 0; idx2range = {}
for k in range(len(starts) - 1):
    s, e = starts[k], starts[k + 1]
    block = lines[s:e]
    approved = any(re.match(r'^-\s*승인:\s*\[[xX]\]', b) for b in block)
    if not approved:
        idx2range[pending_pos] = (s, e); pending_pos += 1

# ── 2) resolved 적용: 큐 승인표시 + wiki 승격 ──
promoted_pages = 0; already = 0; missing = 0; marked = 0
collectq = []
report = {'resolved': [], 'needs_collect': [], 'human': 0}
for idx, d in dec_by_idx.items():
    v = d.get('verdict')
    ent = by_idx.get(idx, {})
    if v == 'resolved':
        # 큐 승인 라인 교체
        rng = idx2range.get(idx)
        if rng:
            s, e = rng
            for i in range(s, e):
                if re.match(r'^-\s*승인:\s*\[ \]', lines[i]):
                    cv = d.get('corrected_value') or ''
                    lines[i] = f'- 승인: [x] AI자동확정(재검증, {DATE})' + (f' · 확정값: {cv[:60]}' if cv else '') + ' · 근거확인'
                    marked += 1; break
        # wiki 승격
        last_slug = None; pr = []
        for tp in ent.get('targetPages', []):
            full, last_slug = page_path(tp, last_slug)
            r = promote(full, d.get('evidence', ''), d.get('corrected_value'))
            pr.append(r)
            if r == 'promoted': promoted_pages += 1
            elif r == 'already': already += 1
            elif r == 'missing': missing += 1
        report['resolved'].append({'id': d.get('id'), 'pages': pr})
    elif v == 'needs_collect':
        collectq.append({'id': d.get('id'), 'target': d.get('collect_target', ''), 'from': 'review_resolve', 'date': DATE})
        report['needs_collect'].append(d.get('id'))
    else:
        report['human'] += 1

# 큐 저장(원자적)
tmp = QUEUE + '.tmp'; open(tmp, 'w', encoding='utf-8').write('\n'.join(lines)); os.replace(tmp, QUEUE)

# ── 3) needs_collect → collect_queue.json 적재(기존 보존, 중복 id 스킵) ──
existing = {'holes': []}
if os.path.exists(COLLECTQ):
    try: existing = json.load(open(COLLECTQ, encoding='utf-8'))
    except: pass
if not isinstance(existing, dict): existing = {'holes': existing if isinstance(existing, list) else []}
existing.setdefault('holes', [])
existing.setdefault('review_resolve_collect', [])
seen_ids = {x.get('id') for x in existing['review_resolve_collect'] if isinstance(x, dict)}
added = 0
for c in collectq:
    if c['id'] in seen_ids: continue
    existing['review_resolve_collect'].append(c); added += 1
tmp = COLLECTQ + '.tmp'; open(tmp, 'w', encoding='utf-8').write(json.dumps(existing, ensure_ascii=False, indent=1)); os.replace(tmp, COLLECTQ)

print(f'=== 적용 결과 ===')
print(f'resolved: {len(report["resolved"])}건 · 큐 승인표시 {marked} · wiki 승격 {promoted_pages}p (이미canonical {already} · 없음 {missing})')
print(f'needs_collect: {len(report["needs_collect"])}건 → collect_queue 신규적재 {added}')
print(f'human(유지): {report["human"]}건')
# 승격 0페이지인 resolved(신규/약칭 등) 표시
nop = [r['id'] for r in report['resolved'] if all(x != 'promoted' for x in r['pages'])]
if nop:
    print(f'⚠ 승격 페이지 0인 resolved {len(nop)}건(신규페이지·이미canonical·경로): ' + ', '.join(nop[:10]))
