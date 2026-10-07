#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-82 — 관리자가 **승인한 개정**의 원문을 종류에 상관없이 **한 명령으로** 받는다. (법령 + 행정규칙)

[왜 있나 — 2026-10-07 사장님 질문 「스캔이 돌 때 행정규칙도 관련성이 있는 규칙이라면 함께 수집되어야 할 것 같은데?」]
운영 서버의 개정검토 방이 29+15건을 올리고 인계문이 「1. 원문을 먼저 받는다 —
`collect_pending_law.py --all-approved`」 라고 적었다. 그런데 그 자는 **`law_pending`(시행예정 법령) 하나만** 받고
나머지는 `⏭️ 대상 아님` 으로 건너뛴다(실측 — 코드 132·341행). 그래서 승인해도 아무도 안 받던 것이 셋이었다:
  · `admrul_amended`     우리가 가진 고시의 새 판        → 이제 받는다(같은 파일을 새 판으로)
  · `admrul_unknown_new` 우리 법을 인용하는 새 고시       → 이제 받는다(그 법의 `행정규칙/` 폴더에 새 파일)
  · `law_amended`        이미 시행 중인 법령 개정         → 이제 받는다(현행 층을 새 판으로)
그리고 둘째 구멍: 작업 세션은 **운영 서버의 큐를 못 본다**(승인은 운영 볼륨에 있다 — `_amendments/README.md`).
그래서 인계문 끝에 **기계가 읽는 수집 목록**(`<!-- collect-manifest:start -->`)을 싣고, 이 자가 그것을 읽는다.

[무엇을 하나 — 종류마다 이미 있는 자를 그대로 부른다(덮어쓰기 규칙을 두 곳에 두지 않는다, L-386)]
  law_pending        → `collect_pending_law.collect_item`  (예고본을 `_대기/<시행일>/` 에 — 현행은 안 건드린다)
  law_amended        → `recollect_tier.do_one`             (그 층을 새 판으로 · 옛 판은 `_legacy/` · 70%·사람손 보류)
  admrul_amended     → `admrul_recollect_stale.refresh_file` (같은 판번호를 가진 파일 전부 · 70%·사람손·_구판 보류)
  admrul_unknown_new → 관련 법이 **하나**면 그 법의 `행정규칙/` 에 새 파일. 둘 이상이면 **고르지 않는다**(G-34) —
                       `--place <id>=<법slug>` 로 사람이 정한다. 이미 같은 번호·같은 제목 파일이 있으면 받지 않는다.
  law_dept_changed · law_renamed → 받을 원문이 없다(이름·부처만 바뀜) — 「위키·_meta 를 사람이 고친다」 로 적는다.

[언제 받지 않나 — 받지 않은 건마다 까닭을 남긴다(조용히 넘기지 않는다)]
  · 행정규칙의 시행일이 오늘(KST) 뒤 — 현행 자리에 시행 전 글이 들어간다. 시행일 뒤에 다시 돌린다.
  · 법령 층이 이미 그 판(MST 같음) — `이미 현행`.
  · law.go.kr 이 본문을 안 줬다 — `실패(…)`. 이것이 하나라도 있으면 종료코드 1.

쓰는 법(저장소 루트에서):
    python3 …/collect_approved.py --from-brief <인계문을 저장한 파일> [--dry]     ← 운영 서버 승인분(기본 절차)
    python3 …/collect_approved.py --all-approved [--dry]                           ← 이 컴퓨터 큐 사본의 승인분
    python3 …/collect_approved.py <큐 id> [<id>…] [--dry]                          ← 이 컴퓨터 큐 사본에서 그 id
  공통: --only <id> … · --place <id>=<법slug> … · --force(받아 둔 예고본도 다시 받는다 — `collect_pending_law.py --verify` 가
        「같은 MST 인데 내용이 달라졌다」고 할 때. 2026-10-07 연안사고예방법 실측)
  결과: `_dashboard/collect_approved_report.json` · 고친 파일 목록 `_dashboard/touched/collect_approved_<시각>.json`

[연계] ← services/legal_wiki_brief.js(collectManifest — 인계문의 수집 목록) · local_server/data/law_change_queue.json
       → collect_pending_law.py · recollect_tier.py · admrul_recollect_stale.py · _admrul_id.py · _touched.py
       ← local_server/scripts/test_collect_approved.js (망 없이 도는 시험)
"""
import contextlib
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                      # noqa: E402
import _admrul_id                                  # noqa: E402
import collect_pending_law as CPL                  # noqa: E402
import recollect_tier as RT                        # noqa: E402
import admrul_recollect_stale as ARS               # noqa: E402

LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
REPO = os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))
OUT = os.path.join(LEGAL, '_dashboard', 'collect_approved_report.json')
PATHS = os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json')
KST = timezone(timedelta(hours=9))
MANIFEST_RE = re.compile(r'<!--\s*collect-manifest:start\s*-->(.*?)<!--\s*collect-manifest:end\s*-->', re.S)
NO_TEXT = ('law_dept_changed', 'law_renamed')


def today():
    """오늘(KST) `YYYYMMDD`. 시험은 COLLECT_TODAY 로 고정한다."""
    return os.environ.get('COLLECT_TODAY') or datetime.now(KST).strftime('%Y%m%d')


def _flat(s):
    return re.sub(r'[^가-힣A-Za-z0-9]', '', str(s or ''))


def normalize(x):
    """큐 항목 세 꼴(탐지 큐 · 관리자 큐 · 인계문 수집 목록)을 한 꼴로. → dict

    예: normalize({'id':'chg_1','kind_code':'admrul_amended','law':'선박입출항법',
                   '이전':{'ID':'21…778'},'현재':{'ID':'21…648','시행일자':'20260805'}, …})
        → {'id':'chg_1','kind':'admrul_amended','slug':'선박입출항법','ID_old':'21…778','ID_new':'21…648', …}
    """
    if 'kind_code' in x:                       # 관리자 큐(= 인계문 수집 목록) — toLegacyEntry 꼴
        prev, cur = x.get('이전') or {}, x.get('현재') or {}
        return {
            'id': str(x.get('id') or ''), 'kind': x.get('kind_code') or '', 'layer': x.get('layer') or '',
            'slug': x.get('law') or '', 'raw': '', 'title': x.get('법령명') or '',
            'title_old': prev.get('법령명') or '',
            'status': x.get('status') or 'pending',
            'MST_new': str(cur.get('MST') or ''), 'MST_old': str(prev.get('MST') or ''),
            'ID_new': str(cur.get('ID') or ''), 'ID_old': str(prev.get('ID') or ''),
            '시행일자': str(cur.get('시행일자') or ''), '발령일자': str(cur.get('발령일자') or cur.get('공포일자') or ''),
            'related': [r.get('slug') for r in (x.get('related_laws') or []) if r.get('slug')],
            'changed_articles': x.get('changed_articles') or [],
        }
    law, b, a = x.get('law') or {}, x.get('before') or {}, x.get('after') or {}
    return {                                   # 탐지 큐 — detect_law_changes.make_item 꼴
        'id': str(x.get('id') or ''), 'kind': x.get('kind') or '', 'layer': x.get('layer') or '',
        'slug': law.get('slug') or '', 'raw': law.get('raw') or '',
        'title': a.get('제목') or b.get('제목') or law.get('name') or '',
        'title_old': b.get('제목') or '',
        'status': x.get('status') or 'pending',
        'MST_new': str(a.get('MST') or ''), 'MST_old': str(b.get('MST') or ''),
        'ID_new': str(a.get('ID') or ''), 'ID_old': str(b.get('ID') or ''),
        '시행일자': str(x.get('시행일자') or a.get('시행일자') or ''),
        '발령일자': str(a.get('발령일자') or x.get('공포일자') or ''),
        'related': [r.get('slug') for r in (x.get('related_laws') or []) if r.get('slug')],
        'changed_articles': x.get('changed_articles') or [],
    }


def read_brief(path):
    """인계문(붙여 넣은 글을 저장한 파일)에서 수집 목록을 꺼낸다. 없으면 ValueError."""
    t = open(path, encoding='utf-8').read()
    m = MANIFEST_RE.search(t)
    if not m:
        raise ValueError('인계문에 수집 목록(<!-- collect-manifest:start -->)이 없다 — '
                         '3-82 이전에 뽑은 글이다. 관리자 화면에서 「위키 반영 지시문」 을 다시 뽑아라.')
    body = re.sub(r'^\s*```(?:json)?\s*|\s*```\s*$', '', m.group(1).strip())
    d = json.loads(body)
    return d.get('items') or []


_PATHS = None


def law_dir(slug, raw=''):
    """그 법의 raw 폴더(절대경로). 큐의 절대경로는 **다른 컴퓨터 것**일 수 있어 raw/ 아래 부분만 쓴다."""
    global _PATHS
    if raw:
        m = re.search(r'/raw/(.+)$', raw)
        p = os.path.join(LEGAL, 'raw', m.group(1)) if m else raw
        if os.path.isdir(p):
            return p
    if _PATHS is None:
        try:
            _PATHS = json.load(open(PATHS, encoding='utf-8'))
        except Exception:
            _PATHS = {}
    rel = _PATHS.get(slug)
    if rel:
        p = os.path.join(REPO, rel)
        if os.path.isdir(p):
            return p
    return None


def admrul_index():
    """행정규칙 파일 전부의 (번호들, 제목). `_구판`·`_대기` 등은 `walk_admrul` 이 이미 뺀다."""
    out = []
    for p in _admrul_id.walk_admrul():
        ids, _w = _admrul_id.find_ids(p)
        title, _t = _admrul_id.find_title(p)
        out.append({'path': p, 'ids': [str(i) for i in ids], 'title': title or ''})
    return out


def _quiet(fn, *a, **k):
    """그 자가 찍는 줄을 받아 둔다(결과 표의 까닭 칸에 싣는다)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        r = fn(*a, **k)
    return r, buf.getvalue().strip()


def do_law_pending(it, touched, dry, force=False):
    base = law_dir(it['slug'], it['raw'])
    if not base:
        return {'status': '실패(법 폴더 없음)'}
    if dry:
        return {'status': '받을 것(dry)', 'note': '예고본 MST %s · 시행 %s → _대기/' % (it['MST_new'], it['시행일자'])}
    item = {'id': it['id'], 'kind': 'law_pending', 'layer': it['layer'], 'after': {'MST': it['MST_new']},
            '시행일자': it['시행일자'], 'law': {'slug': it['slug'], 'raw': base},
            'changed_articles': it['changed_articles']}
    ok, said = _quiet(CPL.collect_item, item, touched, force)
    if ok:
        return {'status': '수집', 'note': said, 'staged': True}
    if said.startswith('='):
        return {'status': '이미 있음', 'note': said}
    return {'status': '실패(%s)' % (said.split('—')[-1].strip()[:80] or '까닭 없음'), 'note': said}


def do_law_amended(it, touched, dry):
    base = law_dir(it['slug'], it['raw'])
    if not base:
        return {'status': '실패(법 폴더 없음)'}
    have = CPL.current_mst(base, it['layer'])
    cur = CPL.file_eff(os.path.join(base, it['layer'] + '.txt'))
    if have == it['MST_new'] and (not cur or cur >= it['시행일자']):
        return {'status': '이미 현행', 'note': 'MST %s' % it['MST_new']}
    # ★우리 사본이 **큐보다 더 새 판**인 경우 (2026-10-07 실측 — 폐기물관리법: 큐는 276797→283447(시행 20260820),
    #   우리 사본은 그 뒤 판 284397(시행 20260918)). 그대로 넘기면 recollect_tier 가 「보류(meta MST ≠ 보고서)」 라
    #   적어 **사람이 할 일이 있는 것처럼** 보인다. 시행일로 뒤 판임을 확인될 때만 이렇게 적는다.
    if have and have not in (it['MST_old'], it['MST_new']) and cur and cur > it['시행일자']:
        return {'status': '이미 현행(우리 사본이 더 새 판)', 'note': 'MST %s · 시행 %s > 큐 %s' % (have, cur, it['시행일자'])}
    other = os.sep + '15_관련타부처' + os.sep in base + os.sep
    rec = RT.do_one(it['slug'], it['layer'], it['MST_new'], it['시행일자'], touched, dry, set(),
                    held_mst=it['MST_old'] or None, other=other)
    st = rec.get('status', '')
    if st.startswith('갱신'):
        return {'status': '수집' if not dry else '받을 것(dry)', 'note': st}
    if st == '이미 현행':
        return {'status': '이미 현행', 'note': 'MST %s' % it['MST_new']}
    if st.startswith('중단(시행예정'):
        return {'status': '보류(시행 전 — 그날 뒤에 다시 돌린다)', 'note': st}
    if st.startswith('보류'):
        return {'status': st, 'note': json.dumps({k: v for k, v in rec.items() if k not in ('slug', 'tier')}, ensure_ascii=False)[:300]}
    return {'status': '실패(%s)' % st, 'note': ''}


def _future(it):
    ef = it['시행일자']
    return bool(re.fullmatch(r'\d{8}', ef)) and ef > today()


def do_admrul_amended(it, touched, dry, idx):
    if _future(it):
        return {'status': '보류(시행 전 %s — 그날 뒤에 다시 돌린다)' % it['시행일자']}
    files = [f['path'] for f in idx if it['ID_old'] and it['ID_old'] in f['ids']]
    how = '옛 판번호 %s' % it['ID_old']
    if not files:
        want = _flat(it['title_old'] or it['title'])
        files = [f['path'] for f in idx if want and _flat(f['title']) == want]
        how = '제목'
    if not files:
        return {'status': '실패(가진 파일을 못 찾았다 — 옛 번호 %s · 제목 %s)' % (it['ID_old'], it['title_old'] or it['title'])}
    if all(it['ID_new'] in f['ids'] for f in idx if f['path'] in files):
        return {'status': '이미 현행', 'note': '%d파일' % len(files)}
    # 여러 고시를 묶은 파일(예: 관할서 19곳을 한 파일에)은 통째로 덮으면 나머지 18곳이 사라진다 — 사람이 그 칸만 고친다.
    bundled = [f['path'] for f in idx if f['path'] in files and len(f['ids']) > 1]
    if bundled:
        return {'status': '보류(여러 고시를 묶은 파일 — 그 고시 칸만 사람이 고친다)',
                'note': ' · '.join(os.path.relpath(p, REPO) for p in bundled[:3])}
    body, info = ARS.fetch_body(it['ID_new'])
    if not body:
        return {'status': '실패(본문을 못 받았다 — ID %s)' % it['ID_new']}
    recs = [ARS.refresh_file(p, it['title'], it['ID_new'], body, info, [it['ID_old']],
                             it['발령일자'], touched, dry) for p in files]
    done = [r for r in recs if r['status'] == '갱신']
    held = [r for r in recs if r['status'] != '갱신']
    rel = lambda p: os.path.relpath(p, REPO)
    note = '%s 로 찾은 %d파일 — ' % (how, len(files)) + ' · '.join('%s %s' % (r['status'], rel(r['file'])) for r in recs)
    if done and not held:
        return {'status': '수집' if not dry else '받을 것(dry)', 'note': note}
    if done:
        return {'status': '일부 수집(%d/%d)' % (len(done), len(recs)), 'note': note}
    return {'status': held[0]['status'], 'note': note}


def _fname(title):
    return re.sub(r'[\\/:*?"<>|]', '', title).replace(' ', '')[:70] + '.txt'


def do_admrul_new(it, touched, dry, idx, place):
    if _future(it):
        return {'status': '보류(시행 전 %s — 그날 뒤에 다시 돌린다)' % it['시행일자']}
    have = [f['path'] for f in idx if it['ID_new'] in f['ids']]
    if have:
        return {'status': '이미 있음', 'note': os.path.relpath(have[0], REPO)}
    same = [f['path'] for f in idx if _flat(f['title']) and _flat(f['title']) == _flat(it['title'])]
    if same:
        # 같은 제목인데 번호가 다르다 — 우리가 가진 것의 새 판일 수도, 다른 관서의 같은 이름 고시일 수도 있다.
        # 기계가 정하지 않는다(G-34).
        return {'status': '보류(같은 제목 파일이 있다 — 그 파일의 새 판인지 사람이 확인)',
                'note': ' · '.join(os.path.relpath(p, REPO) for p in same[:3])}
    slug = place.get(it['id'])
    if not slug:
        rel = sorted(set(it['related']))
        if len(rel) == 1:
            slug = rel[0]
        elif not rel:
            return {'status': '보류(관련 법이 없다 — 둘 폴더를 정할 수 없다)'}
        else:
            return {'status': '보류(관련 법 %d개 — 둘 폴더를 사람이 정한다: --place %s=<법slug>)' % (len(rel), it['id']),
                    'note': ' · '.join(rel)}
    base = law_dir(slug)
    if not base:
        return {'status': '실패(법 폴더 없음: %s)' % slug}
    d = os.path.join(base, '행정규칙')
    out = os.path.join(d, _fname(it['title']))
    if os.path.exists(out):
        return {'status': '보류(같은 이름 파일이 있다)', 'note': os.path.relpath(out, REPO)}
    if dry:
        return {'status': '받을 것(dry)', 'note': os.path.relpath(out, REPO)}
    body, info = ARS.fetch_body(it['ID_new'])
    if not body or len(body) < 30:
        return {'status': '실패(본문을 못 받았다 — ID %s)' % it['ID_new']}
    f = lambda k: ARS.flat(info.get(k))
    hdr = ('[고시/행정규칙] %s\n' % (f('행정규칙명') or it['title'])
           + 'ID:%s · 소관: %s\n' % (it['ID_new'], f('소관부처명'))
           + '발령: %s %s · 발령일자 %s · 시행일자 %s\n' % (f('제개정구분명'), f('발령번호'),
                                                        f('발령일자') or it['발령일자'], f('시행일자') or it['시행일자'])
           + '수집: %s collect_approved.py — 관리자 승인(개정검토 %s)\n\n' % (
               datetime.now(KST).strftime('%Y-%m-%d'), it['id']))
    os.makedirs(d, exist_ok=True)
    open(out, 'w', encoding='utf-8').write(hdr + body + '\n')
    touched.add(out)
    return {'status': '수집', 'note': os.path.relpath(out, REPO)}


def run(items, dry=False, only=None, place=None, touched=None, force=False):
    """정규화한 항목들을 종류별로 받는다. → 결과 목록"""
    place = place or {}
    touched = touched or Touched('collect_approved')
    idx = None
    results = []
    staged = False
    for it in items:
        if only and it['id'] not in only:
            continue
        k = it['kind']
        try:
            if k == 'law_pending':
                r = do_law_pending(it, touched, dry, force)
            elif k == 'law_amended':
                r = do_law_amended(it, touched, dry)
            elif k in ('admrul_amended', 'admrul_unknown_new'):
                if idx is None:
                    idx = admrul_index()
                r = (do_admrul_amended(it, touched, dry, idx) if k == 'admrul_amended'
                     else do_admrul_new(it, touched, dry, idx, place))
                if r['status'] == '수집':
                    idx = None                      # 파일이 바뀌었다 — 다음 건은 다시 훑는다
            elif k in NO_TEXT:
                r = {'status': '받을 원문 없음(이름·부처만 바뀜 — 위키·_meta 를 사람이 고친다)'}
            else:
                r = {'status': '실패(모르는 종류 %s)' % k}
        except Exception as e:                       # 한 건이 터져도 나머지는 받는다 — 까닭은 남긴다
            r = {'status': '실패(%s: %s)' % (type(e).__name__, str(e)[:120])}
        staged = staged or bool(r.pop('staged', False))
        row = {'id': it['id'], 'kind': k, 'layer': it['layer'], 'title': it['title'] or it['slug']}
        row.update(r)
        results.append(row)
        print(' · %-22s %-18s %-30s %s' % (it['id'], k, (it['title'] or it['slug'])[:30], row['status']), flush=True)
        time.sleep(0.2 if not dry else 0)
    if staged and not dry:
        _quiet(CPL.write_index, touched)
    return results


def summary(results):
    """종류별·결과별 셈. → {'법령': {'수집': n, …}, '행정규칙': {…}}"""
    out = {}
    for r in results:
        g = '행정규칙' if r['kind'].startswith('admrul_') else '법령'
        st = re.sub(r'\(.*$', '', r['status'])
        out.setdefault(g, {}).setdefault(st, 0)
        out[g][st] += 1
    return out


def main(argv):
    flags = [a for a in argv if a.startswith('--')]
    dry = '--dry' in flags

    def vals(flag):
        if flag not in argv:
            return []
        out = []
        for x in argv[argv.index(flag) + 1:]:
            if x.startswith('--'):
                break
            out.append(x)
        return out
    only = set(vals('--only'))
    place = dict(v.split('=', 1) for v in vals('--place') if '=' in v)
    if '--from-brief' in argv:
        src = vals('--from-brief')[0]
        try:
            raw = read_brief(src)
        except ValueError as e:
            print('❌', e); return 2
        items = [normalize(x) for x in raw]
        items = [i for i in items if i['status'] == 'approved']
        where = '인계문 %s' % src
    else:
        q, qp = CPL.load_queue()
        if not qp:
            print('큐 파일 없음'); return 2
        allq = [normalize(x) for x in q.get('items', [])]
        if '--all-approved' in flags:
            items = [i for i in allq if i['status'] == 'approved']
        else:
            ids = [a for a in argv if not a.startswith('--') and a not in only and a not in vals('--place')]
            items = [i for i in allq if i['id'] in ids]
            miss = set(ids) - set(i['id'] for i in items)
            if miss:
                print('이 컴퓨터 큐 사본에 없는 id(운영 서버에만 있다 — 인계문으로 받아라):', ', '.join(sorted(miss)))
        where = os.path.relpath(qp, REPO)
    print('승인분 %d건 · 출처 %s · dry=%s' % (len(items), where, dry), flush=True)
    touched = Touched('collect_approved') if not dry else CPL._NullTouched()
    results = run(items, dry, only, place, touched, '--force' in flags)
    s = summary(results)
    print('\n결과:', json.dumps(s, ensure_ascii=False))
    if not dry:
        json.dump({'ran_at': datetime.now(KST).strftime('%Y-%m-%d %H:%M KST'), 'source': where,
                   'summary': s, 'results': results},
                  open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        touched.save()
    return 1 if any(r['status'].startswith('실패') for r in results) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
