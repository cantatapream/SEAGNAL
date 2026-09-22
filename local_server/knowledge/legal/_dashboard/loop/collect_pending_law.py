#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""예고본(시행예정 개정 법령) 원문을 **시행일 전에 미리** 받아 `raw/<도메인>/<법>/_대기/<시행일>/<층>.txt` 로 둔다.
런타임(article_text.js·legal_retriever.js)은 `_dashboard/pending_index.json` 을 보고, 시행일이 지난 대기본이
있으면 그 파일을 현행 대신 읽는다 — 시행일에 서버가 파일을 고치지 않는다. 설계: `_dashboard/H29_stage_design.md`.

쓰는 법:
    python3 collect_pending_law.py <큐항목id> [<id>…]     그 항목만
    python3 collect_pending_law.py --all-approved          큐에서 status=approved 인 law_pending 전부(기본 절차)
    python3 collect_pending_law.py --all-pending           status=pending 까지(승인 전 미리 받아 볼 때)
    python3 collect_pending_law.py --verify [--prune]      받아 둔 대기본이 아직 유효한가(연기·철회·dismissed·이미 현행)
    python3 collect_pending_law.py --status                대기본별로 위키 마커 준비 상태(사서가 고쳤나)
    python3 collect_pending_law.py --rebuild-index         raw 의 _대기 폴더를 훑어 지도만 다시 만든다
  공통: --force(같은 MST 라도 다시 받음) · --from-json <파일>(API 대신 저장된 응답 — 테스트·오프라인)

큐 파일: `local_server/data/law_change_queue.json` 이 있으면 그것(트랙 B 가 옮긴 자리), 없으면
`_dashboard/law_change_queue.json`. 텍스트 변환은 `recollect_jomun.build_text`·`recollect_budchik.format_budchik`
을 **그대로 import** 한다(복제 금지 — 현행 파일과 같은 꼴이어야 팝업 파서가 그대로 읽는다).

[연계] → raw/**/_대기/<d>/{법률|시행령|시행규칙}.txt + _meta.json · _dashboard/pending_index.json
       ← services/effective_date.js(지도를 읽는 쪽) · fold_effective.py(시행일 뒤 승격)
       ← _touched.py(고친 파일 기록 — 되돌릴 때 그 목록만)
⚠경합위험 없음: 새 폴더 `_대기/` 와 지도 파일만 쓴다. 현행 raw·_meta.json 은 읽기만 한다.
"""
import glob
import json
import os
import re
import shutil
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                      # noqa: E402
from recollect_jomun import build_text            # noqa: E402  (조문 → 현행과 같은 .txt 꼴)
from recollect_budchik import format_budchik      # noqa: E402  (부칙 블록)
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

# 테스트는 임시 트리를 가리키게 한다(시각·네트워크 의존 없는 회귀 테스트 규칙).
LEGAL = os.environ.get('NRYA_LEGAL_DIR') or os.path.normpath(os.path.join(HERE, '..', '..'))
REPO = os.environ.get('NRYA_REPO_DIR') or os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
WIKI = os.path.join(LEGAL, 'wiki')
INDEX = os.path.join(LEGAL, '_dashboard', 'pending_index.json')
QUEUE_CANDIDATES = [
    os.path.join(REPO, 'local_server', 'data', 'law_change_queue.json'),
    os.path.join(LEGAL, '_dashboard', 'law_change_queue.json'),
]
OC = 'hyoo1431'
FILE_MAP = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
STAGE_DIR = '_대기'


class _NullTouched:
    """테스트 트리(NRYA_LEGAL_DIR)에서는 Touched 기록을 남기지 않는다 — 기록 폴더가 진짜 _dashboard/touched/ 라서
    테스트마다 실제 저장소에 기록 파일이 쌓인다(실측 9개가 쌓여 지웠다)."""
    def add(self, path): pass
    def save(self): return None


def queue_path():
    for p in QUEUE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def load_queue():
    p = queue_path()
    if not p:
        return {'items': []}, None
    return json.load(open(p, encoding='utf-8')), p


def fetch_eflaw(mst, ef, from_json=None):
    """예고본 전문. `efYd` 를 같이 줘야 응답이 온다(H29_design §4 실측). 실패면 None."""
    if from_json:
        return json.load(open(from_json, encoding='utf-8'))
    # ★`efYd` 는 **선택이 아니라 필수**다 (2026-09-21 실측으로 확정).
    #   `lawService.do?target=eflaw` 는 efYd 가 **없거나 그 MST 의 실제 시행일자가 아니면**
    #   HTTP **200** 과 함께 *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다.
    #   ⚠**이 문구를 권한 문제로 읽으면 안 된다.** 같은 MST 에 맞는 efYd 를 주면 그 자리에서
    #     JSON 이 온다 — 선박안전법 246611+20230628 → 177,917 B, 항만법 283707+20260227 → 198,849 B.
    #     즉 **신청은 돼 있다.** law.go.kr 이 "인자가 틀렸다"를 "미신청"이라고 말할 뿐이다.
    #   (내가 이 문구를 두 번 오진했다 — 처음엔 "호스트 불통", 다음엔 "eflaw 미신청". L-294·L-295)
    url = f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON&MST={mst}&efYd={ef}'
    for i in range(5):
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.lstrip()[:1] in '{[':
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None          # 재시도로 안 풀린다
        except Exception:
            pass
        time.sleep(3)
    return None


def stage_text(body):
    """조문 본문 + 부칙 — 현행 .txt 와 같은 꼴. 조문이 없으면 None."""
    txt = build_text(body)
    if not txt:
        return None
    bu = (body.get('법령') or {}).get('부칙') or {}
    add = format_budchik(bu) if isinstance(bu, dict) else None
    if add:
        txt = txt.rstrip('\n') + '\n\n' + add
    return txt


def raw_dir_of(item):
    """큐의 law.raw 는 절대경로다. 테스트 트리(NRYA_LEGAL_DIR)에서는 raw/ 아래 상대 부분만 옮겨 쓴다."""
    p = item['law']['raw']
    m = re.search(r'/raw/(.+)$', p)
    return os.path.join(RAW, m.group(1)) if m else p


def collect_item(item, touched, force=False, from_json=None):
    layer = item.get('layer')
    fname = FILE_MAP.get(layer)
    if item.get('kind') != 'law_pending' or not fname:
        print(f"⏭️  {item.get('id')} — 대상 아님(kind={item.get('kind')}, layer={layer})")
        return False
    mst = str(item['after']['MST'])
    ef = str(item['시행일자'])
    base = raw_dir_of(item)
    dest = os.path.join(base, STAGE_DIR, ef)
    meta_p = os.path.join(dest, '_meta.json')
    meta = json.load(open(meta_p, encoding='utf-8')) if os.path.exists(meta_p) else {'시행일자': ef, 'families': {}}
    prev = (meta.get('families') or {}).get(layer)
    if prev and str(prev.get('MST')) == mst and os.path.exists(os.path.join(dest, fname)) and not force:
        print(f"= {item['law']['slug']} {layer} {ef} — 이미 있음(MST {mst})")
        return False
    body = fetch_eflaw(mst, ef, from_json)
    if not body or '법령' not in body:
        print(f"❌ {item['law']['slug']} {layer} {ef} — API 응답 없음(MST {mst}) → 저장 안 함")
        return False
    bi = body['법령'].get('기본정보') or {}
    if str(bi.get('시행일자')) != ef:
        # ⑬ 응답의 시행일자가 큐와 다르면(연기됐거나 다른 판) 그 날짜 폴더에 넣으면 틀린 날 켜진다 — 저장하지 않는다.
        print(f"❌ {item['law']['slug']} {layer} — 응답 시행일자 {bi.get('시행일자')} ≠ 큐 {ef} → 저장 안 함(연기·변경 의심)")
        return False
    txt = stage_text(body)
    if not txt:
        print(f"❌ {item['law']['slug']} {layer} {ef} — 조문 없음 → 저장 안 함")
        return False
    os.makedirs(dest, exist_ok=True)
    out = os.path.join(dest, fname)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(txt)
    touched.add(out)
    jos = body['법령'].get('조문', {}).get('조문단위') or []
    jos = jos if isinstance(jos, list) else [jos]
    meta.setdefault('families', {})[layer] = {
        'MST': mst, '법령ID': bi.get('법령ID'), '법령명': bi.get('법령명_한글'),
        '공포일자': bi.get('공포일자'), '공포번호': bi.get('공포번호'), '시행일자': ef,
        '조문수': sum(1 for a in jos if a.get('조문여부') == '조문'),
        'changed_articles': item.get('changed_articles') or [],
        'queue_id': item.get('id'), '수집일': time.strftime('%Y-%m-%d'),
        'source': f'lawService.do?target=eflaw&MST={mst}&efYd={ef}',
    }
    json.dump(meta, open(meta_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    touched.add(meta_p)
    tag = '대체' if prev and str(prev.get('MST')) != mst else '수집'
    print(f"✓ {tag} {item['law']['slug']} {layer} 시행 {ef} MST {mst} → {os.path.relpath(out, REPO)} ({len(txt):,}자)")
    return True


def build_index():
    """raw/*/*/_대기/<d>/ 를 훑어 지도를 만든다. 키 = 법 폴더의 저장소 상대경로(rawPathOf 값과 같은 꼴)."""
    idx = {}
    for d in sorted(glob.glob(os.path.join(RAW, '*', '*', STAGE_DIR, '[0-9]' * 8))):
        base = os.path.dirname(os.path.dirname(d))
        key = os.path.relpath(base, REPO).replace(os.sep, '/')
        files = sorted(f for f in os.listdir(d) if f.endswith('.txt'))
        if not files:
            continue
        meta = {}
        mp = os.path.join(d, '_meta.json')
        if os.path.exists(mp):
            meta = json.load(open(mp, encoding='utf-8'))
        fams = meta.get('families') or {}
        ent = {'date': os.path.basename(d), 'files': files, 'mst': {}, 'queue_id': {}}
        for layer, fname in FILE_MAP.items():
            if fname in files and isinstance(fams.get(layer), dict):
                ent['mst'][fname] = fams[layer].get('MST')
                ent['queue_id'][fname] = fams[layer].get('queue_id')
        idx.setdefault(key, []).append(ent)
    return idx


def write_index(touched):
    idx = build_index()
    os.makedirs(os.path.dirname(INDEX), exist_ok=True)
    json.dump(idx, open(INDEX, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    touched.add(INDEX)
    n = sum(len(v) for v in idx.values())
    print(f'지도 갱신: 법 {len(idx)}개 · 대기본 {n}개 → {os.path.relpath(INDEX, REPO)}')
    return idx


def current_mst(base, layer):
    try:
        m = json.load(open(os.path.join(base, '_meta.json'), encoding='utf-8'))
        fam = (m.get('families') or {}).get(layer)
        return str(fam.get('MST')) if isinstance(fam, dict) else None
    except Exception:
        return None


def file_eff(path):
    """그 .txt 머리의 실제 시행일. 못 읽으면 ''.
    예: file_eff('…/법률.txt') → '20260828'
    [연계] ← verify(⑩′ 현행이 대기본보다 뒤 판인지) · fold_effective._file_eff 와 같은 규칙."""
    try:
        m = re.search(r'\(시행 (\d{8})', open(path, encoding='utf-8').read(4000))
        return m.group(1) if m else ''
    except Exception:
        return ''


def read_staged(base, d, fname):
    """받아 둔 대기본 원문. 없으면 None. [연계] ← verify(①″ 같은 MST 내용 갱신 대조)."""
    try:
        return open(os.path.join(base, STAGE_DIR, d, fname), encoding='utf-8').read()
    except Exception:
        return None


def _norm(s):
    """줄 끝 공백·파일 끝 빈 줄만 무시하고 비교한다(내용 차이만 잡으려고)."""
    return '\n'.join(line.rstrip() for line in str(s or '').split('\n')).strip()


def verify(prune, touched, from_json=None):
    """받아 둔 대기본이 아직 맞는가 — ②연기 ③철회 ⑨dismissed ⑩이미 현행 ⑩′현행이 더 뒤 판
    ①″같은 MST 인데 내용이 달라짐. ❌는 --prune 이면 지운다."""
    q, _ = load_queue()
    status_of = {i.get('id'): i.get('status') for i in q.get('items', [])}
    idx = build_index()
    bad = []
    for key, ents in idx.items():
        base = os.path.join(REPO, key)
        for e in ents:
            d = e['date']
            for fname in e['files']:
                layer = next((k for k, v in FILE_MAP.items() if v == fname), fname)
                mst = e['mst'].get(fname)
                qid = e['queue_id'].get(fname)
                label = f"{key.split('/')[-1]} {layer} {d} (MST {mst})"
                st = status_of.get(qid)
                if st in ('dismissed', 'ignored'):
                    print(f'❌ {label} — 큐 항목 {qid} 이 {st}'); bad.append((base, d, fname)); continue
                if mst and current_mst(base, layer) == str(mst):
                    print(f'↩ {label} — 현행 _meta.json 과 MST 동일(이미 현행) → fold_effective.py 가 접는다'); continue
                # ⑩′ 현행이 이 대기본보다 **뒤 시행본**이면 승격할 것이 없다 — 트랙 D 가 먼저 재수집한 경우다
                #    (2026-09-10 독립 검토 high: 종전에는 MST 만 봐서 새 판을 옛 예고본으로 되돌릴 뻔했다).
                cur_eff = file_eff(os.path.join(base, fname))
                if cur_eff and cur_eff > d:
                    print(f'❌ {label} — 현행이 이미 시행 {cur_eff} 판(대기본 {d} 보다 뒤) → 쓸모없다')
                    bad.append((base, d, fname)); continue
                body = fetch_eflaw(mst, d, from_json) if mst else None
                bi = ((body or {}).get('법령') or {}).get('기본정보') or {}
                if not bi:
                    print(f'❌ {label} — API 재조회가 비었다(철회 의심)'); bad.append((base, d, fname)); continue
                if str(bi.get('시행일자')) != d:
                    print(f"❌ {label} — 시행일자가 {bi.get('시행일자')} 로 바뀜(연기·변경)"); bad.append((base, d, fname)); continue
                # ①″ **같은 MST 라도 내용이 바뀐다** — 시행예정 판은 MST 를 유지한 채 나중에 공포된 개정을
                #    흡수한다(실측: 양식산업발전법 MST 281971 이 2026-03-31 공포 개정을 담고 있었다).
                #    시행일자만 대조하면 낡은 예고본이 ✅ 로 통과해 시행일에 그대로 켜진다. 본문을 대조한다.
                fresh = stage_text(body)
                saved = read_staged(base, d, fname)
                if fresh and saved is not None and _norm(fresh) != _norm(saved):
                    print(f'❌ {label} — 같은 MST 인데 내용이 달라졌다(중간 개정 흡수) → 다시 받아야 한다')
                    bad.append((base, d, fname)); continue
                print(f'✅ {label} — 유효')
    if prune and bad:
        for base, d, fname in bad:
            p = os.path.join(base, STAGE_DIR, d, fname)
            if os.path.exists(p):
                os.remove(p); touched.add(p); print(f'   지움 {os.path.relpath(p, REPO)}')
            ddir = os.path.dirname(p)
            if os.path.isdir(ddir) and not [f for f in os.listdir(ddir) if f.endswith('.txt')]:
                shutil.rmtree(ddir); print(f'   폴더 지움 {os.path.relpath(ddir, REPO)}')
        write_index(touched)
    print(f'\n검증: 대기본 {sum(len(e["files"]) for v in idx.values() for e in v)}개 · ❌ {len(bad)}개' + (' (지움)' if prune and bad else ''))
    return len(bad)


def status():
    """⑦ 사서가 위키를 고쳤나 — 그 법 이름이 있는 위키 중 `<!--시행 <d>-->` 를 가진 페이지 수."""
    idx = build_index()
    pages = []
    for p in glob.glob(os.path.join(WIKI, '*', '*.md')):
        pages.append((p, open(p, encoding='utf-8').read()))
    for key, ents in idx.items():
        base = os.path.join(REPO, key)
        try:
            name = json.load(open(os.path.join(base, '_meta.json'), encoding='utf-8')).get('법령명') or key.split('/')[-1]
        except Exception:
            name = key.split('/')[-1]
        flat = re.sub(r'\s+', '', name)
        for e in ents:
            d = e['date']
            marker = f'<!--시행 {d}-->'
            cites = [p for p, t in pages if flat in re.sub(r'\s+', '', t)]
            ready = [p for p in cites if marker in open(p, encoding='utf-8').read()]
            flag = '✅' if ready else '⚠'
            print(f"{flag} {name} 시행 {d} {','.join(e['files'])} — 인용 위키 {len(cites)}쪽 중 마커 있는 쪽 {len(ready)}")
    if not idx:
        print('대기본 없음')


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    flags = set(a for a in argv if a.startswith('--'))
    from_json = argv[argv.index('--from-json') + 1] if '--from-json' in argv else None
    if from_json:
        args = [a for a in args if a != from_json]
    touched = Touched('collect_pending_law') if not os.environ.get('NRYA_LEGAL_DIR') else _NullTouched()
    if '--rebuild-index' in flags:
        write_index(touched); touched.save(); return 0
    if '--verify' in flags:
        n = verify('--prune' in flags, touched, from_json); touched.save(); return 1 if n else 0
    if '--status' in flags:
        status(); return 0
    q, qp = load_queue()
    if not qp:
        print('큐 파일 없음:', QUEUE_CANDIDATES); return 2
    items = [i for i in q.get('items', []) if i.get('kind') == 'law_pending']
    if '--all-approved' in flags:
        targets = [i for i in items if i.get('status') == 'approved']
    elif '--all-pending' in flags:
        targets = [i for i in items if i.get('status') in ('pending', 'approved')]
    else:
        targets = [i for i in items if i.get('id') in args]
        missing = set(args) - set(i.get('id') for i in targets)
        if missing:
            print('큐에 없는 id:', ', '.join(sorted(missing)))
    print(f'큐: {os.path.relpath(qp, REPO)} · 대상 {len(targets)}건', flush=True)
    n = 0
    for it in targets:
        if collect_item(it, touched, '--force' in flags, from_json):
            n += 1
            time.sleep(0.3)
    if n or '--all-approved' in flags or '--all-pending' in flags:
        write_index(touched)
    touched.save()
    print(f'완료: {n}건 저장')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
