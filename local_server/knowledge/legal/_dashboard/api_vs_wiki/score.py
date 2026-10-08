#!/usr/bin/env python3
"""
score.py — 세 방식(A·B·C)의 결과를 같은 잣대로 채점한다.

[채점은 AI 를 쓰지 않는다] 글자 대조만 한다(L-133: 채점자가 AI 면 라운드 간 42% 가 뒤집혔다).
[무엇을 보나] 골든 문항이 정한 「정답 근거」(법령 + 조문·별표)를 **답변 글에** 댔는가.
  B·C 에는 근거 목록(citationChain)이 없어서, 공정하게 세 방식 모두 **답변 글**로 잰다.
  A 는 참고로 근거 목록 기준 판정(live27 와 같은 방식)도 따로 적는다.
  hit        기대 법령 + 기대 조문·별표를 전부 댔다
  partial    기대 법령은 댔고 기대 조문·별표 중 일부만 댔다
  miss_art   기대 법령은 댔는데 기대 조문·별표를 하나도 안 댔다
  miss       기대 법령 자체를 안 댔다
  clarify    (A) 되묻기 10회를 이어가도 답을 못 받았다
  no_answer  답이 비었다(빈손)
  skipped    **잴 수 없었다** — AI 한도·키 오류·호출 실패. 감점하지 않고 분모에서 뺀다(L-263:
             이걸 실패로 셌다가 통과율을 26% 로 잘못 계산했다)
[이 자가 못 재는 것] 답의 **사실 정확성**(숫자·요건이 원문과 맞는가)은 안 잰다 — 결과 파일의
  answer 를 사람이(또는 원문 대조로) 따로 본다. 「조문을 댔다」 ≠ 「답이 맞다」.
[가격] 토큰 단가는 legal_retriever.js ANSWER_MODEL 주석에 적힌 값(gemini-2.5-flash 입력 $0.30·
  출력 $2.50 / 100만 토큰, 2026-07-30 기록)을 쓴다. 지금 단가와 다를 수 있다.
사용: python3 score.py <결과폴더>   (a.jsonl·b.jsonl·c.jsonl 중 있는 것만)
"""
import json, os, re, sys, collections

PRICE_IN, PRICE_OUT = 0.30, 2.50


def norm(s):
    return re.sub(r'[\s·ㆍ「」『』()（）"\'“”‘’,.]', '', s or '')


def root_law(expect_law):
    """기대 법령 칸에서 대표 법령 이름 하나. 예: '「신항만건설촉진법」·「… 시행령」' → '신항만건설촉진법'."""
    s = re.sub(r'^[「『]', '', (expect_law or '').strip())
    s = re.split(r'[」』·,]|\s\(', s)[0]
    s = re.sub(r'\s*(시행령|시행규칙)$', '', s.strip())
    return norm(s)


def tokens(expect_article):
    """기대 조문·별표 토큰. 예: '제90조제2항제1호·시행령 별표2' → ['제90조', '별표2']."""
    t = re.findall(r'제\d+조(?:의\d+)?|별표\s*\d+(?:의\d+)?', expect_article or '')
    return sorted({norm(x) for x in t})


UNMEASURABLE = ('쿨다운', '답변 생성 실패', 'quota', 'rate limit', '429', 'RESOURCE_EXHAUSTED', 'API key not valid', '일시적 오류')


def judge(r):
    """결과 한 줄의 판정. 잴 수 없었던 것(skipped)·되묻기에 갇힌 것(clarify)을 먼저 가른다."""
    if not r.get('answer', '').strip():
        why = str(r.get('error') or '') + ' ' + str(r.get('note') or '')
        if any(t in why for t in UNMEASURABLE):
            return 'skipped'
        if r.get('clarify_left'):
            return 'clarify'
    return verdict(r.get('answer', ''), r)


def verdict(text, rec):
    if not text.strip():
        return 'no_answer'
    n = norm(text)
    if root_law(rec['expect_law']) not in n:
        return 'miss'
    want = tokens(rec['expect_article'])
    if not want:
        return 'hit'
    got = [w for w in want if w in n]
    return 'hit' if len(got) == len(want) else 'partial' if got else 'miss_art'


def load(p):
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()] if os.path.exists(p) else []


def main(d):
    order = ['hit', 'partial', 'miss_art', 'miss', 'clarify', 'no_answer', 'skipped']
    print(f'결과 폴더: {d}\n')
    for arm, label in (('a', 'A 지금 챗봇(위키)'), ('b', 'B 원문 직독(모아 둔 원문)'), ('c', 'C 법제처 API 만')):
        recs = load(os.path.join(d, f'{arm}.jsonl'))
        if not recs:
            continue
        vs = []
        for r in recs:
            v = judge(r)
            r['_v'] = v
            vs.append(v)
        c = collections.Counter(vs)
        n = len(recs)
        m = max(1, n - c.get('skipped', 0))   # 잰 문항 수(분모)
        sec = sum(r.get('sec', 0) for r in recs) / n
        tin = sum((r.get('tokens') or {}).get('in', 0) for r in recs) / n
        tout = sum((r.get('tokens') or {}).get('out', 0) for r in recs) / n
        cost = (tin * PRICE_IN + tout * PRICE_OUT) / 1e6
        print(f'■ {label} — {n}문항')
        print('  답변 글 기준: ' + ' · '.join(f'{k} {c.get(k, 0)}' for k in order))
        print(f'  hit 비율 {c.get("hit", 0) / m:.0%} (hit+partial {(c.get("hit", 0) + c.get("partial", 0)) / m:.0%}) — 잰 {n - c.get("skipped", 0)}문항 기준')
        print(f'  평균 {sec:.1f}초 · 평균 토큰 입력 {tin:,.0f} / 출력 {tout:,.0f} · 문항당 약 ${cost:.4f}')
        if arm == 'a':
            ch = collections.Counter('hit' if verdict(' '.join(r.get('chain') or []), r) == 'hit' else 'other' for r in recs)
            print(f'  (참고) 근거 목록 기준 hit {ch.get("hit", 0)}/{n} · 되묻기 평균 {sum(r.get("clarify_rounds", 0) for r in recs) / n:.1f}회')
        if arm == 'c':
            calls = sum((r.get('api') or {}).get('calls', 0) for r in recs) / n
            fails = sum((r.get('api') or {}).get('failures', 0) for r in recs)
            retr = sum((r.get('api') or {}).get('retries', 0) for r in recs)
            steps = sum(len(r.get('steps') or []) for r in recs) / n
            print(f'  법제처 API 호출 평균 {calls:.1f}회 · 도구 사용 평균 {steps:.1f}회 · 재시도 {retr}회 · 끝내 실패 {fails}회')
        by = collections.defaultdict(collections.Counter)
        for r in recs:
            by[r['layer']][r['_v']] += 1
        print('  층별 hit: ' + ' · '.join(f'{k} {v.get("hit", 0)}/{sum(v.values())}' for k, v in by.items()))
        errs = [r for r in recs if r.get('error')]
        if errs:
            print(f'  ⚠오류 {len(errs)}건: ' + '; '.join(f'{r["id"]} {r["error"][:60]}' for r in errs[:5]))
        print()
    # 문항별 나란히
    rows = collections.defaultdict(dict)
    for arm in 'abc':
        for r in load(os.path.join(d, f'{arm}.jsonl')):
            rows[r['id']][arm] = judge(r)
    print('문항별(A / B / C):')
    for k in sorted(rows):
        print(f'  {k:10s} ' + ' / '.join(rows[k].get(a, '-') for a in 'abc'))


if __name__ == '__main__':
    main(sys.argv[1])
