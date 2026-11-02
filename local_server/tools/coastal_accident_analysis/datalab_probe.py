"""DataLab locgoRegnVisitrDDList 1회 호출(키는 출력하지 않음). 사용: python3 -I datalab_probe.py START END NROWS PAGE OUT"""
import sys, urllib.request, ssl
KEY = open('/tmp/claude-0/-home-user-SEAGNAL/714fe44b-de62-577b-abdb-eb7ec1e2182e/scratchpad/key.txt').read().strip()
s, e, n, p, out = sys.argv[1:6]
url = ('https://apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList?serviceKey=%s&numOfRows=%s&pageNo=%s'
       '&MobileOS=ETC&MobileApp=SEAGNAL&_type=json&startYmd=%s&endYmd=%s' % (KEY, n, p, s, e))
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
try:
    with urllib.request.urlopen(url, timeout=120, context=ctx) as r:
        b = r.read()
    open(out, 'wb').write(b); print('ok', len(b))
except Exception as ex:
    print('error', type(ex).__name__, str(ex).replace(KEY, '***')[:200]); sys.exit(1)
