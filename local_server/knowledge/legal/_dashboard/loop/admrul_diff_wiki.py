#!/usr/bin/env python3
"""재수집으로 달라진 행정규칙 조문을 뽑고, 그 조문을 인용하는 위키 셀을 찾아낸다.

왜 필요한가:
  admrul_recollect_stale.py 로 raw 원문 42개는 현행이 됐지만, 그 원문을 근거로 쓴
  위키 내용은 옛날 그대로다. 「위험물 선박운송 기준」에서 이미 삭제된 조문을 현행처럼
  설명하고 있던 것과 같은 상태가 그대로 남아 있다.
  전부 다시 쓸 일이 아니라 '실제로 달라진 조문을 인용하는 셀'만 골라내면 된다.

무엇을 하나:
  1) git 에서 재수집 직전 판본을 꺼내 현행본과 조문 단위로 비교한다(신설/삭제/변경).
  2) 위키에서 그 행정규칙 이름을 인용하는 페이지를 찾고, 그 페이지가 달라진 조문을
     짚고 있으면 '확인 필요 셀'로 보고한다.
  판정은 문자열 비교만 한다 — 무엇이 옳은지는 사람이 원문을 보고 정한다.

[연계]
  - 읽음: git show <BASE>:raw/... (옛 원문) · raw/**/행정규칙/*.txt (현행) · wiki/**/*.md
  - 씀:   _dashboard/admrul_diff_report.json · _dashboard/ADMRUL_DIFF.md
사용법: python3 admrul_diff_wiki.py [--base <커밋>]
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
RECOLLECT = os.path.join(LEGAL, '_dashboard', 'admrul_recollect_report.json')
OUT_JSON = os.path.join(LEGAL, '_dashboard', 'admrul_diff_report.json')
OUT_MD = os.path.join(LEGAL, '_dashboard', 'ADMRUL_DIFF.md')
BASE = '30edb5a98^'
if '--base' in sys.argv:
    BASE = sys.argv[sys.argv.index('--base') + 1]

ART = re.compile(r'(제\s*\d+조(?:의\s*\d+)?)')


def git_show(rel):
    r = subprocess.run(['git', '-C', REPO, 'show', '%s:%s' % (BASE, rel)],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def squash(s):
    return re.sub(r'\s+', '', str(s or ''))


def split_articles(text):
    """본문을 '제N조' 단위로 쪼갠다. -> {조문키: 내용}"""
    out = {}
    parts = ART.split(text or '')
    for i in range(1, len(parts), 2):
        key = squash(parts[i])
        body = parts[i + 1] if i + 1 < len(parts) else ''
        out.setdefault(key, '')
        out[key] += body
    return out


def split_annex(text):
    """[별표] 단위로 쪼갠다. -> {별표제목: 내용}"""
    out = {}
    for m in re.finditer(r'^\[별표\]\s*(.*)$', text or '', re.M):
        title = m.group(1).strip()
        start = m.end()
        nxt = re.search(r'^\[별표\]', text[start:], re.M)
        out[title] = text[start:start + (nxt.start() if nxt else len(text))]
    return out


def main():
    rec = json.load(open(RECOLLECT, encoding='utf-8'))
    updated = [r for r in rec['results'] if r['status'] == '갱신']
    # 위키 전체를 한 번만 읽어 둔다
    pages = {}
    wiki = os.path.join(LEGAL, 'wiki')
    for dp, _d, fs in os.walk(wiki):
        for fn in fs:
            if fn.endswith('.md'):
                p = os.path.join(dp, fn)
                try:
                    pages[os.path.relpath(p, LEGAL)] = open(p, encoding='utf-8').read()
                except Exception:
                    pass

    docs = []
    for r in updated:
        rel = os.path.join('local_server/knowledge/legal', r['file'])
        old = git_show(rel)
        if old is None:
            continue
        new = open(os.path.join(LEGAL, r['file']), encoding='utf-8').read()
        oa, na = split_articles(old), split_articles(new)
        added = sorted(set(na) - set(oa))
        removed = sorted(set(oa) - set(na))
        changed = sorted(k for k in set(oa) & set(na) if squash(oa[k]) != squash(na[k]))
        ob, nb = split_annex(old), split_annex(new)
        ann_added = sorted(set(nb) - set(ob))
        ann_removed = sorted(set(ob) - set(nb))
        ann_changed = sorted(k for k in set(ob) & set(nb) if squash(ob[k]) != squash(nb[k]))

        title = r['title']
        tkey = squash(re.sub(r'^\s*\([^)]{2,20}\)\s*', '', title))
        touched = set(added) | set(removed) | set(changed)
        cells = []
        for pp, txt in pages.items():
            if tkey not in squash(txt):
                continue
            # 페이지 전체에서 조문번호를 긁으면 다른 법 조문과 우연히 겹쳐 과다 판정된다.
            # 이 고시 이름이 적힌 '줄'(근거 조문 표의 한 행) 안의 조문번호만 센다.
            hit, lines = set(), []
            for ln in txt.split('\n'):
                if tkey in squash(ln):
                    got = {squash(m) for m in ART.findall(ln)} & touched
                    if got:
                        hit |= got
                        lines.append(ln.strip()[:160])
            cells.append({'page': pp, 'hit_articles': sorted(hit), 'lines': lines[:8]})
        docs.append({'title': title, 'file': r['file'],
                     'articles': {'신설': added, '삭제': removed, '변경': changed},
                     'annex': {'신설': ann_added, '삭제': ann_removed, '변경': ann_changed},
                     'wiki_pages': cells})
        print('%-40s 조문 신설%d 삭제%d 변경%d · 별표 신설%d 삭제%d 변경%d · 위키%d쪽'
              % (title[:40], len(added), len(removed), len(changed),
                 len(ann_added), len(ann_removed), len(ann_changed), len(cells)), flush=True)

    json.dump({'base': BASE, 'docs': docs}, open(OUT_JSON, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # 사람이 읽을 요약
    docs.sort(key=lambda d: -sum(len(v) for v in d['articles'].values()))
    L = ['# 행정규칙 재수집 전후 조문 변화와 영향 위키 페이지', '',
         '`admrul_diff_wiki.py` 자동 생성. 기준 커밋 `%s`.' % BASE, '',
         '아래 "확인 필요"는 **그 페이지가 달라진 조문 번호를 짚고 있다**는 뜻이지,',
         '내용이 틀렸다는 뜻이 아니다. 원문을 보고 사람이 정한다.', '']
    for d in docs:
        a = d['articles']
        n = len(a['신설']) + len(a['삭제']) + len(a['변경'])
        if not n and not any(d['annex'].values()):
            continue
        L.append('## %s' % d['title'])
        L.append('- 원문: `%s`' % d['file'])
        for k in ('삭제', '변경', '신설'):
            if a[k]:
                L.append('- 조문 %s(%d): %s' % (k, len(a[k]), ', '.join(a[k][:25]) +
                                               (' …' if len(a[k]) > 25 else '')))
        for k in ('삭제', '변경', '신설'):
            if d['annex'][k]:
                L.append('- 별표 %s(%d): %s' % (k, len(d['annex'][k]),
                                               ', '.join(x[:28] for x in d['annex'][k][:10]) +
                                               (' …' if len(d['annex'][k]) > 10 else '')))
        hits = [c for c in d['wiki_pages'] if c['hit_articles']]
        if hits:
            L.append('- **확인 필요 위키 %d쪽**:' % len(hits))
            for c in hits[:20]:
                L.append('  - `%s` — %s' % (c['page'], ', '.join(c['hit_articles'][:12])))
                for ln in c.get('lines', [])[:3]:
                    L.append('    - %s' % ln)
        elif d['wiki_pages']:
            L.append('- 인용 위키 %d쪽 (달라진 조문은 안 짚음)' % len(d['wiki_pages']))
        L.append('')
    open(OUT_MD, 'w', encoding='utf-8').write('\n'.join(L))
    tot = sum(len([c for c in d['wiki_pages'] if c['hit_articles']]) for d in docs)
    print('\n확인 필요 위키 페이지 총 %d쪽 -> %s' % (tot, OUT_MD))


if __name__ == '__main__':
    main()
