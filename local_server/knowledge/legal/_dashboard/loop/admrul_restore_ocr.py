#!/usr/bin/env python3
"""재수집으로 사라진 이미지 판독 전사분을, 그림이 같은 것만 골라 되살린다.

왜 필요한가:
  2026-08-23 재수집에서 raw 원문을 API 현행본으로 갈아끼웠는데, 옛 파일에 있던
  【이미지판독 …】 블록(그림 속 표를 글로 옮겨 둔 것) 116개가 함께 지워졌다.
  글자 수는 오히려 늘어(별표가 새로 딸려와) 크기 안전장치에 안 걸렸고,
  test_article_images 게이트가 "조 본문에 뜨는 그림 319장 → 111장"으로 잡아냈다.

왜 그냥 붙여넣으면 안 되나:
  현행 원문의 그림은 <img id="…"> 의 번호가 전부 새로 부여돼 있어, 번호로는 옛 판독본과
  짝지을 수 없다. 그래서 **그림 파일 자체를 내려받아 바이트가 같은 것만** 짝짓는다.
  같은 그림이면 판독 내용도 같다는 것이 유일한 근거다 — 추측은 넣지 않는다.

무엇을 하나:
  1) 옛 판본(git)에서 【이미지판독 <옛ID>】 블록을 모으고, 그 옛 그림 파일(_이미지/<옛ID>.png)의 해시를 낸다.
  2) 현행 본문의 <img id="<새ID>"> 를 내려받아(_이미지/<새ID>.png) 해시를 낸다.
  3) 해시가 같은 짝에만 옛 판독 블록을 새 그림 뒤에 끼워 넣는다.
  4) 짝을 못 찾은 새 그림은 다시 판독해야 할 목록으로 보고한다.

[연계]
  - 읽음: git show <BASE>:raw/... · raw/**/행정규칙/*.txt · 같은 폴더 _이미지/
  - 호출: https://www.law.go.kr/LSW/flDownload.do?flSeq=<id> (dl_byl_images.sh 와 같은 경로)
  - 씀:   raw/**/행정규칙/*.txt · _dashboard/admrul_ocr_todo.json
사용법: python3 admrul_restore_ocr.py [--base <커밋>] [--dry]
"""
import hashlib, json, os, re, subprocess, sys, time
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
TODO = os.path.join(LEGAL, '_dashboard', 'admrul_ocr_todo.json')
BASE = '30edb5a98^'
DRY = '--dry' in sys.argv
if '--base' in sys.argv:
    BASE = sys.argv[sys.argv.index('--base') + 1]

OCR = re.compile(r'【이미지판독\s*(\d+)】')
IMG = re.compile(r'<img\s+id="(\d+)"\s*>(?:\s*</img>)?')
CA = '/root/.ccr/ca-bundle.crt'
PROXY = os.environ.get('HTTPS_PROXY', '')


def git_show(rel):
    r = subprocess.run(['git', '-C', REPO, 'show', '%s:%s' % (BASE, rel)],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ''


def ocr_blocks(text):
    out, ms = {}, list(OCR.finditer(text))
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        nxt = re.search(r'<img\s+id="\d+"', text[m.end():end])
        if nxt:
            end = m.end() + nxt.start()
        out[m.group(1)] = text[m.start():end].rstrip() + '\n'
    return out


def fetch_img(iid, outdir):
    """그림을 내려받아 원본 바이트를 돌려준다(변환 없이 해시만 볼 것이므로 gif 그대로)."""
    os.makedirs(outdir, exist_ok=True)
    p = os.path.join(outdir, '%s.png' % iid)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return open(p, 'rb').read()
    raw = os.path.join(outdir, '%s.src' % iid)
    cmd = ['curl', '-s', '-o', raw, '--max-time', '30', '--cacert', CA]
    if PROXY:
        cmd += ['--proxy', PROXY]
    cmd.append('https://www.law.go.kr/LSW/flDownload.do?flSeq=%s' % iid)
    subprocess.run(cmd, capture_output=True)
    if not os.path.exists(raw) or os.path.getsize(raw) == 0:
        return None
    try:
        from PIL import Image
        Image.open(raw).convert('RGB').save(p)
        os.remove(raw)
        return open(p, 'rb').read()
    except Exception:
        os.remove(raw)
        return None


def h(b):
    return hashlib.sha1(b).hexdigest() if b else None


def main():
    touched = Touched('admrul_restore_ocr')
    todo, restored_tot = [], 0
    for dp, _d, fs in os.walk(os.path.join(LEGAL, 'raw')):
        if '행정규칙' not in dp:
            continue
        for fn in sorted(fs):
            if not fn.endswith('.txt'):
                continue
            path = os.path.join(dp, fn)
            new = open(path, encoding='utf-8').read()
            if '현행화: 2026-08-23' not in new or OCR.search(new):
                continue
            old = git_show(os.path.relpath(path, REPO))
            blocks = ocr_blocks(old)
            if not blocks:
                continue
            imgdir = os.path.join(dp, '_이미지')
            oldhash = {}
            for oid in blocks:
                p = os.path.join(imgdir, '%s.png' % oid)
                if os.path.exists(p):
                    oldhash.setdefault(h(open(p, 'rb').read()), oid)
            newids = [m.group(1) for m in IMG.finditer(new)]
            pair, unmatched = {}, []
            for nid in newids:
                b = fetch_img(nid, imgdir)
                time.sleep(0.1)
                oid = oldhash.get(h(b)) if b else None
                if oid:
                    pair[nid] = blocks[oid]
                else:
                    unmatched.append(nid)
            if pair and not DRY:
                def repl(m):
                    b = pair.get(m.group(1))
                    return m.group(0) + '\n' + b if b else m.group(0)
                open(path, 'w', encoding='utf-8').write(IMG.sub(repl, new))
                touched.add(path)
            restored_tot += len(pair)
            if unmatched:
                todo.append({'file': os.path.relpath(path, LEGAL),
                             'image_ids': unmatched,
                             'why': '현행 개정으로 새로 실린 그림 — 옛 판독본과 바이트가 달라 짝지을 수 없다'})
            print('%-58s 되살림 %2d / 재판독 필요 %2d (옛 판독 %d개)'
                  % (fn[:58], len(pair), len(unmatched), len(blocks)), flush=True)

    touched.save()
    json.dump({'ran_at': '2026-08-23', 'items': todo},
              open(TODO, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n판독 블록 %d개 복원 · 재판독 필요 그림 %d장 -> %s'
          % (restored_tot, sum(len(t['image_ids']) for t in todo), TODO))


if __name__ == '__main__':
    main()
