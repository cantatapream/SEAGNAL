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
    (2026-10-04 표본: 곡선이 많은 PDF 쪽을 눈으로 보니 글꼴을 선으로 바꾼 글자·서식 칸이었고 그림은 아니었다.)
  ⚠HWP 의 **도형**(선·사각형·곡선 — `도형` 칸)은 그림으로 치지 않는다. 대부분 칸 테두리·글상자다.
  ⚠옛 한글 3.0(`hwp3`)은 문단을 풀지 않고 **대략** 센다(`대략: true`). 엑셀(xls) 속 그림은 못 센다.
  ★형식: pdf · hwp · hwpx · hwp3 · hml(한글 XML) · zip묶음(속 파일을 더함) · xls/xlsx · txt · img(JPEG·PNG·GIF·BMP)

[무엇을 보나 — 원본 주소의 출처]
  ① raw 아래 모든 `.txt` 에 적힌 `flSeq=` (별표 머리말의 PDF·HWP 링크, `<img src=…>`, 첨부파일 줄)
  ② `별표/_links.json` 두 꼴 — 법률계열 사전 꼴(`{"시행령 별표 1": {HWP, PDF, 이미지}}`)과 조례 목록 꼴
  ③ `--api` 를 주면 `_meta.json` families 의 MST 로 **현행판 별표 목록**을 API 에서 받아 보탠다
     (`law_api_guard.fetch_law_body` — 옛 판·시행예정 판을 피한다). 법률 폴더 일부는 ②가 없어서다.
  ④ `--rules` 를 주면 **행정규칙 952개(`target=admrul`)·조례(`target=ordin`)** 의 현행 별표 목록과
     첨부파일 목록도 API 에서 받아 보탠다. ★2026-10-04 — ①~③만으로는 「전수」가 아니었다:
     행정규칙 파일 282개가 본문에 별표·별지를 적고 있는데 raw 에 내려받기 주소가 없었고(③은
     법률·시행령·시행규칙만 부른다), 조례 54곳도 같았다. API 응답은 `--api-cache` 에 남겨 다시 부르지 않는다.
  같은 별표에 PDF·HWP 가 둘 다 있으면 **PDF 를 잰다**(같은 원본을 법령정보센터가 찍어 낸 것이라).

[결과] `_dashboard/picture_census.json`
  { "생성": 날짜, "규칙": {...}, "요약": {...}, "첨부": [ {flSeq, 출처, 형식, 판정, 쪽수, 그림쪽, 그림수, 스캔쪽, 수식, 글자수} ] }
  `그림쪽` 은 1부터 센 쪽 번호다 — 화면이 **그림이 든 쪽을 먼저** 보여 줄 때 쓴다.

[쓰는 법]  ★게이트·CI 는 이 도구를 부르지 않는다 — PyMuPDF·olefile 이 필요하고 law.go.kr 에 나가야 한다.
  python3 -m pip install pymupdf olefile         (한 번만 · 저장소 밖에 깐다)
  python3 picture_census.py                       ①②만 · 이미 잰 것은 캐시에서 이어 간다
  python3 picture_census.py --api                 ③까지(법률계열 현행판 별표 전수)
  python3 picture_census.py --api --rules         ④까지(행정규칙·조례 별표·첨부 전수) — 이것이 「전수」다
  python3 picture_census.py --cache <jsonl>       측정 캐시 위치(기본 `~/.cache/picture_census.jsonl`)
  ⚠law.go.kr 은 간헐적으로 끊긴다(L-322·L-374) — 못 받은 것은 **6회·60초** 다시 부른 뒤에도
    실패해야 「못 받음(X)」으로 적는다. 서버가 파일 대신 HTML 을 주면 그것도 실패로 보고 다시 부른다.
    ★2026-10-04 — 처음에 「못 받음」으로 센 100건 중 75건은 **받았는데 형식을 몰랐던 것**이었다
    (한글 3.0 25 · BMP 그림 21 · 글자 파일 20 · 한글 XML 3 · …). 「못 받음」을 적기 전에 받은 첫 바이트를 본다.

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
    last = b''
    cmd = ['curl', '-sS', '-L', '--max-time', str(maxt), url]
    if CA:
        cmd[1:1] = ['--cacert', CA]
    for a in range(tries):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=maxt + 30)
            # ★2026-10-04 — 서버가 파일 대신 HTML(「잘못된 접근」)을 주면 **그것도 실패로 보고 다시 부른다.**
            #   전에는 비어 있지만 않으면 받은 것으로 쳐서, 「6회·60초」가 실제로는 한 번만 불렀다.
            if r.returncode == 0 and r.stdout and ftype(r.stdout) != 'unknown':
                return r.stdout
            last = r.stdout
        except Exception:
            pass
        time.sleep(1 + a)
    return last or b''


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
    # ★2026-10-04 — 아래 넷은 전에 전부 「못 받음(X)」으로 잘못 셌다(100건 중 75건). 받은 것을 눈으로 보니:
    if b[:17] == b'HWP Document File':
        return 'hwp3'                                   # 옛 한글 3.0 — 조례·고시 첨부에 남아 있다
    if b[:2] == b'BM' and len(b) > 26 and b[6:10] == b'\0\0\0\0':
        return 'img'                                    # BMP 그림
    head = b[:400].lstrip(b'\xef\xbb\xbf \r\n\t')
    if head.startswith(b'<?xml') and b'<HWPML' in b[:2000]:
        return 'hml'                                    # 한글 XML(HWPML)
    if head[:1] == b'<':
        return 'unknown'                                # 서버가 HTML(「잘못된 접근」·「파일이 없습니다」)을 준 것
    if b'\0' not in b[:4000]:
        return 'txt'                                    # 글자 파일(cp949) — 조례 별지가 이 꼴로 온다
    return 'unknown'


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
        if 'Workbook' in names or 'Book' in names:
            return m_xls(b)
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
        return m_zip(z, names)
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


def m_xls(b):
    """조례 별표 일부는 엑셀(xls)이다. 칸의 글자만 센다 — ⚠엑셀 안 그림은 세지 못한다(`그림수` 없음)."""
    try:
        import xlrd
    except ImportError:
        return {'형식': 'xls', '오류': 'xlrd 없음 — python3 -m pip install xlrd'}
    wb = xlrd.open_workbook(file_contents=b)
    chars = 0
    for sh in wb.sheets():
        for r in range(sh.nrows):
            for v in sh.row_values(r):
                chars += len(re.sub(r'\s', '', str(v)))
    return {'형식': 'xls', '글자수': chars, '그림수': 0, '그림못셈': True}


def m_zip(z, names, depth=0):
    """HWPX 가 아닌 zip — ① 엑셀(xlsx) ② **여러 원본을 묶은 꾸러미**(고시 첨부에 있다: hwp·hwpx·pdf 묶음).
    꾸러미는 속 파일을 하나씩 재서 더한다. 쪽 번호(`그림쪽`)는 속 파일마다 달라 합치지 않고 `속파일` 에 남긴다."""
    if any(n.startswith('xl/') for n in names):
        chars = 0
        for n in names:
            if n == 'xl/sharedStrings.xml' or n.startswith('xl/worksheets/sheet'):
                x = z.read(n).decode('utf-8', 'ignore')
                chars += sum(len(re.sub(r'\s', '', t)) for t in re.findall(r'<t[^>]*>(.*?)</t>', x, re.S))
        return {'형식': 'xlsx', '글자수': chars, '그림수': sum(1 for n in names if n.startswith('xl/media/'))}
    inner = []
    for n in names:
        low = n.lower()
        if low.endswith('/') or not low.rsplit('.', 1)[-1] in ('pdf', 'hwp', 'hwpx', 'zip', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'gif'):
            continue
        b = z.read(n)
        t = ftype(b)
        try:
            if t == 'pdf':
                r = m_pdf(b)
            elif t == 'ole':
                r = m_hwp(b)
            elif t == 'zip' and depth < 1:
                zz = zipfile.ZipFile(io.BytesIO(b))
                nn = zz.namelist()
                r = m_hwpx(b) if any(x.startswith('Contents/section') for x in nn) else m_zip(zz, nn, depth + 1)
            elif t == 'img':
                r = {'형식': 'img', '그림수': 1}
            elif t == 'hwp3':
                r = m_hwp3(b)
            elif t == 'hml':
                r = m_hml(b)
            else:
                continue
        except Exception as e:
            r = {'형식': t, '오류': repr(e)[:80]}
        r['이름'] = n.encode('cp437', 'ignore').decode('cp949', 'ignore') if not n.isascii() else n
        r['판정'] = judge(r)
        inner.append(r)
    if not inner:
        return {'형식': 'zip', '오류': '속에 잴 파일이 없다'}
    out = {'형식': 'zip묶음', '속파일': inner,
           '글자수': sum(r.get('글자수', 0) for r in inner),
           '그림수': sum(r.get('그림수', 0) for r in inner),
           '스캔쪽': [i for i, r in enumerate(inner) if r.get('스캔쪽') or r['판정'] == 'C'],
           '쪽수': sum(r.get('쪽수') or 0 for r in inner)}
    if any(r['판정'] == 'D' for r in inner):
        out['잠김'] = all(r['판정'] == 'D' for r in inner)
    return out


def m_hwp3(b):
    """옛 한글 3.0 — 머리 30 + 문서정보 128 + 요약 1008 + 부가정보 뒤가 (압축이면 deflate) 본문이다.
    ⚠문단 구조까지는 풀지 않는다 — **조합형 한글 코드 수**로 글자를 대략 세고, 그림은 **본문 안 그림 데이터 서명**
    (JPEG·GIF·PNG·BMP)으로만 센다(최소치). LibreOffice 에 HWP 3.0 필터가 없어서다."""
    di = b[30:158]
    comp, infolen = di[124], struct.unpack('<H', di[126:128])[0]
    body = b[30 + 128 + 1008 + infolen:]
    dec = body
    if comp:
        dec = None
        for w in (-15, 15, 31):
            try:
                dec = zlib.decompress(body, w)
                break
            except Exception:
                pass
        if dec is None:
            return {'형식': 'hwp3', '오류': '본문 압축을 못 풂'}
    words = struct.unpack('<%dH' % (len(dec) // 2), dec[:len(dec) // 2 * 2])
    chars = sum(1 for w in words if 0x8841 <= w <= 0xd3bd)
    pics = len(re.findall(rb'\xff\xd8\xff|GIF8[79]a|\x89PNG|BM.{4}\0\0\0\0.{4}[\x28\x0c]\0\0\0', dec, re.S))
    return {'형식': 'hwp3', '글자수': chars, '그림수': pics, '대략': True}


def m_hml(b):
    x = b.decode('utf-8', 'ignore')
    chars = sum(len(re.sub(r'\s', '', t)) for t in re.findall(r'<CHAR[^>]*>(.*?)</CHAR>', x, re.S))
    return {'형식': 'hml', '글자수': chars, '그림수': len(re.findall(r'<PICTURE[\s>]', x)),
            '수식': len(re.findall(r'<EQUATION[\s>]', x))}


def m_txt(b):
    for enc in ('utf-8', 'cp949'):
        try:
            t = b.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        t = b.decode('cp949', 'ignore')
    return {'형식': 'txt', '글자수': len(re.sub(r'\s', '', t)), '그림수': 0}


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


def alt_urls(url):
    """같은 flSeq 를 부르는 다른 꼴 — 조례(ELIS) 주소는 `flNm` 을 떼거나 `LSW/` 꼴로 부르면 열리는 때가 있다(실측)."""
    m = SEQ_RE.search(url)
    if not m:
        return []
    fl = m.group(1)
    out = ['https://www.law.go.kr/flDownload.do?gubun=ELIS&flSeq=%s' % fl if 'ELIS' in url else None,
           'https://www.law.go.kr/LSW/flDownload.do?flSeq=%s' % fl]
    return [u for u in out if u and u != url]


def measure(url, tries, maxt):
    b = curl(url, tries, maxt)
    for u in ([] if ftype(b) not in ('unknown', 'empty') else alt_urls(url)):
        bb = curl(u, 2, maxt)
        if ftype(bb) not in ('unknown', 'empty'):
            b = bb
            break
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
        elif t == 'hwp3':
            r = m_hwp3(b)
        elif t == 'hml':
            r = m_hml(b)
        elif t == 'txt':
            r = m_txt(b)
        else:
            r = {'형식': t}
            if t == 'unknown' and '파일이 없습니다'.encode('utf-8') in b[:400]:
                r['오류'] = '서버: 파일이 없습니다'
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


def collect(use_api, use_rules=False):
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
    if use_rules:
        rules_stage(add)
    picks = {}
    for owner, o in owners.items():
        for kind in ('pdf', 'hwp', 'img', 'other'):
            if kind in o:
                fl, url = o[kind]
                picks.setdefault(fl, {'flSeq': fl, '출처': [], 'url': abs_url(url, fl, o['tier']), 'tier': o['tier']})
                picks[fl]['출처'].append(owner)
                break
    return list(picks.values())

def _as_list(v):
    return v if isinstance(v, list) else ([] if v in (None, '') else [v])


def _api_cached(key, url, store, lock, tries=8):
    """law.go.kr JSON 을 받되 한 번 받은 것은 `store`(jsonl)에 남겨 다시 부르지 않는다.
    실패는 남기지 않는다 — 다음 주행에서 다시 부른다(「못 받음」을 「없음」으로 굳히지 않는다)."""
    if key in store:
        return store[key]
    import urllib.request
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                d = json.load(r)
            break
        except Exception:
            time.sleep(min(1.5 + 0.6 * i, 8.0))
    else:
        return None
    b = d.get('AdmRulService') or (list(d.values())[0] if isinstance(d, dict) and len(d) == 1 else d)
    if isinstance(b, dict):
        keep = {'별표': b.get('별표'), '첨부': b.get('첨부파일')}
    else:                                             # 「일치하는 … 없습니다」 같은 글 한 줄 — 그대로 남긴다
        keep = {'별표': None, '첨부': None, '응답': str(b)[:200]}
    with lock:
        store[key] = keep
        with open(_API_CACHE, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'key': key, **keep}, ensure_ascii=False) + '\n')
    return keep


_API_CACHE = os.path.expanduser('~/.cache/picture_census_api.jsonl')
RULES_NOTE = {'판번호를 못 찾음': [], '본문 대신 글 한 줄': []}   # ④가 못 부른 것 — 결과 파일에 그대로 남긴다
_NO_RE = re.compile(r'(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)')


def rules_stage(add):
    """④ 행정규칙(`target=admrul`)·조례(`target=ordin`)의 현행 별표·첨부 목록을 owner 로 보탠다."""
    sys.path.insert(0, HERE)
    from _admrul_id import walk_admrul, find_id
    import ordin_recollect as OR
    store, lock = {}, threading.Lock()
    if os.path.exists(_API_CACHE):
        for line in open(_API_CACHE, encoding='utf-8'):
            try:
                r = json.loads(line)
                store[r.pop('key')] = r
            except Exception:
                pass
    base = 'https://www.law.go.kr'

    def full(u):
        u = str(u or '')
        return u if u.startswith('http') else (base + u if u else '')

    def kind_of(name, url):
        n = (str(name) + ' ' + url).lower()
        return 'pdf' if '.pdf' in n else ('hwp' if ('.hwp' in n or 'hwp' == str(name).lower()) else 'other')

    jobs = []
    for p in walk_admrul():
        rid, _ = find_id(p)
        jobs.append(('admrul', p, rid))
    cat_p = os.path.join(RAW, '_자치법규', '_ordin_catalog.json')
    mst_p = os.path.join(HERE, 'baseline', 'ordin_mst.json')
    cat = json.load(open(cat_p, encoding='utf-8')) if os.path.exists(cat_p) else {}
    mcache = json.load(open(mst_p, encoding='utf-8')) if os.path.exists(mst_p) else {}
    for p in sorted(glob.glob(os.path.join(RAW, '_자치법규', '*', '*', '*.txt'))):
        jobs.append(('ordin', p, None))               # MST 는 아래 fetch 안에서 찾는다(검색 API 를 부를 수 있어 느리다)

    def fetch(job):
        kind_, p, key = job
        if kind_ == 'ordin':
            head, _ = OR.split_head(open(p, encoding='utf-8').read())
            key, _ = OR.find_mst(head, OR.title_of(head), cat, mcache)
            job = (kind_, p, key)
        if not key:
            RULES_NOTE['판번호를 못 찾음'].append(os.path.relpath(p, RAW))
            return job, None
        url = ('%s/DRF/lawService.do?OC=%s&target=%s&type=JSON&%s=%s'
               % (base, OC, kind_, 'ID' if kind_ == 'admrul' else 'MST', key))
        return job, _api_cached('%s:%s' % (kind_, key), url, store, lock)

    print('④ 행정규칙·조례 별표·첨부 목록 — %d건' % len(jobs), flush=True)
    noid = fail = units = atts = 0
    answer = []
    with cf.ThreadPoolExecutor(8) as ex:
        for (kind_, p, key), d in ex.map(fetch, jobs):
            if not key:
                noid += 1
                continue
            if d is None:
                fail += 1
                continue
            if d.get('응답'):
                answer.append((os.path.relpath(p, RAW), d['응답']))
                continue
            rel = os.path.relpath(p, RAW)
            tier = '조례' if kind_ == 'ordin' else '행정규칙'
            seen_no = set()
            for x in _as_list((d.get('별표') or {}).get('별표단위')):
                if not isinstance(x, dict):
                    continue
                t = str(x.get('별표제목') or '')
                m = _NO_RE.search(t)
                k = (m.group(1) + m.group(2)) if m else '%s%s' % (x.get('별표구분') or '', x.get('별표번호') or '')
                seen_no.add(k)
                owner = '%s#%s#%s' % (rel, k, x.get('별표키') or '')
                for fld, kk in (('별표서식PDF파일링크', 'pdf'), ('별표서식파일링크', 'hwp'), ('별표첨부파일명', None)):
                    u = full(x.get(fld))
                    mm = SEQ_RE.search(u)
                    if mm:
                        add(owner, kk or kind_of(x.get('별표첨부파일구분') or '', u), mm.group(1), u, tier)
                        units += 1
            a = d.get('첨부') or {}
            names, links = _as_list(a.get('첨부파일명')), _as_list(a.get('첨부파일링크'))
            for i, u in enumerate(links):
                u = full(u)
                mm = SEQ_RE.search(u)
                if not mm:
                    continue
                name = str(names[i]) if i < len(names) else ''
                m = _NO_RE.search(name)
                if m and (m.group(1) + m.group(2)) in seen_no:
                    continue                          # 별표단위로 이미 센 별표의 사본이다
                add('%s#첨부#%s' % (rel, mm.group(1)), kind_of(name, u), mm.group(1), u, tier)
                atts += 1
    print('  별표 주소 %d · 첨부 %d · 판번호 못 찾음 %d · 응답 못 받음 %d · 본문 대신 글 한 줄 %d'
          % (units, atts, noid, fail, len(answer)), flush=True)
    RULES_NOTE['본문 대신 글 한 줄'] = ['%s — %s' % (rel, re.sub(r'\s+', ' ', msg)) for rel, msg in answer]
    for rel, msg in answer[:10]:
        print('    · %s — %s' % (rel, msg), flush=True)


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
    items = collect('--api' in sys.argv, '--rules' in sys.argv)
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
                  % (SCAN_COV * 100, SCAN_CHARS), '벡터그림': '세지 못함 — 그림 수는 최소치',
                  '엑셀': 'xls 는 칸 글자만 센다 — 엑셀 안 그림은 세지 못함', '묶음zip': '속 파일을 하나씩 재서 더한다(`속파일`)'},
           '④못부른것': RULES_NOTE,
           '판정뜻': {'A': '글자로 다 뽑힘', 'B1': '글자+그림 섞임', 'B2': '글자+스캔 쪽 섞임',
                   'C': '글자 없음 — 그림·스캔뿐', 'D': '배포용·암호 HWP', 'E': '글자 없음 — 빈 서식·삭제된 별표',
                   'X': '못 받음·못 엶'},
           '요약': dict(sorted(summ.items())), '첨부': sorted(rows, key=lambda r: r['flSeq'])}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('→ %s  %s' % (os.path.relpath(OUT, LEGAL), out['요약']), flush=True)


if __name__ == '__main__':
    main()
