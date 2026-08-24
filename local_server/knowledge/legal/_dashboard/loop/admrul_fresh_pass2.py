#!/usr/bin/env python3
"""admrul_fresh.py 의 '조회실패'를 다시 판정하는 2차 대조.

왜 필요한가:
  1차는 우리가 파일에 적어 둔 제목으로 검색한다. 그런데 제목을 우리가 줄여 쓰거나
  가운뎃점(·/ㆍ)·띄어쓰기가 공식 행정규칙명과 다르면 검색이 헛돈다.
  2차는 반대로 간다 — 파일에 적힌 일련번호로 본문을 직접 열어 '공식 제목'을 받아온 뒤,
  그 공식 제목으로 다시 검색해 현행 일련번호와 맞춰본다.
  본문 조회 자체가 안 되면 그 문서는 폐지됐거나 행정규칙 DB에 없는 것이다.

[연계]
  - 읽음: _dashboard/admrul_fresh_report.json (1차 결과)
  - 호출: lawService.do?target=admrul&ID=<일련번호> · lawSearch.do?target=admrul
  - 씀:   _dashboard/admrul_fresh_report.json (verdict 갱신, pass2 사유 기록)
"""
import json, os, re, sys, time
import urllib.request
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REPORT = os.path.join(ROOT, '_dashboard', 'admrul_fresh_report.json')
OC = 'hyoo1431'


def norm(s):
    """대조용 정규화 — 공백과 가운뎃점 표기 차이를 없앤다."""
    s = re.sub(r'\s+', '', str(s or ''))
    return s.replace('ㆍ', '·').replace('･', '·')


def strip_org(s):
    return re.sub(r'^\s*\([^)]{2,20}\)\s*', '', str(s or '')).strip()


def curl(url):
    """DRF 를 한 번 부른다. 이름은 옛것을 그대로 두되 속은 파이썬 표준 urllib 이다.

    ★2026-08-24 — `curl --cacert /root/.ccr/ca-bundle.crt` 를 쓰고 있었는데 그 인증서는
      개발 컨테이너에만 있는 파일이라 실제 서버에서는 첫 호출부터 전부 실패한다.
      이 점검을 서버 정기작업으로 옮겼으므로, 환경에 따라 있고 없고가 갈리는 것에 기대지 않게 고쳤다.
    """
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:
            time.sleep(1.5 + i)
    return ''


def official_name(serial):
    """보유 일련번호로 본문을 열어 공식 행정규칙명을 얻는다. 없으면 None."""
    url = ('https://www.law.go.kr/DRF/lawService.do?OC=%s&type=JSON&target=admrul&ID=%s'
           % (OC, serial))
    try:
        d = json.loads(curl(url))
    except Exception:
        return None
    for v in d.values():
        if isinstance(v, dict):
            b = v.get('행정규칙기본정보') or v
            n = b.get('행정규칙명') if isinstance(b, dict) else None
            if n:
                return str(n)
    return None


def search(name):
    url = ('https://www.law.go.kr/DRF/lawSearch.do?OC=%s&type=JSON&target=admrul'
           '&display=50&query=%s' % (OC, quote(name)))
    try:
        d = json.loads(curl(url))['AdmRulSearch']
    except Exception:
        return []
    arr = d.get('admrul') or []
    return [arr] if isinstance(arr, dict) else arr


def main():
    # 서버 정기작업은 결과를 `local_server/data/` 에 둔다(재배포해도 안 지워지는 곳).
    # 그래서 보고서 위치를 밖에서 지정할 수 있어야 한다.
    argv = sys.argv[1:]
    report = argv[argv.index('--report') + 1] if '--report' in argv else REPORT
    rep = json.load(open(report, encoding='utf-8'))
    # 1차가 '조회실패' 를 세 갈래로 갈랐다(2026-08-24) — 이름이 안 맞아 못 찾은 것이 대부분이다.
    # 옛 이름('조회실패')도 그대로 받아 준다(옛 보고서를 다시 돌릴 수 있게).
    RETRY = {'조회실패', '이름불일치', '응답없음', '현행표시없음'}
    todo = [r for r in rep['rows'] if r['verdict'] in RETRY]
    print('2차 대조 대상 %d건' % len(todo), flush=True)
    for i, r in enumerate(todo, 1):
        names = [strip_org(r['title'])]
        off = None
        for sid in r['held_ids']:
            off = official_name(sid)
            if off:
                break
            time.sleep(0.3)
        if off and norm(off) not in {norm(n) for n in names}:
            names.append(off)
        # ★이름이 맞는 것 중 **지금 시행 중인 판**만 고른다(2026-08-24, 1차와 같은 함정).
        #   API 는 아직 시행 안 된 개정 고시도 같은 이름으로 내려주고 그게 발령일 최신이라
        #   앞에 온다. 그걸 현행으로 잡으면 **시행 중인 멀쩡한 사본이 구버전으로 판정된다.**
        #   실측 사례: 「선내 안전·보건 및 사고예방 기준」 2026-85호(시행 2026-10-21 · 현행여부 N).
        found, pend = None, []
        for n in names:
            hits = [x for x in search(n) if norm(x.get('행정규칙명')) == norm(off or n)]
            if hits:
                live = [x for x in hits if str(x.get('현행연혁구분') or '').strip() == '현행']
                found = live[0] if live else None
                pend = [{'serial': str(x.get('행정규칙일련번호') or ''),
                         'issued': str(x.get('발령일자') or ''),
                         'no': str(x.get('발령번호') or '')} for x in hits if x is not found][:5]
                if found:
                    break
                # 이름은 맞는데 '현행'이 하나도 없다 — 폐지됐을 수 있다. 임의로 고르지 않는다.
                r['pass2_note'] = '이름은 맞는데 현행 표시가 없다(폐지 가능) — 사람이 확인할 것'
            time.sleep(0.3)
        if found:
            cur = {'serial': str(found.get('행정규칙일련번호') or ''),
                   'issued': str(found.get('발령일자') or ''),
                   'no': str(found.get('발령번호') or ''),
                   'state': str(found.get('현행연혁구분') or '')}
            r['current'] = cur
            r['official_name'] = off
            r['verdict'] = '현행' if cur['serial'] in r['held_ids'] else '구버전'
            r['pass2'] = '공식명 역조회로 재판정'
            if pend:
                r['pending'] = pend
        else:
            r['official_name'] = off
            r['pass2'] = ('본문은 열리나 현행 검색에 없음(폐지 가능)' if off
                          else '본문 조회 불가(폐지·DB 미수록 추정)')
        print('[%d/%d] %s %s' % (i, len(todo), r['verdict'], r['title'][:40]), flush=True)
        time.sleep(0.3)

    v = {}
    for r in rep['rows']:
        v[r['verdict']] = v.get(r['verdict'], 0) + 1
    rep['fresh'] = v.get('현행', 0)
    rep['stale'] = v.get('구버전', 0)
    rep['unknown'] = v.get('조회실패', 0) + v.get('응답없음', 0)
    rep['mismatch'] = v.get('이름불일치', 0) + v.get('현행표시없음', 0)
    # ★2차까지 돌리고도 "본문은 열리는데 현행 목록엔 없다"로 남는 것은 **폐지 가능**이다.
    #   구버전과 성격이 다르다 — 구버전은 새 판으로 갈면 되지만, 폐지된 것을 현행처럼 들고
    #   있으면 **없어진 규정을 살아 있는 것처럼 안내하게 된다.** 따로 세어 올린다.
    rep['maybe_repealed'] = sum(1 for r in rep['rows']
                                if str(r.get('pass2') or '').startswith('본문은 열리나'))
    json.dump(rep, open(report, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n최종: 현행 %d / 구버전 %d / 이름불일치 %d / 응답없음 %d'
          % (rep['fresh'], rep['stale'], rep['mismatch'], rep['unknown']))
    if rep['maybe_repealed']:
        print('   ★폐지 가능 %d건 — 본문은 열리는데 현행 목록에 없다.' % rep['maybe_repealed'])
        print('     구버전과 다르다: 없어진 규정을 현행처럼 안내하게 될 수 있다. 사람이 확인할 것.')


if __name__ == '__main__':
    main()
