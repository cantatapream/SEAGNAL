#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""받아 둔 행정규칙이 **현행판인지** 확인하고, 아니면 현행판으로 바꿔 받는다.

왜 (2026-09-01, 사서가 잡아 줬다):
  `delegated_sweep.py` 로 찾은 미수집 고시 86건을 받아 넣었는데, 사서 하나가
  `target=admrul&ID=…` 응답의 **`현행여부`** 필드를 보고 자기 담당 5건이 **전부 `N`(폐지·구판)**
  임을 알아냈다. 확인해 보니 우리가 「해양환경관리법」 정정 근거로 쓴
  「해양자율방제대 운영규칙」(ID 2100000239934, 2024-04-25)도 `현행여부: N` 이었고,
  현행은 ID 2100000281040(2026-06-22)이었다.

  **왜 이런 일이 생기나**: `lsDelegated`(위임법령) 는 위임 관계를 알려 줄 뿐이고,
  그 목록이 가리키는 ID 가 **그 시점의 판**이다. 개정되면 새 ID 가 생기는데 위임 목록은
  옛 ID 를 그대로 들고 있는 경우가 있다. 그래서 "위임 목록에 있는 ID"를 그대로 받으면
  **구판을 받는다.**

무엇을 하나
  ① 파일 머리의 `ID:` 로 `target=admrul` 을 조회해 `현행여부` 를 본다.
  ② `N` 이면 `lawSearch.do?target=admrul&query=<행정규칙명>` 으로 **현행판 ID** 를 찾는다.
  ③ 현행판이 있으면 그 본문을 받아 **같은 파일에 덮어쓰고**, 머리에 옛 ID 도 함께 적는다.
     현행판을 못 찾으면 파일에 **"폐지판 — 근거로 쓰지 마라"** 를 적는다(지우지는 않는다).

⚠이 도구는 파일을 덮어쓴다. 어떤 파일을 건드렸는지 `_touched.py` 로 남긴다.

[연계]
  - 읽음/씀: raw/*/<법>/행정규칙/*.txt
사용법: python3 admrul_current_check.py [--since 2026-09-01] [--dry] [<파일경로> ...]
        --since 를 주면 그 날짜로 수집된 파일만 본다(파일 머리의 `수집:` 줄 기준).
"""
import glob, json, os, re, sys, time, urllib.parse, urllib.request

OC = 'hyoo1431'
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))


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


def body_of(ID):
    j = api(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={ID}')
    b = (j or {}).get('AdmRulService', {})
    info = b.get('행정규칙기본정보', {})
    jo = s(b.get('조문내용'))
    byl = b.get('별표', {})
    bt = ''
    if byl:
        for un in L(byl.get('별표단위') if isinstance(byl, dict) else byl):
            bt += '\n[별표] ' + s(un.get('별표제목')) + '\n' + re.sub(r'<[^>]+>', ' ', s(un.get('별표내용')))
    return info, (jo + ('\n\n' + bt if bt.strip() else '')).strip()


def current_id(name):
    d = api(f'https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=admrul&type=JSON&display=20'
            f'&query={urllib.parse.quote(name)}')
    for it in L((d or {}).get('AdmRulSearch', {}).get('admrul')):
        if re.sub(r'\s', '', s(it.get('행정규칙명'))) == re.sub(r'\s', '', name):
            return s(it.get('행정규칙일련번호')), s(it.get('시행일자'))
    return None, None


def main():
    dry = '--dry' in sys.argv
    since = None
    if '--since' in sys.argv:
        since = sys.argv[sys.argv.index('--since') + 1]
    files = [a for a in sys.argv[1:] if not a.startswith('--') and a != since]
    if not files:
        files = sorted(glob.glob(os.path.join(LEGAL, 'raw', '*', '*', '행정규칙', '*.txt')))

    ok = replaced = dead = skipped = 0
    for p in files:
        head = open(p, encoding='utf-8').read(500)
        if since and f'수집: {since}' not in head:
            continue
        m = re.search(r'\bID[=:]\s*(\d{6,})', head)
        if not m:
            skipped += 1
            continue
        ID = m.group(1)
        info, _ = body_of(ID)
        if not info:
            print(f'  ⚠ 응답 없음 — {os.path.basename(p)}'); skipped += 1; continue
        if s(info.get('현행여부')) != 'N':
            ok += 1
            continue
        name = s(info.get('행정규칙명'))
        cid, cdate = current_id(name)
        if not cid or cid == ID:
            if not dry:
                with open(p, 'a', encoding='utf-8') as fp:
                    fp.write('\n\n⚠★이 파일은 **폐지판이다**(law.go.kr 현행여부 = N, 2026-09-01 확인).\n'
                             '  같은 이름의 현행판을 찾지 못했다 — 근거로 쓰지 마라.\n')
            print(f'  ⛔ 폐지판(현행판 못 찾음): {os.path.basename(p)}')
            dead += 1
            continue
        cinfo, cbody = body_of(cid)
        if len(cbody) < 30:
            print(f'  ⚠ 현행판 본문이 안 딸려왔다: {name} (ID={cid})'); skipped += 1; continue
        print(f'  🔄 {name}: 구판 {ID} → 현행 {cid} (시행 {cdate})' + (' [dry]' if dry else ''))
        if dry:
            replaced += 1
            continue
        hdr = (f"[고시/행정규칙] {s(cinfo.get('행정규칙명')) or name}\n"
               f"ID:{cid} · 소관: {s(cinfo.get('소관부처명'))} · 시행일:{s(cinfo.get('시행일자'))}"
               f" · 발령일:{s(cinfo.get('발령일자'))}\n"
               f"수집: 2026-09-01 · ⚠구판 ID {ID} 을 받았다가 현행판으로 바꿔 받았다"
               f"(lsDelegated 가 옛 ID 를 준다 — L-233)\n\n")
        open(p, 'w', encoding='utf-8').write(hdr + cbody)
        replaced += 1
    print(f'\n현행 {ok} · 현행판으로 교체 {replaced} · 폐지판(교체 못 함) {dead} · 건너뜀 {skipped}')


if __name__ == '__main__':
    main()
