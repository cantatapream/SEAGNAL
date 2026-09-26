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

TITLE_CUT = re.compile(r'<br>|✅|❌|🟡|⬜|🔒|🔍|🔴|~~')
LEAD = '★⚠️ '

def row_title(line):
    """그 칸이 **무엇을 하는 일인지** 한 줄로. (2026-09-25 — 사장님이 「리스트별로」 보시게)

    두 번째 칸이 제목이다. 그 안에 완료 기록이 딸려 붙는 일이 많아 **첫 마디만** 남긴다 —
    마커·`<br>`·`★` 같은 표시가 나오면 거기서 끊는다. ⚠줄여 적는 것이므로 **판정에는 쓰지 않는다.**
    """
    # ★칸 차례가 표마다 다르다 — 어떤 표는 두 번째 칸이 곧 상태다(그러면 제목이 빈다).
    #   그래서 **앞에서부터 「마커로 시작하지 않고 글자가 남는」 첫 칸**을 제목으로 본다.
    for c in line.split('|')[2:]:
        t = c.strip()
        if MARK_RE.match(t.lstrip('*~⚠️ ')):
            continue
        t = TITLE_CUT.split(t)[0]
        t = re.sub(r'\*\*|`|\[자\]', '', t).lstrip(LEAD).strip(' —·:')
        t = re.sub(r'\s+', ' ', t)
        if len(t) >= 3:
            return t[:92]
    return ''

NEWSEC = re.compile(r'새로 생긴 일\s*\(등록\)')

def _walk(lines, rows):
    sec = '(머리)'
    for l in lines:
        if l.startswith('#'):
            sec = l.strip('# ').strip()
        m = ID_RE.match(l)
        if m and m.group(1) not in rows:
            rows[m.group(1)] = {'id': m.group(1), 'sec': sec, 'st': row_status(l),
                                '무엇': row_title(l)}
    return rows

def read_rows(text=None):
    """§A 를 먼저 훑고, 그 **앞쪽의 「새로 생긴 일 (등록)」 절**도 함께 훑는다.

    ⚠★**2026-09-25 에 고쳤다 — 여태 §A 부터만 훑어서 「새로 생긴 일」 절이 안 세어졌다.**
      그 절은 파일 **위쪽**에 있는데(갱신 목록 옆) 새 일감을 거기 등재하는 것이 관례다.
      그래서 `3-55`~`3-63`·`4-4` **10칸이 진행판에 없었다** — 일을 등재해도 숫자가 안 움직였다.
      ★진행판을 만든 까닭과 **똑같은 병**이 세는 자 안에 또 있었던 것이다.
    ⚠**§A 를 먼저 훑는 순서를 지킨다** — 같은 칸이 갱신 목록에도 되풀이 적히므로,
      먼저 넣은 것이 이긴다(`§A` 가 임자다). 갱신 목록 표는 **훑지 않는다**(과거 서술이다).
    """
    lines = (text if text is not None else WL.read_text(encoding='utf-8')).split('\n')
    a = next((i for i, l in enumerate(lines) if l.startswith('# §A')), 0)
    rows = _walk(lines[a:], collections.OrderedDict())
    # §A 앞쪽 — 「새로 생긴 일 (등록)」 절만 골라 본다
    keep, on = [], False
    for l in lines[:a]:
        if l.startswith('#'):
            on = bool(NEWSEC.search(l))
        if on:
            keep.append(l)
    return _walk(keep, rows)

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

LOCK_DEP_RE = re.compile(r'🔒\s*\*{0,2}(?:선행대기|선행)\s*[((]\s*([0-9A-Z]+-[0-9]+[a-z]?)\s*[))]')

def stale_locks(rows, lines):
    """★「앞 일이 끝났는데 문이 안 열린 것」을 찾는다 (2026-09-24 신설).

    까닭: 진행판 숫자와 같은 병이다 — 앞 일을 끝내고 **뒤 칸의 🔒 를 안 풀었다.**
      사람이 훑을 때도 기계가 셀 때도 **할 수 있는 일이 못 하는 일로 보인다.**
    ⚠**기계가 풀지는 않는다**(G-34). 「적힌 조건이 이미 채워졌다」고 가리키기만 한다 —
      풀든지, 다른 까닭을 새로 적든지는 사람이 정한다.
    """
    out = []
    for l in lines:
        m = ID_RE.match(l)
        if not m or rows.get(m.group(1), {}).get('st') != '🔒':
            continue
        dep = LOCK_DEP_RE.search(l)
        if not dep:
            continue
        d = dep.group(1)
        if rows.get(d, {}).get('st') in DONE:
            out.append((m.group(1), d, rows[d]['st']))
    return out

# 다른 칸이 「내가 이 일을 한다」고 제 손으로 적은 자리 — `**P-11 · G-14**` 꼴의 연결 칸.
CLAIM_RE = re.compile(r'(?<![0-9A-Za-z])([0-9A-Z]+-[0-9]+[a-z]?)(?![0-9A-Za-z])')

# 일감이 아닌 갈래 — 「끝났는데 마커만 안 바뀐 칸」 후보에서 뺀다(아래 주석 참조).
NOT_WORK = ('결정', '사장님몫', '조사')


def done_but_open(rows, lines):
    """★「이미 끝났는데 칸 머리만 안 바뀐 것」을 찾는다 (2026-09-25 신설).

    까닭: 세 번 겪었다 — `2-19`(V5-24 가 이미 있었다) · `3-30`(G-26 이 답을 냈다) ·
      `P-11`(2-11 이 고쳤고 그 주석이 P-11 을 적고 있었다). **세 번 다 딴 일을 하다 우연히 걸렸다.**
      하나씩 걸려서 찾는 것은 낭비고, 그 사이 진행판은 **할 수 있는 일을 못 하는 일로** 센다.
    어떻게 짚나: 끝난 칸(✅·❌)의 줄에 **다른 칸 번호가 적혀 있고** 그 칸이 아직 안 끝났으면,
      「그 끝난 칸이 이 칸을 했다고 말하는 것일 수 있다」고 가리킨다.
    ⚠**기계가 닫지 않는다**(G-34). 글에 번호가 같이 적힌 것이 곧 「했다」는 아니다 —
      **선행 관계**일 수도 있다(`2-5` 는 `2-4` 를 적지만 아직 할 일이 남았다).
      그래서 후보만 내고, 사람이 **그 코드·주석을 직접 열어** 확인한다(P-11 은 그렇게 확인했다).
    ⚠줄이 긴 칸은 완료 기록에 남의 번호가 잔뜩 섞인다 — 그래서 **앞쪽 세 칸**만 본다
      (제목·연결·대상 칸. 완료 글은 뒤에 붙는다).
    """
    out = []
    for l in lines:
        m = ID_RE.match(l)
        if not m:
            continue
        me = m.group(1)
        if rows.get(me, {}).get('st') not in DONE:
            continue
        head = '|'.join(l.split('|')[1:4])          # 제목·연결·대상까지만
        for other in set(CLAIM_RE.findall(head)):
            if other == me:
                continue
            r = rows.get(other)
            if not r or r['st'] in DONE:
                continue
            # ★**일감이 아닌 갈래는 후보에서 뺀다** (2026-09-25 고침).
            #   `결정`(사장님 결심 기록)·`사장님몫`·`조사`(끝난 1라운드) 칸은 **애초에 할 일이 아니다.**
            #   그 칸의 상태 자리에는 결심 글이 들어 있어 마커가 `?` 로 읽히고, 그래서
            #   「끝난 칸이 안 끝난 칸을 가리킨다」에 걸렸다 — **21건 중 7건이 그런 허수였다**
            #   (`Q-5`·`Q-6`·`Q-7`·`Q-16`·`Q-17`). 끝난 칸이 **자기를 허락한 결심을 적는 것은 정상**이다.
            #   ⚠뺀 것은 **세는 데서만** 뺀다 — 등록부의 그 칸은 그대로 있다.
            if r.get('g') in NOT_WORK:
                continue
            out.append((other, r['st'], me))
    # 같은 후보가 여러 번 나오면 한 번만
    seen, uniq = set(), []
    for a, st, b in out:
        if (a, b) in seen:
            continue
        seen.add((a, b)); uniq.append((a, st, b))
    return sorted(uniq)

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

def full(rows, per, total, today):
    """★등록부 **전부**를 군별로 한 줄씩 찍는다 (`--full`).

    까닭 (2026-09-25 사장님): *"전체의 작업 목록을 리스트별로 완료·진행 등 현황을 표기해 달라."*
      진행판은 **수**만 말한다. 어느 칸이 무엇이고 지금 어디인지는 이 목록이 말한다.
    ⚠제목은 `row_title()` 이 줄여 적은 것이다 — 자세한 것은 등록부 그 칸을 본다.
    """
    L = ['# 📋 등록부 전체 %d항목 — 리스트별 현황 (센 날 %s)' % (total['행'], today), '',
         '> 이 목록은 `worklist_progress.py --full` 이 등록부에서 **직접 읽어** 찍는다. 손으로 적지 않는다.',
         '> 상태는 **칸 머리의 마커**다: ' + ' · '.join('%s %s' % (k, TITLE[k]) for k in ORDER if k != '?'),
         '']
    for g, v in per.items():
        ids = [r for r in rows.values() if r['g'] == g]
        if not ids:
            continue
        if g in ('결정', '사장님몫'):
            L.append('## %s — %s (%d행 · 일감으로 세지 않는다)' % (g, RULES['이름'].get(g, g), len(ids)))
        else:
            L.append('## %s — %s · **%d/%d 끝**' % (g, RULES['이름'][g], v['done'], v['n']))
        L.append('')
        L.append('| 상태 | # | 무엇 |')
        L.append('|---|---|---|')
        for r in sorted(ids, key=lambda x: (x['st'] not in DONE, x['id'])):
            L.append('| %s | `%s` | %s |' % (r['st'], r['id'], r['무엇'] or '—'))
        L.append('')
    return '\n'.join(L)


BEG, END = '<!-- 진행판:자동 -->', '<!-- /진행판 -->'

def main():
    global RULES
    RULES = json.loads(GRP.read_text(encoding='utf-8'))
    rows = assign(read_rows(), RULES)
    per, total = tally(rows, RULES)
    today = datetime.date.today().isoformat()
    block = render(per, total, today)

    if '--full' in sys.argv:
        print(full(rows, per, total, today))

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

    lines_all = WL.read_text(encoding='utf-8').split('\n')
    dbo = done_but_open(rows, lines_all)
    if dbo:
        print('\n⚠끝난 칸이 「내가 이 일을 한다」고 적어 둔 **안 끝난 칸** %d개 — '
              '그 코드·주석을 직접 열어 확인한다(기계가 닫지 않는다):' % len(dbo))
        for a, st, b in dbo:
            print('   %-7s %s  ← %s 가 제 줄에 적고 있다' % (a, st, b))

    stale = stale_locks(rows, lines_all)
    if stale:
        print('\n⚠앞 일이 끝났는데 아직 🔒 인 칸 %d개 — 풀든지 다른 까닭을 적든지 사람이 정한다:' % len(stale))
        for a, b, st in stale:
            print('   %-7s 는 「선행(%s)」인데 %s 는 이미 %s' % (a, b, b, st))

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
