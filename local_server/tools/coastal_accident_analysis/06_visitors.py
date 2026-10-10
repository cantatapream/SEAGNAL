"""DataLab 원문(월별 JSON) → 시군구 일별 방문자 표(해안 시군구만).
출력: data/visitors_daily_coastal.csv.gz (sgg,date,local,outsider,foreign) — 사고·관광지가 있는 시군구 + 해안선이 지나는 시군구
사용: python3 -I 06_visitors.py <raw_dir> <data_dir>
"""
import sys, json, glob, gzip, collections, csv
raw, D = sys.argv[1:3]
need = set()
for r in csv.DictReader(open(D + '/geo_person.csv')):
    if r['sgg']: need.add(r['sgg'])
for r in csv.DictReader(open(D + '/spots_features.csv')): need.add(r['sgg'])
print('sgg needed', len(need))
rows = collections.defaultdict(lambda: [None, None, None]); names = {}; days = set(); allcodes = set()
for fn in sorted(glob.glob(raw + '/visitors_*.json')):
    it = json.load(open(fn))['response']['body']['items']['item']
    for x in it:
        allcodes.add(x['signguCode']); names[x['signguCode']] = x['signguNm']; days.add(x['baseYmd'])
        if x['signguCode'] in need:
            rows[(x['signguCode'], x['baseYmd'])][int(x['touDivCd']) - 1] = float(x['touNum'])
print('files', len(glob.glob(raw + '/visitors_*.json')), 'days', len(days), min(days), max(days), 'codes', len(allcodes))
miss = sorted(need - allcodes); print('needed sgg not in DataLab:', miss)
with gzip.open(D + '/visitors_daily_coastal.csv.gz', 'wt') as f:
    f.write('sgg,date,local,outsider,foreign\n')
    for (s, d), v in sorted(rows.items()):
        f.write('%s,%s,%s\n' % (s, d, ','.join('' if x is None else '%.1f' % x for x in v)))
incomplete = sum(1 for v in rows.values() if None in v)
print('rows', len(rows), 'incomplete rows', incomplete)
json.dump(names, open(D + '/datalab_sgg_names.json', 'w'), ensure_ascii=False)
