#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""별표·서식·첨부 원본에 **그림이 어디에 얼마나 있는지** 기계로 잰다 — 그림 속 내용은 읽지 않는다.

[왜 있나 — 2026-10-03 사장님 결정]
  *"텍스트로 뽑을 수 있는 부분은 위키로 만들어 답변에 쓰고, 그림으로 된 것은 OCR 하지 말고
   그 그림을 그대로 보여 주자"* (사장님 채택, 2026-10-03). 기존 AI 판독문은 **검색용으로만** 남긴다.
  그러려면 먼저 **「이 별표에는 글로 옮기지 않은 그림이 있다」는 사실과 그 자리(몇 쪽)** 를 알아야 한다.
  그 표시가 없으면 API 가 그림을 **아무 표시 없이 빼고** 글자만 주는 별표에서 챗봇이 글 부분만 보고
  답한다 — 2026-10-03 실측으로 그림이 든 별표 283개 중 242개가 그런 상태였다.

[무엇을 재나 — 원본 파일 구조만 본다(비전·OCR 없음)]
  · PDF  : 쪽마다 글자 수, 그림 배치(쪽 넓이에서 차지하는 비율), 통째 스캔 여부
  · HWP  : 본문 글자 수, 그림 컨트롤(태그 85)·OLE(84)·수식(88)·도형(78~83), BinData 개수
  · HWPX : `<hp:t>` 글자 수, `<hp:pic>`·`<hp:equation>`·도형, BinData 개수
  · 그림 파일(jpg·png·gif) 자체가 첨부인 것
  판정(class):
    A  글자로 다 뽑힘           B1 글자+그림 섞임        B2 글자+스캔 쪽 섞임
    C  글자 없음 — 그림·스캔뿐 (또는 첨부가 그림 파일)    E 글자 없음 — 빈 서식·삭제된 별표
    D  배포용·암호 HWP(본문을 못 엶)                    X  못 받음·못 엶
  ⚠쪽 넓이 1% 미만 그림(점·작은 기호)은 「내용 그림」으로 안 센다.
  ⚠PDF 안에서 **선으로 그린 그림**(벡터)은 표 테두리와 구분이 안 돼 세지 못한다 → 그림 수는 **최소치**다.

[무엇을 보나 — 원본 주소의 출처]
  ① raw 아래 모든 `.txt` 에 적힌 `flSeq=` (별표 머리말의 PDF·HWP 링크, `<img src=…>`, 첨부파일 줄)
  ② `별표/_links.json` 두 꼴 — 법률계열 사전 꼴(`{"시행령 별표 1": {HWP, PDF, 이미지}}`)과 조례 목록 꼴
  ③ `--api` 를 주면 `_meta.json` families 의 MST 로 **현행판 별표 목록**을 API 에서 받아 보탠다
     (`law_api_guard.fetch_law_body` — 옛 판·시행예정 판을 피한다). 법률 폴더 일부는 ②가 없어서다.
  같은 별표에 PDF·HWP 가 둘 다 있으면 **PDF 를 잰다**(같은 원본을 법령정보센터가 찍어 낸 것이라).

[결과] `_dashboard/picture_census.json`
  { "생성": 날짜, "규칙": {...}, "요약": {...}, "첨부": [ {flSeq, 출처, 형식, 판정, 쪽수, 그림쪽, 그림수, 스캔쪽, 수식, 글자수} ] }
  `그림쪽` 은 1부터 센 쪽 번호다 — 화면이 **그림이 든 쪽을 먼저** 보여 줄 때 쓴다.

[쓰는 법]  ★게이트·CI 는 이 도구를 부르지 않는다 — PyMuPDF·olefile 이 필요하고 law.go.kr 에 나가야 한다.
  python3 -m pip install pymupdf olefile         (한 번만 · 저장소 밖에 깐다)
  python3 picture_census.py                       ①②만 · 이미 잰 것은 캐시에서 이어 간다
  python3 picture_census.py --api                 ③까지(법률계열 현행판 별표 전수)
  python3 picture_census.py --cache <jsonl>       측정 캐시 위치(기본 `~/.cache/picture_census.jsonl`)
  ⚠law.go.kr 은 간헐적으로 끊긴다(L-322·L-374) — 못 받은 것은 **6회·60초** 다시 부른 뒤에도
    실패해야 「못 받음(X)」으로 적는다. 서버가 「잘못된 접근」을 주는 것은 주소가 낡은 것으로 보이나 확정은 아니다.

[연계] → `_dashboard/picture_census.json` · ← `recollect_byl.py`·`law_api_guard.py`(현행판 별표 목록)
       · 쓰는 곳(다음 단계): `services/article_text.js`(그림 든 쪽 먼저) · `services/legal_retriever.js`(그림 있음 안내)
"""
import concurrent.futures as cf
import glob
import io
import json
import os
import re
import struct
import subprocess
import sys
import threading
import time
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(LEGAL, '_dashboard', 'picture_census.json')
CA = '/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None
OC = 'hyoo1431'
MIN_IMG = 0.01        # 쪽 넓이의 1% 이상인 그림만 「내용 그림」
SCAN_COV = 0.6        # 그림이 쪽의 60% 이상을 덮고
SCAN_CHARS = 50       # 글자가 50자 미만이면 통째 스캔 쪽

SEQ_RE = re.compile(r'flSeq=(\d+)')


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# ---------------------------------------------------------------- 받기
def curl(url, tries, maxt):
    cmd = ['curl', '-sS', '-L', '--max-time', str(maxt), url]
    if CA:
        cmd[1:1] = ['--cacert', CA]
    for a in range(tries):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=maxt + 30)
            if r.returncode == 0 and r.stdout:
                return r.stdout
        except Exception:
            pass
        time.sleep(1 + a)
    return b''


def ftype(b):
    if not b:
        return 'empty'
    if b[:4] == b'%PDF':
        return 'pdf'
    if b[:8] == bytes.fromhex('D0CF11E0A1B11AE1'):
        return 'ole'
    if b[:2] == b'PK':
        return 'zip'
    if b[:3] == b'\xff\xd8\xff' or b[:8] == b'\x89PNG\r\n\x1a\n' or b[:6] in (b'GIF87a', b'GIF89a'):
        return 'img'
    return 'unknown'      # 서버가 HTML(「잘못된 접근」 등)을 준 것


# ---------------------------------------------------------------- 재기
def m_pdf(b):
    import pymupdf
    doc = pymupdf.open(stream=b, filetype='pdf')
    pages = []
    for p in doc:
        area = abs(p.rect) or 1
        chars = len(re.sub(r'\s', '', p.get_text()))
        imgs = []
        cov = 0.0
        for info in p.get_image_info():
            fr = abs(pymupdf.Rect(info['bbox']) & p.rect) / area
            imgs.append(fr)
            cov += fr
        pages.append((chars, imgs, min(cov, 1.0)))
    pics = sum(1 for _, im, _ in pages for f in im if f >= MIN_IMG)
    return {'형식': 'pdf', '쪽수': len(pages), '글자수': sum(c for c, _, _ in pages),
            '그림수': pics,
            '그림쪽': [i + 1 for i, (_, im, _) in enumerate(pages) if any(f >= MIN_IMG for f in im)],
            '스캔쪽': [i + 1 for i, (c, _, cv) in enumerate(pages) if cv >= SCAN_COV and c < SCAN_CHARS]}


_CHAR1 = {0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31}


def _hwp_chars(data):
    n = i = 0
    while i + 1 < len(data):
        c = data[i] | (data[i + 1] << 8)
        if c < 32:
            i += 2 if c in _CHAR1 else 16      # 인라인·확장 컨트롤은 8글자 폭
            continue
        if not chr(c).isspace():
            n += 1
        i += 2
    return n


def m_hwp(b):
    import olefile
    o = olefile.OleFileIO(io.BytesIO(b))
    names = ['/'.join(x) for x in o.listdir()]
    if 'FileHeader' not in names:
        return {'형식': 'ole', '오류': 'HWP 아님'}
    prop = struct.unpack('<I', o.openstream('FileHeader').read()[36:40])[0]
    comp, locked = bool(prop & 1), bool(prop & 6)          # 2=암호 · 4=배포용
    chars = pics = eqs = draws = 0
    if not locked:
        for s in sorted(n for n in names if n.startswith('BodyText/Section')):
            raw = o.openstream(s).read()
            if comp:
                try:
                    raw = zlib.decompress(raw, -15)
                except Exception:
                    continue
            i = 0
            while i + 4 <= len(raw):
                h = struct.unpack('<I', raw[i:i + 4])[0]
                tag, size = h & 0x3ff, (h >> 20) & 0xfff
                i += 4
                if size == 0xfff:
                    size = struct.unpack('<I', raw[i:i + 4])[0]
                    i += 4
                if tag == 67:
                    chars += _hwp_chars(raw[i:i + size])
                elif tag in (84, 85):
                    pics += 1
                elif tag == 88:
                    eqs += 1
                elif 78 <= tag <= 83:
                    draws += 1
                i += size
    bins = sum(1 for n in names if n.startswith('BinData/'))
    if locked and 'PrvText' in names:
        chars = len(re.sub(r'\s', '', o.openstream('PrvText').read().decode('utf-16le', 'ignore')))
    # 표 칸 바탕 그림처럼 그림 컨트롤 없이 BinData 로만 들어간 그림이 있다(실측) — 둘 중 큰 쪽
    return {'형식': 'hwp', '글자수': chars, '그림수': max(pics, bins), '수식': eqs, '도형': draws,
            '잠김': locked}


def m_hwpx(b):
    z = zipfile.ZipFile(io.BytesIO(b))
    names = z.namelist()
    if not any(n.startswith('Contents/section') for n in names):
        return {'형식': 'zip', '오류': 'HWPX 아님'}
    chars = pics = eqs = draws = 0
    for n in names:
        if n.startswith('Contents/section') and n.endswith('.xml'):
            x = z.read(n).decode('utf-8', 'ignore')
            for t in re.findall(r'<hp:t(?:\s[^>]*)?>(.*?)</hp:t>', x, re.S):
                chars += len(re.sub(r'\s|<[^>]+>', '', t))
            pics += len(re.findall(r'<hp:pic[\s>]', x))
            eqs += len(re.findall(r'<hp:equation[\s>]', x))
            draws += len(re.findall(r'<hp:(?:line|rect|ellipse|arc|polygon|curve|connectLine)[\s>]', x))
    bins = sum(1 for n in names if n.startswith('BinData/'))
    return {'형식': 'hwpx', '글자수': chars, '그림수': max(pics, bins), '수식': eqs, '도형': draws}


def judge(r):
    if r.get('오류') or r.get('형식') in (None, 'empty', 'unknown', 'ole', 'zip'):
        return 'X'
    if r['형식'] == 'img':
        return 'C'
    if r.get('잠김'):
        return 'D'
    pics, scan, chars = r.get('그림수', 0), r.get('스캔쪽') or [], r.get('글자수', 0)
    if chars < 30:
        return 'C' if (pics or scan) else 'E'
    if scan:
        return 'B2'
    if pics:
        return 'B1'
    return 'A'


def measure(url, tries, maxt):
    b = curl(url, tries, maxt)
    t = ftype(b)
    try:
        if t == 'pdf':
            r = m_pdf(b)
        elif t == 'ole':
            r = m_hwp(b)
        elif t == 'zip':
            r = m_hwpx(b)
        elif t == 'img':
            r = {'형식': 'img', '그림수': 1}
        else:
            r = {'형식': t}
    except Exception as e:
        r = {'형식': t, '오류': repr(e)[:120]}
    r['판정'] = judge(r)
    return r


# ---------------------------------------------------------------- 대상 모으기
def abs_url(u, fl, tier):
    u = (u or '').replace('&amp;', '&')
    if u.startswith('/'):
        u = 'https://www.law.go.kr' + u
    u = u.replace('http://', 'https://')
    if u:
        return u
    if tier == '조례':
        return 'https://www.law.go.kr/flDownload.do?gubun=ELIS&flSeq=%s' % fl
    return 'https://www.law.go.kr/LSW/flDownload.do?flSeq=%s' % fl


def tier_of(p):
    return '조례' if p.startswith('_자치법규') else ('행정규칙' if '행정규칙' in p else '법령')


def collect(use_api):
    """(owner → {pdf, hwp, other}) 를 모아 owner 마다 잴 주소 하나를 고른다."""
    owners = {}

    def add(owner, kind, fl, url, tier):
        o = owners.setdefault(owner, {'tier': tier})
        o.setdefault(kind, (fl, url))

    url_re = re.compile(r'((?:https?://[^\s"\'<>)]*)?/[^\s"\'<>)]*flDownload\.do\?[^\s"\'<>)]*)')
    for p in glob.glob(os.path.join(RAW, '**', '*.txt'), recursive=True):
        rel = os.path.relpath(p, RAW)
        if '/_이미지/' in rel:
            continue
        try:
            t = open(p, encoding='utf-8').read()
        except Exception:
            continue
        if 'flSeq=' not in t:
            continue
        for line in t.split('\n'):
            if 'flSeq=' not in line:
                continue
            head = line.split(':')[0][:40]
            low = line.lower()
            kind = ('img' if ('<img' in low and 'src' in low) else
                    'pdf' if 'PDF' in head.upper() else
                    'hwp' if ('서식파일' in head or 'HWP' in head.upper()) else 'other')
            for m in SEQ_RE.finditer(line):
                um = url_re.search(line)
                owner = rel if kind != 'img' else '%s#img%s' % (rel, m.group(1))
                if kind == 'other':
                    owner = '%s#%s' % (rel, m.group(1))
                add(owner, kind, m.group(1), um.group(1) if um and m.group(1) in um.group(1) else '', tier_of(rel))
    for lp in glob.glob(os.path.join(RAW, '**', '별표', '_links.json'), recursive=True):
        rel = os.path.relpath(lp, RAW)
        try:
            d = json.load(open(lp, encoding='utf-8'))
        except Exception:
            continue
        if isinstance(d, dict) and isinstance(d.get('별표'), list):       # 조례 목록 꼴
            for e in d['별표']:
                m = SEQ_RE.search(e.get('주소', ''))
                if m:
                    add('%s#%s' % (rel, e.get('일련번호') or m.group(1)), 'hwp', m.group(1), e.get('주소'), tier_of(rel))
        elif isinstance(d, dict):                                        # 법률계열 사전 꼴
            for k, v in d.items():
                if not isinstance(v, dict):
                    continue
                for fld, kind in (('PDF', 'pdf'), ('HWP', 'hwp')):
                    m = SEQ_RE.search(v.get(fld) or '')
                    if m:
                        add('%s#%s' % (rel, k), kind, m.group(1), v.get(fld), tier_of(rel))
    if use_api:
        sys.path.insert(0, HERE)
        import law_api_guard as G
        import recollect_byl as RB
        jobs = []
        for mp in sorted(glob.glob(os.path.join(RAW, '*', '*', '_meta.json'))):
            base = os.path.dirname(mp)
            fams = (json.load(open(mp, encoding='utf-8')).get('families') or {})
            for kind_ in ('법률', '시행령', '시행규칙'):
                v = fams.get(kind_) or {}
                if isinstance(v, dict) and v.get('MST'):        # 계열 칸이 목록인 법이 있다(실측)
                    jobs.append((base, kind_, str(v['MST']), v.get('법령ID') or None))

        def fetch(job):
            base, kind_, mst, lid = job
            body = G.fetch_law_body(RB.api, OC, mst, lid, warn=False)
            got = {}
            if body:
                RB.extract_layer(body, kind_, os.path.join(base, '별표'), got, only=set(),
                                 overwrite=False, links_all=True)
            return base, got, bool(body)

        print('API 로 현행판 별표 목록을 받는다 — %d계열' % len(jobs), flush=True)
        miss = 0
        with cf.ThreadPoolExecutor(8) as ex:              # 한 건씩이면 1~2시간 — 8건씩 받는다
            for base, got, ok in ex.map(fetch, jobs):
                miss += not ok
                rel = os.path.relpath(os.path.join(base, '별표', '_links.json'), RAW)
                for k, e in got.items():
                    for fld, kind in (('PDF', 'pdf'), ('HWP', 'hwp')):
                        m = SEQ_RE.search(e.get(fld) or '')
                        if m:
                            add('%s#%s' % (rel, k), kind, m.group(1), e.get(fld), '법령')
        print('  본문을 못 받은 계열 %d개(그 계열 별표는 ①②로만 잡힌다)' % miss, flush=True)
    picks = {}
    for owner, o in owners.items():
        for kind in ('pdf', 'hwp', 'img', 'other'):
            if kind in o:
                fl, url = o[kind]
                picks.setdefault(fl, {'flSeq': fl, '출처': [], 'url': abs_url(url, fl, o['tier']), 'tier': o['tier']})
                picks[fl]['출처'].append(owner)
                break
    return list(picks.values())


# ---------------------------------------------------------------- 실행
def main():
    cache_p = os.path.expanduser(arg('--cache', '~/.cache/picture_census.jsonl'))
    os.makedirs(os.path.dirname(cache_p), exist_ok=True)
    cache = {}
    if os.path.exists(cache_p):
        for line in open(cache_p, encoding='utf-8'):
            try:
                r = json.loads(line)
                cache[r['flSeq']] = r
            except Exception:
                pass
    items = collect('--api' in sys.argv)
    print('잴 원본 %d건 · 캐시 %d건' % (len(items), len(cache)), flush=True)
    lock = threading.Lock()

    def run(it, tries, maxt):
        r = measure(it['url'], tries, maxt)
        r['flSeq'] = it['flSeq']
        with lock:
            cache[it['flSeq']] = r
            with open(cache_p, 'a', encoding='utf-8') as f:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')

    for tries, maxt, workers, label in ((2, 45, 10, '첫 바퀴'), (6, 60, 4, '다시 받기(6회·60초)')):
        todo = [it for it in items if cache.get(it['flSeq'], {}).get('판정', 'X') == 'X']
        if label == '첫 바퀴':
            todo = [it for it in items if it['flSeq'] not in cache]
        print('%s %d건' % (label, len(todo)), flush=True)
        with cf.ThreadPoolExecutor(workers) as ex:
            list(ex.map(lambda it: run(it, tries, maxt), todo))
    rows = []
    for it in items:
        r = dict(cache.get(it['flSeq'], {'판정': 'X'}))
        r['출처'] = sorted(it['출처'])[:4]
        r['tier'] = it['tier']
        rows.append({k: v for k, v in r.items() if v not in (None, [], 0, False) or k in ('판정',)})
    summ = {}
    for r in rows:
        summ[r['판정']] = summ.get(r['판정'], 0) + 1
    out = {'생성': time.strftime('%Y-%m-%d'),
           '규칙': {'내용그림_최소쪽비율': MIN_IMG, '스캔쪽': '그림이 쪽의 %d%% 이상 · 글자 %d자 미만'
                  % (SCAN_COV * 100, SCAN_CHARS), '벡터그림': '세지 못함 — 그림 수는 최소치'},
           '판정뜻': {'A': '글자로 다 뽑힘', 'B1': '글자+그림 섞임', 'B2': '글자+스캔 쪽 섞임',
                   'C': '글자 없음 — 그림·스캔뿐', 'D': '배포용·암호 HWP', 'E': '글자 없음 — 빈 서식·삭제된 별표',
                   'X': '못 받음·못 엶'},
           '요약': dict(sorted(summ.items())), '첨부': sorted(rows, key=lambda r: r['flSeq'])}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('→ %s  %s' % (os.path.relpath(OUT, LEGAL), out['요약']), flush=True)


if __name__ == '__main__':
    main()
