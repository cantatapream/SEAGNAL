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
사용법: python3 admrul_annex_survey.py [--limit N]
"""
import glob, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
OC = 'hyoo1431'
OUT = os.path.join(LEGAL, '_dashboard', 'admrul_annex_survey.json')


def api(url, tries=4):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            last = str(e)
            time.sleep(1.5 * (i + 1))
    return {'_err': last}


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    files = sorted(glob.glob(os.path.join(LEGAL, 'raw', '*', '*', '행정규칙', '*.txt')))
    res = {'빠짐': [], '이미있음': [], '수가모자람': [], 'API에별표없음': [], 'ID없음': [], '실패': []}
    done = 0
    for p in files:
        name = os.path.basename(p)
        text = open(p, encoding='utf-8').read()
        lines = text.split('\n')
        m = re.match(r'^ID:(\d+)', lines[1]) if len(lines) > 1 else None
        if not m:
            res['ID없음'].append(name)
            continue
        if limit is not None and done >= limit:
            break
        d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={m.group(1)}")
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
        have_blocks = len(re.findall(r'^\[별표', text, re.M)) + len(re.findall(r'^\[별지', text, re.M))
        have_dir = os.path.isdir(p[:-4] + '_별표')
        dir_files = len(glob.glob(p[:-4] + '_별표/*.txt')) if have_dir else 0
        have = have_blocks + dir_files
        row = {'파일': name, 'API별표수': want, 'raw보유': have,
               '제목': [ (u.get('별표제목') or '')[:40] for u in units ][:6]}
        if have == 0:
            res['빠짐'].append(row)
        elif have < want:
            res['수가모자람'].append(row)
        else:
            res['이미있음'].append(name)

    for k in res:
        print(f"{k}: {len(res[k])}건")
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('조사 결과:', OUT)


if __name__ == '__main__':
    main()
