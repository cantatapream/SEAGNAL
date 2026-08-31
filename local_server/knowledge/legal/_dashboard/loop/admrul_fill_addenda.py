#!/usr/bin/env python3
"""고시(행정규칙) raw 파일에 빠져 있는 **부칙**을 API에서 받아 뒤에 덧붙인다.

왜 필요한가 (L-218, 2026-08-31 발견):
  고시 수집기(collect_admrul.py·admrul_fresh.py·admrul_recollect_stale.py) 셋 다
  본문(조문내용)과 별표만 받아 적고 **부칙을 한 번도 저장하지 않았다**(세 파일 모두
  '부칙'이라는 낱말이 0회). 그런데 law.go.kr 응답에는 `AdmRulService.부칙.부칙내용`
  으로 부칙이 그대로 들어 있다 — 즉 "구조적으로 못 얻는 것"이 아니라 "얻을 수 있는데
  안 받은 것"이었다(데이터 품질 4축 ①수집).
  고시의 경과조치·시행일은 통상 부칙에 있으므로, 부칙이 없는 raw 를 근거로 내린
  "그런 규정 없음" 판정은 전부 **본칙 범위의 판정**에 지나지 않는다.

무엇을 하나:
  raw/*/*/행정규칙/*.txt 를 훑어, 둘째 줄의 `ID:` 를 읽어 admrul API 를 부르고
  부칙내용을 파일 **끝에 덧붙인다**. 기존 내용은 한 글자도 지우거나 고치지 않는다.

건너뛰는 것:
  - 이미 `[부칙]` 머리글이 있는 파일 (두 번 붙지 않게)
  - 둘째 줄에 `ID:` 가 없는 파일 (PDF·HWP 전사본 등 — API 로 못 찾아간다)
  - API 응답에 부칙이 없는 고시 (원본에 부칙이 없는 경우 — 보고서에만 남긴다)

[연계]
  - 읽음: raw/*/*/행정규칙/*.txt (둘째 줄 ID)
  - 호출: https://www.law.go.kr/DRF/lawService.do (OC=hyoo1431, target=admrul)
  - 씀:   같은 .txt 파일 뒤 (append only) · _dashboard/admrul_addenda/report_<시각>.json
  - 남김: _dashboard/touched/<이름>_<시각>.json (되돌릴 때 이 목록만 되돌린다)
사용법: python3 admrul_fill_addenda.py [--dry] [--limit N] [--only <조각>] [--skip <경로조각>]
  --skip 은 다른 에이전트가 지금 만지고 있는 법의 폴더를 빼 둘 때 쓴다(동시 쓰기 회피).
"""
import glob, json, os, re, sys, time, urllib.request
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OC = 'hyoo1431'
# ⚠보고서 이름에 실행 시각을 넣는다(2026-08-31, 실제로 당했다).
#   처음에는 고정 이름 하나였는데, 전량 백필(578건) 뒤에 --only 로 한 폴더만 다시 돌리자
#   그 작은 실행이 578건짜리 보고서를 통째로 덮어썼다. 고친 파일 목록 자체는 Touched 기록이
#   실행마다 따로 남겨 무사했지만, 보고서는 되살릴 수 없었다.
REPORT_DIR = os.path.join(LEGAL, '_dashboard', 'admrul_addenda')


def api(url, tries=4):
    """law.go.kr JSON 을 받아 온다. 프록시가 끊는 일이 잦아 네 번까지 다시 시도한다."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            last = str(e)
            time.sleep(1.5 * (i + 1))
    return {'_err': last}


def addenda_of(admrul_id):
    """이 고시의 부칙 문단 목록을 돌려준다. 없으면 빈 목록, 실패면 None."""
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={admrul_id}")
    if not isinstance(d, dict) or '_err' in d:
        return None
    body = d.get('AdmRulService', d)
    bc = (body.get('부칙') or {}).get('부칙내용')
    if bc is None:
        return []
    if isinstance(bc, str):
        bc = [bc]
    return [t.strip() for t in bc if str(t).strip()]


def main():
    dry = '--dry' in sys.argv
    limit = None
    only = None
    skip = None
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    if '--skip' in sys.argv:
        skip = sys.argv[sys.argv.index('--skip') + 1]

    files = sorted(glob.glob(os.path.join(LEGAL, 'raw', '*', '*', '행정규칙', '*.txt')))
    touched = Touched('admrul_fill_addenda')
    rep = {'붙임': [], '이미있음': [], 'ID없음': [], '원본에부칙없음': [], '실패': []}
    done = 0

    for p in files:
        name = os.path.basename(p)
        if only and only not in name:
            continue
        if skip and skip in p:
            continue
        text = open(p, encoding='utf-8').read()
        if re.search(r'^\[부칙\]', text, re.M):
            rep['이미있음'].append(name)
            continue
        m = re.search(r'^ID:(\d+)', text.split('\n')[1] if '\n' in text else '', re.M)
        if not m:
            rep['ID없음'].append(name)
            continue
        if limit is not None and done >= limit:
            break
        paras = addenda_of(m.group(1))
        if paras is None:
            rep['실패'].append(name)
            continue
        if not paras:
            rep['원본에부칙없음'].append(name)
            done += 1
            continue
        block = '\n[부칙]\n' + '\n'.join(paras) + '\n'
        if not dry:
            with open(p, 'a', encoding='utf-8') as f:
                f.write(block if text.endswith('\n') else '\n' + block)
            touched.add(p)
        rep['붙임'].append({'파일': name, '부칙수': len(paras), '글자수': len(block)})
        done += 1

    for k in rep:
        print(f"{k}: {len(rep[k])}건")
    if not dry:
        os.makedirs(REPORT_DIR, exist_ok=True)
        out = os.path.join(REPORT_DIR, f'report_{touched.stamp}.json')
        json.dump(rep, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.save()
        print('보고서:', out)


if __name__ == '__main__':
    main()
