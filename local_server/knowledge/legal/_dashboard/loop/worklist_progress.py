#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""00_WORKLIST.md 의 「전체 중 어디까지 왔나」를 손이 아니라 기계가 센다.

왜 만들었나 (2026-09-24, 사장님 지적):
  *"갱신하는 걸 계속 까먹고 있는 것 같다. 전체 중에 어느 정도 왔는가를 파악할 수 있도록 해야 될 것 같다."*
  까닭을 찾아보니 — 일을 끝내고 **칸 안에는 완료 글을 붙였는데 칸 머리의 마커는 안 바꿨고**,
  머리 진행판의 숫자는 **손으로 적은 값**이라 아무도 다시 세지 않았다.
  ⇒ 세는 자리를 하나 만들고(여기), 게이트가 그것을 지키게 한다(V5-44).

세는 법 (딱 한 곳에 적는다):
  · 등록부 행     = §A 아래에서 `| ID |` 로 시작하는 줄. ID 가 겹치면 처음 것만.
  · 상태          = 그 줄의 칸들 중 **마커로 시작하는 마지막 칸**의 마커.
                    (마지막 칸을 쓰지 않는 까닭: 칸 안에 `|` 가 든 줄이 7개 있다 — L-382)
                    못 찾으면 줄 전체에서 처음 나오는 마커. 그것도 없으면 「?」.
  · 끝난 것       = ✅(했다) + ❌(재보니 할 일이 아니었다 — 닫힌 것은 같다)
  · 일로 세는 것  = 전체 − 결정행(Q-*) − 사장님 몫(U-*)
  · 군           = _GROUPS.json (Q-16 순서). 어디에도 안 걸리면 「미배정」으로 드러낸다.

쓰는 법:
  python3 worklist_progress.py              세어서 표만 찍는다 (--list 로 표본도)
  python3 worklist_progress.py --update     00_WORKLIST.md 의 진행판 숫자를 실측으로 바꾼다
  python3 worklist_progress.py --gate       적힌 숫자와 실측이 다르면 1 로 죽는다 (V5-44)
"""
import re, sys, json, collections, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'd_standard_2026-09-22'
WL   = ROOT / '00_WORKLIST.md'
GRP  = ROOT / '_GROUPS.json'

ID_RE   = re.compile(r'^\|\s*~*\*{0,2}\s*([0-9A-Z]+-[0-9]+[a-z]?)\s*\*{0,2}~*\s*\|')
MARK_RE = re.compile(r'^(✅|🟡|⬜|🔒|🔍|🔴|❌|—)')
ANY_RE  = re.compile(r'(✅|❌|🟡|⬜|🔒|🔍)')
DONE    = ('✅', '❌')
ORDER   = ['✅', '❌', '🟡', '⬜', '🔒', '🔍', '?']
TITLE   = {'✅': '끝났다', '❌': '안 한다(재보니 할 일이 아니었다)', '🟡': '하는 중',
           '⬜': '안 했다', '🔒': '잠겼다(앞 일 대기)', '🔍': '크기를 아직 모른다', '?': '마커를 못 읽었다'}

def row_status(line):
    """칸 머리의 마커가 그 항목의 상태다."""
    cells = line.split('|')[2:]
    hits = [MARK_RE.match(c.strip().lstrip('*~⚠️ ')) for c in cells]
    hits = [h.group(1) for h in hits if h]
    if hits:
        return hits[-1]
    m = ANY_RE.search(line)
    return m.group(1) if m else '?'

def read_rows(text=None):
    lines = (text if text is not None else WL.read_text(encoding='utf-8')).split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('# §A')), 0)
    rows, sec = collections.OrderedDict(), '(머리)'
    for l in lines[start:]:
        if l.startswith('#'):
            sec = l.strip('# ').strip()
        m = ID_RE.match(l)
        if m and m.group(1) not in rows:
            rows[m.group(1)] = {'id': m.group(1), 'sec': sec, 'st': row_status(l)}
    return rows

def assign(rows, rules):
    ex = {i: g for g, ids in rules['explicit'].items() for i in ids}
    for r in rows.values():
        if r['id'] in ex:
            r['g'] = ex[r['id']]; continue
        key = next((k for k in rules['section'] if r['sec'].startswith(k)), None)
        r['g'] = rules['section'][key] if key else '미배정'
    return rows

def tally(rows, rules):
    per = collections.OrderedDict()
    for g in rules['순서']:
        ids = [r for r in rows.values() if r['g'] == g]
        if not ids and g == '미배정':
            continue
        c = collections.Counter(r['st'] for r in ids)
        per[g] = {'n': len(ids), 'done': sum(c[k] for k in DONE), 'c': c,
                  '남은': [r['id'] for r in ids if r['st'] not in DONE]}
    work = [r for r in rows.values() if r['g'] not in ('결정', '사장님몫')]
    total = {'행': len(rows), '일': len(work),
             '끝': sum(1 for r in work if r['st'] in DONE),
             '결정': sum(1 for r in rows.values() if r['g'] == '결정'),
             '사장님몫': sum(1 for r in rows.values() if r['g'] == '사장님몫'),
             'c': collections.Counter(r['st'] for r in work)}   # 상태는 일감만 센다
    total['%'] = round(total['끝'] * 100 / total['일']) if total['일'] else 0
    return per, total

def bar(done, n, w=10):
    f = 0 if not n else round(done * w / n)
    return '▓' * f + '░' * (w - f)

def render(per, total, today):
    L = []
    L.append('## 한눈에 — 등록부 **%d항목** (기계가 셈 · `loop/worklist_progress.py`)' % total['행'])
    L.append('')
    L.append('| 상태 | 수 | 뜻 |')
    L.append('|---|---:|---|')
    for k in ORDER:
        if total['c'].get(k):
            L.append('| %s | **%d** | %s |' % (k, total['c'][k], TITLE[k]))
    L.append('')
    L.append('**일로 셀 수 있는 것 %d개 중 끝난 것 %d = 약 %d%%**' % (total['일'], total['끝'], total['%']))
    L.append('')
    L.append('> 위 표는 **일감만** 센다. 등록부에는 그 밖에 **사장님 결정 기록 %d행**(Q-*)과 '
             '**사장님이 직접 하실 일 %d행**(U-*)이 더 있어 모두 %d행이다.'
             % (total['결정'], total['사장님몫'], total['행']))
    L.append('')
    L.append('## 군별 진행 (Q-16 「내실 우선」 순서 · 규칙은 `_GROUPS.json`)')
    L.append('')
    L.append('| 군 | 무엇 | 진행 | 남은 것 |')
    L.append('|---|---|---|---|')
    for g, v in per.items():
        if g in ('결정', '사장님몫'):
            continue
        rest = ' · '.join('`%s`' % i for i in v['남은'][:14]) or '—'
        if len(v['남은']) > 14:
            rest += ' … 외 %d' % (len(v['남은']) - 14)
        prog = ('🟡 **상시**(%d행)' % v['n']) if g in RULES.get('상시', []) \
               else '%s **%d/%d**' % (bar(v['done'], v['n']), v['done'], v['n'])
        L.append('| **%s** | %s | %s | %s |' % (g, RULES['이름'][g], prog, rest))
    L.append('')
    L.append('```')
    for g, v in per.items():
        if g in ('결정', '사장님몫'):
            continue
        if g in RULES.get('상시', []):
            L.append('%-4s %s  %-7s  %s' % (g, '▓' * 10, '상시', RULES['이름'][g]))
        else:
            L.append('%-4s %s  %3d/%-3d  %s' % (g, bar(v['done'], v['n']), v['done'], v['n'], RULES['이름'][g]))
    L.append('```')
    L.append('')
    L.append('> 센 날: **%s** · 이 칸은 **손으로 고치지 않는다** — '
             '`python3 _dashboard/loop/worklist_progress.py --update` 가 다시 쓴다.' % today)
    return '\n'.join(L)

BEG, END = '<!-- 진행판:자동 -->', '<!-- /진행판 -->'

def main():
    global RULES
    RULES = json.loads(GRP.read_text(encoding='utf-8'))
    rows = assign(read_rows(), RULES)
    per, total = tally(rows, RULES)
    today = datetime.date.today().isoformat()
    block = render(per, total, today)

    if '--list' in sys.argv:
        for r in list(rows.values())[:20]:
            print('  %-7s %-5s %s  %s' % (r['id'], r['st'], r['g'], r['sec'][:28]))
        print('  … 전체 %d행' % len(rows))

    if '--update' in sys.argv:
        txt = WL.read_text(encoding='utf-8')
        if BEG in txt and END in txt:
            i, j = txt.index(BEG), txt.index(END)
            txt = txt[:i] + BEG + '\n' + block + '\n' + txt[j:]
        else:
            old = re.search(r'<!-- 진행판:[^>]*-->\n(.*?)(?=\n## 🔴)', txt, re.S)
            if not old:
                print('✘ 진행판 자리를 못 찾았다 — 손대지 않는다'); return 1
            head = txt[:old.start()]
            keep = re.search(r'(# 📊 전체 진행판.*?\n)(?=## )', old.group(1), re.S)
            intro = keep.group(1) if keep else '# 📊 전체 진행판\n\n'
            txt = head + BEG + '\n' + intro + '\n' + block + '\n' + END + txt[old.end():]
        WL.write_text(txt, encoding='utf-8')
        print('✅ 진행판을 실측으로 다시 썼다')

    if '--gate' in sys.argv:
        txt = WL.read_text(encoding='utf-8')
        if BEG not in txt or END not in txt:
            print('✘ V5-44: 진행판 자동 구역(%s … %s)이 없다' % (BEG, END)); return 1
        cur = txt[txt.index(BEG) + len(BEG):txt.index(END)].strip()
        want = block.strip()
        # 「센 날」 한 줄만 다른 것은 통과 — 숫자가 다를 때만 잡는다
        strip = lambda s: '\n'.join(l for l in s.split('\n') if not l.startswith('> 센 날'))
        if strip(cur) != strip(want):
            print('✘ V5-44: 진행판에 적힌 숫자가 실측과 다르다.')
            print('   → python3 _dashboard/loop/worklist_progress.py --update')
            a, b = strip(cur).split('\n'), strip(want).split('\n')
            for k in range(max(len(a), len(b))):
                x, y = (a[k] if k < len(a) else ''), (b[k] if k < len(b) else '')
                if x != y:
                    print('   적힘: %s\n   실측: %s' % (x[:110], y[:110]))
            return 1
        print('✅ V5-44 진행판 = 실측 (%d행 · 일 %d 중 %d 끝 · %d%%)'
              % (total['행'], total['일'], total['끝'], total['%']))
        return 0

    if '--update' not in sys.argv:
        print(block)
    return 0

if __name__ == '__main__':
    sys.exit(main())
