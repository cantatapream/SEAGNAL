#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발췌본의 조 하나를 **창구(DRF)의 현행 원문으로 다시 받는다** — 사장님 확정 2026-09-29 (확인판 B1 ⓐ · B2 ⓐ).

[왜 있나]
  남의 법에서 필요한 조만 떼어 받아 둔 발췌본(`raw/15_관련타부처/…/법률_발췌.txt` 등) 가운데
  **지금 시행 중인 글과 다른 조**가 있었다(3-37 · `mst_holdover_diff.json`). 셋은 원문이 아니라
  **우리가 줄여 쓴 글**이었고(「요약·재해석 금지」 위반), 하나는 호가 빠졌고, 하나는 글자가 깨졌다.
  경비업법 제4조(U-3)는 ②항 2호의 가·나목이 통째로 없었다.

[무엇을 하나]
  선언(`TARGETS`)에 적힌 조마다
    ① 법 이름으로 **현행 MST** 를 찾고(`collect.find_mst` 와 같은 목록 조회) 현행 판 본문을 받는다
       (`collect.fetch_body` → `law_api_guard.fetch_law_body` — 시행일을 못 박아 옛 판·예정 판을 피한다).
    ② 조를 우리 raw 와 **같은 꼴**로 편다 — `recollect_jomun.article_lines` 를 그대로 부른다(L-136).
    ③ 우리 파일의 그 조 덩이와 글자로 견준다(빈칸·`<개정 …>` 꼬리표만 떼고). **같으면 손대지 않는다.**
    ④ 다르면 그 덩이만 갈아 끼운다. 머리줄은 `[제N조] 제목 (시행 … · MST … · 2026-09-29 현행으로 다시 받음 — 3-37)`.
       파일이 괄호 없는 머리(`제1조(목적)`)를 쓰면 그 꼴을 지킨다.
  바꾼 것은 전·후 글을 `_dashboard/excerpt_refresh_current.json` 에 남기고, 파일은 `_touched` 로 기록한다.

[하지 않는 것]
  · 조를 **새로 더하지 않는다** — 선언에 `더함` 이 있을 때만(경비업법 제4조의2 — 제4조 덩이 안에 머리 없이
    섞여 있던 조를 제 머리로 떼어 낸다).
  · 현행 판을 못 정하면 **아무것도 안 한다**(틀릴 수 있는 판을 쓰느니 안 쓴다).
  · `_meta.json` 의 판번호는 여기서 적지 않는다 — 다시 받은 뒤 `meta_mst_recover.py` 가 글을 견줘서 적는다.

[실행]
  python3 excerpt_refresh_current.py            무엇이 바뀔지 보기만 한다
  python3 excerpt_refresh_current.py --apply    바꾼다

[연계] ← 00_WORKLIST 3-37 · U-3 · review_html/나리야_확인판.html(B1·B2)
       → collect.py(find_mst·fetch_body) · recollect_jomun.article_lines · _touched.py
       → meta_measured_refresh.js --only(바이트·조문수 실측 칸) · meta_mst_recover.py(판번호)
"""
import json, os, re, sys, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect as C
import recollect_jomun as RJ
from _touched import Touched

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
REPORT = os.path.join(LEGAL, '_dashboard', 'excerpt_refresh_current.json')
TODAY = '2026-09-29'

# 법 이름은 창구의 정식 이름(띄어쓰기·가운뎃점 그대로). 조는 우리 파일의 조 번호.
TARGETS = [
    {'파일': '15_관련타부처/신문등의진흥에관한법률/법률_발췌.txt', '법': '신문 등의 진흥에 관한 법률', '조': ['제9조'], '까닭': '요약해 적었다'},
    {'파일': '15_관련타부처/소방시설설치및관리에관한법률/법률_발췌.txt', '법': '소방시설 설치 및 관리에 관한 법률', '조': ['제6조'], '까닭': '요약해 적었다'},
    {'파일': '15_관련타부처/토지이용규제기본법/법률_발췌.txt', '법': '토지이용규제 기본법', '조': ['제8조'], '까닭': '요약해 적었다'},
    {'파일': '15_관련타부처/총포도검화약류등의안전관리에관한법률시행령/시행령_발췌.txt', '법': '총포ㆍ도검ㆍ화약류 등의 안전관리에 관한 법률 시행령', '조': ['제3조'], '까닭': '현행과 다르다(개정)'},
    {'파일': '15_관련타부처/해양수산정보의수집관리및공동이용에관한규칙/법률_발췌.txt', '법': '해양수산정보의 수집ㆍ관리 및 공동이용에 관한 규칙', '조': ['제3조'], '까닭': '9호가 빠졌다'},
    {'파일': '15_관련타부처/성폭력범죄의처벌등에관한특례법/법률_발췌.txt', '법': '성폭력범죄의 처벌 등에 관한 특례법', '조': ['제3조'], '까닭': '견주는 자가 머리 꼴을 못 읽었다 — 글자로 다시 견준다'},
    {'파일': '15_관련타부처/형의실효등에관한법률/법률.txt', '법': '형의 실효 등에 관한 법률', '조': ['제1조', '제2조', '제7조'], '까닭': '조 머리가 괄호 없는 꼴이라 견주는 자가 못 갈랐다 — 글자로 다시 견준다'},
    {'파일': '15_관련타부처/대한민국국기법시행령/시행령_발췌.txt', '법': '대한민국국기법 시행령', '조': ['제14조'], '까닭': '깨진 글자 1개'},
    {'파일': '15_관련타부처/경비업법/법률.txt', '법': '경비업법', '조': ['제4조'], '더함': {'제4조': ['제4조의2']}, '까닭': 'U-3 — ②2호 가·나목이 없다'},
]

HEAD_RE = re.compile(r'^\[(제\d+조(?:의\d+)?)(?:\(([^)]*)\))?\]\s*(.*)$')     # [제3조] 제목 … · [제3조(제목)]
BARE_RE = re.compile(r'^(제\d+조(?:의\d+)?)\(([^)]*)\)\s*(.*)$')              # 제1조(목적) …


def norm(t):
    t = re.sub(r'<(?:개정|신설|전문개정|본조신설|제목개정|타법개정)[^>]*>', '', t)
    return re.sub(r'\s+', '', t)


def current(name):
    q = urllib.parse.quote(name)
    d = C.api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={C.OC}&target=eflaw&type=JSON&display=100&query={q}")
    laws = (d or {}).get('LawSearch', {}).get('law', [])
    laws = laws if isinstance(laws, list) else [laws]
    hit = [l for l in laws if l.get('현행연혁코드') == '현행' and l.get('법령명한글') == name]
    if not hit:
        return None, None, None
    mst = hit[0]['법령일련번호']
    cache = os.path.join('/tmp', 'excerpt_refresh_%s.json' % mst)
    body = json.load(open(cache)) if os.path.exists(cache) else C.fetch_body(mst)
    if body and not os.path.exists(cache):
        json.dump(body, open(cache, 'w'), ensure_ascii=False)
    if not body:
        return mst, None, None
    units = RJ.L(body.get('법령', {}).get('조문', {}).get('조문단위'))
    arts = {}
    for a in units:
        if a.get('조문여부') != '조문':
            continue
        ga = RJ.s(a.get('조문가지번호'))
        no = '제%s조' % RJ.s(a.get('조문번호')) + ('의%s' % int(ga) if ga and ga.strip('0') else '')
        arts[no] = a
    return mst, body.get('법령', {}).get('기본정보', {}).get('시행일자'), arts


def blocks(lines):
    """파일을 (머리 줄 번호, 조 번호, 꼴) 덩이로 가른다. 머리 앞 머리말은 덩이가 아니다."""
    out = []
    bare = not any(HEAD_RE.match(l) for l in lines)       # 괄호 머리가 하나도 없으면 맨 머리 꼴 파일
    for i, l in enumerate(lines):
        m = (BARE_RE if bare else HEAD_RE).match(l)
        if m:
            out.append((i, m.group(1), 'bare' if bare else 'bracket'))
    return out


def render(a, jo, mst, eff, style):
    body = RJ.article_lines(a, with_head=False)
    title = RJ.s(a.get('조문제목'))
    if style == 'bare':
        return ['%s(%s)' % (jo, title)] + body
    return ['[%s] %s (시행 %s · MST %s · %s 현행으로 다시 받음 — 3-37)' % (jo, title, eff, mst, TODAY)] + body


def main(apply, show=False):
    report = {'날': TODAY, '뜻': '발췌본의 조를 창구 현행 원문으로 다시 받은 기록(확인판 B1·B2).', '건': []}
    touched = Touched('excerpt_refresh_current') if apply else None
    for t in TARGETS:
        path = os.path.join(RAW, t['파일'])
        text = open(path, encoding='utf-8').read()
        lines = text.split('\n')
        mst, eff, arts = current(t['법'])
        rec = {'파일': t['파일'], '법': t['법'], '까닭': t['까닭'], 'MST': mst, '시행': eff, '조': []}
        if not arts:
            rec['결과'] = '현행 판을 못 정했다 — 아무것도 안 했다'
            report['건'].append(rec); print('✗', t['법'], rec['결과']); continue
        changed = False
        for jo in t['조']:
            bl = blocks(lines)
            idx = [k for k, b in enumerate(bl) if b[1] == jo]
            if len(idx) > 1:
                # ★같은 조 머리가 둘 — 하나가 **장 제목을 조로 잘못 받은 가짜 덩이**일 때만 그것을 지운다
                #   (성폭력처벌법: `[제3조]` 아래에 「제2장 …특례」 한 줄뿐인 덩이가 있었다 — 2026-08-28 추가수집 때 생김).
                #   가짜인지 가리는 법: ※ 쪽지 줄을 빼면 남는 것이 `제N장/절/편/관 …` 제목 한 줄뿐이다.
                fake = []
                for k in idx:
                    s0, e0 = bl[k][0], (bl[k + 1][0] if k + 1 < len(bl) else len(lines))
                    body = [l for l in lines[s0 + 1:e0] if l.strip() and not l.lstrip().startswith('※')]
                    if len(body) == 1 and re.match(r'^제\d+(?:장|절|편|관)\s', body[0].strip()):
                        fake.append((s0, e0))
                if len(fake) == len(idx) - 1:
                    for s0, e0 in sorted(fake, reverse=True):
                        rec['조'].append({'조': jo, '전': '\n'.join(lines[s0:e0]), '후': '',
                                         '결과': '장 제목을 조로 잘못 받은 가짜 덩이를 지웠다'})
                        print('●', t['법'], jo, '가짜 덩이를 지웠다:', lines[s0 + 1:e0])
                        del lines[s0:e0]
                    changed = True
                    bl = blocks(lines)
                    idx = [k for k, b in enumerate(bl) if b[1] == jo]
            if len(idx) != 1 or jo not in arts:
                rec['조'].append({'조': jo, '결과': '덩이를 하나로 못 찾았다(%d) 또는 현행에 없다' % len(idx)})
                print('✗', t['법'], jo, '덩이 %d개 · 현행에 %s' % (len(idx), '있다' if jo in arts else '없다')); continue
            k = idx[0]; start, _, style = bl[k]
            end = bl[k + 1][0] if k + 1 < len(bl) else len(lines)
            # ★쪽지는 **남긴다** — 머리 바로 밑의 `※ …`(왜 받았나)와 덩이 끝의 `[비고]`·`출처:`·`※` 는
            #   법 글이 아니라 우리 기록이다. 법 글 구간만 갈아 끼운다(2026-09-29 — 시험 돌리기에서
            #   형의실효법 끝의 [비고] 와 국기법 머리 밑 ※ 를 지울 뻔했다).
            NOTE = re.compile(r'^\s*(?:※|\[비고\]|출처\s*:|⚠)')
            lead = start + 1
            while lead < end and NOTE.match(lines[lead]):
                lead += 1
            stop = lead
            while stop < end and not NOTE.match(lines[stop]):
                stop += 1
            while stop > lead and not lines[stop - 1].strip():
                stop -= 1                                     # 법 글 뒤 빈 줄은 남긴다
            old = [lines[start]] + lines[lead:stop]
            new = render(arts[jo], jo, mst, eff, style)
            notes = lines[start + 1:lead]
            for extra in t.get('더함', {}).get(jo, []):
                if extra in arts and not any(b[1] == extra for b in bl):
                    new += [''] + render(arts[extra], extra, mst, eff, style)
            same = norm('\n'.join(old[1:])) == norm('\n'.join(new[1:len(RJ.article_lines(arts[jo], with_head=False)) + 1]))
            r = {'조': jo, '전': '\n'.join(old), '후': '\n'.join(new)}
            if same and not t.get('더함', {}).get(jo):
                r['결과'] = '같다 — 손대지 않았다'
            else:
                r['결과'] = '현행으로 바꿨다'
                lines[start:stop] = new[:1] + notes + new[1:]
                changed = True
            rec['조'].append(r)
            if show and r['결과'].startswith('현행'):
                import difflib
                print('\n'.join(difflib.unified_diff(old, new, lineterm='', n=0)))
            print(('●' if r['결과'].startswith('현행') else '·'), t['법'], jo, r['결과'])
        rec['결과'] = '바꿨다' if changed else '바꿀 것이 없었다'
        if apply and changed:
            open(path, 'w', encoding='utf-8').write('\n'.join(lines))
            touched.add(path)
        report['건'].append(rec)
    report['덧'] = ('소득세법 제104조·제129조는 견줘 보니 차이가 절 제목 한 줄과 세율 표를 그림/글로 담은 모양뿐이라 '
                   '바꾸지 않았다(사장님 확정 B1 ⓐ — 「같다」로 기록만).')
    if apply:
        json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.add(REPORT); touched.save()
    return report


if __name__ == '__main__':
    main('--apply' in sys.argv, '--show' in sys.argv)
