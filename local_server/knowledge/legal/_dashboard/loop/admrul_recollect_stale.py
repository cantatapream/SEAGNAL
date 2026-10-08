#!/usr/bin/env python3
"""admrul_fresh 가 '구버전'으로 판정한 행정규칙을 현행본으로 다시 받아 raw를 갱신한다.

무엇을 하나:
  _dashboard/admrul_fresh_report.json 의 구버전 행마다
  lawService.do?target=admrul&ID=<현행 일련번호> 로 현행 본문(조문+별표)을 받아
  기존 raw .txt 를 같은 형식(머리글 + 본문)으로 덮어쓰고, 옆의 _admrul.json 목록의
  ID도 현행으로 고친다. 무엇이 얼마나 달라졌는지는 별도 보고서에 남긴다.

안전장치 (L-39·L-176 회귀 방지) — 두 겹이다
  ①크기: 새 본문이 기존의 70%보다 짧으면 보류. 스텁 응답으로 멀쩡한 원문을 날린 전례가 있다.
  ②사람 손의 흔적: 기존 파일에만 있고 새 본문에는 없는 표지(【이미지판독】·⚠REVIEW·
    '첨부파일 전사')가 있으면 보류. 2026-08-23에 크기 기준만으로는 못 막는 것을 실측했다 —
    별표가 새로 딸려와 글자 수는 오히려 늘었는데 정작 이미지 판독 전사 116블록이 지워졌다.
    크기는 "얼마나 있나"를 볼 뿐 "무엇이 사라졌나"를 못 본다.

[연계]
  - 읽음: _dashboard/admrul_fresh_report.json
  - 호출: https://www.law.go.kr/DRF/lawService.do (OC=hyoo1431, target=admrul)
  - 씀:   raw/**/행정규칙/*.txt · 같은 폴더 _admrul.json · _dashboard/admrul_recollect_report.json
사용법: python3 admrul_recollect_stale.py [--dry]
"""
import json, os, re, subprocess, sys, time
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REPORT = os.path.join(ROOT, '_dashboard', 'admrul_fresh_report.json')
OUT = os.path.join(ROOT, '_dashboard', 'admrul_recollect_report.json')
OC = 'hyoo1431'
CA = '/root/.ccr/ca-bundle.crt'
PROXY = os.environ.get('HTTPS_PROXY', '')
DRY = '--dry' in sys.argv
# 원문 머리글에 남길 '현행화' 날짜(KST). 종전에는 2026-08-23 이 박혀 있어, 다른 날 돌리면
# 원문에 틀린 날짜가 적혔다 — 언제 갈아끼웠는지가 나중에 판단 근거가 되므로 실제 날짜를 쓴다.
TODAY = subprocess.run(['date', '-u', '-d', '+9 hours', '+%Y-%m-%d'],
                       capture_output=True, text=True).stdout.strip() or '(날짜미상)'

# 기존 파일에만 있고 새 본문에 없으면 덮어쓰지 않는다 — 사람/도구가 손으로 넣은 것들이다.
HUMAN_MARKS = ['【이미지판독', '⚠REVIEW', '첨부파일 전사', '판독불가']


def curl(url):
    cmd = ['curl', '-sS', '--max-time', '40']
    # 인증서 묶음은 그 파일이 있을 때만 준다 — 없는 컴퓨터에서 `--cacert` 가 curl 을 통째로 실패시킨다
    # (3-82 에서 이 자를 `collect_approved.py` 가 부르게 되며 고쳤다 · 검증을 끄는 것이 아니다).
    if os.path.exists(CA):
        cmd += ['--cacert', CA]
    if PROXY:
        cmd += ['--proxy', PROXY]
    cmd.append(url)
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def L(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def flat(x):
    if x is None:
        return ''
    if isinstance(x, list):
        return '\n'.join(flat(i) for i in x)
    return str(x)


def fetch_body(serial, tries=4):
    """현행 일련번호로 조문 본문과 별표를 합쳐 돌려준다. (본문, 기본정보)

    같은 ID인데 한 번은 빈 응답이 오고 다시 부르면 정상으로 오는 것을 실측했다.
    (첫 실행에서 '본문없음' 4건이 났는데 재호출하니 전부 정상 응답이었다.)
    그래서 실패하면 간격을 늘려가며 tries회까지 다시 부른다.
    """
    for k in range(tries):
        b, i = _fetch_once(serial)
        if b:
            return b, i
        time.sleep(1.5 * (k + 1))
    return None, {}


def _fetch_once(serial):
    url = ('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=admrul&type=JSON&ID=%s'
           % (OC, serial))
    try:
        d = json.loads(curl(url))
    except Exception:
        return None, {}
    b = d.get('AdmRulService', {})
    info = b.get('행정규칙기본정보', {}) or {}
    jo = flat(b.get('조문내용'))
    byl = b.get('별표') or {}
    byltxt = ''
    units = byl.get('별표단위') if isinstance(byl, dict) else byl
    for un in L(units):
        if not isinstance(un, dict):
            continue
        byltxt += '\n[별표] ' + flat(un.get('별표제목')) + '\n' + \
                  re.sub(r'<[^>]+>', ' ', flat(un.get('별표내용')))
    body = (jo + ('\n\n' + byltxt if byltxt.strip() else '')).strip()
    # ★부칙도 같은 응답에서 받는다(3-89, 2026-10-08 실제로 당했다).
    #   이 함수는 조문·별표만 돌려줬고, refresh_file() 이 머리글 뒤를 통째로 갈아끼우므로
    #   L-218 백필(admrul_fill_addenda.py)로 붙여 둔 `[부칙]` 이 갱신 때마다 지워졌다 —
    #   여수·광양항 선박교통안전규정이 부칙 2개를 잃은 채로 갱신된 것을 diff 에서 잡았다.
    #   형식은 admrul_fill_addenda.py 와 같다(`[부칙]` 한 줄 + 문단들) — 그래야 그 도구가
    #   「이미있음」으로 알아보고 두 번 붙이지 않는다.
    bc = b.get('부칙')
    bc = bc.get('부칙내용') if isinstance(bc, dict) else None
    paras = [flat(t).strip() for t in L(bc) if flat(t).strip()] if bc else []
    if paras and body:
        body += '\n\n[부칙]\n' + '\n'.join(paras)
    return body, info


def head_lines(text):
    """기존 파일의 머리글(본문 시작 전까지)을 그대로 보존하기 위해 잘라낸다."""
    lines = text.split('\n')
    keep = []
    for ln in lines:
        if ln.strip() == '':
            break
        keep.append(ln)
    return keep, '\n'.join(lines[len(keep):]).lstrip('\n')


def refresh_file(rel, title, serial, body, info, held_ids, issued_fallback, touched, dry,
                 allow_shrink=False):
    """행정규칙 raw 파일 **하나**를 새 판 본문으로 갈아끼운다 — 안전장치를 그대로 건다. → 결과 dict

    main()(신선도 보고서의 구버전 행)과 `collect_approved.py`(관리자가 승인한 「행정규칙 개정」 — 3-82)가
    **같은 함수**를 쓴다. 덮어쓰기 규칙이 두 곳에 있으면 한쪽만 고쳐지는 일이 생긴다(L-386).
    @param rel   ROOT(=legal) 기준 상대경로 또는 절대경로
    @param title 로그·_admrul.json 에서 찾을 제목
    @param serial 새 판 행정규칙일련번호
    @param body/info fetch_body() 결과
    @param held_ids 옛 번호들(머리글 「현행화」 줄에 남긴다)
    @param issued_fallback 응답에 발령일자가 없을 때 쓸 값
    @param allow_shrink 사람이 옛 본문을 직접 열어 「줄어든 만큼이 옛 판 잔재·중복」임을 확인한 때만 True.
                        기계 실행(main·collect_approved)은 절대 넘기지 않는다.
    예: refresh_file('raw/…/행정규칙/포항항선박안전운항관리규정.txt', '포항항선박안전운항관리규정',
                     '2100000283648', body, info, ['2100000264778'], '20260805', touched, False)
        → {'status': '갱신', 'old_chars': …, 'new_chars': …}
    """
    # ★`_구판/` 은 **옛 판을 일부러 보존해 둔 폴더**다 — 현행판으로 덮으면 안 된다
    #   (2026-09-21, --dry 로 잡았다).
    #   실측: `_구판/여수항·광양항항만시설운영세칙_구판_ID2100000185240.txt` 가 `갱신` 대상으로
    #   올라왔다. 덮으면 **파일 이름에 박힌 판 ID 와 내용이 어긋난다** —
    #   "ID2100000185240 의 구판"이라는 이름 아래 2100000285128 의 본문이 들어앉는다.
    #   보존본이 보존이 아니게 되고, 나중에 "그때 무엇이 적혀 있었나"를 물을 길이 사라진다.
    #   ⚠이 폴더는 **A-1 이 구버전 판정의 근거로도 읽는다**(held_ids 에 그 ID 가 들어 있다).
    if os.sep + '_구판' + os.sep in os.sep + rel.replace('/', os.sep):
        return {'title': title, 'file': rel, 'status': '건너뜀(_구판 보존본)'}
    path = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
    try:
        old = open(path, encoding='utf-8').read()
    except Exception:
        return {'title': title, 'file': rel, 'status': '파일없음'}
    hdr, oldbody = head_lines(old)
    if len(body) < len(oldbody) * 0.7 and not allow_shrink:
        return {'title': title, 'file': rel, 'status': '보류(본문축소)',
                'old_chars': len(oldbody), 'new_chars': len(body)}
    # 사람 손이 들어간 흔적이 새 본문에 없으면 덮어쓰지 않는다(L-176).
    # ★머리글은 아래에서 그대로 남기므로(발령: 줄만 새로 쓴다) 머리글에 있는 표시는 잃지 않는다.
    #   (3-89, 2026-10-08) 「항로표지시설 관리지침」이 머리글 배너의 ⚠REVIEW 하나 때문에
    #   「사람작업 소실」로 걸렸다 — 실제로는 본문에 사람 손이 하나도 없었다.
    kept = '\n'.join(h for h in hdr if not h.startswith('발령:'))
    lost = [m for m in HUMAN_MARKS if m in old and m not in body and m not in kept]
    if lost:
        return {'title': title, 'file': rel, 'status': '보류(사람작업 소실)',
                'lost_marks': lost, 'old_chars': len(oldbody), 'new_chars': len(body)}
    hdr = [re.sub(r'^ID:\s*\d+', 'ID:' + serial, h) for h in hdr]
    # 머리글 ID 줄에 옛 '시행일:·발령일:' 이 함께 적혀 있으면 지운다 — 아래에서
    # 새 판의 발령·시행일을 권위 있는 한 줄로 다시 붙이므로, 남겨 두면 같은 머리글이
    # 2016년과 2026년을 동시에 말한다(2026-09-10 재활용환경성평가기관 지침에서 실제로 그랬다).
    hdr = [re.sub(r'\s*·\s*(시행일|발령일)\s*:\s*\d{8}', '', h) if h.startswith('ID:') else h
           for h in hdr]
    issued = flat(info.get('발령일자')) or issued_fallback
    eff = flat(info.get('시행일자'))
    hdr = [h for h in hdr if not h.startswith('발령:')]
    hdr.append('발령: %s %s · 발령일자 %s · 시행일자 %s'
               % (flat(info.get('제개정구분명')), flat(info.get('발령번호')), issued, eff))
    hdr.append('현행화: %s admrul_recollect_stale.py (구ID %s → 현행 %s)'
               % (TODAY, ','.join(held_ids), serial))
    new = '\n'.join(hdr) + '\n\n' + body + '\n'
    if not dry:
        open(path, 'w', encoding='utf-8').write(new)
        touched.add(path)
    # 옆 목록(_admrul.json)의 ID도 현행으로
    cat = os.path.join(os.path.dirname(path), '_admrul.json')
    if os.path.exists(cat) and not dry:
        try:
            c = json.load(open(cat, encoding='utf-8'))
            for k in c:
                if re.sub(r'\s+', '', k) == re.sub(r'\s+', '', title):
                    c[k]['ID'] = serial
            json.dump(c, open(cat, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            touched.add(cat)
        except Exception:
            pass
    return {'title': title, 'file': rel, 'status': '갱신',
            'old_chars': len(oldbody), 'new_chars': len(body),
            'old_id': held_ids, 'new_id': serial, 'issued': issued}


def main():
    touched = Touched('admrul_recollect_stale')
    rep = json.load(open(REPORT, encoding='utf-8'))
    stale = [r for r in rep['rows'] if r['verdict'] == '구버전']
    results = []
    for i, r in enumerate(stale, 1):
        serial = r['current']['serial']
        body, info = fetch_body(serial)
        title = r.get('official_name') or r['title']
        if not body:
            results.append({'title': title, 'status': '본문없음', 'files': r['files']})
            print('[%d/%d] 본문없음 %s' % (i, len(stale), title[:38]), flush=True)
            continue
        for rel in r['files']:
            rec = refresh_file(rel, title, serial, body, info, r['held_ids'],
                               r['current']['issued'], touched, DRY)
            results.append(rec)
            print('[%d/%d] %s %s' % (i, len(stale), rec['status'], title[:34]), flush=True)
        time.sleep(0.3)

    json.dump({'ran_at': TODAY, 'dry': DRY, 'results': results},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    touched.save()
    n = lambda s: sum(1 for x in results if x['status'] == s)
    print('\n갱신 %d / 보류 %d / 본문없음 %d / 파일없음 %d -> %s'
          % (n('갱신'), n('보류(본문축소)'), n('본문없음'), n('파일없음'), OUT))


if __name__ == '__main__':
    main()
