#!/usr/bin/env python3
# merge_review_gen.py — review_gen/*.md 법별 partial 카드를 공유 review_queue.md에 **단독(직렬)** 병합.
# 역할(초보자용): 여러 에이전트가 각자 만든 제안값 카드(partial)를, 사람 한 명(=이 스크립트)이 한 번에
#   공유 리뷰큐에 합친다. 이렇게 해야 공유파일 동시쓰기 경합이 없다(⚠경합위험 규칙).
# 동작: 이미 있는 id는 건너뛴다(멱등). 새 카드만 append. 그 외 기존 내용 무손실.
# [연계] 입력 _dashboard/review_gen/*.md · 출력 _dashboard/review_queue.md (append) · stdout 요약
import os, re, sys

LEGAL = os.path.join(os.path.dirname(__file__), '..', '..')
DASH = os.path.join(LEGAL, '_dashboard')
GEN_DIR = os.path.join(DASH, 'review_gen')
QUEUE = os.path.join(DASH, 'review_queue.md')

HEADER_RE = re.compile(r'^###\s+(REVIEW-.+?):', re.M)

def entries(text):
    """### REVIEW-... 헤더로 텍스트를 (id, block) 리스트로 자른다."""
    out = []
    idxs = [(m.start(), m.group(1)) for m in HEADER_RE.finditer(text)]
    for i, (pos, rid) in enumerate(idxs):
        end = idxs[i + 1][0] if i + 1 < len(idxs) else len(text)
        out.append((rid, text[pos:end].rstrip() + '\n'))
    return out

def main():
    q = open(QUEUE, encoding='utf-8').read() if os.path.exists(QUEUE) else ''
    existing = {rid for rid, _ in entries(q)}
    added, skipped, files = [], 0, 0
    blocks = []
    for fn in sorted(os.listdir(GEN_DIR)):
        if not fn.endswith('.md'):
            continue
        files += 1
        txt = open(os.path.join(GEN_DIR, fn), encoding='utf-8').read()
        for rid, block in entries(txt):
            if rid in existing:
                skipped += 1
                continue
            existing.add(rid)
            added.append(rid)
            blocks.append(block)
    if blocks:
        sep = '' if q.endswith('\n\n') or q == '' else ('\n' if q.endswith('\n') else '\n\n')
        new = q + sep + '\n'.join(blocks)
        # 원자적 쓰기(임시파일 → rename)
        tmp = QUEUE + '.tmp'
        open(tmp, 'w', encoding='utf-8').write(new)
        os.replace(tmp, QUEUE)
    print(f'partial파일 {files}개 · 신규 {len(added)}카드 병합 · 중복 {skipped}건 스킵')
    for rid in added:
        print('  +', rid)

if __name__ == '__main__':
    main()
