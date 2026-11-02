"""DataLab 시군구 일별 방문자(locgoRegnVisitrDDList) 월 단위 다운로드 — 재시도·이어받기.
사용: python3 -I datalab_dl.py OUTDIR 202001 202412
 - 월마다 1회 호출(numOfRows=40000 → 한 달 전체가 한 페이지), 응답 totalCount 와 받은 행 수가 같을 때만 저장.
 - 저장: OUTDIR/visitors_YYYYMM.json (원문 그대로). 이미 있으면 건너뜀. 키는 출력하지 않는다.
"""
import sys, os, json, time, calendar, urllib.request, ssl
KEY = open('/tmp/claude-0/-home-user-SEAGNAL/714fe44b-de62-577b-abdb-eb7ec1e2182e/scratchpad/key.txt').read().strip()
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
out, sm, em = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
y, m = int(sm[:4]), int(sm[4:])
calls = 0
while (y, m) <= (int(em[:4]), int(em[4:])):
    fn = os.path.join(out, 'visitors_%04d%02d.json' % (y, m))
    if not os.path.exists(fn):
        nd = calendar.monthrange(y, m)[1]
        s, e = '%04d%02d01' % (y, m), '%04d%02d%02d' % (y, m, nd)
        url = ('https://apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList?serviceKey=%s&numOfRows=40000&pageNo=1'
               '&MobileOS=ETC&MobileApp=SEAGNAL&_type=json&startYmd=%s&endYmd=%s' % (KEY, s, e))
        for attempt in range(12):
            calls += 1
            try:
                with urllib.request.urlopen(url, timeout=180, context=ctx) as r:
                    b = r.read()
                d = json.loads(b)
                body = d['response']['body']
                items = body['items']['item'] if body.get('items') else []
                if d['response']['header']['resultCode'] != '0000':
                    print(y, m, 'resultCode', d['response']['header'], flush=True); time.sleep(5); continue
                if len(items) != int(body['totalCount']) or not items:
                    print(y, m, 'count mismatch', len(items), body.get('totalCount'), flush=True); time.sleep(3); continue
                open(fn + '.part', 'wb').write(b); os.replace(fn + '.part', fn)
                print(y, m, 'ok rows', len(items), 'attempt', attempt + 1, flush=True)
                break
            except Exception as ex:
                print(y, m, 'err', type(ex).__name__, str(ex).replace(KEY, '***')[:120], flush=True)
                time.sleep(3)
        else:
            print(y, m, 'FAILED after retries', flush=True)
    m += 1
    if m == 13: y, m = y + 1, 1
print('done, http calls', calls)
