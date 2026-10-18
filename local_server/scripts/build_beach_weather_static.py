#!/usr/bin/env python3
"""
============================================================================
파일명: local_server/scripts/build_beach_weather_static.py
역할  : 기상청 해수욕장 목록(419곳 — 몰운대 제외)·해수부 2026 개장 일정·연안 관광지(1,354곳)를 묶어
        「관광지 → 3km 안 가장 가까운 기상청 해수욕장 1곳」 정적 표와 사람이 볼 확인 목록을 만든다.
        서버(services/beach_weather.js)는 이 표를 읽기만 한다. 개발 때만 실행한다(표준 라이브러리만 — 가져오기 단계만 openpyxl).
----------------------------------------------------------------------------
[사용자 결정 2026-10-18 — 설계서 coastal_safety_forecast.design.md §18]
  *"몰운대는 빼도록 하자"* · *"3km로 하면 될것 같고"* ·
  *"개장 일정 폐장 일정 관련해서는 해수부를 기준으로만 … 해수부 기준에 없는 것은 별도로 표시할 필요는 없을 것 같아"*
[입력]  config/coastal_safety/beach_sources/kma_beaches.json   — 기상청 「전국 해수욕장 날씨 조회서비스」 위경도 표(Sheet4 420행 그대로)
        config/coastal_safety/beach_sources/mof_open_2026.json — 해수부 2026 지정 해수욕장 283행 + 기상청 번호 대조(beach_num·link_cls)
        config/coastal_safety/risk_spots.json                 — 연안 관광지(id·이름·좌표·beach)
[출력]  config/coastal_safety/beach_weather_static.json       — beaches·open·links (서버가 읽음)
        config/coastal_safety/beach_links_review.csv          — 사람이 볼 애매한 항목(엑셀에서 열림, UTF-8 BOM)
[가져오기] 원본 엑셀이 새로 오면(해마다 해수부 표 갱신):
        python3 build_beach_weather_static.py --import <기상청 위경도.xlsx> <해수부 개장.xlsx> <대조 match.json>
        → beach_sources/*.json 을 다시 쓴 뒤 표를 만든다. 대조(match.json schedule → beach_num)는 2026-10-18 세션의 이름·지역 대조 결과다.
[연계]  나를 읽는 곳: local_server/services/beach_weather.js(서버 판단·문구) · 시험 local_server/scripts/test_beach_weather.js
============================================================================
"""
import csv, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'local_server/config/coastal_safety'
SRC = CONFIG / 'beach_sources'
LINK_M = 3000            # 사용자 *"3km로 하면 될것 같고"*
NAME_FIX_M = 6000        # 좌표가 부정확한 기상청 해수욕장을 같은 이름 관광지 좌표로 고칠 때 찾는 반경(5km 격자 중심 오차 ≈ 3.5km + 여유)
TIE_M = 300              # 둘째 후보가 첫째보다 이만큼 안쪽이면 확인 목록에 올린다
EXCLUDE = {164: '사용자 *"몰운대는 빼도록 하자"* (2026-10-18) — 국가지질공원이라 물놀이 해수욕장이 아님'}

# ── 기상청 단기예보 격자(LCC, 5km) — 기상청 활용가이드 「단기예보 지점 좌표(X,Y)위치와 위경도 간의 전환」 C 예제와 같은 상수 ──
_RE, _GRID, _S1, _S2, _OLON, _OLAT, _XO, _YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
_D = math.pi / 180
_re = _RE / _GRID
_sn = math.log(math.cos(_S1 * _D) / math.cos(_S2 * _D)) / math.log(math.tan(math.pi / 4 + _S2 * _D / 2) / math.tan(math.pi / 4 + _S1 * _D / 2))
_sf = math.tan(math.pi / 4 + _S1 * _D / 2) ** _sn * math.cos(_S1 * _D) / _sn
_ro = _re * _sf / math.tan(math.pi / 4 + _OLAT * _D / 2) ** _sn


def to_grid(lat, lon):
    """위경도 → 단기예보 격자 (nx, ny). 예: 을왕리(37.447,126.372) → (49,124). 호출: flags."""
    ra = _re * _sf / math.tan(math.pi / 4 + lat * _D / 2) ** _sn
    th = lon * _D - _OLON * _D
    th = (th + math.pi) % (2 * math.pi) - math.pi
    th *= _sn
    return int(math.floor(ra * math.sin(th) + _XO + 0.5)), int(math.floor(_ro - ra * math.cos(th) + _YO + 0.5))


def to_latlon(x, y):
    """격자 (nx, ny) → 그 격자 중심 위경도. 호출: flags(좌표가 격자 중심점인지)."""
    xn, yn = x - _XO, _ro - y + _YO
    ra = math.copysign(math.hypot(xn, yn), _sn)
    alat = 2 * math.atan((_re * _sf / ra) ** (1 / _sn)) - math.pi / 2
    th = 0.0 if xn == 0 else (math.copysign(math.pi / 2, xn) if yn == 0 else math.atan2(xn, yn))
    return alat / _D, (th / _sn + _OLON * _D) / _D


def dist_m(a_lat, a_lon, b_lat, b_lon):
    """두 점 거리(m, 하버사인). 예: dist_m(37.5,126.9,37.5,127.0) ≈ 8,8xx. 호출: 전부."""
    p1, p2 = a_lat * _D, b_lat * _D
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((b_lon - a_lon) * _D / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def display_name(name):
    """화면 이름. 괄호(별칭·지역 구분)를 빼고 「해수욕장」·「해변」 앞 띄어쓰기를 붙인다.
    예: '을왕리 해수욕장' → '을왕리해수욕장' · '송도 해수욕장(부산)' → '송도해수욕장' · '월정리해변(월정리해수욕장)' → '월정리해변'. 호출: build."""
    s = re.sub(r'\s*\([^)]*\)\s*', ' ', name).strip()
    s = re.sub(r'\s+(해수욕장|해변)', r'\1', s)
    return re.sub(r'\s+', ' ', s)


def norm(name):
    """이름 대조용. 괄호·공백·구두점·접미사(해수욕장·해변·해안·비치)를 뺀다. 예: '협재 해수욕장' → '협재'. 호출: same_name."""
    s = re.sub(r'\([^)]*\)', '', name)
    s = re.sub(r'[\s·.,\-_/]', '', s)
    return re.sub(r'(해수욕장|해변|해안|비치)$', '', s)


def same_name(spot_name, kma_name):
    """관광지 이름이 이 기상청 해수욕장을 가리키나. 같거나, 관광지 이름이 지역 머리말 + 해수욕장 이름(「부산 송도해수욕장」)이면 참.
    예: same_name('부산 송도해수욕장','송도 해수욕장(부산)') → True · same_name('송도','송도해수욕장') → True. 호출: build."""
    a, b = norm(spot_name), norm(kma_name)
    if len(b) < 2 or not a:
        return False
    return a == b or (a.endswith(b) and len(a) - len(b) <= 3)


def flags(b):
    """좌표 정확도 표지. grid_center = 좌표가 5km 격자 중심점(100m 안) · low_precision = 경위도 중 하나가 소수 둘째 자리 이하 ·
    nxny_mismatch = 좌표로 계산한 격자가 표의 nx·ny 와 다름. 셋 중 하나라도 있으면 '부정확'(거리 오차가 km 단위일 수 있음). 호출: build."""
    out = []
    glat, glon = to_latlon(b['nx'], b['ny'])
    if dist_m(b['lat'], b['lon'], glat, glon) < 100:
        out.append('grid_center')
    dec = min(len(repr(float(b['lat'])).split('.')[1]), len(repr(float(b['lon'])).split('.')[1]))
    if dec <= 2:
        out.append('low_precision')
    if to_grid(b['lat'], b['lon']) != (b['nx'], b['ny']):
        out.append('nxny_mismatch')
    return out


def do_import(kma_xlsx, mof_xlsx, match_json):
    """원본 엑셀 두 개 + 대조 결과를 beach_sources/*.json 으로 옮긴다(값은 그대로). 호출: --import."""
    import openpyxl
    rows = list(openpyxl.load_workbook(kma_xlsx, read_only=True)['Sheet4'].iter_rows(values_only=True))
    head = rows[0]
    assert head[1:7] == ('순번', '해수욕장', 'nx', 'ny', '경도', '위도'), head
    kma = [{'n': r[1], 'name': r[2], 'nx': r[3], 'ny': r[4], 'lon': r[5], 'lat': r[6]} for r in rows[1:] if r and r[1]]
    assert [b['n'] for b in kma] == list(range(1, len(kma) + 1))
    SRC.mkdir(parents=True, exist_ok=True)
    (SRC / 'kma_beaches.json').write_text(json.dumps({'_about': {
        'source': '기상청 「전국 해수욕장 날씨 조회서비스」(공공데이터포털 1360000/BeachInfoservice) 위경도 표 — 기상청48_전국해수욕장_날씨_조회서비스_위경도.xlsx Sheet4 그대로(순번 = beach_num)',
        'rows': len(kma)}, 'beaches': kma}, ensure_ascii=False, indent=0) + '\n')
    wb = openpyxl.load_workbook(mof_xlsx, read_only=True)
    mrows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(mrows) if r and r[0] == '연번')
    sched = json.load(open(match_json, encoding='utf-8'))['schedule']
    mof = []
    for r in mrows[hi + 1:]:
        if not r or not isinstance(r[0], int):
            continue
        m = sched.get(str(r[0]), {})
        d = lambda v: v.strftime('%Y-%m-%d') if hasattr(v, 'strftime') else None
        mof.append({'no': r[0], 'sido': r[1], 'sgg': r[2], 'name': r[3], 'status': r[5], 'open': d(r[6]), 'close': d(r[7]),
                    'beach_num': m.get('beach_num'), 'link_cls': m.get('cls'), 'link_method': m.get('method')})
    (SRC / 'mof_open_2026.json').write_text(json.dumps({'_about': {
        'source': '해양수산부 「2026 지정(283) 및 개장(252) 해수욕장」 표(open2026.xlsx) 그대로 + 기상청 번호 대조(beach_num·link_cls — 2026-10-18 세션 이름·지역 대조, match.json schedule)',
        'next_update': '해수부 공식 파일 다음 등록 예정 2026-08-29(해마다 갱신) — 설계서 §18 「해마다 갱신하는 방법」', 'rows': len(mof)}, 'schedule': mof}, ensure_ascii=False, indent=0) + '\n')
    print('가져오기: 기상청 %d행 · 해수부 %d행' % (len(kma), len(mof)))


def build():
    """정적 표와 확인 목록을 만든다. 재현 숫자를 찍는다. 호출: main."""
    kma = json.loads((SRC / 'kma_beaches.json').read_text())['beaches']
    mof = json.loads((SRC / 'mof_open_2026.json').read_text())['schedule']
    spots = json.loads((CONFIG / 'risk_spots.json').read_text())['spots']
    review = []
    beaches = []
    for b in kma:
        if b['n'] in EXCLUDE:
            continue
        f = flags(b)
        beaches.append({'n': b['n'], 'kma': b['name'], 'name': display_name(b['name']), 'lat': b['lat'], 'lon': b['lon'], 'flags': f, 'coord': 'kma'})
    # ① 좌표가 부정확한 해수욕장 — 같은 이름 관광지(해수욕장 표지가 있는 곳)가 6km 안에 있으면 그 관광지 좌표로 고친다(이름 대조 보조)
    beach_spots = [s for s in spots if s.get('beach')]
    for b in beaches:
        if not b['flags']:
            continue
        c = sorted((dist_m(b['lat'], b['lon'], s['lat'], s['lon']), s['id']) for s in beach_spots if same_name(s['name'], b['kma']))
        c = [x for x in c if x[0] <= NAME_FIX_M]
        if c:
            s = next(s for s in spots if s['id'] == c[0][1])
            review.append(['좌표 고침(이름 대조)', b['n'], b['name'], s['id'], s['name'], round(c[0][0]), ','.join(b['flags']), '기상청 좌표 → 같은 이름 관광지 좌표'])
            b.update({'lat': s['lat'], 'lon': s['lon'], 'coord': 'spot:' + s['id'], 'moved_m': round(c[0][0])})
        else:
            review.append(['좌표 부정확(고치지 못함)', b['n'], b['name'], '', '', '', ','.join(b['flags']), '같은 이름 관광지 없음 — 거리로만 연결하지 않음(이름이 같은 관광지만 연결)'])
    # ② 관광지마다 3km 안 해수욕장 — 이름이 같은 곳이 3km 안에 있으면 그것, 아니면 가장 가까운 곳. 좌표를 못 고친 부정확 해수욕장은 이름이 같을 때만.
    links = {}
    for s in spots:
        cand = []
        for b in beaches:
            d = dist_m(s['lat'], s['lon'], b['lat'], b['lon'])
            if d > LINK_M:
                continue
            same = same_name(s['name'], b['kma'])
            if b['flags'] and b['coord'] == 'kma' and not same:
                continue
            cand.append((0 if same else 1, d, b))
        if not cand:
            if s.get('beach'):
                near = min(((dist_m(s['lat'], s['lon'], b['lat'], b['lon']), b) for b in beaches), key=lambda x: x[0])
                review.append(['해수욕장 관광지인데 3km 안 연결 없음', near[1]['n'], near[1]['name'], s['id'], s['name'], round(near[0]), ','.join(near[1]['flags']), '가장 가까운 기상청 해수욕장(연결 안 함)'])
            continue
        cand.sort(key=lambda x: (x[0], x[1]))
        pick = cand[0]
        b = pick[2]
        links[s['id']] = {'n': b['n'], 'm': round(pick[1]), **({'self': True} if pick[0] == 0 else {})}
        near = sorted(cand, key=lambda x: x[1])
        if pick[0] == 1 and len(near) > 1 and near[1][1] - near[0][1] < TIE_M:
            review.append(['가까운 후보 둘(300m 안 차이)', b['n'], b['name'], s['id'], s['name'], round(pick[1]), '', '둘째 %s %dm' % (near[1][2]['name'], round(near[1][1]))])
        if pick[0] == 0 and near[0][2] is not b:
            review.append(['이름 같은 곳을 골랐지만 더 가까운 해수욕장 있음', b['n'], b['name'], s['id'], s['name'], round(pick[1]), '', '더 가까운 %s %dm' % (near[0][2]['name'], round(near[0][1]))])
        if s.get('beach') and pick[0] == 1:
            review.append(['해수욕장 관광지인데 이름이 다른 해수욕장에 연결', b['n'], b['name'], s['id'], s['name'], round(pick[1]), ','.join(b['flags']), ''])
    # ③ 해수부 개장 일정 — 개장(미개장 제외) + 기상청 번호에 연결된 것만. 같은 번호에 줄이 둘이면 이른 개장·늦은 폐장(2026 표에서는 넷 다 날짜가 같다).
    nums = {b['n'] for b in beaches}
    opens = {}
    for r in mof:
        if r['status'] != '개장' or not r['beach_num'] or r['beach_num'] not in nums or not r['open'] or not r['close']:
            continue
        k = str(r['beach_num'])
        o = opens.get(k)
        opens[k] = {'open': min(o['open'], r['open']) if o else r['open'], 'close': max(o['close'], r['close']) if o else r['close'],
                    'mof': (o['mof'] + [r['no']]) if o else [r['no']]}
        if r['link_cls'] != '확실':
            review.append(['해수부 일정 연결 확인(%s)' % r['link_cls'], r['beach_num'], next(b['name'] for b in beaches if b['n'] == r['beach_num']), 'MOF#%d' % r['no'], r['sgg'] + ' ' + r['name'], '', '', r.get('link_method') or ''])
    out = {
        '_about': {
            'built_by': 'local_server/scripts/build_beach_weather_static.py',
            'design': 'client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md §18',
            'beaches': '기상청 해수욕장(몰운대 제외). name = 화면 이름, kma = 기상청 이름, coord = kma(기상청 좌표) 또는 spot:<관광지 id>(좌표 부정확 → 같은 이름 관광지 좌표로 고침), flags = 좌표 정확도 표지',
            'open': '해수부 2026 개장 일정 — 기상청 번호 → {open, close, mof:[해수부 연번]}. 미개장·기상청에 없는 곳은 없다(사용자 「해수부 기준에 없는 것은 별도로 표시할 필요는 없을 것 같아」)',
            'links': '관광지 id → {n: 기상청 번호, m: 거리(m), self: 관광지 이름이 그 해수욕장 이름이면 true(화면은 거리 괄호를 뺀다)}. 3km 안 이름이 같은 곳 → 없으면 가장 가까운 곳',
            'link_m': LINK_M, 'excluded': {str(k): v for k, v in EXCLUDE.items()},
        },
        'beaches': beaches, 'open': opens, 'links': links,
    }
    (CONFIG / 'beach_weather_static.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    with open(CONFIG / 'beach_links_review.csv', 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['종류', '기상청 번호', '해수욕장(화면 이름)', '관광지 id / 해수부 연번', '관광지 이름 / 해수부 이름', '거리(m)', '좌표 표지', '메모'])
        w.writerows(review)
    kinds = {}
    for r in review:
        kinds[r[0]] = kinds.get(r[0], 0) + 1
    print('해수욕장 %d곳(제외 %d) · 좌표 부정확 %d곳 중 고침 %d · 연결 관광지 %d/%d(이름 같음 %d) · 개장 일정 %d곳' % (
        len(beaches), len(EXCLUDE), sum(1 for b in beaches if b['flags']), sum(1 for b in beaches if b['coord'] != 'kma'),
        len(links), len(spots), sum(1 for v in links.values() if v.get('self')), len(opens)))
    for k, v in kinds.items():
        print('  확인 목록 — %s: %d' % (k, v))


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--import':
        do_import(sys.argv[2], sys.argv[3], sys.argv[4])
    build()
