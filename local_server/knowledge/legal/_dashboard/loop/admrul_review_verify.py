#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-28 / G-24 — **「DRF 자동수집 … 원문 대조 필요」 표시를 기계가 실제로 대조한다.**

[왜 이것만 기계가 할 수 있나 — 갈래를 먼저 갈랐다]
  `(⚠REVIEW)` 표시 837개(머리 수집표시 제외)를 열어 보니 **한 가지가 아니었다**:
    ⓐ **DRF 자동수집 표시** — *"국가법령정보센터 API 원문 그대로. 사람 검수 전."*
       ⇒ **그림이 아니라 API 글**이다. **기계가 다시 불러 글자로 맞춰 볼 수 있다.** ← 이 도구
    ⓑ **기록 주석** — 이미 재대조를 마쳤거나, 수집 한계를 적어 둔 줄. **할 일이 아니다.**
    ⓒ **그림에서 읽은 값** — 수식·도면 치수·좌표. **사람이 원본 그림과 맞춰야 한다**
       (`build_review_html.py` 가 그 자리를 만든다).
  ★섞어서 「837개를 대조한다」고 잡으면 **끝낼 수 없는 일**이 된다(뿌리 사슬 ⑥).

[어떻게 대조하나 — 자를 새로 짜지 않는다]
  `meta_mst_recover.py` 가 이미 갖고 있는 자를 **그대로 부른다**(L-136 정신 — 자는 한 자리에).
  · `norm()`    개정표시(`<개정 …>`)를 떼고 공백을 지운다
  · `covered()` **우리 글**을 30글자 창으로 훑어 **몇 창이 현행 글에 있나**
    ★방향이 중요하다 — 우리 파일은 발췌·전사본이라 일부만 담기도 한다.
      「현행이 우리 글에 다 있나」로 물으면 멀쩡한 파일이 「다르다」로 떨어진다.

[표시를 **지우지 않는다**]
  대조가 맞아도 `⚠REVIEW` 줄을 **지우지 않는다.** 그 줄을 **대조 기록으로 바꿔 적는다**:
    `✅원문 대조 완료(2026-09-24): law.go.kr admrul ID=… 과 글자 99% 일치 · 도구 admrul_review_verify.py`
    `  (옛 표시: ⚠REVIEW: DRF 자동수집(collect6, 2026-07-18) — 원문 대조 필요)`
  ★표시를 지워서 초록을 만들지 않는다(G-34). **무엇을 언제 어떻게 확인했는지**가 남아야 한다.

[연계] ← `_dashboard/loop/admrul_review_gate.js`(V5-24) 의 `anywhere`·`head5`·`first`
        자: `meta_mst_recover.norm/covered` · 못 맞춘 것은 `build_review_html.py` 로 넘어간다
사용법: python3 admrul_review_verify.py [--apply] [--limit N]
"""
import importlib.util, json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
import law_api_guard
from _touched import Touched
from _admrul_id import find_id as 파일이_적어둔_판번호        # ★L-386 — 판번호 읽는 자는 한 자리

_sp = importlib.util.spec_from_file_location('mr', os.path.join(HERE, 'meta_mst_recover.py'))
MR = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(MR)

OC = 'hyoo1431'
APPLY = '--apply' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
GOOD = 0.95

DRF_MARK = re.compile(r'^.*⚠\s*REVIEW[^\n]{0,140}?(?:DRF|자동수집|admrul|원문 그대로|API).*$', re.M)
IDRE = re.compile(r'(?:ID\s*=\s*|ID\s+|target=admrul&ID=)(\d{8,})')
# 우리가 얹은 줄 — 대조 전에 걷어낸다.
# ★2026-09-24 — 처음에 **파일 머리말을 안 걷어냈다.** 우리 파일은 머리에
#   `[고시/행정규칙] 이름` · `ID:…·종류:…·시행:…` · `위임근거:…` · `소관부서:…/전화…` 를 붙여 둔다.
#   그건 **우리가 적은 것이라 API 에 있을 리가 없다.** 그런데도 「우리 글인데 현행에 없다」로 세어져
#   멀쩡한 파일이 70% 대로 떨어졌다(친어등 고시로 실측 — 안 맞는 창 15개가 **전부 머리말**이었다).
OURS = re.compile(r'^\s*(?:⚠|※|\[OCR|\[표\]|\[도해\]|\[산식\]|출처\s*:|수집|【이미지판독'
                  r'|\[고시/행정규칙\]|ID\s*:|위임근거\s*:|소관부서\s*:|종류\s*:|시행\s*:|현행여부\s*:'
                  r'|별표서식|첨부파일\s*:|✅원문 대조 완료|\(옛 표시)')


def api(url):
    for i in range(10):
        try:
            b = urllib.request.urlopen(url, timeout=40).read().decode('utf-8', 'replace')
            if b.lstrip()[:1] in '{[':
                return json.loads(b)
            r = law_api_guard.block_reason(b)
            if r:
                law_api_guard.announce(r, url)
                if law_api_guard.is_fatal(r):
                    return None
        except Exception:
            pass
        time.sleep(min(1.2 + 0.4 * i, 6.0))
    return None


def admrul_원문(aid):
    """돌려주는 것: (글, 창구가_답했나, 첨부이름들)

    ★왜 「답했나」를 따로 돌려주나 — 2026-09-27 실측으로 걸렸다.
      `매장문화재 보존조치유적 지정 고시`(ID 2100000234918)는 창구가 **답은 하는데
      `조문내용` 이 비어 있다**(첨부에만 내용이 있는 고시다). 그런데 이 자는 글이 비면
      전부 「원문을 못 받았다」로 묶어 **조용히 넘겼다** — 망이 끊긴 것과 구별이 안 됐다.
      ⇒ 창구가 답한 경우는 「이 길로는 대조 불가」로 **파일에 적는다.** 망 문제는 적지 않는다
        (다시 물으면 되는 일을 파일에 못 박으면 그것이 거짓이 된다).
    """
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={aid}&type=JSON')
    root = (d or {}).get('AdmRulService') or d or {}
    답했나 = bool(root.get('행정규칙기본정보'))
    첨 = (root.get('첨부파일') or {}).get('첨부파일명') or []
    첨 = 첨 if isinstance(첨, list) else [첨]
    return ''.join(MR._all_text(root, [])), 답했나, [str(x) for x in 첨]


def admrul_text(aid):
    d = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={aid}&type=JSON')
    root = (d or {}).get('AdmRulService') or d or {}
    # ★`target=admrul` 은 `조문` 이 아니라 **`조문내용`** 키를 쓰고, 값이 **목록의 목록**이다.
    #   `조문` 을 찾다 없으면 root 전체를 훑게 두면 별표·부칙까지 들어오는데, 우리 파일도
    #   그것들을 함께 전사해 두었으므로 **함께 견주는 것이 맞다.**
    return ''.join(MR._all_text(root, []))


def 이름으로_창구에_묻기(name):
    """제목으로 창구를 뒤져 판번호를 찾는다. ⚠**이름이 `find_id` 였다 — 공용 자와 같은 이름**이라
    `from _admrul_id import find_id` 를 해도 이 자가 덮어썼다(2026-09-27 실측으로 걸렸다).
    하는 일이 다르다: 공용 자는 **파일이 이미 적어 둔 번호**를 읽고, 이 자는 **창구에 묻는다.**"""
    q = urllib.parse.quote(name)
    d = api(f'https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=admrul&type=JSON&display=20&query={q}')
    ls = ((d or {}).get('AdmRulSearch') or {}).get('admrul') or []
    if isinstance(ls, dict):
        ls = [ls]
    want = re.sub(r'\s', '', name)
    for x in ls:
        if re.sub(r'\s', '', str(x.get('행정규칙명') or '')) == want:
            return str(x.get('행정규칙일련번호') or ''), str(x.get('행정규칙명') or '')
    return '', ''


def 오늘():
    """기록에 적는 날짜. ★**박아 두지 않는다** — 2026-09-27 에 돌렸는데 파일에는
    「2026-09-24」 라고 적혔다. 언제 확인했는지가 이 기록의 값어치인데 그것이 거짓이 된다."""
    return time.strftime('%Y-%m-%d')


def targets():
    out = []
    for root, dirs, fs in os.walk(RAW):
        if os.path.basename(root) != '행정규칙':
            continue
        for f in sorted(fs):
            if not f.endswith('.txt'):
                continue
            p = os.path.join(root, f)
            head = open(p, encoding='utf-8', errors='replace').read()[:2500]
            if '✅원문 대조 완료' in head or '🟡기계 대조' in head or '⚠이 길로는 대조 불가' in head:
                continue          # 이미 대조해 기록을 남긴 파일 — 다시 손대지 않는다
            if DRF_MARK.search(head):
                out.append(p)
    return out


def our_body(text):
    """우리 파일에서 **원문에 해당하는 글만** 남긴다 — 머리말 덩어리와 우리 주석을 걷어낸다.
    머리말 덩어리는 **첫 빈 줄까지**다(수집기가 그렇게 쓴다)."""
    lines = text.split('\n')
    i = 0
    while i < len(lines) and lines[i].strip():      # 머리말 덩어리를 통째로 건너뛴다
        i += 1
    keep = [l for l in lines[i:] if not OURS.match(l)]
    return '\n'.join(keep)


def main():
    ts = targets()
    if LIMIT:
        ts = ts[:LIMIT]
    print(f'「DRF 자동수집/원문 그대로」 표시가 있는 행정규칙 {len(ts)}개\n')
    touched = Touched('admrul_review_verify.py')
    ok = diff = miss = nobody = 0
    for p in ts:
        rel = os.path.relpath(p, RAW)
        text = open(p, encoding='utf-8', errors='replace').read()
        head = text[:2500]
        # ★판번호를 세 걸음으로 찾는다 (2026-09-27 고침, L-386).
        #   [무엇이 잘못돼 있었나 — 전수 A/B 로 쟀다]
        #   이 자는 제 정규식 `IDRE` 를 먼저 썼는데 그 자에 흠이 둘 있었다:
        #     ①저장소 규약인 **줄머리 `ID:2100000246402`** 꼴을 아예 못 본다(`ID=`·`ID ` 만 본다).
        #     ②**산문 속 옛 판 번호**를 집는다 — 재수집 안내문 *"종전 raw 는 ID 2100000185871 였다"*.
        #   실측(행정규칙 전수): 같다 97 · **값이 다르다 146**(대부분 ②) · **새만 찾는다 657**(①) · 옛만 1.
        #   ⇒ 그대로 두면 **옛 판과 대조하고 「완료」라고 적을** 수 있는 자다.
        #   ★다행히 피해는 없었다 — 이미 적힌 「원문 대조」 기록 **28개는 전부 그 파일의 판번호와 같았다**
        #     (①에 걸린 657쪽은 「ID 를 못 찾았다」로 건너뛰어졌을 뿐이다). **놓친 일감**이었지 오기가 아니다.
        #   ★★그리고 더 깊은 까닭이 있었다 — 이 파일이 **`find_id` 라는 이름을 스스로 또 정의**하고 있어
        #     공용 자를 들여와도 **지역 자가 덮어쓴다.** P-19b 가 「여섯 자가 각자 다시 구현한다」고 쓸어냈는데
        #     이 자가 **일곱째**였고, 이름까지 같아 눈에 안 띄었다. ⇒ 지역 자는 `이름으로_창구에_묻기` 로 갈랐다.
        aid, via = 파일이_적어둔_판번호(p)          # ①파일이 이미 적어 둔 번호(망이 필요 없다)
        if not aid:
            m = IDRE.search(head)                  # ②머리글 **산문** 속 `ID=…`·`target=admrul&ID=…`
            aid, via = (m.group(1), '산문 속 ID') if m else ('', '')
        if not aid:
            name = os.path.splitext(os.path.basename(p))[0]
            aid, got = 이름으로_창구에_묻기(name)   # ③창구에 제목으로 묻는다
            via = f'창구에 이름으로 물음({got})' if aid else ''
        if not aid:
            print(f'· {rel[:70]} — ID 를 못 찾았다'); miss += 1; continue
        cur, 답했나, 첨부 = admrul_원문(aid)
        ratio = MR.covered(our_body(text), cur)
        ours_len = len(MR.norm(our_body(text)))
        cur_len = len(MR.norm(cur))
        # ★갈래를 하나 더 둔다 (2026-09-24 실측)
        #   `매장문화재 보존조치유적 해제 고시` 를 열어 보니 **ID 는 맞는데** API 본문이 266자였다 —
        #   `[본문 생략]` 과 `<img>` 자리표시뿐이고, **진짜 내용은 첨부 HWP 안**에 있다.
        #   우리 파일은 그 **첨부를 전사한 것**이라 API 와 견줄 거리가 애초에 없다.
        #   ⇒ 이것을 「우리 글이 다르다」로 적으면 **다시 받아야 할 일처럼 보인다.** 거짓이다.
        #     「이 길로는 대조할 수 없다」로 따로 적는다.
        # ★맞든 안 맞든 **기계가 어디까지 했는지를 파일에 남긴다.**
        #   그냥 두면 다음 사람이 **처음부터 다시** 한다. 「원문 대조 필요」라는 말만으로는
        #   무엇을 얼마나 해 봤는지 알 수 없다 — 그것이 이 표시가 두 달 넘게 안 줄어든 까닭이다.
        def annotate(tag):
            if not APPLY:
                return
            new = DRF_MARK.sub(lambda mo: tag + '\n  (옛 표시는 지우지 않는다 — ' + mo.group(0).strip() + ')',
                               text, count=1)
            if new != text:
                open(p2, 'w', encoding='utf-8').write(new)
                touched.add(p2)
        p2 = p
        if not cur:
            # ★창구가 답했는데 글이 비었다 = **첨부에만 내용이 있는 고시**다(망 문제가 아니다).
            if not 답했나:
                print(f'· {rel[:70]} — 창구가 답을 안 줬다(ID={aid}) → 다시 물어라'); miss += 1; continue
            꼴 = sorted({(x.rsplit('.', 1)[-1].lower() if '.' in x else '?') for x in 첨부}) or ['없음']
            nobody += 1
            print(f'⚠ {rel[:60]} — ID={aid} · **창구에 조문내용이 없다** '
                  f'(첨부 {len(첨부)}개 · 꼴 {"/".join(꼴)}) → 이 길로는 대조 불가')
            annotate(f'⚠이 길로는 대조 불가({오늘()}): law.go.kr admrul ID={aid} 는 답은 하지만 '
                     f'**`조문내용` 이 비어 있다** — 내용이 첨부에만 있는 고시다'
                     f'(첨부 {len(첨부)}개 · 꼴 {"/".join(꼴)}). 우리 파일은 그 첨부를 전사한 것이다. '
                     + ('⚠첨부에 `.hwp`/`.hwpx` 가 없어 **판독기로도 못 연다**(PDF 뿐이다). '
                        if not any(x.lower().endswith(('.hwp', '.hwpx')) for x in 첨부) else
                        '★첨부에 `.hwp`/`.hwpx` 가 있다 — 판독기로 열어 대조할 수 있다. ')
                     + f'⇒ **사람이 첨부 원본과 맞춘다**(3-28). 도구 admrul_review_verify.py')
            continue
        if cur_len * 5 < ours_len or '본문 생략' in cur:
            nobody += 1
            print(f'⚠ {rel[:60]} — ID={aid} · **API 가 본문을 안 준다**'
                  f'(API {cur_len}자 ↔ 우리 {ours_len}자) → 첨부 전사본이라 이 길로는 대조 불가')
            annotate(f'⚠이 길로는 대조 불가({오늘()}): law.go.kr admrul ID={aid} 는 **본문을 안 준다**'
                     f'(API {cur_len}자 ↔ 우리 {ours_len}자 · `[본문 생략]` 과 그림 자리표시뿐). '
                     f'진짜 내용은 **첨부파일** 안에 있고 우리 파일은 그 전사본이다. '
                     f'⇒ API 대조로는 확인할 수 없다. **첨부 원본과 사람이 맞춰야 한다.** 도구 admrul_review_verify.py')
            continue
        if ratio < GOOD:
            diff += 1
            print(f'❗ {rel[:60]} — ID={aid} · 우리 글의 {round(ratio*100)}%만 현행에 있다 → **표시 그대로 둔다**')
            annotate(f'🟡기계 대조 {round(ratio*100)}%({오늘()}): law.go.kr admrul ID={aid} 를 다시 불러 '
                     f'우리 글을 30글자 창으로 훑으니 **{round(ratio*100)}% 가 현행에 그대로 있다.** '
                     f'나머지는 표·별표·부칙처럼 API 가 다르게 주는 자리이거나 실제 차이다 — **사람이 본다.** '
                     f'(문턱 {int(GOOD*100)}% 미만이라 「대조 완료」로 올리지 않았다) 도구 admrul_review_verify.py')
            continue
        ok += 1
        print(f'✅ {rel[:64]} — ID={aid}({via}) · 글자 {round(ratio*100)}% 일치 → 대조 기록으로 바꾼다')
        if not APPLY:
            continue
        def swap(mo):
            old = mo.group(0).strip()
            return (f'✅원문 대조 완료({오늘()}): law.go.kr admrul ID={aid} 를 다시 불러 '
                    f'우리 글을 30글자 창으로 훑으니 **{round(ratio*100)}% 일치**. 도구 admrul_review_verify.py\n'
                    f'  (옛 표시는 지우지 않는다 — {old})')
        new = DRF_MARK.sub(swap, text, count=1)
        if new != text:
            open(p, 'w', encoding='utf-8').write(new)
            touched.add(p)
    if APPLY:
        touched.save()
    print(f'\n대조 완료 {ok} · ⚠API 가 본문을 안 준다 {nobody} · ❗글이 다르다 {diff} · 못 가림 {miss}')
    if not APPLY:
        print('(미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
