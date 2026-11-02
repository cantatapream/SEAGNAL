"""apihub GET 1회(키는 출력하지 않음). 사용: python3 -I apihub_get.py '<path?query without authKey>' OUT"""
import sys, os, json, urllib.request, ssl
key = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'api_config.json'))).get('KMA_HUB_KEY')
path, out = sys.argv[1], sys.argv[2]
url = 'https://apihub.kma.go.kr/' + path + ('&' if '?' in path else '?') + 'authKey=' + key
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
try:
    with urllib.request.urlopen(url, timeout=120, context=ctx) as r:
        b = r.read()
    open(out, 'wb').write(b); print('ok', len(b))
except Exception as e:
    print('error', type(e).__name__, str(e).replace(key, '***')[:200]); sys.exit(1)
