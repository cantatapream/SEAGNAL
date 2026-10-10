"""기상자료개방포털 페이지 GET/POST (로그인 세션 사용, 비밀번호 출력 안 함). 사용: python3 -I portal_get.py METHOD URLPATH OUT [k=v ...]"""
import sys, os
sys.path.insert(0, '/tmp/claude-0/-home-user-SEAGNAL/714fe44b-de62-577b-abdb-eb7ec1e2182e/scratchpad/kma/tools')
import kmasess as k
method, path, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = dict(a.split('=', 1) for a in sys.argv[4:])
s = k.new_session(); k.ensure_login(s)
r = k.req(s, method, k.BASE + path, data=data if method == 'POST' else None, params=data if method == 'GET' else None)
open(out, 'wb').write(r.content)
print(r.status_code, r.headers.get('Content-Type'), len(r.content))
