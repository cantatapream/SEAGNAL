#!/usr/bin/env python3
"""고시(행정규칙) raw 에 **별표·별지서식이 빠져 있는지**를 API 와 대조해 세기만 한다(읽기 전용).

왜 (L-219 의 두 번째 축, 2026-08-31):
  고시 수집기가 부칙을 한 번도 저장하지 않았다는 것을 오늘 찾았다(751건 중 601건 누락).
  같은 날 두 건에서 **별표도 빠져 있는 것**을 실제로 확인했다 —
  「부산항 도선구 도선안전절차」 별표1(통과속력 11구간)과 「마리나항만개발 업무처리요령」
  별표(사업계획 배점표)·별지 3종. 둘 다 API 응답에는 있었고 raw 에만 없었다.
  그래서 **전체가 얼마나 되는지 먼저 센다.** 세지 않고 "많을 것"이라고 말하지 않기 위해서다.

무엇을 보나 (파일을 하나도 고치지 않는다)
  raw/*/*/행정규칙/*.txt 마다
    ① 둘째 줄 `ID:` 로 admrul API 를 부른다
    ② 응답에 `별표.별표단위` 가 있나 / 몇 건인가
    ③ raw 쪽에 그 별표가 이미 있나 — 본문에 `[별표` 블록이 있거나 옆에 `<이름>_별표/` 폴더가 있으면 있는 것으로 본다
  세 가지를 맞춰 "API 에는 있는데 raw 에 없는" 고시를 센다.

⚠이 판정은 **거친 판정**이다. 본문에 `[별표` 블록이 하나라도 있으면 "있다"로 세므로,
  별표가 5건인데 1건만 들어온 경우는 못 잡는다. 그래서 응답 별표 수와 본문 블록 수도 함께 남긴다.

[연계]
  - 읽음: raw/*/*/행정규칙/*.txt (둘째 줄 ID · 본문 `[별표` 블록)
  - 호출: https://www.law.go.kr/DRF/lawService.do (OC=hyoo1431, target=admrul)
  - 씀:   _dashboard/admrul_annex_survey.json (조사 결과만 — raw 는 건드리지 않는다)
사용법: python3 admrul_annex_survey.py [--limit N] [--redo-failed]
        --redo-failed : 앞선 조사에서 **망 탓으로 실패한 것만** 다시 재어 옛 산출물에 얹는다
"""
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _admrul_id import find_id   # ★판번호를 찾는 단 한 곳(P-19b)
import glob, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OC = 'hyoo1431'
# ★`--out` 으로 산출 위치를 바꿀 수 있다 (2026-09-21 신설, C-2 이행).
#   서버 정기작업은 **볼륨(`local_server/data/`)** 에 써야 한다 — 이미지 안
#   (`_dashboard/`)에 쓰면 **재배포할 때마다 관리자가 처리하던 목록이 통째로 사라진다.**
#   기본값은 그대로라 사람이 손으로 돌릴 때의 동작은 안 바뀐다.
OUT = (sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv
       else os.path.join(LEGAL, '_dashboard', 'admrul_annex_survey.json'))


def api(url, tries=4):
    """★`curl` 로 부른다 — `urllib` 은 이 프록시 뒤에서 더 약하다 (2026-09-26 실측, 3-65).

    [무엇이 있었나] 조사 결과에 `실패 5` 가 남아 있었고 등록부는 그것을 「조사 실패(다시 재야 한다)」로
      적어 두었다. 그 다섯을 **curl 로 다시 부르니 다섯 다 받아졌다**
      (별표단위 5·2·38·없다·없다). 즉 「실패」는 **망 탓**이었고 자료의 사실이 아니었다.
    [왜 curl 인가] `curl --retry --retry-all-errors` 는 `Recv failure: Connection reset by peer`
      같은 끊김을 **자기 안에서** 다시 건다. urllib 은 그 자리에서 예외로 끝난다.
      같은 일을 오늘 `coastal_ordin_collect` 에서도 겪었다(L-322 의 그 뿌리).
    ⚠파이썬 쪽 되풀이도 그대로 둔다 — 둘이 겹쳐야 끝까지 간다.
    """
    last = None
    for i in range(tries):
        r = subprocess.run(['curl', '-sS', '--retry', '5', '--retry-all-errors',
                            '--retry-delay', '2', '--max-time', '60', url,
                            '-H', 'User-Agent: Mozilla/5.0'], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith('{'):
            try:
                return json.loads(r.stdout)
            except Exception as e:
                last = 'JSON 아님: ' + str(e)[:60]
        else:
            last = (r.stderr or '')[-80:] or ('되돌린값 %d' % r.returncode)
        time.sleep(1.5 * (i + 1))
    return {'_err': last}


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    files = sorted(glob.glob(os.path.join(LEGAL, 'raw', '*', '*', '행정규칙', '*.txt')))
    # ★`--redo-failed` — 앞선 조사에서 **망 탓으로 실패한 것만** 다시 잰다 (2026-09-26, 3-65).
    #   900건을 다시 부르지 않는다. 결과는 **옛 산출물에 얹어 합친다**(나머지 갈래를 잃지 않는다).
    #   망은 또 끊길 테니 한 번 쓰고 버릴 문이 아니다.
    옛것 = None
    if '--redo-failed' in sys.argv:
        옛것 = json.load(open(OUT, encoding='utf-8'))
        다시 = set(옛것.get('실패') or [])
        if not 다시:
            print('앞선 조사에 실패가 없다 — 다시 잴 것이 없다')
            return
        files = [p for p in files if os.path.basename(p) in 다시]
        print('실패였던 %d건만 다시 잰다' % len(files))
    res = {'빠짐': [], '이미있음': [], '수가모자람': [], 'API에별표없음': [], 'ID없음': [], '실패': []}
    done = 0
    for p in files:
        name = os.path.basename(p)
        text = open(p, encoding='utf-8').read()
        lines = text.split('\n')
        # ⚠둘째 줄만 보지 않는다 — 첫 줄에 ⚠REVIEW 배너가 붙어 ID 가 셋째 줄로 밀린 파일이 22건 있다.
        m = re.search(r'^ID:(\d+)', '\n'.join(lines[:8]), re.M)
        # 머리글에 ID 가 없으면 옆 `_admrul.json` 의 행정규칙일련번호를 쓴다
        # (2026-08-31 — 「선박법 사무취급 요령」이 이 이유로 조사에서 통째로 빠져 있었다).
        # ★판번호를 찾는 법은 `_admrul_id.find_id()` 한 곳에 있다(P-19b · L-386).
        #   위 `m` 은 옛 자다 — 지우지 않고 남기되, 값은 한 곳에서 받는다.
        aid = find_id(p, chr(10).join(lines[:8]))[0] or (m.group(1) if m else None)
        if not aid:
            mp = os.path.join(os.path.dirname(p), '_admrul.json')
            if os.path.exists(mp):
                try:
                    mm = json.load(open(mp, encoding='utf-8'))
                except Exception:
                    mm = {}
                for k, v in (mm.items() if isinstance(mm, dict) else []):
                    if isinstance(v, dict) and (v.get('파일') == name or k + '.txt' == name):
                        n = str(v.get('행정규칙일련번호') or '').strip()
                        if n.isdigit():
                            aid = n
                        break
        if not aid:
            res['ID없음'].append(name)
            continue
        if limit is not None and done >= limit:
            break
        d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={aid}")
        done += 1
        if not isinstance(d, dict) or '_err' in d:
            res['실패'].append(name)
            continue
        body = d.get('AdmRulService', d)
        units = (body.get('별표') or {}).get('별표단위')
        if units is None:
            res['API에별표없음'].append(name)
            continue
        if not isinstance(units, list):
            units = [units]
        want = len(units)
        # ★**번호 붙은** 블록만 센다(2026-08-31). 생산 코드(article_text.extractAttachments)는
        #   `[별표] 제목` 처럼 번호 없는 블록을 **버린다** — "하나뿐이니 별표 1이겠지"라고 넘겨짚으면
        #   엉뚱한 표를 띄우기 때문이다. 그런데 이 조사는 번호 없는 블록도 "있다"로 세고 있어서
        #   그런 고시가 백필 대상에서 아예 빠졌다(해기사시험과목 출제비율·훈련기록부에 관한 규정 등).
        #   API 는 별표번호를 주므로, 번호 없는 블록만 가진 고시는 채워 넣어야 한다.
        have_blocks = len(re.findall(r'^\[(?:별표|별지|서식)\s*제?\s*\d', text, re.M))
        # ★고시 별표는 `<법>/별표/<고시명>_별표N.txt` 에 있다(2026-08-31 정정).
        #   처음에는 `행정규칙/<고시명>_별표/` 하위폴더를 셌는데, 그 자리는 **챗봇이 읽지 않는 자리**여서
        #   그날 전부 `<법>/별표/` 로 옮겼다. 그 뒤 이 도구가 옮겨 간 파일을 못 세어
        #   **채워 넣은 뒤에 오히려 '빠짐'이 늘어난 것처럼** 나왔다. 세는 자리를 맞춘다.
        lawdir = os.path.dirname(os.path.dirname(p))
        gosi_key = re.sub(r'[\\/:*?"<>|\s]', '', os.path.basename(p)[:-4])
        byl_files = [n for n in os.listdir(os.path.join(lawdir, '별표'))
                     if n.endswith('.txt') and re.sub(r'[\\/:*?"<>|\s]', '', n).startswith(gosi_key)] \
                    if os.path.isdir(os.path.join(lawdir, '별표')) else []
        have = have_blocks + len(byl_files)
        row = {'파일': name, 'API별표수': want, 'raw보유': have,
               '제목': [ (u.get('별표제목') or '')[:40] for u in units ][:6]}
        if have == 0:
            res['빠짐'].append(row)
        elif have < want:
            res['수가모자람'].append(row)
        else:
            res['이미있음'].append(name)

    if 옛것 is not None:
        # 합친다 — 다시 잰 이름들을 옛 갈래에서 빼고, 새 갈래에 넣는다.
        다시본 = {os.path.basename(p) for p in files}
        def 이름(x):
            return x if isinstance(x, str) else str((x or {}).get('파일') or (x or {}).get('name') or x)
        합 = {}
        for k in ('빠짐', '이미있음', '수가모자람', 'API에별표없음', 'ID없음', '실패'):
            남은 = [x for x in (옛것.get(k) or []) if 이름(x) not in 다시본]
            합[k] = 남은 + res[k]
        print('  ── 합친 결과(옛 것에 얹었다) ──')
        for k in 합:
            print('  %s: %d건  (이번에 다시 잰 것 %d건)' % (k, len(합[k]), len(res[k])))
        합['checked'] = (옛것.get('checked') or 0) + done
        합['ran_at'] = time.strftime('%Y-%m-%d %H:%M:%S KST', time.gmtime(time.time() + 9 * 3600))
        합['_실패만_다시_잰_날'] = 합['ran_at']
        res = 합
    for k in res:
        if isinstance(res[k], list):
            print(f"{k}: {len(res[k])}건")
    # 스캐너가 화면에 '언제 · 몇 건'을 쓰려면 숫자가 결과 안에 있어야 한다(2026-09-21).
    res['checked'] = done
    res['ran_at'] = time.strftime('%Y-%m-%d %H:%M:%S KST', time.gmtime(time.time() + 9 * 3600))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    _tmp = OUT + '.tmp'
    with open(_tmp, 'w', encoding='utf-8') as _f:
        json.dump(res, _f, ensure_ascii=False, indent=1)
        _f.flush()
        os.fsync(_f.fileno())
    os.replace(_tmp, OUT)   # 중간에 죽어도 옛 산출물이 반쯤 덮이지 않는다
    print('조사 결과:', OUT)


if __name__ == '__main__':
    main()
