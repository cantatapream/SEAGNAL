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
import json, os, re, subprocess, sys, time
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REPORT = os.path.join(ROOT, '_dashboard', 'admrul_fresh_report.json')
OC = 'hyoo1431'
CA = '/root/.ccr/ca-bundle.crt'
PROXY = os.environ.get('HTTPS_PROXY', '')


def norm(s):
    """대조용 정규화 — 공백과 가운뎃점 표기 차이를 없앤다."""
    s = re.sub(r'\s+', '', str(s or ''))
    return s.replace('ㆍ', '·').replace('･', '·')


def strip_org(s):
    return re.sub(r'^\s*\([^)]{2,20}\)\s*', '', str(s or '')).strip()


def curl(url):
    cmd = ['curl', '-sS', '--max-time', '25', '--cacert', CA]
    if PROXY:
        cmd += ['--proxy', PROXY]
    cmd.append(url)
    return subprocess.run(cmd, capture_output=True, text=True).stdout


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
    rep = json.load(open(REPORT, encoding='utf-8'))
    todo = [r for r in rep['rows'] if r['verdict'] == '조회실패']
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
        found = None
        for n in names:
            for x in search(n):
                if norm(x.get('행정규칙명')) == norm(off or n):
                    found = x
                    break
            if found:
                break
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
    rep['unknown'] = v.get('조회실패', 0)
    json.dump(rep, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n최종: 현행 %d / 구버전 %d / 미판정 %d' % (rep['fresh'], rep['stale'], rep['unknown']))


if __name__ == '__main__':
    main()
