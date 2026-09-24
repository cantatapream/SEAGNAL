#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-33 뒤쪽(결심 ①ⓐ) — **「원문 그대로」라던 인용 24건을 원문 글자에 맞춘다.**

[결심] 2026-09-24 사장님 ⓐ — *원문대로 고친다.*

[왜 `exact_claim_recheck.py` 로는 못 고치나]
  그 도구는 **있나/없나**만 답한다. 고치려면 **원문이 실제로 어떻게 적혀 있는지**를
  집어내야 한다. 그리고 「없다」는 답 자체가 거칠었다:
  ★2026-09-24 실측 — 24건을 「토막이 전부 있나」로 넓게 찾으니 **0건**이 나왔다.
    그런데 3번(`수산부산물…:106`)은 `raw/05_수산어업/수산업법/법률.txt` 에 **있다.**
    까닭: 위키가 `제108조제3ㆍ5호` 로 줄여 썼고 원문은 `제108조제3호ㆍ제5호` 다.
    **토막 하나가 어긋나면 토막 전체가 「없다」로 떨어진다.** 자가 거칠었던 것이다.
  ⇒ 그래서 이 도구는 **닮은 정도(difflib)로 가장 가까운 원문 창을 찾아** 글자를 견준다.

[세는 법 — 뿌리 사슬 ⑥]
  · 견주기 전에 공백·마크업·따옴표꼴·가운뎃점꼴을 한 꼴로 눕힌다(`exact_claim_recheck.flat`).
  · `…` 로 줄인 인용은 **토막마다 따로** 가장 닮은 창을 찾는다.
  · 닮음 **0.90 이상**이면 「원문이 있는데 글자가 다르다」 → 고칠 수 있다.
  · 0.90 미만이면 「원문이 아닐 수 있다」 → **고치지 않고 사람에게 넘긴다.**
    ★임의로 고치면 그것이 환각이다. 지어내지 않는다.

[무엇을 고치나]
  위키 줄의 큰따옴표 안 글자를 **raw 에 적힌 그대로**로 바꾼다. 줄임표(`…`)는 살린다
  — 줄임표는 「여기를 줄였다」는 정직한 표시라서 없애지 않는다.

[연계] ← `_dashboard/exact_claim_review.json`(3-33 이 남긴 24건)
        → 고친 뒤 `exact_claim_recheck.py` 로 다시 잰다
사용법: python3 exact_claim_fix.py [--apply] [--n 3]
"""
import difflib, importlib.util, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from _touched import Touched

_spec = importlib.util.spec_from_file_location('ecr', os.path.join(HERE, 'exact_claim_recheck.py'))
ECR = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ECR)

REVIEW = os.path.join(LEGAL, '_dashboard', 'exact_claim_review.json')
APPLY = '--apply' in sys.argv
ONLY = None
if '--n' in sys.argv:
    ONLY = int(sys.argv[sys.argv.index('--n') + 1])
GOOD = 0.90            # 이보다 닮았으면 「같은 글인데 글자가 다르다」로 본다


def flat_map(text):
    """눕힌 글자열과 **원래 자리로 되돌리는 표**를 같이 만든다.
       (눕힌 글에서 찾은 창을 **원문 그대로** 오려 내려면 이 표가 있어야 한다.)"""
    t = unicodedata.normalize('NFC', text)
    out, idx = [], []
    i = 0
    while i < len(t):
        ch = t[i]
        two = t[i:i + 2]
        if two in ('**', '[[', ']]'):
            i += 2; continue
        if ch in '*`' or ch.isspace() or ch in ECR.BOX or ch in ECR.QUOTECH:
            i += 1; continue
        out.append(ECR.SAME.get(ch, ch)); idx.append(i); i += 1
    return ''.join(out), idx


def best_window(needle, hay_flat, hay_idx, hay_raw):
    """`needle`(눕힌 글) 과 가장 닮은 창을 찾는다.
       돌려주는 것: (닮음, 원문 그대로의 글, 갈래)
       갈래 — `'뺐다'`  위키가 원문의 토막을 **말없이 뺐을 뿐**이다(넣기만 하면 원문이 된다)
              `'다르다'` 글자가 바뀌거나 없는 말이 들어 있다 — **사람이 봐야 한다**

    ★왜 「닮음 0.90」 하나로 가르면 안 되나 (2026-09-24 실측)
      21건이 0.85~0.89 로 떨어졌는데, 열어 보니 전부 **같은 조문**이었고
      위키가 `(이하 "실태조사"라 한다)` 같은 **괄호를 줄임표 없이 말없이 뺀** 것이었다.
      닮음만 보면 「모르겠다」가 되지만, **뺀 것뿐인지**는 기계가 확실히 가를 수 있다.
      ⇒ 닮음은 **후보를 고르는 데만** 쓰고, 고칠지 말지는 **갈래**로 정한다."""
    n = len(needle)
    if n < 6 or len(hay_flat) < n:
        return 0.0, '', '다르다'
    anchors, seed = [], needle[:12]
    p = hay_flat.find(seed)
    while p != -1 and len(anchors) < 400:
        anchors.append(p); p = hay_flat.find(seed, p + 1)
    if not anchors:
        step = max(1, n // 4)
        anchors = list(range(0, len(hay_flat) - n + 1, step))
    best = (0.0, '', '다르다')
    for a in anchors:
        for span in (n, int(n * 1.15) + 4, int(n * 1.35) + 8, int(n * 1.6) + 16):
            s0, e0 = max(0, a - 4), min(len(hay_flat), a + span)
            win = hay_flat[s0:e0]
            sm = difflib.SequenceMatcher(None, needle, win)
            r = sm.ratio()
            if r <= best[0]:
                continue
            # ★창의 앞뒤로 삐져나온 군더더기를 **잘라 낸다** — 인용은 거기서 시작하고 거기서 끝난다.
            blocks = [b for b in sm.get_matching_blocks() if b.size]
            if not blocks:
                continue
            t0, t1 = s0 + blocks[0].b, s0 + blocks[-1].b + blocks[-1].size
            trimmed = hay_flat[t0:t1]
            # 자른 창과 다시 견준다 — 「넣기만 하면 되는가」를 본다
            ops = difflib.SequenceMatcher(None, needle, trimmed).get_opcodes()
            kind = '뺐다' if all(o[0] in ('equal', 'insert') for o in ops) else '다르다'
            got = hay_raw[hay_idx[t0]:hay_idx[t1 - 1] + 1]
            best = (r, got, kind)
    return best


def load_pool():
    """raw 전부를 한 번 읽어 (경로, 눕힌글, 표, 원문) 로 쥔다. `_대기`(옛 판)는 뺀다.
       ★읽고 눕히는 데만 1분 넘게 걸린다 — 임시 칸에 재워 두고 두 번째부터는 꺼내 쓴다."""
    import pickle
    cache = os.environ.get('SCRATCH', '/tmp/claude-0/wk')
    os.makedirs(cache, exist_ok=True)
    jar = os.path.join(cache, 'raw_flat_pool.pkl')
    newest = 0
    files = []
    for root, dirs, fs_ in os.walk(os.path.join(LEGAL, 'raw')):
        dirs[:] = [d for d in dirs if d != '_대기']
        for f in sorted(fs_):
            if f.endswith('.txt'):
                q = os.path.join(root, f)
                files.append(q)
                try: newest = max(newest, os.path.getmtime(q))
                except OSError: pass
    if os.path.exists(jar) and os.path.getmtime(jar) > newest:
        with open(jar, 'rb') as fh:
            return pickle.load(fh)
    pool = []
    for q in files:
        try:
            raw = open(q, encoding='utf-8').read()
        except Exception:
            continue
        fl, ix = flat_map(raw)
        pool.append((q, fl, ix, raw))
    with open(jar, 'wb') as fh:
        pickle.dump(pool, fh, protocol=4)
    return pool


def shortlist(need, pool, mine):
    """difflib 은 비싸다. **글자 조각이 실제로 들어 있는 파일**만 먼저 추린다.
       ★조각을 여러 자리에서 뽑는다 — 인용은 앞이나 뒤 한쪽만 어긋나는 일이 흔하다."""
    seeds = []
    for frac in (0.0, 0.25, 0.5, 0.75):
        a = int(len(need) * frac)
        if a + 12 <= len(need):
            seeds.append(need[a:a + 12])
    if not seeds:
        seeds = [need]
    hit = [x for x in mine if any(sd in x[1] for sd in seeds)]
    if hit:
        return hit
    hit = [x for x in pool if any(sd in x[1] for sd in seeds)]
    return hit if hit else mine          # 아무 데도 없으면 제 법 raw 만 견준다


def main():
    items = json.load(open(REVIEW, encoding='utf-8'))
    pool = load_pool()
    print(f'견줄 자리 {len(items)}개 · raw 파일 {len(pool)}개 (옛 판 `_대기` 제외)\n')
    fixable, human = [], []
    for k, it in enumerate(items, 1):
        if ONLY and k != ONLY:
            continue
        quote = it['인용']
        parts = [t for t in re.split(r'…|\.\.\.', quote) if len(ECR.flat(t)) >= 8]
        if not parts:
            parts = [quote]
        # 제 법 raw 를 먼저, 그다음 저장소 전체 (다른 법 조문을 인용한 자리가 실제로 있다)
        mine = [x for x in pool if any(x[0].endswith(r.replace('raw/', '')) or r in x[0]
                                      for r in it.get('본raw', []))]
        results = []
        for part in parts:
            need = ECR.flat(part)
            cand = shortlist(need, pool, mine)
            bb, bp = (0.0, '', '다르다'), None
            for p, fl, ix, raw in cand:
                r, got, kind = best_window(need, fl, ix, raw)
                if r > bb[0]:
                    bb, bp = (r, got, kind), p
                if bb[0] >= 0.995:
                    break
            results.append((part, bb[0], bb[1], bp, bb[2]))
        worst = min(r[1] for r in results)
        # ★고칠지 말지는 **갈래**로 정한다 — 토막이 전부 「뺐다」이고 닮음이 0.80 이상일 때만 고친다.
        #   0.80 은 「같은 조문인지」를 거르는 문턱이지 판정자가 아니다(판정자는 갈래다).
        allcut = all(x[4] == '뺐다' for x in results) and worst >= 0.80
        tag = '고칠 수 있다(원문에서 뺀 것을 도로 넣는다)' if allcut else '사람 몫'
        print(f"[{k:2}] {tag}  닮음 {worst:.2f}  {it['쪽']}:{it['줄']}")
        for part, r, got, p, kind in results:
            print(f'      위키 «{part.strip()[:110]}»')
            print(f'      원문 «{(got or "—").strip()[:110]}»   닮음 {r:.2f} · {kind}  {p or ""}')
        (fixable if allcut else human).append((it, results))
        print()
    print(f'▣ 고칠 수 있다 {len(fixable)} · 사람 몫 {len(human)}')
    if APPLY and fixable:
        touched = Touched('exact_claim_fix.py')
        n = 0
        for it, results in fixable:
            path = os.path.abspath(os.path.join(LEGAL, it['쪽']))   # `쪽` 은 `wiki/…` 로 적혀 있다
            if not os.path.exists(path):
                print('  ❌ 그 쪽을 못 찾았다:', it['쪽']); continue
            src = open(path, encoding='utf-8').read()
            new = src
            for part, r, got, p, kind in results:
                if not got:
                    continue
                # ★통글자로 못 바꾼다 — 위키 인용 안에 **우리가 넣은 굵게 표시**가 섞여 있다
                #   (2026-09-24 실측: 6건 중 4건이 이것 때문에 안 바뀌었다).
                #   그래서 **따옴표 구간을 직접 찾아** 그 속을 원문으로 갈아 끼운다.
                #   굵게 표시는 우리가 얹은 것이지 원문에 있는 것이 아니다 — 같이 걷힌다(§8 원문 그대로).
                want = ECR.flat(part)
                done_one = False
                for m in ECR.QUOTE.finditer(new):
                    inner = m.group(1) if m.group(1) is not None else m.group(2)
                    if inner is None or ECR.flat(inner) != want:
                        continue
                    a, b = m.start(), m.end()
                    q0, q1 = new[a], new[b - 1]
                    body = got.strip()
                    # ★원문 안에 바깥과 **같은 따옴표**가 들어 있으면 인용이 거기서 일찍 닫힌다
                    #   (`조사(이하 이 조에서 "실태조사"라 한다)` — 2026-09-24 실측).
                    #   그러면 다음에 이 줄을 읽는 자가 **토막만 인용으로 보게 된다.**
                    #   바깥을 굽은 따옴표 “ ” 로 바꿔 씌운다 — 원문 글자는 하나도 안 건드린다.
                    if q0 in body or q1 in body:
                        q0, q1 = '\u201c', '\u201d'
                    new = new[:a] + q0 + body + q1 + new[b:]
                    done_one = True
                    break
                if not done_one and part in new:
                    new = new.replace(part, got.strip(), 1)
            if new != src:
                open(path, 'w', encoding='utf-8').write(new)
                touched.add(path); n += 1
                print(f"  ✎ {it['쪽']}:{it['줄']}")
            else:
                print(f"  ⚠ 글자를 못 찾아 그대로 두었다: {it['쪽']}:{it['줄']}")
        touched.save()
        print(f'고친 쪽 {n}개')
    elif not APPLY:
        print('(미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
