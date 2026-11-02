"""apihub marine_large_zone.php 를 과거 발표시각으로 1회 호출해 원문을 저장한다(키는 출력하지 않음).
사용: python3 -I apihub_zone_check.py TMA_FC TMA_EF OUTFILE
"""
import sys, os, json, urllib.request, ssl
cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'api_config.json')))
key = cfg.get('KMA_HUB_KEY')
tfc, tef, out = sys.argv[1], sys.argv[2], sys.argv[3]
url = ('https://apihub.kma.go.kr/api/typ06/url/marine_large_zone.php?tma_fc=%s&tma_ef=%s&Lzone=0&disp=0&help=1&authKey=%s'
       % (tfc, tef, key))
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
try:
    with urllib.request.urlopen(url, timeout=60, context=ctx) as r:
        b = r.read()
    open(out, 'wb').write(b)
    print('ok bytes', len(b))
except Exception as e:
    print('error', type(e).__name__, str(e).replace(key or 'xx', '***')[:300])
