#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-75 · Q-19 — raw 의 그림 판독 블록에 **끝 표시**를 단다. (`【이미지판독 N】` … `【이미지판독 끝 N】`)

[왜 — 판독문이 어디서 끝나는지 기계가 몰랐다]
  사장님 결정(Q-19): 그림 판독문(AI 가 읽었든 사람이 옮겼든)은 **검색용으로만** 쓰고 답변 근거로 넘기지 않는다.
  그런데 raw 에는 판독 블록의 **시작 표시만** 있고 끝 표시가 없다:

      제33조(절연) … <img id="110881499"></img>
      【이미지판독 110881499】(원본이미지: _이미지/110881499.png)      ← 시작
      [표]
      | 전로의 정격전류(암페아) | 50미만 | … |                          ← 판독문
      사용자 확인(2026-08-23): 위 값은 …                               ← 우리 메모
      ⑥ 인체가 접촉할 우려가 있는 …                                     ← 다시 법 글(끝 표시 없음)

  블록 안의 꼴이 제각각이라(머리 없는 표 · `[도해]` · `[산식]` · `(단위 : …)` · 메모) 「다음 조·항까지」 같은
  규칙으로 자르면 **법 글을 함께 삼킨다** — 실측: 부칙 개정문 · 「1)」「다)」로 시작하는 줄 164줄이 걸렸다.

[어떻게 끝을 정하나 — 세 가지 증거, 모르면 법 글로 둔다]
  시작 표시 다음 줄부터 한 줄씩 본다:
    ① 그 그림의 판독 파일(`_이미지/N.txt`)에 있는 줄 → 판독문(블록 안)
    ② 판독 메모(「소유자가 원본을 보고」「사용자 확인」「REVIEW」「판독」…) → 블록 안
    ③ 표 줄·그림 머리(`|` · `[표]` · `[도해]` · `[산식]` · `(단위` …) → 블록 안
    ④ 조 머리(`제N조(`) · 부칙 · 다음 그림(`<img`·`【이미지판독`) → 멈춘다
       ★줄 **가운데**에 그림 꼬리표가 든 줄도 멈춘다(우리 메모 줄은 빼고) — 처음에는 줄머리만 봐서
         한 줄짜리 지침 본문(57,429자)이 블록에 들어가 조문 창 그림 16장이 사라졌다(V5-23 1069→1053) · 2,000자 넘는 줄도 멈춘다
    ⑤ 위 어디에도 안 걸리면 → **법 글로 보고 멈춘다**(삼키는 쪽보다 남기는 쪽이 안전하다)
    ⑥ 단, 「비고:」「여기서」처럼 그 자체로는 모르는 줄이라도 **바로 뒤 두 줄 안에 판독 파일의 긴 줄**이 오면 블록 안이다
  ★API 원문과 견주는 것도 해 봤다(111파일) — 그러나 「API 에 있다」도 「모른다」도 **똑같이 멈춘다**라
    끝 자리를 바꾸지 못했다. 게다가 고시 일부는 본문을 첨부 HWP 에서 옮겨 와 법 글이 API 에 없다
    (「폐기물처리신고업무처리지침」 ①~⑧ 등). 그래서 **망 없이** ①~⑤만으로 정한다.
  ⇒ 2026-10-06 실측: 블록 494개 · 판독 파일과 맞은 줄 3,668 · 표·그림 머리 343 · 메모 15 · 모르는 줄에서 멈춤 52.
    멈춘 52줄을 눈으로 보니 부칙·[별표]·「비고」·각 호 제목 같은 법 글이 대부분이었다.

[무엇을 하나] 블록 마지막 줄 다음에 `【이미지판독 끝 N】` 한 줄을 **끼워 넣기만** 한다. 지우는 글자는 없다.
  쓰는 곳: `services/picture_text.js` — 모델에 넘기는 근거에서 시작~끝을 「원문 그림」 표시로 바꾸고,
  조문 창(`article_text.js` cleanBody)에서도 그림만 보이게 한다.

쓰는 법:
    python3 _dashboard/loop/ocr_block_end.py              # 무엇을 달지 보여준다
    python3 _dashboard/loop/ocr_block_end.py --apply      # 끝 표시를 단다 · touched 기록
    python3 _dashboard/loop/ocr_block_end.py --check      # (망 없이) 시작마다 끝이 있나 · 끝 뒤에 판독문이 새나 — V5-56

[연계] → `raw/**/*.txt`(끝 표시 한 줄씩) · ← `_이미지/N.txt`(그 그림의 판독 파일)
       → `services/picture_text.js` · 게이트 V5-56
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')

START = re.compile(r'【이미지판독\s*(\d+)】')
END_FMT = '【이미지판독 끝 %s】'
END = re.compile(r'【이미지판독 끝\s*(\d+)】')
STRUCT = re.compile(r'^\s*(제\s*\d+\s*조(?:의\s*\d+)?\s*[\(（]|부\s*칙|<img|【이미지판독)')
NOTE = re.compile(r'소유자가 원본|사용자 확인|사용자가 원본|REVIEW|판독|원본이미지|오케스트레이터|옮겨 적|바로잡았|대조했'
                  r'|원본에서|원본대로|원본 그림|비전|OCR|전사|\.png')
HEADS = ('|', '[표', '[도해', '[산식', '[수식', '[그림', '(단위', '<그림')
IMG_MID = re.compile(r'<img\s+id="\d+"')
LONG = 2000


def _is_memo(s):
    """그림 꼬리표를 **언급만 하는** 우리 메모 줄인가(「(조문 안 <img id=…>)」). 긴 줄은 메모가 아니다 —
    ★2026-10-06: 지침 본문 57,429자가 한 줄인 파일에서 그 안의 「…판독…」 낱말 하나로 메모로 잘못 보아
      본문 전체가 블록에 들어갔고 조문 창 그림 16장이 사라졌다(V5-23 1069→1053)."""
    return len(s) <= 300 and (bool(NOTE.search(s)) or '조문 안' in s)


def norm(s):
    return re.sub(r'\s|<[^>]+>|[「」『』“”"\'·ㆍ|*]', '', s)


def files_with_blocks():
    out = []
    for p in sorted(glob.glob(os.path.join(RAW, '**', '*.txt'), recursive=True)):
        if '/_이미지/' in p:
            continue
        try:
            if '【이미지판독' in open(p, encoding='utf-8').read():
                out.append(p)
        except Exception:
            pass
    return out


def _soon_in(lines, j, tt):
    """j 줄 뒤 두 줄 안에 **판독 파일에 있는 긴 줄**(12자 이상)이 오나 — 표 밑 「비고」처럼 그림 안에 있던 글이다.
    ★2026-10-06 — 이것이 없을 때 끝 표시 14개가 너무 일찍 달렸다(끝 뒤 「비고: 1. "항해예정시간"이란…」 등이
      그 그림의 판독 파일에 있고 API 원문에는 없었다 = 그림 안의 글)."""
    seen = 0
    for k in range(j + 1, min(j + 6, len(lines))):
        s = lines[k]
        if START.search(s) or END.search(s) or STRUCT.match(s):
            return False
        key = norm(s)[:40]
        if not key:
            continue
        seen += 1
        if len(key) >= 12 and key in tt:
            return True
        if seen >= 2:
            return False
    return False


def extents(lines, imgdir):
    """[(시작줄, 마지막줄, 그림번호)] — 시작 표시가 있고 아직 끝 표시가 없는 블록만."""
    out, i = [], 0
    while i < len(lines):
        m = START.search(lines[i])
        if not m or END.search(lines[i]):
            i += 1
            continue
        n = m.group(1)
        tp = os.path.join(imgdir, n + '.txt')
        tt = norm(open(tp, encoding='utf-8').read()) if os.path.exists(tp) else ''
        j, last, ended = i + 1, i, False
        while j < len(lines):
            s = lines[j]
            if END.search(s):
                ended = True
                break
            if START.search(s) or STRUCT.match(s):
                break
            if len(s) > LONG:
                break                                       # ④'' 아주 긴 줄은 법 본문이다(한 줄에 지침 본문 5만 자가 든 파일이 있다)
            if IMG_MID.search(s) and not _is_memo(s):
                break                                       # ④' 줄 가운데에 그림 꼬리표가 든 법 글(「…시행<img id=…>다.」)
            k = norm(s)[:40]
            if not k:
                j += 1
                continue
            if tt and len(k) >= 4 and k in tt:
                pass                                        # ① 판독 파일에 있는 줄
            elif NOTE.search(s):
                pass                                        # ② 우리 메모
            elif s.lstrip().startswith(HEADS) or ' | ' in s:
                pass                                        # ③ 표 줄·그림 머리
            elif tt and _soon_in(lines, j, tt):
                pass                                        # ⑥ 「비고:」「여기서」 같은 줄 — 바로 뒤가 판독 파일에 있다
            else:
                break                                       # ⑤ 모르는 줄 — 법 글로 두고 멈춘다
            last = j
            j += 1
        if not ended:
            out.append((i, last, n))
        i = last + 1
    return out


def check():
    """망 없이 — ⓐ 시작마다 끝이 있나 ⓑ 끝 표시 바로 뒤 줄이 그 그림의 판독 파일에 있는 줄이 아닌가(새는 것)."""
    bad_open, leak, n = [], [], 0
    for p in files_with_blocks():
        lines = open(p, encoding='utf-8').read().split('\n')
        imgdir = os.path.join(os.path.dirname(p), '_이미지')
        rel = os.path.relpath(p, RAW)
        i = 0
        while i < len(lines):
            m = START.search(lines[i])
            if not m or END.search(lines[i]):
                i += 1
                continue
            n += 1
            num = m.group(1)
            j = i + 1
            while j < len(lines) and not END.search(lines[j]) and not START.search(lines[j]):
                j += 1
            if j >= len(lines) or not END.search(lines[j]) or END.search(lines[j]).group(1) != num:
                bad_open.append('%s:%d 【이미지판독 %s】' % (rel, i + 1, num))
                i += 1
                continue
            for k in range(i + 1, j):                     # 블록 안에 법 글의 그림 꼬리표가 들어가 있으면 그 그림이 화면에서 사라진다
                if (IMG_MID.search(lines[k]) and not _is_memo(lines[k])) or len(lines[k]) > LONG:
                    leak.append('%s:%d 블록 안에 그림 꼬리표 — %s' % (rel, k + 1, lines[k].strip()[:60]))
            tp = os.path.join(imgdir, num + '.txt')
            if os.path.exists(tp):
                tt = norm(open(tp, encoding='utf-8').read())
                for k in range(j + 1, min(j + 4, len(lines))):
                    s = lines[k]
                    key = norm(s)[:40]
                    if STRUCT.match(s) or START.search(s):
                        break
                    if len(key) >= 12 and key in tt:
                        leak.append('%s:%d %s' % (rel, k + 1, s.strip()[:80]))
            i = j + 1
    print('판독 블록 %d개 · 끝 표시 없음 %d · 끝 뒤로 판독문이 샌 줄 %d' % (n, len(bad_open), len(leak)))
    for x in (bad_open + leak)[:30]:
        print('  ❌', x)
    return 1 if (bad_open or leak) else 0


def run():
    if '--check' in sys.argv:
        return check()
    apply_ = '--apply' in sys.argv
    files = files_with_blocks()
    touched = None
    if apply_:
        sys.path.insert(0, HERE)
        from _touched import Touched
        touched = Touched('ocr_block_end')
    tot = 0
    for p in files:
        rel = os.path.relpath(p, RAW)
        text = open(p, encoding='utf-8').read()
        lines = text.split('\n')
        ex = extents(lines, os.path.join(os.path.dirname(p), '_이미지'))
        if not ex:
            continue
        for s, e, n in reversed(ex):
            lines.insert(e + 1, END_FMT % n)
        tot += len(ex)
        print('· %-70s 끝 표시 %3d' % (rel[:70], len(ex)))
        if apply_:
            touched.add(p)
            open(p, 'w', encoding='utf-8').write('\n'.join(lines))
    print('\n=== 끝 표시 %d개 · 판독 블록이 든 파일 %d개 ===' % (tot, len(files)))
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(run())
