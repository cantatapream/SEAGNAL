#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_broken_char.py — raw 법령 원문에 박힌 **깨진 글자(U+FFFD)** 를 창구 원문으로 메운다. (2026-09-27)

[무엇을 찾았나 — 2026-09-27, `3-37` 보류 대조 중에 드러났다]
  raw `.txt` **28개 파일 · 36자리 · 92글자**가 `U+FFFD`(`␦`) 다. 보기 —
    `특허권ㆍ실용신안권 또는 디␦␦␦인권`          ← 「디**자**인권」
    `다음 각 목의 사항을 ␦␦타내는 데`             ← 「**나**타내는」
    `수목유전자원의 증식 ␦␦␦의 시설`              ← 「증식 **등**의 시설」
    `상해에 이르게 한 때에는 무기징␦␦ 또는`        ← 「무기징**역**」
  ★**파일은 온전한 UTF-8 이다.** 즉 지금 깨진 게 아니라 **수집할 때 잘못 읽어 들인 것이 굳었다.**
  챗봇은 이 글을 그대로 내보낸다 — 조문을 인용하면 글자가 빠진 채 나간다.

[깨진 자리는 **한글 한 글자**다 — 실측으로 확인했다]
  한 자리에 `␦` 가 **3개(20자리)** 또는 **2개(16자리)** 다. 우연이 아니다:
    한글 한 글자는 UTF-8 로 **3바이트** · EUC-KR 로 **2바이트**.
    잘못 읽으면 그 바이트 하나하나가 `␦` 가 된다 ⇒ `␦`×3 = UTF-8 한 글자, `␦`×2 = EUC-KR 한 글자.
  그래서 메울 것은 **자리마다 글자 하나**다.

[★추측하지 않는다 — 어떻게 안전하게 메우나]
  ① 그 법의 **현행 MST** 를 `_meta.json` 에서 읽는다(`_판번호_보류` 에도 적혀 있다).
  ② 창구에서 현행 조문 전문을 받는다(`lawService.do?target=law&MST=`).
  ③ 깨진 자리의 **앞 12글자 + 뒤 12글자**(공백 지운 것)를 만들고,
     현행 글에서 `앞 + (글자 하나) + 뒤` 가 **단 한 자리에만** 맞는지 본다.
  ④ **한 자리면** 그 글자로 메운다. **0자리거나 두 자리 이상이면 아무것도 안 한다** — 적어만 둔다.
  ⇒ 즉 「그럴 것 같다」로는 한 글자도 고치지 않는다(환각 0 · G-34).

⚠**`_구판` 파일은 건드리지 않는다** — 일부러 남긴 옛 판이라 현행 글로 메우면 **판이 섞인다.**
   실측 36자리 중 2자리가 `_구판` 이다. 그 둘은 따로 적어 두고 남긴다.
⚠깨진 자리가 **우리가 붙인 쪽지 안**일 수도 있다. 그때는 현행 글에 앞뒤가 없으니 저절로 걸러진다.

[쓰는 법]
    python3 fix_broken_char.py              찾아서 무엇을 메울지 보여만 준다(미리보기)
    python3 fix_broken_char.py --apply      실제로 메운다 + `_touched` 기록을 남긴다
    python3 fix_broken_char.py --only 전자서명법
⚠망을 쓴다 — 게이트에서 부르지 않는다.

[연계] ← `3-37` 보류 대조(`meta_mst_holdover_diff.py`) 가 드러냈다
        ← 자: `meta_mst_recover.py`(창구 부르기·조문 받기) · 운영 `article_text`
        → 메운 뒤에는 `meta_mst_holdover_diff.py` 를 다시 돌려 「정말 다르다」가 줄었는지 본다
"""
import argparse
import datetime
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
TOUCHED = os.path.join(LEGAL, '_dashboard', 'touched')
REPORT = os.path.join(LEGAL, '_dashboard', 'broken_char_fix.json')

sys.path.insert(0, HERE)
import meta_mst_recover as R  # noqa: E402

F = '�'
깨진덩이 = re.compile(F + '+')
공백 = re.compile(r'\s+')
곁 = 12          # 앞뒤로 볼 글자 수(공백 지운 뒤)


def 눕히기(t):
    return 공백.sub('', str(t or ''))


def 찾기(only=None):
    """raw 전체에서 깨진 자리를 모은다. → [{파일, 자리, 개수, 앞, 뒤}]"""
    out = []
    for 뿌리, _d, fs in os.walk(RAW):
        for f in sorted(fs):
            if not f.endswith('.txt'):
                continue
            p = os.path.join(뿌리, f)
            rel = os.path.relpath(p, RAW)
            if only and only not in rel:
                continue
            try:
                t = io.open(p, encoding='utf-8').read()
            except Exception:
                continue
            if F not in t:
                continue
            for m in 깨진덩이.finditer(t):
                out.append({
                    '파일': rel, '자리': m.start(), '개수': len(m.group()),
                    '앞': 눕히기(t[max(0, m.start() - 60):m.start()])[-곁:],
                    '뒤': 눕히기(t[m.end():m.end() + 60])[:곁],
                    '구판': '_구판' in f,
                })
    return out


def 법폴더(rel):
    return os.path.dirname(rel)


def 계층이름(rel):
    """파일 이름에서 계층을 읽는다 — `시행령_발췌.txt` → `시행령`."""
    f = os.path.basename(rel)
    for 계 in ('시행규칙', '시행령', '법률', '규칙', '규정'):
        if f.startswith(계):
            return 계
    return '법률'


def MST후보들(폴더, 계층):
    """그 법에서 쓸 수 있는 MST 를 **차례대로** 모은다. → [(MST, 어디서)]

    ★계층에 맞는 것을 **먼저** 쓰고, 없거나 안 맞으면 다른 계층 것도 차례로 본다.
    ⚠**틀린 MST 를 써도 위험하지 않다** — 앞뒤 12자가 그 글에 없으면 그냥 실패한다.
      안전을 지키는 것은 MST 고르기가 아니라 **「단 한 글자만 허락한다」는 증명**이다.
      (2026-09-27: 계층만 보게 좁혔더니 관광진흥법 한 자리를 잃었다 — 느슨한 대안을 되살렸다.)
    """
    골 = []
    본, 어디 = 현행MST(폴더, 계층)
    if 본:
        골.append((본, 어디))
    p = os.path.join(RAW, 폴더, '_meta.json')
    try:
        m = json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return 골
    fam = m.get('families')
    if isinstance(fam, dict):
        for 계, v in fam.items():
            if isinstance(v, dict) and v.get('MST') and str(v['MST']) not in {x[0] for x in 골}:
                골.append((str(v['MST']), 'families.%s.MST(대안)' % 계))
    for k, v in m.items():
        if isinstance(v, (str, int)) and '일련번호' in str(k) and str(v).isdigit():
            if str(v) not in {x[0] for x in 골}:
                골.append((str(v), '%s(대안)' % k))
    for h in (m.get('_판번호_보류') or []):
        if h.get('현행 MST') and str(h['현행 MST']) not in {x[0] for x in 골}:
            골.append((str(h['현행 MST']), '_판번호_보류(대안)'))
    return 골


def 현행MST(폴더, 계층):
    """그 법 **그 계층**의 현행 MST.

    ⚠**처음에는 계층을 안 보고 `families` 의 첫 MST 를 집었다.** 그래서 `시행령_발췌.txt` 의
      깨진 자리를 **법률 본문에서** 찾게 되어 「앞뒤를 못 찾았다」가 6자리 났다(그중 5가 시행령).
      2026-09-27 실측으로 잡았다 — `_meta.families` 에는 `{법률:{MST}, 시행령:{MST}, 시행규칙:{MST}}`
      가 계층별로 따로 있다. **파일의 계층에 맞는 것만 쓴다.**
    """
    p = os.path.join(RAW, 폴더, '_meta.json')
    try:
        m = json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return None, '_meta.json 을 못 읽었다'
    fam = m.get('families')
    if isinstance(fam, dict):
        v = fam.get(계층)
        if isinstance(v, dict) and v.get('MST'):
            return str(v['MST']), 'families.%s.MST' % 계층
    # 열쇠 이름에 계층이 박힌 꼴 — `법령일련번호(시행령)`
    for k, v in m.items():
        if isinstance(v, (str, int)) and ('일련번호' in str(k)) and ('(%s)' % 계층) in str(k):
            return str(v), k
    for h in (m.get('_판번호_보류') or []):
        if h.get('현행 MST') and str(h.get('계층') or '법률') == 계층:
            return str(h['현행 MST']), '_판번호_보류(%s)' % 계층
    return None, '_meta.json 에 %s 의 MST 가 없다' % 계층


def 현행글(mst, 통=None):
    """그 판의 조문 전문을 한 덩이로 눕혀 둔다(한 법에 한 번만 받는다)."""
    if 통 is not None and mst in 통:
        return 통[mst]
    try:
        조 = R.articles(mst)
        글 = 눕히기(''.join(조.values()))
    except Exception as e:
        글 = None
        print('     ⚠창구가 답을 안 줬다 (MST %s) — %s' % (mst, str(e)[:60]))
    if 통 is not None:
        통[mst] = 글
    return 글


def 메울글자(앞, 뒤, 현행):
    """`앞 + ? + 뒤` 가 현행에서 **단 한 자리**에만 맞으면 그 글자. → (글자|None, 왜)"""
    if not (앞 and 뒤 and 현행):
        return None, '앞뒤나 현행 글이 비었다'
    골 = set()
    i = 0
    while True:
        j = 현행.find(앞, i)
        if j < 0:
            break
        뒷자리 = j + len(앞)
        # 한 글자 건너 뒤가 맞나
        if 현행[뒷자리 + 1:뒷자리 + 1 + len(뒤)] == 뒤:
            골.add(현행[뒷자리])
        i = j + 1
    if len(골) == 1:
        return 골.pop(), '앞 %d자 + 뒤 %d자 가 현행에서 한 글자만 허락한다' % (len(앞), len(뒤))
    if not 골:
        return None, '현행에서 그 앞뒤를 못 찾았다 (개정됐거나 우리 쪽지다)'
    return None, '맞는 글자가 %d가지다 — 고르지 않는다' % len(골)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--only', default=None)
    a = ap.parse_args()

    자리 = 찾기(a.only)
    print('▣ 깨진 글자(U+FFFD) %d자리 · %d글자 · 파일 %d개\n'
          % (len(자리), sum(x['개수'] for x in 자리), len({x['파일'] for x in 자리})))

    통 = {}
    결 = []
    for x in 자리:
        폴 = 법폴더(x['파일'])
        r = dict(x, 폴더=폴)
        if x['구판']:
            r.update(판정='건드리지 않는다', 왜='`_구판` 은 일부러 남긴 옛 판이다 — 현행 글로 메우면 판이 섞인다')
            결.append(r)
            continue
        계 = 계층이름(x['파일'])
        r['계층'] = 계
        후보 = MST후보들(폴, 계)
        if not 후보:
            r.update(판정='못 한다', 왜='_meta.json 에서 MST 를 하나도 못 찾았다')
            결.append(r)
            continue
        마지막 = ''
        for mst, 어디 in 후보:
            글 = 현행글(mst, 통)
            자, 왜 = 메울글자(x['앞'], x['뒤'], 글)
            마지막 = 왜
            if 자:
                r.update(판정='메운다', 글자=자, 왜=왜, **{'현행 MST': mst, 'MST 어디서': 어디})
                break
        else:
            r.update(판정='못 한다', 왜='%s (MST 후보 %d개를 다 봤다)' % (마지막, len(후보)),
                     **{'현행 MST': 후보[0][0], 'MST 어디서': 후보[0][1]})
        결.append(r)

    # ── 보여 준다
    for r in 결:
        표 = {'메운다': '✅', '못 한다': '❌', '건드리지 않는다': '⏭'}[r['판정']]
        print('%s %s  자리 %d · ␦×%d' % (표, r['파일'], r['자리'], r['개수']))
        print('     …%s[%s]%s…' % (r['앞'][-20:], r.get('글자') or ('␦' * r['개수']), r['뒤'][:20]))
        print('     %s' % r['왜'])
    셈 = {k: sum(1 for r in 결 if r['판정'] == k) for k in ('메운다', '못 한다', '건드리지 않는다')}
    print('\n── 합계 ── 메운다 %d · 못 한다 %d · 건드리지 않는다 %d'
          % (셈['메운다'],셈['못 한다'], 셈['건드리지 않는다']))

    # ── 실제로 메운다
    if a.apply:
        묶 = {}
        for r in 결:
            if r['판정'] == '메운다':
                묶.setdefault(r['파일'], []).append(r)
        고친파일 = []
        for rel, rs in 묶.items():
            p = os.path.join(RAW, rel)
            t = io.open(p, encoding='utf-8').read()
            # ★뒤에서부터 고친다 — 앞에서 고치면 뒤 자리가 밀린다
            for r in sorted(rs, key=lambda x: -x['자리']):
                s, e = r['자리'], r['자리'] + r['개수']
                if t[s:e] != F * r['개수']:
                    print('  ⚠자리가 안 맞는다 — 건너뛴다: %s %d' % (rel, s))
                    continue
                t = t[:s] + r['글자'] + t[e:]
            io.open(p, 'w', encoding='utf-8').write(t)
            고친파일.append('local_server/knowledge/legal/raw/' + rel)
            print('  ✅ %s — %d자리 메웠다' % (rel, len(rs)))
        if 고친파일:
            st = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-') + '%03d' % (
                datetime.datetime.now().microsecond // 1000)
            io.open(os.path.join(TOUCHED, 'fix_broken_char_%s.json' % st), 'w', encoding='utf-8').write(
                json.dumps({'script': 'fix_broken_char', 'stamp': st, 'files': 고친파일},
                           ensure_ascii=False, indent=1) + '\n')
            print('  ✅ 손댄 기록 남김 — touched/fix_broken_char_%s.json' % st)

    io.open(REPORT, 'w', encoding='utf-8').write(json.dumps({
        '잰날': datetime.date.today().isoformat(),
        '자': 'fix_broken_char.py',
        '뜻': ['raw 법령 원문에 박힌 깨진 글자(U+FFFD)를 창구 현행 원문으로 메운 기록.',
              '깨진 자리 하나 = 한글 한 글자(`␦`×3 은 UTF-8, `␦`×2 는 EUC-KR 바이트가 하나씩 깨진 것).',
              '★앞 12자 + 뒤 12자 가 현행에서 **단 한 글자만** 허락할 때에만 메운다 — 추측하지 않는다.',
              '`_구판` 은 건드리지 않는다 — 일부러 남긴 옛 판이다.'],
        '합계': 셈, '적용했나': bool(a.apply), '자리': 결}, ensure_ascii=False, indent=1) + '\n')
    print('\n✅ 적었다 — %s' % os.path.relpath(REPORT, LEGAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
