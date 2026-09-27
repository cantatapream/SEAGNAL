#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G-4 (결심 ⑪ⓒ) — **승급 기록줄이 없는 canonical 쪽에 「1차는 기계가 했다·2차는 사람 몫」을 적는다.**

[결심] 2026-09-25 사장님 ⓒ — *기계가 할 수 있는 「1차」만 적고 「2차는 사람 몫」이라고 밝힌다.*

[무엇이 문제였나 — G-4 실측]
  `_SCHEMA.md` §5-D ⓒ-1 은 승급한 쪽의 「변경 이력」에 재점검 기록을 **한 줄**로 적으라 정했다.
  그런데 canonical **1,112쪽 중 20쪽(1.8%)** 에만 있었다. ⓑ 대상인 쪽 **1,049** 중 **1,029쪽이 빈칸**이다.
  빈칸은 「안 했다」와 「했는데 안 적었다」를 **구별해 주지 않는다** — 그래서 아무도 못 따라간다.

[왜 기계가 다 채울 수 없나]
  ⓑ 는 **서로 다른 두 번**을 요구한다: ①기계 EXACT 대조 ②**사람의 다른 눈으로 읽기**.
  ②는 기계가 못 한다. 그래서 이 자는 **①만 실제로 돌리고, ②는 「사람 몫·미이행」이라고 밝혀 적는다.**
  ★**「했다」고 적지 않는다** — 안 한 것을 했다고 적는 것이 이 저장소가 가장 싫어하는 일이다.

[★내가 여기서 두 번 틀렸다 — 둘 다 적어 둔다]
  ① *"1차 대조를 정말 하는 자를 먼저 만들어야 한다"* → **이미 있었다**(`num_exact_check.py`).
  ② 이 자에 ⓑ 대상 낱말을 **따로 적어 놓고** 머리말에 *"promote_guard.js 와 같은 것을 쓴다"* 고 적었다.
     **거짓이었다.** 그 자의 낱말이 더 넓었고(`영업정지`·`이내`·`이상`·`톤`·`노트`…) 수가 갈렸다.
     ⇒ 낱말을 `_dashboard/bnum_words.json` **한 곳**으로 옮기고 **둘이 그것을 읽게** 했다(뿌리 사슬 ⑥).
     ⚠이미 317쪽에 적어 버린 뒤에 알아서 **그 317쪽을 되돌리고** 다시 돌렸다.

[★1차를 정말 돌린다 — 뭉뚱그려 적지 않는다]
  ⚠**등록부에 내가 *"1차 대조를 정말 하는 자를 먼저 만들어야 한다"* 고 적었는데, 그것도 틀렸다.**
  **이미 있었다** — `num_exact_check.py` 다. 그 자의 머리말이 제 손으로 적고 있다:
  *"원문과 같으면 자동으로 canonical 로 올리되 … 이 도구가 그 **1차(기계 EXACT 대조)** 다."*
  ⇒ 이 자는 새 자를 만들지 않고 **그 자를 쪽마다 불러** 그 **결과**를 적는다(L-136 — 운영 자를 부른다).
    적는 것은 `맞음`(수치 토큰이 전부 raw 에 있다) 또는 `후보 N`(못 찾은 것이 N개) 이고,
    **못 찾은 것이 있으면 그 토큰을 그 줄에 적는다** — 2차를 볼 사람이 어디를 볼지 알게.

[★게이트를 속이지 않게 같이 고쳤다]
  `promote_guard.js`(V5-13)는 *"`§5-D`+`ⓑ`+`1차`+`2차`+`raw/` 가 한 줄에 있으면 기록이 있다"* 로 봤다.
  이 자가 적는 줄에도 그 낱말이 다 들어가므로 **그대로 두면 「1차만」이 「둘 다」로 통과한다.**
  ⇒ 게이트에 **`2차미이행` 이라는 낱말을 알아보게** 고쳤다. 그 줄은 **기록 있음으로 세지 않고**
    `1차만` 으로 따로 센다. **초록을 거짓으로 만들지 않는다**(G-49 — 빨간불에 기준선을 다시 굽지 않는다).

[★★적는 자리 — **위키 본문이 아니다.** 한 번 넣어 봤고, 챗봇 검색이 나빠졌다]
  처음엔 §5-D ⓒ-1 대로 그 쪽의 `## 변경 이력` 표에 한 줄씩 넣었다(987쪽). 표 행이라
  `markUnresolvedReview()` 가 통째로 버리니 **답변에는 영향이 없을 것**이라고 봤다. 그건 맞았다.
  ⚠**그런데 검색이 나빠졌다.** V5-7(골든 문항 근거 도달성)이 잡았다:

      내 변경 있음   chain 265 (95.0%) · search 14 · 나빠진 문항 1  → exit 1
      내 변경 치움   chain 266 (95.3%) · search 13 · 나빠진 문항 0  → exit 0
      (`git stash` 로 위키 변경만 치우고 같은 자를 다시 돌려 갈랐다 — L-383)

  떨어진 문항: 어선법 *"이 배가 국제협약(SOLAS 등) 적용 대상인지…"* (chain → search).
  ★**까닭**: `legal_retriever.scoreOne()` 은 **페이지 본문 전체**로 점수를 낸다(`page.body`).
  `termWeights()` 는 그 본문으로 **낱말 가중치(IDF)** 를 만든다. 987쪽에 **똑같은 글**을 넣으면
  그 글에 든 낱말이 「흔한 낱말」이 되어 가중치가 주저앉는다. **답변 마스킹과 검색 점수는 다른 길이다.**
  ⇒ **되돌렸다.** 기록은 여기 **딴 파일**에 적는다 — 위키 본문은 건드리지 않는다.
  ⚠승급할 때 한 쪽씩 적는 §5-D ⓒ-1 기록줄은 그대로 옳다. **987쪽 일괄 주입**이 다른 일이었다.
  ⬜남는 물음(사람이 정한다): **「변경 이력」을 검색 점수에서 뺄 것인가.** 과거 서술이라 빼는 것이
    옳아 보이지만 **챗봇이 고르는 쪽이 바뀌는 일**이라 여기서 정하지 않는다(G-34) → 등록부 `4-5`.

[적는 자리·꼴]
  `_dashboard/promote_first_pass.json` 한 파일 — 쪽마다 1차 결과와 「2차는 사람 몫」을 적는다.
  `promote_guard.js`(V5-13)가 이 파일을 읽어 **「1차만」으로 따로 센다**(둘 다 한 것으로 세지 않는다).

쓰는 법:
  python3 promote_first_pass.py              몇 쪽이 대상인지, 1차 결과가 어떤지 보여 준다
  python3 promote_first_pass.py --list       쪽마다 보여 준다
  python3 promote_first_pass.py --apply      `_dashboard/promote_first_pass.json` 을 쓴다
  python3 promote_first_pass.py --limit N    앞 N쪽만 (시험용)
"""
import os, re, sys, json, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')
sys.path.insert(0, HERE)
import num_exact_check as N1
from _touched import Touched

TODAY = datetime.date.today().isoformat()
# ⓑ 대상 — 낱말을 **여기 적지 않는다.** `_dashboard/bnum_words.json` 한 곳에서 읽는다.
# ★2026-09-25 — 처음엔 여기에 따로 적고 머리말에 *"promote_guard.js 와 같은 것을 쓴다"* 고 썼는데
#   **거짓이었다.** 그 자의 낱말이 더 넓었고(영업정지·이내·이상·톤·노트…) 그래서 수가 갈렸다.
#   같은 것을 세는 자가 둘이면 **규칙은 한 곳에만** 있어야 한다(뿌리 사슬 ⑥).
BNUM = re.compile(json.load(open(os.path.join(LEGAL, '_dashboard', 'bnum_words.json'),
                                 encoding='utf-8'))['정규식'])
# 이미 기록줄이 있는가 — 게이트와 같은 잣대(§5-D ⓒ-1)
BLINE = lambda l: ('§5-D' in l and 'ⓑ' in l and '1차' in l and '2차' in l and 'raw/' in l)
CANON = re.compile(r'^\s*(?:상태|status)\s*[:：]\s*`?canonical', re.M)
HIST = re.compile(r'^##+\s*변경\s*이력', re.M)


def pages():
    """canonical 이고 ⓑ 대상이며 **기록줄이 없는** 쪽만 돌려준다."""
    out = []
    for dp, _d, ns in os.walk(WIKI):
        for n in sorted(ns):
            if not n.endswith('.md'):
                continue
            fp = os.path.join(dp, n)
            try:
                t = open(fp, encoding='utf-8').read()
            except Exception:
                continue
            if not CANON.search(t):
                continue
            body = '\n'.join(N1.body_lines(fp))       # 변경이력·배너를 뺀 본문(운영 자를 그대로 쓴다)
            if not BNUM.search(body):
                continue
            if any(BLINE(l) for l in t.split('\n')):
                continue
            if not HIST.search(t):
                out.append((fp, t, '변경 이력 절이 없다'))
                continue
            out.append((fp, t, ''))
    return out


OUT = os.path.join(LEGAL, '_dashboard', 'promote_first_pass.json')


def main():
    show, apply_, lim = '--list' in sys.argv, '--apply' in sys.argv, 0
    if '--limit' in sys.argv:
        lim = int(sys.argv[sys.argv.index('--limit') + 1])
    todo = pages()
    if lim:
        todo = todo[:lim]
    print('기록줄이 없는 canonical·ⓑ대상 쪽 **%d개**' % len(todo))
    recs, ok, bad = {}, 0, 0
    for fp, _text, _note in todo:
        rel = os.path.relpath(fp, LEGAL)
        res = N1.check(fp)
        miss = res['원문에서못찾음']
        if miss:
            bad += 1
        else:
            ok += 1
        recs[rel] = {'1차': '맞음' if not miss else '후보있음',
                     '수치토큰': res['수치토큰'],
                     '못찾은토큰': miss[:20],
                     'raw폴더': res['raw폴더'][:2],
                     '2차': '미이행(사람 몫)',
                     '자': 'num_exact_check.py'}
        if show:
            print('  %-70s %s' % (rel.split('/')[-1][:70],
                                  '맞음' if not miss else '후보 %d' % len(miss)))
    print('  1차 결과 — 맞음 %d · 사람이 볼 후보 있음 %d' % (ok, bad))
    if not apply_:
        print('  (미리보기다. 적으려면 --apply)')
        return 0
    out = {
        '_왜': '§5-D ⓑ 의 「1차 기계대조」를 실제로 돌린 결과. 2차(다른 눈의 읽기)는 아직 아무도 안 했다.',
        '_결심': '2026-09-25 사장님 ⑪ⓒ — 기계가 할 1차만 적고 2차는 사람 몫이라 밝힌다.',
        '_왜_위키에_안_적나': ('987쪽 「변경 이력」에 한 줄씩 넣어 봤더니 V5-7 골든 문항이 나빠졌다'
                        '(chain 266→265 · search 13→14). `scoreOne()` 이 페이지 본문 전체로 점수를 내고'
                        ' `termWeights()` 가 그 본문으로 IDF 를 만들기 때문이다. 되돌리고 여기에 적는다.'),
        '_읽는곳': ['_dashboard/loop/promote_guard.js (V5-13 — 「1차만」으로 따로 센다)'],
        '_주의': '이 파일이 있다고 그 쪽이 맞는 것이 아니다 — 「그 숫자가 raw 어딘가에 있다」까지만 본다.',
        '센날': TODAY, '대상쪽': len(recs), '맞음': ok, '후보있음': bad, '쪽': recs,
    }
    touched = Touched('promote_first_pass.py')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    touched.add(OUT)
    touched.save()
    print('  ✅ %s 에 %d쪽을 적었다' % (os.path.relpath(OUT, LEGAL), len(recs)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
