#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
파일명: local_server/scripts/collect_tide_hghlw.py
역할: 표준항(조석 예보지점)의 1년치 고조·저조 시각·높이를 공공데이터포털
      「조석예보(고, 저조)」 API 로 받아 지점별 CSV 로 쌓는다. (앱이 도는 중에 쓰는 코드가 아니라
      1년에 한 번 사람이 돌리는 수집 도구다.)

[쓰는 법]
  TIDE_HGHLW_KEYS="키1,키2,키3" python3 local_server/scripts/collect_tide_hghlw.py 2027
  - 키는 저장소에 적지 않는다(환경변수로만). 키 하나에 하루 10,000번이다.
  - 한 번 호출 = 한 지점·하루치(고조·저조 2~4건). 166곳 × 365일 = 60,590번 → 키 3개로 3일.
  - 끝에 --edge 를 붙이면 앞뒤 하루(전해 12-31·다음 해 01-01)만 받아 _edge.csv 에 쓴다(332번 — 1년치를 다 받은 뒤 한 번).
  - 이미 받은 지점(CSV 가 있는 지점)은 건너뛴다. 한도에 걸리면 멈춘다 → 다음 날 같은 명령으로 이어받는다.

[연계]
  - 읽는 것: client/tide_data/Raw_tide_data/<연도>_hghlw/_stations.txt (예보지점 코드, 한 줄에 하나 —
            API 활용가이드의 「예보지점 목록」 166곳)
  - 쓰는 것: 같은 폴더의 _part/<코드>.json (받는 도중의 날짜 — 다 받으면 지워진다) · <코드>.csv (관측소코드,관측소명,날짜시간,조위(cm),고저구분 — 기존 Raw_tide_data 와 같은 칸)
            · _nodata.csv (그 날 자료가 없다고 답한 지점·날짜) · _coords.csv (지점 이름·위도·경도)
  - 다음 단계: 이 CSV 들을 합쳐 client/tide_data/tide_data_<연도>.js 를 만든다(client/tide.js 가 읽는 파일).
"""
import csv
import datetime
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

URL = 'https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'client', 'tide_data', 'Raw_tide_data')
DAILY_LIMIT = 10000   # 키 하나의 하루 한도(포털 「일일 트래픽」)
WORKERS = 12          # 동시에 받는 지점 수(호출 한 번에 1.7초쯤 걸린다 — 2026-11-23 실측)


class QuotaOut(Exception):
    """쓸 수 있는 키가 없다(전부 한도에 걸렸다)."""


class Keys:
    """키 돌려 쓰기 — 호출마다 다음 키, 한도에 걸린 키는 뺀다.
    예) Keys(['a','b']).pick() → 'a', 다음은 'b', 다음은 'a' …
    """

    def __init__(self, keys, budget):
        self.left = {k: budget for k in keys}   # 이번 실행에서 키마다 더 부를 수 있는 횟수
        self.order = list(keys)
        self.i = 0
        self.lock = threading.Lock()

    def pick(self):
        with self.lock:
            live = [k for k in self.order if self.left[k] > 0]
            if not live:
                raise QuotaOut()
            self.i += 1
            k = live[self.i % len(live)]
            self.left[k] -= 1
            return k

    def kill(self, k):
        with self.lock:
            self.left[k] = 0


def fetch_day(keys, code, ymd):
    """한 지점·하루치를 받는다.
    @returns ('ok', [item…]) | ('nodata', 응답코드)
    한도·인증 오류면 그 키를 빼고 다른 키로, 접속 오류면 6번까지 다시 부른다.
    """
    net_fail = 0
    while True:
        k = keys.pick()
        try:
            r = requests.get(URL, params={'serviceKey': k, 'obsCode': code, 'reqDate': ymd,
                                          'type': 'json', 'numOfRows': 300}, timeout=40)
            j = r.json()
        except Exception as e:  # 접속 끊김·JSON 아님(포털 오류 화면)
            text = ''
            try:
                text = r.text[:300]
            except Exception:
                pass
            if 'LIMITED_NUMBER' in text or 'SERVICE_KEY' in text or 'SERVICE ACCESS DENIED' in text or 'DEADLINE' in text:
                print(f'  ⚠ 키 {k[:6]}… 한도/인증 오류 → 이 키는 그만 쓴다: {text[:120]!r}', flush=True)
                keys.kill(k)
                continue
            net_fail += 1
            if net_fail > 6:
                raise RuntimeError(f'{code} {ymd}: 접속 오류 7번 — {e} {text[:120]!r}')
            time.sleep(2 * net_fail)   # 중계 서버가 연결을 끊는 일이 있다 — 잠깐 쉬고 다시
            continue
        head = j.get('header') or (j.get('response') or {}).get('header') or {}
        body = j.get('body') or (j.get('response') or {}).get('body') or {}
        rc = str(head.get('resultCode'))
        if rc == '00':
            items = (body.get('items') or {}).get('item') or []
            return 'ok', items if isinstance(items, list) else [items]
        if rc == '03':      # NODATA_ERROR — 그 날 자료 없음
            return 'nodata', rc
        if rc in ('22', '30', '31', '32', '20'):   # 한도 초과·키 미등록·기한 만료 등
            print(f'  ⚠ 키 {k[:6]}… 응답 {rc} {head.get("resultMsg")} → 이 키는 그만 쓴다', flush=True)
            keys.kill(k)
            continue
        if 'LIMITED_NUMBER' in r.text or 'SERVICE_KEY' in r.text or 'DEADLINE' in r.text:
            # 한도 초과는 머리말 없는 JSON(OpenAPI_ServiceResponse)으로 온다 — 이 키를 뺀다(2026-11-23 실제 응답으로 확인)
            keys.kill(k)
            continue
        # 머리말이 없거나 모르는 코드 — 포털이 가끔 엉뚱한 답을 준다. 원문을 찍고 다시 부른다.
        net_fail += 1
        print(f'  ? {code} {ymd}: 모르는 응답({rc}) {r.text[:160]!r} — 다시 부름 {net_fail}', flush=True)
        if net_fail > 6:
            raise RuntimeError(f'{code} {ymd}: 응답 {rc} {head.get("resultMsg")}')
        time.sleep(2 * net_fail)


def collect_station(keys, code, days, out_dir):
    """한 지점의 1년치를 받아 <코드>.csv 로 쓴다. 365일을 다 받았을 때만 CSV 를 만든다.
    받는 도중의 날짜는 _part/<코드>.json 에 쌓아 두고, 끊기면 다음 실행이 그 날짜부터 이어받는다
    (2026-11-23: 처음엔 끊기면 지점을 통째로 버렸더니 24곳이 300번씩 헛돌았다)."""
    rows, nodata, coord = [], [], None
    part = os.path.join(out_dir, '_part', code + '.json')   # {날짜: [item…] 또는 'nodata'}
    got = json.load(open(part, encoding='utf-8')) if os.path.exists(part) else {}

    def save_part():
        os.makedirs(os.path.dirname(part), exist_ok=True)
        with open(part + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(got, f, ensure_ascii=False)
        os.replace(part + '.tmp', part)

    try:
        for n, ymd in enumerate(d for d in days if d not in got):
            kind, val = fetch_day(keys, code, ymd)
            got[ymd] = 'nodata' if kind == 'nodata' else val
            if n % 40 == 39:
                save_part()
    finally:
        save_part()   # 한도·오류로 끊겨도 받은 날짜는 남긴다

    for ymd in days:
        val = got[ymd]
        if val == 'nodata':
            nodata.append(ymd)
            continue
        for it in val:
            lv = it.get('predcTdlvVl')
            lv = str(int(lv)) if float(lv) == int(float(lv)) else str(lv)
            rows.append([code, it.get('obsvtrNm'), it.get('predcDt'), lv,
                         '고조' if str(it.get('extrSe')) in ('1', '3') else '저조'])
            coord = (it.get('obsvtrNm'), it.get('lat'), it.get('lot'))
    tmp = os.path.join(out_dir, code + '.csv.tmp')
    with open(tmp, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(['관측소코드', '관측소명', '날짜시간', '조위(cm)', '고저구분'])
        w.writerows(rows)
    os.replace(tmp, os.path.join(out_dir, code + '.csv'))
    os.remove(part)
    return code, len(rows), nodata, coord


def collect_edge(keys, year, codes, out_dir):
    """앞뒤 하루(전해 12-31 · 다음 해 01-01)를 받아 _edge.csv 에 쓴다(지점별 CSV 와 같은 5칸).
    [왜] 임의항은 기준 표준항 시각을 조시차만큼 밀어 계산한다 — 밀면 자정을 넘는 고조·저조가 있어
         그 해 첫날·끝날을 채우려면 앞뒤 하루가 필요하다. [연계] build_tide_points_year.js 가 읽는다."""
    rows = []
    for code in codes:
        for ymd in (f'{year - 1}1231', f'{year + 1}0101'):
            kind, val = fetch_day(keys, code, ymd)
            if kind != 'ok':
                continue
            for it in val:
                lv = it.get('predcTdlvVl')
                lv = str(int(lv)) if float(lv) == int(float(lv)) else str(lv)
                rows.append([code, it.get('obsvtrNm'), it.get('predcDt'), lv, '고조' if str(it.get('extrSe')) in ('1', '3') else '저조'])
    with open(os.path.join(out_dir, '_edge.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(['관측소코드', '관측소명', '날짜시간', '조위(cm)', '고저구분'])
        w.writerows(rows)
    print(f'앞뒤 하루: {len(codes)}곳 · {len(rows)}줄 → _edge.csv', flush=True)


def main():
    year = int(sys.argv[1])
    budget = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else DAILY_LIMIT   # 키마다 이번에 쓸 횟수
    key_list = [k.strip() for k in os.environ.get('TIDE_HGHLW_KEYS', '').split(',') if k.strip()]
    if not key_list:
        sys.exit('TIDE_HGHLW_KEYS 환경변수에 키를 넣어 주세요(쉼표로 구분).')
    out_dir = os.path.join(ROOT, f'{year}_hghlw')
    codes = [c.strip() for c in open(os.path.join(out_dir, '_stations.txt'), encoding='utf-8') if c.strip()]
    if '--edge' in sys.argv:
        collect_edge(Keys(key_list, 400), year, codes, out_dir)
        return
    todo = [c for c in codes if not os.path.exists(os.path.join(out_dir, c + '.csv'))]
    d, days = datetime.date(year, 1, 1), []
    while d.year == year:
        days.append(d.strftime('%Y%m%d'))
        d += datetime.timedelta(days=1)
    print(f'{year}년: 전체 {len(codes)}곳 · 이미 받음 {len(codes) - len(todo)}곳 · 남음 {len(todo)}곳 · 키 {len(key_list)}개 × {budget}번', flush=True)

    keys = Keys(key_list, budget)
    done = 0
    # 지점 단위로 나눠 동시에 받는다(한 지점 안에서는 날짜 순서대로).
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(collect_station, keys, c, days, out_dir): c for c in todo}
        for fut, c in futs.items():
            try:
                code, n, nodata, coord = fut.result()
            except QuotaOut:
                continue
            except Exception as e:
                print(f'  ✗ {c}: {e}', flush=True)
                continue
            done += 1
            if coord:   # API 가 알려 준 지점 이름·위도·경도(표준항 가려내기에 쓴다)
                with open(os.path.join(out_dir, '_coords.csv'), 'a', encoding='utf-8') as f:
                    f.write(f'{code},{coord[0]},{coord[1]},{coord[2]}\n')
            if nodata:
                with open(os.path.join(out_dir, '_nodata.csv'), 'a', encoding='utf-8') as f:
                    for ymd in nodata:
                        f.write(f'{code},{ymd}\n')
            print(f'  ✓ {code}: {n}건 · 자료 없는 날 {len(nodata)}일 ({done}/{len(todo)})', flush=True)
    left = len([c for c in codes if not os.path.exists(os.path.join(out_dir, c + '.csv'))])
    print(f'끝: 이번에 {done}곳 받음 · 아직 남은 곳 {left}곳 · 키별 남은 횟수 {[v for v in keys.left.values()]}', flush=True)


if __name__ == '__main__':
    main()
