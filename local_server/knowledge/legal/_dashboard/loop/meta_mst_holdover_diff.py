#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""meta_mst_holdover_diff.py — `3-37` 보류 27건을 **조 하나씩 글로** 대조한다. (2026-09-27)

[왜 있나 — 등록부 3-37 이 스스로 적어 둔 것]
  `meta_mst_recover.py` 는 판번호를 되찾을 때 **우리가 담은 글이 현행에 그대로 있는지** 보고,
  아니면 번호를 적지 않고 `_meta._판번호_보류` 에 올린다(27건). 그 기록에 적힌 것은
  **「우리 글의 67%만 현행에 있다」처럼 덮임 비율 하나**뿐이다.
  그런데 같은 칸이 이렇게 적고 있다 —
    *"⚠남은 24건을 「낡았다」로 등록하지 않는다 — 후보를 직접 열어 봤더니 근거가 약했다:
      노인복지법(덮임 37%)의 제26조는 현행과 222자 대 222자로 똑같았다(차이는 조 머리 한 줄뿐).
      **덮임 비율만으로는 낡음의 증거가 못 된다** — 발췌본은 분모가 작아 한 조만 어긋나도 비율이 급락한다."*
  ⇒ **비율로는 사람이 판단할 수 없다.** 어느 조가 어떻게 다른지를 내놓아야 한다.
  이 자가 그 일을 한다: 조 하나씩 견주어 **같다 / 표시만 다르다 / 정말 다르다 / 현행에 없다** 로 가른다.

[세는 법을 새로 만들지 않는다 — L-136]
  글을 눕히는 법(`norm`)·우리 글에서 쪽지를 걷어내는 법(`our_text`)·현행 조문을 받는 법(`articles`)은
  전부 `meta_mst_recover.py` 것을 **그대로 불러 쓴다.** 여기서 다시 구현하면 두 자가 갈린다(L-386).

[가르는 법 — 무엇을 「다르다」로 보나]
  우리 파일의 한 조 글 `A`, 현행 그 조 글 `B` 를 `norm()` 으로 눕혀(개정표시 떼고 공백 지움) 견준다.
  · `A == B`                        → **같다**
  · `A` 가 `B` 안에 통째로 있다      → **같다(발췌)** — 우리는 발췌본이라 ①항만 담기도 한다
  · 조 자체가 현행에 없다            → **현행에 없다** ⚠시행예정 조일 수 있다(3-37 의 노인복지법 제26조의2 선례)
  · 그 밖                            → **정말 다르다** + 어디서부터 갈리는지 **앞뒤 60자**를 낸다
  ★「다르다」에는 **갈리는 자리와 양쪽 글**을 같이 낸다 — 그것이 없으면 사람이 또 못 고른다.

[쓰는 법]
    python3 meta_mst_holdover_diff.py            보류 전부를 대조해 표로 찍는다
    python3 meta_mst_holdover_diff.py --save     `_dashboard/mst_holdover_diff.json` 에 적는다
    python3 meta_mst_holdover_diff.py --only 노인복지법
⚠망을 쓴다 — 게이트에서 부르지 않는다.

[연계] ← 등록부 `3-37` · `_meta.json` 의 `_판번호_보류`
        ← 자: `meta_mst_recover.py`(같은 폴더) · 창구 `lawService.do?target=law&MST=`
"""
import argparse
import importlib.util
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(LEGAL, '_dashboard', 'mst_holdover_diff.json')

# ★같은 폴더의 자를 그대로 불러 쓴다(L-136) — 이름에 숫자가 없어 그냥 import 된다.
sys.path.insert(0, HERE)
import meta_mst_recover as R  # noqa: E402

조머리 = re.compile(r'^\[(제\d+조(?:의\d+)?)\]\s*(.*)$')

# ★우리 파일은 조 본문 맨 앞에 `제26조(경로우대)` 를 **한 번 더** 적는다. 창구는 `①` 부터 준다.
#   ⚠이것을 안 떼고 견주면 **글이 똑같은 조가 「정말 다르다」로 나온다** — 등록부 3-37 이
#   *"노인복지법 제26조는 현행과 222자 대 222자로 똑같았다(차이는 조 머리 한 줄뿐)"* 라고
#   적어 둔 그 함정이고, 나는 2026-09-27 에 그 함정에 그대로 걸렸다. 그래서 떼고 견준다.
조앞머리 = re.compile(r'^제\d+조(?:의\d+)?\s*(?:\([^)]{0,40}\))?')


# ★우리가 붙인 쪽지의 **시작** 꼴. `meta_mst_recover.OURS_LINE_RE` 가 잡는 것들에 더해
#   가로줄로 시작하는 합침 기록(`── 같은 조가 이 파일에 여러 번 수집돼 있었다…`)이 있다.
쪽지시작 = re.compile(r'^\s*(?:──|—-|――)')
# ★**법 원문 꼴** 줄. 쪽지 덩이는 이 꼴을 만나면 끝난다.
법원문줄 = re.compile(r'^\s*(?:제\d+조|[①-⑳]|\d{1,2}\.|[가-하]\.|\(\d+\)'
                   r'|\[(?:전문개정|본조신설|신설|개정|삭제|제목개정)|<)')


def 쪽지빼기(내용):
    """조 본문에서 **우리가 붙인 쪽지 덩이만** 뺀다. → 남은 법 원문

    [왜 이렇게 되었나 — 자를 네 번 고쳤다(2026-09-27). 넷 다 **내 자가 틀린 것**이다(L-382)]
      ① 쪽지의 **첫 줄**만 걸러졌다 — `meta_mst_recover.OURS_LINE_RE` 는 이어지는 들여쓴 줄을 못 잡는다.
         노인복지법: `⚠[2026-09-25] …` 다음 두 줄이 법 원문으로 새어 **같은 조가 「정말 다르다」**로 나왔다.
      ② 「첫 쪽지 줄에서 **끊는다**」로 고쳤더니 더 크게 틀렸다 — 쪽지는 조 글 **앞에도** 붙는다.
         초중등교육법 제2조의 첫 줄이 `※ 서해5도지원법… 인용 (2026-08-28 …)` 이라 원문이 통째로 날아가
         27건 중 24건이 **거짓 「정말 다르다」**(91조)로 나왔다.
      ③ 쪽지만 빼게 고쳤더니 **가로줄 쪽지**(`── 같은 조가 이 파일에 여러 번 수집돼 있었다…`)가
         남았다. 교통약자 제9조가 그 탓에 「우리 231자 vs 현행 91자」로 보였다 — **낡음이 아니라 쪽지다.**
      ④ ⇒ 지금 규칙: **쪽지 덩이는 쪽지 시작 줄에서 열리고 「법 원문 꼴」 줄에서 닫힌다.**
         27건 파일 전수로 재니 안 걸러지던 줄은 **42줄·40가지**뿐이고 그 정체가 뚜렷했다.
    ⚠**놓치는 쪽으로 기울지 않는다** — 쪽지가 법 원문 꼴이 아닌 원문(호가 여러 줄로 이어진 자리)을
      삼키면 「다르다」가 더 나온다. 그건 **사람에게 더 보이는 쪽**이라 조용히 틀리지 않는다.
    """
    남, 쪽지중 = [], False
    for ln in str(내용 or '').split('\n'):
        if R.OURS_LINE_RE.match(ln) or 쪽지시작.match(ln):
            쪽지중 = True
            continue
        if 쪽지중:
            if 법원문줄.match(ln):
                쪽지중 = False          # 법 원문이 다시 시작한다
            else:
                continue                # 쪽지의 이어지는 줄
        남.append(ln)
    return '\n'.join(남)


def 우리조들(text):
    """우리 파일을 `[제N조] 이름` 머리로 갈라 `{조: 글}` 로 만든다.

    ⚠머리줄이 하나도 없는 파일도 있다. 그때는 `{}` 를 돌려주고 부르는 쪽이
      「조로 가를 수 없다」로 적는다 — **없는 조를 지어내지 않는다.**
    """
    out, 지금, 쌓 = {}, None, []
    for ln in str(text or '').split('\n'):
        m = 조머리.match(ln.strip())
        if m:
            if 지금:
                out[지금] = '\n'.join(쌓)
            지금, 쌓 = m.group(1), []
            continue
        if 지금 is not None:
            쌓.append(ln)
    if 지금:
        out[지금] = '\n'.join(쌓)
    return out


def 토막가르기(t):
    """눕힌 조 글을 **항·호 토막**으로 가른다. → [토막…]

    ★왜 필요한가 (2026-09-27 · 자를 세 번 고친 끝에) — 창구는 **호 목록을 조 머리 앞에** 놓는다.
      초중등교육법 제2조: 우리 `초ㆍ중등교육을…둔다.1.초등학교2.중학교…`
                        현행 `1.초등학교2.중학교…5.각종학교제2조(학교의종류)초ㆍ중등교육을…둔다.`
      **글은 같고 차례만 다르다.** `covered()` 의 30자 창은 이음매(`…둔다.1.초등학`)를 넘지 못해
      33%로 떨어진다(반쪽 나누기도 양쪽이 다 이음매에 걸려 못 넘었다).
      ⇒ **토막으로 가른 뒤 집합으로 견주면** 차례가 달라도 맞는다. 그리고 사람에게 보여 줄 근거도
      30자 창 토막보다 「제1호가 현행에 없다」가 훨씬 낫다.
    ⚠이것은 `covered()` 를 **대신하지 않는다** — 창으로 먼저 보고, 창이 못 넘을 때만 마지막으로 본다.
    """
    쪼 = re.split(r'(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])|(?<=[.。])(?=\d{1,2}\.)|(?=제\d+조)', str(t or ''))
    return [x for x in (y.strip() for y in 쪼) if len(x) >= 8]


def 갈린자리(a, b):
    """눕힌 두 글이 **어디서부터** 갈리나. → (자리, 우리쪽 60자, 현행쪽 60자)"""
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    return i, a[i:i + 60], b[i:i + 60]


def 보류모으기(only=None):
    모 = []
    for 뿌리, _d, fs in os.walk(RAW):
        if '_meta.json' not in fs:
            continue
        p = os.path.join(뿌리, '_meta.json')
        try:
            m = json.load(io.open(p, encoding='utf-8'))
        except Exception:
            continue
        for h in (m.get('_판번호_보류') or []):
            rel = os.path.relpath(뿌리, RAW)
            if only and only not in rel:
                continue
            모.append({'폴더': rel, '뿌리': 뿌리, '기록': h})
    return 모


def 계층파일(뿌리, 계층):
    """그 계층의 우리 파일. 발췌본이 있으면 그것도 본다(둘 다 런타임이 읽는다)."""
    골 = []
    for 이름 in ('%s.txt' % 계층, '%s_발췌.txt' % 계층):
        p = os.path.join(뿌리, 이름)
        if os.path.exists(p):
            골.append(p)
    return 골


def 한건(it):
    h = it['기록']
    mst = str(h.get('현행 MST') or '')
    결 = {'폴더': it['폴더'], '계층': h.get('계층'), '현행 MST': mst,
          '현행 시행일': h.get('현행 시행일'), '적힌 덮임': (h.get('다른 조') or [None])[0],
          '파일': [], '조': [], '요약': ''}
    파일들 = 계층파일(it['뿌리'], str(h.get('계층') or '법률'))
    if not 파일들:
        결['요약'] = '우리 파일을 못 찾았다'
        return 결
    if not mst:
        결['요약'] = '보류 기록에 현행 MST 가 없다'
        return 결
    try:
        현행 = R.articles(mst)
    except Exception as e:
        결['요약'] = '창구가 답을 안 줬다 — %s' % str(e)[:60]
        return 결
    if not 현행:
        결['요약'] = '창구가 조문을 안 줬다 (MST %s)' % mst
        return 결

    센다 = {'같다': 0, '같다(차례만 다르다)': 0, '정말 다르다': 0,
            '현행에 없다': 0, '우리 글이 없다': 0}
    for p in 파일들:
        결['파일'].append(os.path.relpath(p, LEGAL))
        글 = io.open(p, encoding='utf-8', errors='replace').read()
        조들 = 우리조들(글)
        if not 조들:
            결['조'].append({'조': '(조 머리 없음)', '판정': '조로 가를 수 없다',
                             '왜': '`[제N조]` 머리줄이 없어 조 단위로 못 가른다 — 파일 전체로만 견줄 수 있다'})
            continue
        for 조, 내용 in 조들.items():
            A = 조앞머리.sub('', R.norm(R.our_text('머리\n' + 쪽지빼기(내용))))
            B = 조앞머리.sub('', R.norm(현행.get(조, '')))              # 창구도 드물게 붙여 준다
            if 조 not in 현행:
                판, 덧 = '현행에 없다', {'⚠': '시행예정 조일 수 있다 — 임자를 확인하기 전에는 낡음으로 적지 않는다'}
            elif not A:
                판, 덧 = '우리 글이 없다', {'왜': '쪽지를 빼니 남는 원문이 없다 — 그 조에 우리가 담은 글이 없다'}
            elif A == B:
                판, 덧 = '같다', {}
            else:
                # ★앞에서부터 견주면 안 된다 — **창구가 호 목록을 조 머리 앞에 놓는다.**
                #   실측(초중등교육법 제2조): 우리 `초ㆍ중등교육을…둔다.1.초등학교…` ↔
                #   현행 `1.초등학교…5.각종학교제2조(학교의종류)초ㆍ중등교육을…`. **글은 같고 차례만 다르다.**
                #   ⇒ 검증된 운영 자 `covered()` 로 재고, **못 찾은 창**을 근거로 낸다(자를 새로 만들지 않는다).
                덮, 못찾 = R.covered_windows(A, B)
                if 덮 >= 0.999:
                    판, 덧 = '같다(차례만 다르다)', {'우리 글자수': len(A), '현행 글자수': len(B)}
                else:
                    # ★창이 못 넘는 이음매가 있다 — **토막 집합**으로 마지막으로 본다.
                    내토막 = 토막가르기(A)
                    없토막 = [x for x in 내토막 if x not in B]
                    if 내토막 and not 없토막:
                        판, 덧 = '같다(차례만 다르다)', {
                            '창 덮임': round(덮, 3), '토막': len(내토막),
                            '왜': '창으로는 %.0f%% 였지만 항·호 토막 %d개가 **현행에 모두 있다** — 차례만 다르다'
                                  % (100 * 덮, len(내토막))}
                    else:
                        판 = '정말 다르다'
                        덧 = {'창 덮임': round(덮, 3), '우리 글자수': len(A), '현행 글자수': len(B),
                              '현행에 없는 토막': 없토막[:6], '없는 토막 수': len(없토막),
                              '우리 토막 수': len(내토막)}
            센다[판] = 센다.get(판, 0) + 1
            결['조'].append(dict({'조': 조, '판정': 판}, **덧))
    결['센다'] = 센다
    결['요약'] = ' · '.join('%s %d' % (k, v) for k, v in 센다.items() if v)
    return 결


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--save', action='store_true')
    ap.add_argument('--only', default=None)
    a = ap.parse_args()

    모 = 보류모으기(a.only)
    print('▣ `_판번호_보류` %d건을 **조 하나씩** 대조한다 (덮임 비율이 아니라 글로)\n' % len(모))
    결과 = []
    합 = {'같다': 0, '같다(차례만 다르다)': 0, '정말 다르다': 0,
         '현행에 없다': 0, '우리 글이 없다': 0}
    for it in 모:
        r = 한건(it)
        결과.append(r)
        for k, v in (r.get('센다') or {}).items():
            합[k] = 합.get(k, 0) + v
        표 = '✅' if (r.get('센다') or {}).get('정말 다르다', 0) == 0 and r.get('센다') else '❗'
        print('%s %-46s %s' % (표, r['폴더'][:46], r['요약']))
        print('     적힌 덮임: %s' % (r['적힌 덮임'] or '—'))
        for c in r['조']:
            if c['판정'] in ('정말 다르다', '현행에 없다', '조로 가를 수 없다', '우리 글이 없다'):
                print('       ❗%s — %s%s' % (c['조'], c['판정'],
                      (' (토막 %d개 중 %d개가 현행에 없다 · 창 덮임 %.0f%%)'
                       % (c.get('우리 토막 수') or 0, c.get('없는 토막 수') or 0, 100 * (c.get('창 덮임') or 0)))
                      if c.get('없는 토막 수') is not None else ''))
                for t in (c.get('현행에 없는 토막') or []):
                    print('           현행에 없다 «%s»' % t)
                if c.get('왜'):
                    print('           %s' % c['왜'])
        print()

    print('── 조 단위 합계 ──')
    for k, v in 합.items():
        print('   %-12s %d' % (k, v))
    정말 = [r for r in 결과 if (r.get('센다') or {}).get('정말 다르다', 0)]
    없다 = [r for r in 결과 if (r.get('센다') or {}).get('현행에 없다', 0)]
    못 = [r for r in 결과 if not r.get('센다')]
    print('\n★사람이 볼 것 — **정말 다른 조가 있는 법 %d개**' % len(정말))
    for r in 정말:
        print('     %s (%s)' % (r['폴더'], r['요약']))
    print('★현행에 없는 조가 있는 법 %d개 (시행예정일 수 있다 — 낡음으로 적지 않는다)' % len(없다))
    for r in 없다:
        print('     %s' % r['폴더'])
    print('★대조 자체를 못 한 것 %d개' % len(못))
    for r in 못:
        print('     %s — %s' % (r['폴더'], r['요약']))

    if a.save:
        io.open(OUT, 'w', encoding='utf-8').write(
            json.dumps({'잰날': __import__('datetime').date.today().isoformat(),
                        '자': 'meta_mst_holdover_diff.py',
                        '뜻': ['`3-37` 의 `_판번호_보류` 를 **조 하나씩 글로** 대조한 것.',
                              '덮임 비율은 발췌본에서 분모가 작아 한 조만 어긋나도 급락한다 — 그것으로는 낡음을 못 가린다.',
                              '「현행에 없다」는 **시행예정 조일 수 있다** — 임자를 확인하기 전에는 낡음으로 적지 않는다.'],
                        '합계': 합, '건': 결과}, ensure_ascii=False, indent=1) + '\n')
        print('\n✅ 적었다 — %s' % os.path.relpath(OUT, LEGAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
