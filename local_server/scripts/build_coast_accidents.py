#!/usr/bin/env python3
"""관광지별 「주변 연안 인명사고(2020~2024)」 정적 표를 만든다 — 연안 시트의 사고발생현황·인명사고 현황용.
초보자용: 관광지마다 지도에 칠해 둔 육지 영역(반경 3km 원을 이웃과 나눈 뒤 육지만 남긴 것)에
         바다 쪽으로 500m 를 덧붙인 곳에서 난 인명사고를 모아, 관광지 id → 사고 목록(최신순)으로 저장한다.

[사용자 결정 원문 2026-10-16]
  「같은 반경인데 육상에 그려진 반경을 기준으로 해당영역 내 + 해양쪽 영역으로 나가야 될 것 같아.
   인명사고는 해양쪽에서 발생하니까. 해양쪽 영역으로는 500M정도까지 인명사고를 집계할 수 있도록 하고」
  유형: 익수·추락·고립·표류 + 기타(인명). 자살은 반영하지 않는다. 변사·해양오염은 앞선 결정대로 뺀다.

[영역 — 거리는 전부 EPSG:5179(미터)에서 잰다]
  육지 몫 P   = risk_spots.json 의 그 관광지 geometry (build_risk_static.py: 3km 24각형 ∩ 이웃 수직이등분 ∩ 육지)
  바다 덧붙임 S = P 를 500m 버퍼한 것 − 육지(risk_spots.json landGeometry)
  split   (기본·추천) : P ∪ (S ∩ 이 관광지의 수직이등분 칸)  → 바다 띠도 가장 가까운 관광지 몫, 겹침 없음
  overlap (비교용)    : P ∪ S                                  → 이웃 띠와 겹치면 두 곳 모두에 센다
  circle  (비교용 통계만): 관광지 점에서 3,000m 안(앞선 「3km 원」 방식)
  좌표가 똑같은 관광지(28곳)는 첫 행이 영역을 갖고(build_risk_static 규칙) 나머지는 같은 목록을 그대로 받는다.
  육지 몫이 비어 있는 관광지(좌표가 해안선 마스크 바다에 찍힌 6곳)는 영역을 만들 수 없어 null 로 둔다(0건과 구분).

[사고] client/accident_persons.json rows
  [위도,경도,'YYYYMMDD',위치글,유형코드,관할코드,사고자수,구조,사망,실종,…] (build_accidents.js Person 열 순서)
  2020-01-01~2024-12-31 · 유형 ATY001 익수 / ATY002 추락 / ATY003 고립 / ATY007 표류 / ATY008 기타(인명)
  같은 좌표·같은 날짜·같은 유형은 1건(원본에서 먼저 나온 행을 쓴다 — 원본은 최신순).

[출력] local_server/config/coastal_safety/coast_accidents.json
  {"_about":{…}, "spots":{"<관광지 id>":[{"date":"2024-07-30","year":2024,"type":"익수","death":0,"missing":0,"rescue":1},…] | null}}
  목록은 날짜 내림차순(같은 날은 원본 순서). 화면 붙이기는 아직 하지 않았다(risk_store.coastDetail 미연결).

[사용법] (개발 때만. shapely·pyproj 필요 — 운영 서버는 JSON 만 읽는다)
  python3 -I <저장소>/local_server/scripts/build_coast_accidents.py            # split 으로 출력 + 세 방식 통계
  python3 -I <저장소>/local_server/scripts/build_coast_accidents.py --mode overlap <출력경로>
[연계] 입력 config/coastal_safety/risk_spots.json(build_risk_static.py 산출) · client/accident_persons.json(build_accidents.js 산출)
       시험 local_server/scripts/test_coast_accidents.js(verify_all.sh SUITES) · 설계 client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md
"""
import json, math, sys, hashlib, statistics
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import shape, Point, Polygon, box
from shapely.strtree import STRtree
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
SPOTS = ROOT / 'local_server/config/coastal_safety/risk_spots.json'
PERSONS = ROOT / 'client/accident_persons.json'
DEST = ROOT / 'local_server/config/coastal_safety/coast_accidents.json'
TYPES = {'ATY001': '익수', 'ATY002': '추락', 'ATY003': '고립', 'ATY007': '표류', 'ATY008': '기타'}
FROM, TO = '20200101', '20241231'
SEA_M, CIRCLE_M = 500, 3000
_fwd = Transformer.from_crs(4326, 5179, always_xy=True)

def project(geo):
    """위경도 형상을 5179 미터 좌표로 바꾸고 유효화한다. 예: 꼬인 육지 링 → make_valid. 호출: main."""
    return shapely.make_valid(shapely.transform(geo, lambda x, y: _fwd.transform(x, y), interleaved=False))

def areal(geo):
    """make_valid 결과에서 면만 남긴다(선·점 조각 제거). 호출: project 이후 영역 계산."""
    parts = [g for g in shapely.get_parts(geo) if g.geom_type in ('Polygon', 'MultiPolygon')]
    return shapely.union_all(parts) if parts else Polygon()

def cell(i, pts, tree):
    """관광지 i 의 수직이등분 칸(바다 띠까지 덮도록 이웃 7km 안)을 만든다. 같은 좌표 이웃은 건너뛴다.
    예: 이웃이 2km 옆이면 그 사이 1km 지점에서 잘린다. 호출: main(split)."""
    p = pts[i]; reach = CIRCLE_M + SEA_M
    c = box(p.x - reach - 10, p.y - reach - 10, p.x + reach + 10, p.y + reach + 10)
    for j in sorted(int(k) for k in tree.query(p, predicate='dwithin', distance=2 * reach)):
        q = pts[j]; dx, dy = q.x - p.x, q.y - p.y; d = math.hypot(dx, dy)
        if j == i or d < 1e-7: continue
        nx, ny = dx / d, dy / d; tx, ty = -ny, nx; mx, my = (p.x + q.x) / 2, (p.y + q.y) / 2; L = 100000
        c = c.intersection(Polygon([(mx + tx * L, my + ty * L), (mx - tx * L, my - ty * L),
                                    (mx - tx * L - nx * L, my - ty * L - ny * L), (mx + tx * L - nx * L, my + ty * L - ny * L)]))
    return c

def load_accidents():
    """기간·유형을 거르고 같은 좌표·날짜·유형을 1건으로 줄인다. 예: 중문해수욕장 2023-06-26 익수 2행 → 1건.
    @returns (목록, 걸러진 행 수, 중복으로 뺀 수) 호출: main."""
    rows = json.loads(PERSONS.read_text())['rows']
    keep, seen, dup = [], set(), 0
    for r in rows:
        if not (FROM <= r[2] <= TO and r[4] in TYPES): continue
        key = (r[0], r[1], r[2], r[4])
        if key in seen: dup += 1; continue
        seen.add(key); keep.append(r)
    return keep, len(rows) - len(keep) - dup, dup

def dist(values):
    """건수 분포를 요약한다. 예: [0,0,3] → 0건 66.7%. 호출: report."""
    v = sorted(values); n = len(v)
    return {'n': n, 'zero': round(sum(x == 0 for x in v) / n * 100, 1), 'median': statistics.median(v),
            'p90': v[min(n - 1, math.ceil(0.9 * n) - 1)], 'max': v[-1], 'total': sum(v)}

def main():
    """세 방식 영역으로 사고를 붙이고 통계를 찍은 뒤 고른 방식을 저장한다."""
    args = sys.argv[1:]; mode = 'split'
    if '--mode' in args: k = args.index('--mode'); mode = args[k + 1]; del args[k:k + 2]
    assert mode in ('split', 'overlap'), mode
    dest = Path(args[0]) if args else DEST
    data = json.loads(SPOTS.read_text()); spots = data['spots']
    land = areal(project(shape(data['landGeometry'])))
    land_parts = list(shapely.get_parts(land)); land_tree = STRtree(land_parts)
    pts = [project(Point(s['lon'], s['lat'])) for s in spots]; ptree = STRtree(pts)
    owner = {}
    for i, s in enumerate(spots): owner.setdefault((s['lat'], s['lon']), i)
    acc, filtered, dup = load_accidents()
    apts = [project(Point(r[1], r[0])) for r in acc]; atree = STRtree(apts)
    hits = {'split': {}, 'overlap': {}, 'circle': {}}
    no_area = []
    for i, s in enumerate(spots):
        hits['circle'][i] = sorted(int(k) for k in atree.query(pts[i], predicate='dwithin', distance=CIRCLE_M))
        o = owner[(s['lat'], s['lon'])]
        if o != i: continue  # 같은 좌표 뒷 행은 아래에서 첫 행 결과를 그대로 받는다
        own = areal(project(shape(s['geometry']))) if s['geometry']['coordinates'] else Polygon()
        if own.is_empty: no_area.append(i); continue
        buf = own.buffer(SEA_M)
        near = [shapely.clip_by_rect(land_parts[int(k)], *buf.bounds) for k in land_tree.query(buf)]  # 본토 한 덩어리(24만 점)를 통째로 빼면 느리다
        sea = buf.difference(shapely.union_all(near)) if near else buf
        regions = {'overlap': shapely.union_all([own, sea]), 'split': shapely.union_all([own, sea.intersection(cell(i, pts, ptree))])}
        for m, g in regions.items(): hits[m][i] = sorted(int(k) for k in atree.query(g, predicate='intersects'))
    for i, s in enumerate(spots):
        o = owner[(s['lat'], s['lon'])]
        for m in ('split', 'overlap'):
            if o != i and o in hits[m]: hits[m][i] = hits[m][o]
    report(spots, acc, hits, no_area, owner)
    def entry(r):
        d = r[2]; return {'date': f'{d[:4]}-{d[4:6]}-{d[6:]}', 'year': int(d[:4]), 'type': TYPES[r[4]], 'death': r[8], 'missing': r[9], 'rescue': r[7]}
    out = {}
    for i, s in enumerate(spots):
        ks = hits[mode].get(i)
        out[s['id']] = None if ks is None else [entry(acc[k]) for k in sorted(ks, key=lambda k: (-int(acc[k][2]), k))]
    attached = set(k for ks in hits[mode].values() for k in ks)
    about = {'version': 'coast-accidents-v1', 'mode': mode, 'period': ['2020-01-01', '2024-12-31'],
             'types': {c: t for c, t in TYPES.items()}, 'excluded': '자살(ATY006)·변사(ATY005)·해양오염(ATY034)·응급환자(ATY004)·기타(ATY038) 및 기간 밖',
             'dedupe': 'same lat,lon,date,type → first source row', 'distanceCrs': 'EPSG:5179', 'seaBufferM': SEA_M,
             'area': 'risk_spots.json geometry ∪ (buffer500 − landGeometry)' + (' ∩ 수직이등분 칸(이웃 7km)' if mode == 'split' else ''),
             'sourceRows': filtered + dup + len(acc), 'filteredOut': filtered, 'duplicatesDropped': dup, 'accidents': len(acc),
             'attached': len(attached), 'unattached': len(acc) - len(attached),
             'noArea': [spots[i]['id'] for i in no_area], 'duplicateSpots': sum(1 for i, s in enumerate(spots) if owner[(s['lat'], s['lon'])] != i),
             'riskSpotsHash': data['_about']['hash']}
    result = {'_about': about, 'spots': out}
    about['hash'] = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(about, ensure_ascii=False)); print(f'{dest}: {dest.stat().st_size} bytes')

def report(spots, acc, hits, no_area, owner):
    """세 방식의 관광지당 건수·사고당 관광지 수·미부착 비율·예시를 찍는다. 호출: main."""
    examples = ['신평소공원', '상주은모래비치', '해운대해수욕장', '송도해상케이블카']
    for m in ('split', 'overlap', 'circle'):
        h = hits[m]; per = [len(v) for v in h.values()]
        uniq = {i: v for i, v in h.items() if owner[(spots[i]['lat'], spots[i]['lon'])] == i}
        cnt = np.zeros(len(acc), int)
        for v in h.values(): cnt[v] += 1
        cntu = np.zeros(len(acc), int)
        for v in uniq.values(): cntu[v] += 1
        att = cnt[cnt > 0]
        print(f'== {m}: 영역 있는 관광지 {len(h)}곳 · 건수 {dist(per)}')
        print(f'   사고 {len(acc)}건 중 미부착 {int((cnt == 0).sum())}건({(cnt == 0).mean() * 100:.1f}%)'
              f' · 붙은 사고의 관광지 수 중앙값 {np.median(att):g} 평균 {att.mean():.2f} 90% {np.percentile(att, 90, method="inverted_cdf"):g} 최대 {att.max()}'
              f' · 분포 {dict(sorted((int(k), int(v)) for k, v in zip(*np.unique(cnt, return_counts=True))))}'
              f' · 같은좌표 관광지 빼면 분포 {dict(sorted((int(k), int(v)) for k, v in zip(*np.unique(cntu, return_counts=True))))}')
        for e in examples:
            for i, s in enumerate(spots):
                if e in s['name']:
                    v = h.get(i)
                    print(f'   {s["name"]}: {"영역 없음" if v is None else str(len(v)) + "건 사망" + str(sum(acc[k][8] for k in v)) + " 실종" + str(sum(acc[k][9] for k in v))}')
    print('영역 없음(null):', [spots[i]['name'] for i in no_area])

if __name__ == '__main__': main()
