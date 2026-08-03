#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""staleness_audit.py 1차 결과의 "위임고시 ID 불일치" 항목을 발령일자 직접 대조로 보정한다.
   1차는 lsDelegated 검색이 돌려준 ID를 무조건 "최신"으로 가정했는데, 실측 샘플 대조 결과
   그 API가 항상 최신 ID를 준다는 보장이 없음이 확인됨(2026-08-03) — 과거 ID를 "현재"라고
   잘못 줄 수 있다. 그래서 stored_ID·current_ID 둘 다 실제로 fetch_body()로 발령일자를 받아
   직접 비교해서, current_ID의 발령일자가 stored_ID보다 진짜로 더 최신일 때만 남긴다."""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from collect_admrul import fetch_body  # noqa: E402

ROOT = '/home/user/SEAGNAL/local_server/knowledge/legal'
REPORT = os.path.join(ROOT, '_dashboard/staleness_audit_20260803.json')
OUT = os.path.join(ROOT, '_dashboard/staleness_id_mismatch_corrected.json')

_date_cache = {}


def get_date(sid):
    if sid in _date_cache:
        return _date_cache[sid]
    _, info = fetch_body(sid)
    d = info.get('발령일자') or info.get('시행일자') or ''
    _date_cache[sid] = d
    time.sleep(0.2)
    return d


def main():
    report = json.load(open(REPORT, encoding='utf-8'))
    confirmed, reversed_, unknown = [], [], []
    total = sum(1 for v in report['법별결과'].values()
                for issue in (v.get('위임고시_이슈') or [])
                if issue.get('issue', '').startswith('ID 불일치'))
    seen = 0
    for law, v in report['법별결과'].items():
        for issue in (v.get('위임고시_이슈') or []):
            if not issue.get('issue', '').startswith('ID 불일치'):
                continue
            seen += 1
            sid_old = str(issue.get('stored_ID'))
            sid_new = str(issue.get('current_ID'))
            d_old = get_date(sid_old)
            d_new = get_date(sid_new)
            row = {'law': law, 'title': issue['title'], 'stored_ID': sid_old, 'stored_발령일자': d_old,
                   'current_ID': sid_new, 'current_발령일자': d_new}
            if not d_old or not d_new:
                unknown.append(row)
            elif d_new > d_old:
                confirmed.append(row)
            else:
                reversed_.append(row)  # 1차 판정이 거꾸로였던 오탐
            if seen % 20 == 0:
                print(f'{seen}/{total} 대조 중... (진짜 개정 {len(confirmed)} / 오탐 {len(reversed_)} / 불명 {len(unknown)})', flush=True)
    out = {'대상': total, '진짜_개정판_존재': confirmed, '오탐_거꾸로였음': reversed_, '날짜확인불가': unknown}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'=== 완료: {total}건 중 진짜 개정 {len(confirmed)} / 오탐 {len(reversed_)} / 불명 {len(unknown)} → {OUT} ===', flush=True)


if __name__ == '__main__':
    main()
