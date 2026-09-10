#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""시행일이 **지난** 예고본을 현행으로 승격하고 위키의 시행일 마커를 평문으로 접는다(H-29 트랙 C 정리 단계).

런타임은 이미 날짜로 새 판을 내고 있다(services/effective_date.js) — 이 스크립트는 그 뒤의 **정리**다.
하루 늦어도 사용자 답은 달라지지 않는다. 그래서 시행일 당일 트리거가 필요 없다(H29_stage_design.md §4).

무엇을 하나(시행일 <= 오늘 인 대기본마다):
  raw   · 옛 현행 `<층>.txt` → `_legacy/raw/<도메인>/<법>/<층>_시행<옛시행일>_MST<옛MST>.txt` (삭제 대신 이동)
        · `_대기/<d>/<층>.txt` → 현행 `<층>.txt`
        · `_meta.json` families.<층>.MST 갱신, 법률이면 최상위 `시행일` 도 갱신, `예고본승격` 기록 한 줄
        · 현행 MST 가 이미 같으면(트랙 D 가 먼저 재수집한 경우) 대기본만 지운다
        · 빈 `_대기/<d>/` 폴더 제거, `pending_index.json` 재생성
  wiki  · `<!--시행 d-->…<!--/시행-->` 는 본문으로, `<!--시행전 d-->…<!--/시행전-->` 는 삭제(d <= 오늘 인 것만)
        · 바뀐 페이지의 「## 변경 이력」 표 끝에 한 줄 추가

★승인 게이트(사용자 확정 2026-09-10): **관리자가 승인한 대기본만** 승격·접기 한다. 승인 상태는
  개정검토 큐(`local_server/data/legal_amendments_queue.jsonl`, 없으면 git 시드 `_amendments/queue.jsonl`)의
  `status:'approved'` 이고, 대기본과는 `pending_index.json` 의 `queue_id` 로 이어진다.
  ⚠작업 컴퓨터가 보는 큐 사본은 실서비스 승인보다 **뒤처져 있을 수 있다** — 폰에서 방금 승인한 것은
  안 보인다. 그럴 때만 `--allow-unapproved` 로 사람이 책임지고 넘긴다(이유를 커밋 메시지에 적을 것).

쓰는 법: python3 fold_effective.py [--today YYYYMMDD] [--dry-run] [--raw-only | --wiki-only] [--allow-unapproved]
  --today 는 테스트·리허설용(기본은 오늘 KST). --dry-run 은 무엇을 할지만 찍는다.
⚠경합위험: 현행 raw·_meta.json·위키를 **고친다.** 다른 에이전트가 같은 법 raw 나 위키를 손보는 중이면
  단독으로 돌린다(CLAUDE.md 병렬 작업 안전 규칙). 고친 파일은 Touched 로 남긴다.
[연계] ← _dashboard/pending_index.json(collect_pending_law.py) · services/effective_date.js(같은 접기 규칙의 JS 판 —
       두 구현이 같은 결과를 내는지 test_pending_law.js 가 대조한다)
"""
import glob
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                   # noqa: E402
import collect_pending_law as cpl                              # noqa: E402  (지도 재생성·경로 상수 공유)
from stage_markers import INLINE_RE, OPEN_LINE_RE, CLOSE_LINE_RE, check_markers  # noqa: E402  (마커 규칙 한 곳)

LEGAL, REPO, RAW, WIKI = cpl.LEGAL, cpl.REPO, cpl.RAW, cpl.WIKI
LEGACY_RAW = os.path.join(LEGAL, '_legacy', 'raw')
FILE_MAP = cpl.FILE_MAP
LAYER_OF = {v: k for k, v in FILE_MAP.items()}


class _NullTouched:
    """테스트 트리(NRYA_LEGAL_DIR)에서는 Touched 기록을 남기지 않는다 — 기록 폴더가 진짜 _dashboard/touched/ 라서
    테스트마다 실제 저장소에 기록 파일이 쌓인다(실측 9개가 쌓여 지웠다)."""
    def add(self, path): pass
    def save(self): return None

def today_kst():
    return (datetime.now(timezone.utc) + timedelta(hours=9)).strftime('%Y%m%d')


def _active(kind, date, today):
    return today >= date if kind == '시행' else today < date


def fold_markers(body, today, blocked=None):
    """effective_date.js applyStageMarkers 와 같은 규칙. 여기서는 `d <= today` 인 마커만 접고,
    아직 시행 전인 마커(둘 다 today < d)는 **그대로 둔다** — 런타임이 계속 날짜로 고르게.
    ★blocked 에 든 날짜(승인 전 대기본)도 **그대로 둔다** — 승인 게이트(2026-09-10).
    ★짝·형식이 깨져 있으면 **접지 않고 원문을 그대로 돌려준다**(2026-09-10 독립 검토 high) —
      종전에는 닫는 짝을 못 찾은 블록 아래를 파일 끝까지 버려서 위키 파일이 잘린 채 저장됐다."""
    if '<!--시행' not in body:
        return body
    if check_markers(body):
        return body

    blk = blocked or set()

    def inl(m):
        kind, date, inner = m.group(1), m.group(2), m.group(3)
        if date > today or date in blk:
            return m.group(0)                       # 아직 시행 전이거나 승인 전 — 손대지 않는다
        return inner if _active(kind, date, today) else ''
    s = INLINE_RE.sub(inl, body)
    out, drop, open_kind, keep_raw = [], False, None, False
    for line in s.split('\n'):
        o = OPEN_LINE_RE.match(line)
        if o and open_kind is None:
            open_kind = o.group(1)
            if o.group(2) > today or o.group(2) in blk:   # 시행 전이거나 승인 전 — 마커째 보존
                keep_raw = True; out.append(line); continue
            keep_raw = False; drop = not _active(o.group(1), o.group(2), today); continue
        c = CLOSE_LINE_RE.match(line)
        if c and open_kind == c.group(1):
            open_kind = None
            if keep_raw:
                out.append(line); keep_raw = False; continue
            drop = False; continue
        if keep_raw or not drop:
            out.append(line)
    return '\n'.join(out)


# ── 승인 게이트(사용자 확정 2026-09-10) ────────────────────────────────────────
# 예고본은 **관리자가 승인한 것만** 현행으로 승격한다. 런타임(effective_date.js)이 읽기 시점에
# 같은 규칙으로 막고 있는데, 여기서 승격해 버리면 대기본이 아니라 "현행"이 되어 게이트를 우회한다.
# 승인 상태가 있는 곳: 실서비스는 Fly 볼륨의 `local_server/data/legal_amendments_queue.jsonl`,
# 작업 컴퓨터에는 그 사본이 있을 수도 없을 수도 있어 없으면 git 시드(`_amendments/queue.jsonl`)를 본다.
# ⚠작업 컴퓨터가 보는 사본은 **실서비스 승인보다 뒤처져 있을 수 있다** — 폰에서 방금 승인한 것은
#   여기에 안 보인다. 그때만 `--allow-unapproved` 로 사람이 책임지고 넘긴다(이유를 커밋에 적을 것).
QUEUE_VOL = os.path.join(REPO, 'local_server', 'data', 'legal_amendments_queue.jsonl')
QUEUE_SEED = os.path.join(LEGAL, '_amendments', 'queue.jsonl')


def approved_ids():
    """승인된 개정검토 큐 항목 id 집합. 파일이 없으면 빈 집합(= 아무것도 승격 안 함).
    예: approved_ids() → {'chg_20260810_5373b9'}
    [연계] services/effective_date.js loadApprovedIds() 와 같은 규칙(status == 'approved').
    """
    path = QUEUE_VOL if os.path.exists(QUEUE_VOL) else QUEUE_SEED
    ids = set()
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get('status') == 'approved' and r.get('id'):
                    ids.add(str(r['id']))
    except Exception:
        pass
    return ids


def entry_approved(e, fname, ids):
    """대기본 한 항목(fname 을 주면 그 층만)이 승인됐나. 승인 기록이 없으면 False(닫는다)."""
    qmap = (e or {}).get('queue_id') or {}
    want = [qmap.get(fname)] if fname else list(qmap.values())
    return bool(want) and all(q and str(q) in ids for q in want)


def _file_eff(path):
    try:
        m = re.search(r'\(시행 (\d{8})', open(path, encoding='utf-8').read(4000))
        return m.group(1) if m else '00000000'
    except Exception:
        return '00000000'


def fold_raw(today, dry, touched, ids, allow_unapproved=False):
    idx = cpl.build_index()
    n = skipped = 0
    for key, ents in idx.items():
        base = os.path.join(REPO, key)
        meta_p = os.path.join(base, '_meta.json')
        try:
            meta = json.load(open(meta_p, encoding='utf-8'))
        except Exception:
            meta = None
        for e in sorted(ents, key=lambda x: x['date']):       # 앞 시행일부터 차례로 — 뒤 판이 앞 판을 덮는다
            d = e['date']
            if d > today:
                continue
            ddir = os.path.join(base, cpl.STAGE_DIR, d)
            for fname in e['files']:
                # ★승인 게이트 — 승인 안 된 대기본은 승격하지 않는다(대기본으로 남겨 둔다).
                if not allow_unapproved and not entry_approved(e, fname, ids):
                    q = ((e.get('queue_id') or {}).get(fname)) or '(큐 연결 없음)'
                    print(f"⏸ {key.split('/')[-1]} {LAYER_OF.get(fname, fname)} 시행 {d} — 승인 전이라 승격 안 함(개정검토 큐 {q})")
                    skipped += 1
                    continue
                layer = LAYER_OF.get(fname, fname)
                staged = os.path.join(ddir, fname)
                cur = os.path.join(base, fname)
                new_mst = str(e['mst'].get(fname) or '')
                fam = (meta or {}).get('families', {}).get(layer) if meta else None
                old_mst = str(fam.get('MST')) if isinstance(fam, dict) else ''
                label = f"{key.split('/')[-1]} {layer} 시행 {d} MST {old_mst}→{new_mst}"
                if old_mst and old_mst == new_mst:
                    print(f'↩ {label} — 현행이 이미 이 MST(트랙 D 재수집) → 대기본만 지운다')
                    if not dry:
                        os.remove(staged); touched.add(staged)
                    continue
                # ★현행이 이 대기본보다 **뒤 시행본**이면 승격하지 않는다(2026-09-10 독립 검토 high).
                #   트랙 D(recollect_tier.py)가 먼저 재수집해 두면 현행이 더 새 판인데, 종전에는 MST 가
                #   다르다는 이유만으로 승격해 새 판을 _legacy 로 밀어내고 옛 예고본을 현행으로 되돌렸다
                #   (_meta 의 시행일도 뒤로 갔다). 한 법에 대기 날짜가 여럿인 사례가 실제로 있다.
                cur_eff = _file_eff(cur) if os.path.exists(cur) else ''
                if cur_eff and cur_eff != '00000000' and cur_eff > d:
                    print(f'↩ {label} — 현행이 이미 시행 {cur_eff} 판(대기본 {d} 보다 뒤) → 대기본만 지운다')
                    if not dry:
                        os.remove(staged); touched.add(staged)
                    continue
                print(f'⬆ {label}')
                if dry:
                    continue
                if os.path.exists(cur):
                    leg_dir = os.path.join(LEGACY_RAW, os.path.relpath(base, RAW))
                    os.makedirs(leg_dir, exist_ok=True)
                    leg = os.path.join(leg_dir, f"{layer}_시행{_file_eff(cur)}_MST{old_mst or 'unknown'}.txt")
                    shutil.move(cur, leg); touched.add(leg)
                    print(f'   옛 현행 → {os.path.relpath(leg, REPO)}')
                shutil.move(staged, cur); touched.add(cur)
                if meta is not None and isinstance(fam, dict):
                    fam['MST'] = new_mst
                    if layer == '법률':
                        meta['시행일'] = d
                    meta['예고본승격'] = f"{time.strftime('%Y-%m-%d')} {layer} MST {old_mst}→{new_mst} 시행 {d} (fold_effective.py)"
                n += 1
            if not dry:
                if os.path.isdir(ddir) and not [f for f in os.listdir(ddir) if f.endswith('.txt')]:
                    shutil.rmtree(ddir)
                    print(f'   폴더 정리 {os.path.relpath(ddir, REPO)}')
        if meta is not None and not dry:
            json.dump(meta, open(meta_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            touched.add(meta_p)
    if skipped:
        print(f'\n⏸ 승인 전이라 건너뛴 층 {skipped}개 — 관리자 화면 "개정검토"에서 승인한 뒤 다시 돌린다.')
        print('   폰에서 이미 승인했는데 여기 안 보이면(작업 컴퓨터 큐 사본이 뒤처진 경우) --allow-unapproved 로 넘긴다.')
    return n


def unapproved_dates_of(law_slug, idx, ids):
    """그 법의 대기본 중 **승인되지 않은 시행일** 집합 — 위키에서 접으면 안 되는 날짜들.
    [연계] services/effective_date.js unapprovedStageDates() 와 같은 규칙."""
    out = set()
    for base, ents in idx.items():
        if base != law_slug and not base.endswith('/' + law_slug):
            continue
        for e in ents:
            if e.get('date') and not entry_approved(e, None, ids):
                out.add(str(e['date']))
    return out


def fold_wiki(today, dry, touched, ids, allow_unapproved=False):
    n = held = 0
    idx = cpl.build_index()
    stamp = time.strftime('%Y-%m-%d')
    for p in sorted(glob.glob(os.path.join(WIKI, '*', '*.md'))):
        src = open(p, encoding='utf-8').read()
        if '<!--시행' not in src:
            continue
        errs = check_markers(src)
        if errs:
            print('⚠ %s — 마커가 깨져 건너뛴다: %s'
                  % (os.path.relpath(p, WIKI), ' / '.join('%d행 %s' % e for e in errs[:3])))
            continue
        dates = sorted(set(d for d in re.findall(r'<!--시행(?:전)? (\d{8})-->', src) if d <= today))
        # ★승인 게이트 — 승인 안 된 시행일은 접지 않는다(런타임도 그 날짜를 "아직 시행 전"으로 다룬다).
        blocked = set()
        if not allow_unapproved:
            blocked = unapproved_dates_of(os.path.basename(p)[:-3].split('__')[0], idx, ids)
            keep = [d for d in dates if d in blocked]
            if keep:
                print('⏸ %s — 승인 전 시행일 %s 은 접지 않는다' % (os.path.relpath(p, WIKI), ', '.join(keep)))
                held += 1
            dates = [d for d in dates if d not in blocked]
        if not dates:
            continue
        out = fold_markers(src, today, None if allow_unapproved else blocked)
        if out == src:
            continue
        note = f"| {stamp} | 시행일 마커 접기 — 시행 {', '.join(dates)} 서술을 본문으로, 시행전 서술 삭제 | fold_effective.py |"
        m = re.search(r'^## 변경 이력\s*\n(?:.*\n)*?(?=\n?## |\Z)', out, re.M)
        if m and re.search(r'^\|', m.group(0), re.M):
            block = m.group(0).rstrip('\n') + '\n' + note + '\n'
            out = out[:m.start()] + block + out[m.end():]
        else:
            out = out.rstrip('\n') + '\n\n## 변경 이력\n\n| 날짜 | 무엇이 바뀜 | 출처 |\n|---|---|---|\n' + note + '\n'
        print(f"✎ {os.path.relpath(p, WIKI)} — 시행 {', '.join(dates)} 접음")
        if not dry:
            open(p, 'w', encoding='utf-8').write(out); touched.add(p)
        n += 1
    if held:
        print(f'\n⏸ 승인 전이라 접지 않은 위키 {held}쪽 — 관리자 화면 "개정검토"에서 승인한 뒤 다시 돌린다.')
    return n


def main(argv):
    today = argv[argv.index('--today') + 1] if '--today' in argv else today_kst()
    dry = '--dry-run' in argv
    allow = '--allow-unapproved' in argv
    ids = approved_ids()
    touched = Touched('fold_effective') if not os.environ.get('NRYA_LEGAL_DIR') else _NullTouched()
    print(f"기준일 {today}{' (dry-run)' if dry else ''} · 승인된 개정 {len(ids)}건"
          + (' · ⚠--allow-unapproved (승인 확인 없이 진행)' if allow else ''))
    nr = nw = 0
    if '--wiki-only' not in argv:
        nr = fold_raw(today, dry, touched, ids, allow)
        if not dry:
            cpl.write_index(touched)
    if '--raw-only' not in argv:
        nw = fold_wiki(today, dry, touched, ids, allow)
    print(f'\n승격 raw {nr}층 · 위키 {nw}쪽')
    if not dry:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
