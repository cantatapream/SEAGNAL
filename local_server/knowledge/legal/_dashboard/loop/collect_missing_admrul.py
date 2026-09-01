#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`delegated_sweep` 이 "확인 필요"로 찍은 위임 행정규칙을 실제로 받아 온다.

왜 (2026-09-01):
  `delegated_sweep.py` 로 74법 826건을 조회하니 **135건을 raw 에서 못 찾았다.**
  그중 45건은 개별 처분(특정 나무·동굴 지정 고시 등 — 법 해석에 쓸 일이 없다)이고,
  90건이 일반 규범이었다. 예를 들어 공유수면관리및매립에관한법률은
  「공유수면 점용·사용허가 면제대상 행위 및 시설」 고시가 없었다 —
  "허가 안 받아도 되나"를 답하는 바로 그 고시다.

무엇을 하나
  sweep 기록(_dashboard/delegated_sweep/<법>.md)에서 "⚠확인 필요"로 찍힌 줄의 제목·ID 를 읽어,
  `target=admrul` 로 본문을 받아 그 법의 `raw/<도메인>/<법>/행정규칙/` 에 넣는다.
  파일 머리에 제목·발령일·시행일·소관·**ID** 를 적어 둔다(다음 sweep 이 ID 로 맞출 수 있게).

  기본은 **개별 처분을 빼고** 일반 규범만 받는다(`--all` 로 전부).
  개별 처분 판별은 제목 꼴로 한다 — 지형도면·보호구역 지정/조정·공개제한·지정명칭 변경 등.

⚠받아 왔다고 끝이 아니다. 그 고시가 정한 내용이 위키가 "규정이 없다"고 써 둔 자리와
  겹치는지 **사서가 대조해야** 한다(해양조사법에서 실제로 그런 오답이 있었다 — L-233).

[연계]
  - 읽음: _dashboard/delegated_sweep/*.md · _dashboard/law_raw_paths.json
  - 씀:   raw/<도메인>/<법>/행정규칙/<고시이름>.txt
사용법: python3 collect_missing_admrul.py [<법이름> ...] [--all] [--fuzzy] [--dry]
        (법 이름을 안 주면 sweep 기록이 있는 법 전부)
"""
import json, os, re, sys, time, urllib.request

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
SWEEP = os.path.join(LEGAL, '_dashboard', 'delegated_sweep')

# 개별 처분 — 특정 대상 하나를 지정·조정·해제하는 고시. 일반 규범이 아니라 받지 않는다.
INDIV = re.compile(r'지형도면|보호구역.*(지정|조정|추가)|(지정|해제|조정|변경|정정).*고시$'
                   r'|구역 (조정|정정)|공개제한|지정사유 변경|지정명칭 변경')
ROW = re.compile(r'- (.+?) \(ID ([0-9·]+)\) — ⚠확인 필요')
# ★`--fuzzy` 를 줄 때만 "⚠유사이름만 있음" 줄도 받는다(2026-09-01, L-238).
#   그 줄은 **사람이 눈으로 확인한 뒤에만** 받아야 한다 — 닮은 파일이 사실 같은 고시일 수 있고,
#   그러면 같은 고시가 이름만 다르게 raw 에 두 번 들어간다.
ROWF = re.compile(r'- (.+?) \(ID ([0-9·]+)\) — ⚠유사이름만 있음')


def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.2)
    return None


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def s(x):
    if x is None:
        return ''
    if isinstance(x, list):
        return '\n'.join(s(i) for i in x)
    return str(x)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    take_all = '--all' in sys.argv
    with_fuzzy = '--fuzzy' in sys.argv
    dry = '--dry' in sys.argv
    paths = json.load(open(os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json'), encoding='utf-8'))

    laws = args or sorted(f[:-3] for f in os.listdir(SWEEP) if f.endswith('.md'))
    got = skipped = failed = 0
    fail_streak = 0
    for law in laws:
        p = os.path.join(SWEEP, law + '.md')
        if not os.path.exists(p):
            print(f'✖ {law}: sweep 기록이 없다 — delegated_sweep.py 를 먼저 돌려라'); continue
        todo = []
        for line in open(p, encoding='utf-8'):
            m = ROW.match(line.strip()) or (ROWF.match(line.strip()) if with_fuzzy else None)
            if not m:
                continue
            title, ids = m.group(1), m.group(2).split('·')
            if not take_all and INDIV.search(title):
                continue
            todo.append((title, ids[-1]))          # 여러 ID 면 최신(뒤)을 받는다
        if not todo:
            continue
        rel = paths.get(law)
        if not rel:
            print(f'✖ {law}: law_raw_paths.json 에 없다'); continue
        d = os.path.join('/home/user/SEAGNAL', rel, '행정규칙')
        os.makedirs(d, exist_ok=True)
        print(f'===== {law} — 받을 것 {len(todo)}건')
        for title, ID in todo:
            fn = re.sub(r'[\\/:*?"<>|]', '', title).replace(' ', '')[:70] + '.txt'
            out = os.path.join(d, fn)
            if os.path.exists(out):
                print(f'  · 이미 있다: {fn}'); skipped += 1; continue
            if dry:
                print(f'  (dry) {fn}  ID={ID}'); continue
            j = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={ID}')
            b = (j or {}).get('AdmRulService', {})
            info = b.get('행정규칙기본정보', {})
            jo = s(b.get('조문내용'))
            byl = b.get('별표', {})
            byltxt = ''
            if byl:
                for un in L(byl.get('별표단위') if isinstance(byl, dict) else byl):
                    byltxt += '\n[별표] ' + s(un.get('별표제목')) + '\n' + re.sub(r'<[^>]+>', ' ', s(un.get('별표내용')))
            body = (jo + ('\n\n' + byltxt if byltxt.strip() else '')).strip()
            if len(body) < 30:
                print(f'  ✖ {title} — 본문이 안 딸려왔다(ID={ID})')
                failed += 1
                fail_streak += 1
                # ⚠연속 실패는 서버가 죽은 것일 수 있다 — 빈 파일을 무더기로 만들지 않는다(L-227).
                if fail_streak >= 8:
                    print('  ⛔ 연속 8건 실패 — law.go.kr 이 응답하지 않는다고 보고 멈춘다.')
                    return
                continue
            fail_streak = 0
            hdr = (f"[고시/행정규칙] {s(info.get('행정규칙명')) or title}\n"
                   f"ID:{ID} · 소관: {s(info.get('소관부처명'))} · 시행일:{s(info.get('시행일자'))}"
                   f" · 발령일:{s(info.get('발령일자'))}\n"
                   f"수집: 2026-09-01, delegated_sweep 이 찾은 미수집분\n\n")
            open(out, 'w', encoding='utf-8').write(hdr + body)
            print(f'  ✅ {fn} · 본문 {len(body)}자')
            got += 1
    print(f'\n받음 {got} · 이미 있음 {skipped} · 실패 {failed}')


if __name__ == '__main__':
    main()
